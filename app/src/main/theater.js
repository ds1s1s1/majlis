'use strict';
// Cinema mode in the main process: the media service (catalogs, streams, torrents), mpv, and
// the two windows the film is shown in. mpv draws in its own borderless window (given an
// Electron window via --wid, Chromium's compositor painted over it: black); the engine makes it
// owned by the app window and lays it exactly over it. The controls live in a transparent
// window owned by mpv's, so HTML sits on top of the video. Both follow the app window's bounds.
const { BrowserWindow, ipcMain, screen, dialog, powerSaveBlocker, app, clipboard, nativeImage } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Mpv, SPDIF_CODECS, rtxFilterFor, subStyleToMpvOpts, normalizeSubLang2, launchExternalPlayer, SAFE_TONE_MAPS, subFontsDir } = require('./mpv');
const { LibMpv, libmpvPath } = require('./libmpv');
const { core } = require('./net');
const { validatePlayUrl } = require('./media/http');
const { resolveVideoStream, isYouTubeUrl } = require('./media/ytdlp');
const { parseTorrentBuffer } = require('./media/torrent-parse');
const { prepareSubtitleFile, formatAddonSubTitle, langDisplay, parseSrtCueStarts } = require('./media/sub-rtl');
const { StremioServerService } = require('./stremio-server');
const { SyncViewer, expected } = require('./sync');
const { findFfmpeg } = require('./encoder');
const { CinemaDimmer } = require('./dimmer');
const { detectDoubleLength } = require('./media/multi-ep');
const imp = require('./imports');

const { normalizeGenres } = require('./media/genres');

const NIGHT = '@night:lavfi=[dynaudnorm=f=150:g=15:p=0.9,acompressor=threshold=-20dB:ratio=3:attack=10:release=250]';
const VOICE_CLARITY = '@voice:lavfi=[highpass=f=120,equalizer=f=1000:width_type=h:width=2200:g=5.5,equalizer=f=2800:width_type=h:width=1200:g=3.5,acompressor=threshold=-22dB:ratio=2.4:attack=8:release=180]';

const DISPLAY_PROFILES = {
  oled: { toneMapping: 'bt.2446a', debandGrain: 16, gamma: -2, contrast: 2, saturation: 3 },
  hdr: { toneMapping: 'bt.2446a', debandGrain: 24, gamma: 0, contrast: 0, saturation: 2 },
  ips: { toneMapping: 'bt.2390', debandGrain: 32, gamma: 2, contrast: 4, saturation: 4 },
  standard: { toneMapping: 'bt.2446a', debandGrain: 32, gamma: 0, contrast: 0, saturation: 0 },
};

function detectDisplayProfile(display) {
  if (!display || typeof display !== 'object') return 'ips';
  const label = String(display.label || display.name || '');
  if (/oled|qd-oled|woled|aw3423|pg32ucdm|fo32u2|\b[cg][1-4]\b/i.test(label)) return 'oled';
  const cd = Number(display.colorDepth) || 24;
  const cs = String(display.colorSpace || '');
  if (cd > 24 || /hdr|rec2020|p3/i.test(cs)) return 'hdr';
  return 'ips';
}

function sanitizeHeaderPair(k, v) {
  return `${String(k).replace(/[\r\n:]/g, '').trim()}: ${String(v).replace(/[\r\n]/g, ' ').trim()}`.replace(/,/g, '\\,');
}

const EDITION_RE = [
  ['directors_cut', /\bdirector'?s[\s._-]*cut\b/i, "Director's Cut"],
  ['extended', /\bextended(?:[\s._-]*(?:cut|edition))?\b/i, 'Extended'],
  ['unrated', /\bunrated\b/i, 'Unrated'],
  ['theatrical', /\btheatrical(?:[\s._-]*(?:cut|edition))?\b/i, 'Theatrical'],
  ['imax', /\bimax\b/i, 'IMAX'],
  ['remastered', /\bremastered\b/i, 'Remastered'],
  ['open_matte', /\bopen[\s._-]*matte\b/i, 'Open Matte'],
];

function extractEditions(name) {
  const s = String(name || '');
  if (!s) return [];
  return EDITION_RE.filter(([, re]) => re.test(s)).map(([id, , label]) => ({ id, label }));
}

function detectSourceMismatch({ hostDur = 0, localDur = 0, hostFilename = '', localFilename = '' } = {}) {
  const hd = Number(hostDur) || 0;
  const ld = Number(localDur) || 0;
  if (hd > 0 && ld > 0 && Math.abs(hd - ld) > 12) {
    return {
      reason: 'duration',
      diffSec: Math.round(Math.abs(hd - ld)),
      hostDur: Math.round(hd),
      localDur: Math.round(ld),
    };
  }
  const he = extractEditions(hostFilename);
  const le = extractEditions(localFilename);
  const hSet = new Set(he.map((x) => x.id));
  const lSet = new Set(le.map((x) => x.id));
  if ((he.length || le.length) && (he.some((x) => !lSet.has(x.id)) || le.some((x) => !hSet.has(x.id)))) {
    return {
      reason: 'edition',
      hostEdition: he.map((x) => x.label).join(', ') || 'Standard',
      localEdition: le.map((x) => x.label).join(', ') || 'Standard',
    };
  }
  return null;
}

function setup({ getWin, store, emit, preload, theaterPreload, rendererDir, helper, getHost, getGuest, getMediaHub = () => null, getSocial = () => null, getFfmpeg, getCacheManager = () => null, openExternal = () => {}, onTheaterState, onTheaterClose = () => {}, onPresenceChange = () => {}, isIncognito = () => false, onPlaybackStateChange = () => {} }) {
  const svc = new StremioServerService({
    getCacheDir: () => getCacheManager?.()?.streamCacheDir?.() || store.get('cachePath') || '',
    getSettings: () => store?.d,
    getFfmpeg,
    adoptProcess: (pid) => { try { core?.adoptProcess?.(pid); } catch {} },
  });
  const dimmer = new CinemaDimmer();
  let overlay = null, overlayReady = false, mpv = null, now = null, film = 0, shown = false, lastFit = '', lastOverlayBounds = '', lastWinFs = null;
  let playGen = 0, wakeLockId = null, hudVisible = false, userSubPos = 94;
  let sleepEof = false, suppressAutoNext = false, partySession = null, pipActive = false;
  let curPhase = '', curStatusMsg = '', tempSubFiles = [], resizeTimer = null, settleTimers = [];
  let html5Active = false, html5TranscodeId = null, blackScreenTimer = null, startupWatchTimer = null, html5FallbackTried = false, swFallbackTried = false;
  let virtualProps = {};
  const initTone = store.get('playerToneMapping');
  let curAspect = store.get('playerAspect') || 'fit', curTone = SAFE_TONE_MAPS.has(initTone) ? initTone : 'bt.2446a';
  let curHwAccel = store.get('playerHwAccel') !== false, curSdh = !!store.get('subFilterSdh'), curSubFpsMode = 'reset';
  let curDimmerPct = Math.max(0, Math.min(100, Number(store.get('cinemaDimmerPct')) || 0));
  let curDisplayProfile = store.get('playerDisplayProfile') || 'auto';
  let detectedDisplayProfile = 'ips';
  let curVoiceClarity = !!store.get('voiceClarity');
  let curWarmTint = Math.max(0, Math.min(100, Number(store.get('cinemaWarmTint')) || 0));
  let curNight = false;
  let lastPartyState = null, partyVotes = [], lastMismatch = null;
  const THROTTLED_STATS = new Set(['demuxer-cache-duration', 'cache-speed', 'video-bitrate', 'estimated-vf-fps', 'avsync', 'frame-drop-count']);
  let lastPosEmitAt = 0;
  let lastStructSig = '';
  let lastPeersEmitAt = 0;
  const lastStatEmitAt = new Map();
  const incog = () => !!isIncognito?.();
  const applyAudioFilters = () => {
    if (!mpv || mpv.stopped) return Promise.resolve();
    const spec = [curNight ? NIGHT : null, curVoiceClarity ? VOICE_CLARITY : null].filter(Boolean).join(',');
    return mpv.command('af', 'set', spec).catch(() => {});
  };
  const applyDisplayProfile = (mode = curDisplayProfile, applyEq = true) => {
    try {
      const w = getWin();
      const d = w && !w.isDestroyed() ? screen.getDisplayMatching(w.getBounds()) : screen.getPrimaryDisplay();
      detectedDisplayProfile = detectDisplayProfile(d);
    } catch {}
    const eff = mode === 'auto' ? detectedDisplayProfile : (DISPLAY_PROFILES[mode] ? mode : 'standard');
    const prof = DISPLAY_PROFILES[eff] || DISPLAY_PROFILES.standard;
    if (mpv && !mpv.stopped) {
      if (SAFE_TONE_MAPS.has(prof.toneMapping)) {
        curTone = prof.toneMapping;
        mpv.set('tone-mapping', prof.toneMapping).catch(() => {});
      }
      mpv.set('deband-grain', prof.debandGrain).catch(() => {});
      if (applyEq) {
        for (const k of ['gamma', 'contrast', 'saturation']) mpv.set(k, prof[k] || 0).catch(() => {});
      }
    }
    return { mode: curDisplayProfile, effective: eff, detected: detectedDisplayProfile, toneMapping: curTone };
  };
  const hwnd = (bw) => Number(bw.getNativeWindowHandle().readBigUInt64LE(0));
  const canNativeLibMpv = () => !!(core?.NativeMpvPlayer && libmpvPath());
  const getProps = () => (html5Active ? virtualProps : (mpv?.props || virtualProps));
  const clearBlackScreenWatch = () => {
    if (blackScreenTimer) { clearTimeout(blackScreenTimer); blackScreenTimer = null; }
  };
  const clearStartupWatch = () => {
    if (startupWatchTimer) { clearTimeout(startupWatchTimer); startupWatchTimer = null; }
  };
  const clearSettleTimers = () => {
    for (const t of settleTimers.splice(0)) clearTimeout(t);
  };
  const scheduleSettleFit = () => {
    clearSettleTimers();
    for (const ms of [60, 220]) {
      const t = setTimeout(() => { if (shown) fit(true); }, ms);
      t.unref?.();
      settleTimers.push(t);
    }
  };
  const isHttpFallbackCandidate = (u) => !!u && /^https?:\/\//i.test(u) && !/^av:/i.test(u);
  const stopHtml5Fallback = () => {
    clearBlackScreenWatch();
    if (html5TranscodeId) { svc.destroyHls(html5TranscodeId).catch(() => {}); html5TranscodeId = null; }
    if (html5Active) {
      html5Active = false;
      toOverlay({ type: 'html5-fallback', active: false });
    }
  };
  const subTempDir = () => { try { return path.join(app.getPath('temp'), 'majlis-subs'); } catch { return path.join(os.tmpdir(), 'majlis-subs'); } };
  const cleanupTempSubs = () => { for (const f of tempSubFiles.splice(0)) { try { fs.unlinkSync(f); } catch {} } };
  const trackTempSub = (orig, prepared) => { if (prepared && prepared !== orig && !/^https?:\/\//i.test(prepared) && !tempSubFiles.includes(prepared)) tempSubFiles.push(prepared); return prepared || orig; };
  const pad2 = (n) => String(Math.max(0, Number(n) || 0)).padStart(2, '0');
  const formatEpCode = (s, e) => (s != null && e != null ? `S${pad2(s)}E${pad2(e)}` : '');
  const looksRawId = (v) => /^(tt\d+|(kitsu|anilist|mal):)/i.test(String(v || '').trim());
  const ackFrame = () => {};
  let party = null;
  let userVol = Math.max(0, Math.min(200, Number(store.get('playerVolume')) || 100)), duckGain = 1, lastVoiceAt = 0;
  const thumbCache = new Map();
  let thumbProc = null;
  const bookmarkKeyOf = () => (now ? String(now.key || now.card?.metaId || '') : '');
  const getBookmarks = () => {
    const k = bookmarkKeyOf();
    if (!k) return [];
    const all = store.d.sceneBookmarks || {};
    return Array.isArray(all[k]) ? all[k] : [];
  };
  const saveBookmarks = (list) => {
    const k = bookmarkKeyOf();
    if (!k) return [];
    store.d.sceneBookmarks = store.d.sceneBookmarks || {};
    store.d.sceneBookmarks[k] = list.slice(0, 60);
    store.save();
    return store.d.sceneBookmarks[k];
  };

  const setWakeLock = (active) => {
    try {
      if (active && wakeLockId == null) wakeLockId = powerSaveBlocker.start('prevent-display-sleep');
      else if (!active && wakeLockId != null) { if (powerSaveBlocker.isStarted(wakeLockId)) powerSaveBlocker.stop(wakeLockId); wakeLockId = null; }
    } catch { wakeLockId = null; }
  };

  // Profiles ("who's watching"): each has its own addons, progress, library and ratings.
  const profile = () => store.get('mediaProfile') || 'default';
  const pk = (k) => (profile() === 'default' ? k : `${k}@${profile()}`);
  const pget = (k) => store.get(pk(k));
  const pset = (k, v) => store.set(pk(k), v);
  const progress = () => pget('mediaProgress') || {};
  const toOverlay = (m) => {
    if (m?.type === 'theater' && m.phase !== undefined) curPhase = m.phase || '';
    if (m?.type === 'player-state' && (m.state === 'opening' || m.state === 'trying-source' || m.state === 'recovering')) {
      curPhase = m.state === 'trying-source' ? 'trying-source' : 'opening';
      curStatusMsg = m.detail || '';
    }
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('ev', m);
  };
  const onVoice = () => { lastVoiceAt = Date.now(); };

  function isHdrDisplay() {
    try {
      const w = getWin();
      const d = w && !w.isDestroyed() ? screen.getDisplayMatching(w.getBounds()) : screen.getPrimaryDisplay();
      return (d?.colorDepth || 24) > 24 || /hdr|rec2020|p3/i.test(String(d?.colorSpace || ''));
    } catch { return false; }
  }

  function slowestPartyMbps() {
    const rates = [];
    const own = store.get('downMbps') || store.peakHint?.()?.mbps || 0;
    if (own > 0) rates.push(own);
    const h = getHost?.();
    if (h?.guests?.size) {
      for (const g of h.guests.values()) {
        const kbps = g.rc?.target || g.fb?.kbps || g.maxKbps || 0;
        if (kbps > 0) rates.push(kbps / 1000);
      }
    }
    const g = getGuest?.();
    if (g?.link && g.last?.kbps > 0) rates.push(g.last.kbps / 1000);
    return rates.length ? Math.min(...rates) : 0;
  }

  function getDisplayHz() {
    try {
      const w = getWin();
      const d = w && !w.isDestroyed() ? screen.getDisplayMatching(w.getBounds()) : screen.getPrimaryDisplay();
      return d?.displayFrequency || 60;
    } catch { return 60; }
  }

  function fit(force = false) {
    const w = getWin();
    if (!w || w.isDestroyed() || !overlay || overlay.isDestroyed()) return;
    const min = w.isMinimized();
    const b = w.getContentBounds();
    if (!min && (b.width < 64 || b.height < 64)) return;
    const vis = shown && !min;
    const isFs = w.isFullScreen();
    const isMax = w.isMaximized();
    if (!min && vis) {
      // Keep Chromium Aura's DIP viewport 100% synced with main window across fullscreen/DPI changes
      const bKey = `${b.x},${b.y},${b.width},${b.height},${isFs ? 1 : 0}`;
      if (force || bKey !== lastOverlayBounds) {
        lastOverlayBounds = bKey;
        try { overlay.setBounds(b); } catch {}
      }
      if (force || isFs !== lastWinFs) {
        lastWinFs = isFs;
        toOverlay({ type: 'win-state', isFullscreen: isFs, isMaximized: isMax, width: b.width, height: b.height });
      }
    }
    if (mpv?.isNative) {
      mpv.setVideoVisible(!html5Active);
      mpv.setVisible(vis);
      if (vis) mpv.syncBounds();
      return;
    }
    if (!film) return;
    let rx, ry, rw, rh;
    try {
      const pr = screen.dipToScreenRect ? screen.dipToScreenRect(w, b) : null;
      if (pr && pr.width > 0 && pr.height > 0) ({ x: rx, y: ry, width: rw, height: rh } = pr);
    } catch {}
    if (!rw || !rh) {
      const f = screen.getDisplayMatching(b).scaleFactor;
      rx = Math.round(b.x * f); ry = Math.round(b.y * f); rw = Math.round(b.width * f); rh = Math.round(b.height * f);
    }
    const key = `${rx},${ry},${rw},${rh},${vis},${film},${html5Active}`;
    if (!force && key === lastFit) return;
    lastFit = key;
    if (vis && !helper.p) helper.start();
    const wh = hwnd(w);
    // CLI mpv.exe fallback: keep mpv owned by main window, and overlay owned by mpv (or main window while loading)
    if (film && !html5Active) helper.cmd({ cmd: 'place', hwnd: film, owner: wh, x: rx, y: ry, w: rw, h: rh, show: vis, top: vis });
    if (overlayReady) helper.cmd({ cmd: 'place', hwnd: hwnd(overlay), owner: (!html5Active && film) || wh, x: rx, y: ry, w: rw, h: rh, show: vis, top: vis });
  }

  let winHooksAttached = false;
  let lastQuickplay = null;
  let lastDisplayId = null;
  const resolvedPreload = theaterPreload || path.join(__dirname, '../preload/preload-theater.js');
  async function ensureOverlay() {
    const w = getWin();
    if (!overlay || overlay.isDestroyed()) {
      overlayReady = false;
      const b = w && !w.isDestroyed() ? w.getContentBounds() : { x: 100, y: 100, width: 1240, height: 800 };
      overlay = new BrowserWindow({
        parent: w && !w.isDestroyed() ? w : undefined,
        x: b.x, y: b.y, width: Math.max(320, b.width), height: Math.max(200, b.height),
        minWidth: 160, minHeight: 90,
        frame: false, show: false, skipTaskbar: true, resizable: true, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        hasShadow: false, transparent: true, backgroundColor: '#00000000',
        webPreferences: {
          preload: resolvedPreload || preload,
          contextIsolation: true, sandbox: true, nodeIntegration: false,
          webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
        },
      });
      overlay.setMenu(null);
      overlay.webContents.on('will-navigate', (e) => e.preventDefault());
      overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w?.once('closed', () => { if (overlay && !overlay.isDestroyed()) overlay.destroy(); overlay = null; });
      overlay.once('ready-to-show', () => {
        overlayReady = true;
        if (shown && overlay && !overlay.isDestroyed()) { overlay.show(); fit(true); overlay.focus(); }
      });
      await overlay.loadFile(path.join(rendererDir, 'theater.html'));
      overlayReady = true;
    }
    if (w && !w.isDestroyed() && !winHooksAttached) {
      winHooksAttached = true;
      const onDisplayOrState = () => {
        if (!shown) return;
        try {
          const d = screen.getDisplayMatching(w.getBounds());
          if (d && d.id !== lastDisplayId) {
            lastDisplayId = d.id;
            if (curDisplayProfile === 'auto') applyDisplayProfile('auto', false);
            if (curDimmerPct > 0) dimmer.apply({ activeWin: w, opacity: curDimmerPct });
            fit(true);
          }
        } catch {}
      };
      for (const ev of ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'restore', 'minimize']) {
        w.on(ev, () => {
          const big = ev !== 'move' && ev !== 'resize';
          fit(big);
          if (big && ev !== 'minimize') scheduleSettleFit();
        });
      }
      w.on('moved', onDisplayOrState);
      screen.on('display-metrics-changed', onDisplayOrState);
      w.once('closed', () => {
        winHooksAttached = false;
        clearTimeout(resizeTimer);
        screen.off('display-metrics-changed', onDisplayOrState);
      });
    }
  }

  async function activateHtml5Fallback(reason = 'codec') {
    if (html5Active || !now?.url || !shown) return false;
    if (store.get('playerHlsFallback') === false && reason !== 'manual') return false;
    if (!isHttpFallbackCandidate(now.url)) return false;
    html5FallbackTried = true;
    html5Active = true;
    clearBlackScreenWatch();
    const resumeSec = Math.max(0, Number(getProps()['time-pos'] || 0) || 0);
    if (mpv) {
      if (mpv.isNative) mpv.releaseMedia();
      else {
        mpv.clearPlayback();
        try { mpv.set('pause', true).catch(() => {}); mpv.command('stop').catch(() => {}); } catch {}
      }
    }
    fit(true);
    const rawUrl = now.url;
    let playUrl = rawUrl;
    let hlsId = null;
    if (!/\.(m3u8|mp4|webm|m4v)(\?|$)/i.test(rawUrl)) {
      try {
        const tr = await svc.hlsTranscodeUrl(rawUrl);
        playUrl = tr.url;
        hlsId = tr.id;
      } catch {
        playUrl = rawUrl;
      }
    }
    if (!shown || !html5Active) {
      if (hlsId) svc.destroyHls(hlsId).catch(() => {});
      return false;
    }
    html5TranscodeId = hlsId;
    virtualProps = { ...(virtualProps || {}), pause: false, 'time-pos': resumeSec };
    if (mpv?.props) { mpv.props.pause = false; mpv.props['time-pos'] = resumeSec; }
    toOverlay({ type: 'player-state', state: 'trying-source', detail: 'HLSv2' });
    toOverlay({
      type: 'html5-fallback',
      active: true,
      url: playUrl,
      startPos: resumeSec,
      reason,
      isHls: !!hlsId || /\.m3u8(\?|$)/i.test(playUrl),
    });
    return true;
  }

  function onPlayerProp(name, value) {
    if (!shown && name !== 'pause') return;
    if (name === 'time-pos' && Number(value) > 0 && now) {
      now.hasFirstFrame = true;
      clearStartupWatch();
      if (!getProps()['paused-for-cache']) now.stallSince = 0;
    }
    if (!html5Active && now?.url) {
      if (name === 'video-params' && value?.w > 0) {
        clearBlackScreenWatch();
        clearStartupWatch();
      } else if (name === 'time-pos' && Number(value) > 2.5 && !(getProps()['video-params']?.w) && !blackScreenTimer) {
        const watchGen = playGen;
        const watchKey = now.key;
        blackScreenTimer = setTimeout(async () => {
          blackScreenTimer = null;
          if (!shown || watchGen !== playGen || now?.key !== watchKey || html5Active || (getProps()['video-params']?.w) || Number(getProps()['time-pos'] || 0) <= 2.5) return;
          if (!html5FallbackTried && isHttpFallbackCandidate(now.url) && store.get('playerHlsFallback') !== false) {
            const ok = await activateHtml5Fallback('black-screen').catch(() => false);
            if (ok) return;
          }
          // Last-resort software decode recovery when GPU hwdec outputs audio with no video frames
          if (!swFallbackTried && mpv && !mpv.stopped) {
            swFallbackTried = true;
            const at = Math.max(0, Number(getProps()['time-pos'] || 0) || 0);
            curHwAccel = false;
            await mpv.set('hwdec', 'no').catch(() => {});
            if (now?.url) await mpv.load(now.url, { start: at.toFixed(2) }).catch(() => {});
            toOverlay({ type: 'toast', kind: 'info', text: 'SW Decode' });
          }
        }, 3500);
        blackScreenTimer.unref?.();
      }
    }
    if (name === 'paused-for-cache' && now) {
      if (!value) now.stallSince = 0;
      else if (!now.stallSince) now.stallSince = Date.now();
    }
    if (name === 'duration' && value && shown) { fit(true); if (mpv && !mpv.isNative) setTimeout(() => fit(true), 400); }
    if (name === 'pause') {
      setWakeLock(!value && shown);
      onPresenceChange();
      onPlaybackStateChange();
    }
    if (name === 'video-params' && value && mpv && !html5Active) {
      if (shown) fit(false);
      if (mpv.vsr || mpv.rtxHdr) {
        // VSR upscaling is meant for <= 1080p SDR; keep True HDR if only HDR enabled
        const bypassVsr = mpv.vsr && ((value.h || 0) >= 1440 || (value['sig-peak'] || 1) > 1.5);
        const vf = rtxFilterFor(bypassVsr ? false : mpv.vsr, mpv.rtxHdr);
        mpv.command('vf', 'set', vf).catch(() => {});
      }
    }
    if (name === 'pause' && now?.scrobbled) scrob(value ? 'pause' : 'start');
    if (name === 'duration' && value && now && !now.skipsAsked && getMediaHub()) {
      now.skipsAsked = true;
      now.scrobbled = true; scrob('start');
      onPresenceChange();
      if (party?.role === 'guest' && party.viewer?.state?.src) {
        const src = party.viewer.state.src;
        const localFn = now.stream?.behaviorHints?.filename || now.stream?.title || '';
        const mismatch = detectSourceMismatch({ hostDur: src.durationSec || 0, localDur: value, hostFilename: src.filename || '', localFilename: localFn });
        lastMismatch = mismatch;
        if (mismatch) {
          if (lastPartyState) lastPartyState = { ...lastPartyState, mismatch };
          toOverlay({ type: 'party-mismatch', ...mismatch });
        }
      }
      const key = now.key;
      const syncMultiEp = () => {
        const dSec = getProps().duration || 0;
        if (!now || now.key !== key || !dSec || !now.episodes?.length || now.multiChecked) return;
        now.multiChecked = true;
        const rtMin = parseInt(now.meta?.runtime || '45', 10) || 45;
        const fn = now.stream?.behaviorHints?.filename || now.stream?.title || '';
        const multi = detectDoubleLength({ durationSec: dSec, expectedRuntimeMin: rtMin, filename: fn, episodes: now.episodes, currentVideoId: now.key });
        if (multi) {
          now.multiEp = multi;
          now.nextVideoId = multi.nextAfterId || now.nextVideoId;
          toOverlay({ type: 'multi-ep', ...multi });
        }
      };
      now.syncMultiEp = syncMultiEp;
      syncMultiEp();
      if (now.card?.postCredits && (now.card.postCredits.after || now.card.postCredits.during)) {
        now.postCredits = { ...now.card.postCredits, ...(now.postCredits || {}) };
        toOverlay({ type: 'post-credits', ...now.postCredits });
      }
      getMediaHub().skips(key, value, now.meta?.imdb_id || now.card?.imdbId || null).then((list) => {
        if (now?.key !== key || !shown) return;
        if (!app.isPackaged && process.env.MAJLIS_TEST_SKIPS && (!Array.isArray(list) || !list.length)) {
          list = [{ kind: 'op', start: 0, end: 12 }];
        }
        now.skips = Array.isArray(list) ? list : [];
        if (now.skips.length) {
          toOverlay({ type: 'skips', list: now.skips });
          const ed = now.skips.find((s) => s.kind === 'ed');
          if (ed && value > 180 && value - ed.end >= 25) {
            now.postCredits = { after: true, during: false, ...(now.card?.postCredits || {}), ...(now.postCredits || {}), resumeAt: ed.end };
            toOverlay({ type: 'post-credits', ...now.postCredits });
          }
        }
      }).catch(() => {});
    }
    if (name === 'track-list' && Array.isArray(value) && now && !now.audioRestored && now.itemState?.audioLang && !html5Active && mpv) {
      now.audioRestored = true;
      const wantLang = String(now.itemState.audioLang).toLowerCase();
      const hit = value.find((tr) => tr.type === 'audio' && String(tr.lang || '').toLowerCase() === wantLang);
      if (hit && !hit.selected) mpv.set('aid', hit.id).catch(() => {});
    }
    if (name === 'chapter-list' && Array.isArray(value) && now) {
      const pc = value.find((ch) => /post.?credit|mid.?credit|stinger|بعد التتر|مشهد إضافي/i.test(String(ch?.title || '')));
      if (pc && Number.isFinite(pc.time)) {
        now.postCredits = { after: true, during: false, ...(now.card?.postCredits || {}), ...(now.postCredits || {}), resumeAt: pc.time };
        toOverlay({ type: 'post-credits', ...now.postCredits });
      }
    }
    let shouldEmitProp = true;
    if (name === 'time-pos') {
      const tsNow = Date.now();
      if (now?.hasFirstFrame && Number(value) >= 0.25 && tsNow - lastPosEmitAt < 200) shouldEmitProp = false;
      else lastPosEmitAt = tsNow;
    } else if (THROTTLED_STATS.has(name)) {
      const tsNow = Date.now();
      if (tsNow - (lastStatEmitAt.get(name) || 0) < 1000) shouldEmitProp = false;
      else lastStatEmitAt.set(name, tsNow);
    }
    const sentVal = name === 'volume' && duckGain < 0.99 ? userVol : value;
    if (shouldEmitProp) toOverlay({ type: 'player', name, value: sentVal });
    const markMultiCovered = () => {
      if (incog() || !now?.multiEp?.coveredIds?.length || now.multiMarked || !now.card?.metaId) return;
      const lib = getMediaHub()?.library();
      if (!lib?.setWatched) return;
      now.multiMarked = true;
      const allIds = (now.episodes || []).map((v) => v.id).filter(Boolean);
      const m = { id: now.card.metaId, type: now.type, name: now.card.seriesName || now.card.name, poster: now.card.poster || null };
      for (const vid of now.multiEp.coveredIds) lib.setWatched(m, vid, true, allIds);
    };
    if (name === 'eof-reached' && value === true) {
      markMultiCovered();
      if (!incog() && party && partySession && !partySession.ratingOpened) {
        partySession.ratingOpened = true;
        getSocial?.()?.openPartyRating?.({
          sessionId: partySession.id,
          id: partySession.titleId,
          type: partySession.type,
          title: partySession.title,
          poster: partySession.poster,
        });
      }
      if (sleepEof) {
        sleepEof = false;
        suppressAutoNext = true;
        if (html5Active) toOverlay({ type: 'html5-cmd', op: 'pause', on: true });
        else mpv?.set('pause', true).catch(() => {});
        toOverlay({ type: 'sleep-eof-triggered' });
      } else {
        advanceAfterEof().catch(() => {});
      }
    }
    if (name === 'time-pos' && now && getMediaHub() && now.card?.metaId && !incog()) {
      const step = value - (now.libAt ?? value);
      if (party && partySession) {
        if (step > 0 && step < 30) partySession.watchedMs += step * 1000;
        const tName = now.card?.seriesName || now.card?.name;
        if (tName && !looksRawId(tName)) partySession.title = tName;
        if (now.card?.poster && !partySession.poster) partySession.poster = now.card.poster;
        if (now.meta?.genres?.length && !partySession.genres.length) partySession.genres = normalizeGenres(now.meta.genres);
        const d = getProps().duration || 0;
        if (!partySession.ratingOpened && d > 120 && value >= d * 0.92) {
          partySession.ratingOpened = true;
          getSocial?.()?.openPartyRating?.({
            sessionId: partySession.id,
            id: partySession.titleId,
            type: partySession.type,
            title: partySession.title,
            poster: partySession.poster,
          });
        }
      }
      if (now.libAt == null || Math.abs(step) >= 5) {
        const d = getProps().duration || 0;
        const m = {
          id: now.card.metaId,
          type: now.type,
          name: now.card.seriesName || now.card.name,
          poster: now.card.poster || null,
          year: now.meta?.year ?? now.card?.year ?? null,
          genres: Array.isArray(now.meta?.genres) ? now.meta.genres : (now.card?.genres || []),
          directors: Array.isArray(now.meta?.directors) ? now.meta.directors : (now.meta?.director || now.card?.directors || []),
          cast: Array.isArray(now.meta?.cast) ? now.meta.cast : (now.card?.cast || []),
          runtimeMin: now.meta?.runtimeMin ?? now.meta?.runtime ?? now.card?.runtimeMin ?? null,
          imdbRating: now.meta?.imdbRating ?? now.card?.imdbRating ?? null,
          tmdbId: now.meta?.tmdbId ?? now.card?.tmdbId ?? null,
        };
        // a jump (seek) isn't time watched
        getMediaHub().library().progress(m, now.key, value * 1000, d * 1000, step > 0 && step < 30 ? step * 1000 : 0);
        now.libAt = value;
      }
    }
    if (name === 'time-pos' && now && value > 5) {
      const p = progress(), d = getProps().duration || 0;
      if (d > 120 && value >= d * 0.9) markMultiCovered();
      // remember where we were (every ~5 s of film), forget it once the film's nearly done
      if (!incog() && (!now.saved || Math.abs(value - now.saved) > 5)) {
        now.saved = value;
        if (d && value > d * 0.95) delete p[now.key]; else p[now.key] = { t: value, d, at: Date.now(), meta: now.card };
        pset('mediaProgress', p);
      }
      // Smart Next-Episode Preload inside final 10 minutes
      if (now.type === 'series' && now.nextVideoId && !now.preloadStarted && d > 300 && d - value <= 600) {
        now.preloadStarted = true;
        preloadNextEpisode(now.nextVideoId, playGen).catch(() => {});
      }
    }
  }

  async function ensureMpv() {
    await ensureOverlay();
    const useNative = canNativeLibMpv();
    if (mpv && !mpv.stopped && (useNative ? (mpv.isNative && mpv.ready) : (!mpv.isNative && mpv.sock && mpv.p))) {
      if (useNative) {
        const w = getWin();
        if (w && !w.isDestroyed() && overlay && !overlay.isDestroyed()) mpv.attachWindows(hwnd(w), hwnd(overlay));
      } else if (!film) {
        try { film = Number(await mpv.get('window-id')) || 0; } catch {}
      }
      return;
    }
    try { mpv?.stop(true); } catch {}
    film = 0;
    const vsr = !!store.get('mediaVsr');
    const rtxHdr = !!store.get('rtxHdr');
    const spdif = !!store.get('audioPassthrough');
    const decoderMode = Number.isInteger(store.get('decoderMode')) ? store.get('decoderMode') : 1;
    const hwAccel = store.get('playerHwAccel') !== false;
    const hdrMode = store.get('playerHdr') === false ? 'sdr' : 'hdr-embedded';
    const toneMapping = SAFE_TONE_MAPS.has(store.get('playerToneMapping')) ? store.get('playerToneMapping') : 'spline';
    const bufferSize = store.get('playerBufferSize') || 'auto';
    const anime4k = !!store.get('playerAnime4k');
    const anime4kMode = store.get('playerAnime4kMode') || 'A';
    const subFilterSdh = !!store.get('subFilterSdh');
    const subStyle = store.get('subStyle') || null;
    const subLang2 = store.get('subLang2') || 'eng';
    const customMpvConf = store.get('playerCustomMpvConf') || '';
    const motionInterpolation = !!store.get('motionInterpolation');
    const renderer = store.get('playerRenderer') === 'gpu' ? 'gpu' : 'gpu-next';
    let userDataDir = null;
    let shaderCacheDir = null;
    try { userDataDir = app.getPath('userData'); shaderCacheDir = path.join(userDataDir, 'shader-cache'); } catch {}
    const commonOpts = {
      vsr, rtxHdr, spdif, decoderMode, shaderCacheDir, subFilterSdh, fontsDir: subFontsDir(),
      hwAccel, hdrMode, toneMapping, bufferSize, anime4k, anime4kMode, subStyle, subLang2, customMpvConf, userDataDir,
    };
    const w = getWin();
    const mainH = w && !w.isDestroyed() ? hwnd(w) : 0;
    const hudH = overlay && !overlay.isDestroyed() ? hwnd(overlay) : 0;
    if (useNative) {
      const maxH = Number(store.get('mediaMaxHeight')) || 1080;
      const videoQualityPreset = maxH >= 2160 ? 'max' : 'balanced';
      const displayHdr = mainH && core?.detectDisplayHdr ? !!core.detectDisplayHdr(String(mainH)) : false;
      mpv = new LibMpv({
        NativeMpvPlayer: core.NativeMpvPlayer,
        dll: libmpvPath(),
        mainHwnd: mainH,
        hudHwnd: hudH,
        displayHdr,
        motionInterpolation,
        renderer,
        ...commonOpts,
        videoQualityPreset,
      });
    } else {
      mpv = new Mpv({
        ...commonOpts,
        args: ['--border=no', '--title=Majlis film', '--taskbar-progress=no', '--snap-window=no', '--window-dragging=no', '--auto-window-resize=no', '--keepaspect-window=no', '--geometry=1x1+-32000+-32000'],
      });
    }
    mpv.on('vsr-fallback', (msg) => {
      toOverlay({ type: 'player-state', state: 'vsr-fallback', detail: msg });
    });
    mpv.on('ready', async () => {
      if (useNative) {
        const winNow = getWin();
        if (winNow && !winNow.isDestroyed() && overlay && !overlay.isDestroyed()) mpv.attachWindows(hwnd(winNow), hwnd(overlay));
      } else {
        try { if (mpv.p?.pid) core?.adoptProcess?.(mpv.p.pid); } catch {}
        try { film = Number(await mpv.get('window-id')) || 0; fit(true); } catch {}
      }
    });
    mpv.on('prop', (name, value) => {
      if (!html5Active) onPlayerProp(name, value);
    });
    mpv.on('recovering', (x) => { if (!html5Active) toOverlay({ type: 'player-state', state: 'recovering', detail: x }); });
    mpv.on('recovered', (x) => { if (!html5Active) toOverlay({ type: 'player-state', state: 'recovered', detail: x }); });
    mpv.on('failed', (x) => {
      if (html5Active) return;
      if (!now?.inQuickplay && !html5FallbackTried && isHttpFallbackCandidate(now?.url) && store.get('playerHlsFallback') !== false) {
        activateHtml5Fallback('mpv-failed').catch(() => toOverlay({ type: 'player-state', state: 'failed', detail: x }));
        return;
      }
      toOverlay({ type: 'player-state', state: 'failed', detail: x });
    });
    mpv.on('event', (m) => {
      if (html5Active) return;
      if (m?.event === 'end-file' && (m.reason === 'error' || m.file_error)) {
        if (!now?.inQuickplay && !html5FallbackTried && isHttpFallbackCandidate(now?.url) && store.get('playerHlsFallback') !== false) {
          activateHtml5Fallback('codec-error').catch(() => {});
        }
      }
    });
    await mpv.start();
    if (!useNative && !film) try { film = Number(await mpv.get('window-id')) || 0; } catch {}
    fit(true);
  }

  function show() {
    shown = true;
    startActiveTimers();
    onTheaterState?.(true);
    onPlaybackStateChange();
    if (curDimmerPct > 0) dimmer.apply({ activeWin: getWin(), opacity: curDimmerPct });
    const w = getWin();
    if (mpv?.isNative && w && !w.isDestroyed() && overlay && !overlay.isDestroyed()) {
      mpv.attachWindows(hwnd(w), hwnd(overlay));
      mpv.setVideoVisible(!html5Active);
      mpv.setVisible(true);
      if (now?.card?.name) mpv.setTitle(now.card.name);
    }
    if (overlayReady && overlay && !overlay.isDestroyed()) {
      overlay.show(); fit(true); overlay.focus();
    }
    for (const ms of [300, 1000]) setTimeout(() => { if (shown) fit(true); }, ms);
  }

  // Trakt / Simkl see what's on (progress in %)
  function scrob(action) {
    if (incog() || !now?.card?.metaId || !mpv?.props) return;
    const d = mpv.props.duration || 0, p = mpv.props['time-pos'] || 0;
    getMediaHub()?.scrobble(action, { type: now.type, metaId: now.card.metaId, videoId: now.key }, d ? Math.round((p / d) * 1000) / 10 : 0);
  }

  async function seriesEpisodes(metaId) {
    const hub = getMediaHub();
    if (!hub || !metaId) return { meta: null, episodes: [] };
    const r = await hub.client.all(hub.addons(), { resource: 'meta', type: 'series', id: metaId }).catch(() => []);
    const meta = r.find((x) => x.result?.meta)?.result.meta || null;
    const episodes = (meta?.videos || []).filter((v) => v.season > 0).sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));
    return { meta, episodes };
  }

  function collectPartyAttendees() {
    const h = getHost?.();
    const g = getGuest?.();
    const myProf = store.socialProfile?.() || {};
    const me = { id: store.identity?.().id || 'host', name: myProf.displayName || store.get('nick') || 'Host', accent: myProf.accent || '#e2a43a', avatar: myProf.avatar || null };
    if (h?.guests?.size) {
      return [me, ...[...h.guests.values()].map((gg) => ({ id: gg.id || gg.sid, name: gg.nick || gg.id || gg.sid, accent: gg.accent || null, avatar: gg.avatar || null }))];
    }
    if (g?.roster?.list?.length) {
      return g.roster.list.map((r) => ({ id: r.id || String(r.idx), name: r.name, accent: r.accent || null, avatar: r.avatar || null }));
    }
    return [me];
  }

  function startPartySession(role) {
    if (!now || incog()) return;
    const titleId = now.card?.metaId || String(now.key).split(':')[0];
    if (partySession && partySession.titleId === titleId && partySession.videoId === now.key) return;
    finalizePartySession();
    partySession = {
      id: `ps-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startedAt: Date.now(),
      titleId,
      videoId: now.key,
      type: now.type === 'series' ? 'series' : 'movie',
      title: (!looksRawId(now.card?.seriesName) && now.card?.seriesName) || (!looksRawId(now.card?.name) && now.card?.name) || titleId,
      poster: now.card?.poster || null,
      genres: normalizeGenres(now.meta?.genres || []),
      role: role === 'host' ? 'host' : 'guest',
      attendees: collectPartyAttendees(),
      watchedMs: 0,
      ratingOpened: false,
    };
  }

  function finalizePartySession() {
    if (!partySession) return;
    const ps = partySession;
    partySession = null;
    if (incog()) return;
    if (ps.watchedMs < 5000 && Date.now() - ps.startedAt < 15000) return;
    const attendees = collectPartyAttendees();
    const seen = new Set(attendees.map((a) => a.id));
    for (const prev of ps.attendees || []) if (prev?.id && !seen.has(prev.id)) { seen.add(prev.id); attendees.push(prev); }
    const notes = getSocial?.()?.getPartyNotes?.(ps.videoId || ps.titleId) || [];
    store.addPartyHistory?.({
      ...ps,
      endedAt: Date.now(),
      watchedMs: Math.max(ps.watchedMs, Date.now() - ps.startedAt),
      attendees,
      notes,
    });
  }

  function close() {
    playGen++;
    sleepEof = false;
    suppressAutoNext = false;
    curNight = false;
    dimmer.clear();
    clearStartupWatch();
    clearSettleTimers();
    finalizePartySession();
    stopHtml5Fallback();
    virtualProps = {};
    onTheaterState?.(false);
    stopActiveTimers();
    setWakeLock(false);
    clearTimeout(seekTimer);
    seekWant = null;
    cleanupTempSubs();
    curPhase = '';
    curStatusMsg = '';
    lastFit = '';
    lastOverlayBounds = '';
    lastWinFs = null;
    if (now?.scrobbled) scrob('stop');
    if (party?.role === 'host') getHost()?.syncClose();
    party = null;
    try { thumbProc?.kill(); } catch {}
    thumbProc = null;
    if (mpv) {
      // Clear `want` & pause watchdog synchronously BEFORE sending stop so mpv._watch() NEVER respawns ghost audio
      if (mpv.isNative) {
        mpv.releaseMedia();
      } else {
        mpv.clearPlayback();
        if (mpv.sock) {
          mpv.set('pause', true).catch(() => {});
          mpv.command('stop').catch(() => {});
          mpv.command('playlist-clear').catch(() => {});
        } else {
          // Still booting/connecting: kill immediately so late socket connect cannot play audio
          mpv.stop(true);
          mpv = null;
          film = 0;
        }
      }
    }
    if (now?.infoHash) svc.call('stop', { infoHash: now.infoHash, delete: !!store.get('deleteCacheAfterWatch') }).catch(() => {});
    if (!incog() && now?.card?.metaId) getMediaHub()?.library().stopped({ id: now.card.metaId, type: now.type }, now.nextVideoId || null);
    now = null;
    shown = false; fit(true);
    onPlaybackStateChange();
    if (overlay && !overlay.isDestroyed()) overlay.hide();
    const w = getWin(); if (w && !w.isDestroyed()) { if (w.isFullScreen()) w.setFullScreen(false); w.focus(); }
    emit('theater', { open: false });
    onTheaterClose();
    onPresenceChange();
  }

  // the URL mpv opens and the per-file options it needs
  async function resolve(stream) {
    if (!app.isPackaged && stream.url && (/^av:\/\//i.test(stream.url) || (path.isAbsolute(stream.url) && fs.existsSync(stream.url)))) return { url: stream.url, opts: {} };
    if (stream.majlisDownload) {
      const hub = getMediaHub();
      const f = hub?.downloadFile(stream.majlisDownload);
      if (!f) throw new Error('the downloaded file is gone');
      const origStream = hub?.downloadStream?.(stream.majlisDownload) || null;
      return { url: f, opts: {}, origStream };
    }
    if (stream.majlisLocalFile) {
      const f = getMediaHub()?.localFile?.(stream.majlisLocalFile);
      if (!f) throw new Error('local media file not found');
      return { url: f, opts: {} };
    }
    if (stream.externalUrl && /^https:\/\//i.test(stream.externalUrl) && !stream.url && !stream.infoHash) {
      return { externalUrl: stream.externalUrl, opts: {} };
    }
    for (const k of ['zipUrls', 'rarUrls', '7zipUrls', 'tgzUrls', 'tarUrls']) {
      const arr = stream[k];
      if (Array.isArray(arr) && arr.length) {
        const first = typeof arr[0] === 'string' ? arr[0] : arr[0]?.url;
        if (first && /^https?:\/\//i.test(first)) {
          const archUrl = /^https?:\/\/.*\.(zip|rar|7z|tar|tgz|gz)(\?|$)/i.test(first) ? `archive://${first}` : first;
          return { url: archUrl, opts: {}, isArchive: true };
        }
      }
    }
    if (stream.ytUrl || (stream.url && isYouTubeUrl(stream.url))) {
      const yt = stream.ytUrl || stream.url;
      if (!isYouTubeUrl(yt)) throw new Error('invalid YouTube link');
      const res = await resolveVideoStream(yt);
      return { url: res.url, audioUrl: res.audioUrl || null, ytTitle: res.title, ytUrl: res.ytUrl, opts: {} };
    }
    if (stream.url && /^https?:\/\//i.test(stream.url)) {
      const v = validatePlayUrl(stream.url);
      if (!v.ok || v.kind !== 'http') throw new Error(v.error || 'blocked_url');
      const h = stream.behaviorHints?.proxyHeaders?.request || {};
      const opts = {};
      const hs = [];
      for (const [k, v] of Object.entries(h)) {
        const kl = String(k || '').toLowerCase().trim();
        const cleanV = String(v || '').replace(/[\r\n]/g, ' ').replace(/,/g, '\\,').trim();
        if (!cleanV) continue;
        if (kl === 'user-agent') opts['user-agent'] = cleanV;
        else if (kl === 'referer' || kl === 'referrer') opts.referrer = cleanV;
        else hs.push(sanitizeHeaderPair(k, v));
      }
      if (hs.length) opts['http-header-fields'] = hs.join(',');
      return { url: v.url, opts };
    }
    // a debrid key turns the torrent into a direct link when the service has it; else BitTorrent
    const deb = stream.infoHash ? getMediaHub()?.debrid() : null;
    if (deb) {
      try { const d = await deb.resolve(stream); return { url: d.url, opts: {}, debrid: deb.name }; }
      catch (e) { toOverlay({ type: 'player-state', state: 'debrid-miss', detail: e.message }); }
    }
    if (stream.infoHash) {
      const r = await svc.play({
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx ?? null,
        sources: stream.sources || [],
        filename: stream.behaviorHints?.filename || null,
      });
      return { url: r.url || await svc.url(r.path), opts: {}, infoHash: stream.infoHash };
    }
    throw new Error('this stream type is not supported');
  }

  // Hover thumbnail scrubbing via lightweight ffmpeg single-frame extraction (cached in 4s buckets)
  function thumbFor(sec) {
    if (!now?.url || !(sec >= 0)) return Promise.resolve(null);
    const bucket = Math.max(0, Math.floor(sec / 4) * 4);
    const key = `${now.url}|${bucket}`;
    if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key));
    try { thumbProc?.kill(); } catch {}
    const ff = (typeof getFfmpeg === 'function' && getFfmpeg()) || findFfmpeg(store.get('ffmpeg'));
    if (!ff) return Promise.resolve(null);
    const hdrs = now.stream?.behaviorHints?.proxyHeaders?.request || {};
    const hdrStr = Object.entries(hdrs).map(([k, v]) => `${String(k).replace(/[\r\n:]/g, '')}: ${String(v).replace(/[\r\n]/g, '')}\r\n`).join('');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (hdrStr && /^https?:/i.test(now.url)) args.push('-headers', hdrStr);
    args.push('-ss', String(bucket), '-i', now.url, '-frames:v', '1', '-vf', 'scale=240:-2', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1');
    return new Promise((res) => {
      const p = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      try { if (p.pid) core?.adoptProcess?.(p.pid); } catch {}
      thumbProc = p;
      const chunks = [];
      const timer = setTimeout(() => { try { p.kill(); } catch {} res(null); }, 4500);
      p.stdout.on('data', (d) => chunks.push(d));
      p.on('error', () => { clearTimeout(timer); res(null); });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (thumbProc === p) thumbProc = null;
        if (code === 0 && chunks.length) {
          const dataUrl = `data:image/jpeg;base64,${Buffer.concat(chunks).toString('base64')}`;
          if (thumbCache.size >= 120) thumbCache.delete(thumbCache.keys().next().value);
          thumbCache.set(key, dataUrl);
          res(dataUrl);
        } else res(null);
      });
    });
  }

  // Arabic first, then the user's other language, then English: added in that order, first selected
  async function subtitles(type, id, expectedGen = playGen) {
    try {
      const hub = getMediaHub();
      const bh = now?.stream?.behaviorHints || {};
      let vHash = bh.videoHash || null, vSize = bh.videoSize || null;
      if (!vHash && now?.url && /^https?:\/\//i.test(now.url)) {
        try {
          const vh = require('./media/video-hash');
          const res = await vh.computeHttpVideoHash(now.url, now.stream?.behaviorHints?.proxyHeaders?.request || {});
          if (res?.videoHash) { vHash = res.videoHash; vSize = vSize || res.videoSize; }
        } catch {}
      }
      if (expectedGen !== playGen || !shown || !mpv || mpv.stopped) return [];
      // Offline / local sidecar subtitles next to downloaded or local files
      const localSubPaths = [];
      if (now?.url && !/^(https?|av):/i.test(now.url) && fs.existsSync(now.url)) {
        try {
          const dir = path.dirname(now.url);
          const base = path.basename(now.url, path.extname(now.url)).toLowerCase();
          for (const f of fs.readdirSync(dir)) {
            if (/\.(srt|vtt|ass|ssa)$/i.test(f) && f.toLowerCase().startsWith(base)) {
              localSubPaths.push(path.join(dir, f));
            }
          }
        } catch {}
      }
      localSubPaths.sort((a, b) => Number(/(\.|_)(ar|ara)\./i.test(b)) - Number(/(\.|_)(ar|ara)\./i.test(a)));

      const all = hub ? await hub.subtitles({ type, id, extra: [['videoHash', vHash], ['videoSize', vSize], ['filename', bh.filename]].filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]) }).catch(() => []) : [];
      if (expectedGen !== playGen || !shown || !mpv || mpv.stopped) return [];
      if (now && now.key === id) {
        now.addonSubs = all;
        now.loadedSubMap = {};
      }
      await mpv.clearExternalSubs();
      let loadedAny = 0;
      let firstLoadedTitle = '';
      const sdhOpt = { stripSdh: !!store.get('subFilterSdh') };
      for (const sp of localSubPaths.slice(0, 4)) {
        if (expectedGen !== playGen || !shown || !mpv) break;
        const langHint = /(\.|_)(ar|ara)\./i.test(sp) ? 'ara' : /(\.|_)(en|eng)\./i.test(sp) ? 'eng' : '';
        let subSrc = sp;
        try { subSrc = trackTempSub(sp, await prepareSubtitleFile(sp, langHint, subTempDir(), sdhOpt)); } catch {}
        const title = path.basename(sp);
        const ok = await mpv.command('sub-add', subSrc, loadedAny === 0 ? 'select' : 'auto', title, langHint).then(() => true, () => false);
        if (ok) {
          if (loadedAny === 0) firstLoadedTitle = title;
          loadedAny++;
        }
      }
      const s2 = normalizeSubLang2(store.get('subLang2'));
      const pref = [...new Set(['ara', 'ar', ...(s2 ? [s2, s2.slice(0, 2)] : []), 'eng', 'en'])];
      const pick = [];
      for (const l of pref) for (const s of all || []) if (s.lang === l && /^https?:\/\//i.test(s.url || '') && pick.length < 6 && !pick.includes(s)) pick.push(s);
      for (const [i, s] of pick.entries()) {
        if (expectedGen !== playGen || !shown || !mpv) break;
        let subSrc = s.url;
        try { subSrc = trackTempSub(s.url, await prepareSubtitleFile(s.url, s.lang || '', subTempDir(), sdhOpt)); } catch {}
        if (expectedGen !== playGen || !shown || !mpv) break;
        const cleanTitle = formatAddonSubTitle(s, i);
        const titleWithProvider = s.addon && !cleanTitle.includes(s.addon) ? `${cleanTitle} · ${s.addon}` : cleanTitle;
        if (now && now.key === id) now.loadedSubMap[subSrc] = s.url;
        const ok = await mpv.command('sub-add', subSrc, loadedAny === 0 ? 'select' : 'auto', titleWithProvider, s.lang).then(() => true, () => false);
        if (ok) {
          if (loadedAny === 0) firstLoadedTitle = `${langDisplay(s.lang)} · ${cleanTitle}`;
          loadedAny++;
        }
      }
      if (firstLoadedTitle) {
        toOverlay({ type: 'toast', kind: 'sub', text: firstLoadedTitle });
      }
      if (loadedAny > 0 && store.get('subAutoSync') === true && now && !now.autoSyncScheduled) {
        now.autoSyncScheduled = true;
        setTimeout(() => {
          if (expectedGen === playGen && shown && now?.key === id && (mpv?.props?.['time-pos'] || 0) >= 2) {
            runAutoSyncSub().catch(() => {});
          }
        }, 4500);
      }
      return all;
    } catch { return []; }
  }

  async function runAutoSyncSub() {
    if (!mpv) return { ok: false, error: 'player unavailable' };
    const tracks = Array.isArray(mpv.props['track-list']) ? mpv.props['track-list'] : [];
    const selSub = tracks.find((tr) => tr.type === 'sub' && tr.selected);
    const subFile = selSub?.['external-filename'];
    if (!subFile || (!/^https?:\/\//i.test(subFile) && !fs.existsSync(subFile))) {
      return { ok: false, error: 'active text subtitle track required' };
    }
    let subText = '';
    try {
      subText = /^https?:\/\//i.test(subFile)
        ? await fetch(subFile, { signal: AbortSignal.timeout(5000) }).then((r) => r.text())
        : fs.readFileSync(subFile, 'utf8');
    } catch { return { ok: false, error: 'could not read subtitle cues' }; }
    const cues = parseSrtCueStarts(subText);
    if (!cues.length) return { ok: false, error: 'no timed SRT/VTT cues found' };
    const ff = (typeof getFfmpeg === 'function' && getFfmpeg()) || findFfmpeg(store.get('ffmpeg'));
    if (!ff || !now?.url) return { ok: false, error: 'ffmpeg or media unavailable' };
    const curPos = Number(mpv.props['time-pos'] || 0);
    const winStart = Math.max(0, curPos - 12);
    const winDur = 24;
    const hdrs = now.stream?.behaviorHints?.proxyHeaders?.request || {};
    const hdrStr = Object.entries(hdrs).map(([k, v]) => `${String(k).replace(/[\r\n:]/g, '')}: ${String(v).replace(/[\r\n]/g, '')}\r\n`).join('');
    const args = ['-hide_banner', '-nostdin'];
    if (hdrStr && /^https?:/i.test(now.url)) args.push('-headers', hdrStr);
    args.push('-ss', winStart.toFixed(2), '-t', String(winDur), '-i', now.url, '-vn', '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-');
    const log = await new Promise((resolveProbe) => {
      const p = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      try { if (p.pid) core?.adoptProcess?.(p.pid); } catch {}
      let txt = '';
      const timer = setTimeout(() => { try { p.kill(); } catch {} resolveProbe(txt); }, 10000);
      p.stderr?.on('data', (d) => { txt += d.toString('utf8'); });
      p.on('error', () => { clearTimeout(timer); resolveProbe(''); });
      p.on('close', () => { clearTimeout(timer); resolveProbe(txt); });
    });
    const onsets = [];
    const re = /silence_end:\s*([0-9.]+)/g;
    let m;
    while ((m = re.exec(log))) onsets.push(winStart + parseFloat(m[1]));
    if (!onsets.length) return { ok: false, error: 'no speech transitions detected near cursor' };
    const curDelay = Number(mpv.props['sub-delay'] || 0);
    const winCues = cues.filter((t) => t + curDelay >= winStart - 5 && t + curDelay <= winStart + winDur + 5);
    if (!winCues.length) return { ok: false, error: 'no cues in current 24s window' };
    const deltas = [];
    for (const onset of onsets) {
      let bestD = Infinity;
      for (const ct of winCues) {
        const d = onset - (ct + curDelay);
        if (Math.abs(d) < Math.abs(bestD)) bestD = d;
      }
      if (Math.abs(bestD) <= 5.0) deltas.push(bestD);
    }
    if (!deltas.length) return { ok: false, error: 'drift exceeds 5s calibration range' };
    deltas.sort((a, b) => a - b);
    const delta = Math.round(deltas[Math.floor(deltas.length / 2)] * 10) / 10;
    const nextDelay = Math.round((curDelay + delta) * 10) / 10;
    await mpv.set('sub-delay', nextDelay);
    const ms = Math.round(delta * 1000);
    toOverlay({ type: 'toast', kind: 'sync', text: `${ms >= 0 ? '+' : ''}${ms} ms` });
    return { ok: true, deltaMs: ms, delaySec: nextDelay };
  }


  // ---- bringing history in, and what friends have seen
  ipcMain.handle('media:letterboxd-import', async () => {
    const pick = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Letterboxd export', extensions: ['zip'] }] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const lb = imp.letterboxdZip(pick.filePaths[0]);
    pset('letterboxd', lb);
    return { films: Object.keys(lb).length };
  });
  ipcMain.handle('media:friends-on', (e, m) => friendsOn(m));

  // tonight's vote: through the host when we are one, else through the guest link
  const inRoom = () => (getHost()?.guests?.size ? 'host' : getGuest()?.link ? 'guest' : null);
  ipcMain.handle('vote:nominate', (e, meta) => { const r = inRoom(); if (r === 'host') getHost().voteNominate(meta, store.get('nick')); else if (r === 'guest') getGuest().voteNominate(meta); return r; });
  ipcMain.handle('vote:cast', (e, id) => { const r = inRoom(); if (r === 'host') getHost().voteCast(id, 'host'); else if (r === 'guest') getGuest().voteCast(id); return r; });
  ipcMain.handle('vote:winner', () => (inRoom() === 'host' ? getHost().voteWinner() : null));
  ipcMain.handle('vote:clear', () => { if (inRoom() === 'host') getHost().voteClear(); return true; });
  ipcMain.handle('vote:room', () => inRoom());

  // what we share with friends in the room: watched / rated / in progress (no more)
  function activity() {
    if (incog() || store.get('shareActivity') === false) return null;
    const out = [];
    for (const x of Object.values(pget('mediaLibrary') || {})) if (x.watched) out.push({ id: x.id, name: x.name, watched: true });
    for (const [id, p] of Object.entries(progress())) out.push({ id: p.meta?.metaId || id, name: p.meta?.name, t: Math.round(p.t), d: Math.round(p.d) });
    for (const x of Object.values(pget('letterboxd') || {})) if (x.watched || x.rating) out.push({ name: x.name, year: x.year, watched: !!x.watched, rating: x.rating || null, review: x.review || null });
    return out.slice(0, 3000);
  }
  // friends who've seen this title: by id, or by name + year (Letterboxd knows no ids)
  function friendsOn({ id, name, year }) {
    const key = imp.letterboxdKey(name, String(year || '').slice(0, 4));
    const out = [];
    for (const f of Object.values(store.get('friendActivity') || {})) {
      const hit = (f.items || []).filter((x) => (x.id && (x.id === id || String(x.id).startsWith(`${id}:`))) || (x.name && x.year && imp.letterboxdKey(x.name, x.year) === key));
      if (!hit.length) continue;
      out.push({ name: f.name, watched: hit.some((x) => x.watched), rating: hit.find((x) => x.rating)?.rating || null, review: hit.find((x) => x.review)?.review || null, progress: hit.find((x) => x.t && x.d) ? Math.round((hit.find((x) => x.t && x.d).t / hit.find((x) => x.t && x.d).d) * 100) : null });
    }
    return out;
  }
  // what a friend shared, kept only in the shape we expect (it crossed the network)
  function saveFriend({ id, name, items }) {
    if (!/^\d{9}$/.test(String(id || '')) || !Array.isArray(items)) return;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const num = (v) => (Number.isFinite(v) ? v : undefined);
    const clean = items.slice(0, 3000).map((x) => ({ id: str(x?.id, 64), name: str(x?.name, 200), year: str(String(x?.year ?? ''), 4) || undefined, watched: !!x?.watched, rating: num(x?.rating) ?? null, review: str(x?.review, 2000) ?? null, t: num(x?.t), d: num(x?.d) }));
    const all = store.get('friendActivity') || {};
    all[id] = { name: str(name, 64) || id, items: clean, at: Date.now() };
    store.set('friendActivity', all);
  }

  // { type, id (the video: tt..:s:e for an episode), card (poster/name for "continue watching"), stream }
  ipcMain.handle('media:play', (e, x) => play(x).catch((err) => {
    toOverlay({ type: 'player-error', message: err?.message || 'Could not start playback', ranked: x?.ranked || now?.ranked || [] });
    throw err;
  }));
  async function play({ type, id, card, stream, pos, addon, ranked, keepCurtain = false, gen, tried = [] }) {
    const g = keepCurtain ? (gen ?? playGen) : ++playGen;
    const streamSig = (s) => (s?.infoHash ? `ih:${String(s.infoHash).toLowerCase()}:${s.fileIdx ?? 0}` : String(s?.url || s?.ytUrl || ''));
    const triedSet = new Set(Array.isArray(tried) ? tried : []);
    if (stream) triedSet.add(streamSig(stream));
    if (!keepCurtain && party?.role === 'host') {
      getSocial?.()?.clearPartyNotes?.(id);
    }
    if (!keepCurtain) {
      await ensureOverlay();
      if (g !== playGen) return { ok: false, cancelled: true };
      now = { key: id, card, stream, origStream: null, url: null, infoHash: null, type, addon: addon || null, ranked: ranked || null, nextVideoId: null, episodes: null, triedStreams: triedSet, hasFirstFrame: false, stallSince: 0, zeroPeersSince: 0, failoverOffered: false, failoverDismissed: false };
      sleepEof = false;
      suppressAutoNext = false;
      lastMismatch = null;
      show();
      emit('theater', { open: true, id, card });
      toOverlay({ type: 'theater', card, id, loading: true, phase: 'opening', autoDuck: store.get('autoDuck') !== false, spdif: !!store.get('audioPassthrough'), vsr: !!store.get('mediaVsr'), toneMapping: curTone, aspect: curAspect });
    }
    await ensureMpv();
    if (g !== playGen || !shown) return { ok: false, cancelled: true };
    const r = await resolve(stream);
    if (g !== playGen || !shown) {
      if (r?.infoHash) svc.call('stop', { infoHash: r.infoHash, delete: !!store.get('deleteCacheAfterWatch') }).catch(() => {});
      return { ok: false, cancelled: true };
    }
    if (r?.externalUrl) {
      openExternal?.(r.externalUrl);
      close();
      return { ok: true, external: true };
    }
    const p = progress()[id];
    const origStream = r.origStream || (stream?.majlisDownload ? getMediaHub()?.downloadStream?.(stream.majlisDownload) : null) || stream;
    if (store.get('playerExternalMpv') && !party && !stream?.majlisExternalBypass && r?.url && !/^av:/i.test(r.url)) {
      const posSec = pos != null ? pos / 1000 : (p?.t ? Math.max(0, p.t - 3) : 0);
      const extRes = launchExternalPlayer({ kind: 'mpv', url: r.url, title: card?.name || '', headers: origStream?.behaviorHints?.proxyHeaders?.request || {}, posSec });
      if (extRes.ok) {
        close();
        emit('toast', { kind: 'info', text: 'mpv' });
        return { ok: true, external: true };
      }
    }
    stopHtml5Fallback();
    clearStartupWatch();
    html5FallbackTried = false;
    swFallbackTried = false;
    virtualProps = {};
    now = { key: id, card, stream, origStream, url: r.url, infoHash: r.infoHash, type, addon: addon || null, ranked: ranked || null, nextVideoId: null, episodes: null, triedStreams: now?.triedStreams || triedSet, hasFirstFrame: false, stallSince: 0, zeroPeersSince: 0, failoverOffered: false, failoverDismissed: false, inQuickplay: !!keepCurtain };
    if (type === 'series') {
      const metaId = card?.metaId || String(id).split(':')[0];
      seriesEpisodes(metaId).then(({ meta, episodes }) => {
        if (g !== playGen || !now || now.key !== id) return;
        now.meta = meta;
        now.episodes = episodes;
        const i = episodes.findIndex((v) => v.id === id);
        const curEp = i >= 0 ? episodes[i] : null;
        if (curEp && now.card) {
          const epS = curEp.season ?? now.card.season;
          const epE = (curEp.episode ?? curEp.number) ?? now.card.episode;
          const yr = now.card.year || meta?.year || (typeof meta?.releaseInfo === 'string' ? meta.releaseInfo.slice(0, 4) : undefined);
          now.card = {
            ...now.card,
            seriesName: now.card.seriesName || ([meta?.name, card?.name].find((x) => x && !looksRawId(x)) || undefined),
            year: yr || undefined,
            season: epS ?? undefined,
            episode: epE ?? undefined,
            epTitle: now.card.epTitle || curEp.name || curEp.title || undefined,
            still: now.card.still || curEp.thumbnail || undefined,
          };
          onPresenceChange();
        }
        const nx = i >= 0 && episodes[i + 1] ? episodes[i + 1] : null;
        now.nextVideoId = nx ? nx.id : null;
        onPlaybackStateChange();
        now.syncMultiEp?.();
        const resolvedNext = now.nextVideoId ? episodes.find((v) => v.id === now.nextVideoId) || nx : nx;
        const sName = [meta?.name, card?.seriesName, card?.name].find((x) => x && !looksRawId(x)) || '';
        const epCode = resolvedNext ? formatEpCode(resolvedNext.season, resolvedNext.episode ?? resolvedNext.number) : '';
        toOverlay({
          type: 'next-meta',
          nextVideoId: now.nextVideoId,
          nextTitle: resolvedNext ? (epCode ? (sName ? `${sName} · ${epCode}${resolvedNext.name ? ` · ${resolvedNext.name}` : ''}` : epCode) : resolvedNext.name) : null,
          nextThumb: resolvedNext?.thumbnail || null,
        });
      }).catch(() => {});
    }
    const vsr = !!store.get('mediaVsr');
    const rtxHdr = !!store.get('rtxHdr');
    curHwAccel = store.get('playerHwAccel') !== false;
    curSdh = !!store.get('subFilterSdh');
    curSubFpsMode = 'reset';
    if (SAFE_TONE_MAPS.has(store.get('playerToneMapping'))) curTone = store.get('playerToneMapping');
    mpv.set('hwdec', !curHwAccel || store.get('decoderMode') === 2 ? 'no' : ((vsr || rtxHdr) ? 'd3d11va' : 'auto-safe')).catch(() => {});
    mpv.set('audio-spdif', store.get('audioPassthrough') ? SPDIF_CODECS : '').catch(() => {});
    mpv.set('tone-mapping', curTone).catch(() => {});
    mpv.set('target-colorspace-hint', store.get('playerHdr') === false ? 'no' : 'yes').catch(() => {});
    mpv.set('sub-filter-sdh', curSdh ? 'yes' : 'no').catch(() => {});
    mpv.set('sub-filter-sdh-harder', curSdh ? 'yes' : 'no').catch(() => {});
    if (store.get('playerAnime4k')) {
      mpv.set('deband', 'yes').catch(() => {});
      mpv.set('sharpen', '0.55').catch(() => {});
    }
    const itemState = getMediaHub()?.streamsBucket?.getItemState?.(card?.metaId || id) || null;
    if (now) now.itemState = itemState;
    if (curDisplayProfile !== 'standard') applyDisplayProfile(curDisplayProfile, curDisplayProfile !== 'auto');
    if (Number.isFinite(Number(itemState?.volume))) {
      userVol = Math.max(0, Math.min(200, Math.round(Number(itemState.volume))));
    } else {
      userVol = Math.max(0, Math.min(200, Number(store.get('playerVolume')) || 100));
    }
    curNight = false;
    curVoiceClarity = itemState?.voiceClarity !== undefined ? !!itemState.voiceClarity : !!store.get('voiceClarity');
    curWarmTint = itemState?.warmTint !== undefined ? Math.max(0, Math.min(100, Number(itemState.warmTint) || 0)) : Math.max(0, Math.min(100, Number(store.get('cinemaWarmTint')) || 0));
    if (itemState?.aspect) {
      curAspect = itemState.aspect;
      mpv.set('keepaspect', curAspect !== 'stretch').catch(() => {});
      mpv.set('panscan', curAspect === 'fill' ? 1 : curAspect === 'zoom' ? 0.5 : 0).catch(() => {});
      mpv.set('video-aspect-override', curAspect === '16:9' ? '16:9' : curAspect === '4:3' ? '4:3' : curAspect === '21:9' ? '21:9' : '-1').catch(() => {});
    }
    const baseStyle = store.get('subStyle') || {};
    const mergedStyle = {
      ...baseStyle,
      ...(itemState?.subFont ? { font: itemState.subFont } : {}),
      ...(itemState?.subColor ? { color: itemState.subColor } : {}),
      ...(itemState?.subBold !== undefined ? { bold: itemState.subBold } : {}),
      ...(itemState?.subOutlinePx !== undefined ? { outlinePx: itemState.subOutlinePx } : {}),
      ...(itemState?.subAlign ? { align: itemState.subAlign } : {}),
      ...(itemState?.subScale ? { sizePct: Math.round(itemState.subScale * 100) } : {}),
    };
    for (const [sk, sv] of subStyleToMpvOpts(mergedStyle)) mpv.set(sk, sv).catch(() => {});
    if (itemState?.subBackAlpha !== undefined) {
      if (itemState.subBackAlpha > 0) {
        const ah = Math.round(Math.min(1, itemState.subBackAlpha) * 255).toString(16).padStart(2, '0').toUpperCase();
        mpv.set('sub-border-style', 'opaque-box').catch(() => {});
        mpv.set('sub-back-color', `#${ah}000000`).catch(() => {});
      } else {
        mpv.set('sub-border-style', 'outline-and-shadow').catch(() => {});
        mpv.set('sub-back-color', '#00000000').catch(() => {});
      }
    }
    if (itemState?.subFilterSdh !== undefined) {
      curSdh = !!itemState.subFilterSdh;
      mpv.set('sub-filter-sdh', curSdh ? 'yes' : 'no').catch(() => {});
      mpv.set('sub-filter-sdh-harder', curSdh ? 'yes' : 'no').catch(() => {});
    }
    mpv.set('volume', Math.round(userVol * duckGain)).catch(() => {});
    applyAudioFilters();
    const opts = { ...r.opts, 'force-media-title': (card?.name || '').replace(/,/g, ' ') };
    if (pos != null) opts.start = String(pos / 1000);
    else if (p?.t) opts.start = String(Math.max(0, p.t - 3));
    show();
    emit('theater', { open: true, id, card });
    toOverlay({
      type: 'theater', card, id, phase: 'buffering',
      autoDuck: store.get('autoDuck') !== false, spdif: !!store.get('audioPassthrough'),
      vsr, hwAccel: curHwAccel, sdhFilter: curSdh, toneMapping: curTone, aspect: curAspect,
      voiceClarity: curVoiceClarity, warmTint: curWarmTint, displayProfile: curDisplayProfile,
      detectedDisplayProfile, ranked: ranked || [], incognito: incog(),
    });
    await mpv.load(r.url, opts);
    if (!keepCurtain && !now?.inQuickplay) {
      const watchGen = g;
      const watchKey = id;
      startupWatchTimer = setTimeout(async () => {
        startupWatchTimer = null;
        if (!shown || watchGen !== playGen || !now || now.key !== watchKey || now.hasFirstFrame || html5Active) return;
        if (!html5FallbackTried && isHttpFallbackCandidate(now.url) && store.get('playerHlsFallback') !== false) {
          const ok = await activateHtml5Fallback('startup-timeout').catch(() => false);
          if (ok) return;
        }
        toOverlay({ type: 'player-error', message: 'Stream timed out before delivering video frames', ranked: now.ranked || [] });
      }, 20000);
      startupWatchTimer.unref?.();
    }
    if (r.audioUrl) {
      await mpv.command('audio-add', r.audioUrl, 'select').catch(() => {});
    }
    if (r.ytTitle && now && now.card && (!now.card.name || now.card.name === 'YouTube')) {
      now.card = { ...now.card, name: r.ytTitle };
      toOverlay({ type: 'theater', card: now.card, id });
    }
    if (itemState?.panscan != null) mpv.set('panscan', itemState.panscan).catch(() => {});
    if (typeof itemState?.audioDelay === 'number') mpv.set('audio-delay', itemState.audioDelay).catch(() => {});
    if (itemState?.subDelay) mpv.set('sub-delay', itemState.subDelay).catch(() => {});
    if (itemState?.subSpeed) mpv.set('sub-speed', itemState.subSpeed).catch(() => {});
    if (itemState?.subPos) mpv.set('sub-pos', itemState.subPos).catch(() => {});
    if (g !== playGen || !shown) {
      mpv.clearPlayback();
      mpv.command('stop').catch(() => {});
      if (r?.infoHash) svc.call('stop', { infoHash: r.infoHash, delete: !!store.get('deleteCacheAfterWatch') }).catch(() => {});
      return { ok: false, cancelled: true };
    }
    if (!incog()) getMediaHub()?.streamsBucket?.record?.(card?.metaId || id, id, { stream, addonUrl: addon || null });
    subtitles(type, id, g);
    return { ok: true };
  }

  // Wait up to timeoutMs for mpv to begin playback of the newly loaded candidate; reject if it fails/stalls
  function waitPlaybackStart(expectedKey, expectedGen, timeoutMs = 22000) {
    return new Promise((resolveStart, rejectStart) => {
      const t0 = Date.now();
      const onFail = (why) => { cleanup(); rejectStart(new Error(why || 'playback failed')); };
      const onEvent = (m) => {
        if (m.event === 'end-file' && (m.reason === 'error' || m.file_error)) {
          cleanup(); rejectStart(new Error(m.file_error || 'stream failed to open'));
        }
      };
      const iv = setInterval(() => {
        if (expectedGen !== playGen || !shown || !now || now.key !== expectedKey || !mpv) { cleanup(); rejectStart(new Error('cancelled')); return; }
        const pr = getProps();
        if ((pr.duration || 0) > 0 && ((pr['time-pos'] || 0) > 0 || pr['core-idle'] === false || html5Active)) {
          cleanup(); resolveStart(true); return;
        }
        if (Date.now() - t0 >= timeoutMs) { cleanup(); rejectStart(new Error('stream start timed out')); }
      }, 120);
      function cleanup() { clearInterval(iv); mpv?.off('failed', onFail); mpv?.off('event', onEvent); }
      mpv?.once('failed', onFail);
      mpv?.on('event', onEvent);
    });
  }

  async function preloadNextEpisode(nxVideoId, expectedGen) {
    try {
      const hub = getMediaHub();
      if (!hub || !nxVideoId || expectedGen !== playGen || !now) return;
      const bg = now.stream?.behaviorHints?.bingeGroup;
      let pick = null, addon = now.addon, ranked = null;
      if (addon && bg) {
        const r = await hub.client.request(addon, { resource: 'stream', type: 'series', id: nxVideoId }).catch(() => null);
        pick = r?.streams?.find((s) => s.behaviorHints?.bingeGroup === bg) || null;
      }
      if (expectedGen !== playGen || !now) return;
      if (!pick) {
        const res = await hub.streams({ type: 'series', id: nxVideoId, bingeGroup: bg, partyMinMbps: slowestPartyMbps(), hdrDisplay: isHdrDisplay(), runtimeMin: 45, progressive: true, collectMs: 3000 }).catch(() => null);
        ranked = res?.streams || null;
        const cands = (ranked || []).filter((x) => x.tier > 0 && x.score > -1e5);
        const best = cands.find((x) => x.trusted !== false) || cands[0] || null;
        pick = best?.stream || null;
        addon = best?.addon?.url || addon;
      }
      if (expectedGen !== playGen || !now || !pick) return;
      let resolvedUrl = null;
      const deb = pick.infoHash ? hub.debrid() : null;
      if (deb) {
        try { const d = await deb.resolve(pick); resolvedUrl = d?.url || null; } catch {}
      }
      if (expectedGen !== playGen || !now) return;
      now.preloadedNext = { videoId: nxVideoId, stream: resolvedUrl ? { ...pick, url: resolvedUrl } : pick, addon, ranked };
    } catch {}
  }

  // Smart auto source selector + Quick Play: open cinematic curtain right away, take the first fast
  // cached/debrid batch via progressive fan-out, and fall through candidates cleanly with actionable errors.
  ipcMain.handle('cin:quickplay', (e, a) => quickplay(a || {}));
  ipcMain.handle('cin:play-url', async (e, { url, name, party: wantParty } = {}) => {
    const raw = String(url || '').trim();
    const isYt = isYouTubeUrl(raw);
    const v = isYt ? { ok: true, kind: 'youtube', url: raw, name: name || 'YouTube' } : validatePlayUrl(raw);
    if (!v.ok) return { ok: false, error: v.error };
    const stream = v.kind === 'magnet'
      ? { infoHash: v.infoHash, fileIdx: 0, sources: v.sources }
      : v.kind === 'youtube'
        ? { ytUrl: v.url }
        : { url: v.url };
    const id = v.kind === 'magnet'
      ? `magnet:${v.infoHash}`
      : `${v.kind === 'youtube' ? 'yt' : 'url'}:${crypto.createHash('sha1').update(v.url).digest('hex').slice(0, 16)}`;
    try {
      const r = await play({
        type: 'movie',
        id,
        stream,
        card: { name: name || v.name, type: 'movie', metaId: id },
      });
      if (wantParty || (getHost()?.guests?.size && party?.role !== 'guest')) {
        await waitPlaybackStart(id, playGen, 18000).catch(() => {});
        await partyStart().catch(() => null);
      }
      return { ok: true, id, ...(r || {}) };
    } catch (err) {
      return { ok: false, error: err?.message || 'playback_failed' };
    }
  });
  ipcMain.handle('cin:drop-file', async (e, { filePath } = {}) => {
    const p = String(filePath || '').trim();
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'file_not_found' };
    if (/\.torrent$/i.test(p)) {
      try {
        const stat = fs.statSync(p);
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return { ok: false, error: 'torrent_too_large' };
        const parsed = parseTorrentBuffer(fs.readFileSync(p));
        const id = `torrent:${parsed.infoHash}`;
        const r = await play({
          type: 'movie',
          id,
          stream: { infoHash: parsed.infoHash, fileIdx: parsed.fileIdx ?? 0, sources: parsed.sources },
          card: { name: parsed.name, type: 'movie', metaId: id },
        });
        return { ok: true, kind: 'torrent', id, ...(r || {}) };
      } catch (err) {
        return { ok: false, error: err?.message || 'invalid_torrent' };
      }
    }
    if (/\.(srt|vtt|ass|ssa)$/i.test(p)) {
      if (!shown || !mpv || mpv.stopped) return { ok: false, error: 'player_not_active' };
      try {
        const subSrc = trackTempSub(p, await prepareSubtitleFile(p, '', subTempDir()));
        await mpv.command('sub-add', subSrc, 'select', path.basename(p));
        toOverlay({ type: 'toast', kind: 'sub', text: path.basename(p) });
        return { ok: true, kind: 'subtitle' };
      } catch (err) {
        return { ok: false, error: err?.message || 'subtitle_failed' };
      }
    }
    const entry = getMediaHub()?.registerDropFile?.(p);
    if (entry) {
      try {
        const r = await play({
          type: entry.season != null ? 'series' : 'movie',
          id: entry.id,
          stream: { majlisLocalFile: entry.id },
          card: { name: entry.name, type: entry.season != null ? 'series' : 'movie', metaId: entry.id },
        });
        return { ok: true, kind: 'video', id: entry.id, ...(r || {}) };
      } catch (err) {
        return { ok: false, error: err?.message || 'playback_failed' };
      }
    }
    return { ok: false, error: 'unsupported_file' };
  });
  async function quickplay({ type = 'movie', id, videoId, party: wantParty, bingeGroup, pos, card: hintCard, timeoutMs = 22000 }) {
    const hub = getMediaHub();
    if (!hub) throw new Error('media hub not ready');
    const g = ++playGen;
    lastQuickplay = { type, id, videoId, party: wantParty, bingeGroup, pos, card: hintCard, timeoutMs };
    const rawId = String(id || videoId || '');
    const metaId = type === 'series' && rawId.includes(':') && !rawId.startsWith('kitsu:') && !rawId.startsWith('anilist:') ? rawId.split(':')[0] : rawId;
    if (!videoId && rawId.includes(':') && type === 'series') videoId = rawId;
    const libHint = hub.library()?.get?.(metaId);
    const epMatch = /:(\d+):(\d+)$/.exec(videoId || '');
    const baseName = [hintCard?.seriesName, hintCard?.name, libHint?.name].find((x) => x && !looksRawId(x)) || '';
    const initLabel = baseName && epMatch ? `${baseName} · ${formatEpCode(+epMatch[1], +epMatch[2])}` : baseName;
    await ensureOverlay();
    if (g !== playGen) return { ok: false, cancelled: true };
    const preliminaryCard = {
      name: initLabel,
      seriesName: baseName || undefined,
      poster: hintCard?.poster || libHint?.poster || null,
      background: hintCard?.background || null,
      logo: hintCard?.logo || null,
      type,
      metaId,
    };
    now = { key: videoId || metaId, card: preliminaryCard, stream: null, origStream: null, url: null, infoHash: null, type, addon: null, ranked: null, nextVideoId: null, episodes: null };
    show();
    emit('theater', { open: true, id: now.key, card: preliminaryCard });
    toOverlay({ type: 'theater', card: preliminaryCard, id: now.key, loading: true, phase: 'searching', autoDuck: store.get('autoDuck') !== false, spdif: !!store.get('audioPassthrough'), vsr: !!store.get('mediaVsr'), ambientGlow: !!store.get('ambientGlow') });

    const item = await hub.fetchMeta({ type, id: metaId }).catch(() => null);
    if (g !== playGen || !shown) return { ok: false, cancelled: true };
    const resolvedMetaId = item?.id || metaId;
    const lib = hub.library().get(resolvedMetaId);
    if (type === 'series' && !videoId) {
      if (lib?.state?.video_id) {
        videoId = lib.state.video_id;
        if (pos == null && lib.state.timeOffset > 0) pos = lib.state.timeOffset;
      } else {
        const eps = (item?.videos || []).filter((v) => v.season > 0).sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));
        videoId = eps[0]?.id || `${resolvedMetaId}:1:1`;
      }
    } else if (!videoId) {
      videoId = resolvedMetaId;
      if (pos == null && lib?.state?.timeOffset > 0) pos = lib.state.timeOffset;
    }
    const ep = type === 'series' ? (item?.videos || []).find((v) => v.id === videoId) : null;
    const epParse = ep ? { s: ep.season, e: ep.episode ?? ep.number } : ((/:(\d+):(\d+)$/.exec(videoId || '')) ? { s: +RegExp.$1, e: +RegExp.$2 } : null);
    const seriesName = [item?.name, baseName, lib?.name].find((x) => x && !looksRawId(x)) || '';
    const epCode = epParse ? formatEpCode(epParse.s, epParse.e) : '';
    const label = epCode ? (seriesName ? `${seriesName} · ${epCode}` : epCode) : (seriesName || preliminaryCard.name);
    const cardYear = item?.year || (typeof item?.releaseInfo === 'string' ? item.releaseInfo.slice(0, 4) : '') || undefined;
    const card = {
      name: label,
      seriesName: seriesName || undefined,
      year: cardYear,
      season: epParse?.s ?? undefined,
      episode: epParse?.e ?? undefined,
      epTitle: ep?.name || ep?.title || undefined,
      still: ep?.thumbnail || undefined,
      postCredits: item?.postCredits || hintCard?.postCredits || null,
      poster: item?.poster || preliminaryCard.poster,
      background: item?.background || preliminaryCard.background,
      logo: item?.logo || preliminaryCard.logo,
      genres: Array.isArray(item?.genres) ? item.genres : [],
      directors: Array.isArray(item?.directors) ? item.directors : (item?.director || []),
      cast: Array.isArray(item?.cast) ? item.cast : [],
      runtimeMin: item?.runtimeMin ?? item?.runtime ?? null,
      imdbRating: item?.imdbRating ?? null,
      tmdbId: item?.tmdbId ?? null,
      type,
      metaId: resolvedMetaId,
    };
    if (now) {
      now.key = videoId;
      now.card = card;
    }
    emit('theater', { open: true, id: videoId, card });
    toOverlay({ type: 'theater', card, id: videoId, loading: true, phase: 'searching' });

    if (!wantParty && !party && hub.findFinishedDownload) {
      const localDl = hub.findFinishedDownload(resolvedMetaId, videoId);
      if (localDl) {
        try {
          const pr = await play({ type, id: videoId, card, stream: { majlisDownload: localDl.id }, pos, keepCurtain: true, gen: g });
          if (pr?.cancelled || g !== playGen || !shown) return { ok: false, cancelled: true };
          await waitPlaybackStart(videoId, g, timeoutMs);
          if (g !== playGen || !shown) return { ok: false, cancelled: true };
          return { ok: true, videoId, offline: true, stream: { majlisDownload: localDl.id } };
        } catch {}
      }
    }

    const bucketHint = hub.streamsBucket?.findRecent?.(resolvedMetaId)?.stream?.behaviorHints?.bingeGroup || bingeGroup;
    const runtimeMin = parseInt(item?.runtime, 10) || (type === 'series' ? 45 : 110);
    // Always wait a 3-second collection window (or until 100% of enabled stream addons finish) before picking
    toOverlay({ type: 'theater', card, id: videoId, loading: true, phase: 'comparing' });
    const { streams } = await hub.streams({ type, id: videoId, bingeGroup: bucketHint, partyMinMbps: slowestPartyMbps(), hdrDisplay: isHdrDisplay(), runtimeMin, progressive: true, collectMs: 3000 });
    if (g !== playGen || !shown) return { ok: false, cancelled: true };
    const eligible = (streams || []).filter((x) => x.tier > 0 && x.score > -1e5);
    const trusted = eligible.filter((x) => x.trusted !== false);
    const cands = trusted.length ? trusted : eligible;
    if (!cands.length) {
      toOverlay({ type: 'player-error', message: 'no playable streams found', ranked: streams || [] });
      return { ok: false, error: 'no playable streams found' };
    }
    let lastErr = null;
    const maxTries = Math.min(cands.length, 5);
    for (let i = 0; i < maxTries; i++) {
      if (g !== playGen || !shown) return { ok: false, cancelled: true };
      const cand = cands[i];
      toOverlay({ type: 'player-state', state: i === 0 ? 'opening' : 'trying-source', detail: cand.addon?.name || `#${i + 1}`, index: i + 1, total: maxTries, candidate: cand });
      try {
        const pr = await play({ type, id: videoId, card, stream: cand.stream, addon: cand.addon?.url, pos, ranked: cands, keepCurtain: true, gen: g });
        if (pr?.cancelled || g !== playGen || !shown) return { ok: false, cancelled: true };
        await waitPlaybackStart(videoId, g, timeoutMs);
        if (g !== playGen || !shown) return { ok: false, cancelled: true };
        if (wantParty || party?.role === 'host') await partyStart();
        return { ok: true, videoId, stream: cand.stream, addon: cand.addon, facts: cand.facts, score: cand.score };
      } catch (err) {
        lastErr = err;
        if (err?.message === 'cancelled' || g !== playGen || !shown) return { ok: false, cancelled: true };
      }
    }
    toOverlay({ type: 'player-error', message: lastErr?.message || 'all candidate streams failed', ranked: cands });
    return { ok: false, error: lastErr?.message || 'all candidate streams failed' };
  }

  ipcMain.handle('party:start', () => partyStart());
  async function partyStart() {
    if (!store.hasServer()) { emit('notice', { key: 'server_required' }); return null; }
    const h = getHost();
    if (!h || !now || !mpv || !shown) return null;
    const pos = Math.round((mpv.props['time-pos'] || 0) * 1000);
    const stream = (now.stream?.majlisDownload && (now.origStream || getMediaHub()?.downloadStream?.(now.stream.majlisDownload))) || now.origStream || now.stream;
    const peers = [{ id: 'host', name: store.get('nick') || 'Host' }, ...[...(h.guests?.values() || [])].map((g) => ({ id: g.sid, name: g.nick || g.id }))];
    const durationSec = mpv.props?.duration || 0;
    const filename = stream?.behaviorHints?.filename || stream?.title || '';
    return h.syncOpen({ stream, type: now.type, id: now.key, card: now.card, pos, peers, durationSec, filename });
  }
  ipcMain.handle('party:end', () => { finalizePartySession(); if (party?.role === 'host') getHost()?.syncClose(); party = null; lastPartyState = null; lastMismatch = null; toOverlay({ type: 'party', state: null }); return true; });
  ipcMain.handle('party:info', () => ({ canStart: !!getHost()?.guests?.size, on: !!party, role: party?.role || null }));

  async function advanceAfterEof() {
    if (suppressAutoNext) return null;
    if (now?.type === 'series' && store.get('autoNext') !== false && (!party || party.role === 'host')) {
      const advanced = await nextEpisode().catch(() => null);
      if (advanced) return advanced;
    }
    if ((!party || party.role === 'host') && getMediaHub()?.shiftQueue) {
      const next = getMediaHub().shiftQueue();
      if (next) {
        toOverlay({ type: 'next', name: next.epLabel ? `${next.name} · ${next.epLabel}` : next.name });
        if (next.directUrl) {
          const isYt = isYouTubeUrl(next.directUrl);
          const v = isYt ? { ok: true, kind: 'youtube', url: next.directUrl, name: next.name } : validatePlayUrl(next.directUrl);
          if (v.ok) {
            const stream = v.kind === 'magnet'
              ? { infoHash: v.infoHash, fileIdx: 0, sources: v.sources }
              : v.kind === 'youtube' ? { ytUrl: v.url } : { url: v.url };
            const r = await play({
              type: 'movie',
              id: next.id,
              stream,
              card: { name: next.name, poster: next.poster || null, type: 'movie', metaId: next.id },
            }).catch(() => null);
            if (r?.ok && party?.role === 'host') await partyStart().catch(() => null);
            return r;
          }
        }
        return quickplay({
          type: next.type || 'movie',
          id: next.id,
          videoId: next.videoId,
          party: !!party,
          card: {
            name: next.epLabel ? `${next.name} · ${next.epLabel}` : next.name,
            seriesName: next.name,
            poster: next.poster || null,
            type: next.type || 'movie',
            metaId: next.id,
          },
        }).catch(() => null);
      }
    }
    return null;
  }

  async function nextEpisode(targetVideoId = null) {
    if (!now || now.type !== 'series' || now.nexting) return null;
    const g = ++playGen;
    now.nexting = true;
    try {
      const hub = getMediaHub();
      if (!hub) return null;
      const metaId = now.card?.metaId || String(now.key).split(':')[0];
      const { meta, episodes: eps } = now.episodes?.length ? { meta: now.meta, episodes: now.episodes } : await seriesEpisodes(metaId);
      if (g !== playGen || !shown || !eps.length) return null;
      const i = eps.findIndex((v) => v.id === now.key);
      const nx = targetVideoId ? eps.find((v) => v.id === targetVideoId) : (i >= 0 ? eps[i + 1] : null);
      if (!nx) return null;
      const nxIdx = eps.findIndex((v) => v.id === nx.id);
      now.nextVideoId = nxIdx >= 0 && eps[nxIdx + 1] ? eps[nxIdx + 1].id : null;
      const bg = now.stream?.behaviorHints?.bingeGroup;
      let pick = null, addon = now.addon, ranked = null;
      if (now.preloadedNext?.videoId === nx.id && now.preloadedNext?.stream) {
        pick = now.preloadedNext.stream;
        addon = now.preloadedNext.addon || addon;
        ranked = now.preloadedNext.ranked || ranked;
      }
      if (!pick && addon && bg) {
        const r = await hub.client.request(addon, { resource: 'stream', type: 'series', id: nx.id }).catch(() => null);
        pick = r?.streams.find((s) => s.behaviorHints?.bingeGroup === bg) || null;
      }
      if (g !== playGen || !shown) return null;
      if (!pick) {
        toOverlay({ type: 'theater', card: now.card, id: nx.id, loading: true, phase: 'comparing' });
        const res = await hub.streams({ type: 'series', id: nx.id, bingeGroup: bg, partyMinMbps: slowestPartyMbps(), hdrDisplay: isHdrDisplay(), runtimeMin: 45, progressive: true, collectMs: 3000 });
        ranked = res.streams;
        const cands = (ranked || []).filter((x) => x.tier > 0 && x.score > -1e5);
        const best = cands.find((x) => x.trusted !== false) || cands[0] || null;
        pick = best?.stream || null; addon = best?.addon.url || null;
      }
      if (g !== playGen || !shown || !pick) return null;
      const sName = [meta?.name, now.card?.seriesName, now.card?.name].find((x) => x && !looksRawId(x)) || '';
      const epCode = formatEpCode(nx.season, nx.episode ?? nx.number);
      const card = { ...now.card, seriesName: sName || undefined, name: sName ? `${sName} · ${epCode}` : epCode };
      toOverlay({ type: 'next', name: card.name });
      if (party?.role === 'host') {
        const h = getHost();
        const peers = [{ id: 'host', name: store.get('nick') || 'Host' }, ...[...(h?.guests?.values() || [])].map((gg) => ({ id: gg.sid, name: gg.nick || gg.id }))];
        return h?.syncOpen({ stream: pick, type: 'series', id: nx.id, card, pos: 0, peers });
      }
      return play({ type: 'series', id: nx.id, card, stream: pick, addon, ranked, gen: g });
    } finally { if (now) now.nexting = false; }
  }
  ipcMain.handle('player:next', () => nextEpisode());

  let seekWant = null, seekTimer = null;
  async function runControlCmd(cmdName, c = {}) {
    if (!mpv && !html5Active) return null;
    if (party && ['toggle', 'pause', 'seek', 'speed'].includes(cmdName)) {
      if (party.role === 'guest' && !getGuest()?.canControl) {
        toOverlay({ type: 'toast', kind: 'remote-locked', text: 'remote-locked' });
        return false;
      }
      const cur = Math.round((getProps()['time-pos'] || 0) * 1000);
      const ask = (r) => (party.role === 'host' ? getHost()?.syncRequest(r) : getGuest()?.syncRequest(r));
      if (cmdName === 'speed') {
        const rate = Math.min(4, Math.max(0.25, Number(c.v) || 1));
        ask({ action: 'speed', rate, seq: party.viewer.ownSeq });
        return true;
      }
      if (cmdName === 'seek') {
        const from = seekWant ?? cur;
        seekWant = c.abs ? Math.round(c.to * 1000) : Math.max(0, from + Math.round(c.to * 1000));
        clearTimeout(seekTimer);
        seekTimer = setTimeout(() => { if (party) ask({ action: 'seek', pos: seekWant }); seekWant = null; }, 250);
        return true;
      }
      const action = (cmdName === 'toggle' ? !party.viewer.state?.playing : !c.on) ? 'play' : 'pause';
      if (!party.viewer.canRequest(action)) return true;
      ask({ action, seq: party.viewer.ownSeq });
      return true;
    }
    if (cmdName === 'toggle') {
      const nextPause = !getProps().pause;
      if (html5Active) { toOverlay({ type: 'html5-cmd', op: 'pause', on: nextPause }); return nextPause; }
      return mpv.set('pause', nextPause);
    }
    if (cmdName === 'pause') {
      if (html5Active) { toOverlay({ type: 'html5-cmd', op: 'pause', on: !!c.on }); return !!c.on; }
      return mpv.set('pause', !!c.on);
    }
    if (cmdName === 'seek') {
      lastPosEmitAt = 0;
      const dur = Number(getProps()?.duration) || 0;
      const target = c.abs && dur > 0
        ? Math.max(0, Math.min(Number(c.to) || 0, Math.max(0, dur - 1)))
        : (Number(c.to) || 0);
      const res = html5Active
        ? (toOverlay({ type: 'html5-cmd', op: 'seek', to: target, abs: !!c.abs }), true)
        : await mpv.command('seek', target, c.abs ? 'absolute+exact' : 'relative+exact');
      setTimeout(() => onPresenceChange(), 180);
      return res;
    }
    if (cmdName === 'speed') {
      const spd = Math.min(4, Math.max(0.25, Number(c.v) || 1));
      if (html5Active) { toOverlay({ type: 'html5-cmd', op: 'speed', v: spd }); return spd; }
      return mpv.set('speed', spd);
    }
    return null;
  }

  ipcMain.handle('player:cmd', async (e, c) => {
    if (c.cmd === 'close') { close(); return true; }
    if (c.cmd === 'fullscreen') {
      const w = getWin();
      if (!w || w.isDestroyed()) return false;
      const nextFs = !w.isFullScreen();
      w.setFullScreen(nextFs);
      fit(true);
      scheduleSettleFit();
      return w.isFullScreen();
    }
    if (c.cmd === 'displays') {
      const w = getWin();
      const all = screen.getAllDisplays();
      const primary = screen.getPrimaryDisplay();
      const cur = w && !w.isDestroyed() ? screen.getDisplayMatching(w.getBounds()) : primary;
      return all.map((d, i) => ({
        id: d.id,
        index: i,
        label: d.label || `Display ${i + 1}`,
        bounds: d.bounds,
        workArea: d.workArea,
        scaleFactor: d.scaleFactor || 1,
        primary: d.id === primary.id,
        current: d.id === cur?.id,
      }));
    }
    if (c.cmd === 'move-display') {
      const w = getWin();
      if (!w || w.isDestroyed()) return { ok: false };
      const all = screen.getAllDisplays();
      if (!all.length) return { ok: false };
      const cur = screen.getDisplayMatching(w.getBounds());
      let target = c.displayId != null ? all.find((d) => d.id === Number(c.displayId)) : null;
      if (!target) {
        const curIdx = Math.max(0, all.findIndex((d) => d.id === cur?.id));
        target = all[(curIdx + 1) % all.length];
      }
      if (!target) return { ok: false };
      const wasFs = w.isFullScreen();
      const wasMax = w.isMaximized();
      if (wasFs) w.setFullScreen(false);
      if (wasMax) w.unmaximize();
      const targetRect = {
        x: Math.round(target.workArea.x),
        y: Math.round(target.workArea.y),
        width: Math.round(target.workArea.width),
        height: Math.round(target.workArea.height),
      };
      w.setBounds(targetRect);
      setImmediate(() => {
        if (!w || w.isDestroyed()) return;
        if ((cur?.scaleFactor || 1) !== (target.scaleFactor || 1)) w.setBounds(targetRect);
        if (wasFs || c.fullscreen) w.setFullScreen(true);
        else if (wasMax) w.maximize();
        if (curDisplayProfile === 'auto') applyDisplayProfile('auto', false);
        if (curDimmerPct > 0) dimmer.apply({ activeWin: w, opacity: curDimmerPct });
        fit(true);
      });
      return { ok: true, displayId: target.id, secondaryDisplays: Math.max(0, all.length - 1) };
    }
    if (c.cmd === 'voice-active') { onVoice(); return true; }
    if (c.cmd === 'retry') {
      if (lastQuickplay) return quickplay(lastQuickplay);
      if (now?.stream) return play({ type: now.type, id: now.key, card: now.card, stream: now.stream, addon: now.addon, ranked: now.ranked });
      return false;
    }
    if (c.cmd === 'state') {
      const itemId = now?.card?.metaId || now?.key;
      const itemState = itemId ? getMediaHub()?.streamsBucket?.getItemState?.(itemId) : null;
      try {
        const w = getWin();
        const d = w && !w.isDestroyed() ? screen.getDisplayMatching(w.getBounds()) : screen.getPrimaryDisplay();
        detectedDisplayProfile = detectDisplayProfile(d);
      } catch {}
      const curPr = getProps();
      return {
        ...curPr, volume: userVol, autoDuck: store.get('autoDuck') !== false,
        spdif: !!store.get('audioPassthrough'), vsr: !!store.get('mediaVsr'),
        hwAccel: curHwAccel, sdhFilter: curSdh, subFpsMode: curSubFpsMode,
        night: curNight, voiceClarity: curVoiceClarity, warmTint: curWarmTint,
        dimmerPct: curDimmerPct, secondaryDisplays: dimmer.secondaryCount(getWin()),
        displayProfile: curDisplayProfile, detectedDisplayProfile,
        multiEp: now?.multiEp || null, postCredits: now?.postCredits || now?.card?.postCredits || null,
        subStyle: { ...(store.get('subStyle') || {}), ...(itemState || {}) },
        ambientGlow: !!store.get('ambientGlow'),
        incognito: incog(),
        html5Active,
        videoHwnd: mpv?.videoHwnd?.() || null,
        aspect: curAspect, toneMapping: curTone, partyState: lastPartyState, partyVotes,
        phase: curPhase, statusMsg: curStatusMsg, loading: shown && !((curPr['time-pos'] || 0) > 0.01),
        loadedSubMap: now?.loadedSubMap || {},
        skips: now?.skips || [],
        bookmarks: getBookmarks(),
        partyNotes: getSocial?.()?.getPartyNotes?.(now?.key || now?.card?.metaId) || [],
        watchControl: getHost()?.guests?.size ? getHost().getWatchControl?.() : (getGuest()?.watchControl || null),
        readyState: (getHost()?.enabled || getHost()?.guests?.size) ? getHost().readySnapshot?.() : (getGuest()?.link ? getGuest().readyState || null : null),
        canControl: party?.role === 'guest' ? !!getGuest()?.canControl : true,
        partyQueue: getMediaHub()?.getQueue?.() || [],
        now: now ? { card: now.card, id: now.key, type: now.type, ranked: now.ranked || [], nextVideoId: now.nextVideoId || null, episodes: now.episodes || null } : null,
      };
    }
    if (c.cmd === 'sources') {
      if (!now) return { streams: [], current: null };
      if (!now.ranked?.length && getMediaHub()) {
        const r = await getMediaHub().streams({ type: now.type, id: now.key, partyMinMbps: slowestPartyMbps(), hdrDisplay: isHdrDisplay() }).catch(() => ({ streams: [] }));
        now.ranked = r.streams || [];
      }
      return { streams: (now.ranked || []).slice(0, 40), current: now.stream };
    }
    if (c.cmd === 'switch-source') {
      if (!now || !c.stream) return false;
      const curPos = Math.round((mpv?.props?.['time-pos'] || 0) * 1000);
      await play({ type: now.type, id: now.key, card: now.card, stream: c.stream, addon: c.addon || now.addon, pos: curPos, ranked: now.ranked });
      if (party?.role === 'host') await partyStart();
      return true;
    }
    if (c.cmd === 'episodes') {
      if (!now || now.type !== 'series') return { episodes: [], current: null, seriesName: '' };
      const metaId = now.card?.metaId || String(now.key).split(':')[0];
      if (!now.episodes?.length) {
        const { meta, episodes } = await seriesEpisodes(metaId);
        now.meta = meta; now.episodes = episodes;
      }
      const lib = getMediaHub()?.library();
      const episodes = (now.episodes || []).map((v) => ({
        id: v.id, season: v.season, episode: v.episode ?? v.number, name: v.name || `E${v.episode ?? v.number}`,
        thumbnail: v.thumbnail || null, overview: v.overview || '', watched: lib ? lib.isWatched(metaId, v.id) : false,
      }));
      return { episodes, current: now.key, seriesName: now.card?.seriesName || now.card?.name || '' };
    }
    if (c.cmd === 'episode-streams' && c.videoId && getMediaHub()) {
      const r = await getMediaHub().streams({ type: 'series', id: c.videoId, partyMinMbps: slowestPartyMbps(), hdrDisplay: isHdrDisplay() }).catch(() => ({ streams: [] }));
      return (r.streams || []).slice(0, 30);
    }
    if (c.cmd === 'play-episode-stream' && c.videoId && c.stream) {
      const metaId = now?.card?.metaId || String(c.videoId).split(':')[0];
      const ep = (now?.episodes || []).find((v) => v.id === c.videoId);
      const sName = [now?.card?.seriesName, now?.card?.name].find((x) => x && !looksRawId(x)) || '';
      const epCode = ep ? formatEpCode(ep.season, ep.episode ?? ep.number) : '';
      const card = { ...(now?.card || {}), seriesName: sName || undefined, metaId, name: epCode ? (sName ? `${sName} · ${epCode}` : epCode) : (sName || 'Episode') };
      return play({ type: 'series', id: c.videoId, card, stream: c.stream, addon: c.addon || now?.addon, ranked: now?.ranked });
    }
    if (c.cmd === 'play-episode') return c.videoId ? nextEpisode(c.videoId) : null;
    if (c.cmd === 'party-chat') {
      const txt = String(c.text || '').trim().slice(0, 400);
      if (!txt) return false;
      if (getHost()?.guests?.size) getHost().hostChat(txt);
      else if (getGuest()?.link) getGuest().ctrl({ t: 'chat', text: txt });
      return true;
    }
    if (c.cmd === 'party-react') {
      const r = String(c.emoji || '').slice(0, 16);
      if (!r) return false;
      if (getHost()?.guests?.size) getHost().react({ r, idx: 0, from: store.get('nick') || 'Host' });
      else if (getGuest()?.link) getGuest().ctrl({ t: 'react', r });
      return true;
    }
    if (c.cmd === 'party-vote') {
      if (c.castId) {
        if (getHost()?.guests?.size) getHost().voteCast(c.castId, 'host');
        else if (getGuest()?.link) getGuest().voteCast(c.castId);
      }
      return partyVotes;
    }
    if (c.cmd === 'party-ready-check') {
      if (getHost()?.enabled || getHost()?.guests?.size) return getHost().readyCheck();
      return null;
    }
    if (c.cmd === 'party-ready-ack') {
      if (getHost()?.enabled || getHost()?.guests?.size) return getHost().setHostReady(c.on !== false);
      if (getGuest()?.link) { getGuest().ctrl({ t: 'ready', on: c.on !== false }); return true; }
      return false;
    }
    if (c.cmd === 'party-countdown') {
      if (getHost()?.enabled || getHost()?.guests?.size) return getHost().countdown(c.ms || 3000);
      return false;
    }
    if (c.cmd === 'party-remote') {
      if (getHost()?.guests?.size) return getHost().setWatchControl(c.mode, c.holderId || null);
      return null;
    }
    if (c.cmd === 'party-note-add') {
      const tPos = Number.isFinite(Number(c.t)) ? Number(c.t) : Math.max(0, Number(mpv?.props?.['time-pos'] || 0));
      return getSocial?.()?.addPartyNote?.({ titleKey: now?.key || now?.card?.metaId || '', t: tPos, text: c.text }) || [];
    }
    if (c.cmd === 'party-note-del') {
      return getSocial?.()?.delPartyNote?.(c.id) || [];
    }
    if (c.cmd === 'queue-get') return getMediaHub()?.getQueue?.() || [];
    if (c.cmd === 'queue-remove') {
      const q = (getMediaHub()?.getQueue?.() || []).filter((x) => x.key !== c.key);
      return getMediaHub()?.setQueue?.(q) || [];
    }
    if (c.cmd === 'queue-move') {
      const q = [...(getMediaHub()?.getQueue?.() || [])];
      const f = Number(c.from), to = Number(c.to);
      if (f >= 0 && to >= 0 && f < q.length && to < q.length && f !== to) {
        const [picked] = q.splice(f, 1);
        q.splice(to, 0, picked);
        return getMediaHub()?.setQueue?.(q) || [];
      }
      return q;
    }
    if (c.cmd === 'queue-clear') return getMediaHub()?.setQueue?.([]) || [];
    if (c.cmd === 'queue-play') {
      const q = getMediaHub()?.getQueue?.() || [];
      const it = q.find((x) => x.key === c.key);
      if (!it) return false;
      getMediaHub()?.setQueue?.(q.filter((x) => x.key !== c.key));
      if (it.directUrl) {
        const isYt = isYouTubeUrl(it.directUrl);
        const v = isYt ? { ok: true, kind: 'youtube', url: it.directUrl, name: it.name } : validatePlayUrl(it.directUrl);
        if (v.ok) {
          const stream = v.kind === 'magnet' ? { infoHash: v.infoHash, fileIdx: 0, sources: v.sources } : v.kind === 'youtube' ? { ytUrl: v.url } : { url: v.url };
          const r = await play({ type: 'movie', id: it.id, stream, card: { name: it.name, poster: it.poster || null, type: 'movie', metaId: it.id } }).catch(() => null);
          if (r?.ok && party?.role === 'host') await partyStart().catch(() => null);
          return r;
        }
      }
      return quickplay({ type: it.type || 'movie', id: it.id, videoId: it.videoId, party: !!party, card: { name: it.name, poster: it.poster || null, type: it.type || 'movie', metaId: it.id } });
    }
    if (!mpv && !html5Active) return null;
    if (['toggle', 'pause', 'seek', 'speed'].includes(c.cmd)) return runControlCmd(c.cmd, c);
    switch (c.cmd) {
      case 'volume': {
        userVol = Math.min(200, Math.max(0, Math.round(Number(c.v) || 0)));
        if (mpv?.props) mpv.props.volume = userVol;
        virtualProps.volume = userVol;
        store.set('playerVolume', userVol);
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { volume: userVol });
        if (html5Active) { toOverlay({ type: 'html5-cmd', op: 'volume', v: Math.round(userVol * duckGain) }); return true; }
        return mpv.set('volume', Math.round(userVol * duckGain));
      }
      case 'mute': {
        if (html5Active) {
          const nextMute = !getProps().mute;
          virtualProps.mute = nextMute;
          toOverlay({ type: 'html5-cmd', op: 'mute', on: nextMute });
          return nextMute;
        }
        return mpv.set('mute', !(await mpv.get('mute')));
      }
      case 'sub-delay': {
        const next = Math.round(((c.abs ? 0 : (mpv.props['sub-delay'] || 0)) + (Number(c.d) || 0)) * 100) / 100;
        await mpv.set('sub-delay', next);
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { subDelay: next });
        return next;
      }
      case 'sub-fps-shift': {
        const modes = { reset: 1, '23976_25': 23.976 / 25, '25_23976': 25 / 23.976, '24_23976': 24 / 23.976 };
        const mode = modes[c.mode] ? c.mode : 'reset';
        curSubFpsMode = mode;
        const speed = modes[mode];
        await mpv.set('sub-speed', speed).catch(() => {});
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { subSpeed: speed });
        return { mode, speed };
      }
      case 'sdh-toggle': {
        curSdh = c.on !== undefined ? !!c.on : !curSdh;
        store.set('subFilterSdh', curSdh);
        await mpv.set('sub-filter-sdh', curSdh ? 'yes' : 'no').catch(() => {});
        await mpv.set('sub-filter-sdh-harder', curSdh ? 'yes' : 'no').catch(() => {});
        const tracks = Array.isArray(mpv.props['track-list']) ? mpv.props['track-list'] : [];
        const selSub = tracks.find((tr) => tr.type === 'sub' && tr.selected && tr['external-filename']);
        if (selSub) {
          const curExt = selSub['external-filename'];
          const origSrc = now?.loadedSubMap?.[curExt] || curExt;
          try {
            const subSrc = trackTempSub(origSrc, await prepareSubtitleFile(origSrc, selSub.lang || '', subTempDir(), { stripSdh: curSdh }));
            if (subSrc && subSrc !== curExt) {
              const curDelay = mpv.props['sub-delay'] || 0;
              if (now) {
                now.loadedSubMap = now.loadedSubMap || {};
                now.loadedSubMap[subSrc] = origSrc;
              }
              await mpv.command('sub-remove', selSub.id).catch(() => {});
              await mpv.command('sub-add', subSrc, 'select', selSub.title || langDisplay(selSub.lang), selSub.lang || '').catch(() => {});
              if (curDelay) await mpv.set('sub-delay', curDelay).catch(() => {});
            }
          } catch {}
        }
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { subFilterSdh: curSdh });
        return curSdh;
      }
      case 'hwdec-toggle': {
        curHwAccel = c.on !== undefined ? !!c.on : !curHwAccel;
        store.set('playerHwAccel', curHwAccel);
        const hwVal = !curHwAccel ? 'no' : ((mpv?.vsr || mpv?.rtxHdr) ? 'd3d11va' : 'auto-safe');
        await mpv?.set('hwdec', hwVal).catch(() => {});
        return curHwAccel;
      }
      case 'audio-delay': {
        const next = Math.round(((c.abs ? 0 : (mpv.props['audio-delay'] || 0)) + (Number(c.d) || 0)) * 1000) / 1000;
        const clamped = Math.max(-5, Math.min(5, next));
        await mpv.set('audio-delay', clamped);
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { audioDelay: clamped });
        return clamped;
      }
      case 'sid': return html5Active ? (toOverlay({ type: 'html5-cmd', op: 'sid', id: c.id ?? 'no' }), true) : mpv.set('sid', c.id ?? 'no');
      case 'secondary-sid': return mpv.set('secondary-sid', c.id ?? 'no');
      case 'aid': {
        const tracks = Array.isArray(getProps()['track-list']) ? getProps()['track-list'] : [];
        const picked = tracks.find((tr) => tr.type === 'audio' && tr.id === c.id);
        if (picked?.lang && (now?.card?.metaId || now?.key)) {
          getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { audioLang: picked.lang });
        }
        return html5Active ? (toOverlay({ type: 'html5-cmd', op: 'aid', id: c.id }), true) : mpv.set('aid', c.id);
      }
      case 'sub-scale': {
        const scale = Math.max(0.4, Math.min(3, Number(c.v) || 1));
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { subScale: scale });
        return mpv.set('sub-scale', scale);
      }
      case 'sub-pos': {
        userSubPos = Math.max(40, Math.min(100, Number(c.v) || 94));
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { subPos: userSubPos });
        return mpv.set('sub-pos', hudVisible ? Math.min(userSubPos, 88) : userSubPos);
      }
      case 'hud-visible': {
        hudVisible = !!c.on;
        return mpv.set('sub-pos', hudVisible ? Math.min(userSubPos, 88) : userSubPos);
      }
      case 'sub-style': {
        const jobs = [];
        for (const k of ['sub-color', 'sub-border-size', 'sub-back-color', 'sub-border-style', 'sub-bold', 'sub-outline-size', 'sub-shadow-offset', 'sub-shadow-color', 'sub-font', 'sub-scale', 'sub-pos', 'sub-align-x', 'sub-margin-y']) {
          if (c[k] !== undefined) jobs.push(mpv.set(k, c[k]).catch(() => {}));
        }
        await Promise.all(jobs);
        const itemPatch = {};
        if (c['sub-color'] !== undefined) itemPatch.subColor = c['sub-color'];
        if (c['sub-font'] !== undefined) itemPatch.subFont = c['sub-font'];
        if (c['sub-bold'] !== undefined) itemPatch.subBold = c['sub-bold'] === 'yes' || c['sub-bold'] === true;
        if (c['sub-border-size'] !== undefined) itemPatch.subOutlinePx = Number(c['sub-border-size']);
        if (typeof c.backAlpha === 'number') itemPatch.subBackAlpha = c.backAlpha;
        if (c['sub-align-x'] !== undefined) itemPatch.subAlign = c['sub-align-x'];
        if (Object.keys(itemPatch).length) {
          if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, itemPatch);
          const curSt = store.get('subStyle') || {};
          store.set('subStyle', {
            ...curSt,
            ...(itemPatch.subFont ? { font: itemPatch.subFont } : {}),
            ...(itemPatch.subColor ? { color: itemPatch.subColor } : {}),
            ...(itemPatch.subBold !== undefined ? { bold: itemPatch.subBold } : {}),
            ...(Number.isFinite(itemPatch.subOutlinePx) ? { outlinePx: itemPatch.subOutlinePx } : {}),
          });
        }
        return true;
      }
      case 'sub-open-file': {
        const w = getWin();
        const r = await dialog.showOpenDialog(w && !w.isDestroyed() ? w : undefined, {
          properties: ['openFile'],
          filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa', 'vtt', 'sub'] }],
        });
        if (r.canceled || !r.filePaths?.[0]) return false;
        let subPath = r.filePaths[0];
        const origSub = subPath;
        try { subPath = trackTempSub(origSub, await prepareSubtitleFile(origSub, '', subTempDir(), { stripSdh: curSdh })); } catch {}
        if (now) {
          now.loadedSubMap = now.loadedSubMap || {};
          now.loadedSubMap[subPath] = origSub;
        }
        await mpv.clearExternalSubs();
        await mpv.command('sub-add', subPath, 'select');
        return true;
      }
      case 'night': {
        curNight = !curNight;
        await applyAudioFilters();
        return curNight;
      }
      case 'voice-clarity': {
        curVoiceClarity = c.on !== undefined ? !!c.on : !curVoiceClarity;
        store.set('voiceClarity', curVoiceClarity);
        await applyAudioFilters();
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { voiceClarity: curVoiceClarity });
        return curVoiceClarity;
      }
      case 'warm-tint': {
        curWarmTint = Math.max(0, Math.min(100, Math.round(Number(c.pct) || 0)));
        store.set('cinemaWarmTint', curWarmTint);
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { warmTint: curWarmTint });
        return curWarmTint;
      }
      case 'dimmer': {
        curDimmerPct = Math.max(0, Math.min(100, Math.round(Number(c.pct) || 0)));
        store.set('cinemaDimmerPct', curDimmerPct);
        return dimmer.apply({ activeWin: getWin(), opacity: curDimmerPct });
      }
      case 'display-profile': {
        const m = ['auto', 'oled', 'ips', 'hdr', 'standard'].includes(c.mode) ? c.mode : 'auto';
        curDisplayProfile = m;
        store.set('playerDisplayProfile', m);
        return applyDisplayProfile(m, true);
      }
      case 'sub-search': {
        const hub = getMediaHub();
        if (!hub?.searchSubtitles) return [];
        return hub.searchSubtitles({
          imdbId: now?.card?.metaId || String(now?.key || '').split(':')[0],
          type: now?.type || 'movie',
          season: now?.card?.season ?? null,
          episode: now?.card?.episode ?? null,
          query: String(c.query || now?.card?.seriesName || now?.card?.name || '').trim(),
          lang: String(c.lang || 'ar').trim(),
          addonSubs: now?.addonSubs || [],
        }).catch(() => []);
      }
      case 'aspect': {
        const allowed = ['fit', 'fill', 'stretch', 'zoom', '16:9', '4:3', '21:9'];
        curAspect = allowed.includes(c.mode) ? c.mode : 'fit';
        store.set('playerAspect', curAspect);
        await mpv.set('keepaspect', curAspect !== 'stretch').catch(() => {});
        const panscanVal = curAspect === 'fill' ? 1 : curAspect === 'zoom' ? 0.5 : 0;
        await mpv.set('panscan', panscanVal).catch(() => {});
        const override = curAspect === '16:9' ? '16:9' : curAspect === '4:3' ? '4:3' : curAspect === '21:9' ? '21:9' : '-1';
        await mpv.set('video-aspect-override', override).catch(() => {});
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { aspect: curAspect, panscan: panscanVal });
        return curAspect;
      }
      case 'eq': {
        for (const k of ['brightness', 'contrast', 'saturation', 'gamma']) {
          if (typeof c[k] === 'number') await mpv.set(k, Math.max(-100, Math.min(100, c[k]))).catch(() => {});
        }
        return true;
      }
      case 'eq-reset': {
        for (const k of ['brightness', 'contrast', 'saturation', 'gamma']) await mpv.set(k, 0).catch(() => {});
        return true;
      }
      case 'tone-mapping': {
        if (SAFE_TONE_MAPS.has(c.mode)) {
          curTone = c.mode;
          await mpv.set('tone-mapping', c.mode).catch(() => {});
        }
        return curTone;
      }
      case 'vsr-toggle': {
        const on = !!c.on;
        store.set('mediaVsr', on);
        if (mpv) {
          mpv.vsr = on;
          await mpv.set('hwdec', (on || mpv.rtxHdr) ? 'd3d11va' : 'auto-safe').catch(() => {});
          if (!html5Active) {
            const vp = mpv.props['video-params'];
            const bypassVsr = vp && ((vp.h || 0) >= 1440 || (vp['sig-peak'] || 1) > 1.5);
            await mpv.command('vf', 'set', rtxFilterFor(on && !bypassVsr, mpv.rtxHdr)).catch(() => {});
          }
        }
        return on;
      }
      case 'ab-loop': {
        if (c.step === 'a') { const t = mpv.props['time-pos']; if (t != null) await mpv.set('ab-loop-a', t).catch(() => {}); return { a: t ?? null }; }
        if (c.step === 'b') { const t = mpv.props['time-pos']; if (t != null) await mpv.set('ab-loop-b', t).catch(() => {}); return { b: t ?? null }; }
        await mpv.set('ab-loop-a', 'no').catch(() => {});
        await mpv.set('ab-loop-b', 'no').catch(() => {});
        return { a: null, b: null };
      }
      case 'duck': {
        const on = c.on !== undefined ? !!c.on : store.get('autoDuck') === false;
        store.set('autoDuck', on);
        if (!on && duckGain !== 1) { duckGain = 1; mpv.set('volume', userVol).catch(() => {}); }
        return on;
      }
      case 'spdif': {
        const on = c.on !== undefined ? !!c.on : !store.get('audioPassthrough');
        store.set('audioPassthrough', on);
        await mpv.set('audio-spdif', on ? SPDIF_CODECS : '').catch(() => {});
        return on;
      }
      case 'thumb': return thumbFor(c.t);
      case 'addon-subs': return now?.addonSubs || [];
      case 'addon-sub-add': {
        if (!/^https?:\/\//i.test(String(c.url || ''))) return false;
        let subSrc = c.url;
        try { subSrc = trackTempSub(c.url, await prepareSubtitleFile(c.url, String(c.lang || ''), subTempDir(), { stripSdh: curSdh })); } catch {}
        if (now) {
          now.loadedSubMap = now.loadedSubMap || {};
          now.loadedSubMap[subSrc] = c.url;
        }
        const ok = await mpv.command('sub-add', subSrc, c.secondary ? 'auto' : 'select', String(c.label || langDisplay(c.lang)).slice(0, 80), String(c.lang || '').slice(0, 16)).then(() => true, () => false);
        if (ok && c.secondary) {
          const tracks = Array.isArray(mpv.props['track-list']) ? mpv.props['track-list'] : [];
          const hit = tracks.find((t) => t.type === 'sub' && t['external-filename'] === subSrc);
          if (hit) await mpv.set('secondary-sid', hit.id).catch(() => {});
        }
        if (ok) toOverlay({ type: 'toast', kind: 'sub', text: String(c.label || langDisplay(c.lang)) });
        return ok;
      }
      case 'sub-text': return mpv.get('sub-text').catch(() => '');
      case 'ambient-glow': {
        const on = c.on !== undefined ? !!c.on : !store.get('ambientGlow');
        store.set('ambientGlow', on);
        return on;
      }
      case 'ultrawide-crop': {
        const curPan = Number(mpv.props['panscan'] || 0);
        const on = c.on !== undefined ? !!c.on : curPan < 0.5;
        await mpv.set('video-aspect-override', '-1').catch(() => {});
        await mpv.set('keepaspect', true).catch(() => {});
        const panscanVal = on ? 1.0 : 0;
        await mpv.set('panscan', panscanVal).catch(() => {});
        if (now?.card?.metaId || now?.key) getMediaHub()?.streamsBucket?.saveItemState?.(now.card?.metaId || now.key, { panscan: panscanVal });
        return on;
      }
      case 'screenshot': {
        const picDir = path.join(app.getPath('pictures'), 'Majlis');
        fs.mkdirSync(picDir, { recursive: true });
        const safeName = String(now?.card?.name || 'snapshot').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 48);
        const outPath = path.join(picDir, `${safeName}-${Date.now()}.png`);
        await mpv.command('screenshot-to-file', outPath, c.withSubs ? 'subtitles' : 'video');
        try {
          const img = nativeImage.createFromPath(outPath);
          if (!img.isEmpty()) clipboard.writeImage(img);
        } catch {}
        toOverlay({ type: 'toast', kind: 'shot', text: outPath, path: outPath });
        return { ok: true, path: outPath };
      }
      case 'save-clip': {
        if (!now?.url) return { ok: false, error: 'no active stream' };
        const ff = (typeof getFfmpeg === 'function' && getFfmpeg()) || findFfmpeg(store.get('ffmpeg'));
        if (!ff) return { ok: false, error: 'ffmpeg unavailable' };
        const durSec = c.seconds === 30 ? 30 : 15;
        const endPos = Math.max(0.5, Number(mpv.props['time-pos'] || 0));
        const startPos = Math.max(0, endPos - durSec);
        const actualDur = Math.max(1, Math.min(durSec, endPos - startPos));
        const clipDir = path.join(app.getPath('videos'), 'Majlis', 'Clips');
        fs.mkdirSync(clipDir, { recursive: true });
        const safeName = String(now?.card?.name || 'clip').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 40);
        const outPath = path.join(clipDir, `${safeName}-${durSec}s-${Date.now()}.mp4`);
        const hdrs = now.stream?.behaviorHints?.proxyHeaders?.request || {};
        const hdrStr = Object.entries(hdrs).map(([k, v]) => `${String(k).replace(/[\r\n:]/g, '')}: ${String(v).replace(/[\r\n]/g, '')}\r\n`).join('');
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
        if (hdrStr && /^https?:/i.test(now.url)) args.push('-headers', hdrStr);
        args.push('-ss', startPos.toFixed(2), '-t', actualDur.toFixed(2), '-i', now.url, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath);
        const res = await new Promise((resolveClip) => {
          const p = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
          try { if (p.pid) core?.adoptProcess?.(p.pid); } catch {}
          let errTxt = '';
          const timer = setTimeout(() => { try { p.kill(); } catch {} resolveClip({ ok: false, error: 'clip timed out' }); }, 45000);
          p.stderr?.on('data', (d) => { errTxt = (errTxt + d.toString()).slice(-400); });
          p.on('error', (err) => { clearTimeout(timer); resolveClip({ ok: false, error: err.message }); });
          p.on('close', (code) => { clearTimeout(timer); resolveClip(code === 0 && fs.existsSync(outPath) ? { ok: true, path: outPath } : { ok: false, error: errTxt || `ffmpeg exit ${code}` }); });
        });
        if (res.ok) toOverlay({ type: 'toast', kind: 'clip', text: `${durSec}s · ${path.basename(outPath)}`, path: outPath });
        else toOverlay({ type: 'toast', kind: 'err', text: res.error || 'Clip failed' });
        return res;
      }
      case 'sub-autosync': return runAutoSyncSub();
      case 'external-launch': {
        if (!now?.url) return { ok: false, error: 'no active stream' };
        await mpv.set('pause', true).catch(() => {});
        const kind = c.player === 'vlc' ? 'vlc' : 'mpv';
        const posSec = Math.max(0, Math.floor(Number(mpv.props['time-pos'] || 0)));
        const res = launchExternalPlayer({
          kind, url: now.url, title: now.card?.name || '',
          headers: now.stream?.behaviorHints?.proxyHeaders?.request || {}, posSec,
        });
        if (res.ok) toOverlay({ type: 'toast', kind: 'info', text: kind.toUpperCase() });
        else toOverlay({ type: 'toast', kind: 'err', text: res.error || `${kind} unavailable` });
        return res;
      }
      case 'export-m3u': {
        if (!now?.url) return { ok: false, error: 'no active stream' };
        const w = getWin();
        const safeName = String(now.card?.name || 'majlis-stream').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 48);
        const pick = await dialog.showSaveDialog(w && !w.isDestroyed() ? w : undefined, {
          defaultPath: `${safeName}.m3u8`,
          filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }],
        });
        if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
        const hdrs = now.stream?.behaviorHints?.proxyHeaders?.request || {};
        const lines = ['#EXTM3U', `#EXTINF:-1,${String(now.card?.name || 'Majlis Stream').replace(/[\r\n]/g, ' ')}`];
        for (const [hk, hv] of Object.entries(hdrs)) {
          const kl = String(hk || '').toLowerCase();
          const vv = String(hv || '').replace(/[\r\n]/g, ' ').trim();
          if (!vv) continue;
          if (kl === 'user-agent') lines.push(`#EXTVLCOPT:http-user-agent=${vv}`);
          else if (kl === 'referer' || kl === 'referrer') lines.push(`#EXTVLCOPT:http-referrer=${vv}`);
        }
        lines.push(now.url, '');
        fs.writeFileSync(`${pick.filePath}.tmp`, lines.join('\n'), 'utf8');
        fs.renameSync(`${pick.filePath}.tmp`, pick.filePath);
        toOverlay({ type: 'toast', kind: 'info', text: path.basename(pick.filePath) });
        return { ok: true, path: pick.filePath };
      }
      case 'pip-lock': {
        const w = getWin();
        if (!w || w.isDestroyed()) return false;
        const locked = !!c.locked;
        w.setResizable(!locked);
        return locked;
      }
      case 'bookmark-list': return getBookmarks();
      case 'bookmark-add': {
        const tSec = Math.max(0, Math.round(Number(c.t ?? mpv.props['time-pos'] ?? 0)));
        const list = getBookmarks().filter((b) => Math.abs(b.t - tSec) > 3);
        const next = [{ id: `bm-${Date.now()}`, t: tSec, label: String(c.label || '').trim().slice(0, 60), at: Date.now() }, ...list].sort((a, b) => a.t - b.t);
        const saved = saveBookmarks(next);
        toOverlay({ type: 'bookmarks', list: saved });
        return saved;
      }
      case 'bookmark-del': {
        const saved = saveBookmarks(getBookmarks().filter((b) => b.id !== c.id));
        toOverlay({ type: 'bookmarks', list: saved });
        return saved;
      }
      case 'sleep-eof': {
        sleepEof = !!c.on;
        return sleepEof;
      }
      case 'cancel-next-ep': {
        suppressAutoNext = c.on !== false;
        return suppressAutoNext;
      }
      case 'party-resume-anyway': {
        if (party?.role === 'host') return !!getHost()?.syncForceResume?.();
        return false;
      }
      case 'failover-dismiss': {
        if (now) { now.failoverDismissed = true; now.failoverOffered = false; }
        toOverlay({ type: 'failover-prompt', clear: true });
        return true;
      }
      case 'failover-switch': {
        if (!now || !c.candidate?.stream) return false;
        const posMs = Math.max(0, Math.round(Number(c.posMs ?? ((getProps()['time-pos'] || 0) * 1000)) || 0));
        const tried = [...(now.triedStreams || [])];
        toOverlay({ type: 'failover-prompt', clear: true });
        void play({
          type: now.type,
          id: now.key,
          card: now.card,
          stream: c.candidate.stream,
          addon: c.candidate.addon?.url || c.candidate.addon || null,
          pos: posMs,
          ranked: now.ranked,
          tried,
        }).catch(() => {});
        return true;
      }
      case 'switch-engine': {
        if (!now) return false;
        if (c.engine === 'html5') return activateHtml5Fallback('manual');
        if (c.engine === 'mpv' && html5Active) {
          const posMs = Math.max(0, Math.round(Number(getProps()['time-pos'] || 0) * 1000));
          stopHtml5Fallback();
          html5FallbackTried = true;
          await play({
            type: now.type,
            id: now.key,
            card: now.card,
            stream: now.stream,
            addon: now.addon,
            pos: posMs,
            ranked: now.ranked,
          }).catch(() => {});
          return true;
        }
        return false;
      }
    }
    return null;
  });

  ipcMain.handle('theater:html5-event', (_e, ev = {}) => {
    if (!html5Active || !shown) return false;
    const applyProp = (k, v) => {
      virtualProps[k] = v;
      if (mpv?.props) mpv.props[k] = v;
      onPlayerProp(k, v);
    };
    if (ev.props && typeof ev.props === 'object') {
      for (const [k, v] of Object.entries(ev.props)) applyProp(k, v);
    } else if (typeof ev.name === 'string') {
      applyProp(ev.name, ev.value);
    }
    if (ev.eof) applyProp('eof-reached', true);
    if (ev.error) {
      toOverlay({ type: 'player-error', message: String(ev.error), ranked: now?.ranked || [] });
    }
    return true;
  });

  // A state from the party (ours as host, or the host's as guest). A new film: open it here on
  // our own line (unless it's what's already playing). null: the party is over.
  async function onSync(role, st) {
    if (!st) { if (party?.role === role) { finalizePartySession(); party = null; lastPartyState = null; lastMismatch = null; lastPeersJson = ''; lastStructSig = ''; toOverlay({ type: 'party', state: null }); if (!shown) stopActiveTimers(); } return; }
    startActiveTimers();
    if (!party || party.epoch !== st.epoch) {
      party = {
        role,
        viewer: new SyncViewer({ smartCatchUp: store.get('smartCatchUp') !== false, speedCooldownMs: 1000, seekCooldownMs: 2500 }),
        epoch: st.epoch,
        lastCatchUp: false,
        seekSettleUntil: 0,
        lastAnchorAt: 0,
      };
      lastMismatch = null;
      lastPeersJson = '';
      lastStructSig = '';
      lastPeersEmitAt = 0;
      const src = st.src || {};
      if (role === 'guest' && src.stream && (src.stream.majlisDownload || src.stream.majlisLocalFile || src.stream.externalUrl)) {
        toOverlay({ type: 'player-error', message: 'blocked unsafe remote stream', ranked: [] });
        return;
      }
      if (!(now && now.key === src.id && mpv)) {
        try { await play({ type: src.type, id: src.id, card: src.card, stream: src.stream, pos: st.pos }); }
        catch (e) { toOverlay({ type: 'player-error', message: e.message, ranked: [] }); }
      }
      startPartySession(role);
    }
    const accepted = party.viewer.accept(st);
    if (accepted && st.reason === 'seek') {
      party.seekSettleUntil = Date.now() + 1200;
    }
    if (role === 'guest' && !lastMismatch && st.src && (mpv?.props?.duration || now?.stream)) {
      const localFn = now?.stream?.behaviorHints?.filename || now?.stream?.title || '';
      const mismatch = detectSourceMismatch({ hostDur: st.src.durationSec || 0, localDur: mpv?.props?.duration || 0, hostFilename: st.src.filename || '', localFilename: localFn });
      if (mismatch) {
        lastMismatch = mismatch;
        toOverlay({ type: 'party-mismatch', ...mismatch });
      }
    }
    const peers = (party.role === 'host' && getHost()?.sync?.peers?.()) || st.peers || [];
    const control = party.role === 'host' ? getHost()?.getWatchControl?.() : (getGuest()?.watchControl || null);
    const canControl = party.role === 'host' ? true : !!getGuest()?.canControl;
    lastPartyState = { reason: st.reason, waitingFor: st.waitingFor || [], waitEndsAt: st.waitEndsAt || 0, brb: st.brb || null, playing: st.playing, role, peers, control, canControl, mismatch: lastMismatch };
    toOverlay({ type: 'party', state: lastPartyState });
  }

  function onSyncPeers(st) {
    if (!party || !st || party.epoch !== st.epoch) return;
    const peers = st.peers || lastPartyState?.peers || [];
    lastPartyState = {
      ...(lastPartyState || {}),
      reason: st.reason ?? lastPartyState?.reason,
      waitingFor: st.waitingFor || [],
      waitEndsAt: st.waitEndsAt || 0,
      brb: st.brb !== undefined ? st.brb : (lastPartyState?.brb || null),
      playing: st.playing !== undefined ? st.playing : lastPartyState?.playing,
      role: party.role,
      peers,
      control: lastPartyState?.control || getGuest()?.watchControl || null,
      canControl: party.role === 'host' ? true : !!getGuest()?.canControl,
      mismatch: lastMismatch,
    };
    toOverlay({ type: 'party', state: lastPartyState });
  }

  // voice-chat ducking, party clock & mid-play failover loops (active ONLY while Theater or Party is live)
  let duckTimer = null, syncTimer = null, failoverTimer = null;
  let tick = 0, lastPeersJson = '';
  const streamSigOf = (s) => (s?.infoHash ? `ih:${String(s.infoHash).toLowerCase()}:${s.fileIdx ?? 0}` : String(s?.url || s?.ytUrl || ''));

  function stopActiveTimers() {
    if (duckTimer) { clearInterval(duckTimer); duckTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (failoverTimer) { clearInterval(failoverTimer); failoverTimer = null; }
  }

  function startActiveTimers() {
    if (!duckTimer) {
      duckTimer = setInterval(() => {
        const gLink = getGuest?.()?.link;
        if (gLink && !gLink._thVoice) {
          gLink._thVoice = true;
          gLink.on('raw', (b) => { if (b?.[0] === 0x09) lastVoiceAt = Date.now(); });
        }
        if (!shown || !mpv || !now) return;
        if (store.get('autoDuck') === false) {
          if (duckGain < 1) { duckGain = 1; mpv.set('volume', userVol).catch(() => {}); }
          return;
        }
        const hostSpeaking = [...(getHost?.()?.guests?.values() || [])].some((g) => g.speakingAt && Date.now() - g.speakingAt < 450);
        const active = hostSpeaking || (Date.now() - lastVoiceAt < 450);
        const want = active ? 0.6 : 1.0;
        if (Math.abs(duckGain - want) > 0.005) {
          duckGain = active ? Math.max(0.6, duckGain - 0.08) : Math.min(1.0, duckGain + 0.04);
          mpv.set('volume', Math.round(userVol * duckGain)).catch(() => {});
        }
      }, 60);
    }

    if (!syncTimer) {
      syncTimer = setInterval(() => {
        if (!party || (!mpv?.props && !html5Active)) return;
        const p = getProps();
        const local = Math.round((p['time-pos'] || 0) * 1000);
        if (party.role === 'host') {
          // Host is the clock authority: NEVER warp host playback speed or self-seek via SyncViewer
          const h = getHost();
          const st = h?.sync?.state;
          if (st) {
            const wantPaused = !st.playing;
            if (p.pause !== undefined && !!p.pause !== wantPaused) {
              if (html5Active) toOverlay({ type: 'html5-cmd', op: 'pause', on: wantPaused });
              else mpv.set('pause', wantPaused).catch(() => {});
            }
            const targetRate = st.rate || 1;
            if (!wantPaused && Math.abs((p.speed ?? 1) - targetRate) > 0.005) {
              if (html5Active) toOverlay({ type: 'html5-cmd', op: 'speed', v: targetRate });
              else mpv.set('speed', targetRate).catch(() => {});
            }
            if (st.playing && !p.pause && !p['paused-for-cache'] && p['time-pos'] != null) {
              const hostDrift = local - expected(st, Date.now());
              if (Math.abs(hostDrift) > 1500 && Date.now() - (party.lastAnchorAt || 0) > 3000) {
                party.lastAnchorAt = Date.now();
                h._syncSend(h.sync._set({ pos: local }, 'play'));
              }
            }
          }
          if (party.lastCatchUp) {
            party.lastCatchUp = false;
            toOverlay({ type: 'party-catchup', active: false, speed: 1, driftMs: 0 });
          }
        } else {
          const hostNow = getGuest()?.hostNow() ?? Date.now();
          party.viewer.setSmartCatchUp?.(store.get('smartCatchUp') !== false);
          const o = party.viewer.step(local, hostNow, !!p.pause, p.speed ?? 1, {
            buffering: !!p['paused-for-cache'],
            seeking: Date.now() < (party.seekSettleUntil || 0),
          });
          if (o.pause != null) {
            if (html5Active) toOverlay({ type: 'html5-cmd', op: 'pause', on: o.pause });
            else mpv.set('pause', o.pause).catch(() => {});
          }
          if (o.seek != null) {
            party.seekSettleUntil = Date.now() + 1200;
            lastPosEmitAt = 0;
            if (html5Active) toOverlay({ type: 'html5-cmd', op: 'seek', to: o.seek / 1000, abs: true });
            else mpv.command('seek', o.seek / 1000, 'absolute+exact').catch(() => {});
          }
          if (o.speed != null) {
            if (html5Active) toOverlay({ type: 'html5-cmd', op: 'speed', v: o.speed });
            else mpv.set('speed', o.speed).catch(() => {});
          }
          if (!!o.catchUp !== !!party.lastCatchUp) {
            party.lastCatchUp = !!o.catchUp;
            toOverlay({ type: 'party-catchup', active: !!o.catchUp, speed: o.speed || party.viewer.speed, driftMs: o.driftMs || 0 });
          }
          if (process.env.MAJLIS_DEBUG && tick % 8 === 0) { console.log('[sync]', JSON.stringify({ role: party.role, local, drift: Math.round(local - expected(party.viewer.state, hostNow)), speed: party.viewer.speed, playing: party.viewer.state?.playing, reason: party.viewer.state?.reason })); }
        }
        if (++tick % 2) return;
        const r = { stalled: !!p['paused-for-cache'] || (party.viewer.state?.playing && p['time-pos'] == null), cache: p['demuxer-cache-duration'] || 0, cacheSpeed: p['cache-speed'] || 0, name: store.get('nick') || '' };
        if (party.role === 'host') {
          const h = getHost();
          h?.syncReport(r);
          const st = h?.sync?.state;
          if (st) {
            const peers = h.sync.peers((id) => (id === 'host' ? store.get('nick') || 'Host' : h.guests?.get(id)?.nick || id));
            st.peers = peers;
            const normPeers = peers.map((x) => [x.id, !!x.stalled, Math.round(x.cache || 0), !!x.ready]);
            const structSig = JSON.stringify({ w: st.waitingFor || [], we: st.waitEndsAt || 0, re: st.reason, pl: st.playing, brb: st.brb?.endsAt || 0, sr: normPeers.map((x) => [x[0], x[1], x[3]]) });
            const fullSig = JSON.stringify([structSig, normPeers]);
            const nowTs = Date.now();
            if (structSig !== lastStructSig || (fullSig !== lastPeersJson && nowTs - lastPeersEmitAt >= 2000)) {
              lastStructSig = structSig;
              lastPeersJson = fullSig;
              lastPeersEmitAt = nowTs;
              const msg = { t: 'sync_peers', epoch: st.epoch, peers, waitingFor: st.waitingFor || [], waitEndsAt: st.waitEndsAt || 0, reason: st.reason, brb: st.brb || null, playing: st.playing };
              for (const g of h.guests?.values() || []) g.link.ctrl(msg);
              lastPartyState = { ...(lastPartyState || {}), reason: st.reason, waitingFor: st.waitingFor || [], waitEndsAt: st.waitEndsAt || 0, brb: st.brb || null, playing: st.playing, role: 'host', peers, control: h.getWatchControl?.(), canControl: true, mismatch: lastMismatch };
              toOverlay({ type: 'party', state: lastPartyState });
            }
          }
        } else {
          getGuest()?.syncReport(r);
        }
      }, 250);
    }

    if (!failoverTimer) {
      failoverTimer = setInterval(async () => {
        if (!shown || !now || !mpv?.props || party?.role === 'guest') return;
        const p = mpv.props;
        if (!now.hasFirstFrame || p.pause || now.failoverOffered || now.failoverDismissed) return;
        const curTs = Date.now();
        let reason = null;
        if (p['paused-for-cache']) {
          if (!now.stallSince) now.stallSince = curTs;
          else if (curTs - now.stallSince >= 10000) reason = 'stall';
        } else {
          now.stallSince = 0;
        }
        if (!reason && now.infoHash && !now.stream?.majlisLocalFile && !now.stream?.majlisDownload) {
          const st = await svc.stats(now.infoHash).catch(() => null);
          if (st && !st.finished) {
            const livePeers = st.peers ?? st.live?.snapshot?.peer_stats?.live ?? st.peer_stats?.live ?? null;
            if (livePeers === 0) {
              if (!now.zeroPeersSince) now.zeroPeersSince = curTs;
              else if (curTs - now.zeroPeersSince >= 10000) reason = 'zero-peers';
            } else {
              now.zeroPeersSince = 0;
            }
          }
        }
        if (!reason || !shown || !now) return;
        const tried = now.triedStreams || new Set();
        const candidate = Array.isArray(now.ranked) && now.ranked.length >= 2
          ? now.ranked.find((x) => x?.stream && x.trusted !== false && !x.stream.externalUrl && !tried.has(streamSigOf(x.stream)))
          : null;
        if (!candidate) {
          if (reason === 'stall' && curTs - now.stallSince >= 18000 && !now.singleRecoverTried) {
            now.singleRecoverTried = true;
            mpv._recover?.('buffer-stall');
          }
          return;
        }
        now.failoverOffered = true;
        toOverlay({
          type: 'failover-prompt',
          reason,
          candidate,
          autoSwitchSec: store.get('autoSkipStalled') ? 5 : 0,
          posMs: Math.round((p['time-pos'] || 0) * 1000),
        });
      }, 1000);
    }
  }

  const onPartyEvent = (kind, data) => {
    if (kind === 'vote') partyVotes = Array.isArray(data) ? data : [];
    if (kind === 'chat') toOverlay({ type: 'party-chat', ...data });
    else if (kind === 'react') toOverlay({ type: 'party-react', ...data });
    else if (kind === 'vote') toOverlay({ type: 'party-vote', items: partyVotes });
    else if (kind === 'brb') toOverlay({ type: 'party-brb', brb: data || null });
    else if (kind === 'rating-open') toOverlay({ type: 'party-rating-open', round: data || null });
    else if (kind === 'rating-state') toOverlay({ type: 'party-rating-state', round: data || null });
    else if (kind === 'ready') toOverlay({ type: 'party-ready', ...(data || {}) });
    else if (kind === 'countdown') toOverlay({ type: 'party-countdown', ...(data || {}) });
    else if (kind === 'control') {
      if (lastPartyState) lastPartyState = { ...lastPartyState, control: data, ...(typeof data?.canControl === 'boolean' ? { canControl: data.canControl } : {}) };
      toOverlay({ type: 'party-control', control: data || null, ...(typeof data?.canControl === 'boolean' ? { canControl: data.canControl } : {}) });
    }
    else if (kind === 'notes') toOverlay({ type: 'party-notes', notes: Array.isArray(data) ? data : [] });
    else if (kind === 'queue') toOverlay({ type: 'cin:queue-updated', items: Array.isArray(data) ? data : [] });
  };

  // what's on, for presence (Discord)
  const info = () => (incog() ? null : (now && (mpv?.props || html5Active) ? {
    name: now.card?.name || '',
    seriesName: now.card?.seriesName || '',
    type: now.type || now.card?.type || 'movie',
    year: now.card?.year || '',
    season: now.card?.season ?? null,
    episode: now.card?.episode ?? null,
    epTitle: now.card?.epTitle || '',
    poster: now.card?.poster || null,
    still: now.card?.still || null,
    pos: getProps()['time-pos'] || 0,
    dur: getProps().duration || 0,
    paused: !!getProps().pause,
    together: !!party,
  } : null));

  const videoAspect = () => {
    const vp = getProps()?.['video-params'];
    const w = vp?.dw || vp?.w || 0;
    const h = vp?.dh || vp?.h || 0;
    return w > 0 && h > 0 ? Math.max(0.5, Math.min(2.6, w / h)) : (16 / 9);
  };

  const setPipMode = (on) => {
    pipActive = !!on;
    if (overlay && !overlay.isDestroyed()) {
      try { overlay.setAlwaysOnTop(pipActive || !!store.get('alwaysOnTop'), 'floating'); } catch {}
    }
    fit(true);
    if (!pipActive && shown && overlay && !overlay.isDestroyed()) {
      try { overlay.show(); overlay.focus(); overlay.webContents.focus(); } catch {}
    }
  };

  return {
    play, quickplay, partyStart, close, onSync, onSyncPeers, onVoice, onPartyEvent, info, activity, saveFriend, ackFrame,
    videoAspect, setPipMode,
    startDrag: () => !!mpv?.startDrag?.(),
    focusOverlay: () => {
      if (shown && overlay && !overlay.isDestroyed()) {
        try { overlay.show(); overlay.focus(); overlay.webContents.focus(); } catch {}
      }
    },
    syncWindow: () => fit(true),
    playbackSnapshot: () => ({ open: shown && !!now, paused: !!getProps()?.pause, hasNext: !!now?.nextVideoId }),
    togglePause: () => runControlCmd('toggle'),
    seekBy: (sec) => runControlCmd('seek', { to: Number(sec) || 0 }),
    nextEpisode,
    pauseIfPlaying: () => {
      if (!shown) return;
      if (html5Active) toOverlay({ type: 'html5-cmd', op: 'pause', on: true });
      else if (mpv && mpv.props?.pause === false) mpv.set('pause', true).catch(() => {});
    },
    stop: (immediate = false) => {
      clearTimeout(resizeTimer);
      clearSettleTimers();
      clearStartupWatch();
      clearBlackScreenWatch();
      dimmer.clear();
      close();
      setWakeLock(false);
      stopActiveTimers();
      cleanupTempSubs();
      try { if (overlay && !overlay.isDestroyed()) overlay.destroy(); overlay = null; } catch {}
      try { thumbProc?.kill(); } catch {}
      try { mpv?.stop(immediate); } catch {}
      try { svc.stop(immediate); } catch {}
    },
    svc,
    activeTempSubs: () => tempSubFiles.slice(),
    activeMediaInfo: () => (now ? { infoHash: now.infoHash || null, file: now.file || null } : null),
    get mpv() { return mpv; },
  };
}

module.exports = { setup, detectSourceMismatch, detectDisplayProfile, DISPLAY_PROFILES, VOICE_CLARITY };

