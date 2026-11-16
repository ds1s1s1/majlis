'use strict';
const { app, BrowserWindow, ipcMain, MessageChannelMain, globalShortcut, shell, dialog, Notification, nativeImage, clipboard, session, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const { Store } = require('./store');
const { Net } = require('./net');
const { Helper } = require('./helper');
const { Host } = require('./host');
const { Guest } = require('./guest');
const { detectEncoders, findFfmpeg } = require('./encoder');
const { Replay } = require('./replay');
const netcheck = require('./netcheck');
const { steamGames } = require('./library');
const { resolveFfmpeg, downloadFfmpeg } = require('./tools');

if (process.env.MAJLIS_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `Majlis-${process.env.MAJLIS_PROFILE}`));
if (!process.env.MAJLIS_PROFILE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// "No VSync" (set in Settings, applies on next start): frames go to the screen the moment
// they're decoded instead of waiting for the monitor's refresh. Lower latency, may tear.
try {
  const pre = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'majlis.json'), 'utf8'));
  if (pre.settings && pre.settings.noVsync) { app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit'); }
} catch {}
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

if (process.defaultApp) app.setAsDefaultProtocolClient('majlis', process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient('majlis');

let win, store, net, helper, host, guest, replay, port;
let encoders = [];
process.on('uncaughtException', (err) => {
  try {
    fs.mkdirSync(path.join(app.getPath('userData'), 'logs'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'logs', 'errors.log'), `${new Date().toISOString()} ${err && err.stack || err}
`);
  } catch {}
  try { emit('notice', { key: 'internal_error' }); } catch {}
});
process.on('unhandledRejection', (err) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'logs', 'errors.log'), `${new Date().toISOString()} rejection ${err && err.stack || err}
`); } catch {} });

let localView = false;
const logDir = () => path.join(app.getPath('userData'), 'logs');
let logLast = 0;
function logStats(kind, data) {
  const t = Date.now();
  if (t - logLast < 2000) return;
  logLast = t;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = path.join(logDir(), `${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFile(file, `${new Date().toISOString()} ${kind} ${JSON.stringify(data)}\n`, () => {});
  } catch {}
} // host is watching their own film in the stage
let lastCheck = null;
let ffmpegExe = null;
const ffmpegPath = () => ffmpegExe || findFfmpeg(store.get('ffmpeg'));

function useFfmpeg(exe) {
  ffmpegExe = exe;
  host.ffmpeg = exe; host.movie.ffmpeg = exe; replay.ffmpeg = exe;
  return detectEncoders(exe).then((list) => {
    encoders.splice(0, encoders.length, ...list);
    emit('encoders', { list: list.map((e) => e.name) });
    return list;
  });
}

// Hosting needs ffmpeg; fetch it the first time instead of shipping it with every copy.
let ffmpegJob = null;
function ensureFfmpeg() {
  if (ffmpegExe) return Promise.resolve(ffmpegExe);
  if (ffmpegJob) return ffmpegJob;
  emit('ffmpeg', { state: 'downloading', pct: 0 });
  ffmpegJob = downloadFfmpeg(app.getPath('userData'), ({ got, total, extracting }) => emit('ffmpeg', { state: extracting ? 'extracting' : 'downloading', pct: total ? Math.round((got / total) * 100) : 0 }))
    .then(async (exe) => { await useFfmpeg(exe); emit('ffmpeg', { state: 'ready' }); return exe; })
    .catch((e) => { emit('ffmpeg', { state: 'failed', detail: e.message }); return null; })
    .finally(() => { ffmpegJob = null; });
  return ffmpegJob;
}

const DEBUG = !!process.env.MAJLIS_DEBUG;
// While a stream runs, ask Windows to schedule our processes ahead of background stuff:
// the main process (network + encoding pipeline), the page that decodes, and the GPU process.
let boosted = false;
function boost(on) {
  if (on === boosted) return;
  boosted = on;
  const pr = on ? os.constants.priority.PRIORITY_ABOVE_NORMAL : os.constants.priority.PRIORITY_NORMAL;
  const pids = [process.pid];
  try { if (win && !win.isDestroyed()) pids.push(win.webContents.getOSProcessId()); } catch {}
  try { for (const m of app.getAppMetrics()) if (m.type === 'GPU') pids.push(m.pid); } catch {}
  for (const pid of pids) { try { os.setPriority(pid, pr); } catch {} }
}

function emit(type, data) {
  if (DEBUG && !/^(host|guest-stats)$/.test(type)) console.log('[ev]', type, JSON.stringify(data).slice(0, 300));
  if (win && !win.isDestroyed()) win.webContents.send('ev', { type, ...data });
}

// key code -> Windows virtual key, for push-to-talk that works inside games
const VK = { CapsLock: 0x14, Space: 0x20, Tab: 0x09, Backquote: 0xc0, ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3, AltLeft: 0xa4, AltRight: 0xa5, Mouse4: 0x05, Mouse5: 0x06, Mouse3: 0x04 };
for (let i = 0; i < 26; i++) VK[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
for (let i = 0; i < 10; i++) VK[`Digit${i}`] = 48 + i;
for (let i = 1; i <= 12; i++) VK[`F${i}`] = 0x6f + i;
function watchPtt() { helper.cmd({ cmd: 'ptt', vk: store.get('voice') === 'ptt' ? VK[store.get('pttKey')] || 0 : 0 }); }

function deepLink(argv) {
  const a = (argv || []).find((x) => /^majlis:\/\//i.test(x));
  if (!a) return null;
  const m = a.match(/^majlis:\/\/(join|code)\/(\d{6}|\d{9})/i);
  return m ? { kind: m[1].toLowerCase(), target: m[2] } : null;
}
let pendingLink = deepLink(process.argv);

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 980, minHeight: 640,
    backgroundColor: store.get('theme') === 'light' ? '#f3eee5' : '#11100e',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    icon: path.join(__dirname, '../renderer/img/icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '../renderer/index.html'), (process.env.MAJLIS_VIEW || process.env.MAJLIS_DRAWER) ? { query: { view: process.env.MAJLIS_VIEW, pick: process.env.MAJLIS_PICK || '', drawer: process.env.MAJLIS_DRAWER || '' } } : undefined);
  // dev aid: MAJLIS_SHOT=out.png saves a screenshot of the page after a delay
  if (process.env.MAJLIS_SHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.MAJLIS_SHOT, img.toPNG());
      if (process.env.MAJLIS_SHOT_QUIT) app.quit();
    }, +(process.env.MAJLIS_SHOT_DELAY || 4000));
  }
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => setupPort());
  if (DEBUG) win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('[renderer]', msg); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('focus', () => win.flashFrame(false));
  // Let the renderer talk to a DualSense over WebHID for gyro and touchpad.
  win.webContents.session.on('select-hid-device', (e, details, cb) => {
    e.preventDefault();
    const d = details.deviceList.find((x) => x.vendorId === 0x054c);
    cb(d ? d.deviceId : '');
  });
  win.webContents.session.setDevicePermissionHandler((d) => d.deviceType === 'hid' && d.device.vendorId === 0x054c);
  win.webContents.session.setPermissionCheckHandler((wc, perm) => ['hid', 'media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(perm));
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
}

function overlayColors() {
  return store.get('theme') === 'light' ? { color: '#f3eee5', symbolColor: '#3a342c', height: 38 } : { color: '#11100e', symbolColor: '#cfc6b8', height: 38 };
}

function setupPort() {
  const { port1, port2 } = new MessageChannelMain();
  port = port1;
  port1.on('message', (e) => {
    const m = e.data;
    if (m.t === 'hvo') return host.hostVoice(Buffer.from(m.data));
    guest._fromRenderer(m);
  });
  port1.start();
  guest.port = port1;
  host.removeAllListeners('voice');
  host.removeAllListeners('local');
  host.on('local', (m) => { if (localView) port1.postMessage(m); });
  host.on('voice', (v) => port1.postMessage({ t: 'vo', idx: v.idx, data: v.data }));
  win.webContents.postMessage('port', null, [port2]);
}

// ------------------------------------------------------------------------------- state
function snapshot() {
  const idn = store.identity();
  return {
    id: idn.id, settings: store.all(), friends: store.friends(), games: store.games(),
    registered: net.registered, publicAddr: net.publicAddr, relays: net.relays, noServer: !store.hasServer(),
    encoders: encoders.map((e) => e.name), ffmpeg: !!ffmpegExe, helper: helper.info ? { vigem: helper.info.vigem, wgc: helper.info.wgc, displays: helper.info.displays } : null,
    host: host.stats(), guest: guest.link ? { state: 'linked', host: guest.link.peer, safety: guest.link.safety } : { state: guest.state },
    lastCheck, peaks: store.peaks(), usage: usageSummary(), routerLock: findRouterLock(), replay: replay.running,
    version: app.getVersion(), platform: `${os.type()} ${os.release()}`,
  };
}

function usageSummary() {
  const u = store.d.usage || {}, today = new Date().toISOString().slice(0, 10), month = today.slice(0, 7);
  let m = 0; for (const [k, v] of Object.entries(u)) if (k.startsWith(month)) m += v;
  return { today: u[today] || 0, month: m };
}

function findRouterLock() {
  const cands = [store.get('routerLock'), path.join(os.homedir(), 'Downloads', 'DS1-Router-Lock.exe'), path.join(os.homedir(), 'Desktop', 'DS1-Router-Lock.exe'), 'A:\\ss\\ds1-router-lock\\dist\\DS1-Router-Lock.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DS1 Router Lock', 'DS1-Router-Lock.exe')];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

function inviteLink(target) {
  const srv = String(store.get('server') || '');
  const base = store.get('inviteBase') || (/^https:\/\//i.test(srv) ? srv.replace(/\/+$/, '') : '');
  if (!base) return `majlis://${target.length === 6 ? 'code' : 'join'}/${target}`;
  return `${base.replace(/\/$/, '')}/${target.length === 6 ? 'c' : 'j'}/${target}`;
}

// ------------------------------------------------------------------------------- shortcuts
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const tryReg = (acc, fn) => { try { if (acc) globalShortcut.register(acc, fn); } catch {} };
  tryReg(store.get('panicKey'), () => { if (host.enabled || host.guests.size) { host.panic(); } });
  tryReg(store.get('replayKey'), async () => { const r = await replay.save(); emit('replay', r); });
}

// ------------------------------------------------------------------------------- IPC
function handlers() {
  ipcMain.handle('state', () => snapshot());
  ipcMain.handle('settings', (e, patch) => {
    const before = store.get('server');
    store.patch(patch);
    if (patch.theme && win) win.setTitleBarOverlay(overlayColors());
    if (('server' in patch && patch.server !== before) || 'accessKey' in patch) { setTimeout(() => { app.relaunch(); app.exit(0); }, 400); }
    if ('panicKey' in patch || 'replayKey' in patch) registerShortcuts();
    if ('pttKey' in patch || 'voice' in patch) watchPtt();
    if (patch.ffmpeg) resolveFfmpeg({ custom: patch.ffmpeg, dataDir: app.getPath('userData'), resources: process.resourcesPath }).then((exe) => exe && useFfmpeg(exe));
    if (['fps', 'maxRes', 'qualityPreset', 'maxMbps', 'codec', 'tenBit', 'hdr', 'lightSpectators'].some((k) => k in patch) && host.guests.size) host._retier(true);
    if (('watchMbps' in patch || 'maxRes' in patch) && host.movie.info) host.applyMovieQuality();
    if ('replay' in patch) { if (patch.replay && host.guests.size) replay.start(store.get('display')); if (!patch.replay) replay.stop(); }
    if (patch.shareStatus !== undefined || patch.nick !== undefined) pushPresence();
    return store.all();
  });
  ipcMain.handle('friend', (e, f) => { const r = store.upsertFriend(f); pushPresence(); return r; });
  ipcMain.handle('friend:remove', (e, id) => { store.removeFriend(id); pushPresence(); return true; });

  ipcMain.handle('connect', (e, { target, caps, pin }) => guest.connect(target, caps, { pin }));
  ipcMain.handle('datasaver', (e, on) => guest.setDataSaver(on));
  ipcMain.handle('clip:send-host', () => guest.ctrl({ t: 'clip', text: clipboard.readText().slice(0, 10000) }));
  ipcMain.handle('clip:send-guest', (e, sid) => host.sendClip(sid, clipboard.readText()));
  // mini player: small, always on top, for keeping an eye on the stream while doing something else
  let normalBounds = null;
  ipcMain.handle('mini', () => {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (normalBounds) { win.setAlwaysOnTop(false); win.setMinimumSize(980, 640); win.setBounds(normalBounds); normalBounds = null; return false; }
    normalBounds = win.getBounds();
    const wa = screen.getDisplayMatching(normalBounds).workArea;
    win.setMinimumSize(320, 200);
    win.setBounds({ width: 520, height: 330, x: wa.x + wa.width - 540, y: wa.y + wa.height - 350 });
    win.setAlwaysOnTop(true, 'floating');
    return true;
  });
  ipcMain.handle('cancel', () => guest.cancel());
  ipcMain.handle('leave', () => guest.leave());
  ipcMain.handle('guest:ctrl', (e, m) => guest.ctrl(m));

  ipcMain.handle('host:enable', (e, on) => { host.setEnabled(on); if (on) ensureFfmpeg(); return host.stats(); });
  ipcMain.handle('ffmpeg:get', () => ensureFfmpeg());
  ipcMain.handle('host:code', (e, revoke) => host.newCode(revoke));
  ipcMain.handle('host:decide', (e, d) => host.decide(d.sid, d));
  ipcMain.handle('host:role', (e, { sid, role }) => host.setRole(sid, role));
  ipcMain.handle('host:slot', (e, { sid, slot }) => host.setSlot(sid, slot));
  ipcMain.handle('host:expiry', (e, { sid, duration }) => host.setExpiry(sid, duration));
  ipcMain.handle('host:mute', (e, { sid, on }) => host.mute(sid, on));
  ipcMain.handle('host:kick', (e, { sid, block }) => host.kick(sid, block));
  ipcMain.handle('host:hotseat', (e, on) => host.setHotseat(on));
  ipcMain.handle('host:pass', (e, sid) => host.passBaton(sid));
  ipcMain.handle('host:panic', () => host.panic());
  ipcMain.handle('host:source', (e, src) => host.setSource(src));

  // Screens and windows with live thumbnails, like Discord's share picker.
  ipcMain.handle('sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
    if (!helper.p) helper.start();
    const disp = (await helper.request({ cmd: 'displays' }, 'displays'))?.list || [];
    // only windows Windows will actually let us capture (visible, not cloaked, not tool windows)
    const capturable = new Set(((await helper.request({ cmd: 'windows' }, 'windows'))?.list || []).map((w) => String(w.hwnd)));
    const own = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const out = [];
    for (const s of list) {
      const [kind, idStr] = s.id.split(':');
      if (kind === 'window' && (idStr === own || (capturable.size && !capturable.has(idStr)) || /^(NVIDIA GeForce Overlay|Program Manager|Windows Input Experience|Microsoft Text Input Application|Settings)$/i.test(s.name))) continue;
      const item = { kind, name: s.name, thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null };
      if (kind === 'window') { item.hwnd = Number(idStr); if (!item.thumb) continue; }
      else {
        // match Electron's display to the DXGI output index the capture uses
        const d = screen.getAllDisplays().find((x) => String(x.id) === String(s.display_id));
        const r = d ? screen.dipToScreenRect(null, d.bounds) : null;
        const hit = r && disp.find((x) => Math.abs(x.x - r.x) < 4 && Math.abs(x.y - r.y) < 4);
        item.index = hit ? hit.index : out.filter((o) => o.kind === 'screen').length;
        item.res = hit ? `${hit.w}×${hit.h}` : '';
      }
      out.push(item);
    }
    return out;
  });
  ipcMain.handle('perms', (e, p) => { store.patch(p); host.pushPerms(); return store.all(); });
  ipcMain.handle('host:chatmute', (e, { sid, on }) => host.muteChat(sid, on));
  ipcMain.handle('logs', () => { fs.mkdirSync(logDir(), { recursive: true }); shell.openPath(logDir()); });
  ipcMain.handle('windows', async () => { if (!helper.p) helper.start(); return (await helper.request({ cmd: 'windows' }, 'windows'))?.list || []; });
  ipcMain.handle('displays', async () => { if (!helper.p) helper.start(); return (await helper.request({ cmd: 'displays' }, 'displays'))?.list || []; });

  ipcMain.handle('netcheck', async (e, opts) => {
    lastCheck = await netcheck.check(net, store, opts || {});
    if (lastCheck.detected && store.get('connType') === 'auto') lastCheck.autoType = lastCheck.detected;
    return lastCheck;
  });

  ipcMain.handle('games:scan', async () => {
    const found = await steamGames();
    const games = store.games();
    for (const g of found) if (!games.find((x) => x.id === g.id)) games.push({ ...g, visible: true });
    for (const g of games) if (g.source === 'steam') { const f = found.find((x) => x.id === g.id); if (f) g.cover = f.cover; }
    store.setGames(games);
    return games;
  });
  ipcMain.handle('games:add', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Games', extensions: ['exe', 'lnk', 'url', 'bat'] }] });
    if (r.canceled || !r.filePaths[0]) return store.games();
    const p = r.filePaths[0];
    const games = store.games();
    games.push({ id: `exe:${Date.now()}`, name: path.basename(p).replace(/\.(exe|lnk|url|bat)$/i, ''), source: 'manual', path: p, visible: true });
    store.setGames(games);
    return games;
  });
  ipcMain.handle('games:update', (e, list) => { store.setGames(list); return list; });
  ipcMain.handle('games:launch', (e, id) => launchGame(id, null));

  ipcMain.handle('replay:save', async () => replay.save());

  // watch party
  ipcMain.handle('mode', (e, m) => { host.setMode(m); return host.stats(); });
  ipcMain.handle('movie:pick', async () => {
    if (!(await ensureFfmpeg())) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'wmv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return await host.movieOpen(r.filePaths[0]); } catch (err) { emit('notice', { key: 'movie_error', detail: err.message }); return null; }
  });
  ipcMain.handle('movie:open', async (e, { file, pos }) => { try { return await host.movieOpen(file, { pos }); } catch (err) { emit('notice', { key: 'movie_error', detail: err.message }); return null; } });
  ipcMain.handle('movie:ctl', (e, { op, value }) => host.movieCtl(op, value));
  ipcMain.handle('movie:sub-file', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa', 'vtt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return host.movieCtl('sub', `f${r.filePaths[0]}`);
  });
  ipcMain.handle('local:view', (e, on) => {
    localView = !!on;
    if (on && host.movie.config) { const c = host.movie.config; port.postMessage({ t: 'config', codec: c.codec, family: c.family, description: c.description.toString('base64'), epoch: c.epoch, fps: c.fps, encoder: c.encoder, tier: 'movie' }); }
    return true;
  });
  ipcMain.handle('chat', (e, text) => host.hostChat(text));
  ipcMain.handle('react', (e, r) => host.react({ r: String(r).slice(0, 8), idx: 0, from: store.get('nick') || '' }));
  ipcMain.handle('ready:check', () => host.readyCheck());
  ipcMain.handle('ready:go', () => host.countdown());
  ipcMain.handle('shot', (e, dataUrl) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const dir = path.join(app.getPath('pictures'), 'Majlis');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const file = path.join(dir, `Majlis ${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    return file;
  });
  ipcMain.handle('show-file', (e, f) => { if (f && fs.existsSync(f)) shell.showItemInFolder(f); });
  ipcMain.handle('open', (e, url) => { if (/^(https?|majlis):/.test(url)) shell.openExternal(url); });
  ipcMain.handle('copy', (e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('invite', (e, target) => inviteLink(target));
  ipcMain.handle('routerlock', () => {
    const p = findRouterLock();
    if (p) { spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p) }).unref(); return true; }
    shell.openExternal('https://github.com/ds1s1s1/ds1-router-lock/releases');
    return false;
  });
  ipcMain.handle('pick:file', async (e, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('identity:new', () => { store.resetIdentity(); app.relaunch(); app.exit(0); });
  ipcMain.handle('fullscreen', (e, on) => { win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on); return win.isFullScreen(); });
  ipcMain.handle('vigem', () => shell.openExternal('https://github.com/nefarius/ViGEmBus/releases'));
}

function launchGame(id, by) {
  const g = store.games().find((x) => x.id === id);
  if (!g) return false;
  if (g.source === 'steam') shell.openExternal(`steam://rungameid/${g.appid}`);
  else if (g.path) {
    if (/\.(lnk|url)$/i.test(g.path)) shell.openPath(g.path);
    else spawn(g.path, g.args ? g.args.split(' ') : [], { cwd: path.dirname(g.path), detached: true, stdio: 'ignore' }).unref();
  }
  emit('launched', { name: g.name, by });
  return true;
}

function guestLibrary() {
  return store.games().filter((g) => g.visible).map((g) => {
    let cover = null;
    try { if (g.cover && fs.existsSync(g.cover)) cover = nativeImage.createFromPath(g.cover).resize({ width: 180 }).toJPEG(72).toString('base64'); } catch {}
    return { id: g.id, name: g.name, cover };
  });
}

function pushPresence() {
  const allow = store.get('shareStatus') ? store.friends().filter((f) => f.trust !== 'block').map((f) => f.id) : [];
  net.setPresence({ allow });
}

function pollPresence() {
  const ids = store.friends().filter((f) => f.trust !== 'block').map((f) => f.id);
  if (!ids.length || !net.registered) return;
  net.signal(net._sign({ t: 'presence', id: net.id.id, ids, ts: Date.now() }));
}

// ------------------------------------------------------------------------------- boot
app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  net = new Net(store.identity(), store);
  helper = new Helper();
  guest = new Guest({ net, store });
  host = new Host({ store, net, helper, encoders, ffmpeg: ffmpegPath() });
  replay = new Replay({ ffmpeg: ffmpegPath(), helper, store, encoders });
  handlers();
  createWindow();
  registerShortcuts();

  let firstReg = true;
  net.on('registered', (r) => {
    emit('registered', { publicAddr: r.publicAddr, relays: r.relays, via: net.cloud ? 'cloud' : r.via });
    if (firstReg) { firstReg = false; pushPresence(); }
  });
  net.on('taken', () => { store.bumpSalt(); emit('id-changed', { id: store.identity().id }); net._hello(); });
  net.on('presence', (on) => emit('presence', { on }));
  net.on('server-error', (e) => emit('notice', { key: e === 'access' ? 'server_access' : 'server_error' }));
  net.on('knock-progress', (p) => emit('knock-progress', p));
  setInterval(pollPresence, 15000);

  host.on('knock', (k) => {
    emit('knock', k);
    if (!win.isFocused()) {
      win.flashFrame(true);
      try { new Notification({ title: k.known ? `${k.name} يبي يدخل` : 'أحد يبي يدخل مجلسك', body: `${k.from.slice(0, 3)} ${k.from.slice(3, 6)} ${k.from.slice(6)}` }).show(); } catch {}
    }
  });
  host.on('knock-gone', (k) => emit('knock-gone', k));
  host.on('joined', (g) => { emit('joined', g); if (store.get('replay')) replay.start(store.get('display')); });
  host.on('left', (g) => { emit('left', g); if (!host.guests.size) replay.stop(); });
  host.on('update', () => { emit('host', host.stats()); boost(host.guests.size > 0 || !!guest.link); });
  host.on('stats', (s) => { emit('host', s); if (s.guests.length) logStats('host', { tiers: s.tiers, guests: s.guests.map((g) => ({ rtt: g.rtt, kbps: g.kbps, target: g.target, loss: g.loss, qd: g.qd, jitter: g.jitter, fps: g.fps, path: g.path?.kind, label: g.path?.label, fec: g.fec, stab: g.stability, r: g.rendition, role: g.role })), movie: s.movie ? { playing: s.movie.playing, pos: Math.round(s.movie.pos) } : null }); });
  host.on('hand', (h) => emit('hand', h));
  host.on('baton', (b) => emit('baton', b));
  host.on('panic', () => { emit('panic', {}); replay.stop(); });
  host.on('notice', (n) => emit('notice', n));
  host.on('encoder-error', (e) => emit('notice', { key: 'encoder_error', detail: e.err }));
  host.on('library-request', (g) => g.link.ctrl({ t: 'library', games: guestLibrary() }));
  host.on('movie', (v) => emit('movie', v));
  host.on('chat', (c) => emit('chat', c));
  host.on('react', (r) => emit('react', r));
  host.on('countdown', (c) => emit('countdown', c));
  host.on('askpause', (a) => emit('askpause', a));
  host.on('movie-by', (a) => emit('movie-by', a));
  host.on('launch', ({ by, id }) => launchGame(id, by));

  guest.on('state', (s) => { emit('guest', s); boost(s.state === 'linked' || host.guests.size > 0); });
  guest.on('ctrl', (m) => emit('guest-ctrl', m));
  guest.on('stats', (s) => { emit('guest-stats', s); logStats('guest', { rtt: s.rtt, kbps: s.kbps, loss: s.loss, lost: s.lost, fps: s.fps, qd: s.qd, jitter: s.jitter, path: s.path?.kind, label: s.path?.label, dec: s.dec }); });
  guest.on('path', (p) => emit('guest-path', p));
  guest.on('kicked', (k) => { emit('kicked', k); guest.leave(); });

  helper.on('hello', (h) => { emit('helper', { vigem: h.vigem, wgc: h.wgc, displays: h.displays }); watchPtt(); });
  helper.on('ptt', (p) => emit('ptt', { down: p.down }));
  host.on('clip', (c) => { clipboard.writeText(c.text); emit('clip', { from: c.from }); });
  guest.on('ctrl', (m) => { if (m.t === 'clip' && typeof m.text === 'string') { clipboard.writeText(m.text); emit('clip', { from: m.from }); } });
  // data used, per day (for people on mobile data plans)
  let lastBytes = 0;
  setInterval(() => {
    let total = 0;
    for (const l of net.links.values()) total += l.stats.tx + l.stats.rx;
    const delta = total >= lastBytes ? total - lastBytes : total;
    lastBytes = total;
    if (delta > 0) { const k = new Date().toISOString().slice(0, 10); store.d.usage = store.d.usage || {}; store.d.usage[k] = (store.d.usage[k] || 0) + delta; store.save(); }
  }, 5000);

  try { await net.start(); } catch (e) { emit('notice', { key: 'net_failed', detail: e.message }); }

  resolveFfmpeg({ custom: store.get('ffmpeg'), dataDir: app.getPath('userData'), resources: process.resourcesPath }).then((exe) => {
    if (exe) useFfmpeg(exe);
    else emit('ffmpeg', { state: 'missing' });
  });
  // Start the helper early so displays and controller support show up in settings.
  helper.start();

  if (pendingLink) setTimeout(() => emit('deeplink', pendingLink), 800);

  // dev aids for testing two copies on one machine
  if (process.env.MAJLIS_AUTOHOST) {
    host.setEnabled(true);
    host.on('knock', (k) => host.decide(k.sid, { accept: true, role: process.env.MAJLIS_AUTOHOST }));
  }
  if (process.env.MAJLIS_MOVIE) setTimeout(async () => { host.setEnabled(true); host.setMode('watch'); await ensureFfmpeg(); await host.movieOpen(process.env.MAJLIS_MOVIE, { fresh: true, autoplay: true }); }, 2500);
  if (process.env.MAJLIS_CHAT) setTimeout(() => host.hostChat(process.env.MAJLIS_CHAT), 9000);
  if (process.env.MAJLIS_JOIN) setTimeout(() => emit('deeplink', { kind: 'join', target: process.env.MAJLIS_JOIN }), 3000);
});

app.on('second-instance', (e, argv) => {
  const l = deepLink(argv);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  if (l) emit('deeplink', l);
});
app.on('open-url', (e, url) => { const l = deepLink([url]); if (l) emit('deeplink', l); });

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { guest?.leave(); host?.panic(); host?.dispose(); replay?.stop(); } catch {}
  try { helper?.cmd({ cmd: 'mode_restore' }); helper?.stop(); net?.stop(); store?.flush(); } catch {}
});
