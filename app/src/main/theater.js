'use strict';
// Cinema mode in the main process: the media service (catalogs, streams, torrents), mpv, and
// the two windows the film is shown in. mpv draws in its own borderless window (given an
// Electron window via --wid, Chromium's compositor painted over it: black); the engine makes it
// owned by the app window and lays it exactly over it. The controls live in a transparent
// window owned by mpv's, so HTML sits on top of the video. Both follow the app window's bounds.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { Mpv } = require('./mpv');
const { MediaService, DEFAULT_ADDONS } = require('./mediasvc');

const NIGHT = '@night:dynaudnorm=f=150:g=15:p=0.9';

function setup({ getWin, store, emit, preload, rendererDir, helper }) {
  const svc = new MediaService();
  let overlay = null, mpv = null, now = null, film = 0, shown = false; // now: what's on; film: mpv's window
  const hwnd = (bw) => Number(bw.getNativeWindowHandle().readBigUInt64LE(0));
  const addons = () => store.get('addons') || DEFAULT_ADDONS;
  const progress = () => store.get('mediaProgress') || {};
  const toOverlay = (m) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('ev', m); };

  function fit() {
    const w = getWin();
    if (!w || w.isDestroyed() || !overlay || !film) return;
    const b = w.getContentBounds(), f = screen.getDisplayMatching(b).scaleFactor;
    // the engine works in physical pixels
    helper.cmd({ cmd: 'place', hwnd: film, owner: hwnd(w), x: Math.round(b.x * f), y: Math.round(b.y * f), w: Math.round(b.width * f), h: Math.round(b.height * f), show: shown && !w.isMinimized() });
    overlay.setBounds(b);
    if (shown) helper.cmd({ cmd: 'place', hwnd: hwnd(overlay), owner: film, x: Math.round(b.x * f), y: Math.round(b.y * f), w: Math.round(b.width * f), h: Math.round(b.height * f), show: !w.isMinimized(), top: true });
  }

  async function windows() {
    if (overlay && !overlay.isDestroyed()) return;
    const w = getWin();
    overlay = new BrowserWindow({ frame: false, show: false, skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, hasShadow: false, transparent: true, backgroundColor: '#00000000', webPreferences: { preload, contextIsolation: true, sandbox: false } });
    overlay.setMenu(null);
    await overlay.loadFile(path.join(rendererDir, 'theater.html'));
    for (const ev of ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'restore', 'minimize']) w.on(ev, fit);
    // a borderless mpv window with no taskbar button of its own, parked until placed
    mpv = new Mpv({ args: ['--border=no', '--title=Majlis film', '--taskbar-progress=no', '--snap-window=no', '--window-dragging=no', '--auto-window-resize=no', '--keepaspect-window=no', '--geometry=1x1+-32000+-32000'] });
    // every (re)start of mpv is a new window: take it over again
    mpv.on('ready', async () => { try { film = Number(await mpv.get('window-id')); fit(); } catch {} });
    mpv.on('prop', (name, value) => {
      toOverlay({ type: 'player', name, value });
      emit('player', { name, value });
      if (name === 'time-pos' && now && value > 5) {
        const p = progress(), d = mpv.props.duration || 0;
        // remember where we were (every ~5 s of film), forget it once the film's nearly done
        if (!now.saved || Math.abs(value - now.saved) > 5) {
          now.saved = value;
          if (d && value > d * 0.95) delete p[now.key]; else p[now.key] = { t: value, d, at: Date.now(), meta: now.card };
          store.set('mediaProgress', p);
        }
      }
    });
    for (const ev of ['recovering', 'recovered', 'failed']) mpv.on(ev, (x) => toOverlay({ type: 'player-state', state: ev, detail: x }));
    await mpv.start();
  }

  function show() { shown = true; overlay.show(); fit(); overlay.focus(); }

  function close() {
    if (mpv) mpv.command('stop').catch(() => {});
    if (now?.infoHash) svc.call('stop', { infoHash: now.infoHash }).catch(() => {});
    now = null;
    shown = false; fit();
    if (overlay && !overlay.isDestroyed()) overlay.hide();
    const w = getWin(); if (w && !w.isDestroyed()) { if (w.isFullScreen()) w.setFullScreen(false); w.focus(); }
    emit('theater', { open: false });
  }

  // the URL mpv opens and the per-file options it needs
  async function resolve(stream) {
    if (stream.url && /^https?:/.test(stream.url)) {
      const h = stream.behaviorHints?.proxyHeaders?.request || {};
      const opts = {};
      const hs = Object.entries(h).map(([k, v]) => `${k}: ${v}`.replace(/,/g, '\\,'));
      if (hs.length) opts['http-header-fields'] = hs.join(',');
      return { url: stream.url, opts };
    }
    if (stream.infoHash) {
      const r = await svc.call('play', { infoHash: stream.infoHash, fileIdx: stream.fileIdx ?? 0, sources: stream.sources || [] });
      return { url: await svc.url(r.path), opts: {}, infoHash: stream.infoHash };
    }
    throw new Error('this stream type is not supported');
  }

  // Arabic first, then the user's other language, then English: added in that order, first selected
  async function subtitles(type, id) {
    try {
      const r = await svc.call('subtitles', { addons: addons(), type, id });
      const pref = ['ara', 'ar', store.get('subLang2') || 'eng', 'en'];
      const pick = [];
      for (const l of pref) for (const s of r.subtitles || []) if (s.lang === l && pick.length < 6 && !pick.includes(s)) pick.push(s);
      for (const [i, s] of pick.entries()) await mpv.command('sub-add', s.url, i === 0 ? 'select' : 'auto', `${s.lang} · ${s.addon || ''}`.trim(), s.lang).catch(() => {});
    } catch {}
  }

  ipcMain.handle('media:addons', async () => Promise.all(addons().map(async (url) => {
    try { return { url, ...(await svc.call('manifest', { url })) }; } catch (e) { return { url, error: e.message }; }
  })));
  ipcMain.handle('media:addon-add', async (e, url) => {
    const m = await svc.call('manifest', { url });
    const list = addons().filter((u) => u !== url);
    store.set('addons', [...list, url]);
    return m;
  });
  ipcMain.handle('media:addon-remove', (e, url) => { store.set('addons', addons().filter((u) => u !== url)); return true; });
  ipcMain.handle('media:addon-move', (e, { url, dir }) => {
    const l = [...addons()], i = l.indexOf(url), j = i + dir;
    if (i >= 0 && j >= 0 && j < l.length) { [l[i], l[j]] = [l[j], l[i]]; store.set('addons', l); }
    return l;
  });
  // every catalog that needs no input (search/genre-required ones aren't home rows)
  ipcMain.handle('media:rows', async () => {
    const rows = [];
    for (const url of addons()) {
      let m; try { m = await svc.call('manifest', { url }); } catch { continue; }
      for (const c of m.catalogs || []) {
        if ((c.extra || []).some((x) => x.isRequired) || (c.extraRequired || []).length) continue;
        rows.push({ addon: url, addonName: m.name, type: c.type, id: c.id, name: c.name || c.id });
      }
    }
    return rows;
  });
  ipcMain.handle('media:catalog', (e, q) => svc.call('catalog', q));
  ipcMain.handle('media:search', async (e, { q }) => {
    const out = [];
    for (const url of addons()) {
      let m; try { m = await svc.call('manifest', { url }); } catch { continue; }
      for (const c of m.catalogs || []) {
        if (!(c.extra || []).some((x) => x.name === 'search') && !(c.extraSupported || []).includes('search')) continue;
        try { const r = await svc.call('catalog', { addon: url, type: c.type, id: c.id, extra: `search=${encodeURIComponent(q)}` }); out.push({ type: c.type, name: c.name, metas: r.metas || [] }); } catch {}
      }
    }
    return out;
  });
  ipcMain.handle('media:meta', (e, { type, id }) => svc.call('meta', { addons: addons(), type, id }));
  ipcMain.handle('media:streams', (e, { type, id }) => svc.call('streams', { addons: addons(), type, id, prefs: { max_height: store.get('mediaMaxHeight') || 1080, debrid_only: !!store.get('debridOnly'), down_mbps: store.get('downMbps') || 0 } }));
  ipcMain.handle('media:progress', () => progress());

  // { type, id (the video: tt..:s:e for an episode), card (poster/name for "continue watching"), stream }
  ipcMain.handle('media:play', (e, x) => play(x));
  async function play({ type, id, card, stream }) {
    await windows();
    const r = await resolve(stream);
    const p = progress()[id];
    now = { key: id, card, stream, infoHash: r.infoHash, type };
    const opts = { ...r.opts, 'force-media-title': (card?.name || '').replace(/,/g, ' ') };
    if (p?.t) opts.start = String(Math.max(0, p.t - 3));
    show();
    emit('theater', { open: true, id, card });
    toOverlay({ type: 'theater', card, id });
    await mpv.load(r.url, opts);
    subtitles(type, id);
    return { ok: true };
  }

  ipcMain.handle('player:cmd', async (e, c) => {
    if (!mpv) return null;
    switch (c.cmd) {
      case 'toggle': return mpv.set('pause', !mpv.props.pause);
      case 'pause': return mpv.set('pause', !!c.on);
      case 'seek': return mpv.command('seek', c.to, c.abs ? 'absolute+exact' : 'relative+exact');
      case 'speed': return mpv.set('speed', Math.min(4, Math.max(0.25, c.v)));
      case 'volume': return mpv.set('volume', Math.min(150, Math.max(0, c.v)));
      case 'mute': return mpv.set('mute', !(await mpv.get('mute')));
      case 'sub-delay': return mpv.set('sub-delay', (mpv.props['sub-delay'] || 0) + c.d);
      case 'sid': return mpv.set('sid', c.id ?? 'no');
      case 'aid': return mpv.set('aid', c.id);
      case 'sub-scale': return mpv.set('sub-scale', c.v);
      case 'sub-pos': return mpv.set('sub-pos', c.v);
      case 'night': return mpv.command('af', 'toggle', NIGHT);
      case 'sub-file': return mpv.command('sub-add', c.path, 'select');
      case 'fullscreen': { const w = getWin(); w.setFullScreen(!w.isFullScreen()); return w.isFullScreen(); }
      case 'close': close(); return true;
      case 'state': return { ...mpv.props, now: now ? { card: now.card, id: now.key } : null };
    }
    return null;
  });

  return { play, close, stop: () => { mpv?.stop(); svc.stop(); }, svc, get mpv() { return mpv; } };
}

module.exports = { setup };
