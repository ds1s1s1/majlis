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
const { VideoTx, RateControl } = require('./media');
const { Movie } = require('./movie');

const ROLES = ['watch', 'pad', 'kbm', 'full'];

function audioPacket(opus, timed, epoch, pts) {
  const b = Buffer.allocUnsafe(11 + opus.length);
  b[0] = 0x02; b[1] = timed ? 1 : 0; b[2] = epoch & 0xff;
  b.writeUInt32BE(Date.now() >>> 0, 3); b.writeUInt32BE(pts >>> 0, 7);
  opus.copy(b, 11);
  return b;
}
const CAN = {
  pad: (r) => r === 'pad' || r === 'kbm' || r === 'full',
  kbm: (r) => r === 'kbm' || r === 'full',
  launch: (r) => r === 'full',
};
const now = () => Date.now();

class Host extends EventEmitter {
  constructor({ store, net, helper, encoders, ffmpeg }) {
    super();
    this.store = store; this.net = net; this.helper = helper; this.encoders = encoders; this.ffmpeg = ffmpeg;
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
    helper.on('opus', (pkt) => { if (!this.movie.info) this._broadcastRaw(audioPacket(pkt.subarray(4), 0, 0, 0)); });
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
    this.movie.on('config', (c) => {
      for (const g of this.guests.values()) this._sendMovieConfig(g);
      this.emit('local', { t: 'config', codec: c.codec, family: c.family, description: c.description.toString('base64'), epoch: c.epoch, fps: c.fps, encoder: c.encoder, tier: 'movie' });
    });
    this.movie.on('frame', (f) => {
      for (const g of this.guests.values()) if (g.tier === 'movie' && g.configSent.movie === this.movie.config?.epoch) g.tx.send(f);
      this.emit('local', { t: 'v', epoch: f.epoch, id: f.id, key: f.key, data: f.data, enc: f.encMs, net: 0, pts: f.pts });
    });
    this.movie.on('audio', ({ data, pts, epoch }) => {
      this._broadcastRaw(audioPacket(data, 1, epoch, pts));
      this.emit('local', { t: 'a', data, timed: true, epoch, pts, age: 0 });
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
    if (!keyChanged && friend && friend.trust === 'always') return this.decide(k.sid, { accept: true, role: friend.role || this.store.get('defaultRole'), duration: 'session', auto: 'trusted' }, k);
    if (!keyChanged && k.viaCode && this.code && k.viaCode === this.code.code && this.code.exp > now() && this.store.get('acceptCodes')) {
      return this.decide(k.sid, { accept: true, role: 'watch', duration: 'session', auto: 'code' }, k);
    }
    this.knocks.set(k.sid, k);
    this.emit('knock', this._knockView(k));
    setTimeout(() => { if (this.knocks.has(k.sid)) { this.knocks.delete(k.sid); k.decide(false); this.emit('knock-gone', { sid: k.sid }); } }, 60000);
  }

  _knockView(k) { return { sid: k.sid, from: k.from, nick: k.nick, name: k.name, known: k.known, keyChanged: k.keyChanged, viaCode: k.viaCode, at: k.at }; }

  async decide(sid, { accept, role = 'pad', duration = 'session', trust = false, auto = null }, kk) {
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
      tier: null, tx: new VideoTx(link), joined: now(), auto, caps: k.caps || {}, fb: null, stats: {}, inSeq: -1,
      expiresAt: duration === 'session' ? null : now() + ({ '10m': 600e3, '1h': 3600e3 }[duration] || 0) || null,
      muted: false, hand: false, configSent: {},
    };
    this.guests.set(sid, g);
    if (CAN.pad(g.role)) g.slot = this._freeSlot();
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
      case 'askpause': this.emit('askpause', { name: g.nick }); break;
      case 'movie': if (this._canControl(g)) this.movieCtl(m.op, m.value, g.nick); break;
    }
  }

  _perms(g) {
    return { chat: this.store.get('allowChat') !== false && !g?.chatMuted, react: this.store.get('allowReactions') !== false && !g?.chatMuted };
  }
  pushPerms() { for (const g of this.guests.values()) g.link.ctrl({ t: 'perms', ...this._perms(g) }); this.emit('update'); }
  muteChat(sid, on) { const g = this.guests.get(sid); if (!g) return; g.chatMuted = !!on; g.link.ctrl({ t: 'perms', ...this._perms(g) }); this.emit('update'); }

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
    if (this.mode === 'play') { this._saveResume(); this.movie.stop(); this.helper.cmd({ cmd: 'audio', on: true, kbps: 128, keep: this.store.get('replaySeconds') + 5 }); }
    for (const g of this.guests.values()) { g.configSent = {}; g.link.ctrl({ t: 'mode', mode: this.mode, canControl: this._canControl(g) }); }
    if (this.guests.size) this._retier();
    this.emit('update');
  }

  _canControl(g) { return this.store.get('watchControl') === 'all' || g.role === 'full'; }

  async movieOpen(file, { autoplay = false, fresh = false, pos } = {}) {
    if (this.mode !== 'watch') this.setMode('watch');
    this._saveResume();
    const enc = this._encFor(this._pickCodec([...this.guests.values()]));
    const resume = fresh ? 0 : pos ?? this.store.d.resume?.[file]?.pos ?? 0;
    const st = await this.movie.open(file, { enc, kbps: (this.store.get('watchMbps') || 15) * 1000, night: this.store.get('nightAudio'), pos: resume });
    this.helper.cmd({ cmd: 'audio', on: false }); // the film's own audio replaces the desktop's
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
      case 'next': { const { nextInFolder } = require('./movie'); const n = nextInFolder(m.state.file); if (n) await this.movieOpen(n, { autoplay: true, fresh: true }); break; }
      case 'stop': this._saveResume(); m.stop(); break;
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
    return { title: v.title, playing: v.playing, pos: v.pos, dur: v.dur, audio: v.audio, sub: v.sub ? (v.sub.file ? `f${v.sub.file}` : `i${v.sub.i}`) : null, night: v.night, tracks: v.tracks ? { audio: v.tracks.audio, subs: v.tracks.subs.map((x) => ({ ...x, key: x.key, title: x.title })) } : null, next: v.next, at: now() };
  }

  _movieState() {
    const v = this._movieView();
    for (const g of this.guests.values()) g.link.ctrl({ t: 'movie', ...v });
    this.emit('movie', v);
  }

  _sendMovieConfig(g) {
    const c = this.movie.config; if (!c || g.configSent.movie === c.epoch) return;
    g.tier = 'movie';
    g.link.ctrl({ t: 'config', codec: c.codec, family: c.family, description: c.description.toString('base64'), epoch: c.epoch, fps: c.fps, encoder: c.encoder, tier: 'movie', hdr: false });
    g.configSent = { movie: c.epoch };
  }

  _onRaw(g, b) {
    const ch = b[0];
    if (ch === 0x06) { // feedback
      let fb; try { fb = JSON.parse(b.subarray(1)); } catch { return; }
      g.fb = fb; g.lastFb = now();
      if (!g.rc) return;
      g.rc.feedback(fb);
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
      this.helper.cmd({ cmd: 'audio', on: true, kbps: 128, keep: this.store.get('replaySeconds') + 5 });
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
    if (tier === 'watch') fps = Math.min(fps, 30);
    const o = { display: d.index | 0, fps, tenBit: this.store.get('tenBit'), hdr: this.store.get('hdr') && d.hdr };
    let srcW = d.w, srcH = d.h;
    if (win && this.wincap) { o.window = this.wincap; srcW = this.wincap.w; srcH = this.wincap.h; }
    // scale down to what the viewer can show (spectators get at most 720p)
    const maxW = tier === 'watch' ? 1280 : Math.max(...guests.map((g) => g.screen?.w || 1920));
    const maxH = tier === 'watch' ? 720 : Math.max(...guests.map((g) => g.screen?.h || 1080));
    const s = Math.min(1, maxW / srcW, maxH / srcH);
    if (s < 0.999) o.scale = { w: Math.round(srcW * s / 2) * 2, h: Math.round(srcH * s / 2) * 2 };
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
        if (!g.rc) g.rc = new RateControl({ maxKbps: (this.store.get('watchMbps') || 15) * 1000, startKbps: (this.store.get('watchMbps') || 15) * 1000 });
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
      const cap = (lan ? 150000 : (this.store.get('maxMbps') || 40) * 1000) * (tier === 'watch' ? this.store.get('spectatorQuality') || 0.35 : 1);
      for (const g of list) {
        if (!g.rc) {
          const hint = this.store.get('peakLearning') ? this.store.peakHint() : null;
          const start = lan ? cap * 0.6 : Math.min(cap * 0.5, hint ? hint.mbps * 900 : 12000);
          g.rc = new RateControl({ maxKbps: cap, startKbps: start, stability: this._stability(g) });
        } else { g.rc.setMax(cap); g.rc.setStability(this._stability(g)); }
      }
      const kbps = Math.min(...list.map((g) => g.rc.target));
      const t = this.tiers[tier];
      const want = { enc: this._encFor(codec), kbps, ...src, lan };
      if (!t) {
        const enc = new Encoder(this.ffmpeg);
        const nt = { enc, codec, kbps, opts: want, config: null, sig: this._sig(want) };
        enc.on('config', (c) => { nt.config = c; this._sendConfig(tier); });
        enc.on('frame', (f) => { for (const g of this.guests.values()) if (g.tier === tier && g.configSent[tier] === nt.config?.epoch) g.tx.send(f); });
        nt.retries = 0;
        enc.on('error', (e) => {
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

  _sig(o) { return JSON.stringify([o.enc.name, o.display, o.fps, o.scale, o.window?.pipe, o.tenBit, o.hdr]); }

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
    if (!win) { if (this.wincap) { this.helper.cmd({ cmd: 'wincap_stop' }); this.wincap = null; } return; }
    if (this.wincap && this.wincap.hwnd === win.hwnd) return;
    const pipe = `majlis-win-${process.pid}-${Date.now() % 100000}`;
    const r = await this.helper.request({ cmd: 'wincap', hwnd: win.hwnd, fps: this.store.get('fps') || 60, pipe }, 'wincap', 5000);
    if (!r?.ok) { this.emit('notice', { key: 'wincap_failed' }); this.store.set('captureWindow', null); return; }
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

  _roster() {
    const list = [...this.guests.values()].map((g) => ({ name: g.nick, role: g.role, slot: g.slot, hand: g.hand, idx: this._speakerIdx(g), baton: this.hotseat.holder === g.sid }));
    for (const g of this.guests.values()) g.link.ctrl({ t: 'roster', you: this._speakerIdx(g), list, hotseat: this.hotseat.on, host: this.store.get('nick') || '' });
  }

  _drop(sid, reason) {
    const g = this.guests.get(sid); if (!g) return;
    this.guests.delete(sid);
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
    for (const tier of ['play', 'watch']) {
      const tt = this.tiers[tier]; if (!tt) continue;
      const list = [...this.guests.values()].filter((g) => g.tier === tier && g.rc);
      if (!list.length) continue;
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

  _recordPeak() {
    const t = this.tiers.play;
    if (!t || !this.store.get('peakLearning')) return;
    const congested = [...this.guests.values()].some((g) => g.rc && now() - g.rc.lastDrop < 60000);
    this.store.recordPeak(t.kbps / 1000, congested);
  }

  stats() {
    return {
      enabled: this.enabled, code: this.code, hotseat: this.hotseat, mode: this.mode, movie: this.movie.info ? this._movieView() : null,
      tiers: Object.fromEntries(Object.entries(this.tiers).map(([k, t]) => [k, t && { codec: t.codec, kbps: t.kbps, encoder: t.opts.enc.name, fps: t.opts.fps, scale: t.opts.scale || null, lan: t.opts.lan }])),
      upKbps: [...this.guests.values()].reduce((a, g) => a + (g.fb?.kbps || 0), 0),
      guests: [...this.guests.values()].map((g) => ({
        sid: g.sid, id: g.id, name: g.nick, role: g.role, slot: g.slot, tier: g.tier, hand: g.hand, muted: g.muted, safety: g.link.safety,
        expiresAt: g.expiresAt, path: g.link.pathInfo(), rtt: Math.round(g.link.rtt), kbps: g.fb?.kbps || 0, loss: g.fb?.loss || 0, fps: g.fb?.fps || 0,
        qd: g.fb?.qd || 0, target: g.rc ? Math.round(g.rc.target) : 0, fec: g.rc ? Math.round(g.rc.fecRatio * 100) : 0, stability: g.rc?.stability || false,
        speaking: g.speakingAt && now() - g.speakingAt < 400, chatMuted: !!g.chatMuted, jitter: g.fb?.jitter || 0, baton: this.hotseat.holder === g.sid, connType: g.connType || null, ready: !!g.ready, joined: g.joined,
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
