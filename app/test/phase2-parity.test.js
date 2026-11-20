'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { Library } = require('../src/main/media/library');
const { Downloads } = require('../src/main/media/downloads');
const { parseTorrentBuffer } = require('../src/main/media/torrent-parse');
const { normalizeServerUrl, testServer, listServerItems, resolveServerStream, syncServerWatched } = require('../src/main/media/home-servers');
const { Notifications } = require('../src/main/media/notifications');

function encodeBencode(val) {
  if (typeof val === 'number') return Buffer.from(`i${val}e`, 'ascii');
  if (Buffer.isBuffer(val) || typeof val === 'string') {
    const b = Buffer.isBuffer(val) ? val : Buffer.from(val, 'utf8');
    return Buffer.concat([Buffer.from(`${b.length}:`, 'ascii'), b]);
  }
  if (Array.isArray(val)) {
    return Buffer.concat([Buffer.from('l', 'ascii'), ...val.map(encodeBencode), Buffer.from('e', 'ascii')]);
  }
  const keys = Object.keys(val).sort();
  return Buffer.concat([
    Buffer.from('d', 'ascii'),
    ...keys.flatMap((k) => [encodeBencode(k), encodeBencode(val[k])]),
    Buffer.from('e', 'ascii'),
  ]);
}

test('phase2 library: rewind, upcomingWatching, and persistent custom lists CRUD', () => {
  let disk = null;
  const load = () => disk;
  const save = (s) => { disk = JSON.parse(JSON.stringify(s)); };
  const l = new Library({ load, save });

  l.add({ id: 'tt0113277', type: 'movie', name: 'Heat', year: 1995, genres: ['Crime', 'Drama'] });
  l.progress({ id: 'tt0113277', type: 'movie', name: 'Heat' }, 'tt0113277', 900000, 10000000, 5000);
  assert.equal(l.continueWatching().length, 1);
  assert.equal(l.rewind('tt0113277'), true);
  assert.equal(l.continueWatching().length, 0);

  // Upcoming episode/title splits cleanly from Continue Watching
  const futureDate = '2099-06-15T12:00:00.000Z';
  const show = { id: 'tt0944947', type: 'series', name: 'Future Show', videoReleased: futureDate };
  l.add(show);
  l.progress(show, 'tt0944947:2:1', 120000, 3000000, 1000);
  assert.equal(l.continueWatching().some((x) => x._id === show.id), false);
  assert.equal(l.upcomingWatching().some((x) => x._id === show.id), true);

  // Custom Lists CRUD + flush/reload persistence
  const a = l.createList('Weekend Marathon');
  const b = l.createList('Sci-Fi Gems');
  assert.equal(l.getCustomLists().length, 2);
  l.renameList(a.id, 'Best Weekend');
  l.toggleCustomListItem(a.id, { id: 'tt0113277', type: 'movie', name: 'Heat', year: 1995 });
  l.reorderLists([b.id, a.id]);
  l.flush();

  const l2 = new Library({ load, save });
  const loaded = l2.getCustomLists();
  assert.deepEqual(loaded.map((x) => x.id), [b.id, a.id]);
  assert.equal(loaded[1].name, 'Best Weekend');
  assert.equal(loaded[1].items[0].id, 'tt0113277');
  assert.equal(l2.deleteList(b.id), true);
  assert.equal(l2.getCustomLists().length, 1);
});

test('phase2 torrent-parse: computes exact SHA-1 infoHash and trackers, rejects invalid bencode', () => {
  const info = { length: 123456, name: 'Debian ISO.mkv', 'piece length': 262144, pieces: Buffer.alloc(20, 0xaa) };
  const expectedHash = crypto.createHash('sha1').update(encodeBencode(info)).digest('hex');
  const torrentBuf = encodeBencode({
    announce: 'udp://tracker.one.example:80',
    'announce-list': [['https://tracker.two.example/announce'], ['udp://tracker.one.example:80']],
    info,
  });
  const parsed = parseTorrentBuffer(torrentBuf);
  assert.equal(parsed.infoHash, expectedHash);
  assert.equal(parsed.name, 'Debian ISO.mkv');
  assert.deepEqual(parsed.sources, [
    'tracker:udp://tracker.one.example:80',
    'tracker:https://tracker.two.example/announce',
  ]);

  assert.throws(() => parseTorrentBuffer(Buffer.from('not a torrent')));
  assert.throws(() => parseTorrentBuffer(encodeBencode({ announce: 'udp://x' })));
});

test('phase2 downloads: transient 503 retries with Range resume and sidecar subtitle bundling', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-dl-p2-'));
  const dlDir = path.join(tmpDir, 'videos');
  const payload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const subText = '1\n00:00:01,000 --> 00:00:03,000\nمرحباً\n';
  let reqCount = 0;

  const srv = http.createServer((req, res) => {
    if (req.url === '/sub.ar.srt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(subText);
      return;
    }
    reqCount++;
    if (reqCount <= 2) {
      res.writeHead(503);
      res.end('busy');
      return;
    }
    const m = /^bytes=(\d+)-/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    res.writeHead(start > 0 ? 206 : 200, {
      'content-length': String(payload.length - start),
    });
    res.end(payload.subarray(start));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;

  // Pre-seed partial .part file to verify Range resume across retry attempts
  fs.mkdirSync(dlDir, { recursive: true });
  fs.writeFileSync(path.join(dlDir, 'Test Movie.mkv.part'), payload.subarray(0, 10));

  const dls = new Downloads({
    file: path.join(tmpDir, 'downloads.json'),
    folder: () => dlDir,
    svc: null,
    debrid: () => null,
    allowPrivateHosts: true,
    retryDelaysMs: [15, 30, 50],
    fetchSubtitles: async () => [{ lang: 'ara', url: `${baseUrl}/sub.ar.srt` }],
  });

  const entry = dls.add({
    meta: { id: 'tt7777777', name: 'Test Movie' },
    type: 'movie',
    videoId: 'tt7777777',
    label: 'Test Movie',
    stream: { url: `${baseUrl}/Test Movie.mkv` },
  });

  for (let i = 0; i < 40 && entry.state !== 'done' && entry.state !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(reqCount, 3);
  assert.equal(entry.state, 'done');
  assert.deepEqual(fs.readFileSync(entry.file), payload);
  assert.ok(entry.subFiles && entry.subFiles.length === 1);
  assert.equal(fs.readFileSync(entry.subFiles[0], 'utf8'), subText);
  assert.equal(dls.findDone('tt7777777', 'tt7777777')?.id, entry.id);
});

test('phase2 home-servers: normalizeServerUrl + Jellyfin and Plex client endpoints', async (t) => {
  assert.equal(normalizeServerUrl('http://192.168.1.10:8096///'), 'http://192.168.1.10:8096');
  assert.equal(normalizeServerUrl('file:///etc/passwd'), null);
  assert.equal(normalizeServerUrl('javascript:alert(1)'), null);

  let watchedCalls = 0;
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/System/Info/Public')) {
      res.end(JSON.stringify({ ServerName: 'HomeJelly', Version: '10.9.0' }));
    } else if (req.url === '/Users') {
      res.end(JSON.stringify([{ Id: 'u-1' }]));
    } else if (req.url.startsWith('/Users/u-1/Items')) {
      res.end(JSON.stringify({
        Items: [{
          Id: 'jf-42', Type: 'Movie', Name: 'Desert Film', ProductionYear: 2024,
          Genres: ['Drama'], ProviderIds: { Imdb: 'tt9991111' }, ImageTags: { Primary: 'tag' }, UserData: { Played: true },
        }],
      }));
    } else if (req.url === '/Users/u-1/PlayedItems/jf-42') {
      watchedCalls++;
      res.end(JSON.stringify({ Played: true }));
    } else if (req.url === '/identity') {
      res.end(JSON.stringify({ MediaContainer: { friendlyName: 'HomePlex', version: '1.40' } }));
    } else if (req.url === '/library/sections') {
      res.end(JSON.stringify({ MediaContainer: { Directory: [{ key: '1' }] } }));
    } else if (req.url.startsWith('/library/recentlyAdded')) {
      res.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '99', type: 'movie', title: 'Plex Sample', year: 2023, thumb: '/t.jpg' }] } }));
    } else if (req.url === '/library/metadata/99') {
      res.end(JSON.stringify({ MediaContainer: { Metadata: [{ title: 'Plex Sample', Media: [{ Part: [{ key: '/parts/99/file.mkv' }] }] }] } }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;

  const jfTest = await testServer({ kind: 'jellyfin', url: baseUrl, apiKey: 'secret-key' });
  assert.equal(jfTest.ok, true);
  assert.equal(jfTest.serverName, 'HomeJelly');
  assert.equal(jfTest.userId, 'u-1');

  const jfSrv = { id: 's1', kind: 'jellyfin', name: 'NAS', url: baseUrl, apiKey: 'secret-key', userId: 'u-1' };
  const jfItems = await listServerItems(jfSrv);
  assert.equal(jfItems[0].id, 'tt9991111');
  assert.equal(jfItems[0].watched, true);
  const jfStream = await resolveServerStream(jfSrv, 'jf-42');
  assert.match(jfStream.url, /\/Videos\/jf-42\/stream\?Static=true/);
  assert.equal(await syncServerWatched(jfSrv, 'jf-42', true), true);
  assert.equal(watchedCalls, 1);

  const pxTest = await testServer({ kind: 'plex', url: baseUrl, apiKey: 'px-tok' });
  assert.equal(pxTest.ok, true);
  assert.equal(pxTest.serverName, 'HomePlex');
  const pxSrv = { id: 's2', kind: 'plex', name: 'PlexBox', url: baseUrl, apiKey: 'px-tok' };
  const pxItems = await listServerItems(pxSrv);
  assert.equal(pxItems[0].id, 'homesrv:s2:99');
  const pxStream = await resolveServerStream(pxSrv, '99');
  assert.match(pxStream.url, /\/parts\/99\/file\.mkv\?X-Plex-Token=px-tok$/);
});

test('phase2 notifications: checkTrackedPeople establishes baseline then alerts on new credit', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-np-p2-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const notifs = new Notifications({ fileFor: (p) => path.join(tmpDir, `${p}.json`) });
  const tracked = [{ id: 525, name: 'Christopher Nolan', photo: null }];
  let credits = [{ id: 'tt15398776', type: 'movie', name: 'Oppenheimer', year: 2023 }];

  const r1 = await notifs.checkTrackedPeople({
    prof: 'default',
    trackedPeople: tracked,
    fetchPerson: async () => ({ id: 525, name: 'Christopher Nolan', credits }),
    nowMs: Date.UTC(2026, 10, 20),
  });
  assert.equal(r1.added.length, 0);

  credits = [...credits, { id: 'tt9999999', type: 'movie', name: 'New Film', year: 2026 }];
  const r2 = await notifs.checkTrackedPeople({
    prof: 'default',
    trackedPeople: tracked,
    fetchPerson: async () => ({ id: 525, name: 'Christopher Nolan', credits }),
    nowMs: Date.UTC(2026, 10, 20),
  });
  assert.equal(r2.added.length, 1);
  assert.equal(r2.added[0].metaId, 'tt9999999');
});

test('phase2 preload & i18n invariants: channels allowlisted and ar/en keys matched', async () => {
  const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  for (const ch of [
    'cin:upcoming', 'cin:lib-rewind',
    'cin:custom-lists', 'cin:custom-list-create', 'cin:custom-list-rename', 'cin:custom-list-delete', 'cin:custom-list-reorder', 'cin:custom-list-toggle',
    'cin:cloud-list', 'cin:cloud-resolve',
    'cin:hs-list', 'cin:hs-save', 'cin:hs-remove', 'cin:hs-test', 'cin:hs-items', 'cin:hs-stream', 'cin:hs-watched',
    'cin:local-match', 'cin:drop-file', 'cin:person-track-list', 'cin:person-track-toggle',
  ]) {
    assert.equal(preloadSrc.includes(`'${ch}'`), true, `Missing ${ch} in preload ALLOWED_INVOKE`);
  }

  const { STR } = await import(pathToFileURL(path.join(__dirname, '../media/src/i18n.ts')).href);
  assert.deepEqual(Object.keys(STR.ar).sort(), Object.keys(STR.en).sort());
  for (const [k, val] of Object.entries(STR.ar)) {
    assert.equal(/[٠-٩]/.test(val), false, `Arabic-Indic digit in STR.ar.${k}: ${val}`);
    assert.equal(/[<>]/.test(val), false, `Angle bracket in STR.ar.${k}: ${val}`);
  }
});
