'use strict';
// Stremio-compatible WatchedBitField: `<last_video_id>:<bit_length>:<base64(zlib.deflateSync(bytes))>`
// Lets watched episode sets survive two-way Stremio datastore sync compactly.
const zlib = require('zlib');

class WatchedBitField {
  constructor(videoIds = [], bytes = null, lastVideoId = '') {
    this.videoIds = Array.isArray(videoIds) ? [...videoIds] : [];
    const needBytes = Math.ceil(this.videoIds.length / 8);
    this.bytes = Buffer.alloc(needBytes);
    if (bytes && bytes.length) bytes.copy(this.bytes, 0, 0, Math.min(bytes.length, needBytes));
    this.lastVideoId = String(lastVideoId || '');
  }

  get(videoId) {
    const idx = this.videoIds.indexOf(videoId);
    if (idx < 0) return false;
    return ((this.bytes[idx >> 3] >> (idx & 7)) & 1) === 1;
  }

  set(videoId, watched) {
    const idx = this.videoIds.indexOf(videoId);
    if (idx < 0) return false;
    const mask = 1 << (idx & 7);
    if (watched) {
      this.bytes[idx >> 3] |= mask;
      this.lastVideoId = videoId;
    } else {
      this.bytes[idx >> 3] &= ~mask;
    }
    return true;
  }

  isFullyWatched(videoIds = this.videoIds) {
    return videoIds.length > 0 && videoIds.every((id) => this.get(id));
  }

  toWatchedSet() {
    const s = new Set();
    for (let i = 0; i < this.videoIds.length; i++) {
      if ((this.bytes[i >> 3] >> (i & 7)) & 1) s.add(this.videoIds[i]);
    }
    return s;
  }

  serialize() {
    const compressed = zlib.deflateSync(this.bytes).toString('base64');
    return `${this.lastVideoId}:${this.videoIds.length}:${compressed}`;
  }

  static fromWatchedSet(videoIds, watchedSet, lastVideoId = '') {
    const bf = new WatchedBitField(videoIds, null, lastVideoId);
    for (const id of watchedSet || []) bf.set(id, true);
    if (lastVideoId) bf.lastVideoId = String(lastVideoId);
    else if (!bf.lastVideoId && watchedSet?.size) {
      for (const id of videoIds) if (watchedSet.has(id)) bf.lastVideoId = id;
    }
    return bf;
  }

  static parse(encoded, videoIds = []) {
    if (typeof encoded !== 'string' || !encoded.includes(':')) return new WatchedBitField(videoIds);
    const parts = encoded.split(':');
    if (parts.length < 3) return new WatchedBitField(videoIds);
    const b64 = parts.pop();
    const len = parseInt(parts.pop(), 10);
    const lastId = parts.join(':');
    try {
      const raw = Buffer.from(b64, 'base64');
      let buf;
      try { buf = zlib.inflateSync(raw); } catch { buf = zlib.inflateRawSync(raw); }
      if (Number.isFinite(len) && len > 0 && buf.length === 0) buf = Buffer.alloc(Math.ceil(len / 8));
      return new WatchedBitField(videoIds, buf, lastId);
    } catch {
      return new WatchedBitField(videoIds, null, lastId);
    }
  }
}

module.exports = { WatchedBitField };
