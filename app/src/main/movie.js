'use strict';
// Watch-party source: encodes a video file with ffmpeg and hands out frames + Opus audio, the
// same way the game encoder does. Picture comes straight from the file, never from the screen,
// so it's sharper and nothing on the host's desktop leaks in.
//
// A film isn't live, so it doesn't have to travel like live video: it's encoded and sent a few
// seconds ahead of a shared film clock, every viewer buffers it and shows each frame when the
// clock gets there. Seeks and new settings restart ffmpeg at the new spot; pause only stops
// the clock (ffmpeg just waits).

const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { EncoderProc } = require('./encoder');

const VIDEO_EXT = /\.(mkv|mp4|m4v|mov|avi|webm|ts|m2ts|wmv|flv)$/i;
const SUB_EXT = /\.(srt|ass|ssa|vtt)$/i;
const AR = /^(ar|ara|arb|arabic)$/i;

function ffprobePath(ffmpeg) {
  if (ffmpeg && ffmpeg !== 'ffmpeg') { const p = path.join(path.dirname(ffmpeg), 'ffprobe.exe'); if (fs.existsSync(p)) return p; }
  return 'ffprobe';
}

function probe(ffmpeg, file) {
  return new Promise((res) => {
    execFile(ffprobePath(ffmpeg), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true, maxBuffer: 8 << 20, timeout: 15000 }, (e, out) => {
      if (e) return res(null);
      let j; try { j = JSON.parse(out); } catch { return res(null); }
      const streams = j.streams || [];
      const lang = (s) => s.tags?.language || 'und';
      const title = (s) => s.tags?.title || '';
      const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
      const audio = streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({ i, lang: lang(s), title: title(s), codec: s.codec_name, ch: s.channels, def: !!s.disposition?.default }));
      const subs = streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => ({ i, lang: lang(s), title: title(s), codec: s.codec_name, text: !/pgs|dvd|dvb|hdmv/i.test(s.codec_name || '') }));
      // external subtitles next to the file: movie.srt, movie.ar.srt ...
      const dir = path.dirname(file), base = path.basename(file).replace(/\.[^.]+$/, '');
      let ext = [];
      try { ext = fs.readdirSync(dir).filter((f) => SUB_EXT.test(f) && f.startsWith(base)).map((f) => ({ file: path.join(dir, f), lang: (f.slice(base.length).match(/\.([a-z]{2,3})\./i) || [])[1] || 'und', title: f })); } catch {}
      const fr = v?.avg_frame_rate || v?.r_frame_rate || '24/1';
      const [n, d] = fr.split('/').map(Number);
      res({
        file, name: base, duration: +j.format?.duration || 0,
        video: v ? { codec: v.codec_name, w: v.width, h: v.height, fps: d ? n / d : 24, hdr: /smpte2084|arib-std-b67/.test(v.color_transfer || '') } : null,
        audio, subs, extSubs: ext,
      });
    });
  });
}

// Arabic first, then default, then the first one.
// Last keyframe at or before t. Seeking exactly there means ffmpeg has no pre-roll to sit
// through in real time (-re), and audio starts at the same instant as the picture.
function keyframeBefore(ffmpeg, file, t) {
  return new Promise((res) => {
    const from = Math.max(0, t - 15);
    execFile(ffprobePath(ffmpeg), ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${from.toFixed(2)}%${(t + 0.05).toFixed(2)}`, '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file], { windowsHide: true, timeout: 8000, maxBuffer: 8 << 20 }, (e, out) => {
      if (e) return res(t);
      let best = null;
      for (const line of String(out).split(/\r?\n/)) {
        const [pts, flags] = line.split(',');
        const v = parseFloat(pts);
        if (flags && flags.includes('K') && v <= t + 0.01 && (best === null || v > best)) best = v;
      }
      res(best ?? from);
    });
  });
}

function pickAudio(info) {
  return (info.audio.find((a) => AR.test(a.lang)) || info.audio.find((a) => a.def) || info.audio[0] || null)?.i ?? null;
}
function pickSub(info) {
  const ext = info.extSubs.find((s) => AR.test(s.lang));
  if (ext) return { file: ext.file };
  const emb = info.subs.find((s) => AR.test(s.lang) && s.text);
  if (emb) return { i: emb.i };
  return null;
}

function nextInFolder(file) {
  try {
    const dir = path.dirname(file);
    const list = fs.readdirSync(dir).filter((f) => VIDEO_EXT.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const i = list.indexOf(path.basename(file));
    return i >= 0 && i < list.length - 1 ? path.join(dir, list[i + 1]) : null;
  } catch { return null; }
}

// libavfilter wants ':' and '\' escaped inside filter arguments
function filterPath(p) {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")}'`;
}

// How far ahead of the picture each rendition is encoded and sent. Everyone keeps that much of
// the film in hand, so a slow patch on the line eats into the buffer instead of freezing the
// picture. The light film gets more: it's the one riding the weak lines.
const LEAD = { high: 6000, low: 10000 };
const PREROLL = 300;         // ms from 'everyone has enough buffered' to the film starting
const RESUME_PREROLL = 450;  // after a pause: everything is already buffered, just let the clock reach everyone

class Movie extends EventEmitter {
  constructor(ffmpeg) {
    super();
    this.ffmpeg = ffmpeg;
    this.info = null; this.proc = null;
    this.state = { playing: false, pos: 0, dur: 0, title: '', audio: null, sub: null, night: false };
    this.epoch = 0; this.frameId = 0;
    this.audioSock = null; this.aSeq = 0;
    // The film clock everyone plays to: film position `pos` (ms) is on screen at host time `at`.
    // A new run (start, seek, new settings) means everything buffered before it is stale.
    this.clock = { pos: 0, at: 0, playing: false, run: 0 };
    this.hist = { high: [], low: [] }; this.ahist = [];
    this.configs = new Map();
    this.gateTimer = setInterval(() => this._gateTick(), 100);
  }

  async open(file, { pos = 0, enc, kbps = 12000, maxW = 1920, night = false } = {}) {
    const info = await probe(this.ffmpeg, file);
    if (!info || !info.video) throw new Error('unreadable');
    this.stop(true);
    this.info = info; this.enc = enc; this.kbps = kbps; this.maxW = maxW;
    this.state = { playing: false, pos: Math.max(0, Math.min(pos, Math.max(0, info.duration - 5))), dur: info.duration, title: info.name, file, audio: pickAudio(info), sub: pickSub(info), night, subSize: this.subSize || 'normal', subDelay: 0 };
    this.clock = { ...this.clock, pos: Math.round(this.state.pos * 1000), at: 0, playing: false };
    this.emit('state', this.publicState());
    return this.publicState();
  }

  // ---- the film clock
  curMs() {
    const c = this.clock;
    return c.playing && c.at ? c.pos + Math.max(0, Date.now() - c.at) : c.pos;
  }
  // host time at which film position `pts` should be on screen (Infinity while stopped)
  dueOf(pts) { const c = this.clock; return c.playing && c.at ? c.at + (pts - c.pos) : Infinity; }
  clockMsg() { const c = this.clock; return { pos: Math.round(c.pos), at: c.at, playing: !!(c.playing && c.at), run: c.run }; }
  _setClock(patch) {
    Object.assign(this.clock, patch);
    this.state.pos = this.curMs() / 1000;
    this.emit('clock', this.clockMsg());
  }

  publicState() {
    const i = this.info;
    if (i) this.state.pos = this.curMs() / 1000;
    return {
      ...this.state,
      tracks: i ? {
        audio: i.audio.map((a) => ({ i: a.i, lang: a.lang, title: a.title, ch: a.ch })),
        subs: [...i.subs.filter((s) => s.text).map((s) => ({ key: `i${s.i}`, lang: s.lang, title: s.title })), ...i.extSubs.map((s) => ({ key: `f${s.file}`, lang: s.lang, title: s.title }))],
        video: i.video,
      } : null,
      next: this.state.file ? path.basename(nextInFolder(this.state.file) || '') || null : null,
    };
  }

  async _audioPort() {
    if (this.audioSock) return this.audioSock.address().port;
    // the film is encoded ahead in bursts, so give the socket room for a few seconds of audio
    const s = dgram.createSocket({ type: 'udp4', recvBufferSize: 4 << 20 });
    s.on('message', (b) => {
      // RTP: 12-byte header (+ CSRCs + extension), payload = one Opus packet
      if (b.length < 13 || (b[0] >> 6) !== 2 || !this.proc) return;
      let o = 12 + (b[0] & 0x0f) * 4;
      if (b[0] & 0x10) o += 4 + b.readUInt16BE(o + 2) * 4;
      // RTP timestamp (48 kHz) relative to this process's first packet = position in the film
      const ts = b.readUInt32BE(4);
      if (this.rtpBase == null) this.rtpBase = ts;
      const pts = Math.round((this.startPos || 0) * 1000 + ((ts - this.rtpBase) >>> 0) / 48);
      // ffmpeg's audio side isn't held back by our backpressure as tightly as the picture (it
      // ran up to 8 s ahead), so it waits here until it's no further ahead than the picture
      (this.apend ||= []).push({ data: Buffer.from(b.subarray(o)), pts, epoch: this.audioEpoch ?? this.epoch });
      this._audioOut();
    });
    await new Promise((r) => s.bind(0, '127.0.0.1', r));
    this.audioSock = s;
    return s.address().port;
  }

  _args(aport, ov = {}) {
    const st = this.state, i = this.info;
    const kbps = ov.kbps ?? this.kbps, maxW = ov.maxW ?? this.maxW;
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    // Seek to the keyframe before the target (play() looks it up), so audio and picture start
    // at the same instant. A hair past it because -ss counts from the file's start time.
    // Timestamps restart at 0 after -ss, so subtitles get shifted back onto the film's clock.
    // No -re: ffmpeg runs ahead and we hold it back by not reading its output (see _gate).
    const pos = ov.pos ?? st.pos;
    const ss = pos > 0.5 ? pos + 0.08 : 0;
    if (!ov.low) this.startPos = ss;
    if (ss) a.push('-ss', ss.toFixed(3));
    a.push('-i', st.file);
    const vf = [];
    // Arabic-friendly font at a readable size; libass needs the commas inside quotes
    const fs = { small: 18, normal: 24, large: 32 }[st.subSize] || 24;
    const style = `:force_style='FontName=Segoe UI,FontSize=${fs},Outline=1.4,Shadow=0.6,MarginV=28'`;
    const subs = st.sub?.file ? `subtitles=${filterPath(st.sub.file)}${style}` : st.sub && st.sub.i != null ? `subtitles=${filterPath(st.file)}:si=${st.sub.i}${style}` : null;
    // shift the clock the subtitle filter sees: seek offset, minus the user's subtitle delay
    const shift = ss - (st.subDelay || 0);
    if (subs) vf.push(...(Math.abs(shift) > 0.001 ? [`setpts=PTS+(${shift.toFixed(3)})/TB`, subs, 'setpts=PTS-STARTPTS'] : [subs]));
    if (i.video.w > maxW) vf.push(`scale=${maxW}:-2:flags=bicubic`);
    if (i.video.hdr) vf.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv');
    vf.push('format=nv12');
    const kb = Math.round(kbps), fps = Math.round(i.video.fps) || 24;
    a.push('-map', '0:v:0', '-vf', vf.join(','), '-c:v', this.enc.name);
    // keyframes every 3 s and a 1 s VBV: smaller, rarer spikes that don't look like congestion
    // The full film aims at a quality and may peak; the light one rides weak lines, so it keeps
    // to its bitrate (its real rate is what the line has to carry).
    // (and a keyframe every 2 s, so a frame lost on a weak line costs less)
    if (this.enc.fam === 'nvenc' && ov.low) a.push('-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.15)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2), '-forced-idr', '1', '-spatial-aq', '1');
    else if (this.enc.fam === 'nvenc') a.push('-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '22', '-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.3)}k`, '-bufsize', `${kb}k`, '-bf', '0', '-g', String(fps * 3), '-forced-idr', '1', '-spatial-aq', '1');
    else if (this.enc.fam === 'sw') a.push('-preset', 'veryfast', '-tune', 'film', '-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.4)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2));
    else a.push('-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.4)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2));
    // a replacement light film lines up a keyframe exactly where the one it replaces stopped
    if (ov.keyAt > 0.05) a.push('-force_key_frames', ov.keyAt.toFixed(3));
    a.push('-an', '-flush_packets', '1', '-f', 'flv', 'pipe:1');
    if (st.audio != null && aport) {
      // night mode: lift dialogue, tame explosions
      const af = st.night ? 'dynaudnorm=f=200:g=11:p=0.9:m=8,acompressor=threshold=-20dB:ratio=4:attack=5:release=120' : 'anull';
      a.push('-map', `0:a:${st.audio}`, '-af', af, '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '128k', '-frame_duration', '20', '-application', 'audio', '-vn', '-f', 'rtp', `rtp://127.0.0.1:${aport}?pkt_size=1400`);
    }
    return a;
  }

  async play() {
    if (!this.info || this.state.playing || this.starting) return;
    // paused with the encoders still alive (and everyone's buffers full): carry on, no restart
    if (this.proc) {
      this.state.playing = true;
      this._setClock({ at: Date.now() + RESUME_PREROLL, playing: true });
      this.emit('state', this.publicState());
      return;
    }
    this.starting = true;
    try {
      // a new run: whatever anyone buffered before this is stale
      this.hist = { high: [], low: [] }; this.ahist = []; this.apend = []; this.eof = null; this.hiLast = 0; this.firstPts = null;
      this._setClock({ pos: Math.round(this.state.pos * 1000), at: 0, playing: true, run: this.clock.run + 1 });
      const aport = await this._audioPort();
      if (this.state.pos > 0.5) this.state.pos = await keyframeBefore(this.ffmpeg, this.state.file, this.state.pos);
      if (!this.info || !this.clock.playing) return; // stopped while we were getting ready
      const opts = { enc: { ...this.enc, codec: this.enc.codec }, args: this._args(aport) };
      const p = new EncoderProc(this.ffmpeg, opts);
      this.proc = p;
      this.rtpBase = null;
      this.audioEpoch = (this.epoch + 1) & 0x7f; // the config this process announces will carry this epoch
      p.on('spawn', (pid) => this.emit('spawn', pid));
      this.state.playing = true;
      p.on('config', (c) => {
        if (p !== this.proc) return;
        this.epoch = (this.epoch + 1) & 0x7f;
        this.config = { ...c, epoch: this.epoch, fps: Math.round(this.info.video.fps), encoder: this.enc.name, kbps: this.kbps, rendition: 'high' };
        this.configs.set(this.epoch, this.config);
        this.emit('config', this.config);
      });
      p.on('frame', (f) => {
        if (p !== this.proc) return;
        const pts = Math.round(((this.startPos || 0) + f.ts / 1000) * 1000);
        // first picture is ready; the host starts the clock once everyone has some of it in hand
        if (!this.clock.at && this.clock.playing && this.firstPts == null) { this.firstPts = pts; this.firstAt = Date.now(); this.emit('ready', pts); }
        this.hiLast = pts;
        const fr = { ...f, pts, epoch: this.epoch, rendition: 'high', id: this.frameId = (this.frameId + 1) >>> 0 };
        this.hist.high.push(fr);
        this.emit('frame', fr);
        this._gate(p, pts, LEAD.high);
      });
      if (this.lowWanted) this._startLow();
      p.on('exit', ({ code, err }) => {
        if (p !== this.proc) return;
        this.proc = null;
        // the file ran out: the film ends when the picture gets there, not when ffmpeg does
        if (code === 0 || (this.state.dur && this.hiLast > this.state.dur * 1000 - 4000)) { this.eof = this.hiLast; return; }
        this.state.playing = false;
        this._setClock({ pos: this.curMs(), at: 0, playing: false });
        if (code) this.emit('error', err);
        this.emit('state', this.publicState());
      });
      this.emit('state', this.publicState());
    } finally { this.starting = false; }
  }

  // Start the film clock (first run of a play/seek): film position firstPts is on screen
  // `delay` ms from now.
  startClock(delay = PREROLL) {
    if (!this.clock.playing || this.clock.at || this.firstPts == null) return false;
    this._setClock({ pos: this.firstPts, at: Date.now() + delay });
    return true;
  }

  _audioOut() {
    const q = this.apend; if (!q?.length) return;
    const lim = Math.min(this.curMs() + LEAD.high, this.hiLast || Infinity);
    let n = 0;
    while (n < q.length && q[n].pts <= lim) n++;
    if (!n) return;
    for (const a of q.splice(0, n)) { this.ahist.push(a); this.emit('audio', a); }
  }

  // Encoders run ahead of the picture by up to `lead` ms; past that we stop reading their output
  // and ffmpeg blocks, so it never encodes the whole film into memory.
  _gate(p, pts, lead) { if (!p.held && pts - this.curMs() > lead) p.hold(true); }

  _gateTick() {
    if (!this.info) return;
    const cur = this.curMs();
    if (this.proc?.held && this.hiLast - cur < LEAD.high - 1000) this.proc.hold(false);
    const lo = this.low;
    if (lo?.proc?.held && lo.last - cur < LEAD.low - 1000) lo.proc.hold(false);
    // a replacement light film waiting to take over only needs to stay a little ahead
    const nx = this.lowNext;
    if (nx?.proc?.held && nx.pending?.length && nx.pending[nx.pending.length - 1].pts - cur < LEAD.low - 1000) nx.proc.hold(false);
    this._audioOut();
    // keep what a late joiner needs: from the last keyframe before the picture onward
    for (const r of ['high', 'low']) {
      const h = this.hist[r];
      let k = 0; for (let i = 0; i < h.length; i++) { if (h[i].pts > cur - 400) break; if (h[i].key) k = i; }
      if (k > 0) h.splice(0, k);
    }
    let a = 0; while (a < this.ahist.length && this.ahist[a].pts < cur - 1000) a++;
    if (a) this.ahist.splice(0, a);
    if (this.eof != null && this.state.playing && cur >= this.eof + 250) {
      this.eof = null; this.state.playing = false;
      this._setClock({ pos: cur, at: 0, playing: false });
      this.emit('ended', { next: nextInFolder(this.state.file) });
      this.emit('state', this.publicState());
    }
  }

  // What someone arriving now (or switching to this rendition) needs to start right away:
  // from the last keyframe at or before the picture, up to what's been encoded so far.
  replay(r) {
    const h = this.hist[r] || [], cur = this.curMs();
    let k = -1;
    for (let i = 0; i < h.length; i++) { if (h[i].pts > cur + 50) break; if (h[i].key) k = i; }
    if (k < 0) k = h.findIndex((x) => x.key);
    return k < 0 ? [] : h.slice(k);
  }
  replayAudio() { const cur = this.curMs(); return this.ahist.filter((a) => a.pts >= cur - 60); }

  // ---- the light rendition, for guests whose line can't carry the full one. It runs only
  // while someone needs it, and starts where the picture is.
  kbpsFor(r) { return r === 'low' ? this.lowKbps : this.kbps; }

  ensureLow(kbps) {
    this.lowWanted = true;
    if (!this.lowKbps) this.lowKbps = kbps;
    if (this.state.playing && this.proc && !this.low) this._startLow();
  }

  // New bitrate for the light rendition, swapped in without a gap or a resend: the current one
  // keeps going while the replacement starts up and encodes ahead to a keyframe a little past
  // it; when the current one reaches that frame, the replacement carries on from there.
  // `sentMs`: how far the slowest viewer's line has got; the switch goes a little past that.
  retuneLow(kbps, sentMs) {
    if (!this.low || this.lowNext || !this.low.last || Math.abs(kbps - this.lowKbps) < this.lowKbps * 0.25) return false;
    this.lowKbps = kbps;
    this._startLow(true, sentMs);
    return true;
  }

  dropLow() { this.lowWanted = false; this._stopLow(); }

  async _startLow(swap = false, sentMs = null) {
    if (!this.info || (this.low && !swap) || (swap && this.lowNext)) return;
    const slot = { startPos: 0, epoch: null, cfg: null, last: 0, kb: this.lowKbps || 3000, pending: null, readyAt: null, from: 0 };
    if (swap) this.lowNext = slot; else this.low = slot;
    let from = this.curMs() / 1000;
    // (2 s past what's on the wire: time for the replacement to start up and reach it)
    if (swap && this.low) from = (Math.max(sentMs ?? this.low.last, this.curMs()) + 2000) / 1000;
    slot.from = from * 1000;
    const kpos = from > 0.5 ? await keyframeBefore(this.ffmpeg, this.state.file, from) : 0;
    if ((swap && this.lowNext !== slot) || (!swap && this.low !== slot)) return;
    const kb = slot.kb;
    // fewer pixels when there are few bits to spend
    const maxW = Math.min(kb < 2500 ? 854 : 1280, this.maxW);
    slot.startPos = kpos > 0.5 ? kpos + 0.08 : 0;
    const args = this._args(null, { kbps: kb, maxW, pos: kpos, low: true, keyAt: swap ? from - slot.startPos : 0 });
    const p = new EncoderProc(this.ffmpeg, { enc: this.enc, args });
    slot.proc = p;
    p.on('spawn', (pid) => this.emit('spawn', pid));
    p.on('config', (c) => { slot.cfg = c; });
    p.on('frame', (f) => {
      const pts = Math.round((slot.startPos + f.ts / 1000) * 1000);
      if (this.lowNext === slot) {
        // the replacement: hold on to everything from its first keyframe ahead of the current one
        if (slot.pending) { slot.pending.push({ ...f, pts }); this._gate(p, pts, LEAD.low); return; }
        if (!f.key || !slot.cfg || pts < slot.from - 50) return;
        slot.pending = [{ ...f, pts }]; slot.readyAt = pts;
        // the current one runs seconds ahead, so it's usually past this point already: swap now
        if (!this.low?.proc || this.low.last >= pts) this._takeOver(slot);
        return;
      }
      if (this.low !== slot) return;
      // the current one has reached the replacement's keyframe: hand over right there
      if (this.lowNext?.readyAt != null && pts >= this.lowNext.readyAt) { this._takeOver(this.lowNext); return; }
      this._emitLow(slot, f, pts);
    });
    p.on('exit', () => {
      if (this.low === slot) {
        if (this.lowNext?.pending) this._takeOver(this.lowNext);
        else { this.low = null; this.lowConfig = null; }
      }
      if (this.lowNext === slot) this.lowNext = null;
    });
  }

  _takeOver(slot) {
    const old = this.low;
    this.low = slot; this.lowNext = null;
    try { old?.proc?.stop(); } catch {}
    // what the old one encoded past the switch is never shown: forget it
    const swap = old?.epoch != null && slot.readyAt != null;
    if (swap) this.hist.low = this.hist.low.filter((x) => x.epoch !== old.epoch || x.pts < slot.readyAt);
    const pend = slot.pending || []; slot.pending = null;
    for (const f of pend) this._emitLow(slot, f, f.pts);
    if (swap) this.emit('lowswap');
  }

  _emitLow(slot, f, pts) {
    if (slot.epoch === null) {
      this.lowEpoch = (((this.lowEpoch ?? 127) + 1) & 0x7f) | 0x80;
      slot.epoch = this.lowEpoch;
      this.lowConfig = { ...slot.cfg, epoch: slot.epoch, fps: Math.round(this.info.video.fps), encoder: this.enc.name, kbps: slot.kb, rendition: 'low' };
      this.configs.set(slot.epoch, this.lowConfig);
      this.emit('config', this.lowConfig);
    }
    slot.last = pts;
    const fr = { ...f, pts, epoch: slot.epoch, rendition: 'low', id: this.lowId = ((this.lowId || 0) + 1) >>> 0 };
    this.hist.low.push(fr);
    this.emit('frame', fr);
    this._gate(slot.proc, pts, LEAD.low);
  }

  _stopLow() {
    for (const s of [this.low, this.lowNext]) try { s?.proc?.stop(); } catch {}
    this.low = null; this.lowNext = null; this.lowConfig = null;
    this.hist.low = [];
  }

  _kill() {
    const p = this.proc; this.proc = null; this.apend = [];
    try { p?.stop(); } catch {}
    this._stopLow();
    this.eof = null;
  }

  // Pause keeps the encoders: they just wait (their output isn't read), so play carries on
  // from the very next frame and everyone's buffer is still good.
  pause() {
    if (!this.state.playing && !this.starting) return;
    this.state.playing = false;
    this._setClock({ pos: this.curMs(), at: 0, playing: false });
    if (!this.proc) this._kill(); // stopped before it got going
    this.emit('state', this.publicState());
  }

  async restart(patch = {}) {
    const was = this.state.playing || this.starting;
    const pos = this.curMs() / 1000;
    this._kill();
    this.state.playing = false;
    Object.assign(this.state, { pos }, patch);
    if (this.state.dur) this.state.pos = Math.max(0, Math.min(this.state.pos, this.state.dur - 1));
    this.clock = { ...this.clock, pos: Math.round(this.state.pos * 1000), at: 0, playing: false };
    if (was) { while (this.starting) await new Promise((r) => setTimeout(r, 30)); await this.play(); }
    else { this._setClock({}); this.emit('state', this.publicState()); }
  }

  seek(pos) { return this.restart({ pos }); }
  setAudio(i) { return this.restart({ audio: i }); }
  setSub(key) {
    let sub = null;
    if (key && key.startsWith('i')) sub = { i: +key.slice(1) };
    else if (key && key.startsWith('f')) sub = { file: key.slice(1) };
    return this.restart({ sub });
  }
  setNight(on) { return this.restart({ night: !!on }); }
  setSubSize(size) { this.subSize = size; return this.restart({ subSize: size }); }
  setSubDelay(sec) { return this.restart({ subDelay: Math.max(-30, Math.min(30, +sec || 0)) }); }
  setBitrate(kbps) { this.kbps = kbps; return this.restart({}); }

  stop(silent) {
    this._kill();
    this.state.playing = false;
    this.clock = { ...this.clock, at: 0, playing: false };
    if (!silent) { this.info = null; this.state = { playing: false, pos: 0, dur: 0, title: '', audio: null, sub: null, night: false }; this.emit('state', this.publicState()); }
  }

  dispose() { clearInterval(this.gateTimer); this.stop(true); try { this.audioSock?.close(); } catch {} this.audioSock = null; }
}

module.exports = { Movie, probe, nextInFolder, pickAudio, pickSub, VIDEO_EXT, LEAD };
