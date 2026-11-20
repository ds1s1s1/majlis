'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const vm = require('node:vm');

const { Library, reconcileSeriesResume } = require('../src/main/media/library');
const { validatePlayUrl } = require('../src/main/media/http');

const mkLib = () => {
  let saved = null;
  const l = new Library({ load: () => null, save: (s) => { saved = s; } });
  l.saved = () => saved;
  return l;
};

test('phase1 library: reconcileSeriesResume skips specials & unaired and advances resume', () => {
  const show = { id: 'tt0944947', type: 'series', name: 'Test Show' };
  const now = Date.UTC(2026, 10, 20);
  const videos = [
    { id: 'tt0944947:0:1', season: 0, episode: 1, released: '2020-01-01' },
    { id: 'tt0944947:1:1', season: 1, episode: 1, released: '2020-01-02' },
    { id: 'tt0944947:1:2', season: 1, episode: 2, released: '2020-01-09' },
    { id: 'tt0944947:1:3', season: 1, episode: 3, released: '2099-01-01' },
  ];
  const l = mkLib();
  l.setWatched(show, 'tt0944947:1:1', true);
  const item = l.get(show.id);
  reconcileSeriesResume(item, videos, now);
  assert.equal(item.state.video_id, 'tt0944947:1:2');
  assert.equal(item.state.timeOffset, 1);
  assert.equal(item.state.flaggedWatched, 0);

  l.setWatched(show, 'tt0944947:1:2', true);
  reconcileSeriesResume(item, videos, now);
  assert.equal(item.state.timeOffset, 0);
  assert.equal(item.state.flaggedWatched, 1);
});

test('phase1 library: markPrevWatched & setSeasonWatched reconcile episodes cleanly', () => {
  const show = { id: 'tt1234567', type: 'series', name: 'Marathon Show' };
  const videos = [
    { id: 'tt1234567:0:1', season: 0, episode: 1, released: '2020-01-01' },
    { id: 'tt1234567:1:1', season: 1, episode: 1, released: '2020-01-01' },
    { id: 'tt1234567:1:2', season: 1, episode: 2, released: '2020-01-08' },
    { id: 'tt1234567:1:3', season: 1, episode: 3, released: '2020-01-15' },
    { id: 'tt1234567:2:1', season: 2, episode: 1, released: '2021-01-01' },
  ];
  const l = mkLib();
  l.markPrevWatched(show, videos, 'tt1234567:1:2', true);
  assert.equal(l.isWatched(show.id, 'tt1234567:0:1'), false);
  assert.equal(l.isWatched(show.id, 'tt1234567:1:1'), true);
  assert.equal(l.isWatched(show.id, 'tt1234567:1:2'), true);
  assert.equal(l.isWatched(show.id, 'tt1234567:1:3'), false);
  assert.equal(l.get(show.id).state.video_id, 'tt1234567:1:3');

  l.setSeasonWatched(show, videos.filter((v) => v.season === 1), true, videos);
  assert.equal(l.isWatched(show.id, 'tt1234567:1:3'), true);
  assert.equal(l.get(show.id).state.video_id, 'tt1234567:2:1');
});

test('phase1 validatePlayUrl: magnet hex/base32 & public https vs blocked private/unsafe URLs', () => {
  const hexHash = 'a'.repeat(40);
  const magHex = validatePlayUrl(`magnet:?xt=urn:btih:${hexHash.toUpperCase()}&dn=Big%20Buck%20Bunny&tr=udp%3A%2F%2Ftracker.example.com%3A80`);
  assert.equal(magHex.ok, true);
  assert.equal(magHex.kind, 'magnet');
  assert.equal(magHex.infoHash, hexHash);
  assert.equal(magHex.name, 'Big Buck Bunny');
  assert.deepEqual(magHex.sources, ['tracker:udp://tracker.example.com:80']);

  // RFC-4648 base32 for 20 bytes of 0xAA ("VKVKVK...")
  const b32 = 'V'.repeat(32);
  const magB32 = validatePlayUrl(`magnet:?xt=urn:btih:${b32}`);
  assert.equal(magB32.ok, true);
  assert.equal(magB32.kind, 'magnet');
  assert.match(magB32.infoHash, /^[0-9a-f]{40}$/);

  const pubUrl = validatePlayUrl('https://cdn.example.com/movies/sample.mp4');
  assert.equal(pubUrl.ok, true);
  assert.equal(pubUrl.kind, 'http');
  assert.equal(pubUrl.name, 'sample.mp4');

  for (const bad of [
    '',
    'magnet:?dn=MissingHash',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'http://127.0.0.1/a.mp4',
    'http://localhost:8080/x.m3u8',
    'http://192.168.1.5/v.mp4',
    'http://10.0.0.1/v.mp4',
    'http://[::1]/v.mp4',
  ]) {
    const res = validatePlayUrl(bad);
    assert.equal(res.ok, false, `Expected rejection for: ${bad}`);
  }
});

test('phase1 i18n invariants: zero Arabic-Indic numerals, zero </> in ar strings, exact key parity', async () => {
  const { STR } = await import(pathToFileURL(path.join(__dirname, '../media/src/i18n.ts')).href);
  assert.deepEqual(Object.keys(STR.ar).sort(), Object.keys(STR.en).sort());
  for (const [k, val] of Object.entries(STR.ar)) {
    assert.equal(/[٠-٩]/.test(val), false, `Arabic-Indic digit in cinema STR.ar.${k}: ${val}`);
    assert.equal(/[<>]/.test(val), false, `Angle bracket in cinema STR.ar.${k}: ${val}`);
  }

  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/i18n.js'), 'utf8').replace(/\bexport\s+/g, '');
  const sandbox = { document: { documentElement: { lang: 'ar', dir: 'rtl' } }, STR: null };
  vm.runInNewContext(`${src}\n;this.STR = STR;`, sandbox);
  for (const [k, val] of Object.entries(sandbox.STR.ar)) {
    assert.equal(/[٠-٩]/.test(val), false, `Arabic-Indic digit in renderer STR.ar.${k}: ${val}`);
    assert.equal(/[<>]/.test(val), false, `Angle bracket in renderer STR.ar.${k}: ${val}`);
  }
});

test('phase1 IPC allowlist: preload exposes required cin:* channels', () => {
  const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  for (const ch of ['cin:queue-sync', 'cin:lib-mark-prev', 'cin:lib-season', 'cin:entity-catalog', 'cin:play-url']) {
    assert.equal(preloadSrc.includes(`'${ch}'`), true, `Missing ${ch} in preload ALLOWED_INVOKE`);
  }
});
