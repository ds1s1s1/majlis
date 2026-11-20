'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { facts, rank } = require('../src/main/media/ranking');

const tor = (title, extra = {}) => ({ stream: { name: 'Torrentio\n1080p', title, infoHash: 'a'.repeat(40), ...extra }, addonRank: 0 });

test('facts: resolution, seeders, size, group, rough sources, arabic, audio, hdr/dv, subLangs', () => {
  const f = facts({ name: 'Torrentio\n4k HDR', title: 'The.Dark.Knight.2008.2160p.UHD.BluRay.REMUX.HDR10.TrueHD.Atmos-FraMeSToR\n👤 312 💾 58.2 GB ⚙️ TPB', infoHash: 'a'.repeat(40) });
  assert.deepStrictEqual([f.height, f.seeders, Math.round(f.sizeGb), f.group, f.remux, f.hdr, f.rough, f.audio], [2160, 312, 58, 'FraMeSToR', true, true, false, 'atmos']);
  assert.ok(facts({ title: 'Film.2026.HDCAM.x264\n👤 900' }).rough);
  assert.ok(facts({ title: 'Heat 1995 1080p WEB Arabic subs' }).arabic);
  assert.ok(facts({ title: 'Anime.2026.1080p.WEB.مدبلج.عربي' }).arabicDub);
  assert.ok(facts({ name: '[RD+] Torrentio', title: 'x 1080p', url: 'https://x/y.mkv' }).instant);
  assert.ok(facts({ name: '[RD+] Torrentio', title: 'x 1080p', url: 'https://x/y.mkv' }).cached);
  assert.ok(facts({ name: '[RD download] Torrentio', title: 'x 1080p', url: 'https://x/y.mkv' }).uncachedDebrid);
  const subs = facts({ title: 'Film.2026.1080p.BluRay.Multi-Subs\n🇸🇦 🇬🇧 🇫🇷' });
  assert.ok(subs.subLangs.includes('ar') && subs.subLangs.includes('en') && subs.subLangs.includes('fr'));
  assert.ok(subs.multiSubs);
});

test('rank: playable now beats pretty; CAM always last; dead swarms sink; cached debrid beats uncached', () => {
  const r = rank([
    tor('Film.2026.1080p.WEB-DL.x264-GRP\n👤 0 💾 3 GB'),
    tor('Film.2026.HDCAM.1080p\n👤 2000 💾 2 GB'),
    tor('Film.2026.1080p.WEB-DL.x264-GRP\n👤 150 💾 3 GB'),
    { stream: { name: '[RD download] Torrentio', title: 'Film.2026.1080p.WEB\n💾 3 GB', url: 'https://x/u.mkv' }, addonRank: 0 },
    { stream: { name: '[RD+] Torrentio', title: 'Film.2026.720p.WEB\n💾 1.4 GB', url: 'https://x/a.mkv' }, addonRank: 0 },
  ], { maxHeight: 1080, downMbps: 30 });
  assert.match(r[0].stream.title, /720p/, 'cached instant first');
  assert.match(r[1].stream.title, /👤 150/, 'healthy swarm beats uncached debrid download');
  assert.match(r.at(-1).stream.title, /HDCAM/);
});

test('rank: the line and slowest party viewer decide; same release wins; arabic dub/subs for arabic UI', () => {
  const big = tor('Film.2026.2160p.BluRay.REMUX\n👤 500 💾 70 GB'), small = tor('Film.2026.1080p.BluRay.x264\n👤 300 💾 9 GB');
  assert.match(rank([big, small], { maxHeight: 2160, downMbps: 15 })[0].stream.title, /1080p/, 'a 70 GB file over 15 Mbps stalls');
  // host has 100 Mbps, but a party guest has 14 Mbps: slowest viewer wins
  assert.match(rank([big, small], { maxHeight: 2160, downMbps: 100, partyMinMbps: 14 })[0].stream.title, /1080p/, 'slowest party viewer caps bitrate');
  const a = tor('Show.S01E02.1080p.WEB\n👤 80', { behaviorHints: { bingeGroup: 'g1' } }), b = tor('Show.S01E02.1080p.WEB\n👤 900', { behaviorHints: { bingeGroup: 'g2' } });
  assert.strictEqual(rank([b, a], { bingeGroup: 'g1' })[0].stream.behaviorHints.bingeGroup, 'g1');
  const ar = tor('Film 2026 1080p WEB Arabic\n👤 100'), en = tor('Film 2026 1080p WEB\n👤 120');
  assert.match(rank([en, ar], { lang: 'ar' })[0].stream.title, /Arabic/);
  const dub = tor('Film 2026 1080p WEB مدبلج عربي\n👤 90');
  assert.match(rank([ar, dub], { lang: 'ar' })[0].stream.title, /مدبلج/, 'Arabic dub scores above plain sub');
  assert.ok(rank([tor('x 1080p\n👤 10')], { debridOnly: true })[0].score < 0);
});

test('rank: HDR/DV vs display capability, audio tiers (Atmos > TrueHD > AAC), and embedded subtitle languages', () => {
  const hdr = tor('Film.2026.2160p.WEB-DL.DV.HDR10.HEVC\n👤 200 💾 15 GB');
  const dvOnly = tor('Film.2026.2160p.WEB-DL.DV.HEVC\n👤 200 💾 15 GB');
  const sdr = tor('Film.2026.2160p.WEB-DL.HEVC\n👤 200 💾 15 GB');
  assert.strictEqual(rank([sdr, dvOnly, hdr], { maxHeight: 2160, hdrDisplay: true })[0].stream, hdr.stream, 'HDR display prefers hybrid DV+HDR10');
  const onSdr = rank([hdr, dvOnly, sdr], { maxHeight: 2160, hdrDisplay: false });
  assert.strictEqual(onSdr[0].stream, sdr.stream, 'SDR display prefers native SDR');
  assert.strictEqual(onSdr[2].stream, dvOnly.stream, 'pure DV without HDR10 fallback is last on SDR');

  const atmos = tor('Film.2026.1080p.BluRay.TrueHD.Atmos\n👤 150 💾 8 GB');
  const aac = tor('Film.2026.1080p.BluRay.AAC\n👤 150 💾 8 GB');
  assert.strictEqual(rank([aac, atmos], { maxHeight: 1080 })[0].stream, atmos.stream, 'Atmos beats AAC');

  const withEnSub = tor('Film.2026.1080p.WEB\n👤 100 🇬🇧'), noSub = tor('Film.2026.1080p.WEB\n👤 100');
  assert.strictEqual(rank([noSub, withEnSub], { lang: 'ar', subLang2: 'eng' })[0].stream, withEnSub.stream, 'embedded secondary subtitle language breaks tie');
});

