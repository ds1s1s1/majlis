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
    pkts.pts = pts; pkts.key = !!key;
    // Live video: never let more than ~500 ms pile up on our side, past that the picture is late
    // anyway; drop the frame and the encoder's rolling intra refresh cleans it up within a second.
    // Films are sent seconds ahead of the picture on purpose, so the queue may hold all of that;
    // a film frame is only given up on when it would land after its moment on screen (_drain).
    // (what's waiting behind the frame currently going out; that one is allowed to be big)
    const queued = this.queue.slice(1).reduce((a, q) => a + (q.length - (q.i || 0)), 0) * 1150;
    const limit = this.keyed ? 64e6 : Math.max(200000, (Math.max(800, this.rateKbps) / 8) * 500);
    if (this.skipToKey && !key) { this.skipped = (this.skipped || 0) + 1; return; }
    if (queued > limit) {
      if (key) { this.queue = this.queue.filter((q) => q.i > 0 && q.i < q.length); }
      else { this.skipped = (this.skipped || 0) + 1; if (this.keyed) this.skipToKey = true; else this.onSkip?.(id); return; }
    }
    if (key) this.skipToKey = false;
    this.queue.push(pkts);
    if (!this.busy) this._drain();
  }

  // a new film run (seek, restart): nothing queued from the old one is wanted any more
  flush() {
    this.queue = this.queue.filter((q) => q.i > 0 && q.i < q.length);
    this.skipToKey = false; this.sentPts = null;
  }

  // A packet that should ride the same paced queue as the film (its audio): in order with the
  // picture and never bursting past the line's rate.
  sendRaw(buf) {
    const pkts = [buf]; pkts.raw = true;
    this.queue.push(pkts);
    if (!this.busy) this._drain();
  }

  // Film frame about to go out: if the line is so far behind that it would arrive well after
  // its moment on screen, skip to the next keyframe and catch up instead of sending dead frames.
  _late(pkts) {
    if (!this.keyed || !this.dueOf || pkts.i || pkts.raw) return false;
    if (this.skipToKey && !pkts.key) return true;
    if (pkts.key) { this.skipToKey = false; return false; }
    if (Date.now() - this.dueOf(pkts.pts) > 1200) { this.skipToKey = true; this.skipped = (this.skipped || 0) + 1; return true; }
    return false;
  }

  // Pacing (token bucket): packets leave at a steady ~1.5x the target bitrate instead of in
  // bursts. Cell networks (Zain/STC/Mobily 4G-5G) drop or queue bursts, which is where most
  // loss and ping spikes came from. A small burst allowance keeps small frames instant.
  _drain() {
    if (this.busy) return;
    this.busy = true;
    const step = () => {
      const t = hr();
      // bytes per ms; live video gets a little headroom over its rate, a film goes at the rate
      // control's estimate and no faster (nothing to gain from queueing in the network)
      const rate = Math.max(1000, this.rateKbps * (this.keyed ? 1 : 1.1)) / 8;
      // bucket holds ~25 ms worth, so a coarse timer still keeps the line busy
      const cap = Math.max(16 * 1150, rate * 25);
      this.tokens = Math.min(cap, (this.tokens ?? cap) + (t - (this.tLast ?? t)) * rate);
      this.tLast = t;
      while (this.queue.length) {
        const pkts = this.queue[0];
        if (this._late(pkts)) { this.queue.shift(); continue; }
        while (pkts.i === undefined || pkts.i < pkts.length) {
          pkts.i ??= 0;
          const cost = pkts[pkts.i ?? 0].length + 60; // what it really takes on the wire (seal + UDP/IP)
          if (this.tokens < cost) break;
          // stamp the real departure time: waiting in our own queue isn't network congestion
          const p = pkts[pkts.i++]; if (!pkts.raw) p.writeUInt32BE(Date.now() >>> 0, 7);
          this.link.send(p); this.tokens -= cost;
        }
        if (pkts.i < pkts.length) break;
        if (!pkts.raw && pkts.pts != null) this.sentPts = pkts.pts;
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
    this.lostIds = []; // live frames that never arrived whole: the host's engine recovers from these
  }

  push(b) {
    if (b.length < VHDR + SHARD) return;
    const epoch = b[1], id = b.readUInt32BE(2), key = b[6] & 1;
    const fkey = `${epoch}:${id}`;
    if (this.film) {
      // a film has seconds of slack: frames may finish out of order (jitter reorders packets),
      // the player puts them back in order; only an exact repeat is ignored
      if (this.done?.has(fkey)) return;
    } else {
      if (epoch !== this.lastEpoch && this.lastEpoch !== -1 && !key && this.waitKey) return;
      if (this.lastDelivered >= 0 && epoch === this.lastEpoch && ((id - this.lastDelivered) | 0) <= 0) return;
    }
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
    if (this.film) {
      (this.done ||= new Set()).add(fkey);
      if (this.done.size > 3000) { const it = this.done.values(); for (let i = 0; i < 1500; i++) this.done.delete(it.next().value); }
    } else {
      // live: anything older that never finished is lost (waiting for it would add delay)
      for (const [k2, g] of this.frames) if (g.epoch === f.epoch && ((g.id - f.id) | 0) < 0) { this.frames.delete(k2); this.win.lost++; this.lostIds.push(g.id); }
    }
    const gap = this.lastEpoch === f.epoch && this.lastDelivered >= 0 ? ((f.id - this.lastDelivered) | 0) - 1 : 0;
    // a jump in frame numbers isn't loss: the sender may have skipped frames on purpose to stay
    // live. Only frames that started arriving and never completed count as lost.
    this.win.frames++;
    if (f.key) this.waitKey = false;
    if (!this.film && f.epoch !== this.lastEpoch && !f.key) { this.waitKey = true; this.onNeedKey?.(); return; }
    this.lastEpoch = f.epoch; this.lastDelivered = this.film ? Math.max(this.lastDelivered, f.id) : f.id;
    // Queuing delay from the first shard's arrival (not the last), and only for normal-sized
    // frames: a big keyframe takes longer to transmit, which isn't congestion.
    const owd = ((f.firstWall >>> 0) - f.hostTs) | 0;
    this.owdBase.push({ v: owd, t: now() });
    // base = the quietest the line has been over 30 s, so a queue that builds and just sits
    // there still shows (a short window would slowly take it as the new normal)
    while (this.owdBase.length && now() - this.owdBase[0].t > 30000) this.owdBase.shift();
    let base = Infinity; for (const x of this.owdBase) if (x.v < base) base = x.v;
    if (!f.key) this.qd.push(owd - base); // first shard of the frame: its own size doesn't delay it
    if (this.lastArrival) this.gaps.push(t - this.lastArrival);
    this.lastArrival = t;
    this.onFrame({ epoch: f.epoch, id: f.id, key: !!f.key, data, hostTs: f.hostTs, encMs: f.encMs, pts: f.pts, owd, assembleMs: t - f.first, gap });
  }

  // other traffic the sender paces along with the video (film audio) counts toward what got through
  count(bytes) { this.win.bytes += bytes; }

  // Called every ~100 ms; returns feedback for the sender.
  report() {
    const w = this.win, t = now(), dt = Math.max(1, t - w.t);
    // a frame that started arriving and never finished is lost; films travel ahead of the
    // picture, so a big keyframe on a slow line gets much longer to come in
    const tmo = this.film ? 2000 : 250;
    for (const [k, g] of this.frames) if (hr() - g.first > tmo) { this.frames.delete(k); w.lost++; if (!this.film) this.lostIds.push(g.id); }
    const qd = this.qd.length ? this.qd.reduce((a, b) => a + b, 0) / this.qd.length : 0;
    // jitter = how much the gap between frames wobbles around its average
    let jit = 0;
    if (this.gaps.length > 2) {
      const mean = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
      jit = this.gaps.reduce((a, b) => a + Math.abs(b - mean), 0) / this.gaps.length;
    }
    const r = { kbps: Math.round(w.bytes * 8 / dt), loss: 0, lost: w.lost, recovered: w.recovered, frames: w.frames, qd: Math.round(qd * 10) / 10, jitter: Math.round(jit * 10) / 10, fps: Math.round(w.frames * 1000 / dt) };
    if (this.lostIds.length) { r.lostIds = this.lostIds.slice(-32); this.lostIds = []; }
    this.win = { bytes: 0, frames: 0, lost: 0, recovered: 0, t };
    this.qd = []; this.gaps = [];
    return r;
  }
}

// ------------------------------------------------------------------ congestion control
class RateControl {
  constructor({ maxKbps, minKbps = 1500, startKbps, stability = false, relaxed = false, burstMs = 400 }) {
    this.max = maxKbps; this.min = minKbps; this.stability = stability; this.relaxed = relaxed;
    // how long a queue has to last before it counts: ffmpeg streams have keyframe bursts to
    // look past; the engine never sends keyframes mid-stream, so it can react much sooner
    this.burstMs = burstMs; this.rxHist = [];
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
    // what got through, smoothed over ~1 s: a single 100 ms report swings from 0 to double
    // (a film at 24 fps, a still screen), which made one quiet moment look like a slow line
    this.rxEw = this.rxEw == null ? fb.kbps : this.rxEw * 0.8 + fb.kbps * 0.2;
    // the most the line carried lately: on a mostly still screen the average says nothing
    // about capacity, the bursts do
    this.rxHist.push({ v: this.rxEw, t });
    while (this.rxHist.length > 1 && t - this.rxHist[0].t > 2000) this.rxHist.shift();
    let rxPeak = 0; for (const x of this.rxHist) if (x.v > rxPeak) rxPeak = x.v;
    this.jitEw = this.jitEw ? this.jitEw * 0.9 + (fb.jitter || 0) * 0.1 : (fb.jitter || 0);
    // Standing queue, BBR-style: the smallest queuing delay seen over the last 400 ms. A burst
    // (a keyframe) delays a few frames for a moment; real congestion delays every one of them.
    this.qdHist.push({ v: fb.qd, t });
    while (this.qdHist.length > 1 && t - this.qdHist[0].t > this.burstMs) this.qdHist.shift();
    let qd = Infinity; for (const x of this.qdHist) if (x.v < qd) qd = x.v;
    fb = { ...fb, qd };
    // a jittery line (Wi-Fi, 5G) wobbles on its own; only call it congestion above that wobble.
    // Films (relaxed) can sit on a bit more queue than a game can.
    const qThr = Math.max(this.relaxed ? 60 : this.stability ? 14 : 25, this.jitEw * 3);
    const lThr = this.stability ? 0.04 : 0.08;
    // Ping rising counts only when our own packets also show some queue: the ping goes both
    // ways and through whatever the relay is doing, so on its own it's mostly noise (that's
    // what pinned films to 1.5 Mbps over a relay that was carrying 14 Mbps fine).
    const rttUp = fb.rttInc != null && fb.rttInc > Math.max(this.relaxed ? 100 : 55, this.jitEw * 4) && fb.qd > Math.max(6, qThr * 0.35);
    const congested = fb.qd > qThr || fb.loss > lThr || fb.lost > 2 || rttUp;
    // one bad report is noise; two in a row is a trend
    this.bad = congested ? this.bad + 1 : 0;
    if (this.bad >= 2 && t - this.lastDrop > 500) {
      // If the link actually carried close to the target, aim just under what got through.
      // If the encoder wasn't using the bandwidth (static screen), just step down a bit.
      const carried = rxPeak > this.target * 0.6;
      const next = carried ? Math.min(this.target * 0.85, rxPeak * 0.95) : this.target * 0.9;
      this.target = Math.max(this.min, next);
      this.lastDrop = t; this.congestions++; this.bad = 0;
      return 'down';
    }
    const hold = this.stability ? 5000 : 2500;
    const appLimited = this.rxEw > 0 && this.rxEw < this.target * 0.6;
    if (!congested && !appLimited && fb.qd < qThr / 2 && t - this.lastDrop > hold && t - this.lastUp > 700) {
      this.lastUp = t;
      const before = this.target;
      this.target = Math.min(this.max, this.target * (this.stability ? 1.03 : 1.05));
      return this.target > before ? 'up' : null;
    }
    return null;
  }
}

// ------------------------------------------------------------------ native (majlis-core)
// The same three jobs done in Rust when the addon is there: everything per packet (FEC,
// sealing, pacing, reassembly, per-packet feedback, repairs) never touches JavaScript.
// These keep the exact faces the host and guest code already use.
class CoreTx {
  constructor(link) { this.link = link; this.c = link.core; this._rate = 20000; this._keyed = false; this._st = null; this._stT = 0; link.on('skip', (id) => this.onSkip?.(id)); }
  send(frame) {
    const pts = (frame.pts ?? frame.ts ?? 0) >>> 0;
    this.c.txFrame(frame.data, !!frame.key, frame.epoch & 0xff, frame.id >>> 0, Math.min(255, Math.round(frame.encMs || 0)), pts);
  }
  sendRaw(buf) { this.c.txRaw(buf); }
  flush() { this.c.txFlush(); }
  setClock(c) { this.c.txClock(c.pos || 0, c.at || 0, !!c.playing); }
  _state() { const t = Date.now(); if (!this._st || t - this._stT > 40) { this._st = this.c.txState(); this._stT = t; } return this._st; }
  get rateKbps() { return this._rate; }
  set rateKbps(v) { if (Math.abs(v - this._rate) > 1) { this._rate = v; this.c.txSet(v, this._keyed); } }
  get keyed() { return this._keyed; }
  set keyed(v) { if (!!v !== this._keyed) { this._keyed = !!v; this.c.txSet(this._rate, this._keyed); } }
  get sentPts() { const p = this._state()[0]; return p < 0 ? null : p; }
  get skipped() { return this._state()[1]; }
  get repaired() { return this._state()[3]; }
  // these are all decided natively now
  set fecRatio(v) {} get fecRatio() { return this._state()[4]; }
  set dueOf(f) {} set skipToKey(v) {}
  get queue() { return []; }
}

// Rate control from per-packet feedback (gcc.rs), behind RateControl's face.
class CoreRate {
  constructor(link, { maxKbps, minKbps = 1500, startKbps, stability = false, relaxed = false }) {
    this.c = link.core; this.relaxed = relaxed; this.jitEw = 0; this.bad = 0;
    this.c.rateSet(Math.min(maxKbps, startKbps || maxKbps * 0.5), minKbps, maxKbps, stability ? 1 : 0);
    this._max = maxKbps; this._stab = stability; this._r = this.c.rate(); this._lastDropSet = 0;
  }
  _sync() { this._r = this.c.rate(); }
  get target() { return this._r[0]; }
  set target(v) { this.c.rateSet(v, -1, -1, -1); this._sync(); }
  get max() { return this._max; }
  setMax(k) { this._max = k; this.c.rateSet(-1, -1, k, -1); this._sync(); }
  get stability() { return this._stab; }
  setStability(on) { this._stab = !!on; this.c.rateSet(-1, -1, -1, on ? 1 : 0); }
  get lossEw() { return this._r[1]; }
  get congestions() { return this._r[2]; }
  get lastDrop() { return Math.max(this._lastDropSet, Date.now() - this._r[3]); }
  set lastDrop(v) { this._lastDropSet = v; }
  get fecRatio() { return this._r[6]; }
  get trend() { return this._r[5]; }
  get acked() { return this._r[4]; }
  // the guest's 100 ms report: decisions are made per packet in Rust; keep the jitter
  // estimate the host uses to pick stability mode
  feedback(fb) { this.jitEw = this.jitEw ? this.jitEw * 0.9 + (fb.jitter || 0) * 0.1 : (fb.jitter || 0); this._sync(); return null; }
}

// Receive side: frames arrive whole from Rust (link 'vframe'); this only reports.
class CoreRx {
  constructor(link, { onFrame }) {
    this.link = link; this.c = link.core; this._film = false; this._nack = false;
    link.on('vframe', onFrame);
    this._apply();
  }
  _apply() { this.c.setReceive(true, this._nack || this._film, this._film, this.link.rtt || 0); }
  get film() { return this._film; }
  set film(v) { if (!!v !== this._film) { this._film = !!v; this._apply(); } }
  set nack(v) { if (!!v !== this._nack) { this._nack = !!v; this._apply(); } }
  push() {}
  count() {}
  report() { this._apply(); try { return JSON.parse(this.c.rxReport()); } catch { return { kbps: 0, loss: 0, lost: 0, frames: 0, qd: 0, jitter: 0, fps: 0 }; } }
}

const makeTx = (link) => (link.core ? new CoreTx(link) : new VideoTx(link));
const makeRc = (link, o) => (link.core ? new CoreRate(link, o) : new RateControl(o));
const makeRx = (link, o) => (link.core ? new CoreRx(link, o) : new VideoRx(o));

module.exports = { VideoTx, VideoRx, RateControl, CoreTx, CoreRate, CoreRx, makeTx, makeRc, makeRx, SHARD, CH_VIDEO, VHDR };
