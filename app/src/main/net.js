'use strict';
// Networking: talks to the rendezvous server, punches holes, measures every possible path
// (direct IPv6, direct IPv4, LAN, each relay, WebSocket fallback) and keeps the fastest one.
//
// Saudi-specific bits live here:
//  - IPv6 is tried first. Most 4G/5G home routers sit behind carrier NAT on IPv4 but hand out
//    real IPv6 addresses, so v6 often gives a direct path where v4 can't.
//  - "Smart route": traffic between two different ISPs sometimes leaves the country and comes
//    back. Every relay path is measured next to the direct one, and if the in-country relay is
//    faster, we take it.
//  - UDP blocked (campus / hotel / office Wi-Fi): fall back to a WebSocket tunnel on 443.

const dgram = require('dgram');
const dns = require('dns').promises;
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { signedBytes, verifyMsg, deriveId } = require('./ident');
const { newEphemeral, deriveKeys, safetyCode, Channel } = require('./seal');
const { stunBinding, TurnClient, handleStun, isStun } = require('./turn');

// The native core (Rust, majlis-core.node): UDP sockets, sealing, FEC, pacing, reassembly and
// rate control per packet. Optional: without it everything below runs in JS as before.
function loadCore() {
  if (process.env.MAJLIS_NOCORE) return null;
  const path = require('path');
  for (const p of [path.join(process.resourcesPath || '', 'app.asar.unpacked', 'native', 'majlis-core.node'), path.join(__dirname, '../../native/majlis-core.node')]) {
    try { if (require('fs').existsSync(p)) return require(p); } catch {}
  }
  return null;
}
const core = loadCore();

// dgram-shaped wrapper around a native socket, so the TURN/STUN/signaling code doesn't care
class CoreSocket extends EventEmitter {
  constructor(n, fam) { super(); this.n = n; this.fam = fam; this.id = n.id; }
  send(buf, port, addr, cb) { const ok = this.n.send(buf, port, addr); if (cb) setImmediate(() => cb(ok ? null : new Error('send failed'))); }
  address() { return { address: this.fam === 'v6' ? '::' : '0.0.0.0', port: this.n.port(), family: this.fam === 'v6' ? 'IPv6' : 'IPv4' }; }
  bindChannel(...a) { try { this.n.bindChannel(...a); } catch {} }
  setRecvBufferSize() {} setSendBufferSize() {}
  close() { this.n.close(); }
}

const P_REQ = 0x01, P_RESP = 0x02, T_DATA = 0x10, R = 0x52;
const now = () => Date.now();
const FORCE_RELAY = !!process.env.MAJLIS_FORCE_RELAY;
const NOLAN = !!process.env.MAJLIS_NOLAN; // testing aid: treat a local path like the internet
const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, high resolution

function parseServer(s) {
  s = String(s || '').trim();
  let host = s, port = 7700;
  const m6 = s.match(/^\[(.+)\](?::(\d+))?$/);
  if (m6) { host = m6[1]; if (m6[2]) port = +m6[2]; }
  else if ((s.match(/:/g) || []).length === 1) { const [h, p] = s.split(':'); host = h; port = +p; }
  return { host, port };
}

function localCandidates(p4, p6) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|Loopback|WSL/i.test(name)) continue;
    for (const a of list || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' && p4) out.push({ a: a.address, p: p4, f: 'v4', k: 'lan' });
      // Teredo (2001:0::/32) and 6to4 (2002::/16) are tunnels, not real IPv6: slow, skip them
      if (a.family === 'IPv6' && p6 && !a.address.startsWith('fe80') && !/^(2001:0?:|2002:)/i.test(a.address)) {
        const global = /^[23]/.test(a.address);
        out.push({ a: a.address, p: p6, f: 'v6', k: global ? 'v6' : 'lan' });
      }
    }
  }
  return out.slice(0, 12);
}

// ------------------------------------------------------------------------- Link
// One encrypted conversation with one peer, over whichever path is currently best.
class Link extends EventEmitter {
  constructor(net, { sid, role, keys, peer, relayInfo }) {
    super();
    this.net = net; this.sid = sid; this.role = role; this.peer = peer;
    this.ch = new Channel(keys, role, sid);
    this.safety = safetyCode(keys);
    this.sidBuf = Buffer.from(sid, 'hex');
    this.sidShort = this.ch.sidShort;
    // per-packet work goes native when the core is there (and the sockets are native too)
    if (net.core) {
      this.core = new net.core.CoreLink(this.sidShort, this.ch.txKey, this.ch.rxKey, this.ch.txDir, this.ch.rxDir, (kind, buf, a, b, c, d) => this._coreEvent(kind, buf, a, b, c, d));
    }
    this.paths = new Map();       // key -> path
    this.active = null;
    this.relayInfo = relayInfo;   // { token, exp, relays:[...], chosen }
    this.rtt = 0; this.clockOffset = 0; this.lastRx = now(); this.created = now();
    this.rxWin = { start: null, max: null, n: 0 };
    this.stats = { tx: 0, rx: 0, txPkts: 0, rxPkts: 0 };
    // reliable control channel
    this.cSeq = 0; this.cUnacked = new Map(); this.cNext = 0; this.cBuf = new Map(); this.cParts = [];
    this.timers = [
      setInterval(() => this._tick(), 25),
      setInterval(() => this._probeAll(false), 1000),
      setInterval(() => this._reselect(), 2000),
    ];
    this.closed = false;
    // first pick is whatever answered first; settle on the real best once everything was measured
    this.settle = [setTimeout(() => this._reselect(true), 1200), setTimeout(() => this._reselect(true), 3000)];
  }

  // ---- paths
  addPath(p) {
    const key = p.key || `${p.kind}|${p.addr}|${p.port}`;
    if (this.paths.has(key)) return this.paths.get(key);
    const path = { key, rtt: null, okAt: 0, sentProbes: new Map(), label: p.label || p.kind, ...p };
    this.paths.set(key, path);
    return path;
  }

  _rawSend(path, buf) {
    if (!path) return;
    try {
      if (path.kind === 'ws') { if (path.ws && path.ws.readyState === 1) path.ws.send(buf); }
      else if (path.turn) path.turn.sendTo(path.addr, path.port, buf);
      else path.sock.send(buf, path.port, path.addr);
    } catch {}
  }

  _probe(path, type = P_REQ, nonce, ts) {
    const b = Buffer.allocUnsafe(33);
    b[0] = type; b.writeUInt32BE(this.sidShort, 1);
    (nonce || crypto.randomBytes(8)).copy(b, 5);
    b.writeUInt32BE((ts ?? (hr() * 10)) >>> 0, 13);
    this.ch.probeMac(b.subarray(0, 17)).copy(b, 17);
    if (type === P_REQ) path.sentProbes.set(b.subarray(5, 13).toString('hex'), hr());
    if (path.sentProbes.size > 64) path.sentProbes.delete(path.sentProbes.keys().next().value);
    this._rawSend(path, b);
  }

  _probeAll(burst) {
    for (const p of this.paths.values()) if (!p.needsBind || p.bound) this._probe(p);
    if (burst) for (const p of this.paths.values()) if (p.needsBind && !p.bound) this.net._relayBind(p, this);
  }

  onProbe(buf, path) {
    if (buf.length !== 33) return;
    const mac = this.ch.probeMac(buf.subarray(0, 17));
    if (!crypto.timingSafeEqual(mac, buf.subarray(17, 33))) return;
    this.lastRx = now();
    if (buf[0] === P_REQ) {
      this._probe(path, P_RESP, buf.subarray(5, 13), buf.readUInt32BE(13));
      if (!path.okAt) path.okAt = now(); // they can reach us here; we'll measure it ourselves too
      if (!this.active) this._select(path);
    } else {
      const k = buf.subarray(5, 13).toString('hex');
      const t0 = path.sentProbes.get(k);
      if (t0 === undefined) return;
      path.sentProbes.delete(k);
      const rtt = hr() - t0;
      path.rtt = path.rtt == null ? rtt : path.rtt * 0.7 + rtt * 0.3;
      path.okAt = now();
      if (!this.active) setTimeout(() => this._reselect(true), 250);
      this.emit('paths');
    }
  }

  _score(p) {
    if (p.rtt == null || now() - p.okAt > 5000) return Infinity;
    if (FORCE_RELAY && p.kind !== 'relay' && p.kind !== 'ws') return Infinity; // testing aid
    let s = p.rtt;
    if (p.kind === 'relay') s += 3;        // direct wins ties
    if (p.kind === 'ws' || p.tls) s += 40; // TCP only when nothing else works: one lost packet stalls everything behind it
    if (p.kind === 'direct' && p.fam === 'v6') s -= 1.5; // IPv6 first
    if (p.kind === 'direct' && p.k === 'lan') s -= 2;
    return s;
  }

  _reselect(force) {
    if (this.closed) return;
    let best = null, bs = Infinity;
    for (const p of this.paths.values()) { const s = this._score(p); if (s < bs) { bs = s; best = p; } }
    if (!best) return;
    const cur = this.active ? this._score(this.active) : Infinity;
    if (force || !this.active || cur === Infinity || bs + 8 < cur) this._select(best);
  }

  _select(p) {
    if (this.active === p) return;
    this.active = p;
    this._route();
    this.emit('path', this.pathInfo());
  }

  // Tell the native core how packets it sends itself (paced video, feedback, repairs) leave:
  // straight UDP, a TURN channel, or through JS (TURN over TLS, WebSocket).
  _route() {
    if (!this.core) return;
    const p = this.active;
    this.nativeRoute = false;
    try {
      if (!p) return this.core.setRoute(0, 0, '', 0, 0);
      if (p.kind === 'ws' || p.tls) return this.core.setRoute(3, 0, '', 0, 0);
      if (p.turn) {
        const ch = p.turn.channels?.get(`${p.addr}|${p.port}`);
        if (ch && !p.turn.o.tls && p.turn.o.sock?.id) { this.nativeRoute = true; return this.core.setRoute(2, p.turn.o.sock.id, p.turn.o.host, p.turn.o.port, ch); }
        return this.core.setRoute(3, 0, '', 0, 0);
      }
      if (p.sock?.id && !p.needsBind) { this.nativeRoute = true; return this.core.setRoute(1, p.sock.id, p.addr, p.port, 0); }
      this.core.setRoute(3, 0, '', 0, 0);
    } catch { try { this.core.setRoute(3, 0, '', 0, 0); } catch {} }
  }

  _coreEvent(kind, buf, a, b, c, d) {
    if (this.closed) return;
    if (kind === 1) { // a body for JS (control, audio, input, pings...)
      let from;
      if (c & 1) { const t = this.net.turnByIdx?.get(c >> 1); from = t ? { kind: 'turn', turn: t, addr: a, port: b, fam: a.includes(':') ? 'v6' : 'v4' } : null; }
      else { const sock = this.net.sockById?.get(d); from = sock ? { kind: 'udp', sock, fam: sock.fam, addr: a, port: b } : null; }
      return this._body(buf, from ? this.net._pathFor(this, from) : null);
    }
    if (kind === 2) { // a whole video frame, reassembled natively
      const fr = { epoch: buf[0], key: !!buf[1], gap: buf.readInt16BE(2), id: buf.readUInt32BE(4), hostTs: buf.readUInt32BE(8), encMs: buf[12], pts: buf.readUInt32BE(16), owd: buf.readInt32BE(20), data: buf.subarray(24) };
      this.lastRx = now();
      return this.emit('vframe', fr);
    }
    if (kind === 3) return this.emit('skip', a);
    if (kind === 4) return this._rawSend(this.active, buf);
  }

  pathInfo() {
    const p = this.active;
    if (!p) return null;
    return { kind: p.kind, fam: p.fam || null, lan: p.k === 'lan' && !NOLAN, label: p.label, rtt: p.rtt == null ? null : Math.round(p.rtt * 10) / 10 };
  }

  allPaths() {
    return [...this.paths.values()].map((p) => ({ kind: p.kind, fam: p.fam, label: p.label, k: p.k, rtt: p.rtt == null ? null : Math.round(p.rtt * 10) / 10, alive: now() - p.okAt < 5000, active: p === this.active }));
  }

  // ---- data
  // Send on the active path and on the best other live path too. Used for tiny, precious
  // packets (input): if one path hiccups, the other copy still lands.
  sendBoth(body) {
    const ok = this.send(body);
    let alt = null, as = Infinity;
    for (const p of this.paths.values()) {
      if (p === this.active || p.tls || p.kind === 'ws') continue;
      const s = this._score(p);
      if (s < as) { as = s; alt = p; }
    }
    if (alt && as < Infinity) { const pkt = this.core ? this.core.seal(body) : this.ch.seal(body); this.stats.tx += pkt.length; this._rawSend(alt, pkt); }
    return ok;
  }

  send(body) {
    if (this.closed || !this.active) return false;
    // native route: sealed and sent from Rust (one call, and it shares the paced line's queue)
    if (this.nativeRoute) { this.stats.tx += body.length + 29; this.stats.txPkts++; return this.core.sendBody(body); }
    const pkt = this.core ? this.core.seal(body) : this.ch.seal(body);
    this.stats.tx += pkt.length; this.stats.txPkts++;
    this._rawSend(this.active, pkt);
    return true;
  }

  onData(pkt, path) {
    if (this.core) {
      // (a packet that came through JS: TURN indication, TLS, WebSocket) the core counts it
      const body = this.core.open(pkt);
      if (body) this._body(body, path);
      return;
    }
    const body = this.ch.open(pkt);
    if (!body) return;
    this.stats.rx += pkt.length; this.stats.rxPkts++;
    // packet loss from the counter gaps: exact, independent of what the packets carried
    const c = this.ch.lastRxCtr, w = this.rxWin;
    if (w.start === null) { w.start = c; w.max = c; }
    if (c > w.max) w.max = c;
    if (c >= w.start) w.n++;
    this._body(body, path);
  }

  _body(body, path) {
    this.lastRx = now();
    // Host follows the guest: answer on whatever path the guest is using right now.
    if (this.role === 'host' && path && this.active !== path) { this.active = path; this._route(); this.emit('path', this.pathInfo()); }
    const ch = body[0];
    if (ch === 0x04) return this._ctrlIn(body);
    if (ch === 0x05) { this.cUnacked.delete(body.readUInt32BE(1)); return; }
    if (ch === 0x07) { // ping
      const r = Buffer.allocUnsafe(17); r[0] = 0x08; body.copy(r, 1, 1, 9); r.writeDoubleBE(now(), 9);
      return this.send(r);
    }
    if (ch === 0x08) {
      const t0 = body.readDoubleBE(1), tp = body.readDoubleBE(9), t1 = now();
      const rtt = t1 - t0;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
      // Clock offset the NTP way: the sample with the shortest round trip is the one least
      // distorted by queuing (or by the other side being busy), so trust that one.
      const off = tp - (t0 + rtt / 2);
      (this.offs ||= []).push({ rtt, off });
      if (this.offs.length > 40) this.offs.shift();
      let best = this.offs[0];
      for (const x of this.offs) if (x.rtt < best.rtt) best = x;
      this.clockOffset = best.off;
      return;
    }
    this.emit('raw', body);
  }

  // fraction of packets lost since the last call
  takeLoss() {
    if (this.core) return this.core.takeLoss();
    const w = this.rxWin;
    if (w.start === null) return 0;
    const expected = w.max - w.start + 1;
    const loss = expected > 0 ? Math.max(0, 1 - w.n / expected) : 0;
    this.rxWin = { start: w.max + 1, max: w.max, n: 0 };
    return Math.round(loss * 1000) / 1000;
  }

  ping() { const b = Buffer.allocUnsafe(9); b[0] = 0x07; b.writeDoubleBE(now(), 1); this.send(b); }

  // ---- reliable control messages (JSON, fragmented, in order)
  ctrl(obj) {
    const data = Buffer.from(JSON.stringify(obj));
    const N = 1000;
    for (let o = 0; o < data.length || o === 0; o += N) {
      const part = data.subarray(o, o + N);
      const b = Buffer.allocUnsafe(6 + part.length);
      b[0] = 0x04; b.writeUInt32BE(this.cSeq, 1); b[5] = o + N < data.length ? 1 : 0; part.copy(b, 6);
      this.cUnacked.set(this.cSeq, { b, t: now() });
      this.cSeq = (this.cSeq + 1) >>> 0;
      this.send(b);
      if (data.length === 0) break;
    }
  }

  _ctrlIn(body) {
    const seq = body.readUInt32BE(1);
    const ack = Buffer.allocUnsafe(5); ack[0] = 0x05; ack.writeUInt32BE(seq, 1); this.send(ack);
    if (seq < this.cNext || this.cBuf.has(seq)) return;
    this.cBuf.set(seq, body);
    while (this.cBuf.has(this.cNext)) {
      const b = this.cBuf.get(this.cNext); this.cBuf.delete(this.cNext); this.cNext++;
      this.cParts.push(b.subarray(6));
      if (b[5] === 0) {
        const raw = Buffer.concat(this.cParts); this.cParts = [];
        let msg; try { msg = JSON.parse(raw); } catch { continue; }
        this.emit('ctrl', msg);
      }
    }
  }

  _tick() {
    const t = now();
    if (this.core) {
      const [ago, rx, n] = this.core.poll();
      this.lastRx = Math.max(this.lastRx, t - ago); this.stats.rx = rx; this.stats.rxPkts = n;
    }
    const rto = Math.max(40, (this.rtt || 50) * 1.8);
    for (const [, u] of this.cUnacked) if (t - u.t > rto) { u.t = t; this.send(u.b); }
    if (t - this.lastRx > 10000 && t - this.created > 10000) this.close('timeout');
  }

  close(reason = 'bye') {
    if (this.closed) return;
    this.closed = true;
    this.timers.forEach(clearInterval);
    this.settle.forEach(clearTimeout);
    for (const p of this.paths.values()) if (p.kind === 'ws' && p.ws) try { p.ws.close(); } catch {}
    for (const t of this.turns || []) { t.close(); this.net.turnClients?.delete(t); }
    this.net.links.delete(this.sidShort);
    try { this.core?.close(); } catch {}
    this.emit('close', reason);
  }
}

// -------------------------------------------------------------------------- Net
class Net extends EventEmitter {
  constructor(identity, settings) {
    super();
    this.id = identity; this.settings = settings;
    this.links = new Map();     // sidShort -> Link
    this.core = core; this.sockById = new Map(); this.turnByIdx = new Map(); this.turnIdx = 1;
    this.pending = new Map();   // sid -> pending handshake
    this.server = { v4: null, v6: null, ws: null };
    this.publicAddr = { v4: null, v6: null };
    this.relays = [];
    this.registered = false;
    this.busy = false;
    this.allow = [];
    this.relayWaiters = new Map();
  }

  get cloud() { return /^(https?|wss?):\/\//i.test(String(this.settings.get('server') || '')); }
  get base() { return String(this.settings.get('server')).replace(/^ws/i, 'http').replace(/\/+$/, ''); }

  async start() {
    const fixed = +this.settings.get('udpPort') || 0;
    this.s4 = await this._bind('udp4', fixed);
    this.s6 = await this._bind('udp6', fixed).catch(() => null);
    if (!String(this.settings.get('server') || '').trim()) { this.noServer = true; return; }
    if (this.cloud) return this._startCloud();
    await this.resolveServer();
    this._hello();
    this.helloTimer = setInterval(() => this._hello(), 20000);
    setTimeout(() => { if (!this.registered) this._wsSignal(); }, 3500);
  }

  _bind(type, port) {
    if (this.core) {
      // native socket: sessions are handled on its own thread, the rest comes here
      try {
        const fam = type === 'udp6' ? 'v6' : 'v4';
        let w = null;
        const n = new this.core.Socket(fam === 'v6', port | 0, (buf, addr, rport) => this._onPacket(buf, { kind: 'udp', sock: w, fam, addr, port: rport }));
        w = new CoreSocket(n, fam);
        this.sockById.set(w.id, w);
        return Promise.resolve(w);
      } catch (e) { if (type === 'udp6') return Promise.reject(e); this.core = null; }
    }
    return new Promise((res, rej) => {
      const s = dgram.createSocket({ type, ipv6Only: type === 'udp6', recvBufferSize: 8 << 20, sendBufferSize: 4 << 20 });
      s.on('error', (e) => { if (!s._bound) rej(e); });
      s.on('message', (buf, r) => this._onPacket(buf, { kind: 'udp', sock: s, fam: type === 'udp6' ? 'v6' : 'v4', addr: r.address, port: r.port }));
      s.bind(port, () => { s._bound = true; try { s.setRecvBufferSize(8 << 20); s.setSendBufferSize(4 << 20); } catch {} res(s); });
    });
  }

  // ---------------------------------------------------------------- Cloudflare mode
  // Signaling over a WebSocket to the Worker, public addresses from STUN, relaying via TURN.
  async _startCloud() {
    this.stunHost = 'stun.cloudflare.com'; this.stunPort = 3478;
    this.stunAddrs = new Set();
    await this.discover();
    this._cloudWs();
    this.helloTimer = setInterval(() => this._hello(), 60000);
    this.stunTimer = setInterval(() => this.discover(), 120000);
    fetch(`${this.base}/info`).then((r) => r.json()).then((i) => { this.colo = i.colo; this.isp = i.isp; this.emit('colo', i); }).catch(() => {});
  }

  async discover() {
    const addrs = await dns.lookup(this.stunHost, { all: true }).catch(() => []);
    addrs.forEach((a) => this.stunAddrs.add(a.address));
    const a4 = addrs.find((a) => a.family === 4), a6 = addrs.find((a) => a.family === 6);
    const [r4, r6] = await Promise.all([
      a4 ? stunBinding(this.s4, a4.address, this.stunPort) : null,
      a6 && this.s6 ? stunBinding(this.s6, a6.address, this.stunPort) : null,
    ]);
    if (r4) this.publicAddr.v4 = { ip: r4.a, port: r4.p };
    if (r6) this.publicAddr.v6 = { ip: r6.a, port: r6.p };
    return { v4: r4, v6: r6 };
  }

  _cloudWs() {
    const url = `${this.base.replace(/^http/i, 'ws')}/signal`;
    let ws;
    try { ws = new WebSocket(url); } catch { setTimeout(() => this._cloudWs(), 3000); return; }
    ws.on('open', () => { this.wsSig = ws; this.wsBackoff = 1000; this._hello(); });
    ws.on('message', (d) => { const str = String(d); if (str === 'pong') return; try { this._onSignal(JSON.parse(str), 'ws'); } catch {} });
    ws.on('close', () => {
      if (this.wsSig === ws) { this.wsSig = null; this.registered = false; this.emit('unregistered'); }
      if (this.stopped) return;
      this.wsBackoff = Math.min(15000, (this.wsBackoff || 1000) * 1.6);
      setTimeout(() => this._cloudWs(), this.wsBackoff);
    });
    ws.on('error', () => {});
    clearInterval(this.wsPing);
    this.wsPing = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
  }

  _srflx() {
    const out = [];
    if (this.publicAddr.v4) out.push({ a: this.publicAddr.v4.ip, p: this.publicAddr.v4.port, f: 'v4', k: 'srflx' });
    if (this.publicAddr.v6) out.push({ a: this.publicAddr.v6.ip, p: this.publicAddr.v6.port, f: 'v6', k: 'v6' });
    return out;
  }

  async _turnAllocate(creds, tlsMode = false) {
    if (!creds || !creds.username) return null;
    let host = 'turn.cloudflare.com', port = tlsMode ? 443 : 3478;
    const urls = creds.urls || [];
    const pick = urls.find((u) => (tlsMode ? /^turns:/i.test(u) && /:443\b/.test(u) : /^turn:/i.test(u) && /transport=udp/i.test(u)))
      || urls.find((u) => (tlsMode ? /^turns:/i.test(u) : /^turn:/i.test(u)));
    if (pick) { const m = pick.match(/^turns?:([^:?]+):(\d+)/i); if (m) { host = m[1]; port = +m[2]; } }
    let sock = null, addr = host;
    if (!tlsMode) {
      const addrs = await dns.lookup(host, { all: true }).catch(() => []);
      const a = addrs.find((x) => x.family === 4) || addrs.find((x) => x.family === 6 && this.s6);
      if (!a) return null;
      addr = a.address; sock = a.family === 6 ? this.s6 : this.s4;
    }
    const t = new TurnClient({ sock, host: addr, port, username: creds.username, credential: creds.credential, tls: tlsMode });
    t.on('data', (inner, peer) => this._onPacket(inner, { kind: 'turn', turn: t, addr: peer.a, port: peer.p, fam: peer.f }));
    t.idx = this.turnIdx++; this.turnByIdx.set(t.idx, t);
    (this.turnClients ||= new Set()).add(t);
    try {
      const relayed = await Promise.race([t.allocate(), new Promise((_, rej) => setTimeout(() => rej(new Error('turn timeout')), 5000))]);
      t.label = 'Cloudflare';
      return { t, relayed };
    } catch { t.close(); this.turnClients.delete(t); return null; }
  }

  // relay paths for a link: through each of our TURN allocations to each peer candidate
  async _turnPaths(link, peerCands) {
    const list = (peerCands || []).filter((c) => c.k !== 'lan');
    const ips = [...new Set(list.map((c) => c.a))];
    for (const t of link.turns || []) {
      await t.permit(ips);
      for (const c of list) {
        const ch = await t.channel(c.a, c.p);
        if (!ch || link.closed) continue;
        // relayed packets on this channel get unwrapped natively too
        if (!t.o.tls && t.o.sock?.bindChannel) { t.o.sock.bindChannel(t.o.host, t.o.port, ch, c.a, c.p, t.idx); if (link.active?.turn === t) link._route(); }
        link.addPath({ kind: 'relay', key: `turn|${t.o.tls ? 'tls' : 'udp'}|${c.a}|${c.p}`, turn: t, addr: c.a, port: c.p, fam: c.f, label: t.o.tls ? 'tcp' : t.label, tls: !!t.o.tls });
      }
    }
  }

  _sendCands(link, cands) {
    this.signal(this._sign({ t: 'cand', from: this.id.id, to: link.peer.id, sid: link.sid, cands, ts: now() }));
  }

  _onCand(wrap) {
    const m = wrap.m; if (!m) return;
    const link = [...this.links.values()].find((l) => l.sid === m.sid);
    const pk = link?.peer.pk || this.knockPk?.get(m.sid);
    if (!pk || !verifyMsg(m, pk)) return;
    const cands = (m.cands || []).filter((c) => c && typeof c.a === 'string');
    if (!link) { (this.candBuf ||= new Map()).set(m.sid, [...(this.candBuf.get(m.sid) || []), ...cands]); return; }
    link.peerCands = [...(link.peerCands || []), ...cands];
    this._addPeerCands(link, cands);
  }

  _addPeerCands(link, cands) {
    for (const c of cands) {
      const sock = c.f === 'v6' ? this.s6 : this.s4;
      if (!sock) continue;
      link.addPath({ kind: c.k === 'relay' ? 'relay' : 'direct', fam: c.f, k: c.k, addr: c.a, port: c.p, sock, label: c.k === 'relay' ? 'Cloudflare' : c.k === 'lan' ? 'lan' : c.f });
    }
    this._turnPaths(link, cands).catch(() => {});
  }

  async resolveServer() {
    const { host, port } = parseServer(this.settings.get('server'));
    this.serverHost = host; this.serverPort = port;
    const addrs = await dns.lookup(host, { all: true }).catch(() => []);
    this.server.v4 = addrs.find((a) => a.family === 4)?.address || null;
    this.server.v6 = addrs.find((a) => a.family === 6)?.address || null;
    if (!this.server.v4 && !this.server.v6 && /^[\d.]+$/.test(host)) this.server.v4 = host;
  }

  _sign(obj) { obj.sig = this.id.sign(signedBytes(obj)).toString('base64'); return obj; }

  signal(obj) {
    const buf = Buffer.from(JSON.stringify(obj));
    let sent = false;
    if (this.cloud) { if (this.wsSig && this.wsSig.readyState === 1) { this.wsSig.send(buf.toString()); return true; } return false; }
    if (this.server.v4) { this.s4.send(buf, this.serverPort, this.server.v4); sent = true; }
    if (this.server.v6 && this.s6) { this.s6.send(buf, this.serverPort, this.server.v6); sent = true; }
    if (this.wsSig && this.wsSig.readyState === 1) { this.wsSig.send(buf.toString()); sent = true; }
    return sent;
  }

  _hello() {
    const key = this.settings.get('accessKey') || undefined;
    const msg = this._sign({ t: 'hello', id: this.id.id, pk: this.id.pkB64, salt: this.id.salt, nick: this.settings.get('nick') || '', busy: this.busy, allow: this.allow, key, ts: now() });
    this.signal(msg);
  }

  setPresence({ busy, allow }) {
    const before = JSON.stringify([this.busy, this.allow]);
    if (busy !== undefined) this.busy = busy;
    if (allow) this.allow = allow;
    if (JSON.stringify([this.busy, this.allow]) !== before) this._hello();
  }

  _wsSignal() {
    const url = this.settings.get('serverWs') || `ws://${this.serverHost.includes(':') ? `[${this.serverHost}]` : this.serverHost}:7780/signal`;
    try {
      const ws = new WebSocket(url);
      ws.on('open', () => { this.wsSig = ws; this._hello(); });
      ws.on('message', (d) => { try { this._onSignal(JSON.parse(d), 'ws'); } catch {} });
      ws.on('close', () => { if (this.wsSig === ws) this.wsSig = null; });
      ws.on('error', () => {});
    } catch {}
  }

  _onPacket(buf, from) {
    if (this.turnClients && from.kind === 'udp') {
      for (const tc of this.turnClients) if (tc.isFromServer(from)) { tc.handle(buf); return; }
    }
    if (this.stunAddrs && from.kind === 'udp' && this.stunAddrs.has(from.addr) && isStun(buf)) { handleStun(buf); return; }
    const t = buf[0];
    if (t === 0x7b) {
      if ((from.addr === this.server.v4 || from.addr === this.server.v6) && from.port === this.serverPort) {
        try { this._onSignal(JSON.parse(buf), from.fam); } catch {}
      }
      return;
    }
    if (t === T_DATA || t === P_REQ || t === P_RESP) {
      if (buf.length < 5) return;
      const link = this.links.get(buf.readUInt32BE(1));
      if (!link) return;
      const path = this._pathFor(link, from);
      if (t === T_DATA) link.onData(buf, path); else link.onProbe(buf, path);
      return;
    }
    if (t === R) return this._onRelayCtl(buf, from);
  }

  _pathFor(link, from) {
    if (from.kind === 'ws') return from.path;
    if (from.kind === 'turn') {
      for (const p of link.paths.values()) if (p.turn === from.turn && p.addr === from.addr && p.port === from.port) return p;
      return link.addPath({ kind: 'relay', key: `turn|${from.turn.o.tls ? 'tls' : 'udp'}|${from.addr}|${from.port}`, turn: from.turn, addr: from.addr, port: from.port, fam: from.fam, label: from.turn.o.tls ? 'tcp' : from.turn.label || 'Cloudflare', tls: !!from.turn.o.tls });
    }
    for (const p of link.paths.values()) if (p.kind !== 'ws' && !p.turn && p.addr === from.addr && p.port === from.port && p.sock === from.sock) return p;
    // peer-reflexive: they reached us from an address we didn't know about (NAT rewrote it)
    const fam = from.fam;
    const isLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd])/i.test(from.addr);
    return link.addPath({ kind: 'direct', fam, k: isLan ? 'lan' : fam === 'v6' ? 'v6' : 'prflx', addr: from.addr, port: from.port, sock: from.sock, label: isLan ? 'lan' : fam });
  }

  _onSignal(msg, via) {
    switch (msg.t) {
      case 'hi':
        this.registered = true;
        if (msg.fam === 'v4' || msg.fam === 'v6') this.publicAddr[msg.fam] = { ip: msg.ip, port: msg.port };
        this.relays = msg.relays || [];
        this.serverClockSkew = msg.now - now();
        return this.emit('registered', { publicAddr: this.publicAddr, relays: this.relays, via });
      case 'taken':
        return this.emit('taken');
      case 'error':
        return this.emit('server-error', msg.e);
      case 'presence': return this.emit('presence', msg.on || {});
      case 'code': return this.emit('code', msg);
      case 'knock': return this._onKnock(msg);
      case 'cand': return this._onCand(msg);
      case 'knock_ok': case 'knock_fail': case 'answer': case 'answer_ok': {
        const p = this.pending.get(msg.sid);
        if (p) p.onSignal(msg);
        return;
      }
    }
  }

  // ---- relays
  _relayAddr(r, fam) { return { host: r.host || this.serverHost, port: r.udp || 7701, fam }; }

  async pingRelays(count = 5) {
    const out = {};
    if (this.cloud) {
      const addrs = await dns.lookup('turn.cloudflare.com', { all: true }).catch(() => []);
      const a = addrs.find((x) => x.family === 4);
      if (!a) return out;
      (this.stunAddrs ||= new Set()).add(a.address);
      let best = Infinity;
      for (let i = 0; i < count; i++) { const r = await stunBinding(this.s4, a.address, 3478); if (r) best = Math.min(best, r.rtt); }
      if (best < Infinity) out.cf = Math.round(best * 10) / 10;
      return out;
    }
    await Promise.all(this.relays.map(async (r) => {
      let best = Infinity, n = 0;
      const addrs = await dns.lookup(r.host || this.serverHost, { all: true }).catch(() => []);
      const tgt = addrs.find((a) => a.family === 6 && this.s6) || addrs.find((a) => a.family === 4);
      if (!tgt) return;
      const sock = tgt.family === 6 ? this.s6 : this.s4;
      for (let i = 0; i < count; i++) {
        const rtt = await this.relayPing(sock, tgt.address, r.udp || 7701);
        if (rtt != null) { best = Math.min(best, rtt); n++; }
      }
      if (n) out[r.name] = Math.round(best * 10) / 10;
    }));
    return out;
  }

  relayPing(sock, addr, port, timeout = 800) {
    return new Promise((res) => {
      const nonce = crypto.randomBytes(8);
      const b = Buffer.concat([Buffer.from([R, 0x50]), nonce]);
      const key = nonce.toString('hex');
      const t0 = hr();
      const to = setTimeout(() => { this.relayWaiters.delete(key); res(null); }, timeout);
      this.relayWaiters.set(key, () => { clearTimeout(to); res(hr() - t0); });
      sock.send(b, port, addr);
    });
  }

  _onRelayCtl(buf, from) {
    const op = buf[1];
    if (op === 0x51) { const w = this.relayWaiters.get(buf.subarray(2, 10).toString('hex')); if (w) { this.relayWaiters.delete(buf.subarray(2, 10).toString('hex')); w(); } return; }
    if (op === 0x4b && buf.length >= 19) {
      const sid = buf.subarray(2, 18).toString('hex');
      for (const l of this.links.values()) if (l.sid === sid) {
        for (const p of l.paths.values()) if (p.needsBind && ((from.kind === 'ws' && p === from.path) || (p.addr === from.addr && p.port === from.port))) { p.bound = true; l._probe(p); }
      }
      return;
    }
    if (op === 0x55) { const w = this.relayWaiters.get('ut' + buf.readUInt32BE(2)); if (w) w(buf); }
  }

  _relayBind(path, link) {
    const b = Buffer.alloc(55);
    b[0] = R; b[1] = 0x42; link.sidBuf.copy(b, 2); b[18] = link.role === 'host' ? 1 : 0;
    b.writeUInt32BE(link.relayInfo.exp, 19); Buffer.from(link.relayInfo.token, 'base64').copy(b, 23);
    link._rawSend(path, b);
  }

  // Upload test against a relay: blast packets for ~1.5 s, ask how much arrived.
  async uploadTest(relay, mbps = 60, ms = 1500) {
    if (this.cloud) return this._httpUpload(Math.max(ms, 2000));
    const addrs = await dns.lookup(relay.host || this.serverHost, { all: true }).catch(() => []);
    const tgt = addrs.find((a) => a.family === 4) || addrs.find((a) => a.family === 6 && this.s6);
    if (!tgt) return null;
    const sock = tgt.family === 6 ? this.s6 : this.s4;
    const id = crypto.randomInt(1, 2 ** 31);
    const pkt = Buffer.alloc(1200); pkt[0] = R; pkt[1] = 0x54; pkt.writeUInt32BE(id, 2);
    const perMs = (mbps * 1e6 / 8) / 1200 / 1000;
    const start = hr(); let sent = 0;
    await new Promise((res) => {
      const iv = setInterval(() => {
        const el = hr() - start;
        const want = Math.floor(el * perMs);
        while (sent < want) { pkt.writeUInt32BE(sent, 6); sock.send(pkt, relay.udp || 7701, tgt.address); sent++; }
        if (el >= ms) { clearInterval(iv); res(); }
      }, 2);
    });
    await new Promise((r) => setTimeout(r, 300));
    const q = Buffer.alloc(6); q[0] = R; q[1] = 0x53; q.writeUInt32BE(id, 2);
    const reply = await new Promise((res) => {
      const to = setTimeout(() => { this.relayWaiters.delete('ut' + id); res(null); }, 1500);
      this.relayWaiters.set('ut' + id, (b) => { clearTimeout(to); res(b); });
      sock.send(q, relay.udp || 7701, tgt.address);
    });
    if (!reply) return null;
    const count = reply.readUInt32BE(6), bytes = reply.readUInt32BE(10), dur = reply.readUInt32BE(14);
    return { sent, received: count, loss: sent ? 1 - count / sent : 0, mbps: (bytes * 8) / (dur * 1000) };
  }

  async _httpUpload(ms) {
    const chunk = crypto.randomBytes(256 * 1024);
    const t0 = hr(); let sent = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (hr() - t0 > ms || sent > 50e6) { ctrl.close(); return; }
        sent += chunk.length; ctrl.enqueue(chunk);
      },
    });
    try {
      const r = await fetch(`${this.base}/up?k=${encodeURIComponent(this.settings.get('accessKey') || '')}`, { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/octet-stream' } });
      const j = await r.json();
      const dur = hr() - t0;
      return { sent: Math.round(sent / 1200), received: Math.round(j.bytes / 1200), loss: 0, mbps: (j.bytes * 8) / (dur * 1000), colo: j.colo, capped: sent > 50e6 };
    } catch { return null; }
  }

  // ---- connecting (guest side)
  async connect(target, { caps, nick, pin } = {}) {
    const sid = crypto.randomBytes(16).toString('hex');
    const eph = newEphemeral();
    const rtts = await this.pingRelays(3).catch(() => ({}));
    const cands = [...localCandidates(this.s4.address().port, this.s6?.address().port), ...(this.cloud ? this._srflx() : [])];
    const knock = this._sign({
      t: 'knock', from: this.id.id, to: target, sid, pk: this.id.pkB64, salt: this.id.salt, nick: nick || this.settings.get('nick') || '',
      eph: eph.pub.toString('base64'), cands, rtts, caps: caps || {}, ts: now(),
      // room PIN: prove we know it without sending it (the server relays this message)
      ...(pin ? { pin: crypto.createHmac('sha256', String(pin)).update(sid).digest('hex').slice(0, 32) } : {}),
    });
    return new Promise((resolve, reject) => {
      let tries = 0, state = 'knocking', hostPk = null, relay = null, hostId = null, turnCreds = null, turnP = null;
      const p = {
        onSignal: (m) => {
          if (m.t === 'knock_fail') { cleanup(); return reject(Object.assign(new Error(m.reason), { code: m.reason })); }
          if (m.t === 'knock_ok') {
            if (state === 'knocking') {
              state = 'waiting'; hostPk = m.hostPk; relay = m.relay; hostId = m.hostId; turnCreds = m.turn;
              this.emit('knock-progress', { sid, state, hostId });
              // get a relayed address ready while the host decides
              if (this.cloud && m.turn) turnP = this._turnAllocate(m.turn);
            }
            return;
          }
          if (m.t === 'answer') {
            if (state === 'linked' || !m.m) return;
            const srflx = m.srflx || []; m = m.m; m.srflx = srflx;
            const signed = { ...m, srflx: undefined };
            if (!hostPk || !verifyMsg(signed, hostPk) || m.from !== hostId) return;
            if (!m.accept) { cleanup(); const why = m.reason === 'pin' ? 'pin' : 'declined'; return reject(Object.assign(new Error(why), { code: why })); }
            state = 'linked'; cleanup();
            const keys = deriveKeys(eph, Buffer.from(m.eph, 'base64'), sid, this.id.pkB64, hostPk);
            const link = this._makeLink({ sid, role: 'guest', keys, peer: { id: hostId, pk: hostPk, nick: m.nick }, relay, myRtts: rtts, theirRtts: m.rtts || {}, cands: [...(m.cands || []), ...(m.srflx || [])], turn: turnCreds });
            link.hello = m;
            if (turnP) turnP.then((r) => {
              if (!r) return;
              if (link.closed) { r.t.close(); return; }
              link.turns.push(r.t);
              this._sendCands(link, [{ a: r.relayed.a, p: r.relayed.p, f: r.relayed.f, k: 'relay' }]);
              this._turnPaths(link, link.peerCands).catch(() => {});
            });
            resolve(link);
          }
        },
      };
      this.pending.set(sid, p);
      const send = () => {
        if (state === 'knocking' && tries++ > 6) { cleanup(); return reject(Object.assign(new Error('no_server'), { code: 'no_server' })); }
        if (state === 'knocking') this.signal(knock);
      };
      send();
      const iv = setInterval(send, 1000);
      const giveUp = setTimeout(() => { cleanup(); reject(Object.assign(new Error('timeout'), { code: 'timeout' })); }, 90000);
      const cleanup = () => { clearInterval(iv); clearTimeout(giveUp); this.pending.delete(sid); };
      p.cancel = () => { cleanup(); reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); };
      this.emit('knock-progress', { sid, state });
    });
  }

  cancelKnocks() { for (const p of this.pending.values()) p.cancel?.(); }

  // ---- being connected to (host side)
  _onKnock(wrap) {
    const m = wrap.m;
    if (!m || typeof m !== 'object') return;
    m.relay = wrap.relay; m.srflx = wrap.srflx || []; m.turn = wrap.turn;
    (this.knockPk ||= new Map()).set(m.sid, m.pk);
    if (this.seenKnocks?.has(m.sid)) return;
    (this.seenKnocks ||= new Set()).add(m.sid);
    if (this.seenKnocks.size > 500) this.seenKnocks = new Set();
    const pk = Buffer.from(String(m.pk || ''), 'base64');
    if (pk.length !== 32 || deriveId(pk, m.salt | 0) !== m.from || !verifyMsg({ ...m, relay: undefined, srflx: undefined, turn: undefined }, m.pk)) return;
    if (Math.abs(now() - m.ts) > 120000) return;
    this.emit('knock', {
      sid: m.sid, from: m.from, pk: m.pk, nick: String(m.nick || '').slice(0, 32), viaCode: /^\d{6}$/.test(m.to) ? m.to : null, caps: m.caps || {}, pin: typeof m.pin === 'string' ? m.pin : null,
      decide: (accept, extra = {}) => this._answer(m, accept, extra),
    });
  }

  async _answer(m, accept, extra) {
    const eph = newEphemeral();
    const [rtts, tr] = accept ? await Promise.all([this.pingRelays(3).catch(() => ({})), this.cloud && m.turn ? this._turnAllocate(m.turn) : null]) : [{}, null];
    const myCands = accept ? [...localCandidates(this.s4.address().port, this.s6?.address().port), ...(this.cloud ? this._srflx() : [])] : [];
    if (tr) myCands.push({ a: tr.relayed.a, p: tr.relayed.p, f: tr.relayed.f, k: 'relay' });
    const ans = this._sign({
      t: 'answer', from: this.id.id, to: m.from, sid: m.sid, accept: !!accept, nick: this.settings.get('nick') || '',
      eph: eph.pub.toString('base64'), cands: myCands, rtts, ...extra, ts: now(),
    });
    let n = 0;
    this.signal(ans);
    if (!accept) return null;
    const keys = deriveKeys(eph, Buffer.from(m.eph, 'base64'), m.sid, m.pk, this.id.pkB64);
    const link = this._makeLink({ sid: m.sid, role: 'host', keys, peer: { id: m.from, pk: m.pk, nick: m.nick }, relay: m.relay, myRtts: rtts, theirRtts: m.rtts || {}, cands: [...(m.cands || []), ...(m.srflx || []), ...((this.candBuf && this.candBuf.get(m.sid)) || [])], turn: m.turn, turns: tr ? [tr.t] : [] });
    this.candBuf?.delete(m.sid);
    const iv = setInterval(() => { if (link.active || link.closed || n++ > 8) return clearInterval(iv); this.signal(ans); }, 1000);
    return link;
  }

  _makeLink({ sid, role, keys, peer, relay, myRtts, theirRtts, cands, turn, turns }) {
    const link = new Link(this, { sid, role, keys, peer, relayInfo: relay });
    this.links.set(link.sidShort, link);
    if (this.cloud) {
      link.turns = turns || [];
      link.peerCands = cands.filter((c) => c && typeof c.a === 'string');
      link.relayRank = [{ name: 'cf', label: 'Cloudflare', total: null }];
      this._addPeerCands(link, link.peerCands);
      // UDP blocked? TURN over TLS on 443
      setTimeout(async () => {
        if (link.closed || [...link.paths.values()].some((p) => p.rtt != null && !p.tls)) return;
        const r = await this._turnAllocate(turn, true);
        if (!r) return;
        if (link.closed) { r.t.close(); return; }
        link.turns.push(r.t);
        this._sendCands(link, [{ a: r.relayed.a, p: r.relayed.p, f: r.relayed.f, k: 'relay' }]);
        this._turnPaths(link, link.peerCands).catch(() => {});
      }, 3500);
      let n = 0;
      const burst = setInterval(() => { if (link.closed || n++ > 60) return clearInterval(burst); link._probeAll(false); }, 50);
      return link;
    }
    // direct candidates
    for (const c of cands) {
      if (!c || typeof c.a !== 'string') continue;
      const sock = c.f === 'v6' ? this.s6 : this.s4;
      if (!sock) continue;
      link.addPath({ kind: 'direct', fam: c.f, k: c.k, addr: c.a, port: c.p, sock, label: c.k === 'lan' ? 'lan' : c.f });
    }
    // relays: every relay both sides could reach, ordered by combined RTT
    const scored = this.relays.map((r) => ({ r, s: (myRtts[r.name] ?? 999) + (theirRtts[r.name] ?? 999) })).sort((a, b) => a.s - b.s);
    link.relayRank = scored.map((x) => ({ name: x.r.name, label: x.r.label, total: x.s >= 999 ? null : Math.round(x.s) }));
    if (relay) {
      for (const { r } of scored.slice(0, 3)) {
        dns.lookup(r.host || this.serverHost, { all: true }).then((addrs) => {
          for (const a of addrs) {
            const fam = a.family === 6 ? 'v6' : 'v4';
            const sock = fam === 'v6' ? this.s6 : this.s4;
            if (!sock) continue;
            const p = link.addPath({ kind: 'relay', fam, addr: a.address, port: r.udp || 7701, sock, needsBind: true, label: r.label || r.name, relay: r.name });
            this._relayBind(p, link);
          }
        }).catch(() => {});
      }
      // TCP/WebSocket fallback if nothing over UDP answers in time
      setTimeout(() => {
        if (link.closed || (link.active && link.active.rtt != null)) return;
        const r = scored[0]?.r;
        const url = r?.ws || this.settings.get('relayWs') || `ws://${this.serverHost}:7780/relay`;
        try {
          const ws = new WebSocket(url);
          const p = link.addPath({ kind: 'ws', key: 'ws', ws, needsBind: true, label: 'tcp' });
          const from = { kind: 'ws', path: p };
          ws.binaryType = 'nodebuffer';
          ws.on('open', () => this._relayBind(p, link));
          ws.on('message', (d) => this._onPacket(Buffer.from(d), from));
          ws.on('error', () => {});
        } catch {}
      }, 3500);
    }
    // punch: burst probes for a few seconds
    let n = 0;
    const burst = setInterval(() => { if (link.closed || n++ > 60) return clearInterval(burst); link._probeAll(n % 5 === 1); }, 50);
    return link;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.helloTimer); clearInterval(this.stunTimer); clearInterval(this.wsPing);
    for (const t of this.turnClients || []) t.close();
    try { this.signal(this._sign({ t: 'bye', id: this.id.id, ts: now() })); } catch {}
    for (const l of [...this.links.values()]) l.close('quit');
    try { this.s4?.close(); this.s6?.close(); this.wsSig?.close(); } catch {}
  }
}

module.exports = { Net, Link, localCandidates, parseServer };
