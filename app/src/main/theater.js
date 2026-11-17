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
const { SyncViewer } = require('./sync');
const { dialog } = require('electron');
const imp = require('./imports');

const NIGHT = '@night:dynaudnorm=f=150:g=15:p=0.9';

function setup({ getWin, store, emit, preload, rendererDir, helper, getHost, getGuest }) {
  const svc = new MediaService();
  let overlay = null, mpv = null, now = null, film = 0, shown = false; // now: what's on; film: mpv's window
  const hwnd = (bw) => Number(bw.getNativeWindowHandle().readBigUInt64LE(0));
  // watch together on everyone's own line: { role: 'host'|'guest', viewer, epoch } while one is on
  let party = null;
  // Profiles ("who's watching"): each has its own addons, progress, library and ratings. The
  // default profile uses the plain keys, so what was there before stays.
  const profile = () => store.get('mediaProfile') || 'default';
  const pk = (k) => (profile() === 'default' ? k : `${k}@${profile()}`);
  const pget = (k) => store.get(pk(k));
  const pset = (k, v) => store.set(pk(k), v);
  const addons = () => pget('addons') || DEFAULT_ADDONS;
  // up from the start (an idle process), so the first visit to cinema doesn't wait for it
  svc._start().catch(() => {});
  const progress = () => pget('mediaProgress') || {};
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
      if (name === 'eof-reached' && value === true && now?.type === 'series' && store.get('autoNext') !== false && (!party || party.role === 'host')) nextEpisode().catch(() => {});
      if (name === 'time-pos' && now && value > 5) {
        const p = progress(), d = mpv.props.duration || 0;
        // remember where we were (every ~5 s of film), forget it once the film's nearly done
        if (!now.saved || Math.abs(value - now.saved) > 5) {
          now.saved = value;
          if (d && value > d * 0.95) delete p[now.key]; else p[now.key] = { t: value, d, at: Date.now(), meta: now.card };
          pset('mediaProgress', p);
        }
      }
    });
    for (const ev of ['recovering', 'recovered', 'failed']) mpv.on(ev, (x) => toOverlay({ type: 'player-state', state: ev, detail: x }));
    await mpv.start();
  }

  function show() { shown = true; overlay.show(); fit(); overlay.focus(); }

  function close() {
    if (party?.role === 'host') getHost()?.syncClose();
    party = null;
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
    pset('addons', [...list, url]);
    return m;
  });
  ipcMain.handle('media:addon-remove', (e, url) => { pset('addons', addons().filter((u) => u !== url)); return true; });
  ipcMain.handle('media:addon-move', (e, { url, dir }) => {
    const l = [...addons()], i = l.indexOf(url), j = i + dir;
    if (i >= 0 && j >= 0 && j < l.length) { [l[i], l[j]] = [l[j], l[i]]; pset('addons', l); }
    return l;
  });
  // every catalog that needs no input (search/genre-required ones aren't home rows)
  // every addon's manifest at once, in the user's order (a dead addon is just skipped)
  const manifests = () => Promise.all(addons().map((url) => svc.call('manifest', { url }).then((m) => ({ url, m }), () => null))).then((l) => l.filter(Boolean));
  ipcMain.handle('media:rows', async () => {
    const rows = [];
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs || []) {
        if ((c.extra || []).some((x) => x.isRequired) || (c.extraRequired || []).length) continue;
        rows.push({ addon: url, addonName: m.name, type: c.type, id: c.id, name: c.name || c.id });
      }
    }
    return rows;
  });
  ipcMain.handle('media:catalog', (e, q) => svc.call('catalog', q));
  ipcMain.handle('media:search', async (e, { q }) => {
    const jobs = [];
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs || []) {
        if (!(c.extra || []).some((x) => x.name === 'search') && !(c.extraSupported || []).includes('search')) continue;
        jobs.push(svc.call('catalog', { addon: url, type: c.type, id: c.id, extra: `search=${encodeURIComponent(q)}` }).then((r) => ({ type: c.type, name: c.name, metas: r.metas || [] }), () => null));
      }
    }
    return (await Promise.all(jobs)).filter(Boolean);
  });
  ipcMain.handle('media:meta', (e, { type, id }) => svc.call('meta', { addons: addons(), type, id }));
  ipcMain.handle('media:streams', (e, { type, id }) => svc.call('streams', { addons: addons(), type, id, prefs: { max_height: store.get('mediaMaxHeight') || 1080, debrid_only: !!store.get('debridOnly'), down_mbps: store.get('downMbps') || 0 } }));
  ipcMain.handle('media:progress', () => progress());

  // ---- bringing history in, and what friends have seen
  ipcMain.handle('media:stremio-import', async (e, { email, password }) => {
    const r = await imp.stremioImport(email, password); // the login itself isn't kept anywhere
    const list = addons(); for (const u of r.addons) if (!list.includes(u)) list.push(u);
    pset('addons', list);
    const lib = pget('mediaLibrary') || {}, p = progress();
    for (const x of r.library) {
      lib[x.id] = { id: x.id, type: x.type, name: x.name, poster: x.poster, watched: x.watched, at: x.at };
      if (x.t > 30 && x.d && x.t < x.d * 0.95) p[x.video || x.id] = { t: x.t, d: x.d, at: x.at, meta: { name: x.name, poster: x.poster, type: x.type, metaId: x.id } };
    }
    pset('mediaLibrary', lib); pset('mediaProgress', p);
    return { addons: r.addons.length, library: r.library.length };
  });
  ipcMain.handle('media:letterboxd-import', async () => {
    const pick = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Letterboxd export', extensions: ['zip'] }] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const lb = imp.letterboxdZip(pick.filePaths[0]);
    pset('letterboxd', lb);
    return { films: Object.keys(lb).length };
  });
  ipcMain.handle('media:friends-on', (e, m) => friendsOn(m));
  ipcMain.handle('media:profiles', () => ({ current: profile(), list: ['default', ...(store.get('mediaProfiles') || [])] }));
  ipcMain.handle('media:profile-set', (e, name) => {
    name = String(name || '').trim().slice(0, 24);
    if (!name) return profile();
    const list = store.get('mediaProfiles') || [];
    if (name !== 'default' && !list.includes(name)) store.set('mediaProfiles', [...list, name]);
    store.set('mediaProfile', name);
    return name;
  });

  // tonight's vote: through the host when we are one, else through the guest link
  const inRoom = () => (getHost()?.guests?.size ? 'host' : getGuest()?.link ? 'guest' : null);
  ipcMain.handle('vote:nominate', (e, meta) => { const r = inRoom(); if (r === 'host') getHost().voteNominate(meta, store.get('nick')); else if (r === 'guest') getGuest().voteNominate(meta); return r; });
  ipcMain.handle('vote:cast', (e, id) => { const r = inRoom(); if (r === 'host') getHost().voteCast(id, 'host'); else if (r === 'guest') getGuest().voteCast(id); return r; });
  ipcMain.handle('vote:winner', () => (inRoom() === 'host' ? getHost().voteWinner() : null));
  ipcMain.handle('vote:clear', () => { if (inRoom() === 'host') getHost().voteClear(); return true; });
  ipcMain.handle('vote:room', () => inRoom());

  // what we share with friends in the room: watched / rated / in progress (no more)
  function activity() {
    if (store.get('shareActivity') === false) return null;
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
  ipcMain.handle('media:play', (e, x) => play(x));
  async function play({ type, id, card, stream, pos }) {
    await windows();
    const r = await resolve(stream);
    const p = progress()[id];
    now = { key: id, card, stream, infoHash: r.infoHash, type };
    const opts = { ...r.opts, 'force-media-title': (card?.name || '').replace(/,/g, ' ') };
    if (pos != null) opts.start = String(pos / 1000);
    else if (p?.t) opts.start = String(Math.max(0, p.t - 3));
    show();
    emit('theater', { open: true, id, card });
    toOverlay({ type: 'theater', card, id });
    await mpv.load(r.url, opts);
    subtitles(type, id);
    return { ok: true };
  }

  ipcMain.handle('party:start', () => partyStart());
  async function partyStart() {
    const h = getHost();
    if (!h || !now || !mpv) return null;
    // everyone opens this same copy on their own line, paused where we are; it starts by itself
    // once all of them have it buffered
    const pos = Math.round((mpv.props['time-pos'] || 0) * 1000);
    return h.syncOpen({ stream: now.stream, type: now.type, id: now.key, card: now.card, pos });
  }
  ipcMain.handle('party:end', () => { if (party?.role === 'host') getHost()?.syncClose(); party = null; toOverlay({ type: 'party', state: null }); return true; });
  ipcMain.handle('party:info', () => ({ canStart: !!getHost()?.guests?.size, on: !!party, role: party?.role || null }));

  // The episode after this one, best copy first: on the end of an episode (auto-next) or from
  // the "next" button. In a party the host moves everyone along.
  async function nextEpisode() {
    if (!now || now.type !== 'series' || now.nexting) return null;
    now.nexting = true;
    try {
      const metaId = now.card?.metaId || String(now.key).split(':')[0];
      const { meta } = await svc.call('meta', { addons: addons(), type: 'series', id: metaId });
      const eps = (meta.videos || []).filter((v) => v.season > 0).sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));
      const i = eps.findIndex((v) => v.id === now.key);
      const nx = i >= 0 ? eps[i + 1] : null;
      if (!nx) return null;
      const { streams } = await svc.call('streams', { addons: addons(), type: 'series', id: nx.id, prefs: { max_height: store.get('mediaMaxHeight') || 1080, debrid_only: !!store.get('debridOnly'), down_mbps: store.get('downMbps') || 0 } });
      // the same release group as now if there is one (same subtitles timing, same quality), else the best
      const same = streams.find((s) => now.stream?.name && s.name === now.stream.name && s.addon?.id === now.stream.addon?.id);
      const pick = same || streams.find((s) => (s.majlis?.score ?? 0) > 0);
      if (!pick) return null;
      const card = { ...now.card, name: `${meta.name} · S${nx.season}E${nx.episode ?? nx.number}` };
      toOverlay({ type: 'next', name: card.name });
      if (party?.role === 'host') return getHost()?.syncOpen({ stream: pick, type: 'series', id: nx.id, card, pos: 0 });
      return play({ type: 'series', id: nx.id, card, stream: pick });
    } finally { if (now) now.nexting = false; }
  }
  ipcMain.handle('player:next', () => nextEpisode());

  ipcMain.handle('player:cmd', async (e, c) => {
    if (!mpv) return null;
    // in a party, playback is the group's: ask whoever holds the clock instead of acting alone
    if (party && ['toggle', 'pause', 'seek', 'speed'].includes(c.cmd)) {
      if (c.cmd === 'speed') return null;
      const cur = Math.round((mpv.props['time-pos'] || 0) * 1000);
      const r = c.cmd === 'seek' ? { action: 'seek', pos: c.abs ? Math.round(c.to * 1000) : Math.max(0, cur + Math.round(c.to * 1000)) }
        : { action: (c.cmd === 'toggle' ? !party.viewer.state?.playing : !c.on) ? 'play' : 'pause' };
      if (party.role === 'host') getHost()?.syncRequest(r); else getGuest()?.syncRequest(r);
      return true;
    }
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

  // A state from the party (ours as host, or the host's as guest). A new film: open it here on
  // our own line (unless it's what's already playing). null: the party is over.
  async function onSync(role, st) {
    if (!st) { if (party?.role === role) { party = null; toOverlay({ type: 'party', state: null }); } return; }
    if (!party || party.epoch !== st.epoch) {
      party = { role, viewer: new SyncViewer(), epoch: st.epoch };
      const src = st.src || {};
      if (!(now && now.key === src.id && mpv)) {
        try { await play({ type: src.type, id: src.id, card: src.card, stream: src.stream, pos: st.pos }); }
        catch (e) { toOverlay({ type: 'player-state', state: 'failed', detail: e.message }); }
      }
    }
    party.viewer.accept(st);
    toOverlay({ type: 'party', state: { reason: st.reason, waitingFor: st.waitingFor || [], playing: st.playing, role } });
  }

  // keep this player on the party clock, and tell the host how our buffer is doing
  let tick = 0;
  setInterval(() => {
    if (!party || !mpv?.props) return;
    const p = mpv.props;
    const local = Math.round((p['time-pos'] || 0) * 1000);
    const hostNow = party.role === 'host' ? Date.now() : getGuest()?.hostNow() ?? Date.now();
    const o = party.viewer.step(local, hostNow, !!p.pause, p.speed ?? 1);
    if (o.pause != null) mpv.set('pause', o.pause).catch(() => {});
    if (o.seek != null) mpv.command('seek', o.seek / 1000, 'absolute+exact').catch(() => {});
    if (o.speed != null) mpv.set('speed', o.speed).catch(() => {});
    if (process.env.MAJLIS_DEBUG && tick % 8 === 0) { const { expected } = require('./sync'); console.log('[sync]', JSON.stringify({ role: party.role, local, drift: Math.round(local - expected(party.viewer.state, hostNow)), speed: party.viewer.speed, playing: party.viewer.state?.playing, reason: party.viewer.state?.reason })); }
    if (++tick % 2) return;
    const r = { stalled: !!p['paused-for-cache'] || (party.viewer.state?.playing && p['time-pos'] == null), cache: p['demuxer-cache-duration'] || 0 };
    if (party.role === 'host') getHost()?.syncReport(r); else getGuest()?.syncReport(r);
  }, 250);

  // what's on, for presence (Discord)
  const info = () => (now && mpv?.props ? { name: now.card?.name || '', poster: now.card?.poster || null, pos: mpv.props['time-pos'] || 0, dur: mpv.props.duration || 0, paused: !!mpv.props.pause, together: !!party } : null);

  return { play, partyStart, close, onSync, info, activity, saveFriend, stop: () => { mpv?.stop(); svc.stop(); }, svc, get mpv() { return mpv; } };
}

module.exports = { setup };
