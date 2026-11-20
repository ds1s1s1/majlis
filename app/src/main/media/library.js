'use strict';
// The viewer's library, stored in Stremio's own LibraryItem shape (stremio-core
// src/types/library/library_item.rs) so it syncs with a Stremio account as is. Times in ms.
//  - watched: time actually watched > 70% of the duration (not the position)
//  - leaving in the credits (offset > 90%) resets the offset and moves on to the next video
//  - playing something not in the library creates it removed + temp (it shows in Continue
//    Watching, not in the library)
// Plus what Stremio doesn't keep: a watch history (for the History tab), a watchlist and favorites.
const { WatchedBitField } = require('./watched-bitfield');
const WATCHED = 0.7, CREDITS = 0.9, CW_MAX = 100, HISTORY_MAX = 3000, MIN_VALID_DUR_MS = 121000;

function now() { return new Date().toISOString(); }

function localDayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseRuntimeMin(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw === 'string') {
    const m = raw.match(/\d+/);
    if (m) return parseInt(m[0], 10);
  }
  return null;
}

function parseRatingNum(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

function applyMetaFields(it, meta) {
  if (!it || !meta) return;
  if (meta.tmdbId && !it.tmdbId) it.tmdbId = meta.tmdbId;
  if (meta.year != null && it.year == null) it.year = meta.year;
  if (Array.isArray(meta.genres) && meta.genres.length && (!Array.isArray(it.genres) || !it.genres.length)) {
    it.genres = meta.genres.slice(0, 8);
  }
  if (!Array.isArray(it.directors) || !it.directors.length) {
    if (Array.isArray(meta.directors) && meta.directors.length) {
      it.directors = meta.directors.slice(0, 8).map((d) => (typeof d === 'string' ? { id: null, name: d } : { id: d?.id ?? null, name: d?.name || '' })).filter((d) => d.name);
    } else if (Array.isArray(meta.director) && meta.director.length) {
      it.directors = meta.director.slice(0, 8).map((d) => (typeof d === 'string' ? { id: null, name: d } : { id: d?.id ?? null, name: d?.name || '' })).filter((d) => d.name);
    }
  }
  if ((!Array.isArray(it.cast) || !it.cast.length) && Array.isArray(meta.cast) && meta.cast.length) {
    it.cast = meta.cast.slice(0, 12).map((c) => (typeof c === 'string' ? { id: null, name: c } : { id: c?.id ?? null, name: c?.name || '' })).filter((c) => c.name);
  }
  const rt = parseRuntimeMin(meta.runtimeMin ?? meta.runtime);
  if (rt && !it.runtimeMin) it.runtimeMin = rt;
  const rat = parseRatingNum(meta.imdbRating);
  if (rat && !it.imdbRating) it.imdbRating = rat;
}

function blank(meta) {
  const t = now();
  const it = {
    _id: meta.id, name: meta.name || '', type: meta.type, poster: meta.poster || null, posterShape: meta.posterShape || 'poster',
    removed: true, temp: true, _ctime: t, _mtime: t, behaviorHints: meta.behaviorHints || {},
    state: { lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false },
  };
  applyMetaFields(it, meta);
  return it;
}

class Library {
  // load(): { items: {id: LibraryItem}, history: [], watchlist: [], favorites: [] }; save(state)
  constructor({ load, save }) {
    const d = load() || {};
    this.items = d.items || {}; this.history = d.history || []; this.watchlist = d.watchlist || []; this.favorites = d.favorites || [];
    this.customLists = Array.isArray(d.customLists) ? d.customLists : [];
    this.watchLog = d.watchLog && typeof d.watchLog === 'object' ? d.watchLog : {};
    this.saveFn = save; this.dirty = new Set(); this.timer = null;
  }
  _save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 1500); }
  flush() { clearTimeout(this.timer); this.saveFn({ items: this.items, history: this.history, watchlist: this.watchlist, favorites: this.favorites, customLists: this.customLists, watchLog: this.watchLog }); }
  _touch(it) { it._mtime = now(); this.dirty.add(it._id); this._save(); }

  get(id) { return this.items[id] || null; }
  inLibrary(id) { const it = this.items[id]; return !!it && !it.removed; }

  enrichMeta(id, meta) {
    const it = this.items[id];
    if (!it || !meta) return null;
    applyMetaFields(it, meta);
    this._save();
    return it;
  }

  add(meta) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    Object.assign(it, {
      name: meta.name || it.name,
      poster: meta.poster || it.poster,
      removed: false,
      temp: false,
    });
    applyMetaFields(it, meta);
    this._touch(it); return it;
  }
  remove(id) { const it = this.items[id]; if (it) { it.removed = true; it.temp = false; this._touch(it); } }

  // while playing (every few seconds): position and duration in ms, `delta` ms actually watched
  progress(meta, videoId, offsetMs, durationMs, delta) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    applyMetaFields(it, meta);
    const s = it.state;
    if (s.video_id !== videoId) { s.video_id = videoId; s.timeWatched = 0; } // a new episode starts its own count
    s.timeOffset = Math.max(0, Math.round(offsetMs));
    if (durationMs > 0 && (durationMs > MIN_VALID_DUR_MS || meta?.type === 'channel' || s.duration <= MIN_VALID_DUR_MS)) {
      if (durationMs > MIN_VALID_DUR_MS || !s.duration) s.duration = Math.round(durationMs);
    }
    s.lastWatched = now();
    if (meta?.videoReleased) s.videoReleased = meta.videoReleased;
    if (Array.isArray(meta?.videoIds)) it._videoIds = meta.videoIds;
    if (delta > 0 && delta < 60000) {
      s.timeWatched += delta;
      s.overallTimeWatched += delta;
      const dayKey = localDayKey();
      this.watchLog[dayKey] = (Number(this.watchLog[dayKey]) || 0) + delta;
    }
    const validDur = s.duration > MIN_VALID_DUR_MS || meta?.type === 'channel';
    if (validDur && s.timeWatched > s.duration * WATCHED && !this.isWatched(meta.id, videoId)) {
      s.flaggedWatched = 1; s.timesWatched += 1;
      s.majlisWatched = [...new Set([...(s.majlisWatched || []), videoId])];
      this._syncWatchedBitfield(it, videoId);
      this.history.unshift({
        id: meta.id, videoId, type: meta.type, name: meta.name, poster: meta.poster || null,
        year: it.year ?? null, genres: it.genres || [], directors: it.directors || [], cast: it.cast || [],
        runtimeMin: it.runtimeMin ?? null, imdbRating: it.imdbRating ?? null, durationMs: s.duration || null,
        at: Date.now(),
      });
      if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    }
    this._touch(it);
    return it;
  }

  _syncWatchedBitfield(it, lastVideoId = it.state.video_id) {
    const ids = it._videoIds;
    if (!Array.isArray(ids) || !ids.length) return;
    it.state.watched = WatchedBitField.fromWatchedSet(ids, new Set(it.state.majlisWatched || []), lastVideoId || '').serialize();
  }

  syncBitfield(id, videoIds = []) {
    const it = this.items[id];
    if (!it || !videoIds.length) return;
    it._videoIds = videoIds;
    const merged = new Set(it.state.majlisWatched || []);
    if (it.state.watched) {
      for (const vid of WatchedBitField.parse(it.state.watched, videoIds).toWatchedSet()) merged.add(vid);
    }
    it.state.majlisWatched = [...merged];
    this._syncWatchedBitfield(it, it.state.video_id);
    this._save();
  }

  // the player closed: in the credits -> start the next video from the top next time
  stopped(meta, nextVideoId) {
    const it = this.items[meta.id];
    if (!it) return;
    const s = it.state;
    const validDur = s.duration > MIN_VALID_DUR_MS || meta?.type === 'channel';
    if (validDur && s.timeOffset > s.duration * CREDITS) {
      s.timeOffset = 0;
      if (nextVideoId) { s.video_id = nextVideoId; s.timeOffset = 1; s.timeWatched = 0; s.videoReleased = meta?.nextReleased || null; }
    }
    this._touch(it);
  }

  // our own list of watched videos + Stremio state.watched bitfield
  isWatched(id, videoId) { const w = this.items[id]?.state.majlisWatched; return Array.isArray(w) && w.includes(videoId || id); }
  isSeasonWatched(id, seasonVideos = []) {
    const eps = (seasonVideos || []).filter((v) => v && v.season !== 0 && v.id);
    return eps.length > 0 && eps.every((v) => this.isWatched(id, v.id));
  }
  setWatched(meta, videoId, on, videoIds = null) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    if (Array.isArray(videoIds) && videoIds.length) it._videoIds = videoIds;
    const w = new Set(it.state.majlisWatched || []);
    if (on) w.add(videoId || meta.id); else w.delete(videoId || meta.id);
    it.state.majlisWatched = [...w]; it.state.flaggedWatched = w.size ? 1 : 0;
    this._syncWatchedBitfield(it, videoId);
    this._touch(it);
  }
  setSeasonWatched(meta, seasonVideos = [], on = true, allVideos = null) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    const pool = Array.isArray(allVideos) && allVideos.length ? allVideos : seasonVideos;
    const allIds = pool.map((v) => v?.id).filter(Boolean);
    if (allIds.length) it._videoIds = allIds;
    const w = new Set(it.state.majlisWatched || []);
    for (const v of seasonVideos || []) {
      if (!v || v.season === 0 || !v.id) continue;
      if (on) w.add(v.id); else w.delete(v.id);
    }
    it.state.majlisWatched = [...w];
    it.state.flaggedWatched = w.size ? 1 : 0;
    this._syncWatchedBitfield(it, seasonVideos?.[0]?.id);
    reconcileSeriesResume(it, pool);
    this._touch(it);
  }
  markPrevWatched(meta, videos = [], targetVideoId, on = true) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    const ordered = [...(videos || [])]
      .filter((v) => v && v.season != null && v.season !== 0 && v.id)
      .sort((a, b) => (Number(a.season) - Number(b.season)) || ((Number(a.episode ?? a.number) || 0) - (Number(b.episode ?? b.number) || 0)));
    const allIds = ordered.map((v) => v.id);
    if (allIds.length) it._videoIds = allIds;
    const idx = ordered.findIndex((v) => v.id === targetVideoId);
    const slice = idx >= 0 ? ordered.slice(0, idx + 1) : ordered.filter((v) => v.id === targetVideoId);
    const w = new Set(it.state.majlisWatched || []);
    for (const v of slice) {
      if (on) w.add(v.id); else w.delete(v.id);
    }
    it.state.majlisWatched = [...w];
    it.state.flaggedWatched = w.size ? 1 : 0;
    this._syncWatchedBitfield(it, targetVideoId);
    reconcileSeriesResume(it, ordered);
    this._touch(it);
  }

  // Stremio's continue watching: not "other", in the library or temp, with a position, never unaired
  continueWatching({ nowMs = Date.now() } = {}) {
    return Object.values(this.items).filter((it) => {
      if (it.type === 'other' || (it.removed && !it.temp) || !(it.state.timeOffset > 0)) return false;
      if (it.behaviorHints?.unaired) return false;
      const rel = it.state?.videoReleased;
      if (rel && Number.isFinite(Date.parse(rel)) && Date.parse(rel) > nowMs) return false;
      return true;
    }).sort((a, b) => String(b._mtime).localeCompare(String(a._mtime))).slice(0, CW_MAX);
  }
  upcomingWatching({ nowMs = Date.now() } = {}) {
    return Object.values(this.items).filter((it) => {
      if (it.type === 'other' || (it.removed && !it.temp)) return false;
      if (it.behaviorHints?.unaired) return true;
      const rel = it.state?.videoReleased;
      return !!(rel && Number.isFinite(Date.parse(rel)) && Date.parse(rel) > nowMs);
    }).sort((a, b) => {
      const ta = Date.parse(a.state?.videoReleased || '') || Number.MAX_SAFE_INTEGER;
      const tb = Date.parse(b.state?.videoReleased || '') || Number.MAX_SAFE_INTEGER;
      return ta - tb;
    }).slice(0, 40);
  }
  rewind(id) {
    const it = this.items[id];
    if (!it) return false;
    it.state.timeOffset = 0;
    it.state.timeWatched = 0;
    this._touch(it);
    return true;
  }
  dismiss(id) {
    const it = this.items[id];
    if (!it) return false;
    it.state.timeOffset = 0;
    if (it.temp) it.removed = true;
    this._touch(it);
    return true;
  }
  library() { return Object.values(this.items).filter((it) => !it.removed).sort((a, b) => String(b._mtime).localeCompare(String(a._mtime))); }

  getCustomLists() { return this.customLists; }
  createList(name) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return null;
    if (this.customLists.length >= 50) throw new Error('custom_lists_limit');
    const list = {
      id: `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      items: [],
      createdAt: Date.now(),
    };
    this.customLists.unshift(list);
    this._save();
    return list;
  }
  renameList(id, name) {
    const clean = String(name || '').trim().slice(0, 60);
    const list = this.customLists.find((x) => x.id === id);
    if (!list || !clean) return null;
    list.name = clean;
    this._save();
    return list;
  }
  deleteList(id) {
    const prev = this.customLists.length;
    this.customLists = this.customLists.filter((x) => x.id !== id);
    if (this.customLists.length === prev) return false;
    this._save();
    return true;
  }
  reorderLists(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return this.customLists;
    const byId = new Map(this.customLists.map((l) => [l.id, l]));
    const next = [];
    for (const id of ids) {
      const hit = byId.get(id);
      if (hit) { next.push(hit); byId.delete(id); }
    }
    for (const rem of byId.values()) next.push(rem);
    this.customLists = next;
    this._save();
    return this.customLists;
  }
  toggleCustomListItem(listId, meta) {
    const list = this.customLists.find((x) => x.id === listId);
    if (!list || !meta?.id) return null;
    const idx = list.items.findIndex((x) => x.id === meta.id);
    if (idx >= 0) {
      list.items.splice(idx, 1);
      this._save();
      return { added: false, list };
    }
    if (list.items.length >= 500) list.items.pop();
    list.items.unshift({
      id: meta.id,
      type: meta.type || 'movie',
      name: String(meta.name || meta.id).slice(0, 200),
      poster: meta.poster || null,
      year: meta.year ?? null,
      genres: Array.isArray(meta.genres) ? meta.genres.slice(0, 6) : [],
      at: Date.now(),
    });
    this._save();
    return { added: true, list };
  }

  toggleList(list, meta) {
    const l = this[list];
    const i = l.findIndex((x) => x.id === meta.id);
    if (i >= 0) l.splice(i, 1);
    else l.unshift({
      id: meta.id, type: meta.type, name: meta.name, poster: meta.poster || null,
      year: meta.year ?? null,
      genres: Array.isArray(meta.genres) ? meta.genres.slice(0, 8) : [],
      runtimeMin: parseRuntimeMin(meta.runtimeMin ?? meta.runtime),
      imdbRating: parseRatingNum(meta.imdbRating),
      at: Date.now(),
    });
    this._save();
    return i < 0;
  }

  // History tab: TODAY / THIS WEEK / THIS MONTH / <year>
  static groupHistory(history, nowMs = Date.now()) {
    const d = new Date(nowMs), day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const week = day - ((d.getDay() + 1) % 7) * 864e5; // the week starts on Saturday here
    const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const groups = new Map();
    for (const h of history) {
      const g = h.at >= day ? 'today' : h.at >= week ? 'week' : h.at >= month ? 'month' : String(new Date(h.at).getFullYear());
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(h);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }

  // what changed since the last sync push (Stremio datastorePut)
  takeDirty() { const ids = [...this.dirty]; this.dirty.clear(); return ids.map((id) => this.items[id]).filter(Boolean); }
  // remote items newer than ours replace ours
  merge(remote) {
    for (const r of remote) {
      const l = this.items[r._id];
      if (!l || String(r._mtime) > String(l._mtime)) this.items[r._id] = r;
    }
    this._save();
  }

  repair() {
    let corruptedRemoved = 0;
    let repairedCount = 0;
    const nextItems = {};
    for (const [k, raw] of Object.entries(this.items || {})) {
      if (!raw || typeof raw !== 'object' || !k || typeof raw.name !== 'string') {
        corruptedRemoved++;
        continue;
      }
      const st = raw.state && typeof raw.state === 'object' ? { ...raw.state } : {};
      if (!raw.state || typeof raw.state !== 'object') repairedCount++;
      if (!Array.isArray(st.majlisWatched)) {
        if (st.majlisWatched != null) repairedCount++;
        st.majlisWatched = [];
      }
      if (typeof st.timeOffset !== 'number' || !Number.isFinite(st.timeOffset) || st.timeOffset < 0) {
        if (st.timeOffset != null) repairedCount++;
        st.timeOffset = 0;
      }
      if (typeof st.duration !== 'number' || !Number.isFinite(st.duration) || st.duration < 0) {
        if (st.duration != null) repairedCount++;
        st.duration = 0;
      }
      nextItems[k] = { ...raw, _id: raw._id || k, state: st };
    }
    this.items = nextItems;
    const dedupeList = (arr) => {
      if (!Array.isArray(arr)) { repairedCount++; return []; }
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        if (!x || typeof x !== 'object' || !x.id) { corruptedRemoved++; continue; }
        const key = `${x.type || ''}:${x.id}`;
        if (seen.has(key)) { repairedCount++; continue; }
        seen.add(key);
        out.push(x);
      }
      return out;
    };
    this.watchlist = dedupeList(this.watchlist);
    this.favorites = dedupeList(this.favorites);
    if (!Array.isArray(this.history)) { this.history = []; repairedCount++; }
    else {
      const cleanHist = this.history.filter((x) => x && typeof x === 'object' && x.id);
      corruptedRemoved += this.history.length - cleanHist.length;
      this.history = cleanHist;
    }
    if (corruptedRemoved > 0 || repairedCount > 0) this._save();
    return { itemCount: Object.keys(this.items).length, corruptedRemoved, repairedCount };
  }
}

function reconcileSeriesResume(item, videos = [], nowMs = Date.now()) {
  if (!item || !item.state || !Array.isArray(videos) || !videos.length) return item;
  const released = videos
    .filter((v) => {
      if (!v || v.season == null || v.season === 0 || !v.id) return false;
      if (!v.released) return true;
      const ms = Date.parse(v.released);
      return !Number.isFinite(ms) || ms <= nowMs;
    })
    .sort((a, b) => (Number(a.season) - Number(b.season)) || ((Number(a.episode ?? a.number) || 0) - (Number(b.episode ?? b.number) || 0)));
  if (!released.length) return item;
  const watched = new Set(item.state.majlisWatched || []);
  const firstUnwatched = released.find((v) => !watched.has(v.id));
  if (firstUnwatched) {
    item.state.video_id = firstUnwatched.id;
    item.state.timeOffset = 1;
    item.state.videoReleased = firstUnwatched.released || null;
    item.state.flaggedWatched = 0;
  } else {
    item.state.timeOffset = 0;
    item.state.flaggedWatched = 1;
  }
  return item;
}

module.exports = { Library, WATCHED, CREDITS, reconcileSeriesResume };
