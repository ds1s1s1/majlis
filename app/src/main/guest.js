'use strict';
// Joining a friend: connect by number or room code, reassemble the video, send input
// (every input packet goes out three times, a few ms apart, so a lost packet never eats a
// button press), report what the network looks like so the host can adapt.

const { EventEmitter } = require('events');
const { VideoRx } = require('./media');

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

  async connect(target, caps) {
    if (this.link) this.leave();
    this.state = 'knocking'; this.target = target; this.caps = caps;
    this.emit('state', { state: 'knocking', target });
    try {
      const link = await this.net.connect(target, { caps: { codecs: caps.codecs } });
      this._attach(link);
      return { ok: true };
    } catch (e) {
      this.state = 'idle';
      this.emit('state', { state: 'failed', reason: e.code || e.message, target });
      return { ok: false, reason: e.code || e.message };
    }
  }

  cancel() { this.net.cancelKnocks(); this.state = 'idle'; this.emit('state', { state: 'idle' }); }

  _attach(link) {
    this.link = link; this.state = 'linked';
    this.hostId = link.peer.id;
    const f = this.store.friend(link.peer.id);
    this.keyChanged = !!(f && f.pk && f.pk !== link.peer.pk);
    this.store.upsertFriend({ id: link.peer.id, pk: link.peer.pk, name: f?.name && f.name !== link.peer.id ? f.name : link.peer.nick || link.peer.id, lastSeen: now() });
    this.rx = new VideoRx({
      onFrame: (fr) => this._frame(fr),
      onNeedKey: () => this._needKey(),
    });
    this.emit('state', { state: 'linked', host: link.peer, safety: link.safety, keyChanged: this.keyChanged });
    link.ctrl({ t: 'hello', caps: { codecs: this.caps.codecs }, screen: this.caps.screen, padType: this.caps.padType, connType: this.store.get('connType') });
    link.on('ctrl', (m) => this._ctrl(m));
    link.on('raw', (b) => this._raw(b));
    link.on('path', (p) => this.emit('path', p));
    this.started = now(); this.rttSum = 0; this.rttN = 0;
    link.on('close', (r) => {
      const summary = { name: link.peer.nick || link.peer.id, ms: now() - this.started, mb: Math.round(link.stats.rx / 1e5) / 10, rtt: this.rttN ? Math.round(this.rttSum / this.rttN) : null };
      this.emit('state', { state: 'ended', reason: r, summary });
      this.link = null; this.state = 'idle'; clearInterval(this.fbTimer); clearInterval(this.pingTimer);
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
        this._post({ t: 'config', ...m });
        // a keyframe for this epoch may have beaten the config here
        const pk = this.pendingKey; if (pk && pk.epoch === m.epoch) { this.pendingKey = null; this._frame(pk); }
        break;
      }
      case 'cursor_shape': this._post({ t: 'shape', ...m }); break;
      case 'kick': this.emit('kicked', { panic: !!m.panic }); break;
      default: this.emit('ctrl', m);
    }
  }

  _frame(fr) {
    if (!this.configs.has(fr.epoch)) { if (fr.key) this.pendingKey = fr; return; }
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
      if (b.length < 12) return;
      const sentLocal = b.readUInt32BE(3) - Math.round(this.link?.clockOffset || 0);
      const age = Math.max(0, ((now() >>> 0) - (sentLocal >>> 0)) | 0);
      return this._post({ t: 'a', data: b.subarray(11), timed: b[1] === 1, epoch: b[2], pts: b.readUInt32BE(7), age: age < 5000 ? age : 0 });
    }
    if (ch === 0x0a) return this._post({ t: 'c', x: b.readFloatLE(1), y: b.readFloatLE(5), v: b[9], s: b.readInt32LE(10) });
    if (ch === 0x0b) return this._post({ t: 'r', large: b[1], small: b[2] });
    if (ch === 0x09) return this._post({ t: 'vo', idx: b[1], data: b.subarray(2) });
  }

  _feedback() {
    if (!this.link) return;
    const r = this.rx.report();
    r.loss = this.link.takeLoss();
    r.dec = this.decodeStats || null;
    this.last = r;
    const body = Buffer.from(JSON.stringify(r));
    this.link.send(Buffer.concat([Buffer.from([0x06]), body]));
    if (this.link.rtt) { this.rttSum += this.link.rtt; this.rttN++; }
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
    link.send(b);
    setTimeout(() => link.send(b), 2);
    setTimeout(() => link.send(b), 6);
  }

  ctrl(m) { this.link?.ctrl(m); }

  leave() {
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
