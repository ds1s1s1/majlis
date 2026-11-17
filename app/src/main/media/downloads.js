'use strict';
// Downloads: whole files into a folder the viewer keeps (Videos\Majlis unless changed).
//  - a direct link, or a torrent a debrid service turns into one: fetched here, resumable (Range)
//  - any other torrent: the torrent engine (majlis-media) in download mode
// The list survives restarts; anything that was downloading comes back paused.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');

const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'video';

class Downloads {
  // file: where the list is kept; folder(): the target folder; svc: MediaService; debrid(): { resolve } | null; changed(): ui ping
  constructor({ file, folder, svc, debrid, changed = () => {} }) {
    Object.assign(this, { file, folder, svc, debrid, changed });
    this.active = new Map(); // id -> AbortController (http)
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.items = []; }
    for (const d of this.items) if (d.state === 'downloading' || d.state === 'queued') d.state = 'paused';
    this.lastSave = 0;
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
        if (s.finished) { d.state = 'done'; d.speed = 0; this.save(true); }
      }
    }
    return this.items;
  }

  add({ meta, type, videoId, label, stream }) {
    const d = { id: crypto.randomUUID(), name: label || meta.name, metaId: meta.id, type, videoId, poster: meta.poster || null, stream, state: 'queued', got: 0, total: stream.behaviorHints?.videoSize || 0, speed: 0, at: Date.now(), kind: null, file: null, error: null };
    this.items.unshift(d);
    this.save(true);
    this.start(d.id);
    return d;
  }

  async start(id) {
    const d = this.items.find((x) => x.id === id);
    if (!d || d.state === 'done' || this.active.has(id)) return;
    d.state = 'downloading'; d.error = null; this.changed();
    try {
      let url = typeof d.stream.url === 'string' && /^https?:/.test(d.stream.url) ? d.stream.url : null;
      let name = d.stream.behaviorHints?.filename || null;
      if (!url && d.stream.infoHash) {
        const deb = this.debrid();
        if (deb) { try { const r = await deb.resolve(d.stream); url = r.url; name = name || r.name.split('/').pop(); } catch {} }
      }
      if (url) { d.kind = 'http'; await this.http(d, url, name); }
      else if (d.stream.infoHash) {
        d.kind = 'torrent';
        await this.svc.call('download', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, sources: d.stream.sources || [], folder: this.folder() });
      } else throw new Error('this copy cannot be downloaded');
    } catch (e) {
      if (d.state === 'downloading') { d.state = e.name === 'AbortError' ? 'paused' : 'failed'; d.error = e.name === 'AbortError' ? null : e.message; }
    } finally { this.active.delete(id); this.save(true); this.changed(); }
  }

  async http(d, url, name) {
    const ac = new AbortController();
    this.active.set(d.id, ac);
    const dir = this.folder();
    fs.mkdirSync(dir, { recursive: true });
    if (!d.file) {
      const ext = path.extname(name || new URL(url).pathname) || '.mkv';
      d.file = path.join(dir, `${clean(path.basename(name || d.name, ext))}${ext}`);
    }
    const part = `${d.file}.part`;
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const proxy = d.stream.behaviorHints?.proxyHeaders?.request || {};
    const r = await fetch(url, { headers: { 'user-agent': 'Majlis', ...proxy, ...(have ? { range: `bytes=${have}-` } : {}) }, signal: ac.signal });
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
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
    fs.renameSync(part, d.file);
    d.state = 'done'; d.speed = 0; d.total = d.got;
  }

  async pause(id) {
    const d = this.items.find((x) => x.id === id);
    if (!d || d.state !== 'downloading') return;
    d.state = 'paused'; d.speed = 0;
    this.active.get(id)?.abort();
    // the engine has no pause: let go of the torrent and keep its pieces; resuming checks them and goes on
    if (d.kind === 'torrent') await this.svc.call('download-cancel', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, delete: false }).catch(() => {});
    this.save(true); this.changed();
  }

  async remove(id, deleteFile) {
    const d = this.items.find((x) => x.id === id);
    if (!d) return;
    d.state = 'removed';
    this.active.get(id)?.abort();
    if (d.kind === 'torrent') await this.svc.call('download-cancel', { infoHash: d.stream.infoHash, fileIdx: d.stream.fileIdx ?? 0, delete: !!deleteFile }).catch(() => {});
    if (deleteFile && d.file) for (const f of [d.file, `${d.file}.part`]) { try { fs.unlinkSync(f); } catch {} }
    this.items = this.items.filter((x) => x.id !== id);
    this.save(true); this.changed();
  }
}

module.exports = { Downloads, clean };
