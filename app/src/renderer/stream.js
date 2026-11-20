// The viewer: hardware decode with WebCodecs straight onto a canvas, a tiny audio mixer, a
// locally drawn cursor, and every input device forwarded to the host.
import { SC } from './keys.js';

const CODECS = [['av1', 'av01.0.13M.08'], ['hevc', 'hvc1.1.6.L153.B0'], ['h264', 'avc1.640034']];

export async function decodeCaps() {
  const codecs = [];
  if (!('VideoDecoder' in window)) return { codecs: ['h264'] };
  const W = Math.round(screen.width * devicePixelRatio), H = Math.round(screen.height * devicePixelRatio);
  for (const [name, codec] of CODECS) {
    try {
      const r = await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
      if (!r.supported) continue;
      if (name === 'h264') { codecs.push(name); continue; }
      // powerEfficient is Chromium's way of saying "the GPU does this"
      const mc = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: `video/mp4; codecs="${codec}"`, width: W, height: H, bitrate: 20e6, framerate: 60 } }).catch(() => null);
      if (!mc || mc.powerEfficient) codecs.push(name);
    } catch {}
  }
  if (!codecs.includes('h264')) codecs.push('h264');
  return { codecs };
}

export async function measureHz() {
  return new Promise((res) => {
    const ts = [];
    const f = (t) => { ts.push(t); if (ts.length < 30) requestAnimationFrame(f); else { const d = (ts[ts.length - 1] - ts[5]) / (ts.length - 6); res(Math.round(1000 / d)); } };
    requestAnimationFrame(f);
  });
}

export class Player {
  constructor({ port, canvas, cursorEl, stage, onStats, onFirstFrame, onPadState, settings }) {
    this.port = port; this.canvas = canvas; this.cursorEl = cursorEl; this.stage = stage;
    this.onStats = onStats; this.onFirstFrame = onFirstFrame; this.onPadState = onPadState || null; this.settings = settings;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dec = null; this.configs = new Map(); this.epoch = -1; this.waitKey = true;
    this.submit = new Map(); this.stats = { dec: [], enc: [], net: [], frames: 0, drops: 0 };
    this.shapes = new Map();
    this.localCursor = { x: 0, y: 0, t: 0 };
    this.hostCursor = { x: 0.5, y: 0.5, v: false, s: 0 };
    this.voiceDec = new Map();
    this.perGains = {};
    this._hadPad = false;
    this.active = true;
    this.destroyed = false;
    this.refreshMs = 1000 / 60;
    this.mouseMode = 'abs';
    this.cinema = false; this.cinemaDelay = 180; this.queue = []; this.fstat = { late: 0, lateKey: 0, qdrop: 0, clk: 0 };
    this.anchor = null;            // watch mode: local time = anchor.base + media pts
    this.latEw = 40; this.aJit = 0; this.aLast = 0;
    this.ameta = [];               // per audio chunk: timing info, consumed in decode order
    this.inputEnabled = true;
    this._bind();
    this._audio();
    this.statsTimer = setInterval(() => this._report(), 500);
    this.padTimer = setInterval(() => this._pollPads(), 4);
    measureHz().then((hz) => { if (!this.destroyed) this.refreshMs = 1000 / (hz || 60); });
  }

  // ------------------------------------------------------------------ video
  onMessage(m) {
    switch (m.t) {
      case 'config': this.configs.set(m.epoch, m); this.film?.dead.delete(m.epoch); break;
      case 'v': if (this.film?.clock && this.configs.get(m.epoch)?.tier === 'movie') this._filmVideo(m); else this._video(m); break;
      case 'a': if (m.timed && this.film?.clock) this._filmAudioIn(m); else this._gameAudio(m); break;
      case 'clock': this._filmClock(m); break;
      case 'vo': this._voiceIn(m.idx, m.data); break;
      case 'c': this.hostCursor = { x: m.x, y: m.y, v: !!m.v, s: m.s }; this._drawCursor(); break;
      case 'shape': this._shape(m); break;
      case 'r': this._rumble(m.large, m.small); break;
    }
  }

  _configure(epoch) {
    const c = this.configs.get(epoch);
    if (!c) return false;
    try { this.dec?.close(); } catch {}
    const description = c.description ? Uint8Array.from(atob(c.description), (ch) => ch.charCodeAt(0)) : undefined;
    this.dec = new VideoDecoder({
      output: (frame) => this._output(frame),
      error: () => {
        this.waitKey = true; this.epoch = -1;
        // film: pick up again at the next keyframe in the buffer (the host can't make one)
        const ep = this.film?.eps.get(this.film.cur); if (ep) { ep.broken = true; return; }
        this.port.postMessage({ t: 'needkey' });
      },
    });
    this.dec.configure({ codec: c.codec, description, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
    this.epoch = epoch;
    this.codecInfo = { codec: c.family, encoder: c.encoder, fps: c.fps, tier: c.tier };
    return true;
  }

  _video(m) {
    if (m.epoch !== this.epoch) {
      if (!m.key) { this.port.postMessage({ t: 'needkey' }); return; }
      if (!this._configure(m.epoch)) return;
      this.waitKey = true;
    }
    if (this.waitKey && !m.key) { this.stats.drops++; return; }
    if (!this.dec || this.dec.state !== 'configured') return;
    if (!this.cinema && !m.key && this.dec.decodeQueueSize > 3) {
      // falling behind: skip to the next keyframe instead of piling up delay
      this.stats.drops++; this.waitKey = true; this.epoch = -1;
      this.port.postMessage({ t: 'needkey' });
      return;
    }
    this.waitKey = false;
    const ts = m.id * 1000;
    this.submit.set(ts, { t: performance.now(), enc: m.enc, net: m.net, pts: m.pts, epoch: m.epoch });
    if (this.submit.size > 120) this.submit.delete(this.submit.keys().next().value);
    try {
      this.dec.decode(new EncodedVideoChunk({ type: m.key ? 'key' : 'delta', timestamp: ts, data: m.data }));
    } catch { this.waitKey = true; this.port.postMessage({ t: 'needkey' }); }
  }

  // Watch mode: smoothness over latency. Frames wait in a short queue and go on screen at
  // (send time + fixed delay), so network jitter never shows as stutter.
  setCinema(on, delayMs = 180) {
    this.cinema = !!on; this.cinemaDelay = delayMs; this.anchor = null;
    this.mixer?.port.postMessage({ t: 'target', ms: this._mixTarget() });
    if (on && !this.rafOn) { this.rafOn = true; const loop = () => { if (!this.rafOn) return; this._present(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
    // the film keeps going (decode + sound) even while the window is minimised and rAF stops
    if (on && !this.filmTimer) this.filmTimer = setInterval(() => this._filmPump(), 10);
    if (!on) {
      this.rafOn = false; for (const q of this.queue) q.frame.close(); this.queue = [];
      clearInterval(this.filmTimer); this.filmTimer = null; this.film = null;
    }
  }

  _present() {
    const now = performance.now();
    if (this.film?.clock) {
      // film: the newest decoded frame whose moment on the shared clock has come
      const disp = this._filmPos(now) + this.refreshMs / 2;
      let pick = null;
      while (this.queue.length && this.queue[0].pts <= disp) { if (pick) pick.frame.close(); pick = this.queue.shift(); }
      if (this.queue.length > 40) { while (this.queue.length > 8) { this.queue.shift().frame.close(); this.fstat.qdrop++; } }
      if (pick) this._draw(pick.frame);
      return;
    }
    let pick = null;
    while (this.queue.length && this.queue[0].at <= now) { if (pick) pick.frame.close(); pick = this.queue.shift(); }
    if (this.queue.length > 30) { while (this.queue.length > 2) this.queue.shift().frame.close(); }
    if (pick) this._draw(pick.frame);
  }

  _output(frame) {
    const s = this.submit.get(frame.timestamp);
    if (s) { this.submit.delete(frame.timestamp); this.stats.dec.push(performance.now() - s.t); this.stats.enc.push(s.enc); this.stats.net.push(s.net); }
    if (this.film?.clock && s?.film) {
      if (s.pts < this._filmPos(performance.now())) { this.fstat.late++; if (s.key) this.fstat.lateKey++; }
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].pts > s.pts) i--;
      this.queue.splice(i, 0, { frame, pts: s.pts });
      return;
    }
    if (this.cinema) {
      const at = s && s.pts != null ? this._present_at(s) : performance.now() + this.cinemaDelay;
      this.queue.push({ frame, at });
      return;
    }
    if (s) this.latEw = this.latEw * 0.9 + ((s.net || 0) + (performance.now() - s.t) + this.refreshMs / 2) * 0.1;
    this._draw(frame);
  }

  // ------------------------------------------------------------------ film (watch party)
  // The host encodes the film seconds ahead of a shared film clock and everyone keeps it in
  // hand: frames and audio wait here, keyed by their place in the film, and go to the decoder
  // just before the clock reaches them. A slow patch on the line eats into this buffer instead
  // of freezing the picture, and every screen shows the same frame at the same moment.
  _filmClock(m) {
    const f = (this.film ||= { eps: new Map(), order: 0, cur: null, audio: [], fed: [], dead: new Set(), known: new Set(), aSeen: new Set(), run: null, clock: null });
    const same = f.run !== null && m.run === f.run;
    if (f.run !== null && !same) this._filmFlush(); // seek / restart: all of it is stale
    this.fstat.clk++;
    f.run = m.run;
    const was = f.clock;
    const next = { pos: m.pos, at: m.at ? m.at - (Date.now() - performance.now()) : 0, playing: !!m.playing };
    // The same clock re-anchored while playing (our estimate of the host's clock moved, e.g. when
    // the best ping drops out of its window): glide there instead of jumping, or a jump of a few
    // hundred ms makes the frames in hand late and the picture freezes for a second.
    if (same && was?.playing && was.at && next.playing && next.at) {
      const d = (next.at - next.pos) - (was.at - was.pos);
      if (Math.abs(d) < 1500) { f.slew = (f.slew || 0) + d; this.mixer?.port.postMessage({ t: 'target', ms: this._mixTarget() }); return; }
    }
    f.slew = 0;
    f.clock = next;
    this.mixer?.port.postMessage({ t: 'target', ms: this._mixTarget() });
    if (was?.playing && !f.clock.playing) this._filmHush();
  }

  // How much sound the mixer keeps queued. The film's sound sits ~500 ms ahead (see _filmAudio),
  // so its trim ceiling (4x this) must not follow the cinema delay: 70 ms on the host's own view
  // put the ceiling under the queue and the sound was chopped twice a second. Every place that
  // sets it goes through here, whichever of film/cinema starts first.
  _mixTarget() { return this.film?.clock ? Math.max(this.cinemaDelay, 250) : this.cinema ? this.cinemaDelay : 30; }

  _filmFlush() {
    const f = this.film;
    f.dead = new Set(f.known); f.known = new Set();
    f.eps.clear(); f.cur = null; f.audio = []; f.fed = []; f.aSeen.clear();
    this._dropDecoded();
    this.mixer?.port.postMessage({ t: 'flush', k: 'game' });
  }

  // paused: stop the sound now, and keep what was already handed to it for when play resumes
  _filmHush() {
    const f = this.film;
    this.mixer?.port.postMessage({ t: 'flush', k: 'game' });
    for (const a of f.fed) if (a.pts >= f.clock.pos - 20) this._filmAudioIn({ ...a, again: true });
    f.fed = [];
  }

  _dropDecoded() {
    for (const q of this.queue) q.frame.close();
    this.queue = [];
    try { this.dec?.close(); } catch {}
    this.dec = null; this.epoch = -1;
  }

  _filmPos(now) { const c = this.film.clock; return c.playing && c.at ? c.pos + (now - c.at) : c.pos; }

  _filmVideo(m) {
    const f = this.film;
    if (f.dead.has(m.epoch)) return;
    f.known.add(m.epoch);
    let ep = f.eps.get(m.epoch);
    if (!ep) { ep = { order: f.order++, frames: [], next: 0, firstKey: null, maxPts: -Infinity, ids: new Set(), broken: false }; f.eps.set(m.epoch, ep); }
    if (ep.ids.has(m.id)) return; // sent again (catch-up after a switch)
    ep.ids.add(m.id);
    if (ep.ids.size > 6000) ep.ids = new Set([...ep.ids].slice(-3000));
    const fr = { id: m.id, key: !!m.key, data: m.data, pts: m.pts, gap: m.gap | 0 };
    let i = ep.frames.length;
    while (i > ep.next && ep.frames[i - 1].pts > fr.pts) i--;
    if (i < ep.next) return; // its moment is gone
    ep.frames.splice(i, 0, fr);
    if (fr.key && (ep.firstKey == null || fr.pts < ep.firstKey)) ep.firstKey = fr.pts;
    if (fr.pts > ep.maxPts) ep.maxPts = fr.pts;
  }

  _filmAudioIn(m) {
    const f = this.film;
    if (f.dead.has(m.epoch)) return;
    f.known.add(m.epoch);
    if (!m.again) {
      if (f.aSeen.has(m.pts)) return;
      f.aSeen.add(m.pts);
      if (f.aSeen.size > 4000) { const it = f.aSeen.values(); for (let i = 0; i < 2000; i++) f.aSeen.delete(it.next().value); }
    }
    let i = f.audio.length;
    while (i > 0 && f.audio[i - 1].pts > m.pts) i--;
    f.audio.splice(i, 0, { data: m.data, pts: m.pts, epoch: m.epoch });
    if (f.audio.length > 4000) f.audio.splice(0, f.audio.length - 4000);
  }

  _filmDecode(epoch, fr) {
    if (epoch !== this.epoch || !this.dec || this.dec.state !== 'configured') {
      if (!fr.key || !this._configure(epoch)) return false;
    }
    const ts = Math.round(fr.pts * 1000);
    this.submit.set(ts, { t: performance.now(), enc: 0, net: 0, pts: fr.pts, epoch, film: true, key: fr.key });
    if (this.submit.size > 240) this.submit.delete(this.submit.keys().next().value);
    try { this.dec.decode(new EncodedVideoChunk({ type: fr.key ? 'key' : 'delta', timestamp: ts, data: fr.data })); return true; }
    catch { this.epoch = -1; return false; }
  }

  _filmPump() {
    const f = this.film;
    if (!f?.clock) return;
    // decode this far ahead of the picture: a stall on this thread (UI, GC of big frames)
    // shorter than that never shows; at 100 ms the host's own view hitched every few seconds
    // a re-anchored clock: move toward it 0.5 ms per 10 ms (5%, smooth for picture and sound)
    if (f.slew) { const st = Math.max(-0.5, Math.min(0.5, f.slew)); f.clock.at += st; f.slew -= st; }
    const now = performance.now(), disp = this._filmPos(now), AHEAD = 300;
    let cur = f.eps.get(f.cur);
    // Which copy to decode: stay on the current one until it runs dry, or until a newer one
    // (the other rendition, a replaced light film) already reaches past the picture, then
    // move over at a keyframe.
    for (const [e, ep] of f.eps) {
      if (e === f.cur || ep.firstKey == null || (cur && ep.order < cur.order)) continue;
      const dry = !cur || (cur.next >= cur.frames.length && cur.maxPts < disp + AHEAD);
      const handedOver = !cur || cur.next >= cur.frames.length || cur.frames[cur.next].pts >= ep.firstKey;
      const ahead = handedOver && ep.maxPts >= disp + 600 && ep.firstKey <= disp + 500;
      if (!dry && !ahead) continue;
      const upto = Math.max(disp + AHEAD, ep.firstKey);
      let k = -1;
      for (let i = 0; i < ep.frames.length && ep.frames[i].pts <= upto; i++) if (ep.frames[i].key) k = i;
      if (k < 0) continue;
      ep.frames.splice(0, k); ep.next = 0; ep.broken = false; ep.lastId = null;
      for (const [e2, ep2] of f.eps) if (ep2.order < ep.order) f.eps.delete(e2);
      f.cur = e; cur = ep;
      // Preserve already-decoded frames in queue across clean rendition switches to avoid ~10fps dips
      if (dry && ep.firstKey < disp - 100) this._dropDecoded();
      else { try { this.dec?.close(); } catch {} this.dec = null; this.epoch = -1; }
      break;
    }
    if (cur) {
      // far behind (the line stalled for a while): jump to a later keyframe that's already here
      const nx = cur.frames[cur.next];
      if (nx && nx.pts < disp - 1000) {
        let k = -1;
        for (let i = cur.next + 1; i < cur.frames.length && cur.frames[i].pts <= disp + AHEAD; i++) if (cur.frames[i].key) k = i;
        if (k > 0) { cur.next = k; cur.broken = false; cur.lastId = null; }
      }
      let n = 0;
      while (cur.next < cur.frames.length && cur.frames[cur.next].pts <= disp + AHEAD && n < 40 && (!this.dec || this.dec.decodeQueueSize < 16)) {
        const fr = cur.frames[cur.next];
        // The frame before this one hasn't come in (frames can finish out of order): wait for
        // it while there's still time, it slots in ahead of this one when it lands. Past that,
        // nothing decodes cleanly again until a keyframe.
        if (!fr.key && !cur.broken && cur.lastId != null && fr.id !== ((cur.lastId + 1) >>> 0)) {
          if (fr.pts > disp - 60) break;
          cur.broken = true;
        }
        cur.next++;
        if (!fr.key && cur.broken) { this.stats.drops++; continue; }
        cur.broken = !this._filmDecode(f.cur, fr);
        cur.lastId = fr.id;
        n++;
      }
      if (cur.next > 200) { cur.frames.splice(0, cur.next); cur.next = 0; }
    }
    this._filmAudio(now, disp);
  }

  _filmAudio(now, disp) {
    const f = this.film, c = f.clock;
    if (!c.playing || !c.at || !this.adec || this.adec.state !== 'configured') return;
    if (this.ac.state === 'suspended') this.ac.resume();
    const outLat = (this.ac?.outputLatency || 0) * 1000 + 5 - (this.settings.avOffset || 0);
    // fed well ahead (each chunk still plays at its moment): at 200 ms a short stall here ran
    // the ring dry and the sound cut out every few seconds
    while (f.audio.length && f.audio[0].pts <= disp + 500) {
      const a = f.audio.shift();
      if (a.pts < disp - 40) continue; // its moment has passed
      f.fed.push(a); if (f.fed.length > 30) f.fed.shift();
      this.ameta.push({ film: true, want: c.at + (a.pts - c.pos) - now - outLat, at: now });
      try { this.adec.decode(new EncodedAudioChunk({ type: 'key', timestamp: (this.aTs += 20000), data: a.data })); } catch { this.ameta.pop(); }
    }
  }

  // The first frames of each run (each seek restarts the run) pick the anchor: the earliest
  // arrival + buffer. Later frames sit on that clock; if they keep arriving late (clock drift,
  // a slower path) the anchor slides back so we don't stutter.
  // Film clock -> local clock. `raw` is how late (vs. the film's own timestamps) a frame
  // arrived. The earliest arrival in the last 5 s is the line's best case; frames go on screen
  // at that + the cinema buffer + a margin that grows with the line's jitter. Works across the
  // full and the light rendition (same film timestamps); a seek shows up as a jump and resets.
  _present_at(s) {
    const raw = s.t - s.pts;
    const a = (this.anchor ||= { win: [], jit: 0, last: raw });
    if (Math.abs(raw - a.last) > 1500) { a.win = []; a.jit = 0; }
    a.last = raw;
    a.win.push({ raw, t: s.t });
    while (a.win.length > 1 && s.t - a.win[0].t > 5000) a.win.shift();
    let mn = Infinity; for (const x of a.win) if (x.raw < mn) mn = x.raw;
    a.jit = a.jit * 0.97 + (raw - mn) * 0.03;
    a.base = mn + this.cinemaDelay + Math.min(800, a.jit * 2.5);
    return a.base + s.pts;
  }

  _draw(frame) {
    const w = frame.displayWidth, h = frame.displayHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this._fit(); }
    this.ctx.drawImage(frame, 0, 0, w, h);
    frame.close();
    this.lastDraw = performance.now();
    this.stats.frames++;
    if (!this.gotFirst) { this.gotFirst = true; this.onFirstFrame?.(); }
  }

  _fit() {
    const vw = this.stage.clientWidth, vh = this.stage.clientHeight;
    const s = Math.min(vw / this.canvas.width, vh / this.canvas.height);
    this.canvas.style.width = `${Math.floor(this.canvas.width * s)}px`;
    this.canvas.style.height = `${Math.floor(this.canvas.height * s)}px`;
    this.scale = s;
  }

  _report() {
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const st = this.stats;
    const out = { dec: avg(st.dec), enc: avg(st.enc), net: avg(st.net), disp: this.refreshMs / 2, fps: st.frames * 2, drops: st.drops, codec: this.codecInfo };
    this.stats = { dec: [], enc: [], net: [], frames: 0, drops: 0 };
    this.port.postMessage({ t: 'dec', s: { dec: Math.round(out.dec * 10) / 10, fps: out.fps } });
    this.onStats?.(out);
    // film diagnostics: only when something went wrong (MAJLIS_DEBUG prints renderer warnings)
    if (this.film?.clock) {
      const f = this.fstat, a = this.astat || {};
      const slow = this.codecInfo?.fps && out.fps < this.codecInfo.fps * 0.85;
      if (f.late || f.qdrop || a.fix || a.under || f.clk > 1 || slow) console.warn('[film] ' + JSON.stringify({ t: Math.round(performance.now()), pos: Math.round(this._filmPos(performance.now())), ...f, aFix: a.fix || 0, under: a.under || 0, aBuf: Math.round((a.avail || 0) / 48), slew: Math.round(this.film.slew || 0), drops: out.drops, fps: out.fps }));
      this.fstat = { late: 0, lateKey: 0, qdrop: 0, clk: 0 };
      this.mixer?.port.postMessage({ t: 'astat' });
    }
  }

  // ------------------------------------------------------------------ audio
  async _audio() {
    const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ac = ac;
    await ac.audioWorklet.addModule('worklet.js');
    if (this.destroyed || this.ac !== ac) { try { ac.close(); } catch {} return; }
    this.mixer = new AudioWorkletNode(ac, 'majlis-mixer', { outputChannelCount: [2] });
    this.mixer.connect(ac.destination);
    this.mixer.port.onmessage = (e) => { if (e.data.t === 'astat') this.astat = e.data; };
    this.setVolumes(this.settings.gameVol ?? 1, this.settings.voiceVol ?? 1);
    for (const [k, v] of Object.entries(this.perGains)) {
      this.mixer.port.postMessage({ t: 'gain', g: {}, per: { [`v${k}`]: v } });
    }
    this.mixer.port.postMessage({ t: 'duck', on: this.settings.autoDuck !== false });
    this.mixer.port.postMessage({ t: 'spatial', on: this.settings.spatialVoice !== false });
    this.mixer.port.postMessage({ t: 'target', ms: this._mixTarget() });
    this.adec = new AudioDecoder({ output: (d) => { const meta = this.ameta.shift(); this._pcm('game', d, meta ? this._audioWant(meta) : null); }, error: () => {} });
    this.adec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
    this.aTs = 0;
  }

  setVolumes(game, voice) { this.mixer?.port.postMessage({ t: 'gain', g: { game, voice } }); }

  _pcm(key, d, want) {
    const n = d.numberOfFrames;
    const l = new Float32Array(n); d.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
    let r = l;
    if (d.numberOfChannels > 1) { r = new Float32Array(n); d.copyTo(r, { planeIndex: 1, format: 'f32-planar' }); }
    d.close();
    this.mixer?.port.postMessage({ t: 'pcm', k: key, l, r, want }, [l.buffer, ...(r !== l ? [r.buffer] : [])]);
  }

  // How long this chunk should wait before it's heard (ms), so it lines up with the picture.
  _audioWant(meta) {
    if (meta.film) return meta.want - (performance.now() - meta.at);
    const outLat = (this.ac?.outputLatency || 0) * 1000 + 5 - (this.settings.avOffset || 0);
    if (meta.timed && this.cinema && this.anchor?.base != null) return this.anchor.base + meta.pts - performance.now() - outLat;
    if (this.cinema) return null;
    // game mode: match the picture's delay, but never below what the line's jitter needs
    const floor = Math.min(80, 22 + this.aJit * 2);
    return Math.max(floor, Math.min(120, this.latEw - (meta.age || 0) - outLat));
  }

  _gameAudio(m) {
    if (!this.adec || this.adec.state !== 'configured') return;
    if (this.ac.state === 'suspended') this.ac.resume();
    const t = performance.now();
    if (this.aLast && !m.timed) this.aJit = this.aJit * 0.95 + Math.abs(t - this.aLast - 10) * 0.05;
    this.aLast = t;
    this.ameta.push({ timed: m.timed, epoch: m.epoch, pts: m.pts, age: m.age, at: t });
    if (this.ameta.length > 200) this.ameta.shift();
    try { this.adec.decode(new EncodedAudioChunk({ type: 'key', timestamp: (this.aTs += 10000), data: m.data })); } catch { this.ameta.pop(); }
  }

  setVoiceGain(idx, g) {
    this.perGains[idx] = g;
    this.mixer?.port.postMessage({ t: 'gain', g: {}, per: { [`v${idx}`]: g } });
  }

  _voiceIn(idx, data) {
    this.onSpeak?.(idx);
    let d = this.voiceDec.get(idx);
    if (!d) {
      d = new AudioDecoder({ output: (a) => this._pcm(`v${idx}`, a), error: () => {} });
      d.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      d.ts = 0;
      this.voiceDec.set(idx, d);
    }
    try { d.decode(new EncodedAudioChunk({ type: 'key', timestamp: (d.ts += 20000), data })); } catch {}
  }

  // ------------------------------------------------------------------ cursor
  _shape(m) {
    this.shapes.set(m.id, { url: `data:image/png;base64,${m.png}`, hx: m.hx, hy: m.hy, w: m.w, h: m.h });
    this._drawCursor();
  }

  _drawCursor() {
    const el = this.cursorEl;
    const c = this.hostCursor;
    if (!c.v || this.locked || !this.canvas.width) { el.hidden = true; return; }
    const sh = this.shapes.get(c.s);
    if (!sh) { el.hidden = true; return; }
    if (el.dataset.s !== String(c.s)) { el.src = sh.url; el.dataset.s = String(c.s); el.style.width = `${sh.w}px`; el.style.height = `${sh.h}px`; }
    const r = this.canvas.getBoundingClientRect(), sr = this.stage.getBoundingClientRect();
    // Our own mouse moves are drawn immediately; the host's position wins once it settles.
    const useLocal = performance.now() - this.localCursor.t < 120 && this.mouseMode === 'abs';
    const x = useLocal ? this.localCursor.x : r.left - sr.left + c.x * r.width;
    const y = useLocal ? this.localCursor.y : r.top - sr.top + c.y * r.height;
    el.style.transform = `translate(${Math.round(x - sh.hx)}px, ${Math.round(y - sh.hy)}px)`;
    el.style.left = '0'; el.style.top = '0';
    el.hidden = false;
  }

  // ------------------------------------------------------------------ input
  _bind() {
    const S = this.stage;
    this.buf = []; // pending event bytes
    const flush = () => { if (!this.buf.length) return; const total = this.buf.reduce((a, b) => a + b.length, 0); const out = new Uint8Array(total); let o = 0; for (const b of this.buf) { out.set(b, o); o += b.length; } this.buf = []; this.port.postMessage({ t: 'in', data: out }); };
    this.flush = flush;
    const push = (b) => { this.buf.push(b); if (!this.flushQueued) { this.flushQueued = true; queueMicrotask(() => { this.flushQueued = false; flush(); }); } };
    const dv = (n) => { const b = new Uint8Array(n); return [b, new DataView(b.buffer)]; };
    this.pushKey = (code, down) => { const s = SC[code]; if (!s) return; const [b, v] = dv(5); b[0] = 1; b[1] = down ? 1 : 0; v.setUint16(2, s[0]); b[4] = s[1] ? 1 : 0; push(b); };

    this.h = {
      keydown: (e) => {
        if (this.filterKey?.(e, true) || !this.active || !this.inputEnabled) return;
        e.preventDefault(); this.pushKey(e.code, true);
      },
      keyup: (e) => {
        if (this.filterKey?.(e, false) || !this.active || !this.inputEnabled) return;
        e.preventDefault(); this.pushKey(e.code, false);
      },
      move: (e) => {
        this.onActivity?.();
        if (!this.active || !this.inputEnabled) return;
        if (this.locked) {
          const k = this.settings.mouseSens || 1;
          this.mx = (this.mx || 0) + e.movementX * k; this.my = (this.my || 0) + e.movementY * k;
          const ix = Math.trunc(this.mx), iy = Math.trunc(this.my); this.mx -= ix; this.my -= iy; // keep the fractions
          const [b, v] = dv(5); b[0] = 2; v.setInt16(1, Math.max(-32767, Math.min(32767, ix))); v.setInt16(3, Math.max(-32767, Math.min(32767, iy))); push(b);
          return;
        }
        const r = this.canvas.getBoundingClientRect(), sr = this.stage.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
        this.localCursor = { x: e.clientX - sr.left, y: e.clientY - sr.top, t: performance.now() };
        this._drawCursor();
        if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
        const [b, v] = dv(5); b[0] = 3; v.setUint16(1, Math.round(nx * 65535)); v.setUint16(3, Math.round(ny * 65535)); push(b);
      },
      down: (e) => {
        if (!this.active || !this.inputEnabled || e.target.closest('.drawer, .wbar, .chatbox')) return;
        if (this.mouseMode === 'rel' && !this.locked) { this.canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => this.canvas.requestPointerLock()); return; }
        e.preventDefault(); const b = new Uint8Array([4, e.button, 1]); push(b);
      },
      up: (e) => { if (!this.active || !this.inputEnabled || e.target.closest('.drawer, .wbar, .chatbox')) return; e.preventDefault(); push(new Uint8Array([4, e.button, 0])); },
      wheel: (e) => {
        if (!this.active || !this.inputEnabled || e.target.closest('.drawer, .wbar, .chatbox')) return;
        e.preventDefault();
        const [b, v] = dv(5); b[0] = 5; v.setInt16(1, Math.round(-e.deltaY * 1.2)); v.setInt16(3, Math.round(e.deltaX * 1.2)); push(b);
      },
      ctx: (e) => { if (!e.target.closest('.drawer')) e.preventDefault(); },
      lock: () => { this.locked = document.pointerLockElement === this.canvas; this.stage.classList.toggle('locked', !!this.locked); this._drawCursor(); },
      resize: () => { if (this.canvas.width) this._fit(); },
      blur: () => this.releaseAll(),
    };
    window.addEventListener('keydown', this.h.keydown, true);
    window.addEventListener('keyup', this.h.keyup, true);
    S.addEventListener('pointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', this.h.move);
    S.addEventListener('mousedown', this.h.down);
    S.addEventListener('mouseup', this.h.up);
    S.addEventListener('wheel', this.h.wheel, { passive: false });
    S.addEventListener('contextmenu', this.h.ctx);
    document.addEventListener('pointerlockchange', this.h.lock);
    window.addEventListener('resize', this.h.resize);
    window.addEventListener('blur', this.h.blur);
  }

  setMouseMode(mode) { this.mouseMode = mode; if (mode === 'abs' && this.locked) document.exitPointerLock(); }

  releaseAll() {
    // tell the host every key is up so nothing stays held when we alt-tab away
    for (const code of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) this.pushKey(code, false);
    for (let b = 0; b < 5; b++) this.buf.push(new Uint8Array([4, b, 0]));
    this.flush();
  }

  // ------------------------------------------------------------------ gamepads
  padType() {
    const p = [...navigator.getGamepads()].find(Boolean);
    return p && /054c/i.test(p.id) ? 'ds4' : 'x360';
  }

  _pollPads() {
    if (!this.active || !this.inputEnabled) return;
    const pads = navigator.getGamepads();
    const p = [...pads].find((x) => x && x.connected);
    if (!p) {
      if (this._hadPad) {
        this._hadPad = false;
        this.lastPad = null;
        this.onPadState?.(null);
      }
      return;
    }
    let bits = 0;
    p.buttons.forEach((b, i) => { if (b.pressed && i < 32) bits |= 1 << i; });
    if (this.settings.padSwapAB) { const sw = (a, c) => { const x = (bits >> a) & 1, y = (bits >> c) & 1; bits = (bits & ~((1 << a) | (1 << c))) | (y << a) | (x << c); }; sw(0, 1); sw(2, 3); }
    const dz = this.settings.padDeadzone ?? 0.08;
    // radial dead zone, rescaled so the stick still reaches full range
    const ax = (v) => { const a = Math.abs(v); const r = a < dz ? 0 : Math.sign(v) * (a - dz) / (1 - dz); return Math.max(-32767, Math.min(32767, Math.round(r * 32767))); };
    const lt = Math.round((p.buttons[6]?.value || 0) * 255), rt = Math.round((p.buttons[7]?.value || 0) * 255);
    const st = [bits >>> 0, ax(p.axes[0] || 0), ax(p.axes[1] || 0), ax(p.axes[2] || 0), ax(p.axes[3] || 0), lt, rt];
    const key = st.join(',');
    const now = performance.now();
    if (key === this.lastPad && now - this.lastPadT < 100) return;
    this._hadPad = true;
    this.lastPad = key; this.lastPadT = now; this.pad = p;
    this.onPadState?.({ bits: st[0], lx: st[1] / 32767, ly: st[2] / 32767, rx: st[3] / 32767, ry: st[4] / 32767, lt: lt / 255, rt: rt / 255 });
    const b = new Uint8Array(16), v = new DataView(b.buffer);
    b[0] = 6; b[1] = 0; v.setUint32(2, st[0]); v.setInt16(6, st[1]); v.setInt16(8, st[2]); v.setInt16(10, st[3]); v.setInt16(12, st[4]); b[14] = lt; b[15] = rt;
    this.port.postMessage({ t: 'in', data: b });
  }

  _rumble(large, small) {
    const p = this.pad || [...navigator.getGamepads()].find(Boolean);
    const a = p?.vibrationActuator;
    if (!a) return;
    if (!large && !small) { a.reset?.(); return; }
    a.playEffect('dual-rumble', { duration: 600, strongMagnitude: large / 255, weakMagnitude: small / 255 }).catch(() => {});
  }

  // DualSense over WebHID: gyro, accelerometer and touchpad, which the Gamepad API hides.
  async enableGyro() {
    if (!navigator.hid) return false;
    const [dev] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x054c }] });
    if (!dev) return false;
    if (!dev.opened) await dev.open();
    this.hid = dev;
    let last = 0;
    dev.addEventListener('inputreport', (e) => {
      const d = e.data; const off = e.reportId === 0x31 ? 1 : 0;
      if (e.reportId !== 0x01 && e.reportId !== 0x31) return;
      if (d.byteLength < 40 + off) return;
      const now = performance.now();
      if (now - last < 4) return;
      last = now;
      const b = new Uint8Array(24), v = new DataView(b.buffer);
      b[0] = 7; b[1] = 0;
      for (let i = 0; i < 6; i++) v.setInt16(2 + i * 2, d.getInt16(15 + off + i * 2, true));
      for (let f = 0; f < 2; f++) {
        const o = 32 + off + f * 4;
        const on = (d.getUint8(o) & 0x80) === 0;
        const x = d.getUint8(o + 1) | ((d.getUint8(o + 2) & 0x0f) << 8);
        const y = (d.getUint8(o + 2) >> 4) | (d.getUint8(o + 3) << 4);
        b[14 + f * 5] = on ? 1 : 0; v.setUint16(15 + f * 5, Math.round(x * 1920 / 1919)); v.setUint16(17 + f * 5, Math.round(y * 943 / 1079));
      }
      this.port.postMessage({ t: 'in', data: b });
    });
    return true;
  }

  // ------------------------------------------------------------------ voice out
  async startMic(onPacket) {
    if (this.destroyed || this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (this.destroyed) { stream.getTracks().forEach((t) => t.stop()); return; }
    const track = stream.getAudioTracks()[0];
    const enc = new AudioEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); onPacket(b); }, error: () => {} });
    enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000 } });
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    const mic = { stream, enc, reader, open: false, gate: false, lastSpeechAt: 0 };
    this.mic = mic;
    const speechActive = (audioData) => {
      if (!mic.gate) return true;
      const n = audioData.numberOfFrames || 0;
      if (n <= 0) return false;
      try {
        const pcm = new Float32Array(n);
        audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
        const rms = Math.sqrt(sum / Math.max(1, Math.ceil(pcm.length / 4)));
        const nowTs = performance.now();
        if (rms > 0.015) mic.lastSpeechAt = nowTs;
        return nowTs - mic.lastSpeechAt < 350;
      } catch {
        return true;
      }
    };
    (async () => {
      while (!this.destroyed && this.mic) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!this.destroyed && this.mic?.open && enc.state === 'configured' && speechActive(value)) enc.encode(value);
        value.close();
      }
    })();
  }
  setMicOpen(on, gate) { if (!this.destroyed && this.mic) { this.mic.open = !!on; if (gate !== undefined) this.mic.gate = !!gate; } }
  stopMic() { if (!this.mic) return; this.mic.stream.getTracks().forEach((t) => t.stop()); try { this.mic.reader?.cancel().catch(() => {}); } catch {} try { this.mic.enc.close(); } catch {} this.mic = null; }

  screenshot() { return this.canvas.width ? this.canvas.toDataURL('image/png') : null; }

  destroy() {
    this.destroyed = true;
    this.onPadState?.(null);
    this.setCinema(false);
    this.active = false;
    this.releaseAll();
    clearInterval(this.statsTimer); clearInterval(this.padTimer);
    window.removeEventListener('keydown', this.h.keydown, true);
    window.removeEventListener('keyup', this.h.keyup, true);
    const S = this.stage;
    S.removeEventListener('pointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove', this.h.move);
    S.removeEventListener('mousedown', this.h.down); S.removeEventListener('mouseup', this.h.up);
    S.removeEventListener('wheel', this.h.wheel); S.removeEventListener('contextmenu', this.h.ctx);
    document.removeEventListener('pointerlockchange', this.h.lock);
    window.removeEventListener('resize', this.h.resize); window.removeEventListener('blur', this.h.blur);
    if (document.pointerLockElement) document.exitPointerLock();
    try { this.mixer?.disconnect(); } catch {}
    try { this.dec?.close(); this.adec?.close(); this.ac?.close(); } catch {}
    this.mixer = null; this.dec = null; this.adec = null; this.ac = null;
    for (const d of this.voiceDec.values()) try { d.close(); } catch {}
    this.voiceDec.clear();
    this.stopMic();
    try { this.hid?.close(); } catch {}
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export class VoiceHub {
  constructor({ port, settings, onSpeak }) {
    this.port = port; this.settings = settings; this.onSpeak = onSpeak;
    this.dec = new Map();
    this.destroyed = false;
    this.ready = (async () => {
      const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.ac = ac;
      await ac.audioWorklet.addModule('worklet.js');
      if (this.destroyed || this.ac !== ac) { try { ac.close(); } catch {} return; }
      this.mixer = new AudioWorkletNode(ac, 'majlis-mixer', { outputChannelCount: [2] });
      this.mixer.connect(ac.destination);
      this.mixer.port.postMessage({ t: 'gain', g: { game: 1, voice: settings.voiceVol ?? 1 } });
    })();
  }

  play(idx, data) {
    if (this.destroyed) return;
    this.onSpeak?.(idx);
    let d = this.dec.get(idx);
    if (!d) {
      d = new AudioDecoder({ output: (a) => this._pcm(`v${idx}`, a), error: () => {} });
      d.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      d.ts = 0; this.dec.set(idx, d);
    }
    if (this.ac?.state === 'suspended') this.ac.resume();
    try { d.decode(new EncodedAudioChunk({ type: 'key', timestamp: (d.ts += 20000), data })); } catch {}
  }

  _pcm(key, d) {
    if (this.destroyed) { d.close(); return; }
    const l = new Float32Array(d.numberOfFrames); d.copyTo(l, { planeIndex: 0, format: 'f32-planar' }); d.close();
    this.mixer?.port.postMessage({ t: 'pcm', k: key, l, r: l }, [l.buffer]);
  }

  setGain(idx, g) { if (!this.destroyed) this.mixer?.port.postMessage({ t: 'gain', g: {}, per: { [`v${idx}`]: g } }); }

  async startMic(onPacket) {
    if (this.destroyed || this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (this.destroyed) { stream.getTracks().forEach((t) => t.stop()); return; }
    const enc = new AudioEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); onPacket(b); }, error: () => {} });
    enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000 } });
    const reader = new MediaStreamTrackProcessor({ track: stream.getAudioTracks()[0] }).readable.getReader();
    const mic = { stream, enc, reader, open: false, gate: false, lastSpeechAt: 0 };
    this.mic = mic;
    const speechActive = (audioData) => {
      if (!mic.gate) return true;
      const n = audioData.numberOfFrames || 0;
      if (n <= 0) return false;
      try {
        const pcm = new Float32Array(n);
        audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
        const rms = Math.sqrt(sum / Math.max(1, Math.ceil(pcm.length / 4)));
        const nowTs = performance.now();
        if (rms > 0.015) mic.lastSpeechAt = nowTs;
        return nowTs - mic.lastSpeechAt < 350;
      } catch {
        return true;
      }
    };
    (async () => {
      while (!this.destroyed && this.mic) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!this.destroyed && this.mic?.open && enc.state === 'configured' && speechActive(value)) enc.encode(value);
        value.close();
      }
    })();
  }
  setMicOpen(on, gate) { if (!this.destroyed && this.mic) { this.mic.open = !!on; if (gate !== undefined) this.mic.gate = !!gate; } }

  destroy() {
    this.destroyed = true;
    if (this.mic) { this.mic.stream.getTracks().forEach((t) => t.stop()); try { this.mic.reader?.cancel().catch(() => {}); } catch {} try { this.mic.enc.close(); } catch {} this.mic = null; }
    for (const d of this.dec.values()) try { d.close(); } catch {}
    this.dec.clear();
    try { this.mixer?.disconnect(); } catch {}
    try { this.ac?.close(); } catch {}
    this.mixer = null; this.ac = null;
  }
}
