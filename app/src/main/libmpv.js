'use strict';
// Embedded libmpv-2.dll backend for single-HWND composited playback inside Electron.
// Exposes the exact interface of Mpv (mpv.js) while rendering NV12/BGRA frames directly
// into the main window's WebGL2 canvas so Discord WGC and window dragging work seamlessly.
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const {
  subFontsDir, WATCHED, SPDIF_CODECS, rtxFilterFor,
  BUFFER_PRESETS, SAFE_TONE_MAPS, parseSafeMpvConf, subStyleToMpvOpts, normalizeSubLang2, listInstalledShaders,
} = require('./mpv');

function libmpvPath() {
  const packaged = path.join(process.resourcesPath || '', 'mpv', 'libmpv-2.dll');
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '../../../engine/vendor/mpv/libmpv-2.dll');
  return fs.existsSync(dev) ? dev : null;
}

function fontsConfDir() {
  const pkg = path.join(process.resourcesPath || '', 'mpv', 'mpv');
  if (fs.existsSync(path.join(pkg, 'fonts.conf'))) return pkg;
  const dev = path.join(__dirname, '../../../engine/vendor/mpv/mpv');
  return fs.existsSync(path.join(dev, 'fonts.conf')) ? dev : null;
}

function buildLibMpvOptions({
  vsr = false, rtxHdr = false, spdif = false, decoderMode = 1, shaderCacheDir = null, subFilterSdh = false,
  fontsDir = subFontsDir(), hwAccel = true, toneMapping = null,
  bufferSize = null, anime4k = false, anime4kMode = 'A', subStyle = null, subLang2 = null,
  customMpvConf = '', userDataDir = null, videoQualityPreset = 'balanced',
} = {}) {
  const hwdec = (hwAccel === false || decoderMode === 2) ? 'no' : 'd3d11va-copy';
  const scaler = videoQualityPreset === 'max' ? 'ewa_lanczossharp' : 'spline36';
  const opts = [
    ['idle', 'yes'],
    ['keep-open', 'yes'],
    ['config', 'no'],
    ['osc', 'no'],
    ['osd-level', '0'],
    ['vo', 'libmpv'],
    ['ao', 'wasapi'],
    ['audio-buffer', '0.1'],
    ['video-timing-offset', '0'],
    ['correct-pts', 'yes'],
    ['profile', 'high-quality'],
    ['fbo-format', 'rgba16hf'],
    ['dither-depth', 'auto'],
    ['scale', scaler],
    ['cscale', 'spline36'],
    ['dscale', 'mitchell'],
    ['correct-downscaling', 'yes'],
    ['linear-downscaling', 'yes'],
    ['sigmoid-upscaling', 'yes'],
    ['deband', 'yes'],
    ['deband-iterations', '2'],
    ['deband-threshold', '48'],
    ['deband-range', '16'],
    ['deband-grain', '32'],
    ['video-sync', 'audio'],
    ['framedrop', 'vo'],
    ['vd-lavc-threads', '4'],
    ['hwdec', hwdec],
    ['vd-lavc-software-fallback', 'yes'],
    ['hwdec-codecs', 'all'],
    ['cache', 'yes'],
    ['demuxer-max-bytes', '150MiB'],
    ['demuxer-max-back-bytes', '50MiB'],
    ['demuxer-seekable-cache', 'yes'],
    ['hr-seek', 'yes'],
    ['volume-max', '200'],
    ['audio-pitch-correction', 'yes'],
    ['ad-lavc-downmix', 'no'],
    ['audio-channels', 'auto-safe'],
    ['slang', 'ar,ara,arabic,en,eng'],
    ['alang', 'ar,ara,arabic,en,eng,ja,jpn'],
    ['sub-auto', 'fuzzy'],
    ['sub-font', 'Segoe UI'],
    ['sub-pos', '94'],
    ['secondary-sub-pos', '8'],
    ['sub-margin-y', '26'],
    ['sub-font-size', '40'],
    ['sub-scale', '1.0'],
    ['sub-border-size', '2.2'],
    ['sub-shadow-offset', '1.2'],
    ['sub-shadow-color', '#90000000'],
    ['sub-ass-force-margins', 'yes'],
    ['sub-ass-shaper', 'complex'],
    ['sub-ass-override', 'scale'],
    ['sub-codepage', 'utf-8'],
    ['network-timeout', '20'],
    ['ytdl', 'no'],
    ['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
    ['stream-lavf-o', 'reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5'],
    ['tone-mapping', 'bt.2446a'],
    ['hdr-compute-peak', 'yes'],
    ['gamut-mapping-mode', 'perceptual'],
    ['target-peak', 'auto'],
    // vo=libmpv renders into an 8-bit SDR sRGB WebGL2 canvas, so always force SDR BT.709/sRGB tone mapping
    ['target-colorspace-hint', 'no'],
    ['target-prim', 'bt.709'],
    ['target-trc', 'srgb'],
  ];
  const setOpt = (k, v) => {
    const idx = opts.findIndex(([key]) => key === k);
    if (idx >= 0) opts[idx][1] = String(v);
    else opts.push([k, String(v)]);
  };
  if (toneMapping && SAFE_TONE_MAPS.has(toneMapping)) setOpt('tone-mapping', toneMapping);
  const buf = bufferSize && BUFFER_PRESETS[bufferSize];
  if (buf) {
    setOpt('demuxer-max-bytes', buf[0]);
    setOpt('demuxer-max-back-bytes', buf[1]);
  }
  const s2 = normalizeSubLang2(subLang2);
  if (s2) setOpt('slang', [...new Set(['ar', 'ara', 'arabic', s2, 'en', 'eng'])].join(','));
  const confDir = fontsConfDir();
  if (confDir) opts.push(['config-dir', confDir]);
  if (fontsDir) opts.push(['sub-fonts-dir', fontsDir]);
  if (spdif) opts.push(['audio-spdif', SPDIF_CODECS]);
  if (shaderCacheDir) opts.push(['gpu-shader-cache-dir', shaderCacheDir]);
  if (subFilterSdh) {
    opts.push(['sub-filter-sdh', 'yes'], ['sub-filter-sdh-harder', 'yes']);
  }
  if (anime4k) {
    setOpt('deband', 'yes');
    setOpt('sharpen', '0.55');
    const { files } = listInstalledShaders(userDataDir);
    const modeTag = String(anime4kMode || 'A').replace(/[^ABC]/gi, '').toUpperCase();
    const matched = files.filter((f) => /anime4k/i.test(path.basename(f)) && (!modeTag || new RegExp(`mode[_-]?${modeTag}|clamp|restore|upscale`, 'i').test(path.basename(f))));
    if (matched.length) setOpt('glsl-shaders', matched.join(';'));
  }
  for (const [k, v] of subStyleToMpvOpts(subStyle)) setOpt(k, v);
  for (const [k, v] of parseSafeMpvConf(customMpvConf)) setOpt(k, v);
  return opts;
}

class LibMpv extends EventEmitter {
  constructor({
    MpvPlayer, dll = libmpvPath(), vsr = false, rtxHdr = false, spdif = false, decoderMode = 1,
    shaderCacheDir = null, subFilterSdh = false, fontsDir, width = 1280, height = 720, displayFps = 0,
    hwAccel = true, hdrMode = null, toneMapping = null, bufferSize = null, anime4k = false, anime4kMode = 'A',
    subStyle = null, subLang2 = null, customMpvConf = '', userDataDir = null, videoQualityPreset = 'balanced',
  } = {}) {
    super();
    this.MpvPlayer = MpvPlayer;
    this.dll = dll;
    this.vsr = vsr;
    this.rtxHdr = rtxHdr;
    this.spdif = spdif;
    this.decoderMode = decoderMode;
    this.shaderCacheDir = shaderCacheDir;
    this.subFilterSdh = subFilterSdh;
    this.fontsDir = fontsDir;
    this.width = width;
    this.height = height;
    this.displayFps = displayFps;
    this.hwAccel = hwAccel;
    this.hdrMode = hdrMode;
    this.toneMapping = toneMapping;
    this.bufferSize = bufferSize;
    this.anime4k = anime4k;
    this.anime4kMode = anime4kMode;
    this.subStyle = subStyle;
    this.subLang2 = subLang2;
    this.customMpvConf = customMpvConf;
    this.userDataDir = userDataDir;
    this.videoQualityPreset = videoQualityPreset;
    this.player = null;
    this.props = {};
    this.lastPos = 0;
    this.posAt = 0;
    this.stopped = false;
    this.want = null;
    this.restarts = 0;
    this.wd = null;
    this.recovering = false;
  }

  get isEmbedded() { return true; }
  get ready() { return !!this.player && !this.stopped; }
  get sock() { return this.ready; }

  async start() {
    if (!this.dll || !this.MpvPlayer) throw new Error('libmpv unavailable');
    this.stopped = false;
    const opts = buildLibMpvOptions({
      vsr: this.vsr, rtxHdr: this.rtxHdr, spdif: this.spdif,
      decoderMode: this.decoderMode, shaderCacheDir: this.shaderCacheDir,
      subFilterSdh: this.subFilterSdh, fontsDir: this.fontsDir, displayFps: this.displayFps,
      hwAccel: this.hwAccel, hdrMode: this.hdrMode, toneMapping: this.toneMapping,
      bufferSize: this.bufferSize, anime4k: this.anime4k, anime4kMode: this.anime4kMode,
      subStyle: this.subStyle, subLang2: this.subLang2, customMpvConf: this.customMpvConf,
      userDataDir: this.userDataDir, videoQualityPreset: this.videoQualityPreset,
    });
    this.player = new this.MpvPlayer(
      this.dll,
      opts,
      WATCHED,
      Math.max(64, Math.min(3840, Math.round(this.width || 1280))),
      Math.max(64, Math.min(2160, Math.round(this.height || 720))),
      (jsonStr) => this._onNativeEvent(jsonStr),
      (w, h, fmt, buf) => this.emit('frame', { w, h, fmt, buf }),
    );
    // Notice Mpv (CLI) checks this.sock; expose truthy getter compatibility if callers inspect state
    this.emit('ready');
  }

  _onNativeEvent(jsonStr) {
    if (this.stopped) return;
    let m;
    try { m = JSON.parse(jsonStr); } catch { return; }
    if (m.event === 'property-change') {
      this.props[m.name] = m.data;
      if (m.name === 'time-pos' && m.data != null) {
        this.lastPos = m.data;
        this.posAt = Date.now();
      }
      this.emit('prop', m.name, m.data);
    } else if (m.event === 'shutdown') {
      if (!this.stopped && this.want) this._recover('libmpv shutdown');
    } else if (m.event) {
      this.emit('event', m);
    }
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    if (this.player && !this.stopped) this.player.resize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)));
  }

  ackFrame() {
    if (this.player && !this.stopped) this.player.ackFrame();
  }

  async command(...args) {
    if (!this.player || this.stopped) throw new Error('mpv not running');
    this.player.command(args.map((a) => (a === undefined ? '' : String(a))));
    return true;
  }

  async set(name, value) {
    if (!this.player || this.stopped) throw new Error('mpv not running');
    const v = value === true ? 'yes' : value === false ? 'no' : String(value ?? '');
    this.player.setProperty(String(name), v);
    this.props[name] = value;
    return true;
  }

  async get(name) {
    if (!this.player || this.stopped) throw new Error('mpv not running');
    if (name in this.props && this.props[name] !== undefined && /^(track-list|chapter-list|video-params|audio-params)$/.test(name)) {
      return this.props[name];
    }
    const raw = this.player.getProperty(String(name));
    if (raw == null) return null;
    if (raw === 'yes') return true;
    if (raw === 'no') return false;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  resetPlaybackProps() {
    for (const k of ['duration', 'time-pos', 'eof-reached', 'paused-for-cache', 'video-params', 'audio-params', 'core-idle', 'frame-drop-count', 'video-bitrate', 'video-codec', 'estimated-vf-fps', 'avsync', 'cache-speed', 'secondary-sid']) {
      delete this.props[k];
    }
    this.lastPos = 0;
  }

  clearPlayback() {
    this.want = null;
    this.restarts = 0;
    clearInterval(this.wd);
    this.wd = null;
    this.resetPlaybackProps();
  }

  async clearExternalSubs() {
    const tracks = Array.isArray(this.props['track-list']) ? this.props['track-list'] : [];
    for (const tr of tracks) {
      if (tr?.type === 'sub' && tr.external && tr.id != null) await this.command('sub-remove', tr.id).catch(() => {});
    }
  }

  async load(url, opts = {}) {
    if (!url || typeof url !== 'string' || /[\r\n\0]/.test(url) || url.trim().startsWith('-')) {
      throw new Error('invalid_url');
    }
    const cleanOpt = (val) => String(val ?? '').replace(/[\r\n\0]+/g, ' ').trim();
    this.want = { url, opts };
    this.resetPlaybackProps();
    this._watch();
    // Apply per-file options on the instance safely before loadfile
    for (const k of ['speed', 'sub-delay', 'audio-delay', 'video-zoom', 'panscan', 'brightness', 'contrast', 'saturation', 'gamma']) {
      await this.set(k, k === 'speed' ? 1 : 0).catch(() => {});
    }
    await this.set('secondary-sid', 'no').catch(() => {});
    await this.set('ab-loop-a', 'no').catch(() => {});
    await this.set('ab-loop-b', 'no').catch(() => {});
    await this.set('start', opts.start != null ? cleanOpt(opts.start) : 'none').catch(() => {});
    await this.set('http-header-fields', cleanOpt(opts['http-header-fields'])).catch(() => {});
    if (opts['user-agent']) await this.set('user-agent', cleanOpt(opts['user-agent'])).catch(() => {});
    if (opts.referrer) await this.set('referrer', cleanOpt(opts.referrer)).catch(() => {});
    await this.set('force-media-title', cleanOpt(opts['force-media-title'])).catch(() => {});
    await this.set('pause', false).catch(() => {});
    return this.command('loadfile', url, 'replace');
  }

  _watch() {
    clearInterval(this.wd);
    this.posAt = Date.now();
    this.wd = setInterval(() => {
      const pr = this.props;
      if (!this.want || pr['core-idle'] || pr['time-pos'] == null) return;
      const playing = pr.pause === false && !pr['paused-for-cache'] && !pr['eof-reached'];
      if (playing && Date.now() - this.posAt > 5000) this._recover('stalled');
    }, 1000);
  }

  async _recover(why) {
    if (this.recovering || this.stopped || !this.want) return;
    if (this.restarts++ > 5) { this.emit('failed', why); return; }
    this.recovering = true;
    this.emit('recovering', why);
    const at = this.lastPos || 0, want = this.want, paused = this.props.pause, speed = this.props.speed;
    try {
      await this.load(want.url, { ...want.opts, start: `${at.toFixed(3)}` });
      if (this.stopped || !this.want || this.want !== want) { this.recovering = false; return; }
      if (paused) await this.set('pause', true);
      if (speed && speed !== 1) await this.set('speed', speed);
      this.emit('recovered', { why, at });
    } catch (e) { this.emit('failed', e.message); }
    this.recovering = false;
  }

  stop() {
    this.stopped = true;
    this.clearPlayback();
    const p = this.player;
    this.player = null;
    if (p) {
      try { p.destroy(); } catch {}
    }
  }
}

module.exports = { LibMpv, libmpvPath, fontsConfDir, buildLibMpvOptions, rtxFilterFor };
