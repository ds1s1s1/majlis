'use strict';
// Which copy of a title to play. Releases are described in free text (Torrentio:
// "Heat.1995.1080p.BluRay.x264-SPARKS\n👤 312 💾 4.2 GB"), so the facts are parsed out of
// name / title / filename, then scored. Rules after Harbor's harbor-core/scoring.rs, minus its
// HTML5-player penalties (mpv plays DTS/TrueHD/AV1/MKV fine):
//  tier first (CAM/TS always last), instant (debrid cached/HTTP) over torrents, the wanted
//  resolution, HDR/DV matched to display capability, healthy swarms, honest sizes, a bitrate
//  the slowest viewer's line can carry, audio (Atmos/TrueHD/AAC, Arabic dub), embedded subtitle
//  languages, the user's addon order, trusted groups, and the same release as the last episode.
const ptt = require('parse-torrent-title');

const TRUSTED = /\b(FraMeSToR|NTb|FLUX|TEPES|playWEB|CMRG|KiNGS|SMURF|HONE|BHDStudio|DON|EbP|ZQ|NOGRP|SiC|TRiToN|PSA|QxR|Tigole|Joy|RARBG|SPARKS|AMIABLE|GECKOS|ROVERS|SubsPlease|Erai-raws)\b/i;
const LOSSY = /\b(YTS|YIFY|YTS-?AG)\b/i;
const ROUGH = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr)\b/i;
const ARABIC = /\b(arabic|ara|arab)\b|عربي|مدبلج|مترجم|🇸🇦|🇪🇬|🇦🇪|🇰🇼|🇶🇦|🇯🇴|🇲🇦/i;
const ARABIC_DUB = /مدبلج|\b(ar|ara|arabic)[\s._-]*(dub|dubbed|audio)\b|\bdub(?:bed)?[\s._-]*(ar|ara|arabic)\b/i;
const RES = { '2160p': 2160, '4k': 2160, 'uhd': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '576p': 576, '480p': 480 };

const LANG_PATTERNS = [
  ['ar', /\b(arabic|ara|arab)\b|عربي|مترجم|مدبلج|🇸🇦|🇪🇬|🇦🇪|🇰🇼|🇶🇦|🇯🇴|🇲🇦/i],
  ['en', /\b(english|eng)\b|🇬🇧|🇺🇸|🇨🇦|🇦🇺/i],
  ['fr', /\b(french|fre|fra|vff|vfq|vostfr)\b|🇫🇷/i],
  ['es', /\b(spanish|spa|esp|latino|castellano)\b|🇪🇸|🇲🇽/i],
  ['de', /\b(german|ger|deu)\b|🇩🇪/i],
  ['tr', /\b(turkish|tur)\b|🇹🇷/i],
  ['ja', /\b(japanese|jpn|jap)\b|🇯🇵/i],
  ['ru', /\b(russian|rus)\b|🇷🇺/i],
  ['pt', /\b(portuguese|por|ptbr|dublado)\b|🇧🇷|🇵🇹/i],
  ['it', /\b(italian|ita)\b|🇮🇹/i],
  ['hi', /\b(hindi|hin)\b|🇮🇳/i],
  ['ko', /\b(korean|kor)\b|🇰🇷/i],
  ['zh', /\b(chinese|chi|chn|zho|mandarin|cantonese)\b|🇨🇳|🇹🇼|🇭🇰/i],
];

const ISO3_TO_2 = { ara: 'ar', ar: 'ar', eng: 'en', en: 'en', fre: 'fr', fra: 'fr', fr: 'fr', spa: 'es', esp: 'es', es: 'es', ger: 'de', deu: 'de', de: 'de', tur: 'tr', tr: 'tr', jpn: 'ja', ja: 'ja', rus: 'ru', ru: 'ru', por: 'pt', pt: 'pt', ita: 'it', it: 'it', hin: 'hi', hi: 'hi', kor: 'ko', ko: 'ko', chi: 'zh', zho: 'zh', zh: 'zh' };

function normLang(code) {
  const c = String(code || '').trim().toLowerCase();
  return ISO3_TO_2[c] || c.slice(0, 2);
}

function detectAudio(pAudio, t) {
  if (/\batmos\b/i.test(t) || /atmos/i.test(pAudio)) return 'atmos';
  if (/\btrue[\s._-]?hd\b/i.test(t) || /truehd/i.test(pAudio)) return 'truehd';
  if (/\bdts[\s._-]?hd[\s._-]?ma\b/i.test(t) || /dts-hd ma/i.test(pAudio)) return 'dts-hd ma';
  if (/\bdts[\s._-]?x\b/i.test(t)) return 'dts-x';
  if (/\bdts[\s._-]?hd\b/i.test(t)) return 'dts-hd';
  if (/\b(ddp|dd\+|e-?ac-?3)\b/i.test(t) || /^(ddp|dd\+|eac3)$/i.test(pAudio)) return 'ddp';
  if (/\bdts\b/i.test(t) || /^dts$/i.test(pAudio)) return 'dts';
  if (/\bflac\b/i.test(t) || /flac/i.test(pAudio)) return 'flac';
  if (/\b(ac-?3|dd5\.?1|dolby\s*digital)\b/i.test(t) || /^ac3$/i.test(pAudio)) return 'ac3';
  if (/\bopus\b/i.test(t) || /opus/i.test(pAudio)) return 'opus';
  if (/\baac\b/i.test(t) || /aac/i.test(pAudio)) return 'aac';
  return String(pAudio || '').toLowerCase();
}

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
  const seeders = num(/👤\s*([\d,]+)/) ?? num(/👥\s*([\d,]+)/) ?? num(/seed(?:er)?s?[:\s]+([\d,]+)/i);
  const sizeM = /💾\s*([\d.,]+)\s*(GB|MB|TB|GiB|MiB)/i.exec(t) || /\b([\d.]+)\s*(GB|MB|TB|GiB|MiB)\b/i.exec(t);
  const unit = sizeM ? sizeM[2].toUpperCase() : '';
  const sizeGb = s.behaviorHints?.videoSize ? s.behaviorHints.videoSize / 2 ** 30
    : sizeM ? parseFloat(sizeM[1].replace(',', '.')) * (unit === 'MB' || unit === 'MIB' ? 1 / 1024 : unit === 'TB' ? 1024 : 1) : null;
  const colors = (p.colorlist || [p.color]).filter(Boolean).map(String);
  const uncachedDebrid = /\[(RD|AD|PM|TB|DL|ED|OC)\s*(download|⏳|-)\]|⏳\s*(download|uncached)/i.test(t);
  const cached = !uncachedDebrid && !!(s.behaviorHints?.cached || /\[(RD|AD|PM|TB|DL|ED|OC)[+\u26a1]\]|⚡|\binstant\b|\bcached\b/i.test(t));
  const subLangs = [];
  for (const [code, rx] of LANG_PATTERNS) if (rx.test(t)) subLangs.push(code);
  if (Array.isArray(s.subtitles)) {
    for (const sub of s.subtitles) {
      const c = normLang(sub?.lang);
      if (c && !subLangs.includes(c)) subLangs.push(c);
    }
  }
  const multiSubs = /\b(multi(?:[\s._-]?subs?)?|dual[\s._-]?audio)\b/i.test(t);
  const channels = (/\b(7\.1|5\.1|2\.0)\b/.exec(t)?.[1]) || p.channels || null;
  const seMatch = /\bs(\d{1,2})e(\d{1,3})\b/i.exec(release);
  const season = p.season ?? (seMatch ? +seMatch[1] : null);
  const episode = p.episode ?? (seMatch ? +seMatch[2] : null);
  const archive = ['rarUrls', 'zipUrls', '7zipUrls', 'tgzUrls', 'tarUrls'].some((k) => Array.isArray(s[k]) && s[k].length > 0);
  const external = !!s.externalUrl && !s.url && !s.infoHash && !archive;
  return {
    height, seeders, sizeGb,
    instant: typeof s.url === 'string' && /^https?:/.test(s.url),
    torrent: typeof s.infoHash === 'string',
    cached,
    uncachedDebrid,
    archive,
    external,
    rough: ROUGH.test(String(p.source || '')) || ROUGH.test(t.replace(/[._-]/g, ' ')),
    hdr: colors.some((c) => /hdr/i.test(c)) || /\bhdr(?:10\+?)?\b/i.test(t),
    dv: colors.some((c) => /^dv$|dolby ?vision/i.test(c)) || /\b(DV|dovi)\b|dolby.?vision/i.test(t),
    remux: !!p.remux,
    audio: detectAudio(p.audio, t),
    channels,
    codec: String(p.codec || '').toLowerCase() || (/\b(hevc|x265|h\.?265)\b/i.test(t) ? 'hevc' : /\bav1\b/i.test(t) ? 'av1' : /\b(h\.?264|x264|avc)\b/i.test(t) ? 'h264' : ''),
    group: p.group || (TRUSTED.exec(t)?.[1]) || null,
    arabic: ARABIC.test(t),
    arabicDub: ARABIC_DUB.test(t),
    subLangs,
    multiSubs,
    season,
    episode,
    seasonPack: Array.isArray(p.seasons) && p.seasons.length > 0 && episode == null,
  };
}

const ARCHIVE_RE = /\.(rar|zip|7z|tar|tgz|gz|iso|exe|msi|bat|scr)(\?|$)/i;

// Trust Gate: rejects unsafe/non-video payloads, episode mismatches, and uncorroborated 0-seed swarms
function trustGate(s, f, o = {}, corroborationCount = 1) {
  if (o.safetyFilter === 'off') {
    return { trusted: true, corroborated: corroborationCount >= 2, reason: null };
  }
  const fn = String(s.behaviorHints?.filename || s.url || '');
  if (ARCHIVE_RE.test(fn) && !s.ytId && !f.archive) {
    return { trusted: false, corroborated: false, reason: 'non-video-archive' };
  }
  if (o.season != null && o.episode != null && f.season != null && f.episode != null && !f.seasonPack) {
    if (f.season !== +o.season || f.episode !== +o.episode) {
      return { trusted: false, corroborated: false, reason: 'episode-mismatch' };
    }
  }
  if (f.torrent && !f.instant && !f.cached && !f.uncachedDebrid && f.seeders === 0) {
    if (corroborationCount >= 2 || o.safetyFilter === 'balanced') {
      return { trusted: true, corroborated: corroborationCount >= 2, reason: corroborationCount >= 2 ? 'corroborated-rescue' : null };
    }
    return { trusted: false, corroborated: false, reason: 'zero-seeders' };
  }
  return { trusted: true, corroborated: corroborationCount >= 2, reason: null };
}

function normPriorityCat(label) {
  const s = String(label || '').toLowerCase();
  if (/debrid/.test(s)) return 'Debrid';
  if (/server|home/.test(s)) return 'Server';
  if (/direct|http/.test(s)) return 'Direct';
  if (/torrent|addon|indexer/.test(s)) return 'Addon';
  return null;
}

function sourceCategoryOf(item, f) {
  const url = String(item?.addon?.url || '');
  if (url.startsWith('homeserver://') || item?.stream?.majlisLocalFile || item?.stream?.majlisDownload) return 'Server';
  if (f.cached || (f.instant && f.torrent)) return 'Debrid';
  if (f.instant && !f.torrent) return 'Direct';
  return 'Addon';
}

function tier8Of(f, trust) {
  if (f.rough) return 8;
  const ready = (f.instant && !f.uncachedDebrid) || f.cached;
  if (ready) return f.height >= 2160 ? 1 : f.height >= 1080 ? 2 : 3;
  if (f.torrent && (f.seeders ?? 0) > 0) return f.height >= 2160 ? 4 : f.height >= 1080 ? 5 : 6;
  return trust?.trusted ? 7 : 8;
}

function byTier(a, b) {
  return (a.tier8 - b.tier8) || (b.score - a.score);
}

// opts: { maxHeight, downMbps, partyMinMbps, runtimeMin, addonRank (0 = user's first addon),
//         bingeGroup, lang, subLang2, debridOnly, av1 (hardware decode available), hdrDisplay, season, episode }
function score(s, f, o = {}) {
  const reasons = [];
  const add = (signal, delta) => { if (delta) reasons.push([signal, delta]); return delta; };
  if (o.debridOnly && !f.instant && !f.cached) return { score: -1e6, tier: 'excluded', reasons: [['debrid-only', -1e6]] };
  const rules = o.rules && typeof o.rules === 'object' ? o.rules : null;
  if (rules) {
    if (rules.blockCamTs && f.rough) return { score: -1e6, tier: 'excluded', reasons: [['rule:block-cam-ts', -1e6]] };
    if (Number(rules.maxSizeGb) > 0 && f.sizeGb != null && f.sizeGb > Number(rules.maxSizeGb)) {
      return { score: -1e6, tier: 'excluded', reasons: [['rule:max-size', -1e6]] };
    }
    if (typeof rules.excludeKeywords === 'string' && rules.excludeKeywords.trim()) {
      const low = text(s).toLowerCase();
      const kws = rules.excludeKeywords.split(/[,،\n]+/).map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (kws.some((k) => low.includes(k))) {
        return { score: -1e6, tier: 'excluded', reasons: [['rule:keyword-excluded', -1e6]] };
      }
    }
  }
  let v = 0;
  const tier = f.rough ? 0 : (f.instant && !f.uncachedDebrid) || f.cached ? 3 : f.torrent && (f.seeders ?? 0) > 0 ? 2 : 1;
  v += add('tier', tier * 1000);
  if (f.cached) v += add('debrid-cached', 35);
  else if (f.uncachedDebrid) v += add('debrid-uncached', -250);
  const want = o.maxHeight || 1080, h = f.height || 720;
  v += add('resolution', h <= want ? h / 20 : want / 20 - (h - want) / 40);
  if (f.hdr || f.dv) {
    // HDR screens prefer hybrid DV+HDR10 or HDR10; SDR screens get spline tone-mapped HDR10, while pure DV is penalized more
    const hdrDelta = o.hdrDisplay ? (f.hdr && f.dv ? 16 : f.hdr ? 12 : 10) : (f.dv && !f.hdr ? -12 : -4);
    v += add('hdr', hdrDelta);
  }
  if (f.remux) v += add('remux', 4);
  v += add('audio', { atmos: 8, truehd: 6, 'dts-hd ma': 6, 'dts-x': 6, 'dts-hd': 4, dts: 3, ddp: 3, 'dd+': 3, eac3: 3, flac: 3, ac3: 2, aac: 1 }[f.audio] || 0);
  if (f.torrent && !f.instant && !f.cached) {
    v += add('seeders', f.seeders == null ? 0 : f.seeders === 0 ? -400 : f.seeders < 5 ? -35 + f.seeders * 5 : Math.log2(f.seeders + 1) * 14);
  }
  if (f.group && TRUSTED.test(f.group)) v += add('trusted-group', 10);
  if (f.group && LOSSY.test(f.group) && h >= 1080) v += add('lossy-group', -6);
  if (f.codec.includes('av1') && o.av1 === false) v += add('av1-no-hw', -30);
  // a size that can't be right for the resolution (a mislabelled release)
  const runtime = o.runtimeMin || 110;
  const lines = [o.downMbps, o.partyMinMbps].filter((x) => Number.isFinite(x) && x > 0);
  const effectiveMbps = lines.length ? Math.min(...lines) : 0;
  if (f.sizeGb != null) {
    const minGb = { 2160: 6, 1080: 1.2, 720: 0.5 }[h] * (runtime / 110);
    if (minGb && f.sizeGb < minGb * 0.5) v += add('undersized', -60);
    // an average bitrate the slowest viewer's line can't keep up with stalls (debrid streams too)
    const mbps = (f.sizeGb * 8192) / (runtime * 60);
    f.bitrateMbps = Math.round(mbps * 10) / 10;
    if (effectiveMbps && mbps > effectiveMbps * 0.8) v += add('bitrate', -Math.min(350, (mbps - effectiveMbps * 0.8) * 25));
  }
  if (o.addonRank != null) v += add('addon-order', Math.max(0, 12 - o.addonRank * 4));
  const pLang = normLang(o.lang || 'ar');
  const sLang = o.subLang2 ? normLang(o.subLang2) : (pLang === 'ar' ? 'en' : '');
  if (pLang === 'ar' && f.arabicDub) v += add('arabic-dub', 25);
  if (pLang === 'ar' && f.arabic) v += add('arabic', 20);
  if (Array.isArray(f.subLangs)) {
    if (f.subLangs.includes(pLang)) v += add('sub-lang', 12);
    else if (sLang && f.subLangs.includes(sLang)) v += add('sub-lang2', 6);
    else if (f.multiSubs) v += add('multi-subs', 4);
  }
  if (o.bingeGroup && s.behaviorHints?.bingeGroup === o.bingeGroup) v += add('same-release', 500);
  if (rules) {
    if (rules.preferHevc && /hevc|265/.test(f.codec)) v += add('rule:prefer-hevc', 45);
    if (rules.prefer4kHdr && f.height >= 2160 && (f.hdr || f.dv)) v += add('rule:prefer-4k-hdr', 55);
  }
  return { score: Math.round(v * 10) / 10, tier, reasons };
}

function sigFor(s) {
  if (s.infoHash) return `ih:${String(s.infoHash).toLowerCase()}:${s.fileIdx ?? ''}`;
  const fn = s.behaviorHints?.filename;
  if (fn) return `fn:${String(fn).toLowerCase()}`;
  return null;
}

// streams from many addons -> ranked, each with { facts, score, tier, tier8, trusted, trustReason, corroborated, reasons }
function rank(list, o = {}) {
  const sigAddons = new Map();
  for (const x of list) {
    const k = sigFor(x.stream);
    if (!k) continue;
    if (!sigAddons.has(k)) sigAddons.set(k, new Set());
    sigAddons.get(k).add(x.addon?.url || x.addon?.name || String(x.addonRank ?? 0));
  }
  const priorityOrder = Array.isArray(o.streamPriorityOrder)
    ? [...new Set(o.streamPriorityOrder.map(normPriorityCat).filter(Boolean))]
    : [];
  const ranked = list.map((x, origIdx) => {
    const f = facts(x.stream);
    const k = sigFor(x.stream);
    const corrCount = k ? sigAddons.get(k).size : 1;
    const trust = trustGate(x.stream, f, o, corrCount);
    const sc = score(x.stream, f, { ...o, addonRank: x.addonRank });
    if (priorityOrder.length && sc.tier !== 'excluded') {
      const cat = sourceCategoryOf(x, f);
      const pIdx = priorityOrder.indexOf(cat);
      if (pIdx >= 0) {
        const delta = (priorityOrder.length - pIdx) * 35;
        sc.score = Math.round((sc.score + delta) * 10) / 10;
        sc.reasons.push(['source-priority', delta]);
      }
    }
    if (trust.corroborated) {
      sc.score = Math.round((sc.score + 45) * 10) / 10;
      sc.reasons.push(['corroboration-rescue', 45]);
    }
    if (!trust.trusted && o.safetyFilter !== 'off') {
      const pen = trust.reason === 'zero-seeders' ? -200 : -2000;
      sc.score = Math.round((sc.score + pen) * 10) / 10;
      sc.reasons.push([`untrusted:${trust.reason}`, pen]);
    }
    const tier8 = tier8Of(f, trust);
    return { ...x, facts: f, ...sc, tier8, trusted: trust.trusted, trustReason: trust.reason, corroborated: trust.corroborated, _origIdx: origIdx };
  });
  if (o.resultOrder === 'addon') {
    ranked.sort((a, b) => {
      const aBinge = o.bingeGroup && a.stream?.behaviorHints?.bingeGroup === o.bingeGroup ? 1 : 0;
      const bBinge = o.bingeGroup && b.stream?.behaviorHints?.bingeGroup === o.bingeGroup ? 1 : 0;
      if (bBinge !== aBinge) return bBinge - aBinge;
      const aSafe = a.trusted === false || a.score <= -1e5 ? 1 : 0;
      const bSafe = b.trusted === false || b.score <= -1e5 ? 1 : 0;
      if (aSafe !== bSafe) return aSafe - bSafe;
      return ((a.addonRank ?? 0) - (b.addonRank ?? 0)) || (a._origIdx - b._origIdx);
    });
  } else {
    ranked.sort((a, b) => b.score - a.score);
  }
  return ranked.map(({ _origIdx, ...rest }) => rest);
}

module.exports = { facts, score, rank, trustGate, byTier, sourceCategoryOf };

