'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Host, normalizeRoomMode } = require('../src/main/host');
const { Guest } = require('../src/main/guest');
const { Store } = require('../src/main/store');
const { isAdultAddon, isAdultCategory, AddonClient } = require('../src/main/media/addon-client');
const storeApi = require('../src/main/media/store-api');
const { LibMpv, buildLibMpvOptions } = require('../src/main/libmpv');

function fakeLink(peerId = '222222222', pk = 'pk-guest') {
  const link = new EventEmitter();
  link.peer = { id: peerId, pk, nick: 'Friend' };
  link.safety = '1234';
  link.rtt = 12;
  link.stats = { tx: 0, rx: 0 };
  link.ctrls = [];
  link.raws = [];
  link.ctrl = (m) => link.ctrls.push(m);
  link.send = (b) => link.raws.push(b);
  link.sendBoth = (b) => link.raws.push(b);
  link.ping = () => {};
  link.pathInfo = () => ({ lan: true });
  link.allPaths = () => [];
  link.takeLoss = () => 0;
  link.close = (reason) => link.emit('close', reason);
  return link;
}

test('fix2: Cinema Majlis roomMode strictly blocks screen capture, pads, and desktop input', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-fix2-'));
  const store = new Store(dir);
  t.after(() => { store.flush(); fs.rmSync(dir, { recursive: true, force: true }); });
  store.set('mode', 'cinema');

  const net = new EventEmitter();
  net.id = { id: '111111111' };
  net.setPresence = () => {};
  net.signal = () => {};
  net._sign = (x) => x;

  let helperStarts = 0;
  const helperCmds = [];
  const helper = new EventEmitter();
  helper.p = null;
  helper.ready = false;
  helper.info = { displays: [{ index: 0, w: 1920, h: 1080, x: 0, y: 0, hz: 60 }] };
  helper.start = () => { helperStarts++; helper.ready = true; return true; };
  helper.cmd = (c) => helperCmds.push(c);

  const host = new Host({ store, net, helper, encoders: [{ codec: 'h264', fam: 'sw', name: 'x264' }], ffmpeg: null });
  t.after(() => host.dispose());
  host.setEnabled(true);
  assert.equal(host.mode, 'cinema');
  assert.equal(normalizeRoomMode('cinema'), 'cinema');
  assert.equal(normalizeRoomMode('watch'), 'watch');
  assert.equal(normalizeRoomMode('play'), 'play');

  const link = fakeLink();
  const knock = {
    sid: 'sid-1', from: '222222222', pk: 'pk-guest', nick: 'Friend',
    decide: async (ok) => (ok ? link : null),
  };
  await host.decide('sid-1', { accept: true, role: 'full' }, knock);

  assert.equal(helperStarts, 0, 'Cinema Majlis must NEVER start screen capture helper');
  assert.equal(host.tiers.play, null);
  assert.equal(host.tiers.watch, null);
  const g = host.guests.get('sid-1');
  assert.equal(g.role, 'watch', 'Cinema guest must not receive pad/kbm role');
  assert.equal(g.slot, null);
  assert.equal(g.tier, 'cinema');

  const welcome = link.ctrls.find((m) => m.t === 'welcome');
  assert.ok(welcome);
  assert.equal(welcome.mode, 'cinema');
  assert.equal(welcome.roomMode, 'cinema');

  // Verify desktop input packet (0x03) is ignored in cinema mode
  const inputPkt = Buffer.from([0x03, 0, 0, 0, 1, 1, 2, 0, 10, 0, 10]);
  link.emit('raw', inputPkt);
  assert.equal(helperCmds.filter((c) => c.cmd === 'in').length, 0);

  // Verify Guest in cinema mode drops stray video/audio/cursor packets while keeping voice (0x09)
  const guest = new Guest({ net, store });
  guest.caps = { codecs: ['h264'] };
  const posted = [];
  guest.port = { postMessage: (m) => posted.push(m) };
  const gLink = fakeLink('111111111', 'pk-host');
  guest._attach(gLink);
  t.after(() => guest.leave());
  gLink.emit('ctrl', { t: 'welcome', mode: 'cinema', roomMode: 'cinema', host: 'Host', hostId: '111111111', role: 'watch' });
  assert.equal(guest.roomMode, 'cinema');
  gLink.emit('ctrl', { t: 'config', epoch: 1, codec: 'avc1', tier: 'play' });
  gLink.emit('raw', Buffer.from([0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]));
  gLink.emit('raw', Buffer.from([0x09, 0, 1, 2, 3]));
  assert.equal(posted.some((m) => m.t === 'config' || m.t === 'c'), false);
  assert.equal(posted.some((m) => m.t === 'vo'), true);
});

test('fix2: Store migrates legacy built-in cinema presets from watch to cinema', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-preset-'));
  fs.writeFileSync(path.join(dir, 'majlis.json'), JSON.stringify({
    settings: {},
    roomPresets: [
      { id: 'preset-cinema-night', builtin: true, name: 'Movie Night', mode: 'watch', watchControl: 'host' },
      { id: 'preset-open-majlis', builtin: true, name: 'Open Watch Room', mode: 'watch', watchControl: 'all' },
      { id: 'preset-coop-squad', builtin: true, name: 'Co-op Squad', mode: 'play', watchControl: 'host' },
    ],
  }));
  const store = new Store(dir);
  t.after(() => { store.flush(); fs.rmSync(dir, { recursive: true, force: true }); });
  const presets = store.roomPresets();
  assert.equal(presets.find((p) => p.id === 'preset-cinema-night')?.mode, 'cinema');
  assert.equal(presets.find((p) => p.id === 'preset-open-majlis')?.mode, 'cinema');
  assert.equal(presets.find((p) => p.id === 'preset-coop-squad')?.mode, 'play');
});

test('fix4: Adult / NSFW / pornographic addons and categories are permanently blocked', async () => {
  const blockedSamples = [
    { slug: 'tpb-4k-porn', name: 'TPB 4K Porn', manifest: { id: 'org.tpb.porn', name: 'TPB 4K Porn', types: ['movie'] } },
    { slug: 'xvideos-stremio', name: 'XVideos', manifest: { id: 'xvideos', name: 'XVideos', description: 'Free videos' } },
    { slug: 'pornhub-addon', manifest: { id: 'ph', name: 'PH', description: 'Stream PornHub' } },
    { slug: 'hanime-tv', manifest: { id: 'hanime', name: 'Hanime', description: 'Hentai streaming' } },
    { slug: 'jav-hd', manifest: { id: 'jav', name: 'JAV HD', types: ['movie'] } },
    { slug: 'erotica-plus', manifest: { id: 'ero', name: 'Erotica 18+', description: 'Adults only content' } },
    { slug: 'clean-slug', nsfw: true, manifest: { id: 'ok', name: 'Hidden NSFW' } },
    { slug: 'clean-slug-2', categories: ['movies', 'nsfw'], manifest: { id: 'ok2', name: 'Tagged NSFW' } },
    { slug: 'clean-slug-3', manifest: { id: 'ok3', name: 'Flagged', behaviorHints: { adult: true } } },
  ];
  for (const sample of blockedSamples) {
    assert.equal(isAdultAddon(sample), true, `Expected blocked: ${sample.slug}`);
  }

  const allowedSamples = [
    { slug: 'cinemeta', categories: ['metadata'], manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta', description: 'Official movie and series metadata', types: ['movie', 'series'] } },
    { slug: 'torrentio', categories: ['streams'], manifest: { id: 'com.stremio.torrentio.addon', name: 'Torrentio', description: 'Provides torrent streams for movies and series', types: ['movie', 'series'] } },
    { slug: 'ya-catalog', categories: ['movies'], manifest: { id: 'ya.cat', name: 'Young Adult Cinema', description: 'Best young adult movies and coming-of-age stories', types: ['movie'] } },
  ];
  for (const sample of allowedSamples) {
    assert.equal(isAdultAddon(sample), false, `Expected allowed: ${sample.slug}`);
  }

  assert.equal(isAdultCategory({ slug: 'nsfw', name: 'NSFW' }), true);
  assert.equal(isAdultCategory({ slug: 'adult', name: '18+ Adult' }), true);
  assert.equal(isAdultCategory({ slug: 'movies', name: 'Movies' }), false);

  const blockedCatRes = await storeApi.list({ category: 'nsfw' });
  assert.deepEqual(blockedCatRes, { addons: [], pagination: null });

  const client = new AddonClient();
  client.manifests.set('https://example.com/manifest.json', {
    id: 'porn.test', name: 'XXX Test', types: ['movie'], resources: ['stream'], catalogs: [], addonCatalogs: [], behaviorHints: { adult: true },
  });
  client.manifest = async () => client.manifests.get('https://example.com/manifest.json');
  await assert.rejects(() => client.check('https://example.com/manifest.json'), (err) => err.kind === 'adult-blocked');
});

test('fix1 & fix3: libmpv options are deduplicated and commandAsync is used for loadfile/stop/seek', async () => {
  const opts = buildLibMpvOptions({});
  assert.equal(opts.filter(([k]) => k === 'idle').length, 1);
  assert.equal(opts.filter(([k]) => k === 'keep-open').length, 1);

  const calls = [];
  const fakeNative = {
    commandAsync: (args) => calls.push(['async', ...args]),
    command: (args) => calls.push(['sync', ...args]),
    setProperty: () => {},
  };
  const lm = new LibMpv({ dll: 'fake.dll', NativeMpvPlayer: class {} });
  lm.player = fakeNative;
  await lm.command('loadfile', 'https://example.com/a.mp4', 'replace');
  await lm.command('seek', '10', 'absolute+exact');
  await lm.command('screenshot-to-file', 'a.png', 'video');
  assert.deepEqual(calls, [
    ['async', 'loadfile', 'https://example.com/a.mp4', 'replace'],
    ['async', 'seek', '10', 'absolute+exact'],
    ['sync', 'screenshot-to-file', 'a.png', 'video'],
  ]);
});

test('fix6: AddonClient.progressive collectMs waits full window so slower high-quality addon beats fast low-quality addon, and short-circuits when 100% finish', async () => {
  const { AddonClient } = require('../src/main/media/addon-client');
  const { rank } = require('../src/main/media/ranking');

  const client = new AddonClient();
  const fastUrl = 'https://fast-junk.example/manifest.json';
  const slowUrl = 'https://slow-best.example/manifest.json';
  const manifestFor = (id, name) => ({ id, name, resources: [{ name: 'stream', types: ['series'], idPrefixes: ['tt'] }], types: ['series'], catalogs: [], behaviorHints: {} });
  client.manifests.set(fastUrl, manifestFor('fast', 'FastLow'));
  client.manifests.set(slowUrl, manifestFor('slow', 'SlowHigh'));

  client.request = async (u) => {
    if (u === fastUrl) {
      await new Promise((r) => setTimeout(r, 20));
      return { streams: [{ name: 'FastLow 480p CAM', title: 'Show S01E01 480p CAM', infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] };
    }
    await new Promise((r) => setTimeout(r, 180));
    return { streams: [{ name: 'SlowHigh 1080p WEB-DL', title: 'Show S01E01 1080p WEB-DL\n👤 420 💾 2.1 GB', url: 'https://cdn.example/show.mkv' }] };
  };

  // With collectMs: 400 and 2 addons: waits for slow addon (180ms), then short-circuits immediately when 100% return
  const t0 = Date.now();
  const results = await client.progressive([fastUrl, slowUrl], { resource: 'stream', type: 'series', id: 'tt1234567:1:1' }, { collectMs: 400, maxWaitMs: 2000 });
  const elapsed = Date.now() - t0;
  assert.equal(results.length, 2, 'Both fast and slow addons must be collected');
  assert.ok(elapsed >= 160 && elapsed < 380, `Expected early exit when 100% finish (~180ms), got ${elapsed}ms`);

  const flat = results.flatMap((x) => (x.result?.streams || []).map((stream) => ({ stream, addon: { url: x.url, name: x.manifest.name }, addonRank: x.addonRank })));
  const ranked = rank(flat, { maxHeight: 1080 });
  assert.equal(ranked[0].addon.name, 'SlowHigh', 'Higher-quality slower addon must win over fast low-quality addon');

  // With a 3rd stalled addon: must wait the full collectMs window (300ms) instead of resolving at 20ms
  const stuckUrl = 'https://stuck.example/manifest.json';
  client.manifests.set(stuckUrl, manifestFor('stuck', 'StuckAddon'));
  const origReq = client.request;
  client.request = async (u) => {
    if (u === stuckUrl) {
      await new Promise((r) => { const t = setTimeout(r, 2000); t.unref?.(); });
      return { streams: [] };
    }
    return origReq(u);
  };
  const t1 = Date.now();
  const res2 = await client.progressive([fastUrl, slowUrl, stuckUrl], { resource: 'stream', type: 'series', id: 'tt1234567:1:2' }, { collectMs: 300, maxWaitMs: 2000 });
  const elapsed2 = Date.now() - t1;
  assert.equal(res2.length, 2, 'Must include both addons that responded during collectMs window');
  assert.ok(elapsed2 >= 270, `Must wait full collectMs window (~300ms) when an addon is still pending, got ${elapsed2}ms`);
});
