'use strict';
// External live subtitle search (Wyzie, SubDL, OpenSubtitles REST + loaded addons)
// with HTTPS-only URL validation and Arabic-first prioritization.
const http = require('./http');
const { isPrivateHost } = http;

function cleanSubUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    if (isPrivateHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normLang(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'ara' || s === 'arabic') return 'ar';
  if (s === 'eng' || s === 'english') return 'en';
  return s || 'ar';
}

async function queryWyzie({ imdbId, season, episode, lang, fetchFn }) {
  if (!/^tt\d+$/.test(String(imdbId || ''))) return [];
  const p = new URLSearchParams({ id: imdbId });
  if (season && episode) {
    p.set('season', String(season));
    p.set('episode', String(episode));
  }
  if (lang && lang !== 'all') p.set('language', normLang(lang));
  const r = await fetchFn(`https://sub.wyzie.ru/search?${p}`, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) return [];
  const list = await r.json();
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const url = cleanSubUrl(item.url);
    if (!url) return null;
    return {
      id: String(item.id || url),
      url,
      lang: item.language || normLang(lang),
      label: String(item.display || item.release || item.fileName || 'Wyzie').slice(0, 120),
      addon: 'Wyzie',
      format: item.format || 'srt',
      hi: !!item.isHearingImpaired,
    };
  }).filter(Boolean);
}

async function querySubDl({ imdbId, query, season, episode, lang, apiKey, fetchFn }) {
  if (!apiKey) return [];
  const p = new URLSearchParams({ api_key: apiKey });
  if (/^tt\d+$/.test(String(imdbId || ''))) p.set('imdb_id', imdbId);
  else if (query) p.set('film_name', query);
  else return [];
  if (season && episode) {
    p.set('season_number', String(season));
    p.set('episode_number', String(episode));
  }
  p.set('languages', lang && lang !== 'all' ? normLang(lang).toUpperCase() : 'AR,EN');
  const r = await fetchFn(`https://api.subdl.com/api/v1/subtitles?${p}`, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) return [];
  const data = await r.json();
  const list = Array.isArray(data?.subtitles) ? data.subtitles : [];
  return list.map((item) => {
    const rawUrl = item.url ? (String(item.url).startsWith('http') ? item.url : `https://dl.subdl.com/subtitle/${String(item.url).replace(/^\/+/, '')}`) : '';
    const url = cleanSubUrl(rawUrl);
    if (!url) return null;
    return {
      id: url,
      url,
      lang: normLang(item.lang || item.language || lang),
      label: String(item.release_name || item.name || 'SubDL').slice(0, 120),
      addon: 'SubDL',
      hi: !!item.hi,
    };
  }).filter(Boolean);
}

async function queryOpenSubtitles({ imdbId, query, season, episode, lang, apiKey, fetchFn }) {
  if (!apiKey) return [];
  const p = new URLSearchParams();
  if (/^tt\d+$/.test(String(imdbId || ''))) p.set('imdb_id', String(imdbId).replace(/^tt/i, ''));
  if (query) p.set('query', query);
  if (!p.toString()) return [];
  if (season && episode) {
    p.set('season_number', String(season));
    p.set('episode_number', String(episode));
  }
  p.set('languages', lang && lang !== 'all' ? normLang(lang) : 'ar,en');
  const r = await fetchFn(`https://api.opensubtitles.com/api/v1/subtitles?${p}`, {
    headers: { 'Api-Key': apiKey, 'User-Agent': 'Majlis v0.6' },
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok) return [];
  const body = await r.json();
  const list = Array.isArray(body?.data) ? body.data : [];
  const out = [];
  for (const row of list.slice(0, 12)) {
    const fileId = row?.attributes?.files?.[0]?.file_id;
    const direct = cleanSubUrl(row?.attributes?.url);
    if (direct && /\.(srt|vtt|ass|ssa)$/i.test(direct)) {
      out.push({
        id: String(fileId || direct),
        url: direct,
        lang: normLang(row?.attributes?.language || lang),
        label: String(row?.attributes?.release || row?.attributes?.files?.[0]?.file_name || 'OpenSubtitles').slice(0, 120),
        addon: 'OpenSubtitles',
        hi: !!row?.attributes?.hearing_impaired,
      });
    }
  }
  return out;
}

async function searchExternalSubtitles({
  imdbId = '', type = 'movie', season = null, episode = null, query = '', lang = 'ar', keys = {}, addonSubs = [], fetchImpl = null,
} = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const wantLang = lang === 'all' ? 'all' : normLang(lang);
  const qLower = String(query || '').trim().toLowerCase();

  const tasks = [];
  if (typeof fetchFn === 'function') {
    tasks.push(queryWyzie({ imdbId, season, episode, lang: wantLang, fetchFn }));
    if (keys?.subdl) tasks.push(querySubDl({ imdbId, query, season, episode, lang: wantLang, apiKey: keys.subdl, fetchFn }));
    if (keys?.opensubtitles) tasks.push(queryOpenSubtitles({ imdbId, query, season, episode, lang: wantLang, apiKey: keys.opensubtitles, fetchFn }));
  }

  const settled = await Promise.allSettled(tasks);
  const combined = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) combined.push(...s.value);
  }
  for (const sub of addonSubs || []) {
    const url = cleanSubUrl(sub?.url);
    if (!url) continue;
    const l = normLang(sub.lang);
    if (wantLang !== 'all' && l !== wantLang) continue;
    const lbl = String(sub.label || sub.title || sub.filename || sub.addon || 'Addon').slice(0, 120);
    if (qLower && !lbl.toLowerCase().includes(qLower) && !String(sub.addon || '').toLowerCase().includes(qLower)) continue;
    combined.push({ ...sub, url, lang: l, label: lbl });
  }

  const seen = new Set();
  const deduped = [];
  for (const item of combined) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const aAr = normLang(a.lang) === 'ar' ? 0 : 1;
    const bAr = normLang(b.lang) === 'ar' ? 0 : 1;
    if (aAr !== bAr) return aAr - bAr;
    const aQ = qLower && String(a.label || '').toLowerCase().includes(qLower) ? 0 : 1;
    const bQ = qLower && String(b.label || '').toLowerCase().includes(qLower) ? 0 : 1;
    return aQ - bQ;
  });

  return deduped.slice(0, 40);
}

module.exports = { searchExternalSubtitles, cleanSubUrl };
