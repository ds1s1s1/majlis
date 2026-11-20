'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WatchedBitField } = require('../src/main/media/watched-bitfield');
const { Library } = require('../src/main/media/library');
const { rank, trustGate, byTier } = require('../src/main/media/ranking');

test('WatchedBitField encode, parse, toggle, and full-season checks round-trip cleanly', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `tt1234567:1:${i + 1}`);
  const watchedSet = new Set(['tt1234567:1:1', 'tt1234567:1:5', 'tt1234567:1:12']);
  const encoded = WatchedBitField.fromWatchedSet(ids, watchedSet, 'tt1234567:1:5').serialize();

  const decoded = WatchedBitField.parse(encoded, ids);
  assert.equal(decoded.lastVideoId, 'tt1234567:1:5');
  assert.equal(decoded.get('tt1234567:1:1'), true);
  assert.equal(decoded.get('tt1234567:1:2'), false);
  assert.equal(decoded.get('tt1234567:1:12'), true);
  assert.equal(decoded.isFullyWatched(), false);

  for (const id of ids) decoded.set(id, true);
  assert.equal(decoded.isFullyWatched(), true);
});

test('Library 121s placeholder duration guard prevents premature completion', () => {
  let saved = null;
  const lib = new Library({ load: () => ({}), save: (s) => { saved = s; } });
  const meta = { id: 'tt0000111', type: 'movie', name: 'Test Film' };

  // Placeholder stream duration of 60s (< 121s): even watching 55s (> 70%) must NOT mark watched
  lib.progress(meta, 'tt0000111', 55000, 60000, 55000);
  assert.equal(lib.isWatched('tt0000111', 'tt0000111'), false);

  // Real feature duration (7200s): placeholder 60s was not locked permanently; updating real duration works
  lib.progress(meta, 'tt0000111', 5500000, 7200000, 50000);
  const item = lib.get('tt0000111');
  assert.equal(item.state.duration, 7200000);
  clearTimeout(lib.timer);
});

test('ranking trustGate, Early-Leak Corroboration Rescue, and byTier behave deterministically', () => {
  const archiveStream = {
    name: 'Torrentio',
    title: 'Movie.2026.rar',
    infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    behaviorHints: { filename: 'Movie.2026.rar' },
  };
  const arGate = trustGate(archiveStream, { torrent: true, instant: false, cached: false, seeders: 10 }, {});
  assert.equal(arGate.trusted, false);
  assert.equal(arGate.reason, 'non-video-archive');

  // Uncorroborated 0-seed torrent rejected, but corroborated (>= 2 addons) rescues
  const zeroSeed = {
    stream: { name: 'A', title: 'Show.S01E01.1080p.WEB-DL\n👤 0 💾 2.0 GB', infoHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', behaviorHints: { filename: 'Show.S01E01.1080p.WEB-DL.mkv' } },
    addon: { url: 'https://addon1/manifest.json', name: 'A' },
    addonRank: 0,
  };
  const soloRanked = rank([zeroSeed], { maxHeight: 1080 });
  assert.equal(soloRanked[0].trusted, false);
  assert.equal(soloRanked[0].trustReason, 'zero-seeders');

  const rescuedRanked = rank([
    zeroSeed,
    { ...zeroSeed, addon: { url: 'https://addon2/manifest.json', name: 'B' }, addonRank: 1 },
  ], { maxHeight: 1080 });
  assert.equal(rescuedRanked[0].trusted, true);
  assert.equal(rescuedRanked[0].corroborated, true);

  // byTier puts tier8 = 1 (instant 4K) ahead of tier8 = 8 (HDCAM)
  const items = rank([
    { stream: { name: 'Cam', title: 'Film.2026.HDCAM.mp4', url: 'https://cdn.example/cam.mp4' }, addon: { url: 'a', name: 'A' }, addonRank: 0 },
    { stream: { name: 'Debrid', title: '⚡ Film.2026.2160p.WEB-DL.mkv', url: 'https://cdn.example/4k.mkv' }, addon: { url: 'b', name: 'B' }, addonRank: 1 },
  ], { maxHeight: 2160 }).sort(byTier);
  assert.equal(items[0].tier8, 1);
  assert.equal(items[1].tier8, 8);
});
