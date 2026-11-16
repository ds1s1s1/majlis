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
  constructor(link) { this.link = link; this.fecRatio = 0.1; this.sentFrames = 0; this.queue = []; this.busy = false; this.rateKbps = 20000; }

  send(frame) {
    const { data, key, epoch, id, encMs } = frame;
    const pts = (frame.pts ?? frame.ts ?? 0) >>> 0;
    const total = Math.max(1, Math.ceil(data.length / SHARD));
    const blocks = Math.ceil(total / MAXK);
    const pkts = [];
    const hostTs = now() >>> 0;
    for (let b = 0; b < blocks; b++) {
      const first = b * MAXK, k = Math.min(MAXK, total - first);
      // keyframes are what everything after them depends on: protect them harder
      const m = Math.min(255 - k, Math.max(key ? 3 : 1, Math.ceil(k * (key ? Math.max(0.3, this.fecRatio) : this.fecRatio))));
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
    // Never let more than ~400 ms pile up on our side: past that the picture is late anyway.
    // Films (regular keyframes) skip ahead to the next keyframe; games drop the frame and the
    // encoder's rolling intra refresh cleans it up within a second.
    // what's waiting behind the frame currently going out (that one is allowed to be big)
    const queued = this.queue.slice(1).reduce((a, q) => a + (q.length - (q.i || 0)), 0) * 1150;
    // films ride a cinema buffer, so they can be late by a second rather than skip and freeze
    const limit = Math.max(200000, (Math.max(800, this.rateKbps) / 8) * (this.keyed ? 1500 : 500));
    if (this.skipToKey && !key) { this.skipped = (this.skipped || 0) + 1; return; }
    if (queued > limit) {
      if (key) { this.queue = this.queue.filter((q) => q.i > 0 && q.i < q.length); }
      else { this.skipped = (this.skipped || 0) + 1; if (this.keyed) this.skipToKey = true; return; }
    }
    if (key) this.skipToKey = false;
    this.queue.push(pkts);
    if (!this.busy) this._drain();
  }

  // Pacing (token bucket): packets leave at a steady ~1.5x the target bitrate instead of in
  // bursts. Cell networks (Zain/STC/Mobily 4G-5G) drop or queue bursts, which is where most
  // loss and ping spikes came from. A small burst allowance keeps small frames instant.
  _drain() {
    if (this.busy) return;
    this.busy = true;
    const step = () => {
      const t = hr();
      const rate = Math.max(1000, this.rateKbps * 1.1) / 8; // bytes per ms (headroom is in rateKbps)
      // bucket holds ~25 ms worth, so a coarse timer still keeps the line busy
      const cap = Math.max(16 * 1150, rate * 25);
      this.tokens = Math.min(cap, (this.tokens ?? cap) + (t - (this.tLast ?? t)) * rate);
      this.tLast = t;
      while (this.queue.length) {
        const pkts = this.queue[0];
        while (pkts.i === undefined || pkts.i < pkts.length) {
          pkts.i ??= 0;
          if (this.tokens < 1150) break;
          // stamp the real departure time: waiting in our own queue isn't network congestion
          const p = pkts[pkts.i++]; p.writeUInt32BE(Date.now() >>> 0, 7);
          this.link.send(p); this.tokens -= 1150;
        }
        if (pkts.i < pkts.length) break;
        this.queue.shift();
      }
      // wait on a timer, not a spin: a spinning loop starves everything else (pings included)
      if (this.queue.length) setTimeout(step, Math.max(1, Math.ceil((1150 - this.tokens) / rate))); else this.busy = false;
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
    // a jump in frame numbers isn't loss: the sender may have skipped frames on purpose to stay
    // live. Only frames that started arriving and never completed count as lost.
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
    if (!f.key) this.qd.push(owd - base); // first shard of the frame: its own size doesn't delay it
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
  constructor({ maxKbps, minKbps = 1500, startKbps, stability = false, relaxed = false }) {
    this.max = maxKbps; this.min = minKbps; this.stability = stability; this.relaxed = relaxed;
    this.qdHist = [];
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
    // Standing queue, BBR-style: the smallest queuing delay seen over the last 400 ms. A burst
    // (a keyframe) delays a few frames for a moment; real congestion delays every one of them.
    this.qdHist.push({ v: fb.qd, t });
    while (this.qdHist.length > 1 && t - this.qdHist[0].t > 400) this.qdHist.shift();
    let qd = Infinity; for (const x of this.qdHist) if (x.v < qd) qd = x.v;
    fb = { ...fb, qd };
    // a jittery line (Wi-Fi, 5G) wobbles on its own; only call it congestion above that wobble.
    // Films (relaxed) can sit on a bit more queue than a game can.
    const qThr = Math.max(this.relaxed ? 60 : this.stability ? 14 : 25, this.jitEw * 3);
    const lThr = this.stability ? 0.04 : 0.08;
    const rttUp = fb.rttInc != null && fb.rttInc > Math.max(this.relaxed ? 100 : 55, this.jitEw * 4);
    const congested = fb.qd > qThr || fb.loss > lThr || fb.lost > 2 || rttUp;
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
    const appLimited = fb.kbps > 0 && fb.kbps < this.target * 0.6;
    if (!congested && !appLimited && fb.qd < qThr / 2 && t - this.lastDrop > hold && t - this.lastUp > 700) {
      this.lastUp = t;
      const before = this.target;
      this.target = Math.min(this.max, this.target * (this.stability ? 1.03 : 1.05));
      return this.target > before ? 'up' : null;
    }
    return null;
  }
}

module.exports = { VideoTx, VideoRx, RateControl, SHARD, CH_VIDEO, VHDR };
