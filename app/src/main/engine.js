'use strict';
// The video side of majlis-engine.exe (Rust): screen/window capture straight into NVENC, no
// ffmpeg. The process itself is run by helper.js (it's the same exe as the desktop helper);
// this routes its 'config' events and type-4 frames to the right stream.
//   frame payload: [stream u8][flags u8][pts u32][capture_us u64][encode_us u32][data]
// If the engine restarts, every stream starts again (on a keyframe).
const { EventEmitter } = require('events');

class Engine extends EventEmitter {
  constructor(helper) {
    super();
    this.helper = helper; this.streams = new Map(); this.nextId = 1;
    this.on('error', () => {});
    helper.on('ev', (m) => {
      if (m.ev === 'hello' || m.ev === 'ready') this.reason = m.nvenc || null;
      const s = m.id != null && (m.ev === 'config' || m.ev === 'error') ? this.streams.get(m.id) : null;
      if (s) s._event(m);
    });
    helper.on('vframe', (pl) => {
      const s = this.streams.get(pl[0]);
      if (s) s._frame(!!(pl[1] & 1), pl.readUInt32LE(2), Number(pl.readBigUInt64LE(6)), pl.readUInt32LE(14), Buffer.from(pl.subarray(18)));
    });
    helper.on('restart', () => { for (const s of this.streams.values()) s._restart(); });
  }

  // NVENC usable through the engine (it said so in its hello)
  get ok() { return !!this.helper.info?.ok; }
  get p() { return this.helper.p; }

  newId() { const id = this.nextId; this.nextId = (this.nextId % 250) + 1; return id; }
  cmd(obj) { return this.helper.cmd(obj); }

  whenReady(ms = 3000) {
    if (this.helper.ready) return Promise.resolve(this.ok);
    if (!this.helper.p) this.helper.start();
    return new Promise((res) => { const to = setTimeout(() => res(this.ok), ms); this.helper.once('hello', () => { clearTimeout(to); res(this.ok); }); });
  }
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

  // current bitrate / frame rate without touching what the stream was asked for
  reconfigure({ kbps, fps }) {
    this.lastSwap = Date.now();
    this.engine.cmd({ cmd: 'reconfig', id: this.id, kbps: Math.round(kbps), fps });
    if (this.config) { this.config.kbps = kbps; this.config.fps = fps; }
  }

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

module.exports = { Engine, EngineEncoder };
