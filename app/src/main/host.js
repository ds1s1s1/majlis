'use strict';
// Hosting: accepts friends, gives each one a role and a controller slot, runs the encoders and
// routes input, audio, voice and the cursor.
//
// Roles:  watch  = spectator (gets a lighter stream so they don't eat the host's upload)
//         pad    = controller only
//         kbm    = keyboard + mouse (+ controller)
//         full   = everything, including launching games from the library

const { EventEmitter } = require('events');
const { Encoder } = require('./encoder');
const { EngineEncoder } = require('./engine');
const { makeTx, makeRc } = require('./media');
const { Movie } = require('./movie');
const { SyncHost } = require('./sync');

const ROLES = ['watch', 'pad', 'kbm', 'full'];

// [0x02][flags][epoch][hostTs u32][pts u32][seq u16] + opus
let audioSeq = 0;
const movieConfigMsg = (c) => ({ t: 'config', codec: c.codec, family: c.family, description: c.description.toString('base64'), epoch: c.epoch, fps: c.fps, encoder: c.encoder, tier: 'movie', hdr: false });

function audioPacket(opus, timed, epoch, pts) {
  const b = Buffer.allocUnsafe(13 + opus.length);
  b[0] = 0x02; b[1] = timed ? 1 : 0; b[2] = epoch & 0xff;
  b.writeUInt32BE(Date.now() >>> 0, 3); b.writeUInt32BE(pts >>> 0, 7); b.writeUInt16BE(audioSeq = (audioSeq + 1) & 0xffff, 11);
  opus.copy(b, 13);
  return b;
}
const CAN = {
  pad: (r) => r === 'pad' || r === 'kbm' || r === 'full',
  kbm: (r) => r === 'kbm' || r === 'full',
  launch: (r) => r === 'full',
};
const now = () => Date.now();

class Host extends EventEmitter {
  constructor({ store, net, helper, encoders, ffmpeg, engine }) {
    super();
    this.store = store; this.net = net; this.helper = helper; this.encoders = encoders; this.ffmpeg = ffmpeg; this.engine = engine || null;
    this.enabled = false;
    this.guests = new Map();     // sid -> guest
    this.knocks = new Map();     // sid -> knock awaiting decision
    this.tiers = { play: null, watch: null };
    this.hotseat = { on: false, holder: null };
    this.cursorShapes = new Map();
    this.code = null;
    this.audioSeq = 0;
    this.lastRumble = new Map();
    this.displays = [];

    net.on('knock', (k) => this._onKnock(k));
    net.on('code', (c) => { this.code = c.code ? { code: c.code, exp: c.exp } : null; this.emit('update'); });
    // the engine came back after a crash: pads, audio, pointer and streams again
    helper.on('restart', () => { this._helperOn = false; this.gameAudioOn = undefined; if (this.guests.size) { this._ensureHelper(); } });
    helper.on('opus', (pkt) => { if (!this.movie.info) this._sendAudio(audioPacket(pkt.subarray(4), 0, 0, 0)); });
    helper.on('cursor', (c) => {
      const b = Buffer.allocUnsafe(14); b[0] = 0x0a; b.writeFloatLE(c.x, 1); b.writeFloatLE(c.y, 5); b[9] = c.visible ? 1 : 0; b.writeInt32LE(c.shape, 10);
      this.lastCursor = b;
      this._broadcastRaw(b);
    });
    helper.on('cursor_shape', (s) => { this.cursorShapes.set(s.id, s); for (const g of this.guests.values()) g.link.ctrl({ t: 'cursor_shape', ...s }); });
    helper.on('rumble', (r) => {
      const key = `${r.slot}`;
      const prev = this.lastRumble.get(key);
      if (prev && prev.large === r.large && prev.small === r.small) return;
      this.lastRumble.set(key, r);
      for (const g of this.guests.values()) if (this._padSlotOf(g) === r.slot) { const b = Buffer.from([0x0b, r.large, r.small]); g.link.send(b); g.link.send(b); }
    });

    // ---- watch party
    this.mode = store.get('mode') === 'watch' ? 'watch' : 'play';
    this.movie = new Movie(ffmpeg);
    this.sync = new SyncHost();
    this.vote = []; // tonight's nominations: [{ id, type, name, poster, by, voters: [ids] }]
    this.movie.on('config', (c) => {
      for (const g of this.guests.values()) this._sendMovieConfig(g);
      if (c.rendition === 'low') return;
      this.emit('local', movieConfigMsg(c));
    });
    this.movie.on('frame', (f) => {
      for (const g of this.guests.values()) if (g.tier === 'movie' && (g.rendition || 'high') === f.rendition && g.configSent.movie === f.epoch) g.tx.send(f);
      if (f.rendition === 'high') this.emit('local', { t: 'v', epoch: f.epoch, id: f.id, key: f.key, data: f.data, enc: f.encMs, net: 0, pts: f.pts });
    });
    // The light film changed bitrate: what the old one encoded ahead (up to ~10 s) is still
    // queued for each viewer. Swap it for the new one from where the line is, so a step down
    // reaches the screen in ~2 s instead of ~10 (by then a weak line had long run dry).
    this.movie.on('lowswap', () => {
      const m = this.movie, ep = m.lowConfig?.epoch;
      for (const g of this.guests.values()) {
        const s = g.tx.sentPts;
        if (g.tier !== 'movie' || g.rendition !== 'low' || g.configSent.movie !== ep || s == null) continue;
        g.tx.flush();
        g.bufHist = []; // judge the new bitrate on its own trend, not the one that led to it
        const out = [...m.hist.low.filter((f) => f.epoch === ep || f.pts > s), ...m.ahist.filter((a) => a.pts > s).map((a) => ({ a, pts: a.pts }))];
        out.sort((x, y) => x.pts - y.pts);
        for (const x of out) x.a ? g.tx.sendRaw(audioPacket(x.a.data, 1, x.a.epoch, x.a.pts)) : g.tx.send(x);
      }
    });
    this.movie.on('audio', ({ data, pts, epoch }) => {
      // film audio rides the paced queue with the picture; on a line that loses packets each
      // one also goes again a packet later, so a single loss is never heard
      const b = audioPacket(data, 1, epoch, pts);
      for (const g of this.guests.values()) {
        if (g.tier !== 'movie') continue;
        g.tx.sendRaw(b);
        if (g.prevA && (g.rc?.lossEw || 0) > 0.003) g.tx.sendRaw(g.prevA);
        g.prevA = b;
      }
      this.emit('local', { t: 'a', data, timed: true, epoch, pts, age: 0 });
    });
    // the film is ready to go: start its clock once everyone watching has a bit of it in hand
    this.movie.on('ready', () => this._waitBuffers());
    // The film clock: everyone shows the same frame at the same moment. A new run (start, seek,
    // new settings) makes what's queued for sending stale.
    this.movie.on('clock', (c) => {
      const fresh = c.run !== this.clockRun;
      this.clockRun = c.run;
      if (fresh) for (const g of this.guests.values()) g.prevA = null; // no audio from the old run
      for (const g of this.guests.values()) g.tx.setClock?.(c);
      for (const g of this.guests.values()) {
        if (fresh && g.tier === 'movie') { g.tx.flush(); g.audioRun = c.run; }
        if (g.tier === 'movie' || this.mode === 'watch') g.link.ctrl({ t: 'fclock', ...c });
      }
      this.emit('local', { t: 'clock', ...c });
    });
    this.movie.on('spawn', (pid) => this._gpuPriority(pid));
    this.movie.on('state', (st) => this._movieState(st));
    this.movie.on('ended', ({ next }) => {
      this._saveResume(true);
      if (next && this.store.get('autoNext')) {
        this.emit('notice', { key: 'next_episode' });
        setTimeout(() => this.movieOpen(next, { autoplay: true, fresh: true }), 2500);
      }
    });
    this.movie.on('error', (e) => this.emit('notice', { key: 'movie_error', detail: String(e).slice(0, 300) }));
    this.readyCount = 0;
    this.chatLog = [];

    this.tick = setInterval(() => this._tick(), 500);
    this.peakTimer = setInterval(() => this._recordPeak(), 60000);
  }

  // ------------------------------------------------------------------ hosting on/off
  setEnabled(on) {
    this.enabled = !!on;
    this.net.setPresence({ busy: this.guests.size > 0 });
    if (!on) for (const k of this.knocks.values()) k.decide(false);
    if (!on) this.knocks.clear();
    this.emit('update');
  }

  newCode(revoke) {
    this.net.signal(this.net._sign({ t: 'code', id: this.net.id.id, revoke: !!revoke, ts: now() }));
  }

  // ------------------------------------------------------------------ knocks
  _onKnock(k) {
    if (!this.enabled) return k.decide(false);
    const friend = this.store.friend(k.from);
    const pinned = friend && friend.pk;
    const keyChanged = pinned && friend.pk !== k.pk;
    k.known = !!friend; k.keyChanged = !!keyChanged; k.name = friend?.name && friend.name !== k.from ? friend.name : k.nick || k.from;
    k.at = now();
    // trusted friends and valid room codes skip the prompt (unless the key changed)
    // Same person, same key, still listed: their old connection died without us noticing yet.
    // Retire it and treat this as a reconnect.
    const stale = [...this.guests.values()].find((x) => x.id === k.from && x.link.peer.pk === k.pk);
    if (stale) { (this.recentDrops ||= new Map()).set(stale.id, { role: stale.role, slot: stale.slot, pk: k.pk, at: now() }); stale.link.close('replaced'); }
    // came back after a drop: same seat, no questions
    const rd = this.recentDrops?.get(k.from);
    if (!keyChanged && rd && now() - rd.at < 180000 && rd.pk === k.pk) { this.recentDrops.delete(k.from); return this.decide(k.sid, { accept: true, role: rd.role, slot: rd.slot, duration: 'session', auto: 'reconnect' }, k); }
    // room PIN: right PIN gets in without a prompt, no PIN (or wrong) gets told to enter one
    const pinSet = String(this.store.get('roomPin') || '').trim();
    if (pinSet && !(friend && friend.trust === 'always')) {
      const want = require('crypto').createHmac('sha256', pinSet).update(k.sid).digest('hex').slice(0, 32);
      if (k.pin !== want) return k.decide(false, { reason: 'pin' });
      if (!keyChanged) return this.decide(k.sid, { accept: true, role: this.store.get('defaultRole') || 'pad', duration: 'session', auto: 'pin' }, k);
    }
    if (!keyChanged && friend && friend.trust === 'always') return this.decide(k.sid, { accept: true, role: friend.role || this.store.get('defaultRole'), duration: 'session', auto: 'trusted' }, k);
    if (!keyChanged && k.viaCode && this.code && k.viaCode === this.code.code && this.code.exp > now() && this.store.get('acceptCodes')) {
      return this.decide(k.sid, { accept: true, role: 'watch', duration: 'session', auto: 'code' }, k);
    }
    this.knocks.set(k.sid, k);
    this.emit('knock', this._knockView(k));
    setTimeout(() => { if (this.knocks.has(k.sid)) { this.knocks.delete(k.sid); k.decide(false); this.emit('knock-gone', { sid: k.sid }); } }, 60000);
  }

  _knockView(k) { return { sid: k.sid, from: k.from, nick: k.nick, name: k.name, known: k.known, keyChanged: k.keyChanged, viaCode: k.viaCode, at: k.at }; }

  async decide(sid, { accept, role = 'pad', duration = 'session', trust = false, auto = null, slot: wantSlot = null }, kk) {
    const k = kk || this.knocks.get(sid);
    if (!k) return false;
    this.knocks.delete(sid);
    this.emit('knock-gone', { sid });
    if (!accept) { k.decide(false); this.emit('update'); return true; }
    const link = await k.decide(true);
    if (!link) return false;
    const prev = this.store.friend(k.from);
    const name = prev?.name && prev.name !== k.from ? prev.name : k.nick || k.from;
    const friend = this.store.upsertFriend({ id: k.from, pk: k.pk, name, lastSeen: now(), ...(trust ? { trust: 'always', role } : {}) });
    const g = {
      sid, link, id: k.from, nick: friend.name, role: ROLES.includes(role) ? role : 'watch', slot: null, padType: 'x360',
      tier: null, tx: makeTx(link), joined: now(), auto, caps: k.caps || {}, fb: null, stats: {}, inSeq: -1,
      expiresAt: duration === 'session' ? null : now() + ({ '10m': 600e3, '1h': 3600e3 }[duration] || 0) || null,
      muted: false, hand: false, configSent: {},
    };
    this.guests.set(sid, g);
    // a frame we dropped to stay live: the engine stops referencing it, so nothing smears
    g.tx.onSkip = (id) => g.tierEnc?.()?.invalidate?.([id]);
    if (CAN.pad(g.role)) g.slot = wantSlot && ![...this.guests.values()].some((x) => x !== g && x.slot === wantSlot) ? wantSlot : this._freeSlot();
    this._wire(g);
    this.emit('joined', { sid, name: g.nick, auto });
    this.net.setPresence({ busy: true });
    this._ensureHelper();
    this._retier();
    this.emit('update');
    return true;
  }

  _freeSlot() {
    const used = new Set([...this.guests.values()].map((g) => g.slot).filter(Boolean));
    for (let s = 1; s <= 4; s++) if (!used.has(s)) return s;
    return null;
  }

  // ------------------------------------------------------------------ per guest wiring
  _wire(g) {
    const { link } = g;
    link.ctrl({ t: 'welcome', host: this.store.get('nick') || this.net.id.id, hostId: this.net.id.id, role: g.role, slot: g.slot, safety: link.safety, hotseat: this.hotseat.on, mode: this.mode, canControl: this._canControl(g), perms: this._perms(g) });
    if (this.mode === 'watch' && this.movie.info) link.ctrl({ t: 'movie', ...this._movieView() });
    for (const c of this.chatLog.slice(-30)) link.ctrl({ t: 'chat', ...c, old: true });
    for (const s of this.cursorShapes.values()) link.ctrl({ t: 'cursor_shape', ...s });
    // a watch-together film is on: the newcomer opens it on their own line and falls in step
    if (this.sync.state) link.ctrl({ t: 'sync_state', ...this.sync.state });
    if (this.vote.length) link.ctrl({ t: 'vote_state', items: this._voteView() });
    // what we've watched, for their title pages (if we share it)
    const act = this.getActivity?.(); if (act) link.ctrl({ t: 'activity', items: act });
    this._roster();
    link.on('ctrl', (m) => this._onCtrl(g, m));
    link.on('raw', (b) => this._onRaw(g, b));
    link.on('path', (p) => { g.path = p; this.emit('update'); });
    link.on('close', (reason) => this._drop(g.sid, reason));
  }

  _onCtrl(g, m) {
    switch (m.t) {
      case 'hello':
        g.caps = { ...g.caps, ...m.caps };
        g.maxKbps = +m.caps?.maxKbps || 0;
        g.screen = m.screen; g.padType = m.padType === 'ds4' ? 'ds4' : 'x360';
        g.connType = m.connType;
        if (g.slot) this._attachPad(g);
        this._retier(true);
        break;
      case 'key': g.tierEnc()?.requestKeyframe(); break;
      case 'hand': g.hand = !!m.on; this.emit('hand', { sid: g.sid, name: g.nick, on: g.hand }); this._roster(); this.emit('update'); break;
      case 'library': if (CAN.launch(g.role)) this.emit('library-request', g); break;
      case 'launch': if (CAN.launch(g.role)) this.emit('launch', { by: g.nick, id: m.id }); break;
      case 'pass': if (this.hotseat.on && this.hotseat.holder === g.sid) this.passBaton(m.to); break;
      case 'limit': g.maxKbps = +m.kbps || 0; this._retier(); break;
      case 'clip': if (CAN.kbm(g.role) && typeof m.text === 'string' && m.text.length <= 10000) this.emit('clip', { from: g.nick, text: m.text }); break;
      case 'bye': g.link.close('bye'); break;
      case 'chat': {
        if (!this._perms(g).chat) return;
        const text = String(m.text || '').trim().slice(0, 300);
        if (!text || now() - (g.lastChat || 0) < 400) return;
        g.lastChat = now();
        this.chat({ from: g.nick, idx: this._speakerIdx(g), text });
        break;
      }
      case 'react': {
        if (!this._perms(g).react) return;
        const r = String(m.r || '').slice(0, 8);
        if (!r || now() - (g.lastReact || 0) < 250) return;
        g.lastReact = now();
        this.react({ r, idx: this._speakerIdx(g), from: g.nick });
        break;
      }
      case 'ready': g.ready = !!m.on; this.emit('update'); break;
      // watch together (each on their own line): requests from those who may control, and
      // everyone's buffer reports
      case 'activity': this.emit('activity', { id: g.id, name: g.nick, items: m.items }); break;
      case 'vote_nominate': this.voteNominate(m.meta, g.nick); break;
      case 'vote_cast': this.voteCast(m.id, g.sid); break;
      case 'sync_req': if (this._canControl(g)) this._syncSend(this.sync.request(m)); break;
      case 'sync_rep': this._syncSend(this.sync.report(g.sid, m, (id) => this.guests.get(id)?.nick || this.store.get('nick') || '')); break;
      case 'askpause': this.emit('askpause', { name: g.nick }); break;
      case 'movie': if (this._canControl(g)) this.movieCtl(m.op, m.value, g.nick); break;
    }
  }

  sendClip(sid, text) { const g = this.guests.get(sid); if (g && typeof text === 'string') g.link.ctrl({ t: 'clip', text: text.slice(0, 10000), from: this.store.get('nick') || '' }); }

  _perms(g) {
    return { chat: this.store.get('allowChat') !== false && !g?.chatMuted, react: this.store.get('allowReactions') !== false && !g?.chatMuted };
  }
  pushPerms() { for (const g of this.guests.values()) g.link.ctrl({ t: 'perms', ...this._perms(g) }); this.emit('update'); }
  muteChat(sid, on) { const g = this.guests.get(sid); if (!g) return; g.chatMuted = !!on; g.link.ctrl({ t: 'perms', ...this._perms(g) }); this.emit('update'); }

  // Desktop audio capture on/off, without restarting it when it's already in the right state
  // (a restart is an audible gap).
  // Which sound goes out: everything except Majlis itself (friends' voices and our own
  // sounds never echo back to them), or, when one window is shared and "that window's sound
  // only" is on, just that program's sound (like Discord).
  _gameAudio(on) {
    const only = on && this.store.get('captureWindow') && this.store.get('windowAudioOnly') !== false ? this.wincap?.pid : null;
    const key = on ? `on:${only || ''}` : 'off';
    if (key === this.gameAudioOn) return;
    this.gameAudioOn = key;
    this.helper.cmd(on ? { cmd: 'audio', on: true, kbps: 128, keep: this.store.get('replaySeconds') + 5, ...(only ? { include: only } : { exclude: process.pid }) } : { cmd: 'audio', on: false });
  }

  // Ask Windows to schedule the encoder's GPU work ahead of the game's, so a game pinning the
  // GPU at 100% doesn't starve capture and encoding (that's where most host-side stutter comes from).
  _gpuPriority(pid) { if (pid) this.helper.cmd({ cmd: 'gpu_prio', pid }); }

  // ------------------------------------------------------------------ chat, reactions, ready check
  chat({ from, idx, text }) {
    const c = { from, idx, text: String(text).slice(0, 300), at: now() };
    this.chatLog.push(c); if (this.chatLog.length > 200) this.chatLog.shift();
    for (const g of this.guests.values()) g.link.ctrl({ t: 'chat', ...c });
    this.emit('chat', c);
  }
  hostChat(text) { const t = String(text || '').trim(); if (t) this.chat({ from: this.store.get('nick') || '', idx: 0, text: t }); }

  react({ r, idx, from }) {
    for (const g of this.guests.values()) g.link.ctrl({ t: 'react', r, idx, from });
    this.emit('react', { r, idx, from });
  }

  readyCheck() {
    for (const g of this.guests.values()) { g.ready = false; g.link.ctrl({ t: 'ready?' }); }
    this.emit('update');
  }

  countdown() {
    for (const g of this.guests.values()) g.link.ctrl({ t: 'countdown', ms: 3000 });
    this.emit('countdown', { ms: 3000 });
    clearTimeout(this.cdTimer);
    this.cdTimer = setTimeout(() => this.movieCtl('play'), 3000);
  }

  // ------------------------------------------------------------------ mode & movie
  setMode(mode) {
    this.mode = mode === 'watch' ? 'watch' : 'play';
    this.store.set('mode', this.mode);
    if (this.mode === 'play') { this._saveResume(); this.movie.stop(); this._gameAudio(true); }
    for (const g of this.guests.values()) { g.configSent = {}; g.link.ctrl({ t: 'mode', mode: this.mode, canControl: this._canControl(g) }); }
    if (this.guests.size) this._retier();
    this.emit('update');
  }

  _movieMaxW() { return { 720: 1280, 1080: 1920, 1440: 2560 }[this.store.get('maxRes')] || 3840; }

  // quality changed while a film is on: carry on from the same spot with the new settings
  applyMovieQuality() {
    this.movie.kbps = (this.store.get('watchMbps') || 15) * 1000;
    this.movie.maxW = this._movieMaxW();
    this.movie.restart({});
  }

  _canControl(g) { return this.store.get('watchControl') === 'all' || g.role === 'full'; }

  // ---- tonight's vote: anyone nominates a title, everyone has one vote (changing it moves it),
  // the host plays the winner. Only well-formed nominations get in (they crossed the network).
  voteNominate(meta, by) {
    const id = String(meta?.id || '').slice(0, 64);
    if (!/^[\w:.-]+$/.test(id) || this.vote.some((v) => v.id === id) || this.vote.length >= 20) return;
    this.vote.push({ id, type: meta.type === 'series' ? 'series' : 'movie', name: String(meta.name || id).slice(0, 120), poster: /^https:\/\//.test(meta.poster || '') ? String(meta.poster).slice(0, 500) : null, by: String(by || '').slice(0, 64), voters: [] });
    this._voteSend();
  }
  voteCast(id, voter) {
    for (const v of this.vote) v.voters = v.voters.filter((x) => x !== voter);
    const v = this.vote.find((x) => x.id === id); if (v) v.voters.push(voter);
    this._voteSend();
  }
  voteClear() { this.vote = []; this._voteSend(); }
  // the most votes; a tie is settled at random (the wheel)
  voteWinner() {
    const top = Math.max(0, ...this.vote.map((v) => v.voters.length));
    const tied = this.vote.filter((v) => v.voters.length === top);
    return tied.length ? tied[Math.floor(Math.random() * tied.length)] : null;
  }
  _voteView() { return this.vote.map(({ voters, ...v }) => ({ ...v, votes: voters.length, voters: voters.map((s) => (s === 'host' ? this.store.get('nick') || '' : this.guests.get(s)?.nick || '')) })); }
  _voteSend() { const items = this._voteView(); for (const g of this.guests.values()) g.link.ctrl({ t: 'vote_state', items }); this.emit('vote', items); }

  // ---- watch together, each viewer on their own line (cinema mode). `src` is what every viewer
  // resolves and plays themselves: { stream, type, id, card }.
  syncOpen(src) { const st = this.sync.open(src, src.card); this._syncSend(st); return st; }
  syncRequest(r) { return this._syncSend(this.sync.request({ epoch: this.sync.state?.epoch, ...r })); }
  syncReport(r) { return this._syncSend(this.sync.report('host', { epoch: this.sync.state?.epoch, ...r }, () => this.store.get('nick') || '')); }
  syncClose() { this.sync.state = null; for (const g of this.guests.values()) g.link.ctrl({ t: 'sync_end' }); this.emit('sync', null); }
  _syncSend(st) {
    if (!st) return null;
    for (const g of this.guests.values()) g.link.ctrl({ t: 'sync_state', ...st });
    this.emit('sync', st);
    return st;
  }

  async movieOpen(file, { autoplay = false, fresh = false, pos } = {}) {
    if (this.mode !== 'watch') this.setMode('watch');
    this._saveResume();
    const enc = this._encFor(this._pickCodec([...this.guests.values()]));
    const resume = fresh ? 0 : pos ?? this.store.d.resume?.[file]?.pos ?? 0;
    const st = await this.movie.open(file, { enc, kbps: (this.store.get('watchMbps') || 15) * 1000, maxW: this._movieMaxW(), night: this.store.get('nightAudio'), pos: resume });
    this._gameAudio(false); // the film's own audio replaces the desktop's
    for (const g of this.guests.values()) g.configSent = {};
    this._retier();
    if (autoplay) this.movie.play();
    return st;
  }

  async movieCtl(op, value, by) {
    const m = this.movie;
    if (!m.info) return;
    switch (op) {
      case 'play': await m.play(); break;
      case 'pause': m.pause(); this._saveResume(); break;
      case 'toggle': if (m.state.playing) { m.pause(); this._saveResume(); } else await m.play(); break;
      case 'seek': await m.seek(+value || 0); break;
      case 'skip': await m.seek(m.state.pos + (+value || 0)); break;
      case 'audio': await m.setAudio(value == null ? null : +value); break;
      case 'sub': await m.setSub(value || null); break;
      case 'night': this.store.set('nightAudio', !!value); await m.setNight(!!value); break;
      case 'subsize': await m.setSubSize(['small', 'normal', 'large'].includes(value) ? value : 'normal'); break;
      case 'subdelay': await m.setSubDelay((m.state.subDelay || 0) + (+value || 0)); break;
      case 'next': { const { nextInFolder } = require('./movie'); const n = nextInFolder(m.state.file); if (n) await this.movieOpen(n, { autoplay: true, fresh: true }); break; }
      case 'stop': this._saveResume(); m.stop(); this._gameAudio(true); this._retier(); break;
    }
    if (by && (op === 'play' || op === 'pause' || op === 'toggle' || op === 'seek' || op === 'skip')) this.emit('movie-by', { by, op });
  }

  _saveResume(finished) {
    const st = this.movie.state;
    if (!st.file) return;
    this.store.d.resume = this.store.d.resume || {};
    if (finished || st.pos > st.dur - 90) delete this.store.d.resume[st.file];
    else if (st.pos > 60) this.store.d.resume[st.file] = { pos: st.pos, at: now() };
    this.store.save();
  }

  _movieView() {
    const v = this.movie.publicState();
    return { title: v.title, playing: v.playing, pos: v.pos, dur: v.dur, audio: v.audio, sub: v.sub ? (v.sub.file ? `f${v.sub.file}` : `i${v.sub.i}`) : null, night: v.night, subSize: v.subSize, subDelay: v.subDelay, tracks: v.tracks ? { audio: v.tracks.audio, subs: v.tracks.subs.map((x) => ({ ...x, key: x.key, title: x.title })) } : null, next: v.next, at: now() };
  }

  _movieState() {
    const v = this._movieView();
    for (const g of this.guests.values()) g.link.ctrl({ t: 'movie', ...v });
    this.emit('movie', v);
  }

  // padding packets (channel 0x0c, ignored by the guest) at `kbps`, to test the line's headroom
  _startProbe(g, kbps) {
    this._stopProbe(g);
    const pkt = Buffer.alloc(1100); pkt[0] = 0x0c;
    const perTick = Math.max(1, Math.round((kbps * 1000 / 8 / 1100) / 100)); // 10 ms ticks
    g.probe.start = now(); g.probe.until = now() + 2500;
    g.probe.saved = g.rc.target; g.probe.savedDrop = g.rc.lastDrop;
    g.probe.iv = setInterval(() => { for (let i = 0; i < perTick; i++) g.link.send(pkt); }, 10);
  }
  _stopProbe(g) { if (g.probe?.iv) clearInterval(g.probe.iv); if (g.probe) { g.probe.iv = null; g.probe.until = 0; } }

  _sendMovieConfig(g) {
    // over the internet, start on the light film and earn the full one (no rough start)
    if (!g.rendition) {
      g.rendition = g.link.pathInfo()?.lan ? 'high' : 'low';
      if (g.rendition === 'low' && g.rc) g.rc.target = Math.min(g.rc.target, 2500); // start low and let it climb: overshooting a weak line costs seconds
    }
    if (g.rendition === 'low' && !this.movie.lowWanted && this.movie.state.playing) this.movie.ensureLow(Math.min(this.movie.kbps * 0.4, 1200));
    const c = g.rendition === 'low' ? this.movie.lowConfig : this.movie.config;
    if (!c || g.configSent.movie === c.epoch) return;
    g.tier = 'movie';
    // the pace the tick would set, before the catch-up goes out: a new guest's sender still has
    // its default (20 Mbps), which blew seconds of catch-up into a 3 Mbps line's drop-tail
    if (g.rc) g.tx.rateKbps = Math.max(800, g.rc.target);
    g.tx.keyed = true;
    g.tx.skipToKey = false;
    g.tx.dueOf = (pts) => this.movie.dueOf(pts);
    g.tx.setClock?.(this.movie.clockMsg());
    // What's already been encoded ahead never comes round again: send it now, from the last
    // keyframe before the picture, so a newcomer (or a switch to the other rendition) starts
    // straight away instead of waiting for what's being encoded seconds from now.
    // (only when this guest is new to this rendition: a replaced light film carries on from
    // exactly where the old one stopped, so there's nothing to resend)
    const run = this.movie.clock.run;
    const old = g.feed?.rendition;
    const fresh = g.feed?.run !== run || old !== g.rendition;
    const switched = fresh && g.feed?.run === run;
    g.feed = { run, rendition: g.rendition };
    let catchUp = fresh ? this.movie.replay(g.rendition) : [];
    if (switched) {
      // Switching rendition: hand over at the first keyframe of the new one a second past the
      // picture (time to get there), and fill the old one up to it if it isn't all sent yet: the
      // guest plays the old one until then. Restarting from the keyframe before the picture sent
      // stale frames first, and the picture froze for 1-2 s.
      const s = g.tx.sentPts, h = this.movie.hist[g.rendition];
      const k = s == null ? -1 : h.findIndex((f) => f.key && f.pts > this.movie.curMs() + 1000);
      if (k >= 0) catchUp = [...this.movie.hist[old].filter((f) => f.pts > s && f.pts < h[k].pts), ...h.slice(k)];
      g.tx.flush();
    }
    if (process.env.MAJLIS_DEBUG && fresh) console.log('[film-tx]', JSON.stringify({ t: Date.now() % 1e6, rendition: g.rendition, switched, catchUp: catchUp.length, from: catchUp[0]?.pts - this.movie.curMs(), lan: !!g.link.pathInfo()?.lan, target: Math.round(g.rc?.target || 0) }));
    const epochs = new Set([...catchUp.map((f) => f.epoch), c.epoch]);
    for (const e of epochs) { const cc = this.movie.configs.get(e); if (cc) g.link.ctrl(movieConfigMsg(cc)); }
    g.configSent = { movie: c.epoch };
    g.link.ctrl({ t: 'fclock', ...this.movie.clockMsg() });
    // The film's audio for what's buffered ahead (the same whichever rendition) goes in step with
    // the picture: sent after all of it, it landed seconds late on a slow line. A switch flushed
    // the queued audio too; the guest drops repeats by pts.
    const audio = switched || g.audioRun !== run ? this.movie.replayAudio().map((a) => ({ a, pts: a.pts })) : [];
    g.audioRun = run;
    for (const x of [...catchUp, ...audio].sort((p, q) => p.pts - q.pts)) x.a ? g.tx.sendRaw(audioPacket(x.a.data, 1, x.a.epoch, x.a.pts)) : g.tx.send(x);
  }

  // Start (or after a seek, restart) the film once every viewer has ~1.5 s of it delivered, so
  // nobody begins on an empty buffer; never wait more than a few seconds for a slow line.
  _waitBuffers() {
    clearInterval(this.bufTimer);
    this.bufTimer = setInterval(() => {
      const m = this.movie;
      if (!m.clock.playing || m.clock.at || m.firstPts == null) { clearInterval(this.bufTimer); return; }
      const film = [...this.guests.values()].filter((g) => g.tier === 'movie');
      const ready = film.every((g) => g.tx.sentPts != null && g.tx.sentPts - m.firstPts >= 1500);
      if (ready || Date.now() - m.firstAt > 6000) { clearInterval(this.bufTimer); m.startClock(); }
    }, 50);
  }

  // The host's own view of the film opened mid-way: same catch-up as a guest gets.
  localSync() {
    const m = this.movie;
    if (!m.info) return;
    const catchUp = m.replay('high');
    for (const e of new Set([...catchUp.map((f) => f.epoch), m.config?.epoch])) { const cc = m.configs.get(e); if (cc) this.emit('local', movieConfigMsg(cc)); }
    this.emit('local', { t: 'clock', ...m.clockMsg() });
    for (const f of catchUp) this.emit('local', { t: 'v', epoch: f.epoch, id: f.id, key: f.key, data: f.data, enc: f.encMs, net: 0, pts: f.pts });
    for (const a of m.replayAudio()) this.emit('local', { t: 'a', data: a.data, timed: true, epoch: a.epoch, pts: a.pts, age: 0 });
  }

  _onRaw(g, b) {
    const ch = b[0];
    if (ch === 0x06) { // feedback
      let fb; try { fb = JSON.parse(b.subarray(1)); } catch { return; }
      g.fb = fb; g.lastFb = now();
      if (!g.rc) return;
      // ping rising above its quiet level = queues filling somewhere (bufferbloat)
      const rtt = g.link.rtt || 0;
      (g.rtts ||= []).push({ v: rtt, t: now() });
      while (g.rtts.length && now() - g.rtts[0].t > 30000) g.rtts.shift();
      if (rtt > 0) { let mn = Infinity; for (const x of g.rtts) if (x.v > 0 && x.v < mn) mn = x.v; fb.rttInc = rtt - mn; }
      if (g.probe?.until && (fb.qd > 30 || ((fb.rttInc || 0) > 40 && fb.qd > 10) || fb.loss > 0.02)) {
        this._stopProbe(g);
        g.rc.target = g.probe.saved; g.rc.lastDrop = g.probe.savedDrop; g.rc.bad = 0;
        g.probe.next = now() + g.probe.backoff; g.probe.backoff = Math.min(g.probe.backoff * 2, 300000);
        g.probe.cool = now() + 1500; // let the queue the probe built drain before judging again
        return;
      }
      if (g.probe?.cool > now()) return;
      g.rc.feedback(fb);
      // frames this viewer never got: the engine stops referencing them (no keyframe needed)
      if (fb.lostIds?.length) g.tierEnc?.()?.invalidate?.(fb.lostIds);
      if (g.tier === 'play' || g.tier === 'watch') this._applyRate(g.tier);
      g.tx.fecRatio = g.rc.fecRatio;
      return;
    }
    if (ch === 0x03) return this._input(g, b);
    if (ch === 0x09) { // voice from a guest: play here and pass to everyone else
      if (g.muted) return;
      const idx = this._speakerIdx(g);
      const out = Buffer.concat([Buffer.from([0x09, idx]), b.subarray(1)]);
      this.emit('voice', { idx, data: b.subarray(1) });
      for (const o of this.guests.values()) if (o !== g) o.link.send(out);
      g.speakingAt = now();
    }
  }

  _speakerIdx(g) { return 1 + [...this.guests.keys()].indexOf(g.sid); }

  hostVoice(buf) {
    const out = Buffer.concat([Buffer.from([0x09, 0]), buf]);
    for (const g of this.guests.values()) g.link.send(out);
  }

  // ------------------------------------------------------------------ input
  _input(g, b) {
    if (b.length < 6) return;
    const seq = b.readUInt32BE(1);
    // each input packet arrives up to 3 times; apply it once
    if (((seq - g.inSeq) | 0) <= 0 && g.inSeq !== -1) return;
    g.inSeq = seq;
    const kbm = CAN.kbm(g.role);
    let padOk = CAN.pad(g.role) && g.slot;
    let slot = g.slot;
    if (this.hotseat.on) { padOk = CAN.pad(g.role) && this.hotseat.holder === g.sid; slot = 1; }
    const ev = [];
    let o = 6;
    const n = b[5];
    for (let i = 0; i < n && o < b.length; i++) {
      const t = b[o];
      if (t === 1) { if (kbm) ev.push([1, b[o + 1], b.readUInt16BE(o + 2), b[o + 4]]); o += 5; }
      else if (t === 2) { if (kbm) ev.push([2, b.readInt16BE(o + 1), b.readInt16BE(o + 3)]); o += 5; }
      else if (t === 3) { if (kbm) ev.push([3, b.readUInt16BE(o + 1), b.readUInt16BE(o + 3)]); o += 5; }
      else if (t === 4) { if (kbm) ev.push([4, b[o + 1], b[o + 2]]); o += 3; }
      else if (t === 5) { if (kbm) ev.push([5, b.readInt16BE(o + 1), b.readInt16BE(o + 3)]); o += 5; }
      else if (t === 6) {
        if (padOk) this.helper.cmd({ cmd: 'pad', slot, b: b.readUInt32BE(o + 2), lx: b.readInt16BE(o + 6), ly: b.readInt16BE(o + 8), rx: b.readInt16BE(o + 10), ry: b.readInt16BE(o + 12), lt: b[o + 14], rt: b[o + 15] });
        o += 16;
      } else if (t === 7) {
        if (padOk) {
          const r = (k) => b.readInt16BE(o + 2 + k * 2);
          const t1 = [b[o + 14], b.readUInt16BE(o + 15), b.readUInt16BE(o + 17)], t2 = [b[o + 19], b.readUInt16BE(o + 20), b.readUInt16BE(o + 22)];
          this.helper.cmd({ cmd: 'pad_motion', slot, g: [r(0), r(1), r(2)], a: [r(3), r(4), r(5)], t: [t1, t2] });
        }
        o += 24;
      } else break;
    }
    if (ev.length) this.helper.cmd({ cmd: 'in', e: ev });
    g.lastInput = now();
  }

  _padSlotOf(g) { return this.hotseat.on ? (this.hotseat.holder === g.sid ? 1 : null) : g.slot; }

  _attachPad(g) {
    if (!this.helper.ready || !g.slot) return;
    this.helper.cmd({ cmd: 'pad_add', slot: this.hotseat.on ? 1 : g.slot, type: g.padType });
  }

  // ------------------------------------------------------------------ host controls
  setRole(sid, role) {
    const g = this.guests.get(sid); if (!g || !ROLES.includes(role)) return;
    g.role = role;
    if (CAN.pad(role) && !g.slot) { g.slot = this._freeSlot(); this._attachPad(g); }
    if (!CAN.pad(role) && g.slot) { this.helper.cmd({ cmd: 'pad_del', slot: g.slot }); g.slot = null; }
    if (!CAN.kbm(role)) this.helper.cmd({ cmd: 'release_all' });
    g.link.ctrl({ t: 'role', role, slot: g.slot });
    this._retier(); this._roster(); this.emit('update');
  }

  setSlot(sid, slot) {
    const g = this.guests.get(sid); if (!g) return;
    slot = slot ? Math.max(1, Math.min(4, slot | 0)) : null;
    const other = [...this.guests.values()].find((x) => x.slot === slot && x !== g);
    if (other) { other.slot = g.slot; other.link.ctrl({ t: 'role', role: other.role, slot: other.slot }); }
    if (g.slot) this.helper.cmd({ cmd: 'pad_del', slot: g.slot });
    g.slot = slot;
    if (slot && !CAN.pad(g.role)) g.role = 'pad';
    if (!slot && CAN.pad(g.role) && g.role === 'pad') g.role = 'watch';
    if (other?.slot) this._attachPad(other);
    if (g.slot) this._attachPad(g);
    g.link.ctrl({ t: 'role', role: g.role, slot: g.slot });
    this._retier(); this._roster(); this.emit('update');
  }

  setExpiry(sid, duration) {
    const g = this.guests.get(sid); if (!g) return;
    g.expiresAt = duration === 'session' ? null : now() + ({ '10m': 600e3, '1h': 3600e3 }[duration] || 0);
    this.emit('update');
  }

  mute(sid, on) { const g = this.guests.get(sid); if (g) { g.muted = !!on; this.emit('update'); } }

  kick(sid, block = false) {
    const g = this.guests.get(sid); if (!g) return;
    g.link.ctrl({ t: 'kick' });
    if (block) this.store.upsertFriend({ id: g.id, trust: 'block' });
    setTimeout(() => g.link.close('kicked'), 150);
  }

  setHotseat(on) {
    this.hotseat.on = !!on;
    this.helper.cmd({ cmd: 'pads_clear' });
    if (on) {
      const first = [...this.guests.values()].find((g) => CAN.pad(g.role));
      this.hotseat.holder = first?.sid || null;
      this.helper.cmd({ cmd: 'pad_add', slot: 1, type: first?.padType || 'x360' });
    } else {
      this.hotseat.holder = null;
      for (const g of this.guests.values()) this._attachPad(g);
    }
    this._roster(); this.emit('update');
  }

  passBaton(toSid) {
    if (!this.hotseat.on) return;
    const players = [...this.guests.values()].filter((g) => CAN.pad(g.role));
    if (!players.length) return;
    let next = toSid && this.guests.get(toSid);
    if (!next) {
      const i = players.findIndex((g) => g.sid === this.hotseat.holder);
      next = players[(i + 1) % players.length];
    }
    this.hotseat.holder = next.sid;
    next.hand = false;
    this.helper.cmd({ cmd: 'pad', slot: 1, b: 0, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
    this._roster(); this.emit('update');
    this.emit('baton', { name: next.nick });
  }

  // Panic: everyone out, every key released, nothing left running.
  panic() {
    for (const g of [...this.guests.values()]) { g.link.ctrl({ t: 'kick', panic: true }); setTimeout(() => g.link.close('panic'), 100); }
    for (const k of this.knocks.values()) k.decide(false);
    this.knocks.clear();
    this.helper.cmd({ cmd: 'release_all' });
    this.helper.cmd({ cmd: 'pads_clear' });
    this.setEnabled(false);
    this._stopEncoders();
    this.helper.cmd({ cmd: 'mode_restore' });
    this.emit('panic');
  }

  // ------------------------------------------------------------------ capture source
  setSource(src) {
    // src: { kind: 'display', index } | { kind: 'window', hwnd, title }
    if (src.kind === 'window') this.store.set('captureWindow', { hwnd: src.hwnd, title: src.title });
    else { this.store.set('captureWindow', null); this.store.set('display', src.index | 0); }
    this._restartAll();
  }

  async _ensureHelper() {
    if (!this.helper.p) this.helper.start();
    if (!this.helper.ready) await new Promise((r) => { const t = setTimeout(r, 3000); this.helper.once('hello', () => { clearTimeout(t); r(); }); });
    if (!this.helper.ready) return;
    this.displays = this.helper.info.displays || [];
    if (!this._helperOn) {
      this._helperOn = true;
      this._gameAudio(true);
      this.helper.cmd({ cmd: 'cursor', on: true });
    }
    for (const g of this.guests.values()) if (g.slot) this._attachPad(g);
  }

  // ------------------------------------------------------------------ encoders / tiers
  _pickCodec(guests) {
    const have = new Set(this.encoders.map((e) => e.codec));
    const pref = this.store.get('codec');
    const ok = (c) => have.has(c) && guests.every((g) => !g.caps.codecs || g.caps.codecs.includes(c));
    if (pref !== 'auto' && ok(pref)) return pref;
    for (const c of ['av1', 'hevc', 'h264']) if (ok(c)) return c;
    return 'h264';
  }

  _encFor(codec) {
    return this.encoders.find((e) => e.codec === codec && e.fam !== 'sw') || this.encoders.find((e) => e.codec === codec) || this.encoders[this.encoders.length - 1];
  }

  _sourceOpts(tier, guests) {
    const win = this.store.get('captureWindow');
    const fpsCap = this.store.get('fps') || 60;
    const d = this.displays.find((x) => x.index === (this.store.get('display') | 0)) || this.displays[0] || { w: 1920, h: 1080, x: 0, y: 0, hz: 60 };
    let fps = Math.min(fpsCap, ...guests.map((g) => g.screen?.hz || 60), d.hz || 60);
    const light = tier === 'watch' && this.store.get('lightSpectators');
    if (light) fps = Math.min(fps, 30);
    const o = { display: d.index | 0, fps, tenBit: this.store.get('tenBit'), hdr: this.store.get('hdr') && d.hdr };
    let srcW = d.w, srcH = d.h;
    if (win && this.wincap) { o.window = this.wincap; srcW = this.wincap.w; srcH = this.wincap.h; }
    // scale down to what the viewer can show (spectators get at most 720p)
    // resolution: the viewers' screens, capped by the host's choice (720p / 1080p / 1440p / source)
    const capH = light ? 720 : { 720: 720, 1080: 1080, 1440: 1440 }[this.store.get('maxRes')] || Infinity;
    const maxH = Math.min(capH, Math.max(...guests.map((g) => g.screen?.h || 1080)));
    const maxW = Math.min(capH === Infinity ? Infinity : Math.round(capH * 16 / 9), Math.max(...guests.map((g) => g.screen?.w || 1920)));
    const s = Math.min(1, maxW / srcW, maxH / srcH);
    if (s < 0.999) o.scale = { w: Math.round(srcW * s / 2) * 2, h: Math.round(srcH * s / 2) * 2 };
    o.size = { w: srcW & ~1, h: srcH & ~1 };
    this.captureRect = win && this.wincap ? this.wincap.rect : { x: d.x, y: d.y, w: d.w, h: d.h };
    return o;
  }

  // serialized: knocks, hellos and role changes can all ask for this at once
  _retier(forceKey) {
    this._rq = (this._rq || Promise.resolve()).then(() => this._retierNow(forceKey)).catch((e) => this.emit('notice', { key: 'encoder_error', detail: e.message }));
    return this._rq;
  }

  async _retierNow(forceKey) {
    if (this.mode === 'watch' && this.movie.info) {
      this._stopEncoders();
      for (const g of this.guests.values()) {
        g.tier = 'movie'; g.tierEnc = () => null;
        if (!g.rc) g.rc = makeRc(g.link, { maxKbps: (this.store.get('watchMbps') || 15) * 1000, startKbps: (this.store.get('watchMbps') || 15) * 1000, relaxed: true });
        g.rc.relaxed = true;
        this._sendMovieConfig(g);
      }
      this.emit('update');
      return;
    }
    const play = [...this.guests.values()].filter((g) => g.role !== 'watch');
    const watch = [...this.guests.values()].filter((g) => g.role === 'watch');
    await this._ensureHelper();
    await this._ensureWindowCapture();
    // Match the host screen to the first player's screen if that's allowed and possible.
    if (this.store.get('matchResolution') && play[0]?.screen && !this.store.get('captureWindow') && !this._modeSet) {
      const s = play[0].screen;
      const d = this.displays.find((x) => x.index === (this.store.get('display') | 0));
      if (d && (d.w !== s.w || d.h !== s.h)) {
        const r = await this.helper.request({ cmd: 'mode', display: d.index, w: s.w, h: s.h, hz: s.hz }, 'mode');
        if (r?.ok) {
          this._modeSet = true;
          await new Promise((z) => setTimeout(z, 1500)); // let the display settle before capturing
          const fresh = await this.helper.request({ cmd: 'displays' }, 'displays');
          if (fresh) this.displays = fresh.list;
        }
      }
    }
    for (const [tier, list] of [['play', play], ['watch', watch]]) {
      for (const g of list) { g.tier = tier; g.tierEnc = () => this.tiers[tier]?.enc; }
      if (!list.length) { this._stopTier(tier); continue; }
      const codec = this._pickCodec(list);
      const lan = list.every((g) => g.path?.lan);
      const src = this._sourceOpts(tier, list);
      const cap = (lan ? 150000 : (this.store.get('maxMbps') || 40) * 1000) * (tier === 'watch' && this.store.get('lightSpectators') ? 0.35 : 1);
      for (const g of list) {
        if (!g.rc) {
          const hint = this.store.get('peakLearning') ? this.store.peakHint() : null;
          const start = lan ? cap * 0.6 : Math.min(cap * 0.5, hint ? hint.mbps * 900 : 12000);
          g.rc = makeRc(g.link, { maxKbps: cap, startKbps: start, stability: this._stability(g), burstMs: this.engine?.ok ? 150 : 400 });
        } else { g.rc.setMax(cap); g.rc.setStability(this._stability(g)); }
        if (g.maxKbps) g.rc.setMax(Math.min(cap, g.maxKbps)); // data saver on that guest's side
      }
      const kbps = Math.min(...list.map((g) => g.rc.target));
      const t = this.tiers[tier];
      const want = { enc: this._encFor(codec), kbps, ...src, lan, quality: this.store.get('qualityPreset') || 'balanced' };
      if (!t) {
        // NVIDIA: the Rust engine (capture straight into NVENC, live bitrate changes, recovery
        // without keyframes). Anything else: ffmpeg as before.
        const enc = this.engine?.ok && !this.engineFailed && want.enc.fam === 'nvenc' && !want.hdr ? new EngineEncoder(this.engine) : new Encoder(this.ffmpeg);
        const nt = { enc, codec, kbps, opts: want, config: null, sig: this._sig(want) };
        enc.on('config', (c) => { nt.config = c; this._sendConfig(tier); });
        enc.on('frame', (f) => { for (const g of this.guests.values()) if (g.tier === tier && g.configSent[tier] === nt.config?.epoch) g.tx.send(f); });
        nt.retries = 0;
        enc.on('error', (e) => {
          // the engine can't do this source (a screen on another GPU, an old driver): ffmpeg takes over
          if (enc instanceof EngineEncoder && /capture|start|NVIDIA|nvEnc/i.test(String(e.err)) && nt.retries >= 1) {
            this.engineFailed = true; this.emit('notice', { key: 'engine_fallback', detail: String(e.err).slice(0, 200) });
            if (this.tiers[tier] === nt) { this._stopTier(tier); for (const g of this.guests.values()) g.configSent = {}; this._retier(true); }
            return;
          }
          // desktop duplication drops out on mode switches, UAC prompts and fullscreen flips; retry
          if (this.tiers[tier] === nt && nt.retries++ < 6) return setTimeout(() => { if (this.tiers[tier] === nt) enc.start(nt.opts); }, 800);
          this.emit('encoder-error', { tier, err: e.err });
        });
        enc.on('config', () => { nt.retries = 0; });
        enc.on('spawn', (pid) => this._gpuPriority(pid));
        enc.start(want);
        this.tiers[tier] = nt;
      } else if (t.sig !== this._sig(want)) {
        t.codec = codec; t.kbps = kbps; t.opts = want; t.sig = this._sig(want);
        t.enc.swap(want);
      } else if (forceKey) t.enc.requestKeyframe();
      if (this.tiers[tier]?.config) this._sendConfig(tier);
    }
    this.helper.cmd({ cmd: 'capture_rect', ...this.captureRect });
    this.emit('update');
  }

  _sig(o) { return JSON.stringify([o.enc.name, o.display, o.fps, o.scale, o.window?.pipe || o.window?.hwnd, o.tenBit, o.hdr, o.quality]); }

  _stability(g) {
    const s = this.store.get('stability');
    if (s === 'on') return true;
    if (s === 'off') return false;
    const ct = this.store.get('connType');
    return ct === '5g' || ct === '4g' || g.connType === '5g' || g.connType === '4g' || (g.rc && g.rc.jitEw > 6);
  }

  _sendConfig(tier) {
    const t = this.tiers[tier]; if (!t?.config) return;
    const c = t.config;
    for (const g of this.guests.values()) {
      if (g.tier !== tier || g.configSent[tier] === c.epoch) continue;
      g.link.ctrl({ t: 'config', codec: c.codec, family: c.family, description: c.description.toString('base64'), epoch: c.epoch, fps: c.fps, encoder: c.encoder, tier, hdr: !!t.opts.hdr });
      g.configSent = { [tier]: c.epoch };
    }
  }

  async _ensureWindowCapture() {
    const win = this.store.get('captureWindow');
    if (!win) { if (this.wincap) { this.wincap = null; if (this._helperOn && !this.movie.info) this._gameAudio(true); } return; }
    const gfx = !!this.gfx && this.encoders.some((e) => e.fam === 'nvenc') && !this.store.get('hdr');
    if (this.wincap && this.wincap.hwnd === win.hwnd && !!this.wincap.gfx === gfx) return;
    if (gfx) {
      // ffmpeg captures the window on the GPU itself; the helper only checks it and brings a
      // minimised one back (a minimised window has no picture to capture)
      if (this.wincap && !this.wincap.gfx) this.helper.cmd({ cmd: 'wincap_stop' });
      const r = await this.helper.request({ cmd: 'winprep', hwnd: win.hwnd }, 'winprep', 3000);
      if (!r?.ok) {
        this.emit('notice', { key: 'wincap_failed', detail: r?.msg || this.helper.lastError });
        this.store.set('captureWindow', null);
        this.wincap = null;
        this.emit('update');
        return;
      }
      const wl = await this.helper.request({ cmd: 'windows' }, 'windows');
      this.wincap = { hwnd: win.hwnd, gfx: true, pid: wl?.list.find((x) => x.hwnd === win.hwnd)?.pid || null, w: r.w & ~1, h: r.h & ~1, rect: { x: r.x, y: r.y, w: r.w, h: r.h } };
      if (this._helperOn && !this.movie.info) this._gameAudio(true);
      return;
    }
    if (this.wincap?.gfx) this.wincap = null;
    const pipe = `majlis-win-${process.pid}-${Date.now() % 100000}`;
    const r = await this.helper.request({ cmd: 'wincap', hwnd: win.hwnd, fps: this.store.get('fps') || 60, pipe }, 'wincap', 5000);
    if (!r?.ok) {
      // that window can't be captured (closed, hidden, protected): fall back to the whole screen once
      this.emit('notice', { key: 'wincap_failed', detail: this.helper.lastError });
      this.store.set('captureWindow', null);
      this.emit('update');
      return;
    }
    const list = await this.helper.request({ cmd: 'windows' }, 'windows');
    const w = list?.list.find((x) => x.hwnd === win.hwnd);
    this.wincap = { hwnd: win.hwnd, w: r.w, h: r.h, pipe: r.pipe, rect: w ? { x: w.x, y: w.y, w: r.w, h: r.h } : { x: 0, y: 0, w: r.w, h: r.h } };
  }

  _restartAll() {
    this._stopEncoders();
    for (const g of this.guests.values()) g.configSent = {};
    if (this.wincap) { this.helper.cmd({ cmd: 'wincap_stop' }); this.wincap = null; }
    if (this.guests.size) this._retier();
  }

  _stopTier(tier) { const t = this.tiers[tier]; if (t) { t.enc.stop(); this.tiers[tier] = null; } }
  _stopEncoders() { this._stopTier('play'); this._stopTier('watch'); }

  // ------------------------------------------------------------------ housekeeping
  _broadcastRaw(b) { for (const g of this.guests.values()) g.link.send(b); }

  // Audio goes out twice: each packet again together with the next one (10 ms later), so a
  // single lost packet never becomes a click. The guest drops the duplicate by sequence number.
  _sendAudio(b) {
    const prev = this.prevAudio;
    this.prevAudio = b;
    // the previous packet again only where packets get lost (as the film's audio does): on a
    // clean line it just doubled the sound's share of the upload
    for (const g of this.guests.values()) { g.link.send(b); if (prev && (g.rc?.lossEw || 0) > 0.003) g.link.send(prev); }
  }

  _roster() {
    const list = [...this.guests.values()].map((g) => ({ name: g.nick, role: g.role, slot: g.slot, hand: g.hand, idx: this._speakerIdx(g), baton: this.hotseat.holder === g.sid }));
    for (const g of this.guests.values()) g.link.ctrl({ t: 'roster', you: this._speakerIdx(g), list, hotseat: this.hotseat.on, host: this.store.get('nick') || '' });
  }

  _drop(sid, reason) {
    const g = this.guests.get(sid); if (!g) return;
    this._stopProbe(g);
    // keep their seat for a few minutes in case the line just dropped
    if (reason === 'timeout') (this.recentDrops ||= new Map()).set(g.id, { role: g.role, slot: g.slot, pk: g.link.peer.pk, at: now() });
    this.guests.delete(sid);
    this.sync.leave(sid);
    if (g.slot) this.helper.cmd({ cmd: 'pad_del', slot: g.slot });
    if (CAN.kbm(g.role)) this.helper.cmd({ cmd: 'release_all' });
    if (this.hotseat.holder === sid) this.passBaton();
    this.store.upsertFriend({ id: g.id, lastSeen: now() });
    this.emit('left', { sid, name: g.nick, reason, summary: { name: g.nick, ms: now() - g.joined, mb: Math.round(g.link.stats.tx / 1e5) / 10, rtt: Math.round(g.link.rtt) } });
    if (!this.guests.size) {
      this._stopEncoders();
      this.net.setPresence({ busy: false });
      if (this._modeSet) { this.helper.cmd({ cmd: 'mode_restore' }); this._modeSet = false; }
    } else this._retier();
    this._roster();
    this.emit('update');
  }

  _tick() {
    const t = now();
    if (this.movie.state.playing && (this.movieTick = (this.movieTick || 0) + 1) % 2 === 0) this._movieState();
    if (this.movie.state.playing && this.movieTick % 20 === 0) this._saveResume();
    for (const g of this.guests.values()) {
      if (g.expiresAt && t > g.expiresAt && g.role !== 'watch') { g.expiresAt = null; this.setRole(g.sid, 'watch'); g.link.ctrl({ t: 'notice', key: 'access_expired' }); }
      g.link.ping();
    }
    // bitrate: follow the slowest guest in each tier, swap encoders only on real changes
    if (this.movie.info && this.movie.state.playing) {
      const hi = this.movie.kbps, lowCap = Math.min(hi * 0.4, 5000);
      const movieGuests = [...this.guests.values()].filter((g) => g.tier === 'movie' && g.rc);
      // Anyone watching over the internet: keep the light film running so a switch is instant.
      // It starts modest and follows the line both ways (a retune is seamless).
      const remote = movieGuests.some((g) => !g.link.pathInfo()?.lan || g.rc.target < hi * 0.85);
      // (and before anyone's here: whoever joins late then starts from frames already encoded
      // ahead, instead of waiting seconds for a light film to start up)
      if (!movieGuests.length || remote || movieGuests.some((g) => g.rendition === 'low')) this.movie.ensureLow(Math.min(lowCap, 1200));
      else if (this.movie.lowWanted) this.movie.dropLow();
      let lowMin = Infinity, lowBuf = Infinity, lowSlope = Infinity, lowSent = Infinity;
      const clockOn = !!this.movie.clock.at;
      if (!this.movie.low) this.lowTuned = t; // a fresh light film gets time to settle
      for (const g of movieGuests) {
        const r = g.rendition || 'high';
        // the light film was a guess made before the path was known; on the local network, go full
        // (only while the line really carries the full film, or the two rules would ping-pong)
        if (r === 'low' && g.link.pathInfo()?.lan && g.rc.target >= hi * 0.9 && t - g.rc.lastDrop > 5000) { g.rendition = 'high'; g.configSent = {}; this._sendMovieConfig(g); continue; }
        if (r === 'high') {
          g.lowSince = g.rc.target < hi * 0.75 ? g.lowSince || t : 0;
          if (g.lowSince && t - g.lowSince > 1500 && this.movie.lowConfig) { g.rendition = 'low'; g.configSent = {}; this._sendMovieConfig(g); }
        } else {
          // ~10 s average, quicker on the way down
          g.tEw = g.tEw ? g.tEw * (g.rc.target < g.tEw ? 0.8 : 0.95) + g.rc.target * (g.rc.target < g.tEw ? 0.2 : 0.05) : g.rc.target;
          lowMin = Math.min(lowMin, g.tEw);
          // how much film this viewer has beyond the picture (what's been sent; a bit of it is
          // still on the way)
          g.buffered = clockOn && g.tx.sentPts != null ? g.tx.sentPts - this.movie.curMs() : null;
          if (g.buffered != null) {
            lowBuf = Math.min(lowBuf, g.buffered);
            lowSent = Math.min(lowSent, g.tx.sentPts);
            // which way it's going over the last few seconds (ms of film per second)
            (g.bufHist ||= []).push({ t, b: g.buffered });
            while (g.bufHist.length > 1 && t - g.bufHist[0].t > 4000) g.bufHist.shift();
            const h0 = g.bufHist[0];
            if (t - h0.t >= 2500) lowSlope = Math.min(lowSlope, (g.buffered - h0.b) / ((t - h0.t) / 1000));
          }
          // Climb in steps: pad the line to 1.5x what it carries for 2.5 s, only while the viewer
          // is well buffered. No congestion -> rate control may count on that much, and the full
          // film once it covers it. Congestion -> stay, and wait longer before trying again.
          // (Padding a weak line with the full film's rate in one go drowned 3 Mbps lines.)
          const p = (g.probe ||= { next: t + 10000, backoff: 30000 });
          if (p.until) {
            if (g.rc.lastDrop > p.start) { this._stopProbe(g); p.next = t + p.backoff; p.backoff = Math.min(p.backoff * 2, 300000); }
            else if (t >= p.until) {
              this._stopProbe(g); p.backoff = 30000; p.next = t + 12000;
              g.rc.target = Math.min(g.rc.max, Math.max(g.rc.target, p.goal * 0.9));
              if (g.rc.target >= hi * 0.9) { p.next = t + 60000; g.rendition = 'high'; g.configSent = {}; this._sendMovieConfig(g); }
            }
          } else if (t >= p.next && t - g.rc.lastDrop > 8000 && (g.buffered ?? 0) > 5000) {
            p.goal = Math.min(hi * 1.15, Math.max(g.rc.target, g.fb?.kbps || 0) * 1.5);
            this._startProbe(g, Math.max(300, p.goal - (g.fb?.kbps || 0)));
          }
        }
      }
      // The light film follows the weakest viewer on it, with real room to spare: FEC, the
      // audio, packet headers and the film's own peaks all ride on top of its bitrate. A viewer
      // whose buffer is draining gets a step down right away, whatever the estimate says.
      if (lowMin < Infinity && this.movie.lowKbps) {
        // (audio ~0.3 Mbps sent twice, FEC + headers ~15%, peaks ~15%)
        let want = Math.max(700, Math.min(lowCap, (lowMin - 350) / 1.35));
        const since = t - (this.lowTuned || 0);
        // The surest sign: a viewer's buffer running low and still shrinking means the line
        // isn't keeping up with this bitrate, whatever the estimate says. Step down now.
        // The light film is encoded ~10 s ahead, so a step down reaches viewers that much later:
        // judge the buffer again only once they're on it, or every 3 s adds another step (1200k -> 90k).
        const ra = this.movie.low?.readyAt;
        const settled = clockOn && t - (this.movie.clock.at || t) > 3000 && (ra == null || lowSent >= ra);
        // (low AND shrinking: a viewer who just joined has a thin buffer that's filling up)
        if (settled && since > 3000 && lowBuf < 1500 && lowSlope < 0) want = Math.min(want, this.movie.lowKbps * 0.65);
        else if (settled && since > 3000 && lowBuf < 4000 && lowSlope < -150) want = Math.min(want, this.movie.lowKbps * 0.75);
        if ((want < this.movie.lowKbps * 0.85 && since > 3000) || (want > this.movie.lowKbps * 1.3 && since > 20000 && lowBuf > 6000 && lowSlope > -50)) {
          if (this.movie.retuneLow(want, lowSent < Infinity ? lowSent : null)) this.lowTuned = t;
        }
      }
    }
    // Pace at what the line takes (rate control's estimate). Live video never needs more than a
    // bit over the encoder's rate; a film may go well over it while the line allows, which is
    // how the viewer's buffer fills up ahead of the picture.
    for (const g of this.guests.values()) {
      const film = g.tier === 'movie';
      const k = film ? this.movie.kbpsFor?.(g.rendition) || this.movie.kbps : this.tiers[g.tier]?.kbps;
      if (!k) continue;
      g.tx.rateKbps = !g.rc ? k * 1.35 : film ? Math.max(800, g.rc.target) : Math.max(800, Math.min(k * 1.35, g.rc.target * 1.15));
      g.tx.keyed = film;
    }
    for (const tier of ['play', 'watch']) {
      const tt = this.tiers[tier]; if (!tt) continue;
      const list = [...this.guests.values()].filter((g) => g.tier === tier && g.rc);
      if (!list.length) continue;
      if (tt.enc instanceof EngineEncoder) { this._applyRate(tier); continue; }
      const want = Math.round(Math.min(...list.map((g) => g.rc.target)));
      const ch = (want - tt.kbps) / tt.kbps;
      const since = t - tt.enc.lastSwap;
      if ((ch < -0.2 && since > 1500) || (ch > 0.3 && since > 8000)) {
        tt.kbps = want; tt.opts = { ...tt.opts, kbps: want };
        tt.enc.swap({ kbps: want });
      }
    }
    this.emit('stats', this.stats());
  }

  // Engine streams take a new bitrate on the very next frame, so follow the rate control
  // closely (at most every 200 ms). On a line too thin for the resolution, halve the frame
  // rate before the picture breaks up; bring it back when there's room again.
  _applyRate(tier) {
    const tt = this.tiers[tier];
    if (!tt || !(tt.enc instanceof EngineEncoder)) return;
    const list = [...this.guests.values()].filter((g) => g.tier === tier && g.rc);
    if (!list.length) return;
    const t = now(), want = Math.round(Math.min(...list.map((g) => g.rc.target)));
    if (t - tt.enc.lastSwap < 200) return;
    const full = tt.opts.fps, sz = tt.opts.scale || tt.opts.size || { w: 1920, h: 1080 };
    const bpp = (fps) => (want * 1000) / (sz.w * sz.h * fps);
    let fps = tt.fpsNow || full;
    // (only once the line has actually pushed back: at the start the estimate is still climbing)
    if (fps > 30 && bpp(fps) < 0.025 && list.some((g) => g.rc.congestions > 0)) fps = Math.max(30, Math.round(full / 2));
    else if (fps < full && bpp(full) > 0.045) fps = full;
    if (Math.abs(want - tt.kbps) / tt.kbps < 0.05 && fps === (tt.fpsNow || full)) return;
    tt.kbps = want; tt.fpsNow = fps;
    tt.enc.reconfigure({ kbps: want, fps }); // the tier keeps asking for `full`; this is just the current rate
  }

  _recordPeak() {
    const t = this.tiers.play;
    if (!t || !this.store.get('peakLearning')) return;
    const congested = [...this.guests.values()].some((g) => g.rc && now() - g.rc.lastDrop < 60000);
    this.store.recordPeak(t.kbps / 1000, congested);
  }

  stats() {
    return {
      enabled: this.enabled, code: this.code, hotseat: this.hotseat, mode: this.mode, movie: this.movie.info ? this._movieView() : null,
      tiers: Object.fromEntries(Object.entries(this.tiers).map(([k, t]) => [k, t && { codec: t.codec, kbps: t.kbps, encoder: t.enc.config?.encoder || t.opts.enc.name, fpsNow: t.fpsNow || t.opts.fps, fps: t.opts.fps, scale: t.opts.scale || null, lan: t.opts.lan }])),
      upKbps: [...this.guests.values()].reduce((a, g) => a + (g.fb?.kbps || 0), 0),
      guests: [...this.guests.values()].map((g) => ({
        sid: g.sid, id: g.id, name: g.nick, role: g.role, slot: g.slot, tier: g.tier, hand: g.hand, muted: g.muted, safety: g.link.safety,
        expiresAt: g.expiresAt, path: g.link.pathInfo(), rtt: Math.round(g.link.rtt), kbps: g.fb?.kbps || 0, loss: g.fb?.loss || 0, fps: g.fb?.fps || 0,
        qd: g.fb?.qd || 0, target: g.rc ? Math.round(g.rc.target) : 0, fec: g.rc ? Math.round(g.rc.fecRatio * 100) : 0, stability: g.rc?.stability || false,
        speaking: g.speakingAt && now() - g.speakingAt < 400, chatMuted: !!g.chatMuted, rendition: g.tier === 'movie' ? g.rendition || 'high' : null, jitter: g.fb?.jitter || 0, baton: this.hotseat.holder === g.sid, connType: g.connType || null, ready: !!g.ready, joined: g.joined,
      })),
      knocks: [...this.knocks.values()].map((k) => this._knockView(k)),
    };
  }

  dispose() {
    clearInterval(this.tick); clearInterval(this.peakTimer);
    this._saveResume(); this.movie.dispose();
    this._stopEncoders();
  }
}

module.exports = { Host, ROLES, CAN };
