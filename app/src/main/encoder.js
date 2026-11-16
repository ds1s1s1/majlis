'use strict';
// Video encoding through ffmpeg: desktop duplication (zero copy on the GPU) straight into the
// hardware encoder, tuned for latency (no B-frames, no lookahead, intra refresh instead of big
// keyframes). Output is FLV on stdout because FLV frames every packet with its size, so we can
// ship a frame the instant ffmpeg writes it instead of waiting for the next start code.
//
// Bitrate changes and keyframe requests use a hot swap: start a second encoder, switch over on
// its first keyframe, then stop the old one. The viewer never sees a gap.

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000;

function findFfmpeg(custom) {
  const cands = [custom, path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'), 'ffmpeg'];
  for (const c of cands) if (c && (c === 'ffmpeg' || fs.existsSync(c))) return c;
  return 'ffmpeg';
}

const CANDIDATES = [
  { name: 'av1_nvenc', codec: 'av1', fam: 'nvenc' },
  { name: 'hevc_nvenc', codec: 'hevc', fam: 'nvenc' },
  { name: 'h264_nvenc', codec: 'h264', fam: 'nvenc' },
  { name: 'av1_amf', codec: 'av1', fam: 'amf' },
  { name: 'hevc_amf', codec: 'hevc', fam: 'amf' },
  { name: 'h264_amf', codec: 'h264', fam: 'amf' },
  { name: 'av1_qsv', codec: 'av1', fam: 'qsv' },
  { name: 'hevc_qsv', codec: 'hevc', fam: 'qsv' },
  { name: 'h264_qsv', codec: 'h264', fam: 'qsv' },
  { name: 'libx264', codec: 'h264', fam: 'sw' },
];

// Which hardware encoders actually work on this GPU (the ffmpeg build lists more than exist).
async function detectEncoders(ffmpeg) {
  const ok = [];
  await Promise.all(CANDIDATES.map((c) => new Promise((res) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=30', '-frames:v', '3', '-c:v', c.name, '-f', 'null', '-'];
    execFile(ffmpeg, args, { timeout: 8000, windowsHide: true }, (err) => { if (!err) ok.push(c); res(); });
  })));
  return CANDIDATES.filter((c) => ok.includes(c));
}

function buildArgs(o) {
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', 'nobuffer', '-flags', 'low_delay'];
  const fam = o.enc.fam;
  const kb = Math.round(o.kbps);
  let vf = [];
  if (o.window) {
    // raw frames need no probing; skipping it shaves the start and keeps the pipe from backing up
    a.push('-probesize', '32', '-analyzeduration', '0', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-video_size', `${o.window.w}x${o.window.h}`, '-framerate', String(o.fps), '-use_wallclock_as_timestamps', '1', '-i', o.window.pipe);
    if (fam === 'qsv') vf.push('format=nv12');
    if (fam === 'sw') vf.push('format=yuv420p');
    if (o.scale) vf.unshift(`scale=${o.scale.w}:${o.scale.h}:flags=fast_bilinear`);
  } else {
    let src = `ddagrab=output_idx=${o.display | 0}:framerate=${o.fps}:draw_mouse=${o.drawMouse ? 1 : 0}:dup_frames=1`;
    if (o.region) src += `:video_size=${o.region.w}x${o.region.h}:offset_x=${o.region.x}:offset_y=${o.region.y}`;
    if (o.hdr) src += ':output_fmt=10bit';
    a.push('-f', 'lavfi', '-i', src);
    // GPU scaler; nvenc's AV1 path insists on explicit color metadata on the scaled frames
    if (o.scale) vf.push(`scale_d3d11=width=${o.scale.w}:height=${o.scale.h}:format=${o.hdr ? 'p010' : 'nv12'}`, o.hdr ? 'setparams=range=tv:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084' : 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709');
    if (fam === 'qsv') vf.push('hwmap=derive_device=qsv', 'format=qsv');
    if (fam === 'sw') vf.push('hwdownload', 'format=bgra', 'format=yuv420p');
  }
  if (vf.length) a.push('-vf', vf.join(','));
  a.push('-c:v', o.enc.name);
  const buf = Math.max(200, Math.round(kb / o.fps * 2));
  const gop = String(o.fps);
  if (fam === 'nvenc') {
    // p1/ull is the fastest but softest; p4 with 'll' looks clearly better for ~1 ms more
    const [pre, tune] = { speed: ['p1', 'ull'], balanced: ['p4', 'll'], quality: ['p6', 'll'] }[o.quality || 'balanced'];
    a.push('-preset', pre, '-tune', tune, '-rc', 'cbr', '-b:v', `${kb}k`, '-maxrate', `${kb}k`, '-bufsize', `${buf}k`,
      '-zerolatency', '1', '-delay', '0', '-bf', '0', '-g', gop, '-intra-refresh', '1', '-no-scenecut', '1',
      // spatial AQ spends bits where the eye notices (text, faces) at no latency cost;
      // split encoding (auto) lets cards with two NVENC engines share 4K / high-fps frames
      '-spatial-aq', '1', '-aq-strength', '8', '-split_encode_mode', '0');
    if (o.tenBit && o.enc.codec !== 'h264') a.push('-highbitdepth', '1');
  } else if (fam === 'amf') {
    a.push('-usage', 'ultralowlatency', '-quality', 'speed', '-latency', '1', '-preanalysis', '0', '-rc', 'cbr', '-b:v', `${kb}k`, '-maxrate', `${kb}k`, '-bufsize', `${buf}k`, '-bf', '0', '-g', String(o.fps * 4));
  } else if (fam === 'qsv') {
    a.push('-preset', 'veryfast', '-low_power', '1', '-async_depth', '1', '-look_ahead', '0', '-b:v', `${kb}k`, '-maxrate', `${kb}k`, '-bufsize', `${buf}k`, '-bf', '0', '-g', String(o.fps * 4));
  } else {
    a.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', `${kb}k`, '-maxrate', `${kb}k`, '-bufsize', `${buf}k`, '-bf', '0', '-g', String(o.fps * 2), '-intra-refresh', '1');
  }
  if (o.hdr && o.enc.codec !== 'h264') a.push('-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc');
  a.push('-flush_packets', '1', '-f', 'flv', 'pipe:1');
  return a;
}

// --------------------------------------------------------------- codec strings for WebCodecs
const hex2 = (n) => n.toString(16).padStart(2, '0');
function codecString(codec, rec) {
  try {
    if (codec === 'h264') return `avc1.${hex2(rec[1])}${hex2(rec[2])}${hex2(rec[3])}`;
    if (codec === 'hevc') {
      const space = (rec[1] >> 6) & 3, tier = (rec[1] >> 5) & 1, prof = rec[1] & 0x1f;
      let compat = rec.readUInt32BE(2), rev = 0;
      for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
      const cons = [...rec.subarray(6, 12)];
      while (cons.length && cons[cons.length - 1] === 0) cons.pop();
      return `hvc1.${space ? 'ABC'[space - 1] : ''}${prof}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${rec[12]}${cons.map((c) => '.' + c.toString(16).toUpperCase()).join('')}`;
    }
    if (codec === 'av1') {
      const prof = rec[1] >> 5, lvl = rec[1] & 0x1f, tier = rec[2] >> 7, hbd = (rec[2] >> 6) & 1, twelve = (rec[2] >> 5) & 1;
      return `av01.${prof}.${String(lvl).padStart(2, '0')}${tier ? 'H' : 'M'}.${twelve ? 12 : hbd ? 10 : '08'}`;
    }
  } catch {}
  return { h264: 'avc1.640034', hevc: 'hvc1.1.6.L153.B0', av1: 'av01.0.13M.08' }[codec];
}

// --------------------------------------------------------------- one ffmpeg process
class EncoderProc extends EventEmitter {
  constructor(ffmpeg, opts) {
    super();
    this.opts = opts;
    this.buf = Buffer.alloc(0);
    this.headerDone = false;
    this.args = opts.args || buildArgs(opts);
    this.p = spawn(ffmpeg, this.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { require('os').setPriority(this.p.pid, -14); } catch {}
    setImmediate(() => this.emit('spawn', this.p.pid));
    this.p.stdout.on('data', (d) => this._feed(d));
    let err = '';
    this.p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    this.p.on('exit', (code) => this.emit('exit', { code, err: err.trim() }));
    this.p.on('error', (e) => this.emit('exit', { code: -1, err: e.message }));
    this.w0 = null; this.pts0 = 0; this.latMin = Infinity;
  }

  _feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let o = 0;
    if (!this.headerDone) {
      if (this.buf.length < 13) return;
      o = this.buf.readUInt32BE(5) + 4;
      this.headerDone = true;
    }
    while (this.buf.length - o >= 11) {
      const type = this.buf[o], size = this.buf.readUIntBE(o + 1, 3);
      if (this.buf.length - o < 11 + size + 4) break;
      const ts = this.buf.readUIntBE(o + 4, 3) | (this.buf[o + 7] << 24);
      if (type === 9) this._video(this.buf.subarray(o + 11, o + 11 + size), ts);
      o += 11 + size + 4;
    }
    this.buf = o ? Buffer.from(this.buf.subarray(o)) : this.buf;
  }

  _video(d, ts) {
    if (!d.length) return;
    let pkt, key, cfg;
    if (d[0] & 0x80) {
      const frameType = (d[0] >> 4) & 7, pt = d[0] & 0x0f, cc = d.subarray(1, 5).toString('latin1');
      if (frameType === 5) return;
      key = frameType === 1;
      if (pt === 0) cfg = d.subarray(5);
      else if (pt === 1) pkt = cc === 'av01' || cc === 'vp09' ? d.subarray(5) : d.subarray(8);
      else if (pt === 3) pkt = d.subarray(5);
      else return;
    } else {
      key = (d[0] >> 4) === 1;
      if (d[1] === 0) cfg = d.subarray(5);
      else if (d[1] === 1) pkt = d.subarray(5);
      else return;
    }
    if (cfg) {
      this.config = { codec: codecString(this.opts.enc.codec, cfg), description: Buffer.from(cfg), family: this.opts.enc.codec };
      return this.emit('config', this.config);
    }
    const t = hr();
    if (this.w0 === null) { this.w0 = t; this.pts0 = ts; }
    // ffmpeg doesn't tell us the capture time, so estimate encode delay from how far a frame
    // lands behind its timestamp, relative to the best frame seen (≈ 4 ms on NVENC).
    const lag = (t - this.w0) - (ts - this.pts0);
    this.latMin = Math.min(this.latMin, lag);
    const encMs = Math.min(250, Math.max(1, lag - this.latMin + 4));
    this.emit('frame', { data: Buffer.from(pkt), key, ts, at: t, encMs });
  }

  stop() { try { this.p.kill(); } catch {} }
}

// --------------------------------------------------------------- manager with hot swap
class Encoder extends EventEmitter {
  constructor(ffmpeg) {
    super();
    this.ffmpeg = ffmpeg;
    this.cur = null; this.next = null;
    this.epoch = 0; this.frameId = 0;
    this.lastSwap = 0;
    this.opts = null;
  }

  start(opts) {
    this.opts = { ...opts };
    this._spawn(this.opts, true);
  }

  _spawn(opts, immediate) {
    const p = new EncoderProc(this.ffmpeg, opts);
    let cfg = null, live = immediate;
    if (immediate) { this.cur?.stop(); this.cur = p; } else { this.next?.stop(); this.next = p; }
    p.on('spawn', (pid) => this.emit('spawn', pid));
    p.on('config', (c) => { cfg = c; if (live) this._announce(c); });
    p.on('frame', (f) => {
      if (!live) {
        if (!f.key || !cfg) return;
        // first keyframe from the replacement: switch over
        const old = this.cur; this.cur = p; this.next = null; live = true;
        this._announce(cfg);
        setTimeout(() => old?.stop(), 50);
      }
      if (p !== this.cur) return;
      this.emit('frame', { ...f, pts: f.ts, epoch: this.epoch, id: this.frameId = (this.frameId + 1) >>> 0 });
    });
    p.on('exit', (e) => {
      if (p === this.cur && !this.stopped) { this.emit('error', e); }
      if (p === this.next) this.next = null;
    });
    this.lastSwap = Date.now();
    return p;
  }

  _announce(cfg) {
    this.epoch = (this.epoch + 1) & 0xff;
    this.config = { ...cfg, epoch: this.epoch, kbps: this.opts.kbps, encoder: this.opts.enc.name, fps: this.opts.fps };
    this.emit('config', this.config);
  }

  // Restart with new options without a visible hiccup.
  swap(patch) {
    this.opts = { ...this.opts, ...patch };
    if (!this.cur) return this.start(this.opts);
    this._spawn(this.opts, false);
  }

  requestKeyframe() {
    // a replacement that never produced a keyframe (stuck opening its input) gets dropped
    if (this.next && Date.now() - this.lastSwap > 8000) { this.next.stop(); this.next = null; }
    if (Date.now() - this.lastSwap < 800 || this.next) return false;
    this.swap({});
    return true;
  }

  stop() {
    this.stopped = true;
    this.cur?.stop(); this.next?.stop();
    this.cur = this.next = null;
  }
}

module.exports = { Encoder, EncoderProc, detectEncoders, buildArgs, codecString, findFfmpeg, CANDIDATES };
