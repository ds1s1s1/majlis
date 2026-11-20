'use strict';
// Social & Watch-Party Intelligence:
//  1. Community profiles (displayName, @handle, emoji/upload/catalog avatar, accent colour, song, bio, favourites, custom lists)
//  2. Friend system (9-digit ID, @handle lookup via server + P2P gossip, Discord majlis://friend/<id>, requests, block, live presence, signed P2P profile exchange + offline cache + privacy)
//  3. Party voting & Head-to-Head Comparison matrix (IMDb, RT, Letterboxd, MAL/AniList, audience count, year, genres, age rating, runtime, watched-by-friends row, best-per-row highlights)
//  4. 'Can't Decide?' Group Taste Matcher (pure group affinity scorer across everyone in the room, unwatched filter, mood/runtime/era/genre filters, 30s live Quick Swipe, synced Tie-Breaker Wheel)
//  5. Per-person accent colours across the party (roster, chat names, live cursors).

const crypto = require('crypto');
const { ipcMain } = require('electron');
const { deriveId, publicKeyFromRaw, signedBytes, verifyMsg, isId } = require('./ident');
const imp = require('./imports');
const http = require('./media/http');
const { CINEMETA, Meta } = require('./media/meta');
const { normalizeGenres, GENRE_TO_TMDB_ID } = require('./media/genres');
const { SEED_MOVIES, SEED_GENRES_BY_ID } = require('./media/seed-movies');

const now = () => Date.now();
const H = 3600000;
const MAX_SOCIAL_BYTES = 48000;
const MAX_ENVELOPE_BYTES = 65536;

// Built-in catalog of stylized SVG avatars (data URLs so <Avatar /> renders them everywhere without extra assets)
function svgAvatar(bg1, bg2, pathD) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><g fill="none" stroke="#fff8ec" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${pathD}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CATALOG_AVATARS = [
  { id: 'falcon', name: 'Saqr', url: svgAvatar('#d97706', '#78350f', '<path d="M18 44c4-14 14-24 28-26-2 10-8 18-16 22l8 8H24z"/><circle cx="38" cy="24" r="1.8" fill="#fff8ec"/>') },
  { id: 'crescent', name: 'Hilal', url: svgAvatar('#3e63dd', '#1e1b4b', '<path d="M40 38A14 14 0 0 1 26 20a14 14 0 1 0 18 18z"/><path d="M42 18v6M39 21h6"/>') },
  { id: 'cinema', name: 'Cinema', url: svgAvatar('#e5484d', '#4c0519', '<rect x="16" y="18" width="32" height="28" rx="4"/><path d="M16 26h32M24 18l4 8M36 18l4 8"/><path d="M28 33v8l8-4z" fill="#fff8ec"/>') },
  { id: 'oasis', name: 'Waha', url: svgAvatar('#12a594', '#064e3b', '<path d="M32 46V26"/><path d="M32 26c-6-6-14-4-16 2 6-2 12 0 16-2zm0 0c6-6 14-4 16 2-6-2-12 0-16-2zm0-2c-2-8-10-10-14-6 6 0 10 2 14 6zm0 0c2-8 10-10 14-6-6 0-10 2-14 6z"/><path d="M20 46h24"/>') },
  { id: 'wolf', name: 'Dhib', url: svgAvatar('#8e4ec6', '#2e1065', '<path d="M20 20l4 10 8-4 8 4 4-10-2 24-10 6-10-6z"/><circle cx="27" cy="34" r="1.5" fill="#fff8ec"/><circle cx="37" cy="34" r="1.5" fill="#fff8ec"/>') },
  { id: 'dallah', name: 'Dallah', url: svgAvatar('#e2a43a', '#451a03', '<path d="M26 22h12l-2 22H28z"/><path d="M24 22c-6 0-10 4-12 10 4 0 8-2 10-4"/><path d="M38 26c4 0 6 4 6 8s-2 8-6 8"/><path d="M29 17h6l-3-4z"/>') },
  { id: 'sadu', name: 'Sadu', url: svgAvatar('#d6409f', '#500724', '<path d="M32 16l14 16-14 16-14-16z"/><path d="M32 24l7 8-7 8-7-8z"/>') },
  { id: 'orbit', name: 'Falak', url: svgAvatar('#0284c7', '#082f49', '<circle cx="32" cy="32" r="7"/><ellipse cx="32" cy="32" rx="18" ry="7" transform="rotate(-28 32 32)"/>') },
];

const FALLBACK_ACCENTS = ['#e2a43a', '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#22d3ee'];
const CATALOG_AVATAR_URLS = new Set(CATALOG_AVATARS.map((x) => x.url));
function accentForId(id, explicit) {
  if (explicit && /^#[0-9a-f]{6}$/i.test(explicit)) return explicit;
  const n = parseInt(String(id || '0').replace(/\D/g, '').slice(-4) || '0', 10);
  return FALLBACK_ACCENTS[n % FALLBACK_ACCENTS.length];
}

function encodeSignedFriendCode(store, { compact = false } = {}) {
  const idn = store.identity();
  const id = idn.id;
  const sp = store.socialProfile?.() || {};
  const pk = Buffer.from(idn.pkB64, 'base64').toString('base64url');
  const s = Number(idn.salt) || 0;
  const n = String(sp.displayName || store.get('nick') || '').trim().slice(0, 40);
  const h = normalizeHandle(sp.handle || store.get('handle') || '');
  const a = accentForId(id, sp.accent || store.get('accent'));
  const canonical = { t: 'friend_card', v: 1, id, pk, s, n, h, a };
  const sig = idn.sign(signedBytes(canonical)).toString('base64url');
  if (compact) {
    return `MAJLIS-F1:${Buffer.from(JSON.stringify({ v: 1, id, pk, s, n, h, a, sig }), 'utf8').toString('base64url')}`;
  }
  const q = new URLSearchParams({ v: '1', pk, s: String(s), ...(n ? { n } : {}), ...(h ? { h } : {}), a, sig });
  return `majlis://friend/${id}?${q.toString()}`;
}

function verifySignedFriendCode(raw) {
  try {
    let text = String(raw || '').trim();
    if (!text) return null;
    if (/^majlis:\/\/friend\//i.test(text) && !/^majlis:\/\/friend\/\d{9}\?/i.test(text)) {
      let rest = text.replace(/^majlis:\/\/friend\//i, '').replace(/\/+$/, '');
      try { rest = decodeURIComponent(rest); } catch {}
      if (rest.startsWith('MAJLIS-F1:')) text = rest;
    }
    let data = null;
    if (text.startsWith('MAJLIS-F1:')) {
      data = JSON.parse(Buffer.from(text.slice(10), 'base64url').toString('utf8'));
    } else if (/^majlis:\/\/friend\/\d{9}\?/i.test(text)) {
      const u = new URL(text);
      const id = u.pathname.replace(/^\/+/, '').slice(0, 9);
      const q = u.searchParams;
      data = {
        v: Number(q.get('v') || 1),
        id,
        pk: q.get('pk') || '',
        s: Number(q.get('s') || 0),
        n: q.get('n') || '',
        h: q.get('h') || '',
        a: q.get('a') || '',
        sig: q.get('sig') || '',
      };
    } else {
      return null;
    }
    if (!data || data.v !== 1 || !isId(String(data.id || '')) || !data.pk || !data.sig) return null;
    const pkBuf = Buffer.from(String(data.pk), 'base64url');
    const sigBuf = Buffer.from(String(data.sig), 'base64url');
    if (pkBuf.length !== 32 || sigBuf.length !== 64) return null;
    const salt = Number(data.s) || 0;
    if (deriveId(pkBuf, salt) !== data.id) return null;
    const n = String(data.n || '').trim().slice(0, 40);
    const h = normalizeHandle(data.h || '');
    const a = accentForId(data.id, data.a);
    const canonical = { t: 'friend_card', v: 1, id: data.id, pk: String(data.pk), s: salt, n, h, a };
    const ok = crypto.verify(null, signedBytes(canonical), publicKeyFromRaw(pkBuf), sigBuf);
    if (!ok) return null;
    return {
      id: data.id,
      pkB64: pkBuf.toString('base64'),
      salt,
      name: n || data.id,
      handle: isValidHandle(h) ? h : '',
      accent: a,
    };
  } catch {
    return null;
  }
}
function sanitizeAvatar(av) {
  if (!av || typeof av !== 'string') return null;
  if (CATALOG_AVATAR_URLS.has(av)) return av;
  if (/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]{1,200000}$/i.test(av)) return av;
  if (/^https:\/\/[^\s<>"']{1,400}$/i.test(av)) return av;
  if (av.length <= 16 && !/[<>:"'/\\]/.test(av)) return av;
  return null;
}
function sanitizeSongDataUrl(s) {
  if (typeof s !== 'string' || s.length >= 30000) return null;
  return /^data:audio\/(?:ogg|mpeg|mp4|webm|wav|aac);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
}

// @handle: 3-24 chars [a-z0-9_], must contain at least one letter or underscore so it never collides with 9-digit Majlis IDs
function normalizeHandle(raw) {
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}
function isValidHandle(raw) {
  const h = normalizeHandle(raw);
  return /^[a-z0-9_]{3,24}$/.test(h) && !/^\d+$/.test(h);
}

// Verify a signed P2P social envelope received over the signaling channel
function verifySocialEnvelope(m, nowMs = now()) {
  if (!m || typeof m !== 'object') return false;
  if (!isId(m.from) || typeof m.pk !== 'string' || typeof m.sig !== 'string') return false;
  if (typeof m.ts !== 'number' || Math.abs(nowMs - m.ts) > 180000) return false;
  const raw = JSON.stringify(m);
  if (raw.length > MAX_ENVELOPE_BYTES) return false;
  let pkBuf;
  try { pkBuf = Buffer.from(m.pk, 'base64'); } catch { return false; }
  if (pkBuf.length !== 32 || deriveId(pkBuf, m.salt | 0) !== m.from) return false;
  return verifyMsg(m, m.pk);
}

// Build a size-capped P2P profile response respecting the user's privacy setting (shareHistory: 'friends' | 'none')
function buildSharedProfilePayload({ profile, library, letterboxd, tune, songDataUrl = null, comments = [], maxBytes = MAX_SOCIAL_BYTES }) {
  const shareHist = profile.shareHistory !== 'none';
  const libFavs = (library?.favorites || []).map((x) => ({
    id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null,
  }));
  const favMap = new Map();
  for (const f of [...(profile.favorites || []), ...libFavs]) if (f?.id && !favMap.has(f.id)) favMap.set(f.id, f);
  const favorites = [...favMap.values()].slice(0, 20);

  const lists = (profile.lists || []).slice(0, 15).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description || '',
    items: (l.items || []).slice(0, 40).map((x) => ({ id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null })),
  }));

  let history = [];
  let ratings = [];
  if (shareHist) {
    history = (library?.history || []).slice(0, 40).map((h) => ({
      id: h.id, videoId: h.videoId || null, type: h.type || 'movie', name: h.name, poster: h.poster || null, at: h.at || 0,
    }));
    const rMap = new Map();
    for (const [k, v] of Object.entries(letterboxd || {})) {
      if (!v || (!v.rating && !v.review && !v.watched)) continue;
      rMap.set(k, {
        id: v.id || null,
        name: String(v.name || '').slice(0, 120),
        year: v.year ? Number(String(v.year).slice(0, 4)) || null : null,
        watched: !!v.watched,
        rating: Number.isFinite(+v.rating) ? +v.rating : null,
        review: typeof v.review === 'string' ? v.review.slice(0, 400) : null,
      });
    }
    for (const r of Array.isArray(profile.ratings) ? profile.ratings : []) {
      const k = r?.id;
      if (!k || rMap.has(k)) continue;
      rMap.set(k, {
        id: k,
        name: String(r.title || k).slice(0, 120),
        poster: r.poster || null,
        year: null,
        watched: true,
        rating: Number.isFinite(+r.score) ? +r.score : null,
        scale: 10,
        review: null,
        genres: [],
      });
    }
    for (const [id, t] of Object.entries(tune || {})) {
      if (!t?.v) continue;
      const it = library?.items?.[id];
      if (!rMap.has(id)) {
        rMap.set(id, {
          id,
          name: it?.name || id,
          poster: it?.poster || null,
          year: null,
          watched: true,
          rating: t.v > 0 ? 5 : 2,
          review: null,
          genres: t.genres || [],
        });
      }
    }
    ratings = [...rMap.values()].slice(0, 60);
  }

  const out = {
    id: profile.id,
    displayName: String(profile.displayName || profile.id || '').slice(0, 40),
    handle: profile.handle || '',
    avatar: profile.avatar || null,
    accent: accentForId(profile.id, profile.accent),
    bio: String(profile.bio || '').slice(0, 280),
    song: profile.song || null,
    songDataUrl: songDataUrl && songDataUrl.length < 22000 ? songDataUrl : null,
    shareHistory: shareHist ? 'friends' : 'none',
    historyHidden: !shareHist,
    favorites,
    lists,
    history,
    ratings,
    comments: Array.isArray(comments) ? comments.slice(0, 20) : [],
    ...(profile.customProfile ? { customProfile: profile.customProfile } : {}),
    updatedAt: now(),
  };

  // Enforce strict size cap for P2P signaling relay
  if (JSON.stringify(out).length > maxBytes) out.songDataUrl = null;
  if (JSON.stringify(out).length > maxBytes && out.avatar && out.avatar.startsWith('data:image/') && out.avatar.length > 8000) out.avatar = null;
  if (JSON.stringify(out).length > maxBytes && out.customProfile) delete out.customProfile;
  while (JSON.stringify(out).length > maxBytes && out.comments.length > 5) out.comments.pop();
  while (JSON.stringify(out).length > maxBytes && out.ratings.length > 10) out.ratings.pop();
  while (JSON.stringify(out).length > maxBytes && out.history.length > 10) out.history.pop();
  return out;
}

// Parse runtime strings ("170 min", "2h 28m", 148) -> integer minutes
function parseRuntimeMin(rt) {
  if (typeof rt === 'number' && Number.isFinite(rt) && rt > 0) return Math.round(rt);
  const s = String(rt || '').trim();
  if (!s) return null;
  const hm = /(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m)?/i.exec(s);
  if (hm) return (+hm[1] * 60) + (+(hm[2] || 0));
  const m = /(\d+)\s*(?:min|m|د)/i.exec(s) || /^(\d+)$/.exec(s);
  return m ? +m[1] : null;
}

// Pure comparison matrix row winner calculator
function computeCompareHighlights(columns) {
  const best = { imdb: [], rt: [], letterboxd: [], mal: [], audience: [], year: [], runtimeMin: [], unwatched: [] };
  if (!Array.isArray(columns) || !columns.length) return { best, sharedGenres: [] };

  const maxRow = (key, getter) => {
    const vals = columns.map((c) => ({ id: c.id, v: getter(c) })).filter((x) => typeof x.v === 'number' && Number.isFinite(x.v) && x.v > 0);
    if (!vals.length) return;
    const top = Math.max(...vals.map((x) => x.v));
    best[key] = vals.filter((x) => Math.abs(x.v - top) < 1e-6).map((x) => x.id);
  };
  const minRow = (key, getter, allowZero = false) => {
    const vals = columns.map((c) => ({ id: c.id, v: getter(c) })).filter((x) => typeof x.v === 'number' && Number.isFinite(x.v) && (allowZero ? x.v >= 0 : x.v > 0));
    if (!vals.length) return;
    const low = Math.min(...vals.map((x) => x.v));
    best[key] = vals.filter((x) => Math.abs(x.v - low) < 1e-6).map((x) => x.id);
  };

  maxRow('imdb', (c) => c.ratings?.imdb);
  maxRow('rt', (c) => c.ratings?.rt);
  maxRow('letterboxd', (c) => c.ratings?.letterboxd);
  maxRow('mal', (c) => c.ratings?.mal);
  maxRow('audience', (c) => c.audience);
  maxRow('year', (c) => c.year);
  minRow('runtimeMin', (c) => c.runtimeMin, false);
  minRow('unwatched', (c) => (c.watchedBy || []).filter((w) => w.watched).length, true);

  // Genres present in >= 2 nominated titles
  const gCounts = new Map();
  for (const c of columns) {
    for (const g of new Set(c.genres || [])) gCounts.set(g, (gCounts.get(g) || 0) + 1);
  }
  const sharedGenres = [...gCounts.entries()].filter(([, n]) => n >= Math.min(2, columns.length)).map(([g]) => g);
  return { best, sharedGenres };
}

// Mood/vibe -> matching genres for Group Taste Matcher
const MOOD_GENRES = {
  chill: ['Comedy', 'Animation', 'Family', 'Romance', 'Music'],
  thrill: ['Thriller', 'Horror', 'Mystery', 'Crime', 'Action'],
  mindbending: ['Sci-Fi', 'Science Fiction', 'Mystery', 'Thriller', 'Fantasy'],
  epic: ['Adventure', 'Action', 'Fantasy', 'History', 'War', 'Sci-Fi', 'Science Fiction'],
  feelgood: ['Comedy', 'Family', 'Adventure', 'Animation', 'Romance'],
  dark: ['Crime', 'Thriller', 'Horror', 'Drama', 'Mystery'],
};

// Build normalized genre/decade/people affinity profile + watched sets for one room member
function buildMemberAffinity(raw = {}) {
  const watchedIds = new Set();
  const watchedKeys = new Set();
  const genres = {};
  const decades = {};
  const people = {};
  const seedIds = [];

  const addWeight = (map, key, w) => {
    if (!key) return;
    const k = String(key).trim().toLowerCase();
    if (!k) return;
    map[k] = (map[k] || 0) + w;
  };
  const markWatched = (id, name, year) => {
    if (id) watchedIds.add(String(id).split(':')[0]);
    if (name) {
      watchedKeys.add(imp.letterboxdKey(name, year || ''));
      watchedKeys.add(imp.letterboxdKey(name, ''));
    }
  };
  const noteItem = (item, weight, isWatched = true) => {
    if (!item) return;
    const baseId = item.id ? String(item.id).split(':')[0] : null;
    const yr = item.year ? +String(item.year).slice(0, 4) : (item.releaseInfo ? +String(item.releaseInfo).slice(0, 4) : null);
    if (isWatched) markWatched(baseId, item.name, yr);
    if (weight > 0 && baseId && /^tt\d+$/.test(baseId) && !seedIds.includes(baseId)) seedIds.push(baseId);
    const normG = normalizeGenres(item.genres || item.genre || (baseId && SEED_GENRES_BY_ID[baseId]) || [], item.genre_ids);
    for (const g of normG) addWeight(genres, g, weight);
    if (yr && yr >= 1920 && yr <= 2035) addWeight(decades, String(Math.floor(yr / 10) * 10), weight);
    for (const c of (item.cast || []).slice(0, 6)) addWeight(people, typeof c === 'string' ? c : c?.name, weight);
    for (const d of (item.director || []).slice(0, 3)) addWeight(people, typeof d === 'string' ? d : d?.name, weight * 1.4);
  };

  if (raw.watchedIds) for (const id of raw.watchedIds) watchedIds.add(String(id).split(':')[0]);
  if (raw.watchedKeys) for (const k of raw.watchedKeys) watchedKeys.add(String(k));
  if (raw.genres && !Array.isArray(raw.genres)) {
    for (const [k, v] of Object.entries(raw.genres)) {
      const ng = normalizeGenres([k]);
      for (const g of (ng.length ? ng : [k])) addWeight(genres, g, +v || 0);
    }
  }
  if (raw.decades) for (const [k, v] of Object.entries(raw.decades)) addWeight(decades, k, +v || 0);
  if (raw.people) for (const [k, v] of Object.entries(raw.people)) addWeight(people, k, +v || 0);

  for (const f of raw.favorites || []) noteItem(f, 3.0, true);
  for (const h of raw.history || []) noteItem(h, 1.2, true);
  const normalizeRating = (e) => {
    if (e?.score != null && Number.isFinite(+e.score)) return +e.score / 2;
    if (e?.rating != null && Number.isFinite(+e.rating)) {
      const n = +e.rating;
      return (e.scale === 10 || n > 5) ? n / 2 : n;
    }
    return null;
  };
  for (const r of raw.ratings || []) {
    const rating = normalizeRating(r);
    const w = rating != null ? (rating >= 4 ? 2.8 : rating >= 3 ? 1.0 : -1.5) : (r.watched ? 1.0 : 0);
    noteItem(r, w, r.watched !== false);
  }
  for (const x of raw.items || []) {
    const rating = normalizeRating(x);
    const w = rating != null ? (rating >= 4 ? 2.5 : rating >= 3 ? 1.0 : -1.2) : (x.watched ? 1.0 : 0);
    noteItem(x, w, !!x.watched || rating != null);
  }
  for (const [id, t] of Object.entries(raw.tune || {})) {
    const w = t?.v > 0 ? 2.5 : t?.v < 0 ? -2.0 : 0;
    if (t?.v) markWatched(id, null, null);
    if (w > 0 && /^tt\d+$/.test(id) && !seedIds.includes(id)) seedIds.push(id);
    for (const g of normalizeGenres(t?.genres || SEED_GENRES_BY_ID[id] || [])) addWeight(genres, g, w);
  }

  return {
    id: raw.id || 'member',
    name: raw.name || raw.displayName || raw.id || 'Member',
    accent: raw.accent || '#e2a43a',
    watchedIds,
    watchedKeys,
    genres,
    decades,
    people,
    seedIds: seedIds.slice(0, 8),
  };
}

function eraMatches(era, yr) {
  if (!era || !yr) return true;
  if (era === '2020s') return yr >= 2020 && yr <= 2029;
  if (era === '2010s') return yr >= 2010 && yr <= 2019;
  if (era === '2000s') return yr >= 2000 && yr <= 2009;
  if (era === '90s' || era === '1990s') return yr >= 1990 && yr <= 1999;
  if (era === 'classic') return yr > 0 && yr < 1990;
  return true;
}

// Pure Group Taste Matcher scoring function:
// Combines watch history, favourites and ratings of everyone in the room -> top `limit` movies
// across a 3-tier constraint fallback so rare combinations never yield 0 results.
function scoreGroupTaste(candidates, members, filters = {}, limit = 5, opts = {}) {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const normMembers = (Array.isArray(members) && members.length ? members : [{ id: 'me', name: 'Me' }])
    .map((m) => (m && m.watchedIds instanceof Set ? m : buildMemberAffinity(m)));

  const rawSelected = Array.isArray(filters.genres)
    ? filters.genres
    : (filters.genre && filters.genre !== 'all' ? [filters.genre] : []);
  const selectedGenres = normalizeGenres(rawSelected);
  const selectedLow = selectedGenres.map((g) => g.toLowerCase());
  const maxRt = filters.maxRuntime && +filters.maxRuntime > 0 ? +filters.maxRuntime : null;
  const era = filters.era && filters.era !== 'all' ? String(filters.era) : null;
  const moodList = filters.mood && MOOD_GENRES[filters.mood] ? MOOD_GENRES[filters.mood].map((g) => g.toLowerCase()) : null;

  const seenIds = new Set();
  const seenKeys = new Set();
  const unseen = [];

  for (const c of candidates) {
    if (!c || !c.id || !c.name) continue;
    const baseId = String(c.id).split(':')[0];
    const yr = c.year ? +String(c.year).slice(0, 4) : (c.releaseInfo ? +String(c.releaseInfo).slice(0, 4) : null);
    const lbKey = imp.letterboxdKey(c.name, yr || '');
    const lbNameOnly = imp.letterboxdKey(c.name, '');
    if (seenIds.has(baseId) || (yr && seenKeys.has(lbKey))) continue;

    // Nobody in the room may have watched it
    const anyoneWatched = normMembers.some((m) =>
      m.watchedIds.has(baseId) ||
      (yr && m.watchedKeys.has(lbKey)) ||
      (!yr && m.watchedKeys.has(lbNameOnly))
    );
    if (anyoneWatched) continue;

    const rawGenres = (c.genres || c.genre || []).length ? (c.genres || c.genre) : (SEED_GENRES_BY_ID[baseId] || []);
    const cGenres = normalizeGenres(rawGenres, c.genre_ids);
    const cGenresLow = cGenres.map((g) => g.toLowerCase());
    const rtMin = parseRuntimeMin(c.runtimeMin ?? c.runtime);

    seenIds.add(baseId);
    if (yr) seenKeys.add(lbKey);

    const matchedSelectedGenres = selectedGenres.filter((sg, idx) => cGenresLow.includes(selectedLow[idx]));
    const allGenresOk = !selectedLow.length || matchedSelectedGenres.length === selectedLow.length;
    const anyGenreOk = !selectedLow.length || matchedSelectedGenres.length > 0;
    const eraOk = eraMatches(era, yr);
    const rtOk = !(maxRt && rtMin != null && rtMin > maxRt);
    const moodHits = moodList ? cGenresLow.filter((g) => moodList.includes(g)).length : 0;

    unseen.push({ baseId, c, yr, rtMin, cGenres, cGenresLow, matchedSelectedGenres, allGenresOk, anyGenreOk, eraOk, rtOk, moodHits });
  }

  if (!unseen.length) return [];

  // Pre-compute max positive weights per member for normalization
  const memberNorms = normMembers.map((m) => {
    const gVals = Object.values(m.genres).filter((v) => v > 0);
    const dVals = Object.values(m.decades).filter((v) => v > 0);
    const pVals = Object.values(m.people).filter((v) => v > 0);
    return {
      m,
      gMax: gVals.length ? Math.max(...gVals) : 0,
      dMax: dVals.length ? Math.max(...dVals) : 0,
      pMax: pVals.length ? Math.max(...pVals) : 0,
      hasData: gVals.length > 0 || dVals.length > 0 || pVals.length > 0,
    };
  });

  const scoreItem = (entry, matchTier) => {
    const { c, yr, rtMin, cGenres, cGenresLow, matchedSelectedGenres, moodHits } = entry;
    const decKey = yr ? String(Math.floor(yr / 10) * 10) : null;
    const peopleNames = [
      ...(c.cast || []).map((x) => (typeof x === 'string' ? x : x?.name)),
      ...(c.director || []).map((x) => (typeof x === 'string' ? x : x?.name)),
    ].filter(Boolean).map((n) => String(n).trim().toLowerCase());

    const memberScores = [];
    const matchedGenres = new Set();
    const matchedPeople = new Set();

    for (const { m, gMax, dMax, pMax, hasData } of memberNorms) {
      if (!hasData) {
        memberScores.push({ id: m.id, name: m.name, accent: m.accent, score: 0.65, pct: 78 });
        continue;
      }
      let gSum = 0;
      let gHits = 0;
      for (let i = 0; i < cGenresLow.length; i++) {
        const w = m.genres[cGenresLow[i]] || 0;
        if (w > 0) { matchedGenres.add(cGenres[i]); gHits++; }
        gSum += gMax ? w / gMax : 0;
      }
      const gScore = cGenresLow.length ? Math.max(-0.5, Math.min(1, (gSum / Math.min(3, cGenresLow.length)) * (gHits > 1 ? 1.15 : 1))) : 0.3;
      const dScore = decKey && dMax ? Math.max(0, Math.min(1, (m.decades[decKey] || 0) / dMax)) : 0.4;

      let pSum = 0;
      for (const p of peopleNames) {
        const w = m.people[p] || 0;
        if (w > 0) {
          matchedPeople.add(p);
          pSum += pMax ? w / pMax : 0.5;
        }
      }
      const pScore = pMax ? Math.min(1, pSum) : 0;

      const rawMember = 0.25 + (0.50 * gScore) + (0.15 * dScore) + (0.20 * pScore);
      const clamped = Math.max(0.05, Math.min(1, rawMember));
      memberScores.push({ id: m.id, name: m.name, accent: m.accent, score: clamped, pct: Math.round(55 + clamped * 44) });
    }

    const vals = memberScores.map((x) => x.score);
    const meanFit = vals.reduce((a, b) => a + b, 0) / vals.length;
    const minFit = Math.min(...vals);
    const groupFit = (0.6 * meanFit) + (0.4 * minFit);

    const moodBonus = moodHits * 0.08;
    const selBonus = selectedGenres.length ? (matchedSelectedGenres.length / selectedGenres.length) * 0.22 : 0;
    const ratingVal = parseFloat(c.imdbRating || c.malRating || '0') || 7.0;
    const qualityBonus = Math.max(0, (ratingVal - 6.0) * 0.04);

    const totalScore = groupFit + moodBonus + selBonus + qualityBonus;
    const matchPct = Math.max(62, Math.min(99, Math.round(55 + Math.min(1.1, totalScore) * 40)));

    return {
      ...c,
      year: yr || c.year || null,
      runtimeMin: rtMin,
      genres: cGenres,
      matchTier,
      matchedSelectedGenres,
      score: Math.round(totalScore * 1000) / 1000,
      matchPct,
      memberScores: memberScores.map(({ id, name, accent, pct }) => ({ id, name, accent, pct })),
      reasons: {
        genres: (matchedSelectedGenres.length ? [...new Set([...matchedSelectedGenres, ...matchedGenres])] : [...matchedGenres]).slice(0, 3),
        decade: decKey ? `${decKey}s` : null,
        people: [...matchedPeople].slice(0, 2),
      },
    };
  };

  const sortScored = (a, b) =>
    (b.matchedSelectedGenres.length - a.matchedSelectedGenres.length) ||
    (b.score - a.score) ||
    (parseFloat(b.imdbRating || '0') - parseFloat(a.imdbRating || '0'));

  const picked = [];
  const used = new Set();
  const pushFrom = (entries, tier, customSort = sortScored) => {
    const scored = entries.filter((e) => !used.has(e.baseId)).map((e) => ({ entry: e, out: scoreItem(e, tier) }));
    scored.sort((a, b) => customSort(a.out, b.out));
    for (const s of scored) {
      if (picked.length >= limit) break;
      used.add(s.entry.baseId);
      picked.push(s.out);
    }
  };

  // Tier 1: Matches ALL requested genres + era + maxRuntime (preferring mood matches when mood is active)
  const hardOk = unseen.filter((e) => e.allGenresOk && e.eraOk && e.rtOk);
  const t1Pool = moodList && hardOk.some((e) => e.moodHits > 0) ? hardOk.filter((e) => e.moodHits > 0) : hardOk;
  pushFrom(t1Pool, 1);

  // Tier 2: Partial genre match (respecting era & maxRuntime first), or missed mood within constraints
  if (picked.length < limit && (picked.length === 0 || selectedGenres.length > 0 || opts.fillToLimit)) {
    const t2Strict = unseen.filter((e) => !used.has(e.baseId) && e.eraOk && e.rtOk && (selectedGenres.length ? e.anyGenreOk : true));
    if (selectedGenres.length > 0 || picked.length === 0) pushFrom(t2Strict, 2);
  }
  if (picked.length < limit && (picked.length === 0 || (opts.fillToLimit && selectedGenres.length > 0))) {
    // Same selected genres but relax era/runtime if pool was sparse
    const t2Relaxed = unseen.filter((e) => !used.has(e.baseId) && (selectedGenres.length ? e.anyGenreOk : (e.eraOk || e.rtOk)));
    pushFrom(t2Relaxed, 2);
  }

  // Tier 3: Highest group affinity unseen titles so we NEVER return 0 results
  if (picked.length === 0 || (opts.fillToLimit && picked.length < limit)) {
    pushFrom(unseen, 3, (a, b) => (b.score - a.score) || (parseFloat(b.imdbRating || '0') - parseFloat(a.imdbRating || '0')));
  }

  return picked.slice(0, limit);
}

function sanitizePartyNote(n, fallbackAuthor = {}) {
  if (!n || typeof n !== 'object') return null;
  const text = String(n.text || '').trim().slice(0, 240);
  const t = Number(n.t);
  if (!text || !Number.isFinite(t) || t < 0) return null;
  const authorId = String(n.authorId || fallbackAuthor.id || 'peer').slice(0, 64);
  return {
    id: String(n.id || `pn-${now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 48),
    titleKey: String(n.titleKey || '').slice(0, 120),
    t: Math.round(t * 10) / 10,
    text,
    authorId,
    authorName: String(n.authorName || fallbackAuthor.name || authorId).slice(0, 40),
    accent: accentForId(authorId, n.accent || fallbackAuthor.accent),
    at: Number(n.at) || now(),
  };
}

function maskRatingSession(session, forWire = true) {
  if (!session || typeof session !== 'object') return null;
  if (!session.blind || session.revealed) return { ...session };
  const maskedVotes = {};
  for (const [k, v] of Object.entries(session.votes || {})) {
    if (!v || typeof v !== 'object') continue;
    maskedVotes[k] = {
      id: v.id || k,
      name: v.name || v.id || k,
      accent: v.accent || '#e2a43a',
      submitted: true,
      score: forWire ? null : (v.score ?? null),
      at: v.at || 0,
    };
  }
  return {
    ...session,
    votes: maskedVotes,
    avg: null,
  };
}

function cosineMapSim(a = {}, b = {}) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(a)) {
    const x = Math.max(0, Number(v) || 0);
    if (!x) continue;
    na += x * x;
    const y = Math.max(0, Number(b[k]) || 0);
    if (y) dot += x * y;
  }
  for (const v of Object.values(b)) {
    const y = Math.max(0, Number(v) || 0);
    if (y) nb += y * y;
  }
  if (!na || !nb) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function computeFriendCompatibility(meRaw = {}, friendRaw = {}) {
  if (friendRaw?.historyHidden && !(friendRaw.favorites || []).length && !(friendRaw.lists || []).length) {
    return { pct: null, sharedGenres: [], sharedTopRated: [], commonWatched: 0 };
  }
  const meAff = buildMemberAffinity(meRaw);
  const frAff = buildMemberAffinity(friendRaw);
  const gSim = cosineMapSim(meAff.genres, frAff.genres);
  const dSim = cosineMapSim(meAff.decades, frAff.decades);
  const pSim = cosineMapSim(meAff.people, frAff.people);

  const sharedGenres = Object.keys(meAff.genres)
    .filter((g) => (meAff.genres[g] || 0) > 0 && (frAff.genres[g] || 0) > 0)
    .sort((a, b) => Math.min(meAff.genres[b], frAff.genres[b]) - Math.min(meAff.genres[a], frAff.genres[a]))
    .slice(0, 4);

  const norm10 = (e) => {
    if (!e) return null;
    if (e.score != null && Number.isFinite(+e.score)) return Math.max(1, Math.min(10, +e.score));
    if (e.rating != null && Number.isFinite(+e.rating)) {
      const n = +e.rating;
      return Math.max(1, Math.min(10, (e.scale === 10 || n > 5) ? n : n * 2));
    }
    return null;
  };
  const mapRatings = (raw) => {
    const byKey = new Map();
    const put = (item, fallbackScore = null) => {
      if (!item) return;
      const baseId = item.id ? String(item.id).split(':')[0] : null;
      const yr = item.year ? +String(item.year).slice(0, 4) : null;
      const lbKey = item.name ? imp.letterboxdKey(item.name, yr || '') : '';
      const lbNoYr = item.name ? imp.letterboxdKey(item.name, '') : '';
      const score = norm10(item) ?? fallbackScore;
      const rec = {
        id: baseId || lbKey || String(item.name || ''),
        type: item.type === 'series' ? 'series' : 'movie',
        name: item.name || item.title || baseId || '',
        poster: item.poster || null,
        year: yr || null,
        score,
      };
      if (baseId) byKey.set(`id:${baseId}`, rec);
      if (lbKey) byKey.set(`lb:${lbKey}`, rec);
      if (lbNoYr && !byKey.has(`lbn:${lbNoYr}`)) byKey.set(`lbn:${lbNoYr}`, rec);
    };
    for (const f of raw.favorites || []) put(f, 9);
    for (const r of raw.ratings || []) put(r, null);
    for (const x of raw.items || []) put(x, null);
    return byKey;
  };

  const meR = mapRatings(meRaw);
  const frR = mapRatings(friendRaw);
  const seenShared = new Set();
  const sharedTopRated = [];
  let ratingSimSum = 0;
  let ratingSimCount = 0;

  for (const [k, mr] of meR.entries()) {
    const fr = frR.get(k);
    if (!fr) continue;
    const dedupeKey = (fr.id && /^tt\d+/.test(fr.id) ? fr.id : '') || fr.name.toLowerCase();
    if (!dedupeKey || seenShared.has(dedupeKey)) continue;
    seenShared.add(dedupeKey);
    if (mr.score != null && fr.score != null) {
      const diff = Math.abs(mr.score - fr.score);
      ratingSimSum += Math.max(0, 1 - diff / 9);
      ratingSimCount++;
    }
    if ((mr.score == null || mr.score >= 7) && (fr.score == null || fr.score >= 7)) {
      sharedTopRated.push({
        id: fr.id || mr.id,
        type: fr.type || mr.type,
        name: fr.name || mr.name,
        poster: fr.poster || mr.poster || null,
        year: fr.year || mr.year || null,
        myScore: mr.score,
        friendScore: fr.score,
      });
    }
  }
  sharedTopRated.sort((a, b) => ((b.myScore || 8) + (b.friendScore || 8)) - ((a.myScore || 8) + (a.friendScore || 8)));

  let commonWatched = 0;
  for (const id of meAff.watchedIds) if (frAff.watchedIds.has(id)) commonWatched++;

  if (gSim == null && dSim == null && ratingSimCount === 0 && commonWatched === 0) {
    return { pct: null, sharedGenres: [], sharedTopRated: [], commonWatched: 0 };
  }

  let wSum = 0;
  let score = 0;
  if (gSim != null) { score += gSim * 0.52; wSum += 0.52; }
  if (dSim != null) { score += dSim * 0.16; wSum += 0.16; }
  if (pSim != null) { score += pSim * 0.12; wSum += 0.12; }
  if (ratingSimCount > 0) { score += (ratingSimSum / ratingSimCount) * 0.20; wSum += 0.20; }
  else if (commonWatched > 0) { score += Math.min(1, commonWatched / 10) * 0.12; wSum += 0.12; }

  const rawNorm = wSum > 0 ? score / wSum : 0;
  const pct = Math.max(12, Math.min(99, Math.round(25 + rawNorm * 74)));
  return {
    pct,
    sharedGenres,
    sharedTopRated: sharedTopRated.slice(0, 6),
    commonWatched,
  };
}

// ========================================================================= MAIN SETUP
function setup({ store, net, getHost, getGuest, getTheater, getMediaHub, emit, pushPresence, isIncognito = () => false }) {
  const pendingHandles = new Map(); // reqId -> { handle, resolve }
  const presenceMap = new Map();    // id -> 'online' | 'busy'
  const presenceMeta = new Map();   // id -> { status, handle, nick, watching, inParty }
  const partyPeers = new Map();     // id -> { id, name, handle, avatar, accent, taste }
  const partyCursors = new Map();   // id -> { id, name, accent, x, y, at }
  const partyChat = [];             // [{ id, from, accent, text, at }]
  const pendingFriendSync = new Set(); // offline-verified IDs waiting for peer to appear online
  let swipeState = null;            // { roundId, endsAt, items, votes: { [itemId]: { [memberId]: { name, accent, like } } } }
  let wheelState = null;            // { roundId, items, winnerIdx, winner, angle, at }
  let brbState = null;              // { active, byId, byName, accent, startedAt, endsAt, durationSec }
  let ratingSession = null;         // { sessionId, id, type, title, poster, blind, revealed, expectedCount, votes, avg }
  let partyNotesState = { titleKey: '', notes: [] }; // session timestamped notes

  const myId = () => store.identity().id;
  const myProfile = () => store.socialProfile();
  const pget = (k) => {
    const p = store.get('mediaProfile') || 'default';
    return store.get(p === 'default' ? k : `${k}@${p}`);
  };

  function currentLiveStatus() {
    const incog = !!isIncognito?.();
    const th = incog ? null : getTheater?.()?.info?.();
    const h = getHost?.();
    const g = getGuest?.();
    const inParty = h?.guests?.size
      ? { role: 'host', count: h.guests.size + 1, mode: h.mode }
      : g?.link
        ? { role: 'guest', hostId: g.hostId, count: (g.roster?.list?.length || 1) + 1 }
        : null;
    const watching = incog
      ? null
      : (th
        ? { name: String(th.name || '').slice(0, 80), together: !!th.together }
        : h?.movie?.info && h.movie.state?.playing
          ? { name: String(h.movie.publicState?.()?.title || '').slice(0, 80), together: true }
          : null);
    return { watching, inParty };
  }

  function syncNetIdentity() {
    const p = myProfile();
    net.handle = p.handle || '';
    net.status = currentLiveStatus();
    if (net.registered) net._hello();
  }

  function mySharedPayload(songDataUrl = null) {
    const p = myProfile();
    const hub = getMediaHub?.();
    const lib = hub?.library?.();
    const lb = pget('letterboxd') || {};
    const tune = pget('mediaTune') || {};
    const clip = songDataUrl ?? hub?.getSong?.({ maxBytes: 16000 })?.dataUrl ?? null;
    const comments = store.profileComments?.(myId()) || [];
    return buildSharedProfilePayload({ profile: p, library: lib, letterboxd: lb, tune, songDataUrl: clip, comments });
  }

  function myTasteSummary() {
    const p = myProfile();
    const hub = getMediaHub?.();
    const lib = hub?.library?.();
    const lb = Object.values(pget('letterboxd') || {});
    const tune = pget('mediaTune') || {};
    const aff = buildMemberAffinity({
      id: myId(),
      name: p.displayName || myId(),
      accent: p.accent,
      favorites: [...(p.favorites || []), ...(lib?.favorites || [])],
      history: lib?.history || [],
      ratings: lb,
      tune,
    });
    return {
      id: aff.id,
      name: aff.name,
      accent: aff.accent,
      watchedIds: [...aff.watchedIds].slice(0, 1500),
      watchedKeys: [...aff.watchedKeys].slice(0, 1500),
      genres: aff.genres,
      decades: aff.decades,
      people: aff.people,
      seedIds: aff.seedIds,
    };
  }

  function sendSocialSignal(to, sub, body = {}) {
    if (!isId(to) || !net.registered) return false;
    const idn = store.identity();
    const msg = net._sign({
      t: 'social',
      sub,
      from: idn.id,
      to,
      pk: idn.pkB64,
      salt: idn.salt,
      ...body,
      ts: now(),
    });
    if (JSON.stringify(msg).length > MAX_ENVELOPE_BYTES) return false;
    return net.signal(msg);
  }

  // Merge a friend's shared profile history & ratings into store's friendActivity so Detail.tsx & Compare Matrix see it
  function mergeFriendIntoActivity(id, prof) {
    if (!isId(id) || !prof) return;
    const items = [];
    for (const h of prof.history || []) items.push({ id: h.id, name: h.name, watched: true });
    for (const r of prof.ratings || []) items.push({ id: r.id, name: r.name, year: r.year, watched: r.watched !== false, rating: r.rating || null, review: r.review || null });
    for (const f of prof.favorites || []) items.push({ id: f.id, name: f.name, year: f.year, watched: true, rating: 5 });
    if (items.length) {
      const all = store.get('friendActivity') || {};
      all[id] = { name: prof.displayName || prof.name || id, accent: prof.accent || null, avatar: prof.avatar || null, items, at: now() };
      store.set('friendActivity', all);
    }
  }

  // Handle incoming P2P social messages over the signed signaling channel
  net.on('social', (m) => {
    if (!verifySocialEnvelope(m)) return;
    const from = m.from;
    const existing = store.friend(from);
    if (existing?.trust === 'block') return;

    switch (m.sub) {
      case 'friend_req': {
        const card = m.card || {};
        if (existing && existing.friendStatus !== 'pending_out') {
          // Already friends: auto-confirm and send our profile
          store.upsertFriend({
            id: from,
            pk: m.pk,
            name: String(card.displayName || existing.name || from).slice(0, 40),
            handle: isValidHandle(card.handle) ? normalizeHandle(card.handle) : existing.handle,
            avatar: sanitizeAvatar(card.avatar) ?? existing.avatar ?? null,
            accent: accentForId(from, card.accent || existing.accent),
            bio: String(card.bio || existing.bio || '').slice(0, 280),
            friendStatus: 'accepted',
            lastSeen: now(),
          });
          pushPresence?.();
          sendSocialSignal(from, 'friend_accept', { card: summaryCard() });
          sendSocialSignal(from, 'profile_res', { profile: mySharedPayload() });
          emit('social-updated', {});
          return;
        }
        if (existing && existing.friendStatus === 'pending_out') {
          // Mutual request! Auto-accept
          store.upsertFriend({
            id: from,
            pk: m.pk,
            name: String(card.displayName || existing.name || from).slice(0, 40),
            handle: isValidHandle(card.handle) ? normalizeHandle(card.handle) : existing.handle,
            avatar: sanitizeAvatar(card.avatar) ?? existing.avatar ?? null,
            accent: accentForId(from, card.accent || existing.accent),
            bio: String(card.bio || '').slice(0, 280),
            friendStatus: 'accepted',
            lastSeen: now(),
          });
          store.removeFriendRequest(from);
          pushPresence?.();
          sendSocialSignal(from, 'friend_accept', { card: summaryCard() });
          sendSocialSignal(from, 'profile_res', { profile: mySharedPayload() });
          emit('social-updated', {});
          return;
        }
        store.upsertFriendRequest({
          id: from,
          pk: m.pk,
          direction: 'in',
          name: String(card.displayName || card.name || from).slice(0, 40),
          handle: isValidHandle(card.handle) ? normalizeHandle(card.handle) : '',
          avatar: sanitizeAvatar(card.avatar),
          accent: accentForId(from, card.accent),
          bio: String(card.bio || '').slice(0, 280),
          at: now(),
        });
        emit('social-updated', { kind: 'request', from });
        break;
      }

      case 'friend_accept': {
        const card = m.card || {};
        store.removeFriendRequest(from);
        store.upsertFriend({
          id: from,
          pk: m.pk,
          name: String(card.displayName || existing?.name || from).slice(0, 40),
          handle: isValidHandle(card.handle) ? normalizeHandle(card.handle) : (existing?.handle || ''),
          avatar: sanitizeAvatar(card.avatar) ?? existing?.avatar ?? null,
          accent: accentForId(from, card.accent || existing?.accent),
          bio: String(card.bio || existing?.bio || '').slice(0, 280),
          friendStatus: 'accepted',
          lastSeen: now(),
        });
        presenceMap.set(from, 'online');
        pushPresence?.();
        sendSocialSignal(from, 'profile_req', {});
        sendSocialSignal(from, 'profile_res', { profile: mySharedPayload() });
        emit('social-updated', { kind: 'accepted', from });
        break;
      }

      case 'friend_decline': {
        store.removeFriendRequest(from);
        if (existing?.friendStatus === 'pending_out') store.removeFriend(from);
        emit('social-updated', {});
        break;
      }

      case 'profile_req': {
        if (!existing || existing.trust === 'block') return;
        sendSocialSignal(from, 'profile_res', { profile: mySharedPayload() });
        break;
      }

      case 'profile_res': {
        if (!existing || existing.trust === 'block') return;
        if (!m.profile || typeof m.profile !== 'object') return;
        const p = m.profile;
        const safeSong = sanitizeSongDataUrl(p.songDataUrl);
        if (safeSong) getMediaHub?.()?.cacheFriendSong?.(from, safeSong);
        const clean = {
          id: from,
          pk: m.pk,
          displayName: String(p.displayName || existing.name || from).slice(0, 40),
          handle: isValidHandle(p.handle) ? normalizeHandle(p.handle) : (existing.handle || ''),
          avatar: sanitizeAvatar(p.avatar) ?? existing.avatar ?? null,
          accent: accentForId(from, p.accent || existing.accent),
          bio: String(p.bio || '').slice(0, 280),
          song: p.song || null,
          songDataUrl: safeSong,
          shareHistory: p.shareHistory === 'none' ? 'none' : 'friends',
          historyHidden: !!p.historyHidden,
          favorites: Array.isArray(p.favorites) ? p.favorites.slice(0, 24) : [],
          lists: Array.isArray(p.lists) ? p.lists.slice(0, 20) : [],
          history: Array.isArray(p.history) ? p.history.slice(0, 50) : [],
          ratings: Array.isArray(p.ratings) ? p.ratings.slice(0, 80) : [],
          comments: Array.isArray(p.comments) ? p.comments.slice(0, 40) : [],
          customProfile: p.customProfile && typeof p.customProfile === 'object' ? p.customProfile : null,
          updatedAt: now(),
        };
        store.saveFriendProfile(from, clean);
        store.upsertFriend({
          id: from,
          pk: m.pk,
          name: clean.displayName || existing.name,
          handle: clean.handle || existing.handle,
          avatar: clean.avatar ?? existing.avatar,
          accent: clean.accent,
          bio: clean.bio,
          friendStatus: 'accepted',
          lastSeen: now(),
        });
        mergeFriendIntoActivity(from, clean);
        emit('social-updated', { kind: 'profile', id: from });
        break;
      }

      case 'status_push': {
        if (!existing) return;
        presenceMap.set(from, m.busy ? 'busy' : 'online');
        presenceMeta.set(from, {
          status: m.status || null,
          watching: m.status?.watching || null,
          inParty: m.status?.inParty || null,
          handle: isValidHandle(m.handle) ? normalizeHandle(m.handle) : existing.handle,
          nick: m.nick || existing.name,
        });
        if (m.card) {
          store.upsertFriend({
            id: from,
            name: String(m.card.displayName || existing.name).slice(0, 40),
            handle: isValidHandle(m.card.handle) ? normalizeHandle(m.card.handle) : existing.handle,
            avatar: sanitizeAvatar(m.card.avatar) ?? existing.avatar ?? null,
            accent: accentForId(from, m.card.accent || existing.accent),
            lastSeen: now(),
          });
        }
        emit('social-updated', { kind: 'presence', id: from });
        break;
      }

      case 'comment_add': {
        if (!existing || existing.trust === 'block' || !m.comment || typeof m.comment !== 'object') return;
        const c = m.comment;
        const saved = store.addProfileComment?.(myId(), {
          id: String(c.id || `c-${now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 64),
          authorId: from,
          authorName: String(c.authorName || existing.name || from).slice(0, 40),
          authorAvatar: sanitizeAvatar(c.authorAvatar) ?? existing.avatar ?? null,
          authorAccent: accentForId(from, c.authorAccent || existing.accent),
          body: String(c.body || '').trim().slice(0, 800),
          at: Number(c.at) || now(),
        });
        if (saved) emit('social-updated', { kind: 'comment', id: myId() });
        break;
      }

      case 'comment_del': {
        if (!existing || existing.trust === 'block' || !m.commentId) return;
        const deleted = store.deleteProfileComment?.(myId(), m.commentId, from);
        if (deleted) emit('social-updated', { kind: 'comment', id: myId() });
        break;
      }

      // Friends-of-friends handle lookup gossip
      case 'handle_query': {
        if (!existing) return;
        const h = normalizeHandle(m.handle);
        if (!h) return;
        const me = myProfile();
        if (me.handle && normalizeHandle(me.handle) === h) {
          sendSocialSignal(from, 'handle_ans', { reqId: m.reqId, handle: h, found: { id: myId(), pk: store.identity().pkB64, name: me.displayName || myId(), handle: h } });
          return;
        }
        const hit = store.lookupLocalHandle(h);
        if (hit && isId(hit.id)) {
          sendSocialSignal(from, 'handle_ans', { reqId: m.reqId, handle: h, found: hit });
        }
        break;
      }

      case 'handle_ans': {
        const w = pendingHandles.get(m.reqId);
        if (w && m.found && isId(m.found.id)) {
          store.rememberHandle(w.handle, m.found);
          w.resolve(m.found);
        }
        break;
      }
    }
  });

  // Server handle lookup response
  net.on('handle-res', (m) => {
    const w = pendingHandles.get(m.reqId);
    if (w && m.id && isId(m.id)) {
      const found = { id: m.id, pk: m.pk || null, name: m.nick || m.id, handle: w.handle };
      store.rememberHandle(w.handle, found);
      w.resolve(found);
    } else if (w && m.notFound) {
      w.serverDone?.();
    }
  });

  net.on('presence', (on, meta) => {
    presenceMap.clear();
    for (const [id, st] of Object.entries(on || {})) {
      presenceMap.set(id, st);
      store.upsertFriend({ id, lastSeen: now() });
      if (pendingFriendSync.has(id)) {
        const s1 = sendSocialSignal(id, 'friend_req', { card: summaryCard() });
        const s2 = sendSocialSignal(id, 'profile_req', {});
        sendSocialSignal(id, 'profile_res', { profile: mySharedPayload() });
        if (s1 || s2) pendingFriendSync.delete(id);
      }
    }
    if (meta && typeof meta === 'object') {
      for (const [id, info] of Object.entries(meta)) {
        if (!info) continue;
        presenceMeta.set(id, {
          status: info.status || null,
          watching: info.status?.watching || null,
          inParty: info.status?.inParty || null,
          handle: info.handle || '',
          nick: info.nick || '',
        });
        if (info.handle && isValidHandle(info.handle)) {
          store.upsertFriend({ id, handle: normalizeHandle(info.handle) });
        }
      }
    }
    emit('social-updated', { kind: 'presence' });
  });

  net.on('registered', () => {
    syncNetIdentity();
  });

  function summaryCard() {
    const p = myProfile();
    return {
      id: p.id,
      displayName: p.displayName || p.id,
      handle: p.handle || '',
      avatar: p.avatar && p.avatar.length < 16000 ? p.avatar : null,
      accent: p.accent || '#e2a43a',
      bio: p.bio || '',
    };
  }

  function broadcastStatusToFriends() {
    syncNetIdentity();
    const st = currentLiveStatus();
    const card = summaryCard();
    for (const f of store.friends()) {
      if (f.trust === 'block') continue;
      if (presenceMap.has(f.id)) {
        sendSocialSignal(f.id, 'status_push', { status: st, handle: card.handle, nick: card.displayName, card });
      }
    }
  }

  async function resolveHandle(handleRaw) {
    const h = normalizeHandle(handleRaw);
    if (!isValidHandle(h)) return null;
    const local = store.lookupLocalHandle(h);
    if (local && isId(local.id)) return local;

    const reqId = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pendingHandles.delete(reqId);
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), 2200);
      pendingHandles.set(reqId, {
        handle: h,
        resolve: finish,
        serverDone: () => {
          // If we have no online friends to answer gossip, finish early
          const onlineFriends = store.friends().filter((f) => f.trust !== 'block' && presenceMap.has(f.id));
          if (!onlineFriends.length) finish(null);
        },
      });
      // 1) Ask signaling server index
      if (net.registered) {
        net.signal(net._sign({ t: 'handle_lookup', id: myId(), handle: h, reqId, ts: now() }));
      }
      // 2) Ask online friends (friends-of-friends lookup)
      for (const f of store.friends()) {
        if (f.trust !== 'block') sendSocialSignal(f.id, 'handle_query', { reqId, handle: h });
      }
    });
  }

  // ========================================================================= PARTY CHANNEL WIRE
  function wireParty() {
    const h = getHost?.();
    const g = getGuest?.();
    if (h) {
      h.getAccent = () => myProfile().accent || '#e2a43a';
      h.getAvatar = () => myProfile().avatar || null;
      h.getHandle = () => myProfile().handle || '';
      h.on('joined', () => {
        setTimeout(() => {
          broadcastPartyMsg({ kind: 'party_profile', profile: summaryCard(), taste: myTasteSummary() });
          if (swipeState) broadcastPartyMsg({ kind: 'swipe_state', state: publicSwipeState() });
          if (wheelState) broadcastPartyMsg({ kind: 'wheel_state', state: wheelState });
          if (brbState && brbState.endsAt > now()) broadcastPartyMsg({ kind: 'brb_start', brb: brbState });
          if (ratingSession) broadcastPartyMsg({ kind: 'rating_state', round: maskRatingSession(ratingSession, true) });
          if (partyNotesState.notes.length) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
          emit('party-updated', {});
        }, 250);
      });
      h.on('left', () => {
        if (ratingSession?.blind && !ratingSession.revealed) {
          const activeCount = Math.max(1, getRoomMembers().length);
          ratingSession.expectedCount = activeCount;
          if (Object.keys(ratingSession.votes || {}).length >= activeCount) {
            ratingSession.revealed = true;
            const out = maskRatingSession(ratingSession, false);
            broadcastPartyMsg({ kind: 'rating_state', round: out });
            getTheater?.()?.onPartyEvent?.('rating-state', out);
            emit('party-updated', { kind: 'rating', round: out });
          }
        }
        emit('party-updated', {});
      });
      h.on('chat', (c) => {
        partyChat.push({ id: `${c.at}-${Math.random()}`, from: c.from || 'Host', accent: c.accent || '#e2a43a', text: c.text, at: c.at || now() });
        if (partyChat.length > 100) partyChat.shift();
        emit('party-updated', { kind: 'chat' });
      });
      h.on('party-msg', ({ sid, id, name, msg }) => {
        if (!msg || typeof msg !== 'object') return;
        handlePartyMsg(msg, { sid, id, name }, true);
      });
    }
    if (g) {
      g.getAccent = () => myProfile().accent || '#e2a43a';
      g.getAvatar = () => myProfile().avatar || null;
      g.getHandle = () => myProfile().handle || '';
      g.on('state', (s) => {
        if (s.state === 'linked') {
          setTimeout(() => {
            sendPartyMsg({ kind: 'party_profile', profile: summaryCard(), taste: myTasteSummary() });
            emit('party-updated', {});
          }, 250);
        } else if (s.state === 'ended' || s.state === 'idle') {
          partyPeers.clear();
          partyCursors.clear();
          brbState = null;
          ratingSession = null;
          partyNotesState = { titleKey: '', notes: [] };
          getTheater?.()?.onPartyEvent?.('brb', null);
          getTheater?.()?.onPartyEvent?.('notes', []);
          emit('party-updated', {});
        }
      });
      g.on('ctrl', (m) => {
        if (m.t === 'chat') {
          partyChat.push({ id: `${m.at || now()}-${Math.random()}`, from: m.from || '', accent: m.accent || '#e2a43a', text: m.text, at: m.at || now() });
          if (partyChat.length > 100) partyChat.shift();
          emit('party-updated', { kind: 'chat' });
        } else if (m.t === 'roster') {
          emit('party-updated', { kind: 'roster' });
        }
      });
      g.on('party-msg', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        handlePartyMsg(msg, { id: g.hostId, name: g.link?.peer?.nick || 'Host' }, false);
      });
    }
  }

  function broadcastPartyMsg(msg, exceptSid = null) {
    const h = getHost?.();
    if (!h) return;
    for (const [sid, guest] of h.guests.entries()) {
      if (sid !== exceptSid) guest.link.ctrl({ t: 'party_msg', msg });
    }
  }

  function sendPartyMsg(msg) {
    const h = getHost?.();
    const g = getGuest?.();
    if (h?.guests?.size) {
      broadcastPartyMsg(msg);
      return 'host';
    }
    if (g?.link) {
      g.link.ctrl({ t: 'party_msg', msg });
      return 'guest';
    }
    return null;
  }

  function publicSwipeState() {
    if (!swipeState) return null;
    const membersCount = Math.max(1, getRoomMembers().length);
    const likes = {};
    const matches = [];
    for (const it of swipeState.items) {
      const vMap = swipeState.votes[it.id] || {};
      const likers = Object.values(vMap).filter((v) => v.like);
      likes[it.id] = likers.map((v) => ({ id: v.id, name: v.name, accent: v.accent }));
      // Mutual match: liked by everyone if >= 2 members, or >= 2 people in a bigger room, or liked in solo mode
      const threshold = membersCount >= 2 ? Math.min(membersCount, Math.max(2, Math.ceil(membersCount * 0.66))) : 1;
      if (likers.length >= threshold) matches.push(it);
    }
    return {
      roundId: swipeState.roundId,
      endsAt: swipeState.endsAt,
      items: swipeState.items,
      likes,
      matches,
    };
  }

  function recordSwipeVote(roundId, itemId, member, like) {
    if (!swipeState || swipeState.roundId !== roundId) return;
    const vMap = (swipeState.votes[itemId] ||= {});
    vMap[member.id] = { id: member.id, name: member.name, accent: member.accent, like: !!like };
  }

  function handlePartyMsg(msg, sender, asHost) {
    switch (msg.kind) {
      case 'party_profile': {
        const p = msg.profile || {};
        const id = asHost ? sender.id : (p.id || sender.id);
        if (!id) return;
        const accent = accentForId(id, p.accent);
        const safeAv = sanitizeAvatar(p.avatar);
        partyPeers.set(id, {
          id,
          name: String(p.displayName || sender.name || id).slice(0, 40),
          handle: isValidHandle(p.handle) ? normalizeHandle(p.handle) : '',
          avatar: safeAv,
          accent,
          taste: msg.taste || null,
        });
        if (asHost) {
          const h = getHost?.();
          const g = sender.sid ? h?.guests?.get(sender.sid) : null;
          if (g) {
            g.accent = accent;
            g.avatar = safeAv || g.avatar || null;
            g.handle = isValidHandle(p.handle) ? normalizeHandle(p.handle) : g.handle;
            if (p.displayName) g.nick = String(p.displayName).slice(0, 40);
            h._roster();
            const q = getMediaHub?.()?.getQueue?.();
            if (Array.isArray(q) && q.length) {
              g.link.ctrl({ t: 'party_msg', msg: { kind: 'queue_sync', items: q } });
            }
          }
          broadcastPartyMsg({ ...msg, profile: { ...p, id, avatar: safeAv } }, sender.sid);
        }
        emit('party-updated', { kind: 'roster' });
        break;
      }

      case 'cursor': {
        const id = asHost ? sender.id : (msg.id || sender.id);
        if (!id) return;
        const peer = partyPeers.get(id);
        partyCursors.set(id, {
          id,
          name: String(msg.name || peer?.name || sender.name || id).slice(0, 32),
          accent: accentForId(id, msg.accent || peer?.accent),
          x: Math.max(0, Math.min(1, +msg.x || 0)),
          y: Math.max(0, Math.min(1, +msg.y || 0)),
          at: now(),
        });
        if (asHost) broadcastPartyMsg({ ...msg, id }, sender.sid);
        emit('party-cursor', { cursors: [...partyCursors.values()].filter((c) => now() - c.at < 8000) });
        break;
      }

      case 'swipe_start': {
        if (!Array.isArray(msg.items) || !msg.items.length) return;
        swipeState = {
          roundId: String(msg.roundId || `sw-${now()}`),
          endsAt: +msg.endsAt || (now() + 30000),
          items: msg.items.slice(0, 20),
          votes: {},
        };
        if (asHost) broadcastPartyMsg({ kind: 'swipe_state', state: publicSwipeState() });
        emit('party-updated', { kind: 'swipe', swipe: publicSwipeState() });
        break;
      }

      case 'swipe_vote': {
        const id = asHost ? sender.id : (msg.memberId || sender.id || 'peer');
        const peer = partyPeers.get(id);
        recordSwipeVote(msg.roundId, msg.itemId, {
          id,
          name: msg.memberName || peer?.name || sender.name || id,
          accent: accentForId(id, msg.accent || peer?.accent),
        }, !!msg.like);
        if (asHost) broadcastPartyMsg({ kind: 'swipe_state', state: publicSwipeState() });
        emit('party-updated', { kind: 'swipe', swipe: publicSwipeState() });
        break;
      }

      case 'swipe_state': {
        if (!msg.state) return;
        const st = msg.state;
        swipeState = {
          roundId: st.roundId,
          endsAt: st.endsAt,
          items: st.items || [],
          votes: {},
        };
        for (const [itemId, likers] of Object.entries(st.likes || {})) {
          swipeState.votes[itemId] = {};
          for (const l of likers) swipeState.votes[itemId][l.id] = { ...l, like: true };
        }
        emit('party-updated', { kind: 'swipe', swipe: st });
        break;
      }

      case 'wheel_state': {
        if (!msg.state) return;
        wheelState = msg.state;
        if (asHost) broadcastPartyMsg(msg, sender.sid);
        emit('party-updated', { kind: 'wheel', wheel: wheelState });
        break;
      }

      case 'brb_start': {
        const b = msg.brb || {};
        const durSec = Math.max(30, Math.min(1800, +b.durationSec || 120));
        const startedAt = +b.startedAt || now();
        const endsAt = Math.max(now() + 5000, +b.endsAt || (startedAt + durSec * 1000));
        const byId = asHost ? sender.id : (b.byId || sender.id || 'peer');
        brbState = {
          active: true,
          byId,
          byName: String(b.byName || sender.name || byId).slice(0, 40),
          accent: accentForId(byId, b.accent),
          startedAt,
          endsAt,
          durationSec: Math.round((endsAt - startedAt) / 1000),
        };
        if (asHost) {
          broadcastPartyMsg({ kind: 'brb_start', brb: brbState }, sender.sid);
          getHost?.()?.syncBrb?.(brbState);
        }
        getTheater?.()?.onPartyEvent?.('brb', brbState);
        emit('party-updated', { kind: 'brb', brb: brbState });
        break;
      }

      case 'brb_extend': {
        if (!brbState) return;
        const addMs = Math.max(30000, Math.min(600000, (+msg.addSec || 120) * 1000));
        brbState = { ...brbState, endsAt: brbState.endsAt + addMs, durationSec: Math.round((brbState.endsAt + addMs - brbState.startedAt) / 1000) };
        if (asHost) {
          broadcastPartyMsg({ kind: 'brb_start', brb: brbState });
          getHost?.()?.syncBrb?.(brbState);
        }
        getTheater?.()?.onPartyEvent?.('brb', brbState);
        emit('party-updated', { kind: 'brb', brb: brbState });
        break;
      }

      case 'brb_end': {
        brbState = null;
        if (asHost) {
          broadcastPartyMsg({ kind: 'brb_end' }, sender.sid);
          getHost?.()?.syncBrb?.(null);
        }
        getTheater?.()?.onPartyEvent?.('brb', null);
        emit('party-updated', { kind: 'brb', brb: null });
        break;
      }

      case 'rating_open': {
        const r = msg.round || {};
        if (!r.sessionId || !r.id) return;
        ratingSession = {
          sessionId: String(r.sessionId).slice(0, 64),
          id: String(r.id).slice(0, 64),
          type: r.type === 'series' ? 'series' : 'movie',
          title: String(r.title || r.id).slice(0, 140),
          poster: typeof r.poster === 'string' ? r.poster.slice(0, 500) : null,
          blind: r.blind !== false,
          revealed: !!r.revealed,
          expectedCount: Math.max(1, Number(r.expectedCount) || getRoomMembers().length || 1),
          votes: r.votes || {},
          avg: r.revealed ? (r.avg ?? null) : null,
        };
        const out = maskRatingSession(ratingSession, true);
        if (asHost) broadcastPartyMsg({ kind: 'rating_open', round: out }, sender.sid);
        getTheater?.()?.onPartyEvent?.('rating-open', out);
        break;
      }

      case 'rating_submit': {
        const v = msg.vote || {};
        const score = Math.max(1, Math.min(10, Math.round(Number(v.score) || 0)));
        if (!score) return;
        const id = asHost ? sender.id : (v.id || sender.id || 'peer');
        if (!ratingSession || (msg.sessionId && ratingSession.sessionId !== msg.sessionId)) {
          ratingSession = {
            sessionId: String(msg.sessionId || `rate-${now()}`).slice(0, 64),
            id: String(msg.titleId || 'unknown').slice(0, 64),
            type: 'movie',
            title: String(msg.title || '').slice(0, 140),
            poster: null,
            blind: true,
            revealed: false,
            expectedCount: Math.max(1, getRoomMembers().length || 1),
            votes: {},
            avg: null,
          };
        }
        const entry = {
          id,
          name: String(v.name || sender.name || id).slice(0, 40),
          accent: accentForId(id, v.accent),
          score,
          submitted: true,
          at: now(),
        };
        ratingSession.votes = { ...ratingSession.votes, [id]: entry };
        const vals = Object.values(ratingSession.votes).map((x) => x.score).filter((n) => n >= 1 && n <= 10);
        ratingSession.avg = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
        const need = Math.max(1, Number(ratingSession.expectedCount) || getRoomMembers().length || 1);
        if (!ratingSession.blind || Object.keys(ratingSession.votes).length >= need || need <= 1) {
          ratingSession.revealed = true;
        }
        store.updatePartyHistoryRating?.(ratingSession.sessionId, id, entry);
        const pub = maskRatingSession(ratingSession, true);
        if (asHost) broadcastPartyMsg({ kind: 'rating_state', round: pub });
        getTheater?.()?.onPartyEvent?.('rating-state', pub);
        emit('party-updated', { kind: 'rating', round: pub });
        break;
      }

      case 'rating_reveal': {
        if (!ratingSession) return;
        ratingSession.revealed = true;
        const out = maskRatingSession(ratingSession, false);
        if (asHost) broadcastPartyMsg({ kind: 'rating_state', round: out }, sender.sid);
        getTheater?.()?.onPartyEvent?.('rating-state', out);
        emit('party-updated', { kind: 'rating', round: out });
        break;
      }

      case 'rating_state': {
        if (!msg.round) return;
        const prevMine = ratingSession?.votes?.[myId()];
        const nextRound = { ...msg.round };
        if (prevMine && nextRound.votes?.[myId()] && nextRound.votes[myId()].score == null) {
          nextRound.votes = { ...nextRound.votes, [myId()]: prevMine };
        }
        ratingSession = nextRound;
        getTheater?.()?.onPartyEvent?.('rating-state', ratingSession);
        emit('party-updated', { kind: 'rating', round: ratingSession });
        break;
      }

      case 'note_add': {
        const note = sanitizePartyNote(msg.note, { id: sender.id, name: sender.name, accent: sender.accent });
        if (!note) return;
        if (note.titleKey && partyNotesState.titleKey && note.titleKey !== partyNotesState.titleKey) {
          partyNotesState = { titleKey: note.titleKey, notes: [] };
        } else if (note.titleKey && !partyNotesState.titleKey) {
          partyNotesState.titleKey = note.titleKey;
        }
        if (!partyNotesState.notes.some((x) => x.id === note.id)) {
          partyNotesState.notes = [...partyNotesState.notes, note].sort((a, b) => a.t - b.t).slice(0, 100);
        }
        if (asHost) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
        getTheater?.()?.onPartyEvent?.('notes', partyNotesState.notes);
        emit('party-updated', { kind: 'notes', notes: partyNotesState.notes });
        break;
      }

      case 'note_del': {
        const noteId = String(msg.id || '').slice(0, 48);
        if (!noteId) return;
        const existing = partyNotesState.notes.find((x) => x.id === noteId);
        if (!existing) return;
        if (asHost && existing.authorId !== sender.id) return;
        partyNotesState.notes = partyNotesState.notes.filter((x) => x.id !== noteId);
        if (asHost) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
        getTheater?.()?.onPartyEvent?.('notes', partyNotesState.notes);
        emit('party-updated', { kind: 'notes', notes: partyNotesState.notes });
        break;
      }

      case 'note_state': {
        if (!Array.isArray(msg.notes)) return;
        partyNotesState = {
          titleKey: String(msg.titleKey || '').slice(0, 120),
          notes: msg.notes.map((x) => sanitizePartyNote(x)).filter(Boolean).slice(0, 100),
        };
        getTheater?.()?.onPartyEvent?.('notes', partyNotesState.notes);
        emit('party-updated', { kind: 'notes', notes: partyNotesState.notes });
        break;
      }

      case 'queue_sync': {
        if (!Array.isArray(msg.items)) return;
        const synced = getMediaHub?.()?.setQueue?.(msg.items, { fromParty: true }) || msg.items;
        if (asHost) broadcastPartyMsg({ kind: 'queue_sync', items: synced }, sender.sid);
        break;
      }
    }
  }

  function getRoomMembers() {
    const me = myProfile();
    const h = getHost?.();
    const g = getGuest?.();
    const list = [];
    if (h?.guests?.size) {
      list.push({
        id: me.id,
        name: me.displayName || me.id,
        handle: me.handle || '',
        avatar: me.avatar,
        accent: accentForId(me.id, me.accent),
        role: 'host',
        isHost: true,
      });
      for (const guest of h.guests.values()) {
        const p = partyPeers.get(guest.id) || store.friend(guest.id) || {};
        list.push({
          id: guest.id,
          sid: guest.sid,
          name: p.name || guest.nick || guest.id,
          handle: p.handle || guest.handle || '',
          avatar: guest.avatar || p.avatar || null,
          accent: accentForId(guest.id, guest.accent || p.accent),
          role: guest.role || 'watch',
          isHost: false,
        });
      }
      return list;
    }
    if (g?.link) {
      const hostId = g.hostId || g.link.peer?.id || 'host';
      const hp = partyPeers.get(hostId) || store.friend(hostId) || {};
      list.push({
        id: hostId,
        name: hp.name || g.roster?.host || g.link.peer?.nick || hostId,
        handle: hp.handle || '',
        avatar: g.roster?.hostAvatar || hp.avatar || null,
        accent: accentForId(hostId, g.roster?.hostAccent || hp.accent),
        role: 'host',
        isHost: true,
      });
      const rList = g.roster?.list || [];
      if (rList.length) {
        for (const r of rList) {
          const isMe = r.id === me.id || r.idx === g.roster?.you;
          const p = (r.id && (partyPeers.get(r.id) || store.friend(r.id))) || {};
          list.push({
            id: r.id || (isMe ? me.id : `g-${r.idx}`),
            name: isMe ? (me.displayName || r.name) : (r.name || p.name || 'Guest'),
            handle: isMe ? me.handle : (r.handle || p.handle || ''),
            avatar: isMe ? me.avatar : (r.avatar || p.avatar || null),
            accent: accentForId(r.id || me.id, isMe ? me.accent : (r.accent || p.accent)),
            role: r.role || 'watch',
            isHost: false,
          });
        }
      } else {
        list.push({
          id: me.id,
          name: me.displayName || me.id,
          handle: me.handle || '',
          avatar: me.avatar,
          accent: accentForId(me.id, me.accent),
          role: 'guest',
          isHost: false,
        });
      }
      return list;
    }
    // Solo / pre-party preview: show ourself + any friends whose activity is cached
    list.push({
      id: me.id,
      name: me.displayName || me.id,
      handle: me.handle || '',
      avatar: me.avatar,
      accent: accentForId(me.id, me.accent),
      role: 'host',
      isHost: true,
    });
    return list;
  }

  // ========================================================================= HEAD-TO-HEAD COMPARE
  async function compareTitles(itemsInput) {
    const hub = getMediaHub?.();
    const meta = hub?.meta;
    const h = getHost?.();
    const voteItems = h?.vote?.length ? h._voteView() : [];
    const list = (Array.isArray(itemsInput) && itemsInput.length ? itemsInput : voteItems).slice(0, 8);
    if (!list.length) return { columns: [], highlights: { best: {}, sharedGenres: [] } };

    const myProf = myProfile();
    const lib = hub?.library?.();
    const myLb = pget('letterboxd') || {};
    const friendAct = store.get('friendActivity') || {};
    const friendProfs = store.d.friendProfiles || {};

    const columns = await Promise.all(list.map(async (entry) => {
      const rawId = typeof entry === 'string' ? entry : entry.id;
      const type = (typeof entry === 'object' && entry.type) || 'movie';
      let details = null;
      if (meta) {
        try { details = await meta.details(type, rawId); } catch {}
      }
      const name = details?.name || entry.name || rawId;
      const poster = details?.poster || entry.poster || null;
      const year = details?.year || (entry.year ? +entry.year : null) || (details?.releaseInfo ? +String(details.releaseInfo).slice(0, 4) : null) || null;
      const genres = details?.genres || [];
      let runtimeStr = details?.runtime || '';
      let runtimeMin = parseRuntimeMin(runtimeStr);
      let certification = details?.certification || null;
      let audience = details?.popularity ? Math.round(details.popularity) : null;

      const ratings = {
        imdb: details?.imdbRating ? parseFloat(details.imdbRating) : null,
        rt: null,
        letterboxd: null,
        mal: details?.malRating ? parseFloat(details.malRating) : null,
      };

      // 1) MDBList ratings when key exists (IMDb, RT, Letterboxd, MAL + votes)
      if (meta && /^tt\d+$/.test(rawId)) {
        const mdbKey = meta.keys().mdblist;
        if (mdbKey) {
          try {
            const mdb = await http.json(`https://api.mdblist.com/imdb/${rawId}?apikey=${encodeURIComponent(mdbKey)}`, { ttl: 24 * H });
            for (const r of mdb?.ratings || []) {
              if (r.value == null) continue;
              if (r.source === 'imdb') { ratings.imdb = +r.value; if (r.votes) audience = +r.votes; }
              if (r.source === 'tomatoes') ratings.rt = +r.value;
              if (r.source === 'letterboxd') ratings.letterboxd = +r.value;
              if (r.source === 'mal') ratings.mal = +r.value;
            }
            if (mdb?.runtime && !runtimeMin) { runtimeMin = +mdb.runtime; runtimeStr = `${runtimeMin} min`; }
            if (mdb?.certification && !certification) certification = mdb.certification;
          } catch {}
        }
        // 2) TMDB vote_count & runtime when TMDB key exists
        if (meta.tmdbOn() && details?.tmdbId) {
          try {
            const kind = type === 'series' ? 'tv' : 'movie';
            const tm = await meta.tmdb(`/${kind}/${details.tmdbId}`, {}, 24 * H);
            if (tm?.vote_count && (!audience || tm.vote_count > audience)) audience = tm.vote_count;
            const rt = tm?.runtime || tm?.episode_run_time?.[0];
            if (rt && !runtimeMin) { runtimeMin = +rt; runtimeStr = `${runtimeMin} min`; }
          } catch {}
        }
      }

      // 3) Anime score & popularity via AniList (keyless) when anime or Animation genre
      if (meta && (rawId.startsWith('anilist:') || rawId.startsWith('kitsu:') || genres.includes('Animation'))) {
        try {
          if (rawId.startsWith('anilist:')) {
            const aid = +rawId.slice('anilist:'.length);
            const a = await meta.anilist('query($id:Int){Media(id:$id){averageScore popularity duration seasonYear genres}}', { id: aid });
            const m = a?.data?.Media;
            if (m?.averageScore) ratings.mal = +(m.averageScore / 10).toFixed(1);
            if (m?.popularity && !audience) audience = m.popularity;
            if (m?.duration && !runtimeMin) { runtimeMin = m.duration; runtimeStr = `${m.duration} min`; }
          } else if (name) {
            const a = await meta.anilist('query($s:String){Media(search:$s,type:ANIME){averageScore popularity duration}}', { s: name });
            const m = a?.data?.Media;
            if (m?.averageScore && !ratings.mal) ratings.mal = +(m.averageScore / 10).toFixed(1);
            if (m?.popularity && !audience) audience = m.popularity;
          }
        } catch {}
      }

      // 4) 'Watched by friends' row (including ourself + friends/party members)
      const lbKey = imp.letterboxdKey(name, year || '');
      const watchedBy = [];

      // Check local profile
      const iWatched = lib?.isWatched?.(rawId, rawId) || !!myLb[lbKey]?.watched;
      const myRating = myLb[lbKey]?.rating || null;
      const myReview = myLb[lbKey]?.review || null;
      if (iWatched || myRating || myReview) {
        watchedBy.push({
          id: myProf.id,
          name: myProf.displayName || myProf.id,
          accent: accentForId(myProf.id, myProf.accent),
          avatar: myProf.avatar || null,
          watched: !!iWatched,
          rating: myRating,
          review: myReview,
        });
      }

      // Check all friends from friendActivity & cached friendProfiles
      const seenFriendIds = new Set([myProf.id]);
      for (const [fid, fa] of Object.entries(friendAct)) {
        if (seenFriendIds.has(fid)) continue;
        const hits = (fa.items || []).filter((x) =>
          (x.id && (x.id === rawId || String(x.id).startsWith(`${rawId}:`))) ||
          (x.name && imp.letterboxdKey(x.name, x.year || '') === lbKey)
        );
        if (!hits.length) continue;
        seenFriendIds.add(fid);
        const fMeta = store.friend(fid) || friendProfs[fid] || {};
        watchedBy.push({
          id: fid,
          name: fMeta.displayName || fMeta.name || fa.name || fid,
          accent: accentForId(fid, fMeta.accent || fa.accent),
          avatar: fMeta.avatar || fa.avatar || null,
          watched: hits.some((x) => x.watched),
          rating: hits.find((x) => x.rating)?.rating || null,
          review: hits.find((x) => x.review)?.review || null,
        });
      }

      // If no MDBList Letterboxd score, average friends' Letterboxd ratings if any
      if (ratings.letterboxd == null) {
        const rVals = watchedBy.map((w) => w.rating).filter((r) => typeof r === 'number' && r > 0);
        if (rVals.length) ratings.letterboxd = +(rVals.reduce((a, b) => a + b, 0) / rVals.length).toFixed(1);
      }

      return {
        id: rawId,
        type,
        name,
        poster,
        by: entry.by || null,
        votes: entry.votes ?? 0,
        voters: entry.voters || [],
        ratings,
        audience,
        year,
        released: details?.released || (year ? String(year) : null),
        genres,
        certification,
        runtime: runtimeStr || (runtimeMin ? `${runtimeMin} min` : null),
        runtimeMin,
        watchedBy,
      };
    }));

    return {
      columns,
      highlights: computeCompareHighlights(columns),
    };
  }

  // ========================================================================= GROUP TASTE MATCHER
  async function matchGroupTaste(filters = {}) {
    const hub = getMediaHub?.();
    const meta = hub?.meta;

    // 1. Collect taste profiles for everyone in the room (or friends if solo)
    const members = [];
    const meSummary = myTasteSummary();
    members.push(buildMemberAffinity(meSummary));

    const roomMembers = getRoomMembers();
    const friendAct = store.get('friendActivity') || {};
    const friendProfs = store.d.friendProfiles || {};

    for (const rm of roomMembers) {
      if (rm.id === meSummary.id) continue;
      const peer = partyPeers.get(rm.id);
      const prof = friendProfs[rm.id];
      const act = friendAct[rm.id];
      if (peer?.taste) {
        members.push(buildMemberAffinity({ ...peer.taste, id: rm.id, name: rm.name, accent: rm.accent }));
      } else if (prof || act) {
        members.push(buildMemberAffinity({
          id: rm.id,
          name: rm.name,
          accent: rm.accent,
          favorites: prof?.favorites || [],
          history: prof?.history || [],
          ratings: prof?.ratings || [],
          items: act?.items || [],
        }));
      } else {
        members.push(buildMemberAffinity({ id: rm.id, name: rm.name, accent: rm.accent }));
      }
    }

    // If solo in the room, also include friends whose profiles/activity we have cached so the user can test & match with friends anytime
    if (members.length === 1) {
      for (const f of store.friends().filter((x) => x.trust !== 'block').slice(0, 5)) {
        const prof = friendProfs[f.id];
        const act = friendAct[f.id];
        if (prof || act) {
          members.push(buildMemberAffinity({
            id: f.id,
            name: prof?.displayName || f.name || f.id,
            accent: accentForId(f.id, prof?.accent || f.accent),
            favorites: prof?.favorites || [],
            history: prof?.history || [],
            ratings: prof?.ratings || [],
            items: act?.items || [],
          }));
        }
      }
    }

    // 2. Fetch candidate pool (TMDB discover + recommendations + trending when key exists, Cinemeta + installed addon catalogs + SEED_MOVIES)
    const selectedGenres = normalizeGenres(
      Array.isArray(filters.genres) ? filters.genres : (filters.genre && filters.genre !== 'all' ? [filters.genre] : [])
    );
    const candMap = new Map();
    const addCand = (it) => {
      if (!it || !it.id || !it.name) return;
      const existing = candMap.get(it.id);
      const norm = normalizeGenres((it.genres || []).length ? it.genres : (SEED_GENRES_BY_ID[it.id] || []), it.genre_ids);
      if (!existing) {
        candMap.set(it.id, norm.length ? { ...it, genres: norm } : it);
      } else if ((!existing.genres || !existing.genres.length) && norm.length) {
        candMap.set(it.id, { ...existing, genres: norm });
      }
    };

    if (meta) {
      if (meta.tmdbOn()) {
        const seeds = [...new Set(members.flatMap((m) => m.seedIds || []))].slice(0, 4);
        const discBase = { sort_by: 'popularity.desc', 'vote_count.gte': '40' };
        if (filters.maxRuntime && +filters.maxRuntime > 0) discBase['with_runtime.lte'] = String(+filters.maxRuntime);
        const era = filters.era && filters.era !== 'all' ? String(filters.era) : '';
        if (era === '2020s') { discBase['primary_release_date.gte'] = '2020-01-01'; discBase['primary_release_date.lte'] = '2029-12-31'; }
        else if (era === '2010s') { discBase['primary_release_date.gte'] = '2010-01-01'; discBase['primary_release_date.lte'] = '2019-12-31'; }
        else if (era === '2000s') { discBase['primary_release_date.gte'] = '2000-01-01'; discBase['primary_release_date.lte'] = '2009-12-31'; }
        else if (era === '1990s' || era === '90s') { discBase['primary_release_date.gte'] = '1990-01-01'; discBase['primary_release_date.lte'] = '1999-12-31'; }
        else if (era === 'classic') { discBase['primary_release_date.lte'] = '1989-12-31'; }

        const tmdbIds = selectedGenres.map((g) => GENRE_TO_TMDB_ID[g]).filter(Boolean);
        const tmdbJobs = [
          meta.trending('movie').then((list) => (list || []).forEach(addCand)).catch(() => {}),
          ...seeds.map(async (imdb) => {
            try {
              const f = await meta.tmdbFind(imdb, 'movie');
              if (f) {
                const r = await meta.tmdb(`/movie/${f.id}/recommendations`, {}, 12 * H);
                for (const t of (r.results || []).slice(0, 12)) addCand(Meta.fromTmdb(t, 'movie'));
              }
            } catch {}
          }),
        ];
        if (tmdbIds.length || filters.era || filters.maxRuntime) {
          if (tmdbIds.length) {
            tmdbJobs.push(
              meta.tmdb('/discover/movie', { ...discBase, with_genres: tmdbIds.join(',') }, 6 * H)
                .then((r) => (r.results || []).slice(0, 20).forEach((t) => addCand(Meta.fromTmdb(t, 'movie'))))
                .catch(() => {})
            );
            if (tmdbIds.length > 1) {
              tmdbJobs.push(
                meta.tmdb('/discover/movie', { ...discBase, with_genres: tmdbIds.join('|') }, 6 * H)
                  .then((r) => (r.results || []).slice(0, 20).forEach((t) => addCand(Meta.fromTmdb(t, 'movie'))))
                  .catch(() => {})
              );
            }
          } else {
            tmdbJobs.push(
              meta.tmdb('/discover/movie', discBase, 6 * H)
                .then((r) => (r.results || []).slice(0, 20).forEach((t) => addCand(Meta.fromTmdb(t, 'movie'))))
                .catch(() => {})
            );
          }
        }
        await Promise.all(tmdbJobs);
      }

      // Always include Cinemeta top + selected genre catalogs + installed addon movie catalogs
      const urls = [`${CINEMETA}/catalog/movie/top.json`];
      for (const sg of selectedGenres.slice(0, 3)) {
        urls.unshift(`${CINEMETA}/catalog/movie/top/genre=${encodeURIComponent(sg)}.json`);
      }
      if (!selectedGenres.length && filters.mood && MOOD_GENRES[filters.mood]?.[0]) {
        urls.unshift(`${CINEMETA}/catalog/movie/top/genre=${encodeURIComponent(MOOD_GENRES[filters.mood][0])}.json`);
      }
      const catalogJobs = urls.map((u) =>
        http.json(u, { ttl: 6 * H })
          .then((r) => (r?.metas || []).map(Meta.fromStremio).forEach(addCand))
          .catch(() => {})
      );
      if (hub?.addons && hub?.client) {
        const extraAddons = (hub.addons() || [])
          .filter((a) => a?.transportUrl && !/cinemeta/i.test(a.transportUrl))
          .slice(0, 3);
        for (const ad of extraAddons) {
          const cat = (ad.manifest?.catalogs || []).find((c) => c.type === 'movie' && c.id);
          if (cat) {
            catalogJobs.push(
              hub.client.request(ad.transportUrl, { resource: 'catalog', type: 'movie', id: cat.id })
                .then((r) => (r?.metas || []).slice(0, 25).map(Meta.fromStremio).forEach(addCand))
                .catch(() => {})
            );
          }
        }
      }
      await Promise.all(catalogJobs);
    }

    // Merge curated multi-genre fallback seed pool so rare filter combinations never come up empty
    for (const sm of SEED_MOVIES) addCand(sm);

    const candidates = [...candMap.values()];
    const allScored = scoreGroupTaste(candidates, members, filters, 16, { fillToLimit: true });
    const picks = allScored.slice(0, 5);
    const fallbackHint = picks.some((p) => p.matchTier === 3)
      ? 'relaxed'
      : picks.some((p) => p.matchTier === 2)
        ? 'partial'
        : 'exact';
    return {
      picks,
      pool: allScored,
      fallbackHint,
      members: members.map((m) => ({ id: m.id, name: m.name, accent: m.accent, watchedCount: m.watchedIds.size + m.watchedKeys.size })),
    };
  }

  // ========================================================================= IPC HANDLERS
  const handle = (name, fn) => ipcMain.handle(`social:${name}`, (e, a) => fn(a || {}));

  const meResponse = (p) => ({
    ...p,
    comments: store.profileComments?.(myId()) || [],
    accent: accentForId(p.id, p.accent),
    catalogAvatars: CATALOG_AVATARS,
    friendLink: `majlis://friend/${p.id}`,
    signedFriendCode: encodeSignedFriendCode(store),
  });

  function applyMePatch(patch, { broadcastToFriends = false } = {}) {
    if (typeof patch.handle === 'string') {
      const h = normalizeHandle(patch.handle);
      if (h && !isValidHandle(h)) throw new Error('invalid_handle');
      const existing = h ? store.lookupLocalHandle(h) : null;
      if (existing && existing.id && existing.id !== myId()) throw new Error('handle_taken');
      patch = { ...patch, handle: h };
    }
    const updated = store.setSocialProfile(patch);
    if (updated.handle) store.rememberHandle(updated.handle, { id: myId(), pk: store.identity().pkB64, name: updated.displayName || myId() });
    broadcastStatusToFriends();
    if (broadcastToFriends) {
      const shared = mySharedPayload();
      for (const f of store.friends()) {
        if (f.trust === 'block' || f.friendStatus === 'pending_out') continue;
        if (presenceMap.has(f.id)) sendSocialSignal(f.id, 'profile_res', { profile: shared });
      }
    }
    sendPartyMsg({ kind: 'party_profile', profile: summaryCard(), taste: myTasteSummary() });
    const h = getHost?.();
    if (h?.guests?.size) h._roster();
    emit('social-updated', { kind: 'me' });
    return meResponse(updated);
  }

  handle('me', () => {
    const p = myProfile();
    const hub = getMediaHub?.();
    const libFavs = (hub?.library?.()?.favorites || []).map((x) => ({
      id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null,
    }));
    return { ...meResponse(p), libraryFavorites: libFavs };
  });

  handle('me-set', (patch) => applyMePatch(patch, { broadcastToFriends: false }));
  handle('profile-save', (payload) => applyMePatch(payload, { broadcastToFriends: true }));

  handle('comment-add', ({ targetId, body }) => {
    const target = isId(targetId) ? targetId : myId();
    const me = myProfile();
    const cleanBody = String(body || '').trim().slice(0, 800);
    if (!cleanBody) throw new Error('empty_comment');
    const saved = store.addProfileComment?.(target, {
      id: `c-${now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorId: myId(),
      authorName: me.displayName || myId(),
      authorAvatar: me.avatar && me.avatar.length < 30000 ? me.avatar : null,
      authorAccent: accentForId(myId(), me.accent),
      body: cleanBody,
      at: now(),
    });
    if (target !== myId() && isId(target)) {
      sendSocialSignal(target, 'comment_add', { comment: saved });
    }
    emit('social-updated', { kind: 'comment', id: target });
    return { ok: !!saved, comment: saved, comments: store.profileComments?.(target) || [] };
  });

  handle('comment-del', ({ targetId, commentId }) => {
    const target = isId(targetId) ? targetId : myId();
    const deleted = !!store.deleteProfileComment?.(target, commentId, myId());
    if (deleted && target !== myId() && isId(target)) {
      sendSocialSignal(target, 'comment_del', { commentId });
    }
    emit('social-updated', { kind: 'comment', id: target });
    return { ok: deleted, comments: store.profileComments?.(target) || [] };
  });

  function myRawCompatibilityData() {
    const p = myProfile();
    const hub = getMediaHub?.();
    const lib = hub?.library?.();
    const lb = Object.values(pget('letterboxd') || {});
    const tune = pget('mediaTune') || {};
    const libFavs = (lib?.favorites || []).map((x) => ({
      id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null, genres: x.genres || [],
    }));
    const ratings = [
      ...lb,
      ...(Array.isArray(p.ratings) ? p.ratings.map((r) => ({ id: r.id, name: r.title, poster: r.poster, rating: r.score, scale: 10, watched: true })) : []),
    ];
    return {
      favorites: [...(p.favorites || []), ...libFavs],
      history: lib?.history || [],
      items: Object.values(lib?.items || {}),
      ratings,
      tune,
    };
  }

  handle('friends', () => {
    const meRaw = myRawCompatibilityData();
    const friends = store.friends().map((f) => {
      const prof = store.friendProfile(f.id) || {};
      const pState = presenceMap.get(f.id) || null;
      const pMeta = presenceMeta.get(f.id) || {};
      const compatibility = prof && Object.keys(prof).length
        ? computeFriendCompatibility(meRaw, prof)
        : { pct: null, sharedGenres: [], sharedTopRated: [], commonWatched: 0 };
      return {
        id: f.id,
        name: prof.displayName || f.name || f.id,
        handle: prof.handle || f.handle || pMeta.handle || '',
        avatar: prof.avatar ?? f.avatar ?? null,
        accent: accentForId(f.id, prof.accent || f.accent),
        bio: prof.bio ?? f.bio ?? '',
        trust: f.trust || 'ask',
        friendStatus: f.friendStatus || 'accepted',
        added: f.added || 0,
        lastSeen: f.lastSeen || prof.cachedAt || 0,
        online: !!pState && f.trust !== 'block',
        presence: f.trust === 'block' ? 'blocked' : (pState || 'offline'),
        watching: f.trust === 'block' ? null : (pMeta.watching || null),
        inParty: f.trust === 'block' ? null : (pMeta.inParty || null),
        compatibility,
      };
    });
    return {
      myId: myId(),
      friendLink: `majlis://friend/${myId()}`,
      signedFriendCode: encodeSignedFriendCode(store),
      friends,
      requests: store.friendRequests(),
    };
  });

  function parseFriendTarget(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) return { error: 'empty_target' };
    let pathPart = raw;
    let pkParam = null;
    if (/^majlis:\/\/friend\//i.test(raw)) {
      const tail = raw.replace(/^majlis:\/\/friend\//i, '').replace(/\/+$/, '');
      const qIdx = tail.indexOf('?');
      pathPart = qIdx >= 0 ? tail.slice(0, qIdx) : tail;
      try { pathPart = decodeURIComponent(pathPart); } catch {}
      if (qIdx >= 0) {
        try {
          const pkRaw = new URLSearchParams(tail.slice(qIdx + 1)).get('pk');
          if (pkRaw && /^[A-Za-z0-9+/=_-]{32,128}$/.test(pkRaw)) pkParam = pkRaw;
        } catch {}
      }
    }
    const digitsOnly = pathPart.replace(/\s+/g, '');
    if (isId(digitsOnly)) return { id: digitsOnly, pk: pkParam };
    if (isValidHandle(pathPart)) return { handle: normalizeHandle(pathPart), pk: pkParam };
    return { error: 'invalid_id_or_handle' };
  }

  handle('add', async ({ idOrHandle }) => {
    const raw = String(idOrHandle || '').trim();
    if (!raw) throw new Error('empty_target');
    const signedCode = verifySignedFriendCode(raw);
    if (signedCode) {
      if (signedCode.id === myId()) throw new Error('cannot_add_self');
      store.removeFriendRequest(signedCode.id);
      if (signedCode.handle) store.rememberHandle(signedCode.handle, { id: signedCode.id, pk: signedCode.pkB64, name: signedCode.name });
      const f = store.upsertFriend({
        id: signedCode.id,
        pk: signedCode.pkB64,
        name: signedCode.name || signedCode.id,
        handle: signedCode.handle || '',
        accent: accentForId(signedCode.id, signedCode.accent),
        trust: store.friend(signedCode.id)?.trust === 'block' ? 'ask' : (store.friend(signedCode.id)?.trust || 'ask'),
        friendStatus: 'accepted',
        lastSeen: now(),
      });
      if (!store.friendProfile(signedCode.id)) {
        store.saveFriendProfile(signedCode.id, {
          id: signedCode.id,
          displayName: signedCode.name || signedCode.id,
          handle: signedCode.handle || '',
          accent: accentForId(signedCode.id, signedCode.accent),
          bio: '',
          historyHidden: false,
          cachedAt: now(),
        });
      }
      pushPresence?.();
      const s1 = sendSocialSignal(signedCode.id, 'friend_req', { card: summaryCard() });
      const s2 = sendSocialSignal(signedCode.id, 'profile_req', {});
      sendSocialSignal(signedCode.id, 'profile_res', { profile: mySharedPayload() });
      if (!s1 || !s2) pendingFriendSync.add(signedCode.id);
      emit('social-updated', {});
      return { ok: true, friend: f, status: 'accepted', verifiedOffline: true };
    }

    // Accept majlis://friend/123456789?pk=..., majlis://friend/@handle, 9-digit ID, or @handle
    const parsed = parseFriendTarget(raw);
    if (parsed.error) throw new Error(parsed.error);
    let targetId = parsed.id || null;
    let resolved = null;

    if (!targetId) {
      resolved = await resolveHandle(parsed.handle);
      if (!resolved || !isId(resolved.id)) throw new Error('handle_not_found');
      targetId = resolved.id;
    }

    if (targetId === myId()) throw new Error('cannot_add_self');

    // If they already sent us an incoming request, accept it immediately
    const incoming = store.friendRequests().find((r) => r.id === targetId && r.direction === 'in');
    if (incoming) {
      store.removeFriendRequest(targetId);
      const f = store.upsertFriend({
        id: targetId,
        pk: incoming.pk || resolved?.pk || parsed.pk || null,
        name: incoming.name || resolved?.name || targetId,
        handle: incoming.handle || resolved?.handle || '',
        avatar: incoming.avatar || null,
        accent: accentForId(targetId, incoming.accent),
        bio: incoming.bio || '',
        trust: 'ask',
        friendStatus: 'accepted',
        lastSeen: now(),
      });
      pushPresence?.();
      sendSocialSignal(targetId, 'friend_accept', { card: summaryCard() });
      sendSocialSignal(targetId, 'profile_req', {});
      sendSocialSignal(targetId, 'profile_res', { profile: mySharedPayload() });
      emit('social-updated', {});
      return { ok: true, friend: f, status: 'accepted' };
    }

    const f = store.upsertFriend({
      id: targetId,
      ...(resolved?.pk || parsed.pk ? { pk: resolved?.pk || parsed.pk } : {}),
      name: resolved?.name || store.friend(targetId)?.name || targetId,
      handle: resolved?.handle || store.friend(targetId)?.handle || (parsed.handle || ''),
      accent: accentForId(targetId, store.friend(targetId)?.accent),
      trust: store.friend(targetId)?.trust === 'block' ? 'ask' : (store.friend(targetId)?.trust || 'ask'),
      friendStatus: store.friend(targetId)?.friendStatus === 'accepted' ? 'accepted' : 'pending_out',
    });
    pushPresence?.();
    const sentReq = sendSocialSignal(targetId, 'friend_req', { card: summaryCard() });
    const sentProf = sendSocialSignal(targetId, 'profile_req', {});
    if (!sentReq || !sentProf) pendingFriendSync.add(targetId);
    emit('social-updated', {});
    return { ok: true, friend: f, status: f.friendStatus };
  });

  handle('accept', ({ id }) => {
    if (!isId(id)) return false;
    const req = store.friendRequests().find((r) => r.id === id);
    store.removeFriendRequest(id);
    const f = store.upsertFriend({
      id,
      ...(req?.pk ? { pk: req.pk } : {}),
      name: req?.name || store.friend(id)?.name || id,
      handle: req?.handle || store.friend(id)?.handle || '',
      avatar: req?.avatar || store.friend(id)?.avatar || null,
      accent: accentForId(id, req?.accent || store.friend(id)?.accent),
      bio: req?.bio || store.friend(id)?.bio || '',
      trust: 'ask',
      friendStatus: 'accepted',
      lastSeen: now(),
    });
    pushPresence?.();
    sendSocialSignal(id, 'friend_accept', { card: summaryCard() });
    sendSocialSignal(id, 'profile_req', {});
    sendSocialSignal(id, 'profile_res', { profile: mySharedPayload() });
    emit('social-updated', {});
    return f;
  });

  handle('decline', ({ id }) => {
    if (!isId(id)) return false;
    store.removeFriendRequest(id);
    sendSocialSignal(id, 'friend_decline', {});
    emit('social-updated', {});
    return true;
  });

  handle('block', ({ id, block = true }) => {
    if (!isId(id)) return false;
    store.removeFriendRequest(id);
    const f = store.upsertFriend({ id, trust: block ? 'block' : 'ask' });
    pushPresence?.();
    emit('social-updated', {});
    return f;
  });

  handle('remove', ({ id }) => {
    if (!isId(id)) return false;
    store.removeFriend(id);
    pushPresence?.();
    emit('social-updated', {});
    return true;
  });

  handle('profile', ({ id }) => {
    const target = id || myId();
    if (target === myId()) {
      return { ...mySharedPayload(), isMe: true, online: true };
    }
    const f = store.friend(target);
    const cached = store.friendProfile(target);
    const act = (store.get('friendActivity') || {})[target];
    const pState = presenceMap.get(target) || null;
    const pMeta = presenceMeta.get(target) || {};

    // Request fresh profile P2P over signed signaling if registered
    if (isId(target) && f?.trust !== 'block') {
      sendSocialSignal(target, 'profile_req', {});
    }

    const base = cached || {
      id: target,
      displayName: f?.name || act?.name || target,
      handle: f?.handle || pMeta.handle || '',
      avatar: f?.avatar || act?.avatar || null,
      accent: accentForId(target, f?.accent || act?.accent),
      bio: f?.bio || '',
      song: null,
      songDataUrl: null,
      shareHistory: 'friends',
      historyHidden: false,
      favorites: [],
      lists: [],
      history: (act?.items || []).filter((x) => x.watched).map((x) => ({ id: x.id, name: x.name, type: 'movie', poster: null, at: act.at || 0 })),
      ratings: (act?.items || []).filter((x) => x.rating || x.review).map((x) => ({ id: x.id, name: x.name, year: x.year, rating: x.rating, review: x.review, watched: x.watched })),
    };

    const localWall = store.profileComments?.(target) || [];
    const cachedComments = Array.isArray(cached?.comments) ? cached.comments : [];
    const cMap = new Map();
    for (const c of [...localWall, ...cachedComments]) if (c?.id && !cMap.has(c.id)) cMap.set(c.id, c);
    const comments = [...cMap.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 100);
    const compatibility = computeFriendCompatibility(myRawCompatibilityData(), base);

    return {
      ...base,
      comments,
      compatibility,
      isMe: false,
      online: !!pState && f?.trust !== 'block',
      presence: f?.trust === 'block' ? 'blocked' : (pState || 'offline'),
      watching: pMeta.watching || null,
      inParty: pMeta.inParty || null,
      trust: f?.trust || null,
      isFriend: !!f && f.friendStatus !== 'pending_out',
    };
  });

  handle('room', () => {
    const h = getHost?.();
    const g = getGuest?.();
    const role = h?.guests?.size ? 'host' : g?.link ? 'guest' : null;
    const members = getRoomMembers();
    const vote = h?.vote?.length ? h._voteView() : [];
    const control = h?.getWatchControl ? h.getWatchControl() : (g ? { mode: g.watchControl?.mode || 'host', holderId: g.watchControl?.holderId || null, holderName: g.watchControl?.holderName || null } : { mode: 'host', holderId: null, holderName: null });
    return {
      role,
      hostingEnabled: !!h?.enabled,
      code: h?.code || null,
      members,
      vote,
      chat: partyChat.slice(-60),
      cursors: [...partyCursors.values()].filter((c) => now() - c.at < 8000),
      swipe: publicSwipeState(),
      wheel: wheelState,
      brb: brbState && brbState.endsAt > now() ? brbState : null,
      ratingRound: maskRatingSession(ratingSession, true),
      control,
      notes: partyNotesState.notes,
      readyState: h?.readySnapshot ? h.readySnapshot() : null,
    };
  });

  function addPartyNote({ titleKey = '', t, text }) {
    const me = myProfile();
    const h = getHost?.();
    const isHost = !!h?.guests?.size;
    const g = getGuest?.();
    const note = sanitizePartyNote({ titleKey, t, text }, { id: me.id, name: me.displayName || me.id, accent: accentForId(me.id, me.accent) });
    if (!note) return partyNotesState.notes;
    if (note.titleKey && partyNotesState.titleKey && note.titleKey !== partyNotesState.titleKey) {
      partyNotesState = { titleKey: note.titleKey, notes: [] };
    } else if (note.titleKey && !partyNotesState.titleKey) {
      partyNotesState.titleKey = note.titleKey;
    }
    partyNotesState.notes = [...partyNotesState.notes, note].sort((a, b) => a.t - b.t).slice(0, 100);
    if (isHost) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
    else if (g?.link) sendPartyMsg({ kind: 'note_add', note });
    getTheater?.()?.onPartyEvent?.('notes', partyNotesState.notes);
    emit('party-updated', { kind: 'notes', notes: partyNotesState.notes });
    return partyNotesState.notes;
  }

  function delPartyNote(id) {
    const noteId = String(id || '').slice(0, 48);
    if (!noteId) return partyNotesState.notes;
    const h = getHost?.();
    const isHost = !!h?.guests?.size;
    const g = getGuest?.();
    partyNotesState.notes = partyNotesState.notes.filter((x) => x.id !== noteId);
    if (isHost) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
    else if (g?.link) sendPartyMsg({ kind: 'note_del', id: noteId });
    getTheater?.()?.onPartyEvent?.('notes', partyNotesState.notes);
    emit('party-updated', { kind: 'notes', notes: partyNotesState.notes });
    return partyNotesState.notes;
  }

  handle('note-add', (a) => addPartyNote(a || {}));
  handle('note-del', ({ id } = {}) => delPartyNote(id));

  handle('similar', async ({ id, type = 'movie', excludeIds = [] } = {}) => {
    const cleanId = String(id || '').split(':')[0];
    if (!cleanId) return [];
    const mediaType = type === 'series' ? 'series' : 'movie';
    const hub = getMediaHub?.();
    const meta = hub?.meta;
    const h = getHost?.();
    const blocked = new Set([
      cleanId,
      ...(Array.isArray(excludeIds) ? excludeIds.map((x) => String(x || '').split(':')[0]) : []),
      ...((h?.vote || []).map((v) => String(v.id || '').split(':')[0])),
    ]);
    const cands = new Map();
    const pushItem = (it) => {
      if (!it || !it.id || !it.name) return;
      const cid = String(it.id).split(':')[0];
      if (!/^[\w:.-]+$/.test(cid) || blocked.has(cid) || cands.has(cid)) return;
      cands.set(cid, {
        id: cid,
        type: it.type === 'series' ? 'series' : mediaType,
        name: String(it.name).slice(0, 140),
        poster: typeof it.poster === 'string' && /^https:\/\//.test(it.poster) ? it.poster : null,
        year: it.year || (it.releaseInfo ? Number(String(it.releaseInfo).slice(0, 4)) || null : null),
        genres: normalizeGenres(it.genres || [], it.genre_ids),
        imdbRating: it.imdbRating || null,
        cast: it.cast || [],
        director: it.director || [],
      });
    };

    let seedGenres = normalizeGenres(SEED_GENRES_BY_ID[cleanId] || []);
    if (meta) {
      const det = await meta.details(mediaType, cleanId).catch(() => null);
      if (det) {
        seedGenres = normalizeGenres([...seedGenres, ...(det.genres || [])]);
        for (const r of det.recommendations || []) pushItem(r);
        if (meta.tmdbOn() && det.tmdbId && cands.size < 8) {
          const kind = mediaType === 'series' ? 'tv' : 'movie';
          const sim = await meta.tmdb(`/${kind}/${det.tmdbId}/similar`, {}, 12 * H).catch(() => null);
          for (const t of (sim?.results || []).slice(0, 12)) pushItem(Meta.fromTmdb(t, mediaType));
        }
      }
      if (cands.size < 8) {
        const topGenres = seedGenres.slice(0, 2);
        const urls = topGenres.length
          ? topGenres.map((g) => `${CINEMETA}/catalog/${mediaType}/top/genre=${encodeURIComponent(g)}.json`)
          : [`${CINEMETA}/catalog/${mediaType}/top.json`];
        const results = await Promise.all(urls.map((u) => http.json(u, { ttl: 6 * H }).catch(() => ({ metas: [] }))));
        for (const res of results) for (const m of (res.metas || []).slice(0, 24)) pushItem(Meta.fromStremio(m));
      }
    }
    if (mediaType === 'movie') {
      const seedLow = new Set(seedGenres.map((g) => g.toLowerCase()));
      for (const sm of SEED_MOVIES) {
        const smG = normalizeGenres(sm.genres || []);
        if (!seedLow.size || smG.some((g) => seedLow.has(g.toLowerCase()))) pushItem(sm);
      }
    }

    const list = [...cands.values()];
    const targetG = new Set(seedGenres.map((g) => g.toLowerCase()));
    list.sort((a, b) => {
      const ah = (a.genres || []).filter((g) => targetG.has(g.toLowerCase())).length;
      const bh = (b.genres || []).filter((g) => targetG.has(g.toLowerCase())).length;
      return (bh - ah) || ((parseFloat(b.imdbRating || '0') || 0) - (parseFloat(a.imdbRating || '0') || 0));
    });
    const top = list.slice(0, 8);
    if (meta?.tmdbOn?.()) {
      await Promise.all(top.map(async (it) => {
        const m = /^tmdb:(?:movie|series):(\d+)$/.exec(it.id);
        if (!m) return;
        try {
          const ex = await meta.tmdb(`/${it.type === 'series' ? 'tv' : 'movie'}/${m[1]}/external_ids`, {}, 24 * 7 * H);
          if (ex?.imdb_id) it.id = ex.imdb_id;
        } catch {}
      }));
    }
    return top;
  });

  handle('compare', ({ ids, items }) => compareTitles(items || ids));
  handle('taste', ({ filters }) => matchGroupTaste(filters || {}));

  handle('swipe-start', async ({ items, filters, durationSec = 30 }) => {
    let deck = Array.isArray(items) && items.length ? items : null;
    if (!deck) {
      const res = await matchGroupTaste(filters || {});
      deck = res.pool.length ? res.pool : res.picks;
    }
    const roundId = `sw-${now()}`;
    const endsAt = now() + Math.max(10, Math.min(120, +durationSec || 30)) * 1000;
    swipeState = {
      roundId,
      endsAt,
      items: (deck || []).slice(0, 15).map((x) => ({
        id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null,
        imdbRating: x.imdbRating || null, genres: (x.genres || []).slice(0, 3), matchPct: x.matchPct || null,
      })),
      votes: {},
    };
    sendPartyMsg({ kind: 'swipe_start', roundId, endsAt, items: swipeState.items });
    const pub = publicSwipeState();
    emit('party-updated', { kind: 'swipe', swipe: pub });
    return pub;
  });

  handle('swipe-vote', ({ roundId, itemId, like }) => {
    const me = myProfile();
    const rid = roundId || swipeState?.roundId;
    if (!rid || !itemId) return publicSwipeState();
    const member = { id: me.id, name: me.displayName || me.id, accent: accentForId(me.id, me.accent) };
    recordSwipeVote(rid, itemId, member, !!like);
    sendPartyMsg({ kind: 'swipe_vote', roundId: rid, itemId, memberId: member.id, memberName: member.name, accent: member.accent, like: !!like });
    if (getHost?.()?.guests?.size) broadcastPartyMsg({ kind: 'swipe_state', state: publicSwipeState() });
    const pub = publicSwipeState();
    emit('party-updated', { kind: 'swipe', swipe: pub });
    return pub;
  });

  handle('wheel-spin', ({ items }) => {
    const h = getHost?.();
    const pool = (Array.isArray(items) && items.length ? items : (h?.vote?.length ? h._voteView() : [])).slice(0, 12);
    if (!pool.length) return null;
    const winnerIdx = crypto.randomInt(0, pool.length);
    const sliceDeg = 360 / pool.length;
    // Land on the center of winnerIdx's slice after 5-7 full rotations
    const extraSpins = 360 * (5 + crypto.randomInt(0, 3));
    const targetSliceCenter = winnerIdx * sliceDeg + sliceDeg / 2;
    const angle = Math.round(extraSpins + (360 - targetSliceCenter));
    wheelState = {
      roundId: `wh-${now()}`,
      items: pool.map((x) => ({ id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null })),
      winnerIdx,
      winner: pool[winnerIdx],
      angle,
      at: now(),
    };
    sendPartyMsg({ kind: 'wheel_state', state: wheelState });
    emit('party-updated', { kind: 'wheel', wheel: wheelState });
    return wheelState;
  });

  handle('cursor', ({ x, y }) => {
    const me = myProfile();
    sendPartyMsg({ kind: 'cursor', id: me.id, name: me.displayName || me.id, accent: accentForId(me.id, me.accent), x: +x || 0, y: +y || 0 });
    return true;
  });

  handle('party-chat', ({ text }) => {
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return false;
    const me = myProfile();
    const accent = accentForId(me.id, me.accent);
    const h = getHost?.();
    const g = getGuest?.();
    if (h?.guests?.size) {
      h.chat({ from: me.displayName || me.id, idx: 0, text: clean, accent });
    } else if (g?.link) {
      g.ctrl({ t: 'chat', text: clean, accent });
    } else {
      partyChat.push({ id: `${now()}-${Math.random()}`, from: me.displayName || me.id, accent, text: clean, at: now() });
      emit('party-updated', { kind: 'chat' });
    }
    return true;
  });

  handle('brb', ({ action = 'start', durationSec = 120, addSec = 120 } = {}) => {
    const me = myProfile();
    const h = getHost?.();
    const isHost = !!h?.guests?.size;
    if (action === 'end') {
      brbState = null;
      if (isHost) {
        broadcastPartyMsg({ kind: 'brb_end' });
        h.syncBrb?.(null);
      } else {
        sendPartyMsg({ kind: 'brb_end' });
      }
      getTheater?.()?.onPartyEvent?.('brb', null);
      emit('party-updated', { kind: 'brb', brb: null });
      return null;
    }
    if (action === 'extend' && brbState) {
      const addMs = Math.max(30000, Math.min(600000, (+addSec || 120) * 1000));
      brbState = { ...brbState, endsAt: brbState.endsAt + addMs, durationSec: Math.round((brbState.endsAt + addMs - brbState.startedAt) / 1000) };
      if (isHost) {
        broadcastPartyMsg({ kind: 'brb_start', brb: brbState });
        h.syncBrb?.(brbState);
      } else {
        sendPartyMsg({ kind: 'brb_extend', addSec });
      }
      getTheater?.()?.onPartyEvent?.('brb', brbState);
      emit('party-updated', { kind: 'brb', brb: brbState });
      return brbState;
    }
    const durSec = Math.max(30, Math.min(1800, +durationSec || 120));
    const t = now();
    brbState = {
      active: true,
      byId: me.id,
      byName: me.displayName || me.id,
      accent: accentForId(me.id, me.accent),
      startedAt: t,
      endsAt: t + durSec * 1000,
      durationSec: durSec,
    };
    if (isHost) {
      broadcastPartyMsg({ kind: 'brb_start', brb: brbState });
      h.syncBrb?.(brbState);
    } else {
      sendPartyMsg({ kind: 'brb_start', brb: brbState });
    }
    getTheater?.()?.onPartyEvent?.('brb', brbState);
    emit('party-updated', { kind: 'brb', brb: brbState });
    return brbState;
  });

  function openPartyRating({ sessionId, id, type, title, poster, blind = true }) {
    if (!id || isIncognito?.()) return null;
    const members = getRoomMembers();
    ratingSession = {
      sessionId: String(sessionId || `rate-${now()}`).slice(0, 64),
      id: String(id).slice(0, 64),
      type: type === 'series' ? 'series' : 'movie',
      title: String(title || id).slice(0, 140),
      poster: poster || null,
      blind: !!blind,
      revealed: !blind,
      expectedCount: Math.max(1, members.length || 1),
      votes: {},
      avg: null,
    };
    const out = maskRatingSession(ratingSession, true);
    if (getHost?.()?.guests?.size) broadcastPartyMsg({ kind: 'rating_open', round: out });
    getTheater?.()?.onPartyEvent?.('rating-open', out);
    return out;
  }

  handle('rate', ({ id, type, title, poster, score, sessionId, action } = {}) => {
    if (action === 'reveal') {
      if (!ratingSession) return { round: null };
      ratingSession.revealed = true;
      const out = maskRatingSession(ratingSession, false);
      if (getHost?.()?.guests?.size) broadcastPartyMsg({ kind: 'rating_state', round: out });
      else if (getGuest?.()?.link) sendPartyMsg({ kind: 'rating_reveal', sessionId: ratingSession.sessionId });
      getTheater?.()?.onPartyEvent?.('rating-state', out);
      emit('party-updated', { kind: 'rating', round: out });
      return { round: out };
    }
    const me = myProfile();
    const s = Math.max(1, Math.min(10, Math.round(Number(score) || 0)));
    if (!id || !s) return null;
    const saved = store.addSocialRating?.({ id, type, title, poster, score: s, ratedAt: now(), partyId: sessionId || null });
    const entry = { id: me.id, name: me.displayName || me.id, accent: accentForId(me.id, me.accent), score: s, submitted: true, at: now() };
    const sid = sessionId || ratingSession?.sessionId;
    if (sid) store.updatePartyHistoryRating?.(sid, me.id, entry);
    if (ratingSession && (!sid || ratingSession.sessionId === sid)) {
      ratingSession.votes = { ...ratingSession.votes, [me.id]: entry };
      const vals = Object.values(ratingSession.votes).map((x) => x.score).filter((n) => n >= 1 && n <= 10);
      ratingSession.avg = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
      const need = Math.max(1, Number(ratingSession.expectedCount) || getRoomMembers().length || 1);
      if (!ratingSession.blind || Object.keys(ratingSession.votes).length >= need || need <= 1) {
        ratingSession.revealed = true;
      }
      const pub = maskRatingSession(ratingSession, true);
      if (getHost?.()?.guests?.size) broadcastPartyMsg({ kind: 'rating_state', round: pub });
      else if (getGuest?.()?.link) sendPartyMsg({ kind: 'rating_submit', sessionId: ratingSession.sessionId, titleId: id, title, vote: entry });
      const selfView = maskRatingSession(ratingSession, true);
      if (!selfView.revealed && selfView.votes?.[me.id]) {
        selfView.votes = { ...selfView.votes, [me.id]: entry };
      }
      getTheater?.()?.onPartyEvent?.('rating-state', selfView);
      emit('social-updated', { kind: 'rating', id });
      return { saved, round: selfView };
    }
    emit('social-updated', { kind: 'rating', id });
    return { saved, round: ratingSession };
  });

  handle('party-history', () => store.partyHistory?.() || []);
  handle('party-history-del', ({ id }) => store.deletePartyHistory?.(id) || false);
  handle('wrapped', ({ range = 'all' } = {}) => computeMajlisWrapped(store.partyHistory?.() || [], range, myId()));

  wireParty();
  setInterval(broadcastStatusToFriends, 30000).unref();

  return {
    openPartyRating,
    onFriendLink: async (targetIdOrUrl) => {
      const signedCode = verifySignedFriendCode(targetIdOrUrl);
      if (signedCode) {
        if (signedCode.id === myId()) return false;
        if (signedCode.handle) store.rememberHandle(signedCode.handle, { id: signedCode.id, pk: signedCode.pkB64, name: signedCode.name });
        store.upsertFriend({
          id: signedCode.id,
          pk: signedCode.pkB64,
          name: signedCode.name || signedCode.id,
          handle: signedCode.handle || '',
          accent: accentForId(signedCode.id, signedCode.accent),
          friendStatus: 'accepted',
          lastSeen: now(),
        });
        if (!store.friendProfile(signedCode.id)) {
          store.saveFriendProfile(signedCode.id, {
            id: signedCode.id,
            displayName: signedCode.name || signedCode.id,
            handle: signedCode.handle || '',
            accent: accentForId(signedCode.id, signedCode.accent),
            bio: '',
            historyHidden: false,
            cachedAt: now(),
          });
        }
        pushPresence?.();
        const s1 = sendSocialSignal(signedCode.id, 'friend_req', { card: summaryCard() });
        const s2 = sendSocialSignal(signedCode.id, 'profile_req', {});
        if (!s1 || !s2) pendingFriendSync.add(signedCode.id);
        emit('social-updated', { kind: 'deeplink', id: signedCode.id });
        return true;
      }
      const parsed = parseFriendTarget(targetIdOrUrl);
      if (parsed.error) return false;
      let targetId = parsed.id || null;
      let resolved = null;
      if (!targetId) {
        resolved = await resolveHandle(parsed.handle);
        if (!resolved || !isId(resolved.id)) return false;
        targetId = resolved.id;
      }
      if (!isId(targetId) || targetId === myId()) return false;
      store.upsertFriend({
        id: targetId,
        ...(resolved?.pk || parsed.pk ? { pk: resolved?.pk || parsed.pk } : {}),
        name: resolved?.name || store.friend(targetId)?.name || targetId,
        handle: resolved?.handle || store.friend(targetId)?.handle || (parsed.handle || ''),
        accent: accentForId(targetId, store.friend(targetId)?.accent),
        friendStatus: store.friend(targetId)?.friendStatus === 'accepted' ? 'accepted' : 'pending_out',
      });
      pushPresence?.();
      const s1 = sendSocialSignal(targetId, 'friend_req', { card: summaryCard() });
      const s2 = sendSocialSignal(targetId, 'profile_req', {});
      if (!s1 || !s2) pendingFriendSync.add(targetId);
      emit('social-updated', { kind: 'deeplink', id: targetId });
      return true;
    },
    syncNetIdentity,
    broadcastStatusToFriends,
    addPartyNote,
    delPartyNote,
    getPartyNotes: (titleKey = null) => (!titleKey || !partyNotesState.titleKey || partyNotesState.titleKey === titleKey ? [...partyNotesState.notes] : []),
    clearPartyNotes: (nextTitleKey = '') => {
      partyNotesState = { titleKey: String(nextTitleKey || ''), notes: [] };
      if (getHost?.()?.guests?.size) broadcastPartyMsg({ kind: 'note_state', ...partyNotesState });
      getTheater?.()?.onPartyEvent?.('notes', []);
    },
    syncPartyQueue: (items) => {
      if (!Array.isArray(items)) return false;
      const sent = sendPartyMsg({ kind: 'queue_sync', items });
      return !!sent;
    },
  };
}

function computeMajlisWrapped(historyList = [], range = 'all', myId = '') {
  const ref = new Date();
  const y = ref.getFullYear(), m = ref.getMonth();
  const entries = (Array.isArray(historyList) ? historyList : []).filter((x) => {
    if (!x) return false;
    if (range !== 'month') return true;
    const d = new Date(x.startedAt || x.endedAt || 0);
    return d.getFullYear() === y && d.getMonth() === m;
  });

  let totalMs = 0;
  const genreMap = new Map();
  const buddyMap = new Map();
  const ratedEntries = [];
  let hasNightOwl = false;

  for (const e of entries) {
    const ms = Math.max(0, Number(e.watchedMs) || 0);
    totalMs += ms;
    const hr = new Date(e.startedAt || e.endedAt || 0).getHours();
    if (hr >= 0 && hr < 5) hasNightOwl = true;

    for (const g of normalizeGenres(e.genres || [])) {
      const cur = genreMap.get(g) || { genre: g, sessions: 0, minutes: 0 };
      cur.sessions++;
      cur.minutes += Math.round(ms / 60000);
      genreMap.set(g, cur);
    }

    for (const a of e.attendees || []) {
      if (!a || !a.id || (myId && a.id === myId) || a.id === 'host') continue;
      const cur = buddyMap.get(a.id) || { id: a.id, name: a.name || a.id, accent: a.accent || '#e2a43a', avatar: a.avatar || null, sessions: 0, minutes: 0 };
      cur.sessions++;
      cur.minutes += Math.round(ms / 60000);
      buddyMap.set(a.id, cur);
    }

    if (typeof e.groupRating === 'number' && e.groupRating > 0) ratedEntries.push(e);
  }

  const totalMinutes = Math.round(totalMs / 60000);
  const topGenres = [...genreMap.values()].sort((a, b) => b.sessions - a.sessions || b.minutes - a.minutes).slice(0, 6);
  const topBuddies = [...buddyMap.values()].sort((a, b) => b.sessions - a.sessions || b.minutes - a.minutes).slice(0, 6);
  const avgGroupRating = ratedEntries.length
    ? +(ratedEntries.reduce((s, x) => s + x.groupRating, 0) / ratedEntries.length).toFixed(1)
    : null;
  const highestRated = ratedEntries.slice().sort((a, b) => b.groupRating - a.groupRating)[0] || null;

  const milestones = [];
  if (entries.length >= 1) milestones.push('first_party');
  if (entries.length >= 5) milestones.push('five_parties');
  if (entries.length >= 20) milestones.push('twenty_parties');
  if (totalMinutes >= 600) milestones.push('ten_hours');
  if (ratedEntries.length >= 3) milestones.push('critic_circle');
  if (hasNightOwl) milestones.push('night_owl');

  return {
    range: range === 'month' ? 'month' : 'all',
    totalSessions: entries.length,
    totalMinutes,
    topGenres,
    topBuddies,
    avgGroupRating,
    highestRated: highestRated ? { titleId: highestRated.titleId, title: highestRated.title, poster: highestRated.poster, groupRating: highestRated.groupRating } : null,
    milestones,
  };
}

module.exports = {
  setup,
  encodeSignedFriendCode,
  verifySignedFriendCode,
  computeMajlisWrapped,
  CATALOG_AVATARS,
  MOOD_GENRES,
  accentForId,
  normalizeHandle,
  isValidHandle,
  verifySocialEnvelope,
  buildSharedProfilePayload,
  parseRuntimeMin,
  computeCompareHighlights,
  buildMemberAffinity,
  scoreGroupTaste,
  normalizeGenres,
  computeFriendCompatibility,
  maskRatingSession,
  sanitizePartyNote,
};
