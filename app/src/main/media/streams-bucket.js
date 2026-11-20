'use strict';
// StreamsBucket: persists the last chosen release/bingeGroup per series (up to 30 recent episodes)
// so Next Episode & binge auto-pick keep the exact same release group, quality, and addon.
const fs = require('fs');
const path = require('path');

const MAX_SERIES = 250;
const MAX_EPS_PER_SERIES = 30;

class StreamsBucket {
  constructor(file) {
    this.file = file;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { this.data = {}; }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch {}
  }

  _prune() {
    const keys = Object.keys(this.data);
    if (keys.length > MAX_SERIES) {
      keys.sort((a, b) => (this.data[a].updatedAt || 0) - (this.data[b].updatedAt || 0));
      for (let i = 0; i < keys.length - MAX_SERIES; i++) delete this.data[keys[i]];
    }
  }

  remember({ metaId, videoId, stream, addonUrl = null, bingeGroup = null }) {
    if (!metaId || !stream) return;
    const key = String(metaId);
    const bg = bingeGroup || stream.behaviorHints?.bingeGroup || null;
    const filename = stream.behaviorHints?.filename || null;
    const prev = this.data[key] || { episodes: [] };
    const eps = [
      { videoId: videoId || key, bingeGroup: bg, addonUrl, filename, at: Date.now() },
      ...(prev.episodes || []).filter((e) => e.videoId !== (videoId || key)),
    ].slice(0, MAX_EPS_PER_SERIES);
    this.data[key] = { ...prev, lastVideoId: videoId || key, bingeGroup: bg, addonUrl, filename, updatedAt: Date.now(), episodes: eps };
    this._prune();
    this.save();
  }

  // Returns binge hint across up to 30 recent episodes of the series (Harbor / Nuvio style)
  hintFor(metaId, currentVideoId = null, orderedVideoIds = []) {
    const entry = this.data[String(metaId || '')];
    if (!entry) return null;
    if (currentVideoId && Array.isArray(orderedVideoIds) && orderedVideoIds.length) {
      const idx = orderedVideoIds.indexOf(currentVideoId);
      if (idx > 0) {
        const lookback = new Set(orderedVideoIds.slice(Math.max(0, idx - MAX_EPS_PER_SERIES), idx));
        const match = (entry.episodes || []).find((e) => lookback.has(e.videoId) && (e.bingeGroup || e.addonUrl));
        if (match) return match;
      }
    }
    return (entry.episodes || [])[0] || entry;
  }

  record(metaId, videoId, { stream, addonUrl = null } = {}) {
    return this.remember({ metaId, videoId, stream, addonUrl });
  }

  findRecent(metaId) {
    const entry = this.data[String(metaId || '')];
    if (!entry) return null;
    const ep = (entry.episodes || [])[0];
    return ep ? { stream: { behaviorHints: { bingeGroup: ep.bingeGroup, filename: ep.filename } }, addonUrl: ep.addonUrl } : null;
  }

  saveItemState(metaId, patch = {}) {
    if (!metaId || !patch || typeof patch !== 'object') return null;
    const key = String(metaId);
    const ALLOWED = [
      'subLang', 'subDelay', 'subSpeed', 'subScale', 'subPos', 'subFont', 'subColor',
      'subBold', 'subOutlinePx', 'subBackAlpha', 'subAlign', 'subFilterSdh',
      'audioLang', 'volume', 'aspect', 'panscan', 'audioDelay', 'voiceClarity', 'warmTint',
    ];
    const cur = this.data[key] || { episodes: [] };
    const nextState = { ...(cur.itemState || {}) };
    for (const k of ALLOWED) {
      if (patch[k] !== undefined) nextState[k] = patch[k];
    }
    this.data[key] = { ...cur, itemState: nextState, updatedAt: Date.now() };
    this._prune();
    this.save();
    return nextState;
  }

  getItemState(metaId) {
    const entry = this.data[String(metaId || '')];
    return entry?.itemState || null;
  }
}

module.exports = { StreamsBucket };
