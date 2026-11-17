'use strict';
// Joining a friend: connect by number or room code, reassemble the video, send input
// (every input packet goes out three times, a few ms apart, so a lost packet never eats a
// button press), report what the network looks like so the host can adapt.

const { EventEmitter } = require('events');
const { makeRx } = require('./media');

const now = () => Date.now();

class Guest extends EventEmitter {
  constructor({ net, store }) {
    super();
    this.net = net; this.store = store;
    this.link = null; this.port = null;
    this.inSeq = 0;
    this.configs = new Map();
    this.state = 'idle';
  }

  async connect(target, caps, { pin, reconnect } = {}) {
    if (this.link) this.leave();
    if (!reconnect) this.retries = 0;
    this.leaving = false;
    this.state = 'knocking'; this.target = target; this.caps = caps; this.pin = pin || this.pin;
    this.emit('state', { state: reconnect ? 'reconnecting' : 'knocking', target });
    try {
      const link = await this.net.connect(target, { caps: { codecs: caps.codecs, maxKbps: this._maxKbps() }, pin: this.pin });
      this._attach(link);
      return { ok: true };
    } catch (e) {
      this.state = 'idle';
      if (reconnect) return this._retry();
      this.emit('state', { state: 'failed', reason: e.code || e.message, target });
      return { ok: false, reason: e.code || e.message };
    }
  }

  cancel() { this.leaving = true; this.net.cancelKnocks(); this.state = 'idle'; this.emit('state', { state: 'idle' }); }

  // Data saver (mobile data plans): ask the host to cap our stream.
  _maxKbps() { return this.store.get('dataSaver') ? 5000 : 0; }
  setDataSaver(on) { this.store.set('dataSaver', !!on); this.link?.ctrl({ t: 'limit', kbps: this._maxKbps() }); }

  // The line dropped (5G hiccup, Wi-Fi roam): knock again a few times. The host recognises us
  // and puts us back in our seat without asking.
  _retry() {
    if (this.leaving || (this.retries = (this.retries || 0) + 1) > 4) { this.emit('state', { state: 'ended', reason: 'timeout', summary: this.lastSummary }); return { ok: false }; }
    this.emit('state', { state: 'reconnecting', attempt: this.retries });
    setTimeout(() => { if (!this.leaving) this.connect(this.hostId || this.target, this.caps, { reconnect: true }); }, 1500 + this.retries * 1000);
    return { ok: false, reconnecting: true };
  }

  _attach(link) {
    this.link = link; this.state = 'linked';
    this.hostId = link.peer.id;
    const f = this.store.friend(link.peer.id);
    this.keyChanged = !!(f && f.pk && f.pk !== link.peer.pk);
    this.store.upsertFriend({ id: link.peer.id, pk: link.peer.pk, name: f?.name && f.name !== link.peer.id ? f.name : link.peer.nick || link.peer.id, lastSeen: now() });
    this.rx = makeRx(link, {
      onFrame: (fr) => this._frame(fr),
      onNeedKey: () => this._needKey(),
    });
    this.emit('state', { state: 'linked', host: link.peer, safety: link.safety, keyChanged: this.keyChanged });
    this.retries = 0;
    link.ctrl({ t: 'hello', caps: { codecs: this.caps.codecs, maxKbps: this._maxKbps() }, screen: this.caps.screen, padType: this.caps.padType, connType: this.store.get('connType') });
    link.on('ctrl', (m) => this._ctrl(m));
    link.on('raw', (b) => this._raw(b));
    link.on('path', (p) => this.emit('path', p));
    this.started = now(); this.rtts = [];
    link.on('close', (r) => {
      // median ping, ignoring the first seconds while the connection settles
      const rs = this.rtts.slice().sort((a, b) => a - b);
      const summary = { name: link.peer.nick || link.peer.id, ms: now() - this.started, mb: Math.round(link.stats.rx / 1e5) / 10, rtt: rs.length ? Math.round(rs[rs.length >> 1]) : null };
      this.link = null; this.state = 'idle'; clearInterval(this.fbTimer); clearInterval(this.pingTimer);
      this.lastSummary = summary;
      if (r === 'timeout' && !this.leaving) { this._retry(); return; }
      this.emit('state', { state: 'ended', reason: r, summary });
    });
    this.fbTimer = setInterval(() => this._feedback(), 100);
    this.pingTimer = setInterval(() => link.ping(), 400);
    link.ping();
  }

  setPort(port) {
    this.port = port;
    port.on('message', (e) => this._fromRenderer(e.data));
    port.start();
  }

  _post(msg) { try { this.port?.postMessage(msg); } catch {} }

  _ctrl(m) {
    switch (m.t) {
      case 'config': {
        this.configs.set(m.epoch, m);
        if (this.rx) { this.rx.film = m.tier === 'movie'; this.rx.nack = m.tier !== 'play'; }
        this._post({ t: 'config', ...m });
        // frames of this epoch may have beaten the config here (a film catch-up is seconds of them)
        const pend = (this.early || []).filter((f) => f.epoch === m.epoch);
        this.early = (this.early || []).filter((f) => f.epoch !== m.epoch);
        for (const f of pend) this._frame(f);
        break;
      }
      case 'fclock': this.fclock = m; this._postClock(); break;
      case 'mode': if (m.mode !== 'watch') this.fclock = null; this.emit('ctrl', m); break;
      case 'cursor_shape': this._post({ t: 'shape', ...m }); break;
      case 'kick': this.emit('kicked', { panic: !!m.panic }); break;
      default: this.emit('ctrl', m);
    }
  }

  // The film clock in our own time: host time minus how far its clock is ahead of ours. The
  // offset gets sharper as pings come in, so it's sent again when it moves.
  _postClock() {
    const m = this.fclock, link = this.link;
    if (!m || !link) return;
    const off = Math.round(link.clockOffset || 0);
    this.clockOff = off;
    this._post({ t: 'clock', pos: m.pos, at: m.at ? m.at - off : 0, playing: !!m.playing, run: m.run });
  }

  _frame(fr) {
    if (!this.configs.has(fr.epoch)) {
      // keep them (from a keyframe on) until the config lands; cap ~25 s of film
      const e = (this.early ||= []);
      if (fr.key || e.some((f) => f.epoch === fr.epoch)) e.push(fr);
      if (e.length > 600) e.splice(0, e.length - 600);
      return;
    }
    const link = this.link; if (!link) return;
    // network time = when it landed here minus when the host sent it (host clock -> ours)
    const sentLocal = fr.hostTs - Math.round(link.clockOffset);
    const net = (((now() >>> 0) - (sentLocal >>> 0)) | 0);
    this._post({ t: 'v', epoch: fr.epoch, id: fr.id, key: fr.key, data: fr.data, enc: fr.encMs, net: net > 0 && net < 5000 ? net : 0, gap: fr.gap, pts: fr.pts });
  }

  _needKey() {
    if (now() - (this.lastKeyReq || 0) < 500) return;
    this.lastKeyReq = now();
    this.link?.ctrl({ t: 'key' });
  }

  _raw(b) {
    const ch = b[0];
    if (ch === 0x01) return this.rx.push(b);
    if (ch === 0x02) {
      if (b.length < 14) return;
      if (b[1] === 1) this.rx.count(b.length + 29); // film audio is paced with the picture
      const seq = b.readUInt16BE(11);
      if (this.aSeen?.has(seq)) return;
      (this.aSeen ||= new Set()).add(seq);
      if (this.aSeen.size > 400) { const it = this.aSeen.values(); for (let i = 0; i < 200; i++) this.aSeen.delete(it.next().value); }
      const sentLocal = b.readUInt32BE(3) - Math.round(this.link?.clockOffset || 0);
      const age = Math.max(0, ((now() >>> 0) - (sentLocal >>> 0)) | 0);
      return this._post({ t: 'a', data: b.subarray(13), timed: b[1] === 1, epoch: b[2], pts: b.readUInt32BE(7), age: age < 5000 ? age : 0 });
    }
    if (ch === 0x0a) return this._post({ t: 'c', x: b.readFloatLE(1), y: b.readFloatLE(5), v: b[9], s: b.readInt32LE(10) });
    if (ch === 0x0b) return this._post({ t: 'r', large: b[1], small: b[2] });
    if (ch === 0x09) return this._post({ t: 'vo', idx: b[1], data: b.subarray(2) });
  }

  _feedback() {
    if (!this.link) return;
    const r = this.rx.report();
    r.loss = this.link.takeLoss();
    if (this.fclock && Math.abs(Math.round(this.link.clockOffset || 0) - (this.clockOff ?? 0)) > 4) this._postClock();
    r.dec = this.decodeStats || null;
    this.last = r;
    const body = Buffer.from(JSON.stringify(r));
    this.link.send(Buffer.concat([Buffer.from([0x06]), body]));
    if (this.link.rtt && now() - this.started > 4000) { this.rtts.push(this.link.rtt); if (this.rtts.length > 5000) this.rtts.shift(); }
    this.emit('stats', { ...r, rtt: Math.round(this.link.rtt * 10) / 10, path: this.link.pathInfo(), paths: this.link.allPaths() });
  }

  _fromRenderer(m) {
    if (!this.link) return;
    if (m.t === 'in') return this._input(m.data);
    if (m.t === 'vo') return this.link.send(Buffer.concat([Buffer.from([0x09]), Buffer.from(m.data)]));
    if (m.t === 'needkey') return this._needKey();
    if (m.t === 'dec') { this.decodeStats = m.s; return; }
  }

  // m.data = concatenated input events (see host._input for the layout)
  _input(events) {
    const ev = Buffer.from(events.buffer ? events.buffer : events, events.byteOffset || 0, events.byteLength || events.length);
    const b = Buffer.allocUnsafe(6 + ev.length);
    b[0] = 0x03; b.writeUInt32BE(this.inSeq = (this.inSeq + 1) >>> 0, 1); b[5] = countEvents(ev); ev.copy(b, 6);
    const link = this.link;
    link.sendBoth(b);
    setTimeout(() => link.send(b), 2);
    setTimeout(() => link.send(b), 6);
  }

  ctrl(m) { this.link?.ctrl(m); }

  leave() {
    this.leaving = true;
    if (!this.link) return;
    try { this.link.ctrl({ t: 'bye' }); } catch {}
    const l = this.link;
    setTimeout(() => l.close('left'), 120);
    this.link = null; this.state = 'idle';
    clearInterval(this.fbTimer); clearInterval(this.pingTimer);
    this.configs.clear();
  }
}

const SIZES = { 1: 5, 2: 5, 3: 5, 4: 3, 5: 5, 6: 16, 7: 24 };
function countEvents(buf) {
  let n = 0, o = 0;
  while (o < buf.length) { const s = SIZES[buf[o]]; if (!s) break; o += s; n++; }
  return Math.min(255, n);
}

module.exports = { Guest };
