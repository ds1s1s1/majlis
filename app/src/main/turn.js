'use strict';
// Minimal STUN/TURN client (RFC 5389 / 5766) for Cloudflare's TURN service.
// UDP for normal use, TLS on 443 for networks that block UDP.
//   - stunBinding(): our public address as seen from outside (for hole punching)
//   - TurnClient: allocate a relayed address, permissions, channel binds, ChannelData

const crypto = require('crypto');
const tls = require('tls');
const { EventEmitter } = require('events');

const MAGIC = 0x2112a442;
const M = { BINDING: 0x001, ALLOCATE: 0x003, REFRESH: 0x004, SEND: 0x006, DATA: 0x007, PERMISSION: 0x008, CHANNEL: 0x009 };
const A = { USERNAME: 0x0006, MI: 0x0008, ERROR: 0x0009, CHANNEL: 0x000c, LIFETIME: 0x000d, PEER: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, RELAYED: 0x0016, TRANSPORT: 0x0019, MAPPED: 0x0020, FINGERPRINT: 0x8028 };

function encode(method, cls, tid, attrs) {
  const parts = [];
  for (const [type, val] of attrs) {
    const h = Buffer.alloc(4); h.writeUInt16BE(type, 0); h.writeUInt16BE(val.length, 2);
    parts.push(h, val);
    const pad = (4 - (val.length % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  const body = Buffer.concat(parts);
  const hdr = Buffer.alloc(20);
  hdr.writeUInt16BE((method & 0x0f80) << 2 | (method & 0x0070) << 1 | (method & 0x000f) | cls, 0);
  hdr.writeUInt16BE(body.length, 2); hdr.writeUInt32BE(MAGIC, 4); tid.copy(hdr, 8);
  return Buffer.concat([hdr, body]);
}

// append MESSAGE-INTEGRITY (HMAC-SHA1 with the long-term key)
function withIntegrity(msg, key) {
  const m = Buffer.from(msg);
  m.writeUInt16BE(m.readUInt16BE(2) + 24, 2);
  const mac = crypto.createHmac('sha1', key).update(m).digest();
  const a = Buffer.alloc(24); a.writeUInt16BE(A.MI, 0); a.writeUInt16BE(20, 2); mac.copy(a, 4);
  return Buffer.concat([m, a]);
}

function decode(buf) {
  if (buf.length < 20 || (buf[0] & 0xc0) !== 0 || buf.readUInt32BE(4) !== MAGIC) return null;
  const t = buf.readUInt16BE(0), len = buf.readUInt16BE(2);
  if (buf.length < 20 + len) return null;
  const method = (t & 0x000f) | ((t & 0x00e0) >> 1) | ((t & 0x3e00) >> 2);
  const cls = t & 0x0110;
  const tid = buf.subarray(8, 20);
  const attrs = new Map();
  let o = 20;
  while (o + 4 <= 20 + len) {
    const at = buf.readUInt16BE(o), al = buf.readUInt16BE(o + 2);
    if (!attrs.has(at)) attrs.set(at, buf.subarray(o + 4, o + 4 + al));
    o += 4 + al + ((4 - (al % 4)) % 4);
  }
  return { method, cls, tid, attrs };
}

function xorAddr(val, tid) {
  const fam = val[1], port = val.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (fam === 1) {
    const a = val.readUInt32BE(4) ^ MAGIC;
    return { a: [a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255].join('.'), p: port, f: 'v4' };
  }
  const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), tid]);
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) b[i] = val[4 + i] ^ key[i];
  const groups = []; for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16));
  return { a: groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::'), p: port, f: 'v6' };
}

function xorAddrEncode(addr, port, tid) {
  const v6 = addr.includes(':');
  const out = Buffer.alloc(v6 ? 20 : 8);
  out[1] = v6 ? 2 : 1;
  out.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  if (!v6) {
    const n = addr.split('.').reduce((x, y) => (x << 8) + +y, 0) >>> 0;
    out.writeUInt32BE((n ^ MAGIC) >>> 0, 4);
  } else {
    const raw = ipv6Bytes(addr);
    const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), tid]);
    for (let i = 0; i < 16; i++) out[4 + i] = raw[i] ^ key[i];
  }
  return out;
}

function ipv6Bytes(a) {
  const [l, r] = a.split('::');
  const L = l ? l.split(':') : [], R = r !== undefined && r ? r.split(':') : [];
  const parts = r === undefined ? L : [...L, ...Array(8 - L.length - R.length).fill('0'), ...R];
  const b = Buffer.alloc(16);
  parts.forEach((p, i) => b.writeUInt16BE(parseInt(p || '0', 16), i * 2));
  return b;
}

const isStun = (b) => b.length >= 20 && (b[0] & 0xc0) === 0 && b.readUInt32BE(4) === MAGIC;
const isChannelData = (b) => b.length >= 4 && b[0] >= 0x40 && b[0] <= 0x7f;

// --------------------------------------------------------------------------- STUN binding
// The socket's 'message' handler must route STUN replies here (see Net._onPacket).
const pending = new Map();
function handleStun(buf) {
  const m = decode(buf);
  if (!m) return false;
  const p = pending.get(m.tid.toString('hex'));
  if (!p) return false;
  pending.delete(m.tid.toString('hex'));
  p(m);
  return true;
}

function transact(send, msg, tid, timeout = 1500, tries = 3) {
  return new Promise((res) => {
    let n = 0, done = false;
    const key = tid.toString('hex');
    const fire = () => {
      if (done) return;
      if (n++ >= tries) { done = true; pending.delete(key); return res(null); }
      send(msg);
      setTimeout(fire, timeout / tries);
    };
    pending.set(key, (m) => { done = true; res(m); });
    fire();
  });
}

async function stunBinding(sock, host, port) {
  const tid = crypto.randomBytes(12);
  const t0 = performance.now();
  const r = await transact((b) => sock.send(b, port, host), encode(M.BINDING, 0, tid, []), tid, 1200, 3);
  if (!r) return null;
  const v = r.attrs.get(A.MAPPED);
  return v ? { ...xorAddr(v, r.tid), rtt: performance.now() - t0 } : null;
}

// --------------------------------------------------------------------------- TURN client
class TurnClient extends EventEmitter {
  /**
   * @param {{ sock?: import('dgram').Socket, host: string, port: number, username: string, credential: string, tls?: boolean }} o
   */
  constructor(o) {
    super();
    this.o = o;
    this.channels = new Map();   // "addr|port" -> channel number
    this.byChannel = new Map();  // channel -> {a, p}
    this.perms = new Set();
    this.nextChannel = 0x4000;
    this.realm = null; this.nonce = null; this.key = null;
    this.relayed = null;
    this.timers = [];
    this.closed = false;
    if (o.tls) this._openTls();
  }

  // ---- transport
  _openTls() {
    this.tlsBuf = Buffer.alloc(0);
    this.ts = tls.connect({ host: this.o.host, port: this.o.port, servername: this.o.host, ALPNProtocols: [] });
    this.ts.setNoDelay(true);
    this.ready = new Promise((res, rej) => { this.ts.once('secureConnect', res); this.ts.once('error', rej); });
    this.ts.on('data', (d) => {
      this.tlsBuf = Buffer.concat([this.tlsBuf, d]);
      for (;;) {
        const b = this.tlsBuf;
        if (b.length < 4) break;
        let len;
        if (isChannelData(b)) len = 4 + b.readUInt16BE(2), len += (4 - (len % 4)) % 4;
        else len = 20 + b.readUInt16BE(2);
        if (b.length < len) break;
        const msg = b.subarray(0, len);
        this.tlsBuf = b.subarray(len);
        this.handle(Buffer.from(msg));
      }
    });
    this.ts.on('error', () => {});
    this.ts.on('close', () => { if (!this.closed) this.emit('closed'); });
  }

  _send(buf) {
    if (this.o.tls) { if (this.ts && !this.ts.destroyed) this.ts.write(buf); }
    else this.o.sock.send(buf, this.o.port, this.o.host);
  }

  isFromServer(r) { return !this.o.tls && r.port === this.o.port && (r.addr ?? r.address) === this.o.host; }

  async _request(method, attrs, auth = true) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tid = crypto.randomBytes(12);
      const all = [...attrs];
      if (auth && this.key) all.push([A.USERNAME, Buffer.from(this.o.username)], [A.REALM, Buffer.from(this.realm)], [A.NONCE, Buffer.from(this.nonce)]);
      let msg = encode(method, 0, tid, all);
      if (auth && this.key) msg = withIntegrity(msg, this.key);
      const r = await transact((b) => this._send(b), msg, tid, 2400, this.o.tls ? 1 : 3);
      if (!r) return null;
      if (r.cls === 0x0110) {
        const err = r.attrs.get(A.ERROR);
        const code = err ? err[2] * 100 + err[3] : 0;
        if ((code === 401 || code === 438) && attempt === 0) {
          this.realm = r.attrs.get(A.REALM)?.toString() || this.realm;
          this.nonce = r.attrs.get(A.NONCE)?.toString() || this.nonce;
          this.key = crypto.createHash('md5').update(`${this.o.username}:${this.realm}:${this.o.credential}`).digest();
          continue;
        }
        return { error: code };
      }
      return r;
    }
    return null;
  }

  async allocate() {
    if (this.o.tls) await this.ready;
    const transport = Buffer.from([17, 0, 0, 0]);
    const r = await this._request(M.ALLOCATE, [[A.TRANSPORT, transport], [A.LIFETIME, u32(600)]]);
    if (!r || r.error) throw new Error(`turn allocate failed${r?.error ? ` (${r.error})` : ''}`);
    this.relayed = xorAddr(r.attrs.get(A.RELAYED), r.tid);
    const mapped = r.attrs.get(A.MAPPED);
    this.mapped = mapped ? xorAddr(mapped, r.tid) : null;
    this.timers.push(setInterval(() => this._request(M.REFRESH, [[A.LIFETIME, u32(600)]]), 240000));
    this.timers.push(setInterval(() => this._refreshPerms(), 120000));
    return this.relayed;
  }

  async permit(addrs) {
    for (const a of addrs) {
      if (this.perms.has(a)) continue;
      if (await this._permitOne(a)) this.perms.add(a);
    }
    return true;
  }

  async _permitOne(addr) {
    const tid = crypto.randomBytes(12);
    const all = [[A.PEER, xorAddrEncode(addr, 0, tid)], [A.USERNAME, Buffer.from(this.o.username)], [A.REALM, Buffer.from(this.realm)], [A.NONCE, Buffer.from(this.nonce)]];
    const msg = withIntegrity(encode(M.PERMISSION, 0, tid, all), this.key);
    const r = await transact((b) => this._send(b), msg, tid, 2400, this.o.tls ? 1 : 3);
    return !!r && r.cls !== 0x0110;
  }

  _refreshPerms() { const list = [...this.perms]; this.perms.clear(); this.permit(list); for (const [k, ch] of this.channels) { const [a, p] = k.split('|'); this._bind(a, +p, ch); } }

  async channel(addr, port) {
    const k = `${addr}|${port}`;
    if (this.channels.has(k)) return this.channels.get(k);
    const ch = this.nextChannel++;
    const ok = await this._bind(addr, port, ch);
    if (!ok) return null;
    this.channels.set(k, ch); this.byChannel.set(ch, { a: addr, p: port });
    return ch;
  }

  async _bind(addr, port, ch) {
    const tid = crypto.randomBytes(12);
    const all = [[A.CHANNEL, Buffer.from([ch >> 8, ch & 255, 0, 0])], [A.PEER, xorAddrEncode(addr, port, tid)], [A.USERNAME, Buffer.from(this.o.username)], [A.REALM, Buffer.from(this.realm)], [A.NONCE, Buffer.from(this.nonce)]];
    const msg = withIntegrity(encode(M.CHANNEL, 0, tid, all), this.key);
    const r = await transact((b) => this._send(b), msg, tid, 2400, this.o.tls ? 1 : 3);
    return !!r && r.cls !== 0x0110;
  }

  // send to a peer through our allocation
  sendTo(addr, port, data) {
    const ch = this.channels.get(`${addr}|${port}`);
    if (ch) {
      let len = 4 + data.length;
      const pad = this.o.tls ? (4 - (len % 4)) % 4 : 0;
      const b = Buffer.alloc(len + pad);
      b.writeUInt16BE(ch, 0); b.writeUInt16BE(data.length, 2); data.copy(b, 4);
      return this._send(b);
    }
    const tid = crypto.randomBytes(12);
    this._send(encode(M.SEND, 0x0010, tid, [[A.PEER, xorAddrEncode(addr, port, tid)], [A.DATA, data]]));
  }

  // incoming from the TURN server; returns true if consumed
  handle(buf) {
    if (isChannelData(buf)) {
      const ch = buf.readUInt16BE(0), len = buf.readUInt16BE(2);
      const peer = this.byChannel.get(ch);
      if (peer) this.emit('data', buf.subarray(4, 4 + len), peer);
      return true;
    }
    const m = decode(buf);
    if (!m) return false;
    if (m.method === M.DATA && m.cls === 0x0010) {
      const peer = m.attrs.get(A.PEER), data = m.attrs.get(A.DATA);
      if (peer && data) this.emit('data', Buffer.from(data), xorAddr(peer, m.tid));
      return true;
    }
    return handleStun(buf);
  }

  close() {
    this.closed = true;
    this.timers.forEach(clearInterval);
    if (this.key) this._request(M.REFRESH, [[A.LIFETIME, u32(0)]]).catch(() => {});
    setTimeout(() => { try { this.ts?.destroy(); } catch {} }, 300);
  }
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }

module.exports = { stunBinding, TurnClient, handleStun, isStun, isChannelData, decode, encode, xorAddr, xorAddrEncode };
