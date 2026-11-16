'use strict';
// Watch-party source: plays a video file through ffmpeg in real time (-re) and hands out
// encoded frames + Opus audio, the same way the game encoder does. Picture comes straight from
// the file, never from the screen, so it's sharper and nothing on the host's desktop leaks in.
//
// Pause/seek restart ffmpeg at the new position (-ss + -copyts keeps subtitles in sync).

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

class Movie extends EventEmitter {
  constructor(ffmpeg) {
    super();
    this.ffmpeg = ffmpeg;
    this.info = null; this.proc = null;
    this.state = { playing: false, pos: 0, dur: 0, title: '', audio: null, sub: null, night: false };
    this.epoch = 0; this.frameId = 0;
    this.audioSock = null; this.aSeq = 0;
  }

  async open(file, { pos = 0, enc, kbps = 12000, maxW = 1920, night = false } = {}) {
    const info = await probe(this.ffmpeg, file);
    if (!info || !info.video) throw new Error('unreadable');
    this.stop(true);
    this.info = info; this.enc = enc; this.kbps = kbps; this.maxW = maxW;
    this.state = { playing: false, pos: Math.max(0, Math.min(pos, Math.max(0, info.duration - 5))), dur: info.duration, title: info.name, file, audio: pickAudio(info), sub: pickSub(info), night };
    this.emit('state', this.publicState());
    return this.publicState();
  }

  publicState() {
    const i = this.info;
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
    const s = dgram.createSocket('udp4');
    s.on('message', (b) => {
      // RTP: 12-byte header (+ CSRCs + extension), payload = one Opus packet
      if (b.length < 13 || (b[0] >> 6) !== 2) return;
      let o = 12 + (b[0] & 0x0f) * 4;
      if (b[0] & 0x10) o += 4 + b.readUInt16BE(o + 2) * 4;
      // RTP timestamp (48 kHz) relative to this process's first packet = position in the film
      const ts = b.readUInt32BE(4);
      if (this.rtpBase == null) this.rtpBase = ts;
      const pts = Math.round((this.startPos || 0) * 1000 + ((ts - this.rtpBase) >>> 0) / 48);
      this.emit('audio', { data: Buffer.from(b.subarray(o)), pts, epoch: this.audioEpoch ?? this.epoch });
    });
    await new Promise((r) => s.bind(0, '127.0.0.1', r));
    this.audioSock = s;
    return s.address().port;
  }

  _args(aport) {
    const st = this.state, i = this.info;
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    // Seek to the keyframe before the target (play() looks it up), so -re has no pre-roll to
    // sit through in real time. A hair past it because -ss counts from the file's start time.
    // Timestamps restart at 0 after -ss, so subtitles get shifted back onto the film's clock.
    const ss = st.pos > 0.5 ? st.pos + 0.08 : 0;
    this.startPos = ss;
    if (ss) a.push('-ss', ss.toFixed(3));
    a.push('-re', '-i', st.file);
    const vf = [];
    const subs = st.sub?.file ? `subtitles=${filterPath(st.sub.file)}` : st.sub && st.sub.i != null ? `subtitles=${filterPath(st.file)}:si=${st.sub.i}` : null;
    if (subs) vf.push(...(ss ? [`setpts=PTS+${ss.toFixed(3)}/TB`, subs, 'setpts=PTS-STARTPTS'] : [subs]));
    if (i.video.w > this.maxW) vf.push(`scale=${this.maxW}:-2:flags=bicubic`);
    if (i.video.hdr) vf.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv');
    vf.push('format=nv12');
    const kb = Math.round(this.kbps), fps = Math.round(i.video.fps) || 24;
    a.push('-map', '0:v:0', '-vf', vf.join(','), '-c:v', this.enc.name);
    if (this.enc.fam === 'nvenc') a.push('-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '22', '-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.4)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2), '-forced-idr', '1');
    else if (this.enc.fam === 'sw') a.push('-preset', 'veryfast', '-tune', 'film', '-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.4)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2));
    else a.push('-b:v', `${kb}k`, '-maxrate', `${Math.round(kb * 1.4)}k`, '-bufsize', `${kb * 2}k`, '-bf', '0', '-g', String(fps * 2));
    a.push('-an', '-flush_packets', '1', '-f', 'flv', 'pipe:1');
    if (st.audio != null) {
      // night mode: lift dialogue, tame explosions
      const af = st.night ? 'dynaudnorm=f=200:g=11:p=0.9:m=8,acompressor=threshold=-20dB:ratio=4:attack=5:release=120' : 'anull';
      a.push('-map', `0:a:${st.audio}`, '-af', af, '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '160k', '-frame_duration', '20', '-application', 'audio', '-vn', '-f', 'rtp', `rtp://127.0.0.1:${aport}?pkt_size=1400`);
    }
    return a;
  }

  async play() {
    if (!this.info || this.state.playing) return;
    const aport = await this._audioPort();
    if (this.state.pos > 0.5) this.state.pos = await keyframeBefore(this.ffmpeg, this.state.file, this.state.pos);
    const opts = { enc: { ...this.enc, codec: this.enc.codec }, args: this._args(aport) };
    const p = new EncoderProc(this.ffmpeg, opts);
    this.proc = p;
    this.rtpBase = null;
    this.audioEpoch = (this.epoch + 1) & 0xff; // the config this process announces will carry this epoch
    p.on('spawn', (pid) => this.emit('spawn', pid));
    this.state.playing = true;
    p.on('config', (c) => {
      this.epoch = (this.epoch + 1) & 0xff;
      this.config = { ...c, epoch: this.epoch, fps: Math.round(this.info.video.fps), encoder: this.enc.name, kbps: this.kbps };
      this.emit('config', this.config);
    });
    p.on('frame', (f) => {
      if (p !== this.proc) return;
      this.state.pos = (this.startPos || 0) + f.ts / 1000;
      this.emit('frame', { ...f, pts: Math.round(this.state.pos * 1000), epoch: this.epoch, id: this.frameId = (this.frameId + 1) >>> 0 });
    });
    p.on('exit', ({ code, err }) => {
      if (p !== this.proc) return;
      this.proc = null; this.state.playing = false;
      const ended = this.state.dur && this.state.pos > this.state.dur - 3;
      if (ended) this.emit('ended', { next: nextInFolder(this.state.file) });
      else if (code && code !== 0 && !this.stopping) this.emit('error', err);
      this.emit('state', this.publicState());
    });
    this.emit('state', this.publicState());
  }

  pause() {
    if (!this.proc) return;
    this.stopping = true;
    const p = this.proc; this.proc = null; this.state.playing = false;
    p.stop();
    setTimeout(() => { this.stopping = false; }, 300);
    this.emit('state', this.publicState());
  }

  async restart(patch = {}) {
    const was = this.state.playing;
    this.pause();
    Object.assign(this.state, patch);
    if (this.state.dur) this.state.pos = Math.max(0, Math.min(this.state.pos, this.state.dur - 1));
    if (was) await this.play(); else this.emit('state', this.publicState());
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
  setBitrate(kbps) { this.kbps = kbps; return this.restart({}); }

  stop(silent) {
    this.pause();
    if (!silent) { this.info = null; this.state = { playing: false, pos: 0, dur: 0, title: '', audio: null, sub: null, night: false }; this.emit('state', this.publicState()); }
  }

  dispose() { this.stop(true); try { this.audioSock?.close(); } catch {} this.audioSock = null; }
}

module.exports = { Movie, probe, nextInFolder, pickAudio, pickSub, VIDEO_EXT };
