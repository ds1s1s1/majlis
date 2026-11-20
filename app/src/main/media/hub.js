'use strict';
// The media center's main-process side: one AddonClient / Meta / Library / Calendar per app,
// exposed to the Cinema page as `cin:*` IPC. Profiles ("who's watching") keep their own addons,
// library and Stremio account; the default profile uses the plain store keys (as theater.js does).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ptt = require('parse-torrent-title');
const { ipcMain, dialog, app } = require('electron');
const http = require('./http');
const { AddonClient, normalizeUrl } = require('./addon-client');
const { Meta, CINEMETA } = require('./meta');
const { Library } = require('./library');
const { Calendar } = require('./calendar');
const { rank } = require('./ranking');
const { StreamsBucket } = require('./streams-bucket');
const { computeVideoHash } = require('./video-hash');
const { computeCinemaDashboard } = require('./stats');
const { SEED_GENRES_BY_ID } = require('./seed-movies');
const store = require('./store-api');
const { StremioAccount, loginInBrowser } = require('./stremio-sync');
const debrid = require('./debrid');
const { Downloads } = require('./downloads');
const updater = require('../updater');
const { Trackers } = require('./trackers');
const ytdlp = require('./ytdlp');
const { Notifications, CHECK_INTERVAL, dispatchNotificationWebhooks } = require('./notifications');
const homeServers = require('./home-servers');
const { searchExternalSubtitles } = require('./sub-search');
const { DEFAULT_ADDONS, exePath: mediaExePath } = require('../mediasvc');
const { libmpvPath } = require('../libmpv');
const { findExternalPlayer, listInstalledShaders, mpvPath } = require('../mpv');
const { encryptProfileBundle, decryptProfileBundle } = require('../profile-bundle');

// build-config.json (private builds only): { mediaKeys: { tmdb, trakt, ... } } as the built-in fallback
let BUILD = {};
try { BUILD = require('../build-config.json'); } catch {}
const KEY_NAMES = ['tmdb', 'omdb', 'tvdb', 'topposters', 'rpdb', 'mdblist', 'fanart', 'trakt', 'simkl', 'anilist', 'mal', 'opensubtitles', 'subdl', 'subsource', 'introdb', 'realdebrid', 'torbox', 'alldebrid', 'premiumize', 'debridlink', 'aiApiKey'];
// film series worth a marathon (TMDB collection ids)
const MARATHONS = [119, 1241, 10, 230, 263, 2344, 264, 84, 295, 87359, 404609, 9485, 8091, 31562, 328, 131635, 726871, 87096, 10194, 748, 1570, 8945, 528, 645];

function normalizeTitle(raw) {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function annotatePersonWatched(credits = [], lib = null, letterboxd = {}) {
  const watchedIds = new Set();
  const titleBuckets = new Set();
  const addKey = (type, name, year) => {
    const t = normalizeTitle(name);
    if (!t) return;
    const ty = type === 'series' ? 'series' : 'movie';
    const yr = parseInt(String(year || '').slice(0, 4), 10);
    if (Number.isFinite(yr) && yr > 1800) {
      titleBuckets.add(`${ty}|${t}|${yr}`);
      titleBuckets.add(`${ty}|${t}|${yr - 1}`);
      titleBuckets.add(`${ty}|${t}|${yr + 1}`);
    } else {
      titleBuckets.add(`${ty}|${t}|*`);
    }
  };
  const items = lib?.items || {};
  for (const [id, it] of Object.entries(items)) {
    if (!it) continue;
    const w = !!it.state?.flaggedWatched || (Array.isArray(it.state?.majlisWatched) && it.state.majlisWatched.length > 0);
    if (!w) continue;
    watchedIds.add(String(id).toLowerCase());
    if (it.tmdbId) watchedIds.add(`tmdb:${it.type === 'series' ? 'tv' : 'movie'}:${it.tmdbId}`.toLowerCase());
    addKey(it.type, it.name, it.year);
  }
  for (const h of lib?.history || []) {
    if (!h) continue;
    if (h.id) watchedIds.add(String(h.id).toLowerCase());
    addKey(h.type, h.name, h.year);
  }
  for (const lb of Object.values(letterboxd || {})) {
    if (!lb?.watched) continue;
    addKey('movie', lb.name, lb.year);
  }
  return (Array.isArray(credits) ? credits : []).map((c) => {
    if (!c) return c;
    const cid = String(c.id || '').toLowerCase();
    const tid = c.tmdbId != null ? `tmdb:${c.type === 'series' ? 'tv' : 'movie'}:${c.tmdbId}`.toLowerCase() : '';
    let hit = (cid && watchedIds.has(cid)) || (tid && watchedIds.has(tid));
    if (!hit && c.name) {
      const ty = c.type === 'series' ? 'series' : 'movie';
      const tn = normalizeTitle(c.name);
      const yr = parseInt(String(c.year ?? c.releaseInfo ?? '').slice(0, 4), 10);
      if (tn) {
        hit = Number.isFinite(yr) && yr > 1800
          ? titleBuckets.has(`${ty}|${tn}|${yr}`) || titleBuckets.has(`${ty}|${tn}|*`)
          : titleBuckets.has(`${ty}|${tn}|*`);
      }
    }
    return { ...c, watched: !!hit };
  });
}

// opening/ending times: IntroDB + TheIntroDB in parallel, plus AniSkip (Kitsu/IMDb anime via ani.zip)
async function skipsForVideo({ videoId, durationSec = 0, metaImdbId = null, httpClient, introDbKey = '' }) {
  const aniSkipFor = async (mal, ep) => {
    const r = await httpClient.json(`https://api.aniskip.com/v2/skip-times/${mal}/${ep}?types[]=op&types[]=ed&types[]=recap&types[]=mixed-op&types[]=mixed-ed&episodeLength=${Math.round(durationSec || 0)}`, { ttl: 864e5 }).catch(() => null);
    return (r?.results || []).map((x) => ({
      kind: x.skipType.includes('ed') ? 'ed' : x.skipType === 'recap' ? 'recap' : 'op',
      start: Number(x.interval?.startTime),
      end: Number(x.interval?.endTime),
    })).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start && x.start >= 0);
  };
  const mk = /^kitsu:(\d+):(\d+)$/.exec(videoId || '');
  if (mk) {
    const map = await httpClient.json(`https://api.ani.zip/mappings?kitsu_id=${mk[1]}`, { ttl: 7 * 864e5 }).catch(() => null);
    return map?.mappings?.mal_id ? aniSkipFor(map.mappings.mal_id, mk[2]) : [];
  }
  let imdb = null;
  let s = null;
  let e = null;
  const mi = /^(tt\d+)(?::(\d+):(\d+))?$/.exec(videoId || '');
  if (mi) {
    imdb = mi[1];
    s = mi[2] || null;
    e = mi[3] || null;
  } else {
    const mt = /^tmdb:\d+:(\d+):(\d+)$/.exec(videoId || '');
    if (mt && /^tt\d+$/.test(metaImdbId || '')) {
      imdb = metaImdbId;
      s = mt[1];
      e = mt[2];
    } else if (/^tt\d+$/.test(metaImdbId || '')) {
      imdb = metaImdbId;
    }
  }
  if (!imdb) return [];

  const toSeg = (seg, kind) => {
    if (!seg) return null;
    const rawStart = seg.start_sec ?? (seg.start_ms != null ? seg.start_ms / 1000 : seg.start);
    const rawEnd = seg.end_sec ?? (seg.end_ms != null ? seg.end_ms / 1000 : seg.end ?? durationSec ?? null);
    const start = rawStart != null ? Number(rawStart) : NaN;
    const end = rawEnd != null ? Number(rawEnd) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) return null;
    return { kind, start, end };
  };

  const byKind = new Map();
  const addAll = (list) => {
    for (const seg of list) {
      if (seg && !byKind.has(seg.kind)) byKind.set(seg.kind, seg);
    }
  };

  const introHeaders = introDbKey ? { 'x-api-key': introDbKey } : {};
  const idbUrl = `https://api.introdb.app/segments?imdb_id=${imdb}${s ? `&season=${s}&episode=${e}` : '&is_movie=true'}`;
  const tidbUrl = `https://api.theintrodb.org/v4/media?imdb_id=${imdb}${s ? `&season=${s}&episode=${e}` : ''}${durationSec ? `&duration_ms=${Math.round(durationSec * 1000)}` : ''}`;

  const [idbRes, tidbRes] = await Promise.allSettled([
    httpClient.json(idbUrl, { ttl: 864e5, headers: introHeaders }),
    httpClient.json(tidbUrl, { ttl: 864e5 }),
  ]);

  if (idbRes.status === 'fulfilled' && idbRes.value) {
    const idb = idbRes.value;
    addAll([toSeg(idb.intro, 'op'), toSeg(idb.recap, 'recap'), toSeg(idb.outro, 'ed')]);
  }
  if (tidbRes.status === 'fulfilled' && tidbRes.value) {
    const tidb = tidbRes.value;
    const pick = (v) => (Array.isArray(v) ? v[0] : v);
    addAll([
      toSeg(pick(tidb.intro), 'op'),
      toSeg(pick(tidb.recap), 'recap'),
      toSeg(pick(tidb.credits) || pick(tidb.preview), 'ed'),
    ]);
  }

  if (!byKind.has('op') && s && e) {
    const map = await httpClient.json(`https://api.ani.zip/mappings?imdb_id=${imdb}`, { ttl: 7 * 864e5 }).catch(() => null);
    if (map?.mappings?.mal_id) {
      addAll(await aniSkipFor(map.mappings.mal_id, e).catch(() => []));
    }
  }

  return [...byKind.values()].sort((a, b) => a.start - b.start);
}

function scrubDiagnosticsReport(input, extraSecrets = []) {
  const home = os.homedir();
  const secrets = (Array.isArray(extraSecrets) ? extraSecrets : [])
    .filter((s) => typeof s === 'string' && s.trim().length >= 4);
  const redactText = (s) => {
    let out = String(s);
    if (home) out = out.split(home).join('C:\\Users\\<user>');
    out = out.replace(/([A-Za-z]:\\Users\\)[^\\/\s"']+/gi, '$1<user>');
    out = out.replace(/([A-Za-z]:\/Users\/)[^/\s"']+/gi, '$1<user>');
    out = out.replace(/(\/home\/|\/Users\/)[^/\s"']+/gi, '$1<user>');
    out = out.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@');
    out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]');
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
    for (const sec of secrets) out = out.split(sec).join('[REDACTED]');
    return out;
  };
  const SENSITIVE_KEY = /accessKey|mediaKeys|discordWebhookUrl|telegramBotToken|stremioKey|aiApiKey|passphrase|secret|password|apikey|cookie|token/i;
  const walk = (v, depth = 0) => {
    if (depth > 12 || v == null) return v;
    if (typeof v === 'string') return redactText(v);
    if (typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (SENSITIVE_KEY.test(k) && val != null && val !== '' && typeof val !== 'boolean') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = walk(val, depth + 1);
      }
    }
    return out;
  };
  return walk(input, 0);
}

function setup({ store: st, dataDir, openExternal, openPath = () => {}, videosDir = dataDir, svc = null, emit = () => {}, getWin = () => null, getFfmpeg = null, notify = null, getCacheManager = () => null, isIncognito = () => false, setIncognito = () => false, onProfileChanged = () => {}, getDiagnosticsHooks = () => ({}) }) {
  http.init(path.join(dataDir, 'media-cache'));
  const profile = () => st.get('mediaProfile') || 'default';
  const pk = (k) => (profile() === 'default' ? k : `${k}@${profile()}`);
  const pget = (k) => st.get(pk(k));
  const pset = (k, v) => st.set(pk(k), v);
  const addons = () => {
    const seen = new Set();
    return (pget('addons') || DEFAULT_ADDONS).map((u) => normalizeUrl(u)).filter((u) => { if (!u || seen.has(u)) return false; seen.add(u); return true; });
  };
  const disabledSet = () => new Set((pget('disabledAddons') || []).map((u) => normalizeUrl(u)));
  const enabledAddons = () => { const off = disabledSet(); return addons().filter((u) => !off.has(u)); };
  const streamsBucketFor = () => new StreamsBucket(path.join(dataDir, 'media', profile().replace(/[^\w-]/g, '_'), 'streams-bucket.json'));
  const streamsBucket = {
    record: (metaId, videoId, info) => (isIncognito?.() ? null : streamsBucketFor().record(metaId, videoId, info)),
    findRecent: (metaId) => streamsBucketFor().findRecent(metaId),
    hintFor: (metaId, curVideoId, orderedIds) => streamsBucketFor().hintFor(metaId, curVideoId, orderedIds),
    saveItemState: (metaId, patch) => (isIncognito?.() ? null : streamsBucketFor().saveItemState(metaId, patch)),
    getItemState: (metaId) => streamsBucketFor().getItemState(metaId),
  };

  // the user's own keys win; empty ones fall back to the build's
  const userKeys = () => st.get('mediaKeys') || {};
  const keys = () => Object.fromEntries(KEY_NAMES.map((k) => [k, userKeys()[k] || BUILD.mediaKeys?.[k] || '']));
  const lang = () => st.get('lang') || 'ar';

  const client = new AddonClient();
  const meta = new Meta({ keys, lang });

  // one Library per profile, each in its own file
  const libs = new Map();
  const library = () => {
    const p = profile();
    if (!libs.has(p)) {
      const file = path.join(dataDir, 'media', p.replace(/[^\w-]/g, '_'), 'library.json');
      libs.set(p, new Library({
        load: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
        save: (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(s)); fs.renameSync(`${file}.tmp`, file); },
      }));
    }
    return libs.get(p);
  };
  const calendar = () => new Calendar({ meta, library: library(), keys });

  // the Stremio auth key, encrypted at rest like the identity key
  const stremio = () => { const s = pget('stremioKey'); return s ? new StremioAccount(st._unprotect(s).toString()) : null; };

  const raceCap = (p, ms = 3500) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  const manifests = async () => (await Promise.all(enabledAddons().map((url) => raceCap(client.manifest(url).then((m) => ({ url, m }), () => null), 3500)))).filter(Boolean);
  const h = (name, fn) => ipcMain.handle(`cin:${name}`, (e, a) => fn(a || {}));

  // ---- addons
  h('addons', async () => {
    const off = disabledSet();
    return Promise.all(addons().map((url) => client.manifest(url, { force: true }).then(
      (m) => {
        const lats = client.latencies.get(url);
        const latencyMs = lats?.length ? lats[lats.length - 1] : null;
        return { url, manifest: m, dead: client.isDead(url), enabled: !off.has(url), latencyMs, health: client.healthSnapshot(url) };
      },
      (e) => ({ url, error: e.message, dead: client.isDead(url), enabled: !off.has(url), latencyMs: null, health: client.healthSnapshot(url) }),
    )));
  });
  h('addons-ping', async () => {
    const off = disabledSet();
    const list = addons();
    const snaps = await client.pingAll(list);
    return snaps.map((s) => ({ ...s, enabled: !off.has(s.url) }));
  });
  h('addon-check-url', async ({ url } = {}) => {
    const clean = normalizeUrl(url);
    let parsed;
    try { parsed = new URL(clean); } catch { return { ok: false, error: 'invalid_url' }; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'unsupported_protocol' };
    if (http.isPrivateHost(parsed.hostname) && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return { ok: false, error: 'private_host_blocked' };
    }
    try {
      const body = await http.json(clean, { ttl: 0, timeout: 6500 });
      if (body && typeof body.id === 'string' && typeof body.name === 'string') {
        return { ok: true, kind: 'manifest', name: body.name, version: body.version || null, manifest: body };
      }
      if (Array.isArray(body) || Array.isArray(body?.addons)) {
        const arr = Array.isArray(body) ? body : body.addons;
        return { ok: true, kind: 'repo', name: body?.name || parsed.hostname, addonCount: arr.length };
      }
      return { ok: false, error: 'unrecognized_manifest' };
    } catch (e) {
      return { ok: false, error: e?.message || 'fetch_failed' };
    }
  });
  h('addon-install', async ({ url }) => {
    url = normalizeUrl(url);
    client.resetHealth(url);
    const m = await client.check(url);
    pset('addons', [...addons().filter((u) => u !== url), url]);
    pset('disabledAddons', (pget('disabledAddons') || []).filter((u) => normalizeUrl(u) !== url));
    return m;
  });
  h('addon-remove', ({ url }) => {
    url = normalizeUrl(url);
    pset('addons', addons().filter((u) => u !== url));
    pset('disabledAddons', (pget('disabledAddons') || []).filter((u) => normalizeUrl(u) !== url));
    client.forget(url);
    return addons();
  });
  h('addon-toggle', ({ url, enabled }) => {
    url = normalizeUrl(url);
    const off = new Set((pget('disabledAddons') || []).map((u) => normalizeUrl(u)));
    if (enabled) off.delete(url); else off.add(url);
    pset('disabledAddons', [...off]);
    return !off.has(url);
  });
  h('addon-refresh', async ({ url }) => {
    url = normalizeUrl(url);
    client.forget(url);
    client.resetHealth(url);
    return client.manifest(url, { force: true });
  });
  h('addon-move', ({ url, to }) => {
    url = normalizeUrl(url);
    const l = addons().filter((u) => u !== url);
    l.splice(Math.max(0, Math.min(l.length, to)), 0, url);
    pset('addons', l); return l;
  });
  h('store', (q) => store.list(q));
  h('store-categories', () => store.categories());

  // ---- browsing
  // every catalog that needs no input, in addon order (genre/skip options kept for the filter bar)
  h('rows', async () => (await manifests()).flatMap(({ url, m }) => m.catalogs
    .filter((c) => !c.extra.some((x) => x.isRequired))
    .map((c) => ({ addon: url, addonName: m.name, type: c.type, id: c.id, name: c.name || c.id, extra: c.extra }))));
  // { addon, type, id, extra: [[name, value]] } -> metas
  h('catalog', async ({ addon, type, id, extra = [] }) => (await client.request(addon, { resource: 'catalog', type, id, extra })).metas);
  h('search', async ({ q }) => {
    const raw = String(q || '').trim();
    const out = [];
    if (/^magnet:\?/i.test(raw)) {
      const mHash = /xt=urn:btih:([0-9a-f]{32,40})/i.exec(raw);
      const dn = /dn=([^&]+)/i.exec(raw);
      const name = dn ? decodeURIComponent(dn[1].replace(/\+/g, ' ')) : 'Magnet Link';
      if (mHash) {
        out.push(Promise.resolve({ addon: 'direct', type: 'movie', name: 'Direct Magnet', metas: [{ id: `direct-magnet:${mHash[1].toLowerCase()}`, type: 'movie', name, directUrl: raw }] }));
      }
    } else if (ytdlp.isYouTubeUrl(raw)) {
      out.push(Promise.resolve({ addon: 'direct', type: 'movie', name: 'YouTube', metas: [{ id: `direct-yt:${Buffer.from(raw).toString('base64url').slice(0, 48)}`, type: 'movie', name: 'YouTube Video', directUrl: raw }] }));
    } else if (/^https?:\/\/\S+\.(mkv|mp4|m4v|webm|m3u8)(\?|$)/i.test(raw)) {
      out.push(Promise.resolve({ addon: 'direct', type: 'movie', name: 'Direct Stream', metas: [{ id: `direct-url:${Buffer.from(raw).toString('base64url').slice(0, 48)}`, type: 'movie', name: decodeURIComponent(path.basename(raw.split('?')[0])) || 'Direct Stream', directUrl: raw }] }));
    }
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs) {
        if (!c.extra.some((x) => x.name === 'search')) continue;
        out.push(raceCap(client.request(url, { resource: 'catalog', type: c.type, id: c.id, extra: [['search', raw]] })
          .then((r) => ({ addon: url, type: c.type, name: c.name, metas: r.metas }), () => null), 4000));
      }
    }
    // Cinemeta feed.json / fallback fast search suggestions when no enabled addon already includes Cinemeta
    if (!addons().some((u) => /v3-cinemeta\.strem\.io/i.test(u)) && !/^magnet:|^https?:/i.test(raw)) {
      for (const ty of ['movie', 'series']) {
        out.push(raceCap(http.json(`${CINEMETA}/catalog/${ty}/top/search=${encodeURIComponent(raw)}.json`, { ttl: 600000 })
          .then((r) => ({ addon: CINEMETA, type: ty, name: 'Cinemeta', metas: r.metas || [] }), () => null), 3000));
      }
    }
    return (await Promise.all(out)).filter(Boolean);
  });
  h('search-people', ({ q }) => meta.searchPeople(q));
  h('person', async ({ id }) => {
    const p = await meta.person(id);
    if (!p) return null;
    return { ...p, credits: annotatePersonWatched(p.credits || [], library(), pget('letterboxd') || {}) };
  });
  h('trending', ({ type }) => meta.trending(type));
  h('anime-trending', ({ page }) => meta.animeTrending(page));
  h('anime-hub', () => meta.animeHub());
  h('discover', (a) => meta.discover(a));
  h('entity-catalog', (a) => meta.discoverByEntity(a || {}));
  const BRAND_PATTERNS = {
    netflix: /\b(netflix|nflx)\b/i,
    apple: /\b(apple\s*tv|apple|atp|atvp)\b/i,
    prime: /\b(prime|amazon|amzn)\b/i,
    disney: /\b(disney|dnp)\b/i,
    max: /\b(max|hbo)\b/i,
    hulu: /\bhulu\b/i,
    crunchyroll: /\b(crunchyroll|crunchy)\b/i,
    peacock: /\bpeacock\b/i,
    paramount: /\b(paramount|pmtp)\b/i,
    starz: /\bstarz\b/i,
    shudder: /\bshudder\b/i,
  };
  h('brand-catalog', async ({ providerId, keyword, type = 'movie' }) => {
    const k = String(keyword || '').toLowerCase();
    const rx = BRAND_PATTERNS[k] || (k ? new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') : null);
    const row = (await manifests()).flatMap(({ url, m }) => m.catalogs.map((c) => ({ url, c })))
      .find(({ c }) => c.type === type && rx && rx.test(`${c.id} ${c.name || ''}`));
    if (row) {
      const r = await client.request(row.url, { resource: 'catalog', type: row.c.type, id: row.c.id }).catch(() => null);
      if (r?.metas?.length) return r.metas;
    }
    if (k === 'crunchyroll' && !meta.tmdbOn()) {
      const hub = await meta.animeHub().catch(() => null);
      const list = type === 'movie' ? hub?.movies : hub?.season || hub?.trending;
      if (list?.length) return list;
    }
    return meta.discover({ type, provider: providerId });
  });
  h('collection', ({ id }) => meta.collection(id));
  h('season', ({ tmdbId, n }) => meta.season(tmdbId, n));

  // the title page: the first addon that has this id's meta, then TMDB on top
  // AniList id -> Kitsu (anime addons) or IMDb; new shows without a mapping are found by name in the Kitsu addon
  async function animeId(id) {
    const n = id.slice('anilist:'.length);
    const ids = await meta.animeIds(n).catch(() => ({}));
    if (ids.kitsu || ids.imdb) return ids.kitsu || ids.imdb;
    const a = await meta.anilist('query($id:Int){Media(id:$id){title{english romaji}}}', { id: +n }).catch(() => null);
    const names = [a?.data?.Media?.title?.romaji, a?.data?.Media?.title?.english].filter(Boolean);
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs.filter((c) => c.extra.some((x) => x.name === 'search'))) {
        for (const name of names) {
          const r = await client.request(url, { resource: 'catalog', type: c.type, id: c.id, extra: [['search', name]] }).catch(() => null);
          const hit = r?.metas.find((x) => x.id.startsWith('kitsu:'));
          if (hit) return hit.id;
        }
      }
    }
    return null;
  }
  async function fetchMeta({ type, id }) {
    if (String(id || '').startsWith('anilist:')) {
      id = await animeId(id);
      if (!id) throw new Error('this anime is not in any of your addons yet');
    }
    const r = await client.all(enabledAddons(), { resource: 'meta', type, id });
    const base = r.find((x) => x.result?.meta)?.result.meta || null;
    const item = await meta.details(type, id, base);
    if (base?.behaviorHints?.defaultVideoId && !item.behaviorHints?.defaultVideoId) {
      item.behaviorHints = { ...(item.behaviorHints || {}), defaultVideoId: base.behaviorHints.defaultVideoId };
    }
    if (Array.isArray(base?.videos) && Array.isArray(item.videos)) {
      const inlineByVid = new Map(base.videos.filter((v) => Array.isArray(v.streams) && v.streams.length).map((v) => [v.id, v.streams]));
      if (inlineByVid.size) item.videos = item.videos.map((v) => (inlineByVid.has(v.id) ? { ...v, streams: inlineByVid.get(v.id) } : v));
    }
    if (Array.isArray(item.videos) && item.videos.length) {
      library().syncBitfield(item.id, item.videos.map((v) => v.id).filter(Boolean));
    }
    if (library().get(item.id)) library().enrichMeta(item.id, item);
    const lib = library().get(item.id);
    return { ...item, library: lib ? { inLibrary: !lib.removed, state: lib.state } : null };
  }
  h('meta', fetchMeta);

  async function resolveStreamIds(type, id) {
    const ids = [id];
    const parts = String(id || '').split(':');
    const se = parts.length >= 3 && !/^tmdb:/i.test(id) ? `:${parts.slice(-2).join(':')}` : (parts.length === 5 && /^tmdb:/i.test(id) ? `:${parts[3]}:${parts[4]}` : '');
    if (/^tmdb:/i.test(id) && meta.tmdbOn()) {
      try {
        const [, kind, tid] = parts;
        const ext = await meta.tmdb(`/${kind === 'tv' ? 'tv' : 'movie'}/${tid}/external_ids`, {}, 24 * 7 * 3600000);
        if (ext?.imdb_id) ids.unshift(`${ext.imdb_id}${se}`);
      } catch {}
    } else if (/^kitsu:/i.test(id)) {
      const kid = parts[1];
      const map = await meta.animeIds(kid).catch(() => null);
      if (map?.imdb) ids.push(`${map.imdb}${parts[2] ? `:1:${parts[2]}` : ''}`);
    }
    return [...new Set(ids)];
  }

  // every addon's streams for a video, ranked best first (supports multi-ID fan-out, inline video.streams, binge continuity & progressive emission)
  async function streams({ type, id, bingeGroup, partyMinMbps, hdrDisplay, runtimeMin, progressive = false, graceMs = 80 }) {
    const seM = /:(\d+):(\d+)$/.exec(String(id || ''));
    const baseMetaId = String(id || '').replace(/:(\d+):(\d+)$/, '');
    const cachedMeta = /^tt\d+/i.test(baseMetaId) ? await meta.details(type, baseMetaId).catch(() => null) : null;
    const orderedIds = Array.isArray(cachedMeta?.videos) ? cachedMeta.videos.map((v) => v.id).filter(Boolean) : [];
    const bucketHint = streamsBucket.hintFor(baseMetaId, id, orderedIds) || streamsBucket.findRecent(baseMetaId);
    const hintBg = bingeGroup || bucketHint?.bingeGroup || bucketHint?.stream?.behaviorHints?.bingeGroup || undefined;
    const o = {
      maxHeight: st.get('mediaMaxHeight') || 1080, downMbps: st.get('downMbps') || 0,
      partyMinMbps: partyMinMbps || 0, hdrDisplay: !!hdrDisplay, runtimeMin: runtimeMin || 110,
      debridOnly: !!st.get('debridOnly'), lang: lang(), subLang2: st.get('subLang2') || 'eng',
      safetyFilter: st.get('safetyFilter') || 'strict',
      resultOrder: st.get('resultOrder') || 'smart',
      streamPriorityOrder: Array.isArray(st.get('streamPriorityOrder')) ? st.get('streamPriorityOrder') : ['Debrid', 'Addon', 'Server', 'Direct'],
      rules: st.get('streamRules') || null,
      bingeGroup: hintBg, season: seM ? +seM[1] : null, episode: seM ? +seM[2] : null,
    };
    const inlineStreams = [];
    const vidObj = cachedMeta?.videos?.find((v) => v.id === id);
    if (Array.isArray(vidObj?.streams)) {
      for (const s of vidObj.streams) inlineStreams.push({ stream: s, addon: { url: 'inline://meta', name: 'Meta' }, addonRank: 0 });
    }
    const dedup = (arr) => {
      const seen = new Set(), flat = [...inlineStreams];
      for (const x of arr) {
        for (const stream of x.result?.streams || []) {
          const dk = stream.infoHash ? `ih:${String(stream.infoHash).toLowerCase()}:${stream.fileIdx ?? ''}:${x.url}` : stream.url ? `u:${stream.url}` : null;
          if (dk && seen.has(dk)) continue;
          if (dk) seen.add(dk);
          flat.push({ stream, addon: { url: x.url, name: x.manifest.name }, addonRank: x.addonRank });
        }
      }
      return flat;
    };
    const shape = (arr) => ({
      streams: rank(dedup(arr), o),
      errors: arr.filter((x) => x.error).map((x) => ({ addon: x.manifest.name, error: x.error.message })),
    });
    const fanIds = await resolveStreamIds(type, id);
    const activeAddons = enabledAddons();
    const waitMs = Math.max(4000, Math.min(45000, (Number(st.get('sourceWaitSec')) || 15) * 1000));
    if (!progressive) {
      const batches = await Promise.all(fanIds.map((fid) => client.all(activeAddons, { resource: 'stream', type, id: fid }, undefined, { maxWaitMs: waitMs })));
      return shape(batches.flat());
    }
    const collected = [];
    const firstList = await Promise.all(fanIds.map((fid) => client.progressive(activeAddons, { resource: 'stream', type, id: fid }, {
      graceMs,
      maxWaitMs: waitMs,
      onEach: (x, afterFirst) => {
        collected.push(x);
        if (afterFirst) emit('cin:streams-part', { key: `${type}:${id}`, addon: x.manifest.name, ...shape(collected) });
      },
    })));
    return shape(firstList.flat());
  }
  async function subtitles({ type, id, extra = [], streamUrl = null, filePath = null, headers = {} }) {
    const hasHash = Array.isArray(extra) && extra.some(([k]) => k === 'videoHash');
    let nextExtra = Array.isArray(extra) ? [...extra] : [];
    if (!hasHash && (filePath || streamUrl)) {
      const vh = await computeVideoHash(filePath || streamUrl, headers).catch(() => null);
      if (vh) nextExtra.push(['videoHash', vh.videoHash], ['videoSize', String(vh.videoSize)]);
    }
    return (await client.all(enabledAddons(), { resource: 'subtitles', type, id, extra: nextExtra })).flatMap((x) => (x.result?.subtitles || []).map((s) => ({ ...s, addon: x.manifest.name })));
  }
  // ---- hub instance ----
  const skips = (videoId, durationSec, metaImdbId = null) => skipsForVideo({
    videoId, durationSec, metaImdbId, httpClient: http, introDbKey: keys().introdb || '',
  });
  // the viewer's debrid service, when one has a key: { name, resolve(stream) }
  function debridService() {
    const k = keys(), name = st.get('debridService') || debrid.SERVICES.find((s) => k[s]);
    return name && k[name] ? {
      name,
      resolve: (s) => debrid.resolve(name, k[name], s),
      listCloud: (folderId) => debrid.listCloud(name, k[name], folderId),
      resolveCloud: (item) => debrid.resolveCloud(name, k[name], item),
    } : null;
  }
  const torrentHealth = require('./torrent-health');
  h('streams', (a) => streams({ ...a, progressive: a.progressive !== false }));
  h('torrent-health', ({ items }) => torrentHealth.checkBatch(items));
  h('cloud-list', async ({ folderId } = {}) => {
    const deb = debridService();
    if (!deb) return { configured: false, service: null, items: [] };
    const items = await deb.listCloud(folderId || null);
    return { configured: true, service: deb.name, items };
  });
  h('cloud-resolve', async ({ item } = {}) => {
    const deb = debridService();
    if (!deb) throw new Error('no_debrid_configured');
    return deb.resolveCloud(item);
  });
  h('prefetch', ({ type, id }) => {
    if (type && id) {
      client.all(addons(), { resource: 'meta', type, id })
        .then((r) => meta.details(type, id, r.find((x) => x.result?.meta)?.result.meta || null))
        .catch(() => {});
      client.all(addons(), { resource: 'stream', type, id }).catch(() => {});
    }
    return true;
  });

  // ---- downloads (one list for the whole app, not per profile: files on disk are shared)
  const folder = () => st.get('downloadDir') || path.join(videosDir, 'Majlis');
  const downloads = new Downloads({
    file: path.join(dataDir, 'media', 'downloads.json'),
    folder,
    svc,
    debrid: () => debridService(),
    fetchSubtitles: (d) => subtitles({ type: d.type, id: d.videoId || d.metaId }).catch(() => []),
    changed: () => emit('downloads', {}),
    maxConcurrent: st.get('maxConcurrentDownloads') || 2,
  });
  h('dl-list', () => downloads.list());
  h('dl-add', (a) => downloads.add(a));
  h('dl-pause', ({ id }) => downloads.pause(id));
  h('dl-resume', ({ id }) => downloads.start(id));
  h('dl-reorder', ({ id, dir }) => downloads.reorder(id, dir));
  h('dl-pause-all', () => downloads.pauseAll());
  h('dl-resume-all', () => downloads.resumeAll());
  h('dl-clear-done', () => downloads.clearDone());
  h('dl-config', (a = {}) => {
    if (a && a.maxConcurrent != null) {
      const n = downloads.setMaxConcurrent(a.maxConcurrent);
      st.set('maxConcurrentDownloads', n);
    }
    return { maxConcurrent: downloads.maxConcurrent };
  });
  h('dl-remove', ({ id, deleteFile }) => downloads.remove(id, deleteFile));
  h('dl-folder', () => openPath(folder()));
  h('dl-folder-pick', async () => {
    const r = await dialog.showOpenDialog(getWin?.() || undefined, { defaultPath: folder(), properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths?.[0]) {
      st.set('downloadDir', r.filePaths[0]);
      emit('downloads', {});
      return { folder: r.filePaths[0] };
    }
    return { folder: folder() };
  });
  h('subtitles', subtitles);

  // ---- Local Folder Scanner (recursive video indexing, safe lookup by opaque ID)
  const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|webm|ts|mov)$/i;
  const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
  const localIndex = new Map();
  const findSidecarSubs = (videoPath) => {
    try {
      const dir = path.dirname(videoPath);
      const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
      return fs.readdirSync(dir)
        .filter((f) => SUB_EXT.test(f) && f.toLowerCase().startsWith(base))
        .map((f) => path.join(dir, f));
    } catch { return []; }
  };
  const buildLocalEntry = (full, stat) => {
    const filename = path.basename(full);
    const parsed = ptt.parse(filename);
    const id = `local:${crypto.createHash('sha1').update(full).digest('hex').slice(0, 16)}`;
    const matches = st.get('localMatches') || {};
    const entry = {
      id, filePath: full, filename,
      name: parsed.title || path.basename(filename, path.extname(filename)),
      year: parsed.year || null, season: parsed.season ?? null, episode: parsed.episode ?? null,
      resolution: parsed.resolution || null, size: stat.size, mtime: stat.mtimeMs,
      sidecarSubs: findSidecarSubs(full),
      match: matches[id] || null,
    };
    localIndex.set(id, entry);
    return entry;
  };
  const publicLocalEntry = (entry) => ({
    id: entry.id, filename: entry.filename, name: entry.name, year: entry.year,
    season: entry.season, episode: entry.episode, resolution: entry.resolution,
    size: entry.size, mtime: entry.mtime, sidecarCount: entry.sidecarSubs?.length || 0,
    match: entry.match || null,
  });
  async function scanLocalFolder({ pick = false, folders = null } = {}) {
    const saved = Array.isArray(st.get('localFolders')) ? st.get('localFolders') : [];
    const roots = [...new Set([folder(), ...(folders || saved)].filter(Boolean))];
    if (pick) {
      const r = await dialog.showOpenDialog(getWin?.() || undefined, { defaultPath: folder(), properties: ['openDirectory'] });
      if (!r.canceled && r.filePaths?.[0]) {
        const picked = r.filePaths[0];
        if (!saved.includes(picked)) st.set('localFolders', [...saved, picked]);
        if (!roots.includes(picked)) roots.push(picked);
      }
    }
    const found = [];
    const walk = async (dir, depth = 0) => {
      if (depth > 4 || found.length >= 500) return;
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (found.length >= 500) break;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.isFile() && VIDEO_EXT.test(e.name)) {
          try {
            const stat = await fs.promises.stat(full);
            if (stat.size < 1048576) continue;
            found.push(publicLocalEntry(buildLocalEntry(full, stat)));
          } catch {}
        }
      }
    };
    for (const r of roots) await walk(r, 0);
    return { folders: roots, files: found.sort((a, b) => b.mtime - a.mtime) };
  }
  h('local-scan', (a) => scanLocalFolder(a || {}));
  h('local-match', ({ id, match } = {}) => {
    if (!id) return false;
    const prev = { ...(st.get('localMatches') || {}) };
    if (match && match.metaId) {
      prev[id] = {
        metaId: String(match.metaId).slice(0, 120),
        type: String(match.type || 'movie').slice(0, 24),
        name: String(match.name || '').slice(0, 200),
        poster: typeof match.poster === 'string' ? match.poster.slice(0, 500) : null,
        year: match.year ?? null,
      };
    } else delete prev[id];
    st.set('localMatches', prev);
    const cur = localIndex.get(id);
    if (cur) cur.match = prev[id] || null;
    return prev[id] || null;
  });
  const registerDropFile = (filePath) => {
    const p = String(filePath || '').trim();
    if (!p || !VIDEO_EXT.test(p)) return null;
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    return buildLocalEntry(p, stat);
  };
  const localEntry = (id) => localIndex.get(id) || null;
  const localFile = (id) => {
    const it = localIndex.get(id);
    return it && fs.existsSync(it.filePath) ? it.filePath : null;
  };

  // ---- library
  h('library', () => library().library());
  h('continue', () => library().continueWatching());
  h('upcoming', () => library().upcomingWatching());
  h('continue-dismiss', ({ id }) => library().dismiss(id));
  h('lib-rewind', ({ id }) => library().rewind(id));
  h('history', () => Library.groupHistory(library().history));
  h('lists', () => ({ watchlist: library().watchlist, favorites: library().favorites }));
  h('custom-lists', () => library().getCustomLists());
  h('custom-list-create', ({ name }) => library().createList(name));
  h('custom-list-rename', ({ id, name }) => library().renameList(id, name));
  h('custom-list-delete', ({ id }) => library().deleteList(id));
  h('custom-list-reorder', ({ ids }) => library().reorderLists(ids));
  h('custom-list-toggle', ({ listId, meta: m }) => library().toggleCustomListItem(listId, m));
  h('lib-add', ({ meta: m }) => library().add(m));
  h('lib-remove', ({ id }) => { library().remove(id); return true; });
  h('lib-watched', ({ meta: m, videoId, on }) => library().setWatched(m, videoId, on));
  h('lib-mark-prev', ({ meta: m, videos, videoId, on = true }) => { library().markPrevWatched(m, videos, videoId, on); return true; });
  h('lib-season', ({ meta: m, seasonVideos, on = true, allVideos }) => { library().setSeasonWatched(m, seasonVideos, on, allVideos); return true; });
  h('lib-toggle', ({ list, meta: m }) => (['watchlist', 'favorites'].includes(list) ? library().toggleList(list, m) : null));
  h('home-prefs', () => ({ rowOrder: [], hiddenRows: [], showBrands: true, showFriends: true, zenMode: false, ...(pget('homePrefs') || {}) }));
  h('home-prefs-set', (patch) => {
    const prev = { rowOrder: [], hiddenRows: [], showBrands: true, showFriends: true, zenMode: false, ...(pget('homePrefs') || {}) };
    const next = {
      ...prev,
      ...patch,
      zenMode: patch && 'zenMode' in patch ? !!patch.zenMode : !!prev.zenMode,
      hiddenRows: Array.isArray(patch?.hiddenRows) ? patch.hiddenRows.map(String) : prev.hiddenRows,
      rowOrder: Array.isArray(patch?.rowOrder) ? patch.rowOrder.map(String) : prev.rowOrder,
    };
    pset('homePrefs', next); return next;
  });

  // ---- Play Queue (synced from renderer Zustand store for back-to-back EOF auto-advance & Watch Party)
  let playQueue = [];
  let onQueueChanged = null;
  const sanitizeQueue = (items) => (Array.isArray(items) ? items : [])
    .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
    .slice(0, 100)
    .map((x) => ({
      key: String(x.key || x.videoId || x.id).slice(0, 180),
      id: String(x.id).slice(0, 180),
      type: String(x.type || 'movie').slice(0, 24),
      name: String(x.name).slice(0, 240),
      poster: typeof x.poster === 'string' ? x.poster.slice(0, 500) : null,
      videoId: typeof x.videoId === 'string' ? x.videoId.slice(0, 180) : undefined,
      epLabel: typeof x.epLabel === 'string' ? x.epLabel.slice(0, 40) : undefined,
      directUrl: typeof x.directUrl === 'string' && x.directUrl.length <= 2048 ? x.directUrl : undefined,
      addedBy: typeof x.addedBy === 'string' ? x.addedBy.slice(0, 40) : undefined,
      addedByAccent: typeof x.addedByAccent === 'string' && /^#[0-9a-f]{6}$/i.test(x.addedByAccent) ? x.addedByAccent : undefined,
      addedAt: Number(x.addedAt) || Date.now(),
    }));
  h('queue-sync', ({ items } = {}) => {
    playQueue = sanitizeQueue(items);
    onQueueChanged?.(playQueue);
    return playQueue;
  });

  // ---- Discover: what the viewer liked and didn't (per profile): { [id]: { v: 1 | -1, genres } }
  h('tune', () => pget('mediaTune') || {});
  h('tune-set', ({ id, v, genres }) => {
    const t = { ...(pget('mediaTune') || {}) };
    if (v) t[id] = { v: v > 0 ? 1 : -1, genres: (genres || []).slice(0, 6) }; else delete t[id];
    pset('mediaTune', t); return t;
  });
  h('marathons', async () => (meta.tmdbOn() ? (await Promise.all(MARATHONS.map((id) => meta.collection(id).catch(() => null)))).filter(Boolean) : []));

  // ---- calendar: { from, to, sources }
  h('calendar', ({ from, to, sources }) => calendar().range(from, to, sources));

  // ---- Stremio account
  h('stremio-login', async ({ email, password }) => {
    const acc = email ? await StremioAccount.login(email, password) : new StremioAccount(await loginInBrowser(openExternal));
    pset('stremioKey', st._protect(Buffer.from(acc.authKey)));
    const user = await acc.user().catch(() => null);
    return { email: user?.email || null };
  });
  h('stremio-logout', async () => { await stremio()?.logout(); pset('stremioKey', null); return true; });
  h('stremio-sync', async ({ addons: withAddons }) => {
    const acc = stremio();
    if (!acc) throw new Error('not signed in to Stremio');
    try {
      const out = await acc.syncLibrary(library());
      if (withAddons) {
        const res = await acc.addons();
        const theirs = (res.addons || []).map((a) => a.transportUrl).filter(Boolean);
        const mine = addons();
        pset('addons', [...mine, ...theirs.filter((u) => !mine.includes(u))]);
        out.addons = theirs.length;
        if (res.locked) out.addonsLocked = true;
      }
      return out;
    } catch (e) {
      if (e?.expired) { pset('stremioKey', null); emit('cin:stremio-expired', {}); }
      throw e;
    }
  });

  // ---- Trackers: Trakt / Simkl / AniList / MAL (per profile; OAuth tokens DPAPI-encrypted)
  const trackers = new Trackers({
    server: () => { const s = String(st.get('server') || ''); return /^https:\/\//i.test(s) ? s.replace(/\/+$/, '') : null; },
    accessKey: () => st.get('accessKey'), keys, get: pget, set: pset, protect: (b) => st._protect(b), unprotect: (s) => st._unprotect(s), openExternal,
  });
  h('trackers', () => trackers.status());
  h('tracker-start', ({ svc, service }) => trackers.start(svc || service, () => emit('trackers', {})));
  h('tracker-out', ({ svc, service }) => { trackers.signOut(svc || service); return true; });
  h('tracker-import', () => trackers.importInto(library()));

  // ---- notifications (new episodes & today's library releases, Stremio lastVideosIds style)
  const notifs = new Notifications({
    fileFor: (p) => path.join(dataDir, 'media', String(p || 'default').replace(/[^\w-]/g, '_'), 'notifications.json'),
    onAdded: (ev) => {
      emit('cin:notif-new', { unread: ev.unread, added: ev.added });
      if (notify && ev.added?.[0]) notify({ title: ev.added[0].name, body: ev.added[0].title, route: 'calendar' });
      dispatchNotificationWebhooks({
        discordWebhookUrl: st.get('discordWebhookUrl'),
        telegramBotToken: st.get('telegramBotToken'),
        telegramChatId: st.get('telegramChatId'),
        items: ev.added,
      }).catch(() => {});
    },
  });
  const checkNotifs = async (force = false) => {
    const args = { prof: profile(), library: library(), fetchMeta: (type, id) => fetchMeta({ type, id }), force };
    await notifs.check(args).catch(() => {});
    await notifs.checkTodaysReleases(args).catch(() => {});
    await notifs.checkTrackedPeople({ prof: profile(), trackedPeople: pget('trackedPeople') || [], fetchPerson: (pid) => meta.person(pid) }).catch(() => {});
  };
  h('person-track-list', () => pget('trackedPeople') || []);
  h('person-track-toggle', ({ id, name, photo } = {}) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return { tracked: false, list: pget('trackedPeople') || [] };
    const list = [...(pget('trackedPeople') || [])];
    const idx = list.findIndex((x) => Number(x.id) === pid);
    let tracked = false;
    if (idx >= 0) list.splice(idx, 1);
    else {
      list.unshift({ id: pid, name: String(name || `#${pid}`).slice(0, 120), photo: photo || null, at: Date.now() });
      tracked = true;
    }
    pset('trackedPeople', list.slice(0, 50));
    return { tracked, list: pget('trackedPeople') || [] };
  });

  // ---- Home Media Servers (Jellyfin / Emby / Plex)
  const rawHomeServers = () => (Array.isArray(st.get('homeServers')) ? st.get('homeServers') : []);
  const decryptServer = (raw) => ({
    ...raw,
    apiKey: raw.apiKeyEnc ? st._unprotect(raw.apiKeyEnc).toString('utf8') : '',
  });
  const sanitizePublicServer = (raw) => ({
    id: raw.id,
    kind: raw.kind,
    name: raw.name,
    url: raw.url,
    userId: raw.userId || '',
    serverName: raw.serverName || '',
    version: raw.version || '',
    hasKey: !!raw.apiKeyEnc,
  });
  h('hs-list', () => rawHomeServers().map(sanitizePublicServer));
  h('hs-save', ({ id, kind = 'jellyfin', name, url, apiKey, userId, serverName, version } = {}) => {
    const normUrl = homeServers.normalizeServerUrl(url);
    if (!normUrl) throw new Error('invalid_server_url');
    const list = [...rawHomeServers()];
    const existing = id ? list.find((x) => x.id === id) : null;
    const srvId = existing?.id || id || `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const nextEnc = typeof apiKey === 'string' && apiKey.trim()
      ? st._protect(Buffer.from(apiKey.trim(), 'utf8'))
      : (existing?.apiKeyEnc || null);
    const entry = {
      id: srvId,
      kind: ['jellyfin', 'emby', 'plex'].includes(kind) ? kind : 'jellyfin',
      name: String(name || serverName || kind.toUpperCase()).trim().slice(0, 80),
      url: normUrl,
      userId: String(userId || existing?.userId || '').slice(0, 120),
      serverName: String(serverName || existing?.serverName || '').slice(0, 80),
      version: String(version || existing?.version || '').slice(0, 40),
      apiKeyEnc: nextEnc,
    };
    const next = existing ? list.map((x) => (x.id === srvId ? entry : x)) : [entry, ...list.slice(0, 19)];
    st.set('homeServers', next);
    return sanitizePublicServer(entry);
  });
  h('hs-remove', ({ id }) => {
    st.set('homeServers', rawHomeServers().filter((x) => x.id !== id));
    return rawHomeServers().map(sanitizePublicServer);
  });
  h('hs-test', async ({ id, kind, url, apiKey } = {}) => {
    const existing = id ? rawHomeServers().find((x) => x.id === id) : null;
    const dec = existing ? decryptServer(existing) : null;
    const res = await homeServers.testServer({
      kind: kind || dec?.kind || 'jellyfin',
      url: url || dec?.url || '',
      apiKey: (typeof apiKey === 'string' && apiKey) ? apiKey : (dec?.apiKey || ''),
    });
    if (res.ok && existing) {
      const next = rawHomeServers().map((x) => (x.id === existing.id ? { ...x, userId: res.userId || x.userId, serverName: res.serverName || x.serverName, version: res.version || x.version } : x));
      st.set('homeServers', next);
    }
    return res;
  });
  h('hs-items', async ({ serverId, query = '', limit = 30 } = {}) => {
    const srvs = rawHomeServers().map(decryptServer);
    const targets = serverId ? srvs.filter((x) => x.id === serverId) : srvs;
    if (!targets.length) return [];
    const batches = await Promise.all(targets.map((srv) => homeServers.listServerItems(srv, { query, limit }).catch(() => [])));
    return batches.flat();
  });
  h('hs-stream', async ({ serverId, itemId } = {}) => {
    const srv = rawHomeServers().find((x) => x.id === serverId);
    if (!srv) throw new Error('server_not_found');
    return homeServers.resolveServerStream(decryptServer(srv), itemId);
  });
  h('hs-watched', async ({ serverId, itemId, watched = true } = {}) => {
    const srv = rawHomeServers().find((x) => x.id === serverId);
    if (!srv) return false;
    return homeServers.syncServerWatched(decryptServer(srv), itemId, !!watched);
  });
  h('notifications', () => notifs.list(profile()));
  h('notif-read', ({ ids, all }) => notifs.markRead(profile(), { ids, all }));
  h('notif-test', async () => {
    const args = { prof: profile(), library: library(), fetchMeta: (type, id) => fetchMeta({ type, id }) };
    const r = await notifs.checkTodaysReleases(args).catch(() => ({ added: [] }));
    const item = r.added?.[0] || notifs.list(profile()).items?.[0];
    let desktopSent = false;
    if (notify) {
      desktopSent = !!notify({
        title: item ? item.name : (lang() === 'ar' ? 'إشعارات مجلس جاهزة' : 'Majlis Notifications Ready'),
        body: item ? item.title : (lang() === 'ar' ? 'ستصلك إشعارات الحلقات والأفلام الجديدة اليوم تلقائياً.' : 'New library episodes and today releases will appear here.'),
        route: 'calendar',
        force: true,
      });
    }
    const testItem = item || {
      name: lang() === 'ar' ? 'اختبار إشعارات مجلس' : 'Majlis Test Notification',
      title: lang() === 'ar' ? 'ويبهوك الإشعارات متصل ويعمل بنجاح.' : 'Notification webhook is connected and active.',
    };
    const wh = await dispatchNotificationWebhooks({
      discordWebhookUrl: st.get('discordWebhookUrl'),
      telegramBotToken: st.get('telegramBotToken'),
      telegramChatId: st.get('telegramChatId'),
      items: [testItem],
    }).catch(() => ({ discord: { attempted: false, ok: false }, telegram: { attempted: false, ok: false } }));
    return { ok: true, added: r.added?.length || 0, desktop: desktopSent, discord: wh.discord, telegram: wh.telegram };
  });
  const notifBoot = setTimeout(() => checkNotifs(false), 30000);
  notifBoot.unref?.();
  const notifTimer = setInterval(() => checkNotifs(false), CHECK_INTERVAL);
  notifTimer.unref?.();

  // ---- Track 4: Cache Cap, Image Data URL (for Collage), Encrypted .majlis-profile, Diagnostics
  h('cache-stats', () => getCacheManager()?.stats() || { totalBytes: 0, diskBytes: 0, chromiumBytes: 0, limitGb: st.get('maxCacheGb') ?? 5, limitBytes: 0, streamDir: '', categories: {} });
  h('cache-clear', async ({ category = 'all' } = {}) => {
    const cat = String(category || 'all').toLowerCase();
    if (cat === 'metadata') http.forget('');
    if (cat === 'thumbs') return { ok: true, removedFiles: 0, freedBytes: 0 };
    return getCacheManager()?.clear(category) || { ok: false, removedFiles: 0, freedBytes: 0 };
  });
  h('player-probes', () => {
    const svpCands = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'SVP 4', 'SVPManager.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SVP 4', 'SVPManager.exe'),
    ];
    const shaders = listInstalledShaders(dataDir);
    return {
      mpv: findExternalPlayer('mpv'),
      vlc: findExternalPlayer('vlc'),
      ffmpeg: (typeof getFfmpeg === 'function' ? getFfmpeg() : null) || null,
      svp: svpCands.find((p) => fs.existsSync(p)) || null,
      shaders: { dir: shaders.dir, count: shaders.files.length, files: shaders.files.map((f) => path.basename(f)) },
    };
  });
  h('p2p-status', async () => {
    let port = null;
    try { if (svc?.base) port = Number(new URL(svc.base).port) || null; } catch {}
    const act = await svc?.active?.().catch(() => null);
    return {
      running: !!svc?.p,
      port,
      activeFiles: Array.isArray(act?.files) ? act.files.length : 0,
      cacheDir: st.get('cachePath') || '',
    };
  });

  h('image-data-url', async ({ url } = {}) => {
    let u;
    try { u = new URL(String(url || '')); } catch { throw new Error('invalid_url'); }
    if (u.protocol !== 'https:') throw new Error('https_required');
    if (http.isPrivateHost(u.hostname)) throw new Error('private_host_blocked');
    const r = await fetch(u.toString(), { headers: { 'user-agent': 'Majlis' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`http_${r.status}`);
    const ct = String(r.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!ct.startsWith('image/')) throw new Error('not_an_image');
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 5 * 1024 * 1024) throw new Error('image_too_large');
    return `data:${ct};base64,${Buffer.from(ab).toString('base64')}`;
  });

  h('export-data', async ({ passphrase, sections, includeKeys = false, settingsV2, profileV1 } = {}) => {
    const pick = new Set(Array.isArray(sections) && sections.length ? sections : ['addons', 'themes', 'library', 'settings']);
    const payload = { exportedAt: Date.now(), profileName: profile(), sections: [...pick] };
    if (pick.has('addons')) {
      payload.addons = addons();
      payload.disabledAddons = [...disabledSet()];
    }
    if (pick.has('themes')) {
      payload.look = lookOf(profile());
      payload.cinemaTheme = st.get('cinemaTheme') || 'majlis';
      payload.socialProfile = st.socialProfile?.() || null;
      if (profileV1 && typeof profileV1 === 'object') payload.profileV1 = profileV1;
    }
    if (pick.has('library')) {
      const lib = library();
      payload.library = { items: lib.items, history: lib.history, watchlist: lib.watchlist, favorites: lib.favorites };
      payload.letterboxd = pget('letterboxd') || {};
      payload.mediaTune = pget('mediaTune') || {};
      payload.homePrefs = pget('homePrefs') || null;
    }
    if (pick.has('settings')) {
      payload.settings = st.all();
      if (settingsV2 && typeof settingsV2 === 'object') payload.settingsV2 = settingsV2;
    }
    if (includeKeys) payload.mediaKeys = userKeys();

    const encrypted = await encryptProfileBundle(payload, passphrase, { includeKeys: !!includeKeys });
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(getWin?.(), {
      defaultPath: `majlis-profile-${profile()}-${stamp}.majlis-profile`,
      filters: [{ name: 'Majlis Encrypted Profile', extensions: ['majlis-profile'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(`${res.filePath}.tmp`, encrypted, 'utf8');
    fs.renameSync(`${res.filePath}.tmp`, res.filePath);
    return { ok: true, filePath: res.filePath, bytes: Buffer.byteLength(encrypted, 'utf8') };
  });

  h('import-data', async ({ passphrase, mode = 'merge', sections, rawText } = {}) => {
    let text = typeof rawText === 'string' && rawText ? rawText : '';
    if (!text) {
      const picked = await dialog.showOpenDialog(getWin?.(), {
        properties: ['openFile'],
        filters: [{ name: 'Majlis Encrypted Profile', extensions: ['majlis-profile'] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      text = fs.readFileSync(picked.filePaths[0], 'utf8');
    }
    const bundle = await decryptProfileBundle(text, passphrase);
    const allow = Array.isArray(sections) && sections.length ? new Set(sections) : new Set(bundle.sections || ['addons', 'themes', 'library', 'settings']);
    const summary = { addons: 0, libraryItems: 0, merged: mode !== 'replace' };

    if (allow.has('addons') && Array.isArray(bundle.addons)) {
      const cur = mode === 'replace' ? [] : addons();
      const next = [...new Set([...cur, ...bundle.addons.map((u) => normalizeUrl(u)).filter(Boolean)])];
      pset('addons', next);
      if (Array.isArray(bundle.disabledAddons)) {
        const off = mode === 'replace' ? [] : [...disabledSet()];
        pset('disabledAddons', [...new Set([...off, ...bundle.disabledAddons])]);
      }
      summary.addons = bundle.addons.length;
    }
    if (allow.has('themes')) {
      if (bundle.look) st.set('mediaLooks', { ...looks(), [profile()]: { ...lookOf(profile()), ...bundle.look } });
      if (bundle.cinemaTheme) st.set('cinemaTheme', bundle.cinemaTheme);
      if (bundle.socialProfile) st.setSocialProfile?.(bundle.socialProfile);
    }
    if (allow.has('library') && bundle.library) {
      const safe = String(profile() || 'default').replace(/[^\w-]/g, '_');
      const libFile = path.join(dataDir, 'media', safe, 'library.json');
      const bl = bundle.library;
      if (mode === 'replace') {
        fs.mkdirSync(path.dirname(libFile), { recursive: true });
        fs.writeFileSync(`${libFile}.tmp`, JSON.stringify({
          items: bl.items || {},
          history: Array.isArray(bl.history) ? bl.history : [],
          watchlist: Array.isArray(bl.watchlist) ? bl.watchlist : [],
          favorites: Array.isArray(bl.favorites) ? bl.favorites : [],
        }));
        fs.renameSync(`${libFile}.tmp`, libFile);
        libs.delete(profile());
        summary.libraryItems = Object.keys(bl.items || {}).length;
      } else {
        const curLib = library();
        const remoteList = Object.values(bl.items || {});
        if (remoteList.length) curLib.merge(remoteList);
        for (const listName of ['watchlist', 'favorites']) {
          for (const entry of Array.isArray(bl[listName]) ? bl[listName] : []) {
            if (entry?.id && !curLib[listName].some((x) => x.id === entry.id)) curLib[listName].push(entry);
          }
        }
        curLib._save();
        libs.clear();
        summary.libraryItems = remoteList.length;
      }
      if (bundle.letterboxd) pset('letterboxd', mode === 'replace' ? bundle.letterboxd : { ...(pget('letterboxd') || {}), ...bundle.letterboxd });
      if (bundle.mediaTune) pset('mediaTune', mode === 'replace' ? bundle.mediaTune : { ...(pget('mediaTune') || {}), ...bundle.mediaTune });
      if (bundle.homePrefs) pset('homePrefs', bundle.homePrefs);
    }
    if (allow.has('settings') && bundle.settings) {
      const safePatch = {};
      const PROTECTED_IN_BUNDLE = new Set(['server', 'accessKey', 'discordWebhookUrl', 'telegramBotToken', 'installerPrefsApplied']);
      for (const [k, v] of Object.entries(bundle.settings)) {
        if (!PROTECTED_IN_BUNDLE.has(k)) safePatch[k] = v;
      }
      st.patch(safePatch);
    }
    if (bundle.mediaKeys && Object.keys(bundle.mediaKeys).length) {
      st.set('mediaKeys', { ...userKeys(), ...bundle.mediaKeys });
    }
    st.flush();
    return {
      ok: true,
      summary,
      settingsV2: allow.has('settings') ? (bundle.settingsV2 || null) : null,
      profileV1: allow.has('themes') ? (bundle.profileV1 || null) : null,
    };
  });

  h('updater-check', async ({ betaChannel = false } = {}) => {
    const currentVersion = app?.getVersion?.() || '0.1.1-beta';
    try {
      const res = await updater.checkForUpdates({ currentVersion, betaChannel: !!betaChannel });
      return { ...res, packaged: !!app?.isPackaged };
    } catch (err) {
      return {
        ok: false,
        version: currentVersion,
        currentVersion,
        packaged: !!app?.isPackaged,
        updateAvailable: false,
        error: err?.message || 'update check failed',
        checkedAt: Date.now(),
      };
    }
  });

  h('updater-download', async ({ url, sha256Url, assetName } = {}) => {
    const destDir = path.join(dataDir, 'updates');
    return updater.downloadUpdate({
      url,
      sha256Url,
      destDir,
      fileName: assetName || 'Majlis-Setup.exe',
      onProgress: (p) => emit('updater:progress', p),
    });
  });

  h('updater-install', async ({ filePath } = {}) => {
    const updatesRoot = path.resolve(path.join(dataDir, 'updates'));
    const target = path.resolve(String(filePath || ''));
    const rel = path.relative(updatesRoot, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Invalid installer path');
    }
    return updater.installDownloadedUpdate(target, { app });
  });

  h('library-repair', () => {
    const res = library().repair();
    st.flush();
    return { ok: true, ...res };
  });

  h('library-audit', () => {
    const res = library().repair();
    return { ok: true, ...res };
  });

  async function runDiagnostics() {
    const hooks = getDiagnosticsHooks?.() || {};
    const th = typeof hooks.theater === 'function' ? hooks.theater() : hooks.theater;
    const netObj = typeof hooks.net === 'function' ? hooks.net() : hooks.net;
    const ffPath = (typeof getFfmpeg === 'function' ? getFfmpeg() : null) || hooks.ffmpegPath?.() || null;
    const encList = hooks.encoders?.() || [];
    const cap = (p, ms = 3500) => Promise.race([
      Promise.resolve(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);

    const probeTasks = [
      cap((async () => {
        const libDll = libmpvPath();
        const libOk = !!libDll && fs.existsSync(libDll);
        const mpvBin = findExternalPlayer('mpv') || (fs.existsSync(mpvPath()) ? mpvPath() : null);
        const shaders = listInstalledShaders(dataDir);
        const coreVer = hooks.coreVersion?.() || null;
        const ok = libOk || !!mpvBin;
        return {
          id: 'player',
          status: libOk && coreVer ? 'ok' : ok ? 'warn' : 'fail',
          summary: libOk ? `libmpv OK${coreVer ? ` · core ${coreVer}` : ''}` : (mpvBin ? 'Fallback mpv.exe only' : 'No player engine found'),
          fixId: shaders.files.length ? 'clear_shader_cache' : 'reset_player',
          details: { libmpv: libOk, mpvFallback: !!mpvBin, coreVersion: coreVer, shaderCount: shaders.files.length },
        };
      })()),
      cap((async () => {
        const exe = mediaExePath();
        const exists = !!exe && fs.existsSync(exe);
        const act = svc?.p ? await svc.active().catch(() => null) : null;
        return {
          id: 'p2p',
          status: !exists ? 'fail' : (svc?.p && !act) ? 'warn' : 'ok',
          summary: !exists ? 'majlis-media.exe missing' : svc?.p ? `Running (${Array.isArray(act?.files) ? act.files.length : 0} active)` : 'Standby (on-demand)',
          fixId: 'restart_media_svc',
          details: { exists, running: !!svc?.p, activeFiles: Array.isArray(act?.files) ? act.files.length : 0 },
        };
      })()),
      cap((async () => {
        const list = addons();
        const deadUrls = list.filter((u) => client.isDead(u));
        const cinReachable = await raceCap(http.json(`${CINEMETA}/manifest.json`, { ttl: 60000 }).then(() => true, () => false), 3000);
        const tmdb = meta.tmdbOn();
        const status = !cinReachable || deadUrls.length === list.length ? 'fail' : (deadUrls.length > 0 || !tmdb ? 'warn' : 'ok');
        return {
          id: 'addons',
          status,
          summary: `${list.length - deadUrls.length}/${list.length} healthy · Cinemeta ${cinReachable ? 'UP' : 'DOWN'}`,
          fixId: 'reset_addons',
          details: { installed: list.length, dead: deadUrls.length, cinemeta: !!cinReachable, tmdbConfigured: tmdb },
        };
      })()),
      cap((async () => {
        const registered = !!netObj?.registered;
        const relayCount = Array.isArray(netObj?.relays) ? netObj.relays.length : 0;
        return {
          id: 'network',
          status: registered ? 'ok' : 'warn',
          summary: registered ? `Online · ${relayCount} relays (${netObj?.wsSig ? 'wss' : 'udp'})` : 'Not registered yet',
          fixId: 'reconnect_net',
          details: { registered, relayCount, transport: netObj?.wsSig ? 'wss/tcp' : 'udp' },
        };
      })()),
      cap((async () => {
        const cs = getCacheManager()?.stats?.() || { totalBytes: 0, limitBytes: 0, limitGb: 5, categories: {} };
        const overCap = cs.limitBytes > 0 && cs.totalBytes > cs.limitBytes;
        const totalMb = Math.round((cs.totalBytes || 0) / (1024 * 1024));
        return {
          id: 'cache',
          status: overCap ? 'warn' : 'ok',
          summary: `${totalMb} MB / ${cs.limitGb || 0} GB cap`,
          fixId: overCap ? 'enforce_cache' : 'clear_http_cache',
          details: cs,
        };
      })()),
      cap((async () => {
        const curLib = library();
        const entries = Object.entries(curLib.items || {});
        let bad = 0;
        for (const [k, raw] of entries) {
          if (!raw || typeof raw !== 'object' || !k || typeof raw.name !== 'string' || !raw.state || typeof raw.state !== 'object') bad++;
        }
        return {
          id: 'library',
          status: bad > 0 ? 'warn' : 'ok',
          summary: `${entries.length} items${bad ? ` · ${bad} anomalies` : ''}`,
          fixId: 'repair_library',
          details: { items: entries.length, watchlist: curLib.watchlist?.length || 0, favorites: curLib.favorites?.length || 0, anomalies: bad },
        };
      })()),
      cap((async () => {
        const ok = !!ffPath;
        return {
          id: 'encoders',
          status: !ok ? 'fail' : encList.length ? 'ok' : 'warn',
          summary: !ok ? 'FFmpeg not found' : (encList.length ? `FFmpeg OK (${encList.map((e) => e.fam).join(', ')})` : 'FFmpeg CPU fallback'),
          fixId: 'fetch_ffmpeg',
          details: { ffmpeg: ffPath, encoders: encList.map((e) => ({ fam: e.fam, codec: e.codec, name: e.name || e.encoder })) },
        };
      })()),
    ];

    const settled = await Promise.allSettled(probeTasks);
    const ids = ['player', 'p2p', 'addons', 'network', 'cache', 'library', 'encoders'];
    const checks = settled.map((s, idx) => (s.status === 'fulfilled'
      ? s.value
      : { id: ids[idx], status: 'fail', summary: String(s.reason?.message || 'probe failed'), details: {} }));
    const secrets = [
      st.get('accessKey'),
      st.get('discordWebhookUrl'),
      st.get('telegramBotToken'),
      st.get('roomPin'),
      ...Object.values(userKeys()),
      ...Object.values(BUILD.mediaKeys || {}),
    ];
    return scrubDiagnosticsReport({
      checkedAt: Date.now(),
      version: app?.getVersion?.() || '0.1.1-beta',
      platform: process.platform,
      arch: process.arch,
      profile: profile(),
      playing: !!th?.info?.(),
      checks,
    }, secrets);
  }

  h('diagnostics-run', () => runDiagnostics());

  h('diagnostics-heal', async ({ fixId } = {}) => {
    const hooks = getDiagnosticsHooks?.() || {};
    const th = typeof hooks.theater === 'function' ? hooks.theater() : hooks.theater;
    const netObj = typeof hooks.net === 'function' ? hooks.net() : hooks.net;
    const activePlayback = !!th?.info?.();
    const runOne = async (id) => {
      switch (id) {
        case 'reset_addons':
          client.resetHealth();
          http.forget('');
          return { id, ok: true };
        case 'restart_media_svc':
          if (activePlayback) return { id, ok: false, blocked: 'active_playback' };
          svc?.stop?.(true);
          return { id, ok: true };
        case 'clear_shader_cache':
          return { id, ok: true, ...(await (getCacheManager()?.clear?.('shaders') || { ok: true })) };
        case 'enforce_cache':
          return { id, ok: true, ...(await (getCacheManager()?.enforce?.({ aggressive: true }) || { ok: true })) };
        case 'clear_http_cache':
          http.forget('');
          return { id, ok: true, ...(await (getCacheManager()?.clear?.('http') || { ok: true })) };
        case 'repair_library': {
          const r = library().repair();
          st.flush();
          return { id, ok: true, ...r };
        }
        case 'fetch_ffmpeg': {
          const exe = await hooks.ensureFfmpeg?.().catch(() => null);
          return { id, ok: !!exe };
        }
        case 'reconnect_net':
          try { netObj?.stop?.(); await netObj?.start?.(); return { id, ok: true }; } catch (e) { return { id, ok: false, error: e.message }; }
        case 'reset_player':
          if (activePlayback) th?.close?.();
          await getCacheManager()?.clear?.('shaders');
          st.set('playerAspect', 'fit');
          st.set('playerToneMapping', 'bt.2446a');
          return { id, ok: true };
        default:
          return { id, ok: false, error: 'unknown_fix' };
      }
    };
    if (fixId === 'heal_all') {
      const steps = ['reset_addons', 'clear_shader_cache', 'clear_http_cache', 'repair_library', 'enforce_cache'];
      if (!activePlayback) steps.push('restart_media_svc');
      const results = [];
      for (const s of steps) results.push(await runOne(s));
      return { ok: true, results, report: await runDiagnostics() };
    }
    const res = await runOne(fixId);
    return { ...res, report: await runDiagnostics() };
  });

  // ---- profiles and preferences
  // the look is per profile ({ avatar, accent, theme, song }); playback and debrid choices are per machine
  const GLOBAL = {
    mediaMaxHeight: 'number', mediaVsr: 'boolean', debridService: 'string', debridOnly: 'boolean',
    autoNext: 'boolean', subLang2: 'string', subFilterSdh: 'boolean', subAutoSync: 'boolean',
    cinemaOnboarded: 'boolean', cinemaHideWatched: 'boolean', cinemaHideUnreleased: 'boolean', cinemaAutoPlayTrailer: 'boolean',
    playerExternalMpv: 'boolean', playerHwAccel: 'boolean', playerHdr: 'boolean', playerToneMapping: 'string',
    playerBufferSize: 'string', playerAnime4k: 'boolean', playerAnime4kMode: 'string', playerCustomMpvConf: 'string',
    safetyFilter: 'string', resultOrder: 'string', sourceWaitSec: 'number',
    autoSkipIntros: 'boolean', autoSkipRecaps: 'boolean', autoSkipCredits: 'boolean', showSkipButton: 'boolean',
    autoSkipStalled: 'boolean', cinemaPerfMode: 'boolean',
  };
  const THEMES = ['majlis', 'oled', 'nord', 'dracula', 'noir', 'obsidian', 'roast', 'forest', 'custom'];
  const looks = () => st.get('mediaLooks') || {};
  const lookOf = (p) => ({ avatar: null, accent: null, theme: 'majlis', song: null, ...(looks()[p] || {}) });
  const profileList = () => ['default', ...(st.get('mediaProfiles') || [])];
  h('prefs', () => ({
    profile: profile(), look: lookOf(profile()), profiles: profileList().map((name) => ({ name, ...lookOf(name) })),
    downloadDir: folder(), perf: process.env.MAJLIS_PERF === '1' || !!st.get('cinemaPerfMode'),
    incognito: !!isIncognito?.(),
    subStyle: st.get('subStyle') || null,
    streamPriorityOrder: Array.isArray(st.get('streamPriorityOrder')) ? st.get('streamPriorityOrder') : ['Debrid', 'Addon', 'Server', 'Direct'],
    streamRules: st.get('streamRules') || { preferHevc: false, prefer4kHdr: false, blockCamTs: true, maxSizeGb: 0, excludeKeywords: '' },
    ...Object.fromEntries(Object.keys(GLOBAL).map((k) => [k, st.get(k) ?? null])),
  }));
  h('prefs-set', (patch) => {
    for (const [k, type] of Object.entries(GLOBAL)) if (k in patch && (patch[k] === null || typeof patch[k] === type)) st.set(k, patch[k]);
    if (patch.streamRules && typeof patch.streamRules === 'object') {
      const r = patch.streamRules;
      st.set('streamRules', {
        preferHevc: !!r.preferHevc,
        prefer4kHdr: !!r.prefer4kHdr,
        blockCamTs: r.blockCamTs !== false,
        maxSizeGb: Math.max(0, Math.min(200, Number(r.maxSizeGb) || 0)),
        excludeKeywords: typeof r.excludeKeywords === 'string' ? r.excludeKeywords.slice(0, 200) : '',
      });
    }
    if (patch.subStyle && typeof patch.subStyle === 'object') {
      const x = patch.subStyle;
      st.set('subStyle', {
        font: typeof x.font === 'string' ? x.font.slice(0, 64) : 'Segoe UI',
        background: ['outline', 'shadow', 'bar'].includes(x.background) ? x.background : 'outline',
        outlinePx: Number.isFinite(Number(x.outlinePx)) ? Math.max(0, Math.min(6, Number(x.outlinePx))) : 3,
        sizePct: Number.isFinite(Number(x.sizePct)) ? Math.max(40, Math.min(300, Number(x.sizePct))) : 100,
        bold: !!x.bold,
        opacityPct: Number.isFinite(Number(x.opacityPct)) ? Math.max(10, Math.min(100, Number(x.opacityPct))) : 95,
        bottomPct: Number.isFinite(Number(x.bottomPct)) ? Math.max(0, Math.min(50, Number(x.bottomPct))) : 8,
        align: ['left', 'center', 'right'].includes(x.align) ? x.align : 'center',
        color: /^#[0-9a-f]{6}$/i.test(String(x.color || '')) ? String(x.color).toUpperCase() : '#FFFFFF',
      });
    }
    if (Array.isArray(patch.streamPriorityOrder)) {
      st.set('streamPriorityOrder', patch.streamPriorityOrder.slice(0, 8).map((v) => String(v).slice(0, 48)));
    }
    if (patch.look) {
      const l = { ...lookOf(profile()) }, x = patch.look;
      if (x.theme && THEMES.includes(x.theme)) l.theme = x.theme;
      if (x.accent === null || /^#[0-9a-f]{6}$/i.test(x.accent || '')) l.accent = x.accent;
      // a picked emoji, catalog SVG, or an uploaded picture (already shrunk by the page to a small data URL)
      if (x.avatar === null || (typeof x.avatar === 'string' && (x.avatar.length <= 16 || (/^data:image\/((png|jpeg|webp);base64,|svg\+xml;utf8,)/.test(x.avatar) && x.avatar.length < 200000)))) l.avatar = x.avatar;
      if ('song' in x) l.song = x.song && typeof x.song === 'string' ? x.song.slice(0, 300) : null;
      st.set('mediaLooks', { ...looks(), [profile()]: l });
    }
    return true;
  });
  h('incognito-set', ({ on } = {}) => ({ on: !!setIncognito?.(!!on) }));
  h('cinema-stats', () => {
    const curLib = library();
    const prof = st.socialProfile?.(profile()) || {};
    return computeCinemaDashboard({
      items: curLib.items,
      history: curLib.history,
      watchLog: curLib.watchLog,
      partyHistory: st.partyHistory?.() || [],
      ratings: prof.ratings || [],
      seedGenresById: SEED_GENRES_BY_ID,
    });
  });
  h('song-set', async ({ url, start = 0 }) => {
    const r = await ytdlp.setSong({ dataDir, profile: profile(), url, start, getFfmpeg });
    const l = { ...lookOf(profile()), song: r.url };
    st.set('mediaLooks', { ...looks(), [profile()]: l });
    return r;
  });
  h('song-clear', () => {
    ytdlp.clearSong({ dataDir, profile: profile() });
    const l = { ...lookOf(profile()), song: null };
    st.set('mediaLooks', { ...looks(), [profile()]: l });
    return true;
  });
  h('song-get', ({ id } = {}) => ytdlp.getSong({ dataDir, profile: profile(), friendId: id || null }));
  h('profile-use', ({ name }) => {
    name = String(name || '').trim().slice(0, 24);
    if (!name) return profile();
    const list = st.get('mediaProfiles') || [];
    if (name !== 'default' && !list.includes(name)) st.set('mediaProfiles', [...list, name]);
    st.set('mediaProfile', name);
    onProfileChanged?.(name);
    return name;
  });
  h('profile-remove', ({ name }) => {
    if (!name || name === 'default') return false;
    const wasActive = profile() === name;
    st.set('mediaProfiles', (st.get('mediaProfiles') || []).filter((x) => x !== name));
    const l = { ...looks() }; delete l[name]; st.set('mediaLooks', l);
    libs.delete(name);
    if (st.d?.socialProfiles?.[name]) {
      delete st.d.socialProfiles[name];
      st.save?.();
    }
    if (wasActive) {
      st.set('mediaProfile', 'default');
      onProfileChanged?.('default');
    }
    return true;
  });

  // ---- keys (the user's own; built-in ones are never sent to the page)
  h('caps', () => ({ tmdb: meta.tmdbOn(), trakt: !!keys().trakt, stremio: !!pget('stremioKey'), debrid: debridService()?.name || null }));
  h('keys', () => ({ user: userKeys(), builtIn: Object.fromEntries(KEY_NAMES.map((k) => [k, !!BUILD.mediaKeys?.[k]])) }));
  h('keys-set', (patch) => {
    const k = { ...userKeys() };
    for (const n of KEY_NAMES) if (typeof patch[n] === 'string') k[n] = patch[n].trim().slice(0, 200);
    st.set('mediaKeys', k);
    http.forget('https://api.themoviedb.org');
    return true;
  });

  // for the player (theater.js): progress into the library
  // a finished download's file, for the player (by id: the page never hands mpv a path)
  const downloadFile = (id) => { const d = downloads.items.find((x) => x.id === id && x.state === 'done'); return d?.file && fs.existsSync(d.file) ? d.file : null; };
  const downloadStream = (id) => downloads.items.find((x) => x.id === id)?.stream || null;
  const getSong = (o = {}) => ytdlp.getSong({ dataDir, profile: profile(), ...o });
  const cacheFriendSong = (friendId, dataUrl) => ytdlp.cacheFriendSong({ dataDir, friendId, dataUrl });
  return {
    library, client, meta, fetchMeta, addons: enabledAddons, allAddons: addons, streams, subtitles,
    searchSubtitles: (opts = {}) => searchExternalSubtitles({ ...opts, keys: keys() }),
    skips, debrid: debridService, downloadFile, downloadStream, localFile, localEntry, registerDropFile,
    findFinishedDownload: (metaId, videoId) => downloads.findDone(metaId, videoId),
    getQueue: () => [...playQueue],
    setOnQueueChange: (fn) => { onQueueChanged = fn; },
    setQueue: (items, { fromParty = false } = {}) => {
      playQueue = sanitizeQueue(items);
      emit('cin:queue-updated', { items: playQueue });
      if (!fromParty) onQueueChanged?.(playQueue);
      return playQueue;
    },
    shiftQueue: () => {
      if (!playQueue.length) return null;
      const [head, ...rest] = playQueue;
      playQueue = rest;
      emit('cin:queue-updated', { items: playQueue });
      onQueueChanged?.(playQueue);
      return head;
    },
    streamsBucket, computeVideoHash,
    scrobble: (a, x, p) => (isIncognito?.() ? null : trackers.scrobble(a, x, p)),
    getSong, cacheFriendSong,
    reloadLibs: () => libs.clear(),
    flush: () => { clearTimeout(notifBoot); clearInterval(notifTimer); http.closeAgents(); for (const l of libs.values()) l.flush(); downloads.save(true); },
  };
}

module.exports = { setup, skipsForVideo, annotatePersonWatched, scrubDiagnosticsReport, normalizeTitle };
