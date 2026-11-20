'use strict';
// Managed stremio-server sidecar controller (official server.js under bundled Node 22 LTS),
// strictly bound to 127.0.0.1 on an isolated port (11475+) with deterministic child teardown.
const { spawn, execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ADDONS = [
  'https://v3-cinemeta.strem.io/manifest.json',
  'https://catalog.ers.pw/manifest.json',          // Streaming Catalogs: Netflix, HBO, Disney+... rows
  'https://opensubtitles-v3.strem.io/manifest.json',
  'https://anime-kitsu.strem.fun/manifest.json',     // anime catalogs and Kitsu ids
];

const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function sidecarPaths(customFfmpeg = null) {
  const res = process.resourcesPath || '';
  const vendor = path.join(__dirname, '../../../engine/vendor');
  const nodeExe = firstExisting([
    res ? path.join(res, 'sidecars', 'stremio', 'node.exe') : null,
    path.join(vendor, 'stremio', 'node.exe'),
  ]);
  const serverJs = firstExisting([
    res ? path.join(res, 'sidecars', 'stremio', 'server.js') : null,
    path.join(vendor, 'stremio', 'server.js'),
  ]);
  const launcherJs = firstExisting([
    res ? path.join(res, 'sidecars', 'stremio', 'stremio-launcher.js') : null,
    path.join(vendor, 'stremio', 'stremio-launcher.js'),
    path.join(__dirname, 'stremio-launcher.js'),
  ]);
  const ffmpegExe = firstExisting([
    customFfmpeg && customFfmpeg !== 'ffmpeg' ? customFfmpeg : null,
    res ? path.join(res, 'sidecars', 'ffmpeg', 'ffmpeg.exe') : null,
    res ? path.join(res, 'ffmpeg', 'ffmpeg.exe') : null,
    path.join(vendor, 'ffmpeg', 'ffmpeg.exe'),
  ]);
  const ffprobeExe = firstExisting([
    ffmpegExe ? path.join(path.dirname(ffmpegExe), 'ffprobe.exe') : null,
    res ? path.join(res, 'sidecars', 'ffmpeg', 'ffprobe.exe') : null,
    res ? path.join(res, 'ffmpeg', 'ffprobe.exe') : null,
    path.join(vendor, 'ffmpeg', 'ffprobe.exe'),
  ]);
  return { nodeExe, serverJs, launcherJs, ffmpegExe, ffprobeExe };
}

function trackersFromSources(sources = []) {
  const out = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    const str = String(s || '');
    if (str.startsWith('tracker:')) out.push(str.slice(8));
    else if (/^(udp|https?|wss?):\/\//i.test(str)) out.push(str);
  }
  return out;
}

function pickVideoFileIdx(files = [], explicitIdx = null, guessedIdx = null) {
  if (explicitIdx != null && Number.isInteger(Number(explicitIdx)) && Number(explicitIdx) >= 0) {
    return Number(explicitIdx);
  }
  if (guessedIdx != null && Number.isInteger(Number(guessedIdx)) && Number(guessedIdx) >= 0) {
    return Number(guessedIdx);
  }
  const normalized = files.map((f, i) => ({
    idx: typeof f?.idx === 'number' ? f.idx : i,
    name: String(f?.name || f?.path || ''),
    length: Number(f?.length ?? f?.size ?? 0) || 0,
  }));
  const vids = normalized.filter((f) => VIDEO_EXT_RE.test(f.name)).sort((a, b) => b.length - a.length);
  if (vids.length) return vids[0].idx;
  const biggest = normalized.sort((a, b) => b.length - a.length);
  return biggest.length ? biggest[0].idx : 0;
}

class StremioServerService {
  constructor({
    getCacheDir = null,
    getSettings = null,
    getFfmpeg = null,
    adoptProcess = null,
    basePort = 11475,
  } = {}) {
    this.getCacheDir = getCacheDir;
    this.getSettings = getSettings;
    this.getFfmpeg = getFfmpeg;
    this.adoptProcess = adoptProcess;
    this.basePort = Number(basePort) || 11475;
    this.p = null;
    this.port = null;
    this.base = null;
    this.ready = null;
    this.lastError = null;
    this._activeHashes = new Set();
  }

  _cacheDir() {
    try {
      const dir = typeof this.getCacheDir === 'function' ? String(this.getCacheDir() || '').trim() : '';
      if (dir) return dir;
    } catch {}
    return path.join(require('os').tmpdir(), 'majlis-stremio-cache');
  }

  _start() {
    if (this.ready) return this.ready;
    this.lastError = null;
    this.ready = new Promise((resolve, reject) => {
      const ffCustom = typeof this.getFfmpeg === 'function' ? this.getFfmpeg() : null;
      const paths = sidecarPaths(ffCustom);
      if (!paths.nodeExe || !paths.serverJs || !paths.launcherJs) {
        const missing = [
          !paths.nodeExe && 'node.exe',
          !paths.serverJs && 'server.js',
          !paths.launcherJs && 'stremio-launcher.js',
        ].filter(Boolean).join(', ');
        const err = new Error(`stremio-server sidecar missing (${missing})`);
        this.lastError = err.message;
        this.ready = null;
        return reject(err);
      }

      const appPath = this._cacheDir();
      try { fs.mkdirSync(appPath, { recursive: true }); } catch {}

      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      env.MAJLIS_STREMIO_PORT = String(this.basePort);
      env.MAJLIS_STREMIO_SERVER = paths.serverJs;
      env.APP_PATH = appPath;
      env.NO_CORS = '1';
      env.CASTING_DISABLED = '1';
      env.NO_NETWORK_INTERFACES = '1';
      if (paths.ffmpegExe) env.FFMPEG_BIN = paths.ffmpegExe;
      if (paths.ffprobeExe) env.FFPROBE_BIN = paths.ffprobeExe;

      const child = spawn(paths.nodeExe, [paths.launcherJs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
      this.p = child;
      try {
        if (child.pid && typeof this.adoptProcess === 'function') this.adoptProcess(child.pid);
      } catch {}

      let settled = false;
      let stdoutBuf = '';
      let stderrTail = '';
      const bootTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastError = 'stremio-server timed out waiting for READY';
        this.stop(true);
        reject(new Error(this.lastError));
      }, 15000);
      bootTimer.unref?.();

      const finishReady = async (port) => {
        if (settled) return;
        const baseUrl = `http://127.0.0.1:${port}`;
        // Verify HTTP /settings responds cleanly before releasing waiters
        for (let attempt = 0; attempt < 15; attempt++) {
          if (!this.p || this.p !== child) break;
          try {
            const r = await fetch(`${baseUrl}/settings`, { signal: AbortSignal.timeout(1000) });
            if (r.ok) {
              clearTimeout(bootTimer);
              settled = true;
              this.port = port;
              this.base = baseUrl;
              this._applySettings().catch(() => {});
              return resolve();
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!settled) {
          clearTimeout(bootTimer);
          settled = true;
          this.lastError = 'stremio-server HTTP probe failed';
          this.stop(true);
          reject(new Error(this.lastError));
        }
      };

      child.stdout.on('data', (chunk) => {
        stdoutBuf += String(chunk);
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          const m = /^MAJLIS_STREMIO_READY\s+(\d+)/.exec(line.trim());
          if (m) void finishReady(Number(m[1]));
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-1200);
      });

      child.on('error', (err) => {
        clearTimeout(bootTimer);
        if (this.p === child) {
          this.p = null;
          this.port = null;
          this.base = null;
          this.ready = null;
        }
        this.lastError = err?.message || 'stremio-server spawn failed';
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.on('exit', (code) => {
        clearTimeout(bootTimer);
        if (this.p === child) {
          this.p = null;
          this.port = null;
          this.base = null;
          this.ready = null;
        }
        if (!settled) {
          settled = true;
          this.lastError = `stremio-server exited (${code})${stderrTail ? `: ${stderrTail.trim()}` : ''}`;
          reject(new Error(this.lastError));
        }
      });
    });
    return this.ready;
  }

  async _applySettings() {
    if (!this.base) return;
    const s = (typeof this.getSettings === 'function' ? this.getSettings() : null) || {};
    const maxCacheGb = s.maxCacheGb === 0 ? 0 : (Number(s.maxCacheGb) > 0 ? Number(s.maxCacheGb) : 5);
    const deleteAfter = !!s.deleteCacheAfterWatch;
    const cacheSize = deleteAfter ? 0 : (maxCacheGb > 0 ? Math.round(maxCacheGb * 1024 * 1024 * 1024) : 2147483648);
    await fetch(`${this.base}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cacheRoot: this._cacheDir(),
        cacheSize,
        btMaxConnections: 80,
      }),
      signal: AbortSignal.timeout(2500),
    }).catch(() => {});
  }

  async play({ infoHash, fileIdx = null, sources = [], season = null, episode = null, filename = null } = {}) {
    await this._start();
    const ih = String(infoHash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(ih)) throw new Error('Invalid infoHash');
    const cleanSources = [...new Set([`dht:${ih}`, ...(Array.isArray(sources) ? sources : [])])];
    const guessFileIdx = (season != null && episode != null)
      ? { season: Number(season), episode: Number(episode) }
      : {};
    const createRes = await fetch(`${this.base}/${ih}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        torrent: { infoHash: ih },
        peerSearch: { sources: cleanSources, min: 40, max: 200 },
        guessFileIdx,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!createRes.ok) throw new Error(`stremio-server create failed (${createRes.status})`);
    const created = await createRes.json().catch(() => ({}));
    const rawFiles = Array.isArray(created?.files) ? created.files : (Array.isArray(created?.torrent?.files) ? created.torrent.files : []);
    const chosenIdx = pickVideoFileIdx(rawFiles, fileIdx, created?.guessedFileIdx);
    const chosenFile = rawFiles.find((f, i) => (typeof f?.idx === 'number' ? f.idx : i) === chosenIdx);
    const resolvedName = filename || chosenFile?.name || (chosenFile?.path ? path.basename(chosenFile.path) : null);

    const params = new URLSearchParams();
    for (const tr of trackersFromSources(sources)) params.append('tr', tr);
    if (resolvedName) params.set('f', resolvedName);
    const qs = params.toString();
    const streamPath = `/${ih}/${chosenIdx}${qs ? `?${qs}` : ''}`;
    this._activeHashes.add(ih);
    return {
      path: streamPath,
      url: `${this.base}${streamPath}`,
      fileIdx: chosenIdx,
      filename: resolvedName,
      files: rawFiles,
      infoHash: ih,
    };
  }

  async stopTorrent(infoHash, { remove = false } = {}) {
    const ih = String(infoHash || '').trim().toLowerCase();
    if (!ih) return { ok: true };
    this._activeHashes.delete(ih);
    if (remove && this.base) {
      await fetch(`${this.base}/${ih}/remove`, { signal: AbortSignal.timeout(2500) }).catch(() => {});
    }
    return { ok: true };
  }

  async stats(infoHash = null, fileIdx = null) {
    if (!this.base || !this.p) return null;
    const ih = infoHash ? String(infoHash).trim().toLowerCase() : null;
    const ep = ih
      ? (fileIdx != null && Number.isInteger(Number(fileIdx)) ? `/${ih}/${fileIdx}/stats.json` : `/${ih}/stats.json`)
      : '/stats.json';
    try {
      const r = await fetch(`${this.base}${ep}`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async active() {
    if (!this.p || !this.base) return { dir: this._cacheDir(), files: [] };
    try {
      const r = await fetch(`${this.base}/stats.json`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return { dir: this._cacheDir(), files: [] };
      const j = await r.json();
      const hashes = j && typeof j === 'object' ? Object.keys(j) : [];
      return {
        dir: this._cacheDir(),
        files: hashes.map((h) => path.join(this._cacheDir(), h)),
      };
    } catch {
      return { dir: this._cacheDir(), files: [] };
    }
  }

  async hlsTranscodeUrl(mediaUrl) {
    await this._start();
    const id = crypto.randomBytes(12).toString('hex');
    const params = new URLSearchParams();
    params.set('mediaURL', String(mediaUrl));
    params.set('videoCodecs', 'h264');
    params.set('audioCodecs', 'aac');
    params.set('audioChannels', '2');
    return {
      id,
      url: `${this.base}/hlsv2/${id}/master.m3u8?${params.toString()}`,
    };
  }

  async destroyHls(id) {
    if (!this.base || !id) return;
    await fetch(`${this.base}/hlsv2/${encodeURIComponent(String(id))}/destroy`, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => {});
  }

  async url(p) {
    await this._start();
    const cleanP = String(p || '');
    if (/^https?:\/\//i.test(cleanP)) return cleanP;
    return this.base + (cleanP.startsWith('/') ? cleanP : `/${cleanP}`);
  }

  status() {
    const ffCustom = typeof this.getFfmpeg === 'function' ? this.getFfmpeg() : null;
    const paths = sidecarPaths(ffCustom);
    return {
      running: !!this.p,
      ready: !!this.base,
      port: this.port || null,
      base: this.base || null,
      cacheDir: this._cacheDir(),
      node: !!paths.nodeExe,
      server: !!paths.serverJs && !!paths.launcherJs,
      ffmpeg: !!paths.ffmpegExe,
      ffprobe: !!paths.ffprobeExe,
      lastError: this.lastError || null,
    };
  }

  async call(route, body) {
    if (route === 'play') return this.play(body);
    if (route === 'stop') return this.stopTorrent(body?.infoHash, { remove: !!body?.delete });
    if (route === 'stats') return this.stats(body?.infoHash, body?.fileIdx);
    throw new Error(`Unsupported stremio-server call route: ${route}`);
  }

  stop(immediate = false) {
    const proc = this.p;
    const base = this.base;
    this.p = null;
    this.port = null;
    this.base = null;
    this.ready = null;
    this._activeHashes.clear();
    if (base && !immediate) {
      fetch(`${base}/removeAll`, { signal: AbortSignal.timeout(400) }).catch(() => {});
    }
    try { proc?.stdin?.end?.(); } catch {}
    if (!proc) return;
    if (immediate) {
      try { proc.kill('SIGKILL'); } catch {}
      if (process.platform === 'win32' && proc.pid) {
        try {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true, stdio: 'ignore', timeout: 2500 });
        } catch {}
      }
    } else if (process.platform === 'win32' && proc.pid) {
      const pid = proc.pid;
      const timer = setTimeout(() => {
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }, () => {});
      }, 350);
      timer.unref?.();
    }
  }
}

module.exports = { StremioServerService, DEFAULT_ADDONS, sidecarPaths, pickVideoFileIdx, trackersFromSources };
