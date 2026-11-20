'use strict';
// Local Cache Cap & LRU Cleaner (default 5 GB cap).
// Safely tracks managed cache directories, protects active streaming/playback/download paths,
// and evicts expired + oldest files by mtimeMs when total size exceeds the cap.
const fs = require('fs');
const os = require('os');
const path = require('path');

const GB = 1024 * 1024 * 1024;
const DEFAULT_MAX_CACHE_GB = 5;

function normPath(p) {
  if (!p || typeof p !== 'string') return '';
  try { return path.resolve(p).toLowerCase(); } catch { return ''; }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function resolveEnvPath(raw, fallback) {
  let s = String(raw || '').trim();
  if (!s) return fallback;
  s = s.replace(/%([^%]+)%/g, (_, name) => process.env[name] || process.env[name.toUpperCase()] || '');
  return path.isAbsolute(s) ? s : path.resolve(fallback, s);
}

function walkFiles(dir, protectedRoots = [], out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  const ndir = normPath(dir);
  for (const r of protectedRoots) {
    if (r && (ndir === r || ndir.startsWith(r + path.sep))) return out;
  }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, protectedRoots, out);
    } else if (ent.isFile()) {
      try {
        const st = fs.statSync(full);
        out.push({ path: full, norm: normPath(full), size: st.size || 0, mtimeMs: st.mtimeMs || st.ctimeMs || 0 });
      } catch {}
    }
  }
  return out;
}

function pruneEmptyDirs(dir, keepRoot = true) {
  if (!dir || !fs.existsSync(dir)) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) pruneEmptyDirs(path.join(dir, ent.name), false);
  }
  if (!keepRoot) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {}
  }
}

class CacheManager {
  constructor({
    dataDir,
    tempDir = os.tmpdir(),
    getSettings = () => ({}),
    getDownloadDir = () => '',
    getActiveFiles = async () => [],
    getChromiumCacheSize = async () => 0,
    clearChromiumCache = async () => {},
  }) {
    this.dataDir = dataDir;
    this.tempDir = tempDir;
    this.getSettings = getSettings;
    this.getDownloadDir = getDownloadDir;
    this.getActiveFiles = getActiveFiles;
    this.getChromiumCacheSize = getChromiumCacheSize;
    this.clearChromiumCache = clearChromiumCache;
  }

  streamCacheDir() {
    const s = this.getSettings() || {};
    const def = path.join(this.tempDir, 'majlis-media');
    return resolveEnvPath(s.cachePath, def);
  }

  managedTargets() {
    const replayDirs = [];
    try {
      for (const ent of fs.readdirSync(this.tempDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const m = /^majlis-replay-(\d+)$/.exec(ent.name);
        if (m && !isPidAlive(Number(m[1]))) replayDirs.push(path.join(this.tempDir, ent.name));
      }
    } catch {}

    return [
      { id: 'stream', dirs: [this.streamCacheDir()] },
      { id: 'http', dirs: [path.join(this.dataDir, 'media-cache')] },
      { id: 'shaders', dirs: [path.join(this.dataDir, 'shader-cache')] },
      { id: 'songs', dirs: [path.join(this.dataDir, 'media', 'friend-songs')] },
      { id: 'subs', dirs: [path.join(this.tempDir, 'majlis-subs')] },
      { id: 'replay', dirs: replayDirs },
    ];
  }

  async _protectedSets() {
    const dlDir = normPath(this.getDownloadDir());
    const roots = dlDir ? [dlDir] : [];
    const active = await Promise.resolve(this.getActiveFiles()).catch(() => []);
    const activeSet = new Set();
    for (const p of Array.isArray(active) ? active : []) {
      const np = normPath(p);
      if (np) activeSet.add(np);
    }
    return { roots, activeSet };
  }

  _isProtected(fileNorm, { roots, activeSet }) {
    if (activeSet.has(fileNorm)) return true;
    for (const r of roots) {
      if (fileNorm === r || fileNorm.startsWith(r + path.sep)) return true;
    }
    for (const act of activeSet) {
      if (fileNorm.startsWith(act + path.sep)) return true;
    }
    return false;
  }

  async stats() {
    const s = this.getSettings() || {};
    const maxCacheGb = s.maxCacheGb === 0 ? 0 : (Number(s.maxCacheGb) > 0 ? Number(s.maxCacheGb) : DEFAULT_MAX_CACHE_GB);
    const prot = await this._protectedSets();
    const categories = {};
    let diskBytes = 0;

    for (const tgt of this.managedTargets()) {
      let bytes = 0;
      let files = 0;
      for (const d of tgt.dirs) {
        const list = walkFiles(d, prot.roots);
        for (const f of list) { bytes += f.size; files++; }
      }
      categories[tgt.id] = { bytes, files };
      diskBytes += bytes;
    }

    const chromiumBytes = Number(await Promise.resolve(this.getChromiumCacheSize()).catch(() => 0)) || 0;
    categories.artwork = { bytes: chromiumBytes, files: chromiumBytes > 0 ? 1 : 0 };
    const totalBytes = diskBytes + chromiumBytes;

    return {
      totalBytes,
      diskBytes,
      chromiumBytes,
      limitGb: maxCacheGb,
      limitBytes: maxCacheGb > 0 ? Math.round(maxCacheGb * GB) : 0,
      streamDir: this.streamCacheDir(),
      categories,
    };
  }

  async enforce({ aggressive = false, nowMs = Date.now() } = {}) {
    const s = this.getSettings() || {};
    const maxCacheGb = s.maxCacheGb === 0 ? 0 : (Number(s.maxCacheGb) > 0 ? Number(s.maxCacheGb) : DEFAULT_MAX_CACHE_GB);
    const keepDays = Number.isFinite(Number(s.keepCachedDays)) ? Number(s.keepCachedDays) : 7;
    const maxAgeMs = keepDays > 0 ? keepDays * 86400000 : 0;
    const prot = await this._protectedSets();

    const allFiles = [];
    const targetDirs = [];
    for (const tgt of this.managedTargets()) {
      for (const d of tgt.dirs) {
        targetDirs.push(d);
        walkFiles(d, prot.roots, allFiles);
      }
    }

    let removedFiles = 0;
    let freedBytes = 0;
    const kept = [];

    // Phase 1: Age expiry (never evict protected/active files)
    for (const f of allFiles) {
      const isProt = this._isProtected(f.norm, prot);
      const expired = maxAgeMs > 0 && (nowMs - f.mtimeMs) > maxAgeMs;
      const wipeTemp = aggressive && (f.norm.includes('majlis-media') || f.norm.includes('majlis-subs'));
      if (!isProt && (expired || wipeTemp)) {
        try {
          fs.unlinkSync(f.path);
          removedFiles++;
          freedBytes += f.size;
          continue;
        } catch {}
      }
      kept.push(f);
    }

    // Phase 2: LRU eviction down to maxCacheGb (oldest mtimeMs first)
    const limitBytes = maxCacheGb > 0 ? Math.round(maxCacheGb * GB) : 0;
    let totalBytes = kept.reduce((acc, f) => acc + f.size, 0);
    if (limitBytes > 0 && totalBytes > limitBytes) {
      const evictable = kept
        .filter((f) => !this._isProtected(f.norm, prot))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const f of evictable) {
        if (totalBytes <= limitBytes) break;
        try {
          fs.unlinkSync(f.path);
          totalBytes -= f.size;
          freedBytes += f.size;
          removedFiles++;
        } catch {}
      }
    }

    for (const d of targetDirs) pruneEmptyDirs(d, !d.includes('majlis-replay-'));

    const chromiumBytes = Number(await Promise.resolve(this.getChromiumCacheSize()).catch(() => 0)) || 0;
    if (limitBytes > 0 && totalBytes + chromiumBytes > limitBytes) {
      await Promise.resolve(this.clearChromiumCache()).catch(() => {});
    }

    return { removedFiles, freedBytes, remainingBytes: Math.max(0, totalBytes) };
  }

  async clear(category = 'all') {
    const cat = String(category || 'all').toLowerCase();
    const prot = await this._protectedSets();
    let removedFiles = 0;
    let freedBytes = 0;

    if (cat === 'all' || cat === 'artwork' || cat === 'chromium') {
      await Promise.resolve(this.clearChromiumCache()).catch(() => {});
    }

    const targets = cat === 'all'
      ? this.managedTargets()
      : this.managedTargets().filter((t) => t.id === cat || (cat === 'metadata' && t.id === 'http') || (cat === 'live' && t.id === 'stream') || (cat === 'dead' && t.id === 'http') || (cat === 'cw' && t.id === 'subs'));

    for (const tgt of targets) {
      for (const d of tgt.dirs) {
        const files = walkFiles(d, prot.roots);
        for (const f of files) {
          if (this._isProtected(f.norm, prot)) continue;
          try {
            fs.unlinkSync(f.path);
            removedFiles++;
            freedBytes += f.size;
          } catch {}
        }
        pruneEmptyDirs(d, !d.includes('majlis-replay-'));
      }
    }

    return { ok: true, removedFiles, freedBytes, stats: await this.stats() };
  }
}

module.exports = { CacheManager, DEFAULT_MAX_CACHE_GB, resolveEnvPath };
