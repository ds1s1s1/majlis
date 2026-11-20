'use strict';
// Downloads: whole files into a folder the viewer keeps (Videos\Majlis unless changed).
//  - a direct link, or a torrent a debrid service turns into one: fetched here, resumable (Range)
//  - any other torrent: the torrent engine (majlis-media) in download mode
// The list survives restarts; anything that was downloading comes back paused.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { isPrivateHost } = require('./http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'video';

async function safeFetch(urlStr, opts = {}, redirects = 0, allowPrivateHosts = false) {
  if (redirects > 5) throw new Error('too_many_redirects');
  const u = new URL(String(urlStr || ''));
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('unsupported download URL scheme');
  if (!allowPrivateHosts && isPrivateHost(u.hostname)) throw new Error('private_host_blocked');
  const r = await fetch(u.toString(), { ...opts, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location');
    if (!loc) throw new Error(`the server answered ${r.status}`);
    try { await r.body?.cancel?.(); } catch {}
    const nextUrl = new URL(loc, u).toString();
    return safeFetch(nextUrl, opts, redirects + 1, allowPrivateHosts);
  }
  return r;
}

class Downloads {
  // file: where the list is kept; folder(): the target folder; svc: MediaService; debrid(): { resolve } | null; changed(): ui ping
  constructor({ file, folder, svc, debrid, changed = () => {}, retryDelaysMs = [1000, 3000, 8000], fetchSubtitles = null, allowPrivateHosts = false, maxConcurrent = 2 }) {
    Object.assign(this, { file, folder, svc, debrid, changed, retryDelaysMs, fetchSubtitles, allowPrivateHosts });
    this.maxConcurrent = Math.max(1, Math.min(4, Number(maxConcurrent) || 2));
    this.active = new Map(); // id -> AbortController (http)
    this._torrentPoll = null;
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.items = []; }
    for (const d of this.items) if (d.state === 'downloading' || d.state === 'queued') d.state = 'paused';
    this.lastSave = 0;
  }

  _activeCount() {
    return this.items.filter((x) => x.state === 'downloading').length;
  }

  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, Math.min(4, Number(n) || 2));
    this._pump();
    return this.maxConcurrent;
  }

  _ensureTorrentPoll() {
    const hasTor = this.items.some((d) => d.kind === 'torrent' && d.state === 'downloading');
    if (hasTor && !this._torrentPoll) {
      this._torrentPoll = setInterval(() => {
        this.list().catch(() => {});
      }, 3000);
      this._torrentPoll.unref?.();
    } else if (!hasTor && this._torrentPoll) {
      clearInterval(this._torrentPoll);
      this._torrentPoll = null;
    }
  }

  _pump() {
    let guard = this.items.length + 1;
    while (guard-- > 0 && this._activeCount() < this.maxConcurrent) {
      const next = this.items.find((x) => x.state === 'queued' && !this.active.has(x.id));
      if (!next) break;
      void this.start(next.id);
    }
    this._ensureTorrentPoll();
  }

  save(force) {
    if (!force && Date.now() - this.lastSave < 2000) return;
    this.lastSave = Date.now();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.items));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  // torrents' progress comes from the engine; http ones are counted as they arrive
  async list() {
    if (this.items.some((d) => d.kind === 'torrent' && d.state === 'downloading')) {
      const st = await this.svc.call('downloads').catch(() => ({}));
      for (const d of this.items.filter((x) => x.kind === 'torrent' && x.state === 'downloading')) {
        const s = st[`${d.stream.infoHash.toLowerCase()}:${d.stream.fileIdx ?? 0}`];
        if (!s) continue;
        d.got = s.progress_bytes || 0; d.total = s.total_bytes || d.total; d.speed = s.live?.download_speed?.mbps ? s.live.download_speed.mbps * 125000 : 0;
        if (s.file) d.file = s.file;
        if (s.finished) {
          d.state = 'done'; d.speed = 0;
          this._bundleSidecarSubs(d).catch(() => {});
          this.save(true);
          this.changed();
          this._pump();
        }
      }
    }
    this._ensureTorrentPoll();
    return this.items;
  }

  add({ meta, type, videoId, label, stream }) {
    const d = { id: crypto.randomUUID(), name: label || meta.name, metaId: meta.id, type, videoId, poster: meta.poster || null, stream, state: 'queued', got: 0, total: stream.behaviorHints?.videoSize || 0, speed: 0, at: Date.now(), kind: null, file: null, error: null };
    this.items.unshift(d);
    this.save(true);
    this.changed();
    this._pump();
    return d;
  }

  async start(id) {
    const d = this.items.find((x) => x.id === id);
    if (!d || d.state === 'done' || d.state === 'downloading' || this.active.has(id)) return;
    if (this._activeCount() >= this.maxConcurrent) {
      d.state = 'queued'; d.error = null; this.save(true); this.changed();
      return;
    }
    const ac = new AbortController();
    this.active.set(id, ac);
    d.state = 'downloading'; d.error = null; this.changed();
    try {
      let url = typeof d.stream.url === 'string' && /^https?:/.test(d.stream.url) ? d.stream.url : null;
      let name = d.stream.behaviorHints?.filename || null;
      if (!url && d.stream.infoHash) {
        const deb = this.debrid();
        if (deb) { try { const r = await deb.resolve(d.stream); url = r.url; name = name || r.name.split('/').pop(); } catch {} }
      }
      if (ac.signal.aborted) {
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      if (url) { d.kind = 'http'; await this.http(d, url, name, ac); }
      else if (d.stream.infoHash) {
        d.kind = 'torrent';
        await this.svc.call('download', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, sources: d.stream.sources || [], folder: this.folder() });
        this._ensureTorrentPoll();
      } else throw new Error('this copy cannot be downloaded');
    } catch (e) {
      if (this.active.get(id) === ac && d.state === 'downloading') {
        d.state = e.name === 'AbortError' ? 'paused' : 'failed';
        d.error = e.name === 'AbortError' ? null : e.message;
      }
    } finally {
      if (this.active.get(id) === ac) {
        this.active.delete(id);
        this.save(true);
        this.changed();
        this._pump();
      }
    }
  }

  async _bundleSidecarSubs(d) {
    if (typeof this.fetchSubtitles !== 'function' || !d?.file) return [];
    const list = await this.fetchSubtitles(d).catch(() => []);
    if (!Array.isArray(list) || !list.length) return [];
    const base = d.file.slice(0, d.file.length - path.extname(d.file).length);
    const saved = [];
    for (const [langTag, match] of [['ar', /^(ara?|arabic)$/i], ['en', /^(eng?|english)$/i]]) {
      const sub = list.find((s) => match.test(String(s.lang || '')) && /^https?:\/\//i.test(s.url || ''));
      if (!sub) continue;
      try {
        const res = await safeFetch(sub.url, { headers: { 'user-agent': 'Majlis' }, signal: AbortSignal.timeout(8000) }, 0, this.allowPrivateHosts);
        if (!res.ok) continue;
        const body = await res.text();
        if (!body.trim()) continue;
        const rawExt = path.extname(new URL(sub.url).pathname).toLowerCase();
        const ext = ['.srt', '.vtt', '.ass', '.ssa'].includes(rawExt) ? rawExt : '.srt';
        const dest = `${base}.${langTag}${ext}`;
        await fs.promises.writeFile(dest, body, 'utf8');
        saved.push(dest);
      } catch {}
    }
    if (saved.length) { d.subFiles = saved; this.save(true); }
    return saved;
  }

  findDone(metaId, videoId = null) {
    return this.items.find((d) => {
      if (d.state !== 'done' || !d.file) return false;
      const matches = videoId ? (d.videoId === videoId || (d.metaId === metaId && d.videoId === metaId)) : (d.metaId === metaId || d.videoId === metaId);
      return matches && fs.existsSync(d.file);
    }) || null;
  }

  async http(d, url, name, ac = new AbortController()) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported download URL scheme');
    if (!this.allowPrivateHosts && isPrivateHost(parsed.hostname)) throw new Error('private_host_blocked');
    this.active.set(d.id, ac);
    const dir = this.folder();
    const baseDir = path.resolve(dir);
    fs.mkdirSync(baseDir, { recursive: true });
    if (!d.file) {
      const ALLOWED_EXT = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.webm', '.ts', '.avi']);
      const rawExt = path.extname(name || parsed.pathname).toLowerCase();
      const ext = ALLOWED_EXT.has(rawExt) ? rawExt : '.mkv';
      d.file = path.join(baseDir, `${clean(path.basename(name || d.name, rawExt || ext))}${ext}`);
    }
    const targetPath = path.resolve(d.file);
    const relPath = path.relative(baseDir, targetPath);
    if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) throw new Error('invalid_download_path');
    const part = `${targetPath}.part`;
    const rawProxy = d.stream.behaviorHints?.proxyHeaders?.request || {};
    const BLOCKED_HDR = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cookie', 'authorization']);
    const proxy = {};
    for (const [k, v] of Object.entries(rawProxy)) {
      if (!BLOCKED_HDR.has(String(k).toLowerCase()) && typeof v === 'string') proxy[k] = v;
    }

    const delays = Array.isArray(this.retryDelaysMs) ? this.retryDelaysMs : [];
    let lastErr = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (ac.signal.aborted) break;
      try {
        let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
        const r = await safeFetch(parsed.toString(), { headers: { ...proxy, 'user-agent': 'Majlis', ...(have ? { range: `bytes=${have}-` } : {}) }, signal: ac.signal }, 0, this.allowPrivateHosts);
        if (!r.ok) {
          const err = new Error(`the server answered ${r.status}`);
          if (r.status === 408 || r.status === 429 || r.status >= 500) {
            lastErr = err;
            if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
          }
          throw err;
        }
        if (have && r.status !== 206) have = 0; // no resume there: start over
        const len = Number(r.headers.get('content-length')) || 0;
        if (len) d.total = have + len;
        d.got = have;
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        let t0 = Date.now(), b0 = have;
        try {
          for await (const chunk of r.body) {
            if (!out.write(chunk)) await once(out, 'drain');
            d.got += chunk.length;
            if (Date.now() - t0 > 1000) { d.speed = ((d.got - b0) * 1000) / (Date.now() - t0); t0 = Date.now(); b0 = d.got; this.save(); this.changed(); }
          }
        } finally { await new Promise((res) => out.end(res)); }
        fs.renameSync(part, targetPath);
        d.speed = 0; d.total = d.got;
        await this._bundleSidecarSubs(d).catch(() => {});
        d.state = 'done';
        return;
      } catch (e) {
        if (e.name === 'AbortError' || ac.signal.aborted) throw e;
        lastErr = e;
        if (attempt < delays.length && !/^(the server answered 4(?!08|29)|unsupported download URL|private_host_blocked|too_many_redirects|invalid_download_path)/.test(e.message)) {
          await sleep(delays[attempt]);
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('download failed');
  }

  async pause(id) {
    const d = this.items.find((x) => x.id === id);
    if (!d || (d.state !== 'downloading' && d.state !== 'queued')) return;
    const ac = this.active.get(id);
    if (ac) { this.active.delete(id); ac.abort(); }
    d.state = 'paused'; d.speed = 0;
    // the engine has no pause: let go of the torrent and keep its pieces; resuming checks them and goes on
    if (d.kind === 'torrent') await this.svc.call('download-cancel', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, delete: false }).catch(() => {});
    this.save(true); this.changed();
    this._pump();
  }

  reorder(id, dir = -1) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return this.items;
    const j = Math.max(0, Math.min(this.items.length - 1, i + (dir >= 0 ? 1 : -1)));
    if (j === i) return this.items;
    const [item] = this.items.splice(i, 1);
    this.items.splice(j, 0, item);
    this.save(true); this.changed();
    return this.items;
  }

  async pauseAll() {
    for (const d of this.items) {
      if (d.state === 'downloading' || d.state === 'queued') {
        const ac = this.active.get(d.id);
        if (ac) { this.active.delete(d.id); ac.abort(); }
        d.state = 'paused'; d.speed = 0;
        if (d.kind === 'torrent') await this.svc.call('download-cancel', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, delete: false }).catch(() => {});
      }
    }
    this._ensureTorrentPoll();
    this.save(true); this.changed();
    return this.items;
  }

  resumeAll() {
    for (const d of this.items) {
      if (d.state === 'paused' || d.state === 'failed') { d.state = 'queued'; d.error = null; }
    }
    this.save(true); this.changed();
    this._pump();
    return this.items;
  }

  clearDone() {
    this.items = this.items.filter((x) => x.state !== 'done');
    this.save(true); this.changed();
    return this.items;
  }

  async remove(id, deleteFile) {
    const d = this.items.find((x) => x.id === id);
    if (!d) return;
    d.state = 'removed';
    this.active.get(id)?.abort();
    if (d.kind === 'torrent') await this.svc.call('download-cancel', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, delete: !!deleteFile }).catch(() => {});
    if (deleteFile && d.file) for (const f of [d.file, `${d.file}.part`, ...(d.subFiles || [])]) { try { fs.unlinkSync(f); } catch {} }
    this.items = this.items.filter((x) => x.id !== id);
    this.save(true); this.changed();
    this._pump();
  }
}

module.exports = { Downloads, clean, safeFetch };
