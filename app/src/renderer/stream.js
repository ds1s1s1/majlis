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
  constructor({ port, canvas, cursorEl, stage, onStats, onFirstFrame, settings }) {
    this.port = port; this.canvas = canvas; this.cursorEl = cursorEl; this.stage = stage;
    this.onStats = onStats; this.onFirstFrame = onFirstFrame; this.settings = settings;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dec = null; this.configs = new Map(); this.epoch = -1; this.waitKey = true;
    this.submit = new Map(); this.stats = { dec: [], enc: [], net: [], frames: 0, drops: 0 };
    this.shapes = new Map();
    this.localCursor = { x: 0, y: 0, t: 0 };
    this.hostCursor = { x: 0.5, y: 0.5, v: false, s: 0 };
    this.voiceDec = new Map();
    this.active = true;
    this.refreshMs = 1000 / 60;
    this.mouseMode = 'abs';
    this.cinema = false; this.cinemaDelay = 180; this.queue = [];
    this.anchor = null;            // watch mode: local time = anchor.base + media pts
    this.latEw = 40; this.aJit = 0; this.aLast = 0;
    this.ameta = [];               // per audio chunk: timing info, consumed in decode order
    this.inputEnabled = true;
    this._bind();
    this._audio();
    this.statsTimer = setInterval(() => this._report(), 500);
    this.padTimer = setInterval(() => this._pollPads(), 4);
    measureHz().then((hz) => { this.refreshMs = 1000 / (hz || 60); });
  }

  // ------------------------------------------------------------------ video
  onMessage(m) {
    switch (m.t) {
      case 'config': this.configs.set(m.epoch, m); break;
      case 'v': this._video(m); break;
      case 'a': this._gameAudio(m); break;
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
      error: () => { this.waitKey = true; this.epoch = -1; this.port.postMessage({ t: 'needkey' }); },
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
    this.mixer?.port.postMessage({ t: 'target', ms: on ? delayMs : 30 });
    if (on && !this.rafOn) { this.rafOn = true; const loop = () => { if (!this.rafOn) return; this._present(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
    if (!on) { this.rafOn = false; for (const q of this.queue) q.frame.close(); this.queue = []; }
  }

  _present() {
    const now = performance.now();
    let pick = null;
    while (this.queue.length && this.queue[0].at <= now) { if (pick) pick.frame.close(); pick = this.queue.shift(); }
    if (this.queue.length > 30) { while (this.queue.length > 2) this.queue.shift().frame.close(); }
    if (pick) this._draw(pick.frame);
  }

  _output(frame) {
    const s = this.submit.get(frame.timestamp);
    if (s) { this.submit.delete(frame.timestamp); this.stats.dec.push(performance.now() - s.t); this.stats.enc.push(s.enc); this.stats.net.push(s.net); }
    if (this.cinema) {
      const at = s && s.pts != null ? this._present_at(s) : performance.now() + this.cinemaDelay;
      this.queue.push({ frame, at });
      return;
    }
    if (s) this.latEw = this.latEw * 0.9 + ((s.net || 0) + (performance.now() - s.t) + this.refreshMs / 2) * 0.1;
    this._draw(frame);
  }

  // The first frames of each run (each seek restarts the run) pick the anchor: the earliest
  // arrival + buffer. Later frames sit on that clock; if they keep arriving late (clock drift,
  // a slower path) the anchor slides back so we don't stutter.
  _present_at(s) {
    const cand = s.t + this.cinemaDelay - s.pts;
    const a = this.anchor;
    if (!a || a.epoch !== s.epoch) { this.anchor = { epoch: s.epoch, base: cand, lateSince: 0 }; return cand + s.pts; }
    if (cand < a.base) a.base = cand;
    else if (cand > a.base + 60) { a.lateSince ||= s.t; if (s.t - a.lateSince > 1500) { a.base = cand; a.lateSince = 0; } }
    else a.lateSince = 0;
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
  }

  // ------------------------------------------------------------------ audio
  async _audio() {
    this.ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.ac.audioWorklet.addModule('worklet.js');
    this.mixer = new AudioWorkletNode(this.ac, 'majlis-mixer', { outputChannelCount: [2] });
    this.mixer.connect(this.ac.destination);
    this.setVolumes(this.settings.gameVol ?? 1, this.settings.voiceVol ?? 1);
    this.mixer.port.postMessage({ t: 'duck', on: this.settings.autoDuck !== false });
    if (this.cinema) this.mixer.port.postMessage({ t: 'target', ms: this.cinemaDelay });
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
    const outLat = (this.ac?.outputLatency || 0) * 1000 + 5 - (this.settings.avOffset || 0);
    if (meta.timed && this.cinema && this.anchor && this.anchor.epoch === meta.epoch) return this.anchor.base + meta.pts - performance.now() - outLat;
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

  setVoiceGain(idx, g) { this.mixer?.port.postMessage({ t: 'gain', g: {}, per: { [`v${idx}`]: g } }); }

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
    if (!p) return;
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
    this.lastPad = key; this.lastPadT = now; this.pad = p;
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
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const track = stream.getAudioTracks()[0];
    const enc = new AudioEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); onPacket(b); }, error: () => {} });
    enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000 } });
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    this.mic = { stream, enc, reader, open: false };
    (async () => {
      while (this.mic) {
        const { value, done } = await reader.read();
        if (done) break;
        if (this.mic.open && enc.state === 'configured') enc.encode(value);
        value.close();
      }
    })();
  }
  setMicOpen(on) { if (this.mic) this.mic.open = !!on; }
  stopMic() { if (!this.mic) return; this.mic.stream.getTracks().forEach((t) => t.stop()); try { this.mic.enc.close(); } catch {} this.mic = null; }

  screenshot() { return this.canvas.width ? this.canvas.toDataURL('image/png') : null; }

  destroy() {
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
    try { this.dec?.close(); this.adec?.close(); this.ac?.close(); } catch {}
    for (const d of this.voiceDec.values()) try { d.close(); } catch {}
    this.stopMic();
    try { this.hid?.close(); } catch {}
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export class VoiceHub {
  constructor({ port, settings, onSpeak }) {
    this.port = port; this.settings = settings; this.onSpeak = onSpeak;
    this.dec = new Map();
    this.ready = (async () => {
      this.ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.ac.audioWorklet.addModule('worklet.js');
      this.mixer = new AudioWorkletNode(this.ac, 'majlis-mixer', { outputChannelCount: [2] });
      this.mixer.connect(this.ac.destination);
      this.mixer.port.postMessage({ t: 'gain', g: { game: 1, voice: settings.voiceVol ?? 1 } });
    })();
  }

  play(idx, data) {
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
    const l = new Float32Array(d.numberOfFrames); d.copyTo(l, { planeIndex: 0, format: 'f32-planar' }); d.close();
    this.mixer?.port.postMessage({ t: 'pcm', k: key, l, r: l }, [l.buffer]);
  }

  setGain(idx, g) { this.mixer?.port.postMessage({ t: 'gain', g: {}, per: { [`v${idx}`]: g } }); }

  async startMic(onPacket) {
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const enc = new AudioEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); onPacket(b); }, error: () => {} });
    enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000 } });
    const reader = new MediaStreamTrackProcessor({ track: stream.getAudioTracks()[0] }).readable.getReader();
    this.mic = { stream, enc, open: false };
    (async () => {
      while (this.mic) {
        const { value, done } = await reader.read();
        if (done) break;
        if (this.mic?.open && enc.state === 'configured') enc.encode(value);
        value.close();
      }
    })();
  }
  setMicOpen(on) { if (this.mic) this.mic.open = !!on; }

  destroy() {
    if (this.mic) { this.mic.stream.getTracks().forEach((t) => t.stop()); try { this.mic.enc.close(); } catch {} this.mic = null; }
    for (const d of this.dec.values()) try { d.close(); } catch {}
    try { this.ac?.close(); } catch {}
  }
}
