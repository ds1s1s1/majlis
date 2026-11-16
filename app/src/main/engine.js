'use strict';
// Talks to majlis-engine.exe (Rust): screen/window capture straight into NVENC, no ffmpeg.
// Same framing as the helper: [type u8][len u32 LE][payload]; 1 = JSON event, 4 = video frame.
// If it ever dies it comes back within a second and every stream restarts on a keyframe.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

function enginePath() {
  const cands = [
    process.env.MAJLIS_ENGINE,
    path.join(process.resourcesPath || '', 'engine', 'majlis-engine.exe'),
    path.join(__dirname, '../../../engine/target/release/majlis-engine.exe'),
  ];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

class Engine extends EventEmitter {
  constructor() {
    super();
    this.p = null; this.buf = Buffer.alloc(0); this.ok = false; this.reason = null;
    this.streams = new Map(); this.nextId = 1; this.stopped = false;
    this.on('error', () => {});
  }

  start() {
    const exe = enginePath();
    if (!exe) { this.reason = 'missing'; return false; }
    this.stopped = false;
    this.p = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.p.stdout.on('data', (d) => this._feed(d));
    this.p.on('error', () => {});
    this.p.stdin.on('error', () => {});
    this.p.on('exit', () => {
      this.p = null; this.buf = Buffer.alloc(0);
      if (this.stopped) return;
      // crashed: back in a second, streams pick up again on a keyframe
      setTimeout(() => { if (!this.stopped && this.start()) this.once('ready', () => { for (const s of this.streams.values()) s._restart(); }); }, 800);
    });
    return true;
  }

  newId() { const id = this.nextId; this.nextId = (this.nextId % 250) + 1; return id; }

  _feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let o = 0;
    while (this.buf.length - o >= 5) {
      const type = this.buf[o], len = this.buf.readUInt32LE(o + 1);
      if (this.buf.length - o - 5 < len) break;
      const pl = this.buf.subarray(o + 5, o + 5 + len);
      o += 5 + len;
      if (type === 1) {
        let m; try { m = JSON.parse(pl); } catch { continue; }
        if (m.ev === 'ready' || m.ev === 'hello') { this.ok = !!m.ok; this.reason = m.nvenc || null; }
        if (m.ev === 'ready') this.emit('ready', m);
        const s = m.id != null ? this.streams.get(m.id) : null;
        if (s) s._event(m);
      } else if (type === 4) {
        const s = this.streams.get(pl[0]);
        if (s) s._frame(!!(pl[1] & 1), pl.readUInt32LE(2), Number(pl.readBigUInt64LE(6)), pl.readUInt32LE(14), Buffer.from(pl.subarray(18)));
      }
    }
    this.buf = o ? Buffer.from(this.buf.subarray(o)) : this.buf;
  }

  cmd(obj) {
    if (!this.p) return false;
    try { this.p.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  }

  // wait for the first 'ready' (or give up)
  whenReady(ms = 3000) {
    if (this.ok || !this.p) return Promise.resolve(this.ok);
    return new Promise((res) => { const to = setTimeout(() => res(this.ok), ms); this.once('ready', () => { clearTimeout(to); res(this.ok); }); });
  }

  stop() { this.stopped = true; this.cmd({ cmd: 'quit' }); setTimeout(() => { try { this.p?.kill(); } catch {} }, 500); }
}

// Same face as encoder.js's Encoder (start / swap / requestKeyframe / stop, 'config' / 'frame'
// / 'spawn' / 'error'), so the host doesn't care which one it got. The difference: a new
// bitrate or frame rate is applied to the very next frame instead of starting a new ffmpeg.
class EngineEncoder extends EventEmitter {
  constructor(engine) {
    super();
    this.engine = engine; this.id = engine.newId();
    this.epoch = Math.floor(Math.random() * 200); this.frameId = 0; this.lastSwap = 0;
    this.idx = 0; this.ids = new Map(); // host frame id -> engine frame index (for recovery)
    engine.streams.set(this.id, this);
  }

  _size(o) {
    const s = o.scale || (o.window ? { w: o.window.w, h: o.window.h } : o.size) || { w: 1920, h: 1080 };
    return { w: Math.max(64, s.w & ~1), h: Math.max(64, s.h & ~1) };
  }

  start(opts) {
    this.opts = { ...opts };
    const o = this.opts, { w, h } = this._size(o);
    this.lastSwap = Date.now();
    this.engine.cmd({
      cmd: 'start', id: this.id, ...(o.window ? { hwnd: o.window.hwnd } : { display: o.display | 0 }),
      codec: o.enc.codec, kbps: Math.round(o.kbps), fps: o.fps, w, h, quality: o.quality || 'balanced', tenBit: !!o.tenBit,
    });
    setImmediate(() => this.emit('spawn', this.engine.p?.pid));
  }

  _restart() { if (this.opts && !this.stopped) this.start(this.opts); }

  // only bitrate / frame rate changed: reconfigure in place; anything else: a new session
  swap(patch) {
    const next = { ...this.opts, ...patch };
    const same = (k) => JSON.stringify(next[k]) === JSON.stringify(this.opts[k]);
    if (['enc', 'display', 'window', 'scale', 'size', 'quality', 'tenBit'].every(same)) {
      this.opts = next; this.lastSwap = Date.now();
      this.engine.cmd({ cmd: 'reconfig', id: this.id, kbps: Math.round(next.kbps), fps: next.fps });
      if (this.config) { this.config.kbps = next.kbps; this.config.fps = next.fps; }
      return;
    }
    this.start(next);
  }

  setFps(fps) { if (this.opts && this.opts.fps !== fps) this.swap({ fps }); }

  requestKeyframe() { this.engine.cmd({ cmd: 'idr', id: this.id }); return true; }

  // A viewer never got these frames (or we skipped them to stay live): stop referencing them.
  invalidate(hostIds) {
    const frames = hostIds.map((i) => this.ids.get(i)).filter((x) => x != null);
    this.engine.cmd(frames.length ? { cmd: 'invalidate', id: this.id, frames } : { cmd: 'idr', id: this.id });
  }

  _event(m) {
    if (m.ev === 'config') {
      this.epoch = (this.epoch + 1) & 0xff; this.idx = 0; this.ids.clear();
      this.config = { codec: m.codec, description: Buffer.alloc(0), family: this.opts.enc.codec, epoch: this.epoch, kbps: this.opts.kbps, encoder: `${this.opts.enc.codec}-nvenc-direct`, fps: m.fps };
      this.emit('config', this.config);
    } else if (m.ev === 'error' && (m.cmd === 'start' || m.cmd === 'encode')) {
      this.emit('error', { code: 1, err: m.msg });
    }
  }

  _frame(key, pts, captureUs, encUs, data) {
    if (!this.config) return;
    const id = this.frameId = (this.frameId + 1) >>> 0;
    this.ids.set(id, this.idx++);
    if (this.ids.size > 300) this.ids.delete(this.ids.keys().next().value);
    this.emit('frame', { data, key, ts: pts, pts, at: captureUs / 1000, encMs: Math.max(1, encUs / 1000), epoch: this.epoch, id });
  }

  stop() {
    this.stopped = true;
    this.engine.cmd({ cmd: 'stop', id: this.id });
    this.engine.streams.delete(this.id);
  }
}

module.exports = { Engine, EngineEncoder, enginePath };
