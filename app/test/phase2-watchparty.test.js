'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');
const { SyncHost, SyncViewer, correct } = require('../src/main/sync');
const { Host } = require('../src/main/host');
const {
  maskRatingSession,
  sanitizePartyNote,
  computeFriendCompatibility,
} = require('../src/main/social');
const { isYouTubeUrl, resolveVideoStream } = require('../src/main/media/ytdlp');

test('phase2 sync: Smart Catch-Up 1.15x behind 1.5s..15s, hard-seek >=15s or ahead, 3-arg legacy preserved', () => {
  // 3-arg compatibility preserved (no smartCatchUp)
  assert.deepStrictEqual(correct(8000, 10000, 1), { seek: 10000, speed: 1 });
  assert.ok(Math.abs(correct(11400, 10000, 1).speed - 1) <= 0.03 + 1e-9);

  // Behind 5s with smartCatchUp: smoothly accelerates at 1.15x instead of seeking
  assert.deepStrictEqual(correct(5000, 10000, 1, { smartCatchUp: true }), { speed: 1.15, catchUp: true });
  // Behind 16s with smartCatchUp: falls back to hard seek
  assert.deepStrictEqual(correct(1000, 17000, 1, { smartCatchUp: true }), { seek: 17000, speed: 1 });
  // Ahead 3s even with smartCatchUp: hard seek
  assert.deepStrictEqual(correct(13000, 10000, 1, { smartCatchUp: true }), { seek: 10000, speed: 1 });

  let t = 0;
  const h = new SyncHost(() => t);
  const s0 = h.open({}, {});
  const st = h.request({ epoch: s0.epoch, action: 'play' });
  const v = new SyncViewer({ smartCatchUp: true });
  assert.equal(v.accept(st), true);
  t = 10000; // want = 10000, local = 5000 -> behind 5000ms
  const step = v.step(5000, t, false, 1);
  assert.equal(step.speed, 1.15);
  assert.equal(step.catchUp, true);
  assert.equal(step.driftMs, -5000);
});

test('phase2 host: Pass the Remote (host/guest/all, _drop revert) & Ready Check state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p2-host-'));
  const store = new Store(dir);
  const net = new EventEmitter();
  net.id = { id: '111222333' };
  const helper = new EventEmitter();
  helper.cmd = () => {};
  const host = new Host({ store, net, helper, encoders: {}, ffmpeg: 'ffmpeg' });
  t.after(() => {
    clearTimeout(host.cdTimer);
    host.dispose();
    store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeGuest = (sid, id, nick) => {
    const link = new EventEmitter();
    link.sentCtrl = [];
    link.ctrl = (m) => link.sentCtrl.push(m);
    link.send = () => {};
    link.peer = { pk: 'pk-' + id };
    link.stats = { tx: 0 };
    link.rtt = 25;
    link.safety = 'ok';
    link.pathInfo = () => 'direct';
    return {
      sid, id, nick, role: 'watch', slot: 0, tier: 'watch', hand: false, muted: false,
      link, configSent: {}, joined: Date.now(), ready: false, fb: null, rc: null,
      tx: { flush() {}, setClock() {}, sendRaw() {}, send() {} },
    };
  };

  const g1 = makeGuest('s1', '222333444', 'Omar');
  const g2 = makeGuest('s2', '555666777', 'Lina');
  host.guests.set('s1', g1);
  host.guests.set('s2', g2);

  // Default: host-only
  assert.equal(host.getWatchControl().mode, 'host');
  assert.equal(host._canControl(g1), false);
  assert.equal(host._canControl(g2), false);

  // Pass remote to specific friend
  const wcGuest = host.setWatchControl('guest', g1.id);
  assert.equal(wcGuest.mode, 'guest');
  assert.equal(wcGuest.holderName, 'Omar');
  assert.equal(host._canControl(g1), true);
  assert.equal(host._canControl(g2), false);

  // Open to all
  host.setWatchControl('all');
  assert.equal(host._canControl(g1), true);
  assert.equal(host._canControl(g2), true);

  // Revert remote on non-timeout drop
  host.setWatchControl('guest', g1.id);
  host._drop('s1', 'leave');
  assert.equal(host.getWatchControl().mode, 'host');
  assert.equal(host.getWatchControl().holderId, null);

  // Ready check snapshot & host ready toggle
  const rcSnap = host.readyCheck();
  assert.equal(rcSnap.active, true);
  assert.equal(rcSnap.hostReady, false);
  assert.equal(rcSnap.peers.length, 2); // host + remaining g2
  g2.ready = true;
  const doneSnap = host.setHostReady(true);
  assert.equal(doneSnap.hostReady, true);
  assert.equal(doneSnap.active, false);
});

test('phase2 social: blind rating masking, timestamped party notes, and taste compatibility', () => {
  // Blind rating masking hides scores on wire until revealed
  const session = {
    sessionId: 'rate-1',
    id: 'tt0816692',
    blind: true,
    revealed: false,
    votes: {
      u1: { id: 'u1', name: 'A', score: 9, at: 100 },
      u2: { id: 'u2', name: 'B', score: 6, at: 200 },
    },
  };
  const maskedWire = maskRatingSession(session, true);
  assert.equal(maskedWire.votes.u1.submitted, true);
  assert.equal(maskedWire.votes.u1.score, null);
  assert.equal(maskedWire.votes.u2.score, null);

  const revealedSession = { ...session, revealed: true };
  assert.equal(maskRatingSession(revealedSession, true).votes.u1.score, 9);

  // Timestamped party note sanitization
  assert.equal(sanitizePartyNote({ t: -5, text: 'bad time' }), null);
  assert.equal(sanitizePartyNote({ t: 10, text: '   ' }), null);
  const longText = 'x'.repeat(300);
  const note = sanitizePartyNote({ t: 123.456, text: longText }, { id: '999', name: 'Saqr' });
  assert.equal(note.t, 123.5);
  assert.equal(note.text.length, 240);
  assert.equal(note.authorId, '999');
  assert.equal(note.authorName, 'Saqr');

  // Compatibility normalizes 1-10 vs 1-5 and respects historyHidden when empty
  assert.deepStrictEqual(
    computeFriendCompatibility({}, { historyHidden: true, favorites: [], lists: [] }),
    { pct: null, sharedGenres: [], sharedTopRated: [], commonWatched: 0 },
  );
  const me = {
    favorites: [{ id: 'tt1', type: 'movie', name: 'Film One', year: 2020, genres: ['Sci-Fi', 'Drama'] }],
    ratings: [
      { id: 'tt1', type: 'movie', name: 'Film One', year: 2020, rating: 5, genres: ['Sci-Fi'] }, // 1-5 -> 10/10
      { id: 'tt2', type: 'movie', name: 'Film Two', year: 2021, score: 8, genres: ['Drama'] },
    ],
    history: [{ id: 'tt1', type: 'movie', name: 'Film One', year: 2020 }],
  };
  const friend = {
    favorites: [{ id: 'tt1', type: 'movie', name: 'Film One', year: 2020, genres: ['Sci-Fi', 'Drama'] }],
    ratings: [
      { id: 'tt1', type: 'movie', name: 'Film One', year: 2020, score: 10, genres: ['Sci-Fi'] },
      { id: 'tt2', type: 'movie', name: 'Film Two', year: 2021, rating: 4, scale: 5, genres: ['Drama'] },
    ],
    history: [{ id: 'tt1', type: 'movie', name: 'Film One', year: 2020 }],
  };
  const compat = computeFriendCompatibility(me, friend);
  assert.ok(compat.pct >= 70 && compat.pct <= 100, `expected high compatibility, got ${compat.pct}`);
  assert.ok(compat.sharedGenres.length >= 1);
  assert.ok(compat.sharedTopRated.some((x) => x.id === 'tt1'));
  assert.ok(compat.commonWatched >= 1);
});

test('phase2 store: room presets CRUD & builtin protection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p2-store-'));
  t.after(() => {
    store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const store = new Store(dir);

  const builtins = store.roomPresets();
  assert.ok(builtins.length >= 2);
  const builtinId = builtins[0].id;
  assert.equal(store.deleteRoomPreset(builtinId), false, 'builtin presets cannot be deleted');

  const created = store.saveRoomPreset({
    name: 'Friday Horror',
    mode: 'watch',
    watchControl: 'all',
    maxRes: '1440',
    fps: 60,
    roomPin: '1234',
  });
  assert.ok(created?.id);
  assert.equal(created.builtin, false);
  assert.equal(store.roomPresets().some((p) => p.id === created.id && p.watchControl === 'all'), true);
  assert.equal(store.deleteRoomPreset(created.id), true);
  assert.equal(store.roomPresets().some((p) => p.id === created.id), false);
});

test('phase2 ytdlp: YouTube URL detection, split DASH stream resolve & SSRF guard', async () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeUrl('https://example.com/video.mp4'), false);

  const splitRes = await resolveVideoStream('https://youtu.be/dQw4w9WgXcQ', {
    exec: async () => ({
      stdout: JSON.stringify({
        title: 'Test Clip',
        duration: 42,
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        requested_formats: [
          { url: 'https://rr1---sn.googlevideo.com/videoplayback?itag=137' },
          { url: 'https://rr1---sn.googlevideo.com/videoplayback?itag=140' },
        ],
      }),
    }),
  });
  assert.equal(splitRes.url, 'https://rr1---sn.googlevideo.com/videoplayback?itag=137');
  assert.equal(splitRes.audioUrl, 'https://rr1---sn.googlevideo.com/videoplayback?itag=140');
  assert.equal(splitRes.title, 'Test Clip');

  // Loopback/private target resolved from yt-dlp output must be rejected by validatePlayUrl
  await assert.rejects(
    resolveVideoStream('https://youtu.be/dQw4w9WgXcQ', {
      exec: async () => ({
        stdout: JSON.stringify({ url: 'http://127.0.0.1:8080/secret.mp4' }),
      }),
    }),
    /no playable YouTube stream found/,
  );
});

test('phase2 sfx: module exports configureSfx/playSfx and guards playback muting', () => {
  const sfxSrc = fs.readFileSync(path.join(__dirname, '..', 'media', 'src', 'utils', 'sfx.ts'), 'utf8');
  assert.match(sfxSrc, /export function configureSfx\(/);
  assert.match(sfxSrc, /export function playSfx\(/);
  assert.match(sfxSrc, /config\.muteDuringPlayback && config\.theaterPlaying/);
});
