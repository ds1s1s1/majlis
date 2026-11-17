'use strict';
// The viewer's library, stored in Stremio's own LibraryItem shape (stremio-core
// src/types/library/library_item.rs) so it syncs with a Stremio account as is. Times in ms.
//  - watched: time actually watched > 70% of the duration (not the position)
//  - leaving in the credits (offset > 90%) resets the offset and moves on to the next video
//  - playing something not in the library creates it removed + temp (it shows in Continue
//    Watching, not in the library)
// Plus what Stremio doesn't keep: a watch history (for the History tab), a watchlist and favorites.
const WATCHED = 0.7, CREDITS = 0.9, CW_MAX = 100, HISTORY_MAX = 3000;

function now() { return new Date().toISOString(); }

function blank(meta) {
  const t = now();
  return {
    _id: meta.id, name: meta.name || '', type: meta.type, poster: meta.poster || null, posterShape: meta.posterShape || 'poster',
    removed: true, temp: true, _ctime: t, _mtime: t, behaviorHints: meta.behaviorHints || {},
    state: { lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false },
  };
}

class Library {
  // load(): { items: {id: LibraryItem}, history: [], watchlist: [], favorites: [] }; save(state)
  constructor({ load, save }) {
    const d = load() || {};
    this.items = d.items || {}; this.history = d.history || []; this.watchlist = d.watchlist || []; this.favorites = d.favorites || [];
    this.saveFn = save; this.dirty = new Set(); this.timer = null;
  }
  _save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 1500); }
  flush() { clearTimeout(this.timer); this.saveFn({ items: this.items, history: this.history, watchlist: this.watchlist, favorites: this.favorites }); }
  _touch(it) { it._mtime = now(); this.dirty.add(it._id); this._save(); }

  get(id) { return this.items[id] || null; }
  inLibrary(id) { const it = this.items[id]; return !!it && !it.removed; }

  add(meta) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    Object.assign(it, { name: meta.name || it.name, poster: meta.poster || it.poster, removed: false, temp: false });
    this._touch(it); return it;
  }
  remove(id) { const it = this.items[id]; if (it) { it.removed = true; it.temp = false; this._touch(it); } }

  // while playing (every few seconds): position and duration in ms, `delta` ms actually watched
  progress(meta, videoId, offsetMs, durationMs, delta) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    const s = it.state;
    if (s.video_id !== videoId) { s.video_id = videoId; s.timeWatched = 0; } // a new episode starts its own count
    s.timeOffset = Math.max(0, Math.round(offsetMs));
    if (durationMs > 0) s.duration = Math.round(durationMs);
    s.lastWatched = now();
    if (delta > 0 && delta < 60000) { s.timeWatched += delta; s.overallTimeWatched += delta; }
    if (s.duration && s.timeWatched > s.duration * WATCHED && !this.isWatched(meta.id, videoId)) {
      s.flaggedWatched = 1; s.timesWatched += 1;
      s.majlisWatched = [...new Set([...(s.majlisWatched || []), videoId])];
      this.history.unshift({ id: meta.id, videoId, type: meta.type, name: meta.name, poster: meta.poster || null, at: Date.now() });
      if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    }
    this._touch(it);
    return it;
  }

  // the player closed: in the credits -> start the next video from the top next time
  stopped(meta, nextVideoId) {
    const it = this.items[meta.id];
    if (!it) return;
    const s = it.state;
    if (s.duration && s.timeOffset > s.duration * CREDITS) {
      s.timeOffset = 0;
      if (nextVideoId) { s.video_id = nextVideoId; s.timeOffset = 1; s.timeWatched = 0; }
    }
    this._touch(it);
  }

  // our own list of watched videos: Stremio's state.watched is a bitfield string we leave as it is
  isWatched(id, videoId) { const w = this.items[id]?.state.majlisWatched; return Array.isArray(w) && w.includes(videoId || id); }
  setWatched(meta, videoId, on) {
    const it = this.items[meta.id] || (this.items[meta.id] = blank(meta));
    const w = new Set(it.state.majlisWatched || []);
    if (on) w.add(videoId || meta.id); else w.delete(videoId || meta.id);
    it.state.majlisWatched = [...w]; it.state.flaggedWatched = on ? 1 : it.state.flaggedWatched;
    this._touch(it);
  }

  // Stremio's continue watching: not "other", in the library or temp, with a position
  continueWatching() {
    return Object.values(this.items).filter((it) => it.type !== 'other' && (!it.removed || it.temp) && it.state.timeOffset > 0)
      .sort((a, b) => String(b._mtime).localeCompare(String(a._mtime))).slice(0, CW_MAX);
  }
  library() { return Object.values(this.items).filter((it) => !it.removed).sort((a, b) => String(b._mtime).localeCompare(String(a._mtime))); }

  toggleList(list, meta) {
    const l = this[list];
    const i = l.findIndex((x) => x.id === meta.id);
    if (i >= 0) l.splice(i, 1); else l.unshift({ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster || null, at: Date.now() });
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
}

module.exports = { Library, WATCHED, CREDITS };
