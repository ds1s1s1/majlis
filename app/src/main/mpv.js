'use strict';
// The film player: mpv in its own process, drawn into a window we give it (--wid), driven over
// its JSON IPC pipe. Its own process so a bad file or a driver crash takes down the picture, not
// the app; a watchdog brings it back where it was while playback is active.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const net = require('net');
const path = require('path');
const fs = require('fs');

function mpvPath() {
  for (const p of [
    process.resourcesPath ? path.join(process.resourcesPath, 'sidecars', 'mpv', 'mpv.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'mpv', 'mpv.exe') : null,
    path.join(__dirname, '../../../engine/vendor/mpv/mpv.exe'),
  ]) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function subFontsDir() {
  const cands = [
    process.resourcesPath ? path.join(process.resourcesPath, 'fonts') : null,
    path.join(__dirname, '../../../engine/vendor/fonts'),
    path.join(__dirname, '../../../engine/vendor/mpv/fonts'),
    path.join(__dirname, '../renderer/fonts'),
  ].filter(Boolean);
  for (const dir of cands) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /\.(ttf|otf|ttc)$/i.test(f))) return dir;
    } catch {}
  }
  return null;
}

function findShadersDir(extraDir = null) {
  const cands = [
    extraDir,
    process.resourcesPath ? path.join(process.resourcesPath, 'sidecars', 'mpv', 'shaders') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'mpv', 'shaders') : null,
    path.join(__dirname, '../../../engine/vendor/mpv/shaders'),
  ].filter(Boolean);
  for (const dir of cands) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {}
  }
  return null;
}

function listInstalledShaders(userDataDir = null) {
  const dirs = [
    userDataDir ? path.join(userDataDir, 'shaders') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'sidecars', 'mpv', 'shaders') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'mpv', 'shaders') : null,
    path.join(__dirname, '../../../engine/vendor/mpv/shaders'),
  ].filter(Boolean);
  const files = [];
  const seen = new Set();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.glsl$/i.test(name) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        files.push(path.join(dir, name));
      }
    } catch {}
  }
  return { dir: findShadersDir(userDataDir ? path.join(userDataDir, 'shaders') : null), files };
}

// What every film gets: GPU decode with a safe fallback, vo=gpu-next with gpu fallback, 150/50 MiB cache,
// 200% max volume, speed changes without pitch shift, Arabic first, seekable cache & reconnect.
const BASE = [
  '--idle=yes', '--force-window=yes', '--keep-open=yes', '--no-config', '--osc=no', '--osd-level=0',
  '--input-default-bindings=no', '--input-vo-keyboard=no', '--cursor-autohide=no', '--no-terminal',
  '--hwdec=auto-safe', '--hwdec-codecs=all', '--vo=gpu-next,gpu,', '--gpu-api=d3d11', '--d3d11-flip=yes',
  '--profile=high-quality', '--scale=spline36', '--cscale=spline36', '--dscale=mitchell',
  '--correct-downscaling=yes', '--linear-downscaling=yes', '--sigmoid-upscaling=yes',
  '--deband=yes', '--deband-iterations=2', '--deband-threshold=48', '--deband-range=16', '--deband-grain=32',
  '--video-sync=display-resample', '--interpolation=yes', '--tscale=oversample', '--framedrop=vo', '--vd-lavc-threads=4',
  '--cache=yes', '--demuxer-max-bytes=150MiB', '--demuxer-max-back-bytes=50MiB', '--demuxer-seekable-cache=yes', '--hr-seek=yes',
  '--volume-max=200', '--audio-pitch-correction=yes', '--ad-lavc-downmix=no', '--audio-channels=auto-safe',
  '--slang=ar,ara,arabic,en,eng', '--alang=ar,ara,arabic,en,eng,ja,jpn', '--sub-auto=fuzzy',
  '--sub-font=Segoe UI', '--sub-pos=94', '--sub-margin-y=26', '--sub-font-size=40', '--sub-scale=1.0', '--secondary-sub-pos=8',
  '--sub-border-size=2.2', '--sub-shadow-offset=1.2', '--sub-shadow-color=#90000000',
  '--sub-ass-force-margins=yes', '--sub-ass-shaper=complex', '--sub-ass-override=scale', '--sub-codepage=auto',
  '--network-timeout=20', '--ytdl=no',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5',
  '--tone-mapping=bt.2446a', '--hdr-compute-peak=yes', '--target-peak=auto', '--target-colorspace-hint=yes',
];

const SPDIF_CODECS = 'ac3,eac3,dts-hd,truehd';
const VSR_VF = 'd3d11vpp=scale=2:scaling-mode=nvidia';
const RTX_HDR_VF = 'd3d11vpp=format=x2bgr10:nvidia-true-hdr,format=x2bgr10:transfer=pq:primaries=bt.2020';
const RTX_BOTH_VF = 'd3d11vpp=scale=2:scaling-mode=nvidia:format=x2bgr10:nvidia-true-hdr,format=x2bgr10:transfer=pq:primaries=bt.2020';

function rtxFilterFor(vsr, rtxHdr) {
  if (vsr && rtxHdr) return RTX_BOTH_VF;
  if (vsr) return VSR_VF;
  if (rtxHdr) return RTX_HDR_VF;
  return '';
}

const BUFFER_PRESETS = {
  small: ['64MiB', '24MiB'],
  auto: ['150MiB', '50MiB'],
  medium: ['256MiB', '64MiB'],
  large: ['512MiB', '128MiB'],
  max: ['1024MiB', '256MiB'],
};

const SAFE_TONE_MAPS = new Set(['bt.2446a', 'spline', 'bt.2390', 'hable', 'mobius', 'reinhard', 'clip']);

const SAFE_MPV_CONF_KEYS = new Set([
  'scale', 'cscale', 'dscale', 'tscale', 'deband', 'deband-iterations', 'deband-threshold',
  'deband-range', 'deband-grain', 'sharpen', 'sigmoid-upscaling', 'correct-downscaling',
  'linear-downscaling', 'dither-depth', 'temporal-dither', 'interpolation', 'video-sync',
  'framedrop', 'tone-mapping', 'tone-mapping-param', 'hdr-compute-peak', 'target-peak',
  'gamut-mapping-mode', 'audio-channels', 'audio-normalize-downmix', 'volume-max',
  'sub-font', 'sub-font-size', 'sub-scale', 'sub-pos', 'sub-border-size', 'sub-shadow-offset',
  'sub-bold', 'sub-margin-y', 'demuxer-max-bytes', 'demuxer-max-back-bytes', 'cache-secs',
  'network-timeout',
]);

function parseSafeMpvConf(raw) {
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || clean.startsWith(';')) continue;
    const eq = clean.indexOf('=');
    if (eq <= 0) continue;
    const k = clean.slice(0, eq).trim().toLowerCase();
    const v = clean.slice(eq + 1).trim();
    if (!SAFE_MPV_CONF_KEYS.has(k) || !v || /[\r\n\0]/.test(v) || v.length > 160) continue;
    out.push([k, v]);
  }
  return out;
}

const SUB_LANG_ISO = {
  arabic: 'ara', ara: 'ara', ar: 'ara',
  english: 'eng', eng: 'eng', en: 'eng',
  japanese: 'jpn', jpn: 'jpn', ja: 'jpn',
  french: 'fre', fre: 'fre', fra: 'fre', fr: 'fre',
  spanish: 'spa', spa: 'spa', es: 'spa',
  german: 'ger', ger: 'ger', deu: 'ger', de: 'ger',
  turkish: 'tur', tur: 'tur', tr: 'tur',
  korean: 'kor', kor: 'kor', ko: 'kor',
  italian: 'ita', ita: 'ita', it: 'ita',
  portuguese: 'por', por: 'por', pt: 'por',
  russian: 'rus', rus: 'rus', ru: 'rus',
  chinese: 'chi', chi: 'chi', zho: 'chi', zh: 'chi',
};

function normalizeSubLang2(code) {
  const s = String(code || '').trim().toLowerCase();
  if (!s || s === 'off' || s === 'no') return '';
  return SUB_LANG_ISO[s] || (/^[a-z]{2,3}$/.test(s) ? s : '');
}

function subStyleToMpvOpts(st) {
  if (!st || typeof st !== 'object') return [];
  const pairs = [];
  if (typeof st.font === 'string' && st.font.trim() && !/[\r\n\0]/.test(st.font)) {
    pairs.push(['sub-font', st.font.trim().slice(0, 64)]);
  }
  const color = /^#[0-9a-f]{6}$/i.test(String(st.color || '')) ? String(st.color).toUpperCase() : '#FFFFFF';
  const pct = Number.isFinite(Number(st.opacityPct)) ? Math.max(10, Math.min(100, Number(st.opacityPct))) : 100;
  const alphaHex = pct < 100 ? Math.round((pct / 100) * 255).toString(16).padStart(2, '0').toUpperCase() : '';
  pairs.push(['sub-color', alphaHex ? `#${alphaHex}${color.slice(1)}` : color]);
  if (st.bold !== undefined) pairs.push(['sub-bold', st.bold ? 'yes' : 'no']);
  if (Number.isFinite(Number(st.sizePct))) {
    const scale = Math.max(0.4, Math.min(3, Number(st.sizePct) / 100));
    pairs.push(['sub-scale', String(Math.round(scale * 100) / 100)]);
  }
  if (Number.isFinite(Number(st.bottomPct))) {
    const pos = Math.max(40, Math.min(100, 100 - Math.round(Number(st.bottomPct))));
    pairs.push(['sub-pos', String(pos)]);
  }
  if (['left', 'center', 'right'].includes(st.align)) {
    pairs.push(['sub-align-x', st.align]);
  }
  const outline = Number.isFinite(Number(st.outlinePx)) ? Math.max(0, Math.min(6, Number(st.outlinePx))) : 2.2;
  if (st.background === 'bar') {
    pairs.push(['sub-border-style', 'opaque-box'], ['sub-back-color', '#C0000000'], ['sub-border-size', String(outline)]);
  } else if (st.background === 'shadow') {
    pairs.push(['sub-border-style', 'outline-and-shadow'], ['sub-border-size', '0'], ['sub-shadow-offset', String(Math.max(1, outline))]);
  } else {
    pairs.push(['sub-border-style', 'outline-and-shadow'], ['sub-border-size', String(outline)], ['sub-shadow-offset', '1.2']);
  }
  return pairs;
}

function findInPath(exeName) {
  const pathEnv = String(process.env.PATH || '');
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    try {
      const full = path.join(dir, exeName);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {}
  }
  return null;
}

function findExternalPlayer(kind = 'mpv') {
  const k = String(kind || 'mpv').toLowerCase();
  if (k === 'vlc') {
    const cands = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
      findInPath('vlc.exe'),
    ].filter(Boolean);
    return cands.find((p) => fs.existsSync(p)) || null;
  }
  const cands = [
    mpvPath(),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'mpv', 'mpv.exe'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'mpv.exe'),
    findInPath('mpv.exe'),
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

function launchExternalPlayer({ kind = 'mpv', url, title = '', headers = {}, posSec = 0 } = {}) {
  const exe = findExternalPlayer(kind);
  if (!exe) return { ok: false, player: kind, error: `${kind}_not_found` };
  if (!url || typeof url !== 'string' || /[\r\n\0]/.test(url) || url.trim().startsWith('-')) {
    return { ok: false, player: kind, error: 'invalid_url' };
  }
  const isHttp = /^https?:\/\//i.test(url);
  const isLocal = !isHttp && path.isAbsolute(url) && fs.existsSync(url);
  if (!isHttp && !isLocal) return { ok: false, player: kind, error: 'invalid_url' };
  const safeTitle = String(title || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 120);
  const startSec = Number.isFinite(Number(posSec)) && Number(posSec) > 1 ? Math.floor(Number(posSec)) : 0;
  const hdrEntries = headers && typeof headers === 'object' ? Object.entries(headers) : [];
  const args = [];
  if (String(kind).toLowerCase() === 'vlc') {
    if (safeTitle) args.push(`--meta-title=${safeTitle}`);
    if (startSec > 0) args.push(`--start-time=${startSec}`);
    for (const [hk, hv] of hdrEntries) {
      const kl = String(hk || '').toLowerCase();
      const vv = String(hv || '').replace(/[\r\n\0]+/g, ' ').trim();
      if (!vv) continue;
      if (kl === 'user-agent') args.push(`--http-user-agent=${vv}`);
      else if (kl === 'referer' || kl === 'referrer') args.push(`--http-referrer=${vv}`);
    }
    args.push(url);
  } else {
    if (safeTitle) args.push(`--force-media-title=${safeTitle}`);
    if (startSec > 0) args.push(`--start=${startSec}`);
    const cleanPairs = hdrEntries
      .map(([hk, hv]) => `${String(hk).replace(/[\r\n\0:]+/g, '').trim()}: ${String(hv).replace(/[\r\n\0]+/g, ' ').trim()}`)
      .filter((s) => s.length > 2);
    if (cleanPairs.length) args.push(`--http-header-fields=${cleanPairs.join(',')}`);
    args.push('--', url);
  }
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { ok: true, player: kind, exe };
}

function buildMpvArgs({
  args = [], vsr = false, rtxHdr = false, spdif = false, decoderMode = 1, shaderCacheDir = null,
  subFilterSdh = false, fontsDir = subFontsDir(), hwAccel = true, hdrMode = null, toneMapping = null,
  bufferSize = null, anime4k = false, anime4kMode = 'A', subStyle = null, subLang2 = null,
  customMpvConf = '', userDataDir = null,
} = {}) {
  const rtxOn = !!(vsr || rtxHdr);
  const hasHwdec = args.some((x) => typeof x === 'string' && x.startsWith('--hwdec='));
  const wantSw = hwAccel === false || decoderMode === 2;
  let base = (hasHwdec || rtxOn || decoderMode !== 1 || hwAccel === false) ? BASE.filter((x) => !x.startsWith('--hwdec=')) : [...BASE];
  const replacePrefix = (prefix, val) => {
    base = base.filter((x) => !x.startsWith(prefix));
    if (val) base.push(`${prefix}${val}`);
  };
  if (!hasHwdec) {
    if (wantSw && !rtxOn) {
      base.push('--hwdec=no', '--vd-lavc-software-fallback=yes');
    } else if (decoderMode === 0) {
      base.push(`--hwdec=${rtxOn ? 'd3d11va' : 'auto-safe'}`, '--vd-lavc-software-fallback=no');
    } else if (rtxOn) {
      base.push('--hwdec=d3d11va', '--vd-lavc-software-fallback=yes');
    }
  }
  if (hdrMode === 'sdr') replacePrefix('--target-colorspace-hint=', 'no');
  if (toneMapping && SAFE_TONE_MAPS.has(toneMapping)) replacePrefix('--tone-mapping=', toneMapping);
  const buf = bufferSize && BUFFER_PRESETS[bufferSize];
  if (buf) {
    replacePrefix('--demuxer-max-bytes=', buf[0]);
    replacePrefix('--demuxer-max-back-bytes=', buf[1]);
  }
  const s2 = normalizeSubLang2(subLang2);
  if (s2) {
    const langs = [...new Set(['ar', 'ara', 'arabic', s2, 'en', 'eng'])];
    replacePrefix('--slang=', langs.join(','));
  }
  const vf = rtxFilterFor(vsr, rtxHdr);
  if (vf && !args.some((x) => typeof x === 'string' && x.includes('d3d11vpp'))) {
    base.push('--d3d11-adapter=NVIDIA', `--vf=${vf}`);
  }
  if (spdif && !args.some((x) => typeof x === 'string' && x.startsWith('--audio-spdif='))) base.push(`--audio-spdif=${SPDIF_CODECS}`);
  if (shaderCacheDir && !args.some((x) => typeof x === 'string' && x.startsWith('--gpu-shader-cache-dir='))) base.push(`--gpu-shader-cache-dir=${shaderCacheDir}`);
  if (subFilterSdh && !args.some((x) => typeof x === 'string' && x.startsWith('--sub-filter-sdh='))) base.push('--sub-filter-sdh=yes', '--sub-filter-sdh-harder=yes');
  if (fontsDir && !args.some((x) => typeof x === 'string' && x.startsWith('--sub-fonts-dir='))) base.push(`--sub-fonts-dir=${fontsDir}`);
  if (anime4k) {
    base.push('--deband=yes', '--sharpen=0.55');
    const { files } = listInstalledShaders(userDataDir);
    const modeTag = String(anime4kMode || 'A').replace(/[^ABC]/gi, '').toUpperCase();
    const matched = files.filter((f) => /anime4k/i.test(path.basename(f)) && (!modeTag || new RegExp(`mode[_-]?${modeTag}|clamp|restore|upscale`, 'i').test(path.basename(f))));
    if (matched.length) base.push(`--glsl-shaders=${matched.join(';')}`);
  }
  for (const [k, v] of subStyleToMpvOpts(subStyle)) replacePrefix(`--${k}=`, v);
  for (const [k, v] of parseSafeMpvConf(customMpvConf)) replacePrefix(`--${k}=`, v);
  return [...base, ...args];
}

const WATCHED = [
  'time-pos', 'duration', 'pause', 'paused-for-cache', 'demuxer-cache-duration', 'speed', 'eof-reached',
  'track-list', 'volume', 'mute', 'sid', 'secondary-sid', 'aid', 'sub-delay', 'audio-delay',
  'chapter-list', 'chapter', 'hwdec-current', 'video-params', 'audio-params', 'video-bitrate',
  'video-codec', 'estimated-vf-fps', 'frame-drop-count', 'avsync', 'cache-speed', 'core-idle',
  'sub-scale', 'sub-pos', 'video-zoom', 'panscan', 'brightness', 'contrast', 'saturation', 'gamma',
];

class Mpv extends EventEmitter {
  constructor({ wid, exe = mpvPath(), args = [], vsr = false, rtxHdr = false, spdif = false, decoderMode = 1, shaderCacheDir = null, subFilterSdh = false, fontsDir, hwAccel = true, hdrMode = null, toneMapping = null, bufferSize = null, anime4k = false, anime4kMode = 'A', subStyle = null, subLang2 = null, customMpvConf = '', userDataDir = null } = {}) {
    super();
    this.exe = exe; this.wid = wid; this.args = args; this.vsr = vsr; this.rtxHdr = rtxHdr; this.spdif = spdif;
    this.decoderMode = decoderMode; this.shaderCacheDir = shaderCacheDir; this.subFilterSdh = subFilterSdh; this.fontsDir = fontsDir;
    this.hwAccel = hwAccel; this.hdrMode = hdrMode; this.toneMapping = toneMapping; this.bufferSize = bufferSize;
    this.anime4k = anime4k; this.anime4kMode = anime4kMode; this.subStyle = subStyle; this.subLang2 = subLang2;
    this.customMpvConf = customMpvConf; this.userDataDir = userDataDir;
    this.reqs = new Map(); this.nextId = 1; this.props = {};
    this.restarts = 0; this.stopped = false; this.want = null; // what's loaded: { url, opts }
    this.lastStderr = ''; this.earlyError = null; this._vsrFallbackTried = false;
    this.wd = null; this._killTimer = null;
  }

  start() {
    if (!this.exe) throw new Error('mpv not found');
    this.stopped = false;
    this.lastStderr = '';
    this.earlyError = null;
    this.pipe = `\\\\.\\pipe\\majlis-mpv-${process.pid}-${Date.now() % 1e6}`;
    const a = [
      ...buildMpvArgs({
        args: this.args, vsr: this.vsr, rtxHdr: this.rtxHdr, spdif: this.spdif, decoderMode: this.decoderMode,
        shaderCacheDir: this.shaderCacheDir, subFilterSdh: this.subFilterSdh, fontsDir: this.fontsDir,
        hwAccel: this.hwAccel, hdrMode: this.hdrMode, toneMapping: this.toneMapping, bufferSize: this.bufferSize,
        anime4k: this.anime4k, anime4kMode: this.anime4kMode, subStyle: this.subStyle, subLang2: this.subLang2,
        customMpvConf: this.customMpvConf, userDataDir: this.userDataDir,
      }),
      `--input-ipc-server=${this.pipe}`,
    ];
    if (this.wid) a.push(`--wid=${this.wid}`);
    const p = spawn(this.exe, a, { windowsHide: !this.wid, stdio: ['ignore', 'ignore', 'pipe'] });
    this.p = p;
    p.stderr?.on('data', (d) => {
      this.lastStderr = (this.lastStderr + d.toString('utf8')).slice(-4096);
    });
    p.on('exit', (code) => {
      const wasConnected = !!this.sock;
      if (this.p === p) this.p = null;
      this.sock?.destroy(); this.sock = null;
      for (const r of this.reqs.values()) r.reject(new Error('mpv exited'));
      this.reqs.clear();
      if (!wasConnected) {
        const lastLine = this.lastStderr.trim().split(/\r?\n/).filter(Boolean).pop() || '';
        this.earlyError = new Error(lastLine || `mpv exited ${code}`);
        return;
      }
      if (!this.stopped && this.want) this._recover(`exit ${code}`);
    });
    return this._connect().catch(async (err) => {
      if ((this.vsr || this.rtxHdr) && !this._vsrFallbackTried && /d3d11vpp|scaler|scaling-mode|nvidia|vf|hwdec|option/i.test(`${err.message}\n${this.lastStderr}`)) {
        this._vsrFallbackTried = true;
        this.vsr = false;
        this.rtxHdr = false;
        this.emit('vsr-fallback', err.message);
        return this.start();
      }
      throw err;
    });
  }

  _connect(tries = 0) {
    return new Promise((resolve, reject) => {
      if (this.earlyError) return reject(this.earlyError);
      const s = net.connect(this.pipe);
      s.once('connect', () => {
        this.sock = s; let buf = '';
        s.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) this._line(line); }
        });
        s.on('error', () => {});
        WATCHED.forEach((p, n) => this._send({ command: ['observe_property', n + 1, p] }));
        if (this.want) this._watch();
        this.emit('ready');
        resolve();
      });
      s.once('error', () => {
        s.destroy();
        if (this.earlyError) return reject(this.earlyError);
        if (this.stopped || !this.p || tries > 50) return reject(new Error(this.lastStderr.trim().split(/\r?\n/).pop() || 'mpv pipe not reachable'));
        setTimeout(() => this._connect(tries + 1).then(resolve, reject), 100);
      });
    });
  }

  _line(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.request_id != null && this.reqs.has(m.request_id)) {
      const r = this.reqs.get(m.request_id); this.reqs.delete(m.request_id);
      return m.error === 'success' ? r.resolve(m.data) : r.reject(new Error(m.error));
    }
    if (m.event === 'property-change') {
      this.props[m.name] = m.data;
      if (m.name === 'time-pos' && m.data != null) { this.lastPos = m.data; this.posAt = Date.now(); }
      this.emit('prop', m.name, m.data);
    } else if (m.event) this.emit('event', m);
  }

  _send(o) { if (this.sock) this.sock.write(JSON.stringify(o) + '\n'); }

  command(...args) {
    if (!this.sock) return Promise.reject(new Error('mpv not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (this.reqs.delete(id)) reject(new Error(`mpv: ${args[0]} timed out`)); }, 10000);
      this.reqs.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this._send({ command: args, request_id: id });
    });
  }
  set(name, value) { return this.command('set_property', name, value); }
  get(name) { return this.command('get_property', name); }

  resetPlaybackProps() {
    for (const k of ['duration', 'time-pos', 'eof-reached', 'paused-for-cache', 'video-params', 'audio-params', 'core-idle', 'frame-drop-count', 'video-bitrate', 'cache-speed']) {
      delete this.props[k];
    }
    this.lastPos = 0;
  }

  // Called synchronously on player close so _watch() can never resurrect a closed session
  clearPlayback() {
    this.want = null;
    this.restarts = 0;
    clearInterval(this.wd);
    this.wd = null;
    this.resetPlaybackProps();
  }

  async clearExternalSubs() {
    const tracks = Array.isArray(this.props['track-list']) ? this.props['track-list'] : await this.get('track-list').catch(() => []);
    for (const tr of tracks || []) {
      if (tr?.type === 'sub' && tr.external && tr.id != null) await this.command('sub-remove', tr.id).catch(() => {});
    }
  }

  // `opts` are per-file options mpv applies on load (start, sub-files, http headers...)
  async load(url, opts = {}) {
    if (!url || typeof url !== 'string' || /[\r\n\0]/.test(url) || url.trim().startsWith('-')) {
      throw new Error('invalid_url');
    }
    const SAFE_LOAD_OPTS = new Set(['start', 'http-header-fields', 'user-agent', 'referrer', 'force-media-title', 'sub-files']);
    this.want = { url, opts };
    this.resetPlaybackProps();
    this._watch();
    const o = Object.entries(opts || {})
      .filter(([k]) => SAFE_LOAD_OPTS.has(k))
      .map(([k, v]) => `${k}=${String(v ?? '').replace(/[\r\n\0]+/g, ' ').trim()}`)
      .join(',');
    return o ? this.command('loadfile', url, 'replace', -1, o) : this.command('loadfile', url, 'replace');
  }

  // Hung: playing, not waiting for data, yet the clock hasn't moved for 5 s. Or gone: exited.
  // Never fires when want is null (closed/idle).
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
    clearInterval(this.wd);
    this.wd = null;
    const at = this.lastPos || 0, want = this.want, paused = this.props.pause, speed = this.props.speed;
    try { this.p?.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    if (this.stopped || !this.want || this.want !== want) { this.recovering = false; return; }
    try {
      await this.start();
      if (this.stopped || !this.want || this.want !== want) {
        await this.command('stop').catch(() => {});
        this.recovering = false;
        return;
      }
      await this.load(want.url, { ...want.opts, start: `${at.toFixed(3)}` });
      if (paused) await this.set('pause', true);
      if (speed && speed !== 1) await this.set('speed', speed);
      this.emit('recovered', { why, at });
    } catch (e) { this.emit('failed', e.message); }
    this.recovering = false;
  }

  stop(immediate = false) {
    this.stopped = true;
    this.clearPlayback();
    clearTimeout(this._killTimer);
    try { this._send({ command: ['quit'] }); } catch {}
    const p = this.p;
    if (!p) return;
    if (immediate) {
      try { p.kill(); } catch {}
      this.p = null;
      return;
    }
    this._killTimer = setTimeout(() => { try { p.kill(); } catch {} }, 800);
    this._killTimer.unref?.();
  }
}

module.exports = {
  Mpv, mpvPath, subFontsDir, findShadersDir, listInstalledShaders, buildMpvArgs, rtxFilterFor,
  BUFFER_PRESETS, SAFE_TONE_MAPS, parseSafeMpvConf, subStyleToMpvOpts, normalizeSubLang2,
  findExternalPlayer, launchExternalPlayer, BASE, WATCHED, SPDIF_CODECS, VSR_VF, RTX_HDR_VF, RTX_BOTH_VF,
};
