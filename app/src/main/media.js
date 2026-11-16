'use strict';
// Video over the wire: frames are cut into ~1.1 KB shards, grouped in blocks of up to 32, and
// each block gets Reed-Solomon parity sized to the loss we've been seeing. The receiver rebuilds
// a frame as soon as any k shards of every block arrive.
//
// Congestion control watches queuing delay first and loss second. Mobile links (5G/4G) build up
// huge buffers before they drop anything, so waiting for loss means the picture is already
// half a second behind. "Stability mode" reacts earlier and climbs back slower.

const fec = require('./fec');

const SHARD = 1100;
const MAXK = 32;
const VHDR = 25;
const CH_VIDEO = 0x01;
const now = () => Date.now();
const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// ------------------------------------------------------------------ sender
class VideoTx {
  constructor(link) { this.link = link; this.fecRatio = 0.1; this.sentFrames = 0; this.queue = []; this.busy = false; }

  send(frame) {
    const { data, key, epoch, id, encMs } = frame;
    const pts = (frame.pts ?? frame.ts ?? 0) >>> 0;
    const total = Math.max(1, Math.ceil(data.length / SHARD));
    const blocks = Math.ceil(total / MAXK);
    const pkts = [];
    const hostTs = now() >>> 0;
    for (let b = 0; b < blocks; b++) {
      const first = b * MAXK, k = Math.min(MAXK, total - first);
      const m = Math.min(255 - k, Math.max(1, Math.ceil(k * this.fecRatio)));
      const shards = [];
      for (let i = 0; i < k; i++) {
        const s = new Uint8Array(SHARD);
        const off = (first + i) * SHARD;
        s.set(data.subarray(off, Math.min(off + SHARD, data.length)));
        shards.push(s);
      }
      const parity = m ? fec.encode(shards, m) : [];
      const all = shards.concat(parity);
      for (let i = 0; i < all.length; i++) {
        const p = Buffer.allocUnsafe(VHDR + SHARD);
        p[0] = CH_VIDEO; p[1] = epoch; p.writeUInt32BE(id, 2); p[6] = key ? 1 : 0;
        p.writeUInt32BE(hostTs, 7); p[11] = Math.min(255, Math.round(encMs || 0));
        p.writeUInt32BE(data.length, 12); p[16] = b; p[17] = blocks; p[18] = i; p[19] = k; p[20] = m;
        p.writeUInt32BE(pts, 21);
        Buffer.from(all[i].buffer, all[i].byteOffset, SHARD).copy(p, VHDR);
        pkts.push(p);
      }
    }
    this.sentFrames++;
    this.queue.push(pkts);
    if (!this.busy) this._drain();
  }

  // Pacing: small frames go out at once; big ones (keyframes, scene cuts) are spread over a few
  // milliseconds so a 5G modem's buffer doesn't overflow and drop the tail of the frame.
  _drain() {
    const pkts = this.queue.shift();
    if (!pkts) { this.busy = false; return; }
    if (pkts.length <= 24) { for (const p of pkts) this.link.send(p); return this._drain(); }
    this.busy = true;
    const spread = Math.min(10, Math.max(2, pkts.length * 0.05));
    const t0 = hr();
    let i = 0;
    const step = () => {
      const allowed = Math.min(pkts.length, 12 + Math.floor(((hr() - t0) / spread) * pkts.length));
      for (; i < allowed; i++) this.link.send(pkts[i]);
      if (i < pkts.length) setImmediate(step); else this._drain();
    };
    step();
  }
}

// ------------------------------------------------------------------ receiver
class VideoRx {
  constructor({ onFrame, onNeedKey }) {
    this.onFrame = onFrame; this.onNeedKey = onNeedKey;
    this.frames = new Map();
    this.lastDelivered = -1; this.lastEpoch = -1;
    this.win = { bytes: 0, frames: 0, lost: 0, recovered: 0, t: now() };
    this.owdBase = []; this.qd = []; this.gaps = [];
    this.lastArrival = 0;
    this.waitKey = true;
  }

  push(b) {
    if (b.length < VHDR + SHARD) return;
    const epoch = b[1], id = b.readUInt32BE(2), key = b[6] & 1;
    if (epoch !== this.lastEpoch && this.lastEpoch !== -1 && !key && this.waitKey) return;
    if (this.lastDelivered >= 0 && epoch === this.lastEpoch && ((id - this.lastDelivered) | 0) <= 0) return;
    const fkey = `${epoch}:${id}`;
    let f = this.frames.get(fkey);
    if (!f) {
      f = { epoch, id, key, hostTs: b.readUInt32BE(7), encMs: b[11], len: b.readUInt32BE(12), pts: b.readUInt32BE(21), blocks: new Array(b[17]).fill(null), done: 0, first: hr(), firstWall: now(), shards: 0 };
      this.frames.set(fkey, f);
    }
    const bi = b[16], si = b[18], k = b[19], m = b[20];
    let blk = f.blocks[bi];
    if (!blk) blk = f.blocks[bi] = { k, m, sh: new Array(k + m).fill(null), n: 0, ok: false };
    this.win.bytes += b.length + 29;
    if (blk.ok || blk.sh[si]) return;
    blk.sh[si] = b.subarray(VHDR); blk.n++; f.shards++;
    if (blk.n >= k) {
      const dataMissing = blk.sh.slice(0, k).some((x) => !x);
      const out = fec.decode(blk.sh, k);
      if (!out) return;
      if (dataMissing) this.win.recovered++;
      blk.data = out; blk.ok = true; f.done++;
      if (f.done === f.blocks.length) this._complete(fkey, f);
    }
  }

  _complete(fkey, f) {
    const t = hr();
    const data = Buffer.allocUnsafe(f.len);
    let o = 0;
    for (const blk of f.blocks) for (const s of blk.data) { const n = Math.min(SHARD, f.len - o); if (n <= 0) break; Buffer.from(s.buffer, s.byteOffset, n).copy(data, o); o += n; }
    this.frames.delete(fkey);
    // anything older that never finished is lost
    for (const [k2, g] of this.frames) if (g.epoch === f.epoch && ((g.id - f.id) | 0) < 0) { this.frames.delete(k2); this.win.lost++; }
    const gap = this.lastEpoch === f.epoch && this.lastDelivered >= 0 ? ((f.id - this.lastDelivered) | 0) - 1 : 0;
    if (gap > 0) this.win.lost += gap;
    this.win.frames++;
    if (f.key) this.waitKey = false;
    if (f.epoch !== this.lastEpoch && !f.key) { this.waitKey = true; this.onNeedKey?.(); return; }
    this.lastEpoch = f.epoch; this.lastDelivered = f.id;
    // Queuing delay from the first shard's arrival (not the last), and only for normal-sized
    // frames: a big keyframe takes longer to transmit, which isn't congestion.
    const owd = ((f.firstWall >>> 0) - f.hostTs) | 0;
    this.owdBase.push({ v: owd, t: now() });
    while (this.owdBase.length && now() - this.owdBase[0].t > 10000) this.owdBase.shift();
    let base = Infinity; for (const x of this.owdBase) if (x.v < base) base = x.v;
    if (!f.key && f.blocks.length === 1) this.qd.push(owd - base);
    if (this.lastArrival) this.gaps.push(t - this.lastArrival);
    this.lastArrival = t;
    this.onFrame({ epoch: f.epoch, id: f.id, key: !!f.key, data, hostTs: f.hostTs, encMs: f.encMs, pts: f.pts, owd, assembleMs: t - f.first, gap });
  }

  // Called every ~100 ms; returns feedback for the sender.
  report() {
    const w = this.win, t = now(), dt = Math.max(1, t - w.t);
    for (const [k, g] of this.frames) if (hr() - g.first > 250) { this.frames.delete(k); w.lost++; }
    const qd = this.qd.length ? this.qd.reduce((a, b) => a + b, 0) / this.qd.length : 0;
    // jitter = how much the gap between frames wobbles around its average
    let jit = 0;
    if (this.gaps.length > 2) {
      const mean = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
      jit = this.gaps.reduce((a, b) => a + Math.abs(b - mean), 0) / this.gaps.length;
    }
    const r = { kbps: Math.round(w.bytes * 8 / dt), loss: 0, lost: w.lost, recovered: w.recovered, frames: w.frames, qd: Math.round(qd * 10) / 10, jitter: Math.round(jit * 10) / 10, fps: Math.round(w.frames * 1000 / dt) };
    this.win = { bytes: 0, frames: 0, lost: 0, recovered: 0, t };
    this.qd = []; this.gaps = [];
    return r;
  }
}

// ------------------------------------------------------------------ congestion control
class RateControl {
  constructor({ maxKbps, minKbps = 1500, startKbps, stability = false }) {
    this.max = maxKbps; this.min = minKbps; this.stability = stability;
    this.target = Math.min(maxKbps, startKbps || maxKbps * 0.5);
    this.lastDrop = 0; this.lastUp = now(); this.lossEw = 0; this.jitEw = 0; this.congestions = 0; this.bad = 0;
  }
  setStability(on) { this.stability = on; }
  setMax(k) { this.max = k; this.target = Math.min(this.target, k); }
  get fecRatio() { return Math.min(0.5, Math.max(this.stability ? 0.1 : 0.05, this.lossEw * 2.5 + (this.stability ? 0.06 : 0.03))); }

  feedback(fb) {
    const t = now();
    this.lossEw = this.lossEw * 0.85 + fb.loss * 0.15;
    this.jitEw = this.jitEw ? this.jitEw * 0.9 + (fb.jitter || 0) * 0.1 : (fb.jitter || 0);
    // a jittery line (Wi-Fi, 5G) wobbles on its own; only call it congestion above that wobble
    const qThr = Math.max(this.stability ? 14 : 25, this.jitEw * 3);
    const lThr = this.stability ? 0.04 : 0.08;
    const congested = fb.qd > qThr || fb.loss > lThr || fb.lost > 2;
    // one bad report is noise; two in a row is a trend
    this.bad = congested ? this.bad + 1 : 0;
    if (this.bad >= 2 && t - this.lastDrop > 500) {
      // If the link actually carried close to the target, aim just under what got through.
      // If the encoder wasn't using the bandwidth (static screen), just step down a bit.
      const carried = fb.kbps > this.target * 0.6;
      const next = carried ? Math.min(this.target * 0.85, fb.kbps * 0.95) : this.target * 0.9;
      this.target = Math.max(this.min, next);
      this.lastDrop = t; this.congestions++; this.bad = 0;
      return 'down';
    }
    const hold = this.stability ? 5000 : 2500;
    if (!congested && fb.qd < qThr / 2 && t - this.lastDrop > hold && t - this.lastUp > 700) {
      this.lastUp = t;
      const before = this.target;
      this.target = Math.min(this.max, this.target * (this.stability ? 1.03 : 1.05));
      return this.target > before ? 'up' : null;
    }
    return null;
  }
}

module.exports = { VideoTx, VideoRx, RateControl, SHARD, CH_VIDEO, VHDR };
