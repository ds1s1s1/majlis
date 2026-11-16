// Low-latency mixer: one ring for game/film audio, one per voice speaker.
// Game mode keeps ~30 ms queued; watch mode keeps more so it lines up with the buffered picture.
// If a ring falls far behind it skips ahead instead of letting delay pile up.
// Ducking: while someone talks, the game/film dips so you can hear them.
class Ring {
  constructor(size) { this.l = new Float32Array(size); this.r = new Float32Array(size); this.w = 0; this.rd = 0; this.size = size; this.started = false; this.last = 0; }
  get avail() { return (this.w - this.rd + this.size) % this.size; }
  silence(n) { for (let i = 0; i < n; i++) { this.l[this.w] = 0; this.r[this.w] = 0; this.w = (this.w + 1) % this.size; } }
  // Keep the queued audio at `want` samples (±25 ms) so this chunk plays when the picture
  // that goes with it is on screen: drop the oldest audio if we're behind, pad silence if ahead.
  // Nudge gently: a late chunk must never wipe out what's queued (that was the audio
  // cutting out on shaky lines). Drift is corrected a few ms at a time instead.
  align(want) {
    const avail = this.avail, tol = 3840; // 80 ms of slack before doing anything
    if (avail > want + tol) this.rd = (this.rd + Math.min(avail - want - tol / 2, 480)) % this.size;
    else if (avail + tol < want && !this.started) this.silence(Math.min(24000, want - avail));
    else if (avail + tol < want) this.silence(Math.min(480, want - avail));
    this.started = true;
  }
  push(l, r, max, keep) {
    for (let i = 0; i < l.length; i++) { this.l[this.w] = l[i]; this.r[this.w] = r[i]; this.w = (this.w + 1) % this.size; }
    if (this.avail > max) this.rd = (this.w - keep + this.size) % this.size;
    this.last = currentTime;
  }
}

class Mixer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rings = new Map();
    this.gain = { game: 1, voice: 1 };
    this.per = {}; // per-speaker volume, keyed like the rings ('v1', 'v2', ...)
    this.target = 48000 * 0.03;
    this.duck = true; this.duckLevel = 1;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'pcm') {
        let ring = this.rings.get(m.k);
        if (!ring) { ring = new Ring(48000 * 2); this.rings.set(m.k, ring); }
        if (typeof m.want === 'number' && m.want > -300 && m.want < 4000) ring.align(Math.max(0, Math.round(m.want * 48)));
        ring.push(m.l, m.r || m.l, this.target * 4 + 48000 * 0.06, this.target + 48000 * 0.01);
      } else if (m.t === 'gain') { this.gain = { ...this.gain, ...m.g }; if (m.per) this.per = { ...this.per, ...m.per }; }
      else if (m.t === 'target') this.target = Math.round(48000 * m.ms / 1000);
      else if (m.t === 'duck') this.duck = !!m.on;
    };
  }
  process(_, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    L.fill(0); if (R !== L) R.fill(0);
    let talking = false;
    for (const [k, ring] of this.rings) if (k !== 'game' && currentTime - ring.last < 0.35) talking = true;
    const want = this.duck && talking ? 0.3 : 1;
    this.duckLevel += (want - this.duckLevel) * (want < this.duckLevel ? 0.08 : 0.02);
    for (const [k, ring] of this.rings) {
      const target = k === 'game' ? this.target : 48000 * 0.04;
      if (!ring.started) { if (ring.avail < target) continue; ring.started = true; }
      const g = k === 'game' ? this.gain.game * this.duckLevel : this.gain.voice * (this.per[k] ?? 1);
      const n = Math.min(L.length, ring.avail);
      for (let i = 0; i < n; i++) { L[i] += ring.l[ring.rd] * g; R[i] += ring.r[ring.rd] * g; ring.rd = (ring.rd + 1) % ring.size; }
      if (n < L.length) ring.started = false; // underrun: rebuild a small cushion
    }
    return true;
  }
}
registerProcessor('majlis-mixer', Mixer);
