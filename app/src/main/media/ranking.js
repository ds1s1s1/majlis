'use strict';
// Which copy of a title to play. Releases are described in free text (Torrentio:
// "Heat.1995.1080p.BluRay.x264-SPARKS\n👤 312 💾 4.2 GB"), so the facts are parsed out of
// name / title / filename, then scored. Rules after Harbor's harbor-core/scoring.rs, minus its
// HTML5-player penalties (mpv plays DTS/TrueHD/AV1/MKV fine):
//  tier first (CAM/TS always last), instant (debrid/HTTP) over torrents, the wanted resolution,
//  healthy swarms, honest sizes, a bitrate the line can carry, the user's addon order, trusted
//  groups, Arabic subtitles/dub for an Arabic UI, and the same release as the last episode.
const ptt = require('parse-torrent-title');

const TRUSTED = /\b(FraMeSToR|NTb|FLUX|TEPES|playWEB|CMRG|KiNGS|SMURF|HONE|BHDStudio|DON|EbP|ZQ|NOGRP|SiC|TRiToN|PSA|QxR|Tigole|Joy|RARBG|SPARKS|AMIABLE|GECKOS|ROVERS)\b/i;
const LOSSY = /\b(YTS|YIFY|YTS-?AG)\b/i;
const ROUGH = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr)\b/i;
const ARABIC = /\b(arabic|ara|arab)\b|عربي|مدبلج|مترجم/i;
const RES = { '2160p': 2160, '4k': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '576p': 576, '480p': 480 };

function text(s) {
  return [s.name, s.title, s.description, s.behaviorHints?.filename].filter((x) => typeof x === 'string').join('\n');
}

// the facts that matter, from a stream object
function facts(s) {
  const t = text(s);
  // the release line ("Heat.1995.1080p.BluRay..."), not the addon's name above it
  const release = s.behaviorHints?.filename || t.split('\n').filter((l) => /\d{3,4}p|bluray|web|cam|\bts\b|telesync|screener/i.test(l)).sort((a, b) => b.length - a.length)[0] || t;
  const p = ptt.parse(release.replace(/\n/g, ' '));
  const lower = t.toLowerCase();
  let height = RES[String(p.resolution || '').toLowerCase()] || 0;
  if (!height) for (const [k, v] of Object.entries(RES)) if (lower.includes(k)) { height = v; break; }
  const num = (re) => { const m = re.exec(t); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
  const seeders = num(/👤\s*([\d,]+)/) ?? num(/seed(?:er)?s?[:\s]+([\d,]+)/i);
  const sizeM = /💾\s*([\d.,]+)\s*(GB|MB|TB)/i.exec(t) || /\b([\d.]+)\s*(GB|MB|TB)\b/i.exec(t);
  const sizeGb = s.behaviorHints?.videoSize ? s.behaviorHints.videoSize / 2 ** 30
    : sizeM ? parseFloat(sizeM[1].replace(',', '.')) * (sizeM[2].toUpperCase() === 'MB' ? 1 / 1024 : sizeM[2].toUpperCase() === 'TB' ? 1024 : 1) : null;
  const colors = (p.colorlist || [p.color]).filter(Boolean).map(String);
  return {
    height, seeders, sizeGb,
    instant: typeof s.url === 'string' && /^https?:/.test(s.url),
    torrent: typeof s.infoHash === 'string',
    cached: /\[(RD|AD|PM|TB|DL|ED|OC)\+\]|⚡|instant/i.test(t),
    rough: ROUGH.test(String(p.source || '')) || ROUGH.test(t.replace(/[._-]/g, ' ')),
    hdr: colors.some((c) => /hdr/i.test(c)), dv: colors.some((c) => /^dv$|dolby ?vision/i.test(c)) || /\bDV\b|dolby.?vision/i.test(t),
    remux: !!p.remux, audio: String(p.audio || '').toLowerCase(), codec: String(p.codec || '').toLowerCase(),
    group: p.group || (TRUSTED.exec(t)?.[1]) || null, arabic: ARABIC.test(t),
  };
}

// opts: { maxHeight, downMbps, runtimeMin, addonRank (0 = user's first addon), bingeGroup,
//         lang, debridOnly, av1 (hardware decode available) }
function score(s, f, o = {}) {
  const reasons = [];
  const add = (signal, delta) => { if (delta) reasons.push([signal, delta]); return delta; };
  if (o.debridOnly && !f.instant) return { score: -1e6, tier: 'excluded', reasons: [['debrid-only', -1e6]] };
  let v = 0;
  const tier = f.rough ? 0 : f.instant || f.cached ? 3 : f.torrent && (f.seeders ?? 0) > 0 ? 2 : 1;
  v += add('tier', tier * 1000);
  const want = o.maxHeight || 1080, h = f.height || 720;
  v += add('resolution', h <= want ? h / 20 : want / 20 - (h - want) / 40);
  if (f.hdr || f.dv) v += add('hdr', o.hdrDisplay ? 8 : -4); // SDR screens get tone-mapped HDR: fine, not better
  if (f.remux) v += add('remux', 4);
  v += add('audio', { atmos: 3, truehd: 2, 'dts-hd ma': 2, ddp: 1, 'dd+': 1 }[f.audio] || 0);
  if (f.torrent && !f.instant) v += add('seeders', f.seeders == null ? 0 : f.seeders === 0 ? -400 : Math.log2(f.seeders + 1) * 14);
  if (f.group && TRUSTED.test(f.group)) v += add('trusted-group', 10);
  if (f.group && LOSSY.test(f.group) && h >= 1080) v += add('lossy-group', -6);
  if (f.codec.includes('av1') && o.av1 === false) v += add('av1-no-hw', -30);
  // a size that can't be right for the resolution (a mislabelled release)
  const runtime = o.runtimeMin || 110;
  if (f.sizeGb != null) {
    const minGb = { 2160: 6, 1080: 1.2, 720: 0.5 }[h] * (runtime / 110);
    if (minGb && f.sizeGb < minGb * 0.5) v += add('undersized', -60);
    // an average bitrate the line can't keep up with stalls (debrid streams too)
    const mbps = (f.sizeGb * 8192) / (runtime * 60);
    if (o.downMbps && mbps > o.downMbps * 0.8) v += add('bitrate', -Math.min(300, (mbps - o.downMbps * 0.8) * 25));
  }
  if (o.addonRank != null) v += add('addon-order', Math.max(0, 12 - o.addonRank * 4));
  if (o.lang === 'ar' && f.arabic) v += add('arabic', 20);
  if (o.bingeGroup && s.behaviorHints?.bingeGroup === o.bingeGroup) v += add('same-release', 500);
  return { score: Math.round(v * 10) / 10, tier, reasons };
}

// streams from many addons -> ranked, each with { facts, score, tier, reasons }
function rank(list, o = {}) {
  return list.map((x) => { const f = facts(x.stream); return { ...x, facts: f, ...score(x.stream, f, { ...o, addonRank: x.addonRank }) }; })
    .sort((a, b) => b.score - a.score);
}

module.exports = { facts, score, rank };
