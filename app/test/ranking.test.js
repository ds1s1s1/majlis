'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { facts, rank } = require('../src/main/media/ranking');

const tor = (title, extra = {}) => ({ stream: { name: 'Torrentio\n1080p', title, infoHash: 'a'.repeat(40), ...extra }, addonRank: 0 });

test('facts: resolution, seeders, size, group, rough sources, arabic', () => {
  const f = facts({ name: 'Torrentio\n4k HDR', title: 'The.Dark.Knight.2008.2160p.UHD.BluRay.REMUX.HDR10.TrueHD.Atmos-FraMeSToR\n👤 312 💾 58.2 GB ⚙️ TPB', infoHash: 'a'.repeat(40) });
  assert.deepStrictEqual([f.height, f.seeders, Math.round(f.sizeGb), f.group, f.remux, f.hdr, f.rough], [2160, 312, 58, 'FraMeSToR', true, true, false]);
  assert.ok(facts({ title: 'Film.2026.HDCAM.x264\n👤 900' }).rough);
  assert.ok(facts({ title: 'Heat 1995 1080p WEB Arabic subs' }).arabic);
  assert.ok(facts({ name: '[RD+] Torrentio', title: 'x 1080p', url: 'https://x/y.mkv' }).instant);
});

test('rank: playable now beats pretty; CAM always last; dead swarms sink', () => {
  const r = rank([
    tor('Film.2026.1080p.WEB-DL.x264-GRP\n👤 0 💾 3 GB'),
    tor('Film.2026.HDCAM.1080p\n👤 2000 💾 2 GB'),
    tor('Film.2026.1080p.WEB-DL.x264-GRP\n👤 150 💾 3 GB'),
    { stream: { name: '[RD+] Torrentio', title: 'Film.2026.720p.WEB\n💾 1.4 GB', url: 'https://x/a.mkv' }, addonRank: 0 },
  ], { maxHeight: 1080, downMbps: 30 });
  assert.match(r[0].stream.title, /720p/, 'instant first');
  assert.match(r[1].stream.title, /👤 150/);
  assert.match(r.at(-1).stream.title, /HDCAM/);
});

test('rank: the line decides; the same release as last episode wins; arabic for arabic UI', () => {
  const big = tor('Film.2026.2160p.BluRay.REMUX\n👤 500 💾 70 GB'), small = tor('Film.2026.1080p.BluRay.x264\n👤 300 💾 9 GB');
  assert.match(rank([big, small], { maxHeight: 2160, downMbps: 15 })[0].stream.title, /1080p/, 'a 70 GB file over 15 Mbps stalls');
  const a = tor('Show.S01E02.1080p.WEB\n👤 80', { behaviorHints: { bingeGroup: 'g1' } }), b = tor('Show.S01E02.1080p.WEB\n👤 900', { behaviorHints: { bingeGroup: 'g2' } });
  assert.strictEqual(rank([b, a], { bingeGroup: 'g1' })[0].stream.behaviorHints.bingeGroup, 'g1');
  const ar = tor('Film 2026 1080p WEB Arabic\n👤 100'), en = tor('Film 2026 1080p WEB\n👤 120');
  assert.match(rank([en, ar], { lang: 'ar' })[0].stream.title, /Arabic/);
  assert.ok(rank([tor('x 1080p\n👤 10')], { debridOnly: true })[0].score < 0);
});
