'use strict';
// Majlis rendezvous + relay server.
//
//  - Signaling over UDP (v4 + v6) with a WebSocket fallback for networks that block UDP.
//  - Maps player numbers to the address they last checked in from. It never sees video:
//    peers do their own key exchange and every media packet is encrypted end to end.
//  - Relay: forwards opaque datagrams between two peers when a direct path can't be made
//    (CGNAT on 4G/5G routers) or is slower than going through a nearby relay.
//
// Run several copies (Jeddah / Riyadh / Dammam ...) with the same RELAY_SECRET and list
// them in RELAYS so clients can pick the one closest to both players.

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { deriveId, verifyMsg, isId, isCode } = require('./ident');

const env = process.env;
const CFG = {
  mode: env.MODE || 'all',                      // all | signal | relay
  signalPort: +(env.SIGNAL_PORT || 7700),
  relayPort: +(env.RELAY_PORT || 7701),
  httpPort: +(env.HTTP_PORT || 7780),
  publicUrl: env.PUBLIC_URL || '',              // e.g. https://majlis.example.com (used for invite links)
  secret: env.RELAY_SECRET || '',
  dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
  name: env.RELAY_NAME || 'local',
  label: env.RELAY_LABEL || 'Local',
  relays: env.RELAYS ? JSON.parse(env.RELAYS) : null,
  relayHost: env.RELAY_HOST || '',              // public host clients use to reach this relay
  maxSessionMbps: +(env.MAX_SESSION_MBPS || 120),
  maxSessions: +(env.MAX_SESSIONS || 400),
  accessKey: env.ACCESS_KEY || '',
};

if (!CFG.secret) {
  CFG.secret = crypto.randomBytes(32).toString('hex');
  console.warn('[majlis] RELAY_SECRET not set, using a random one (fine for a single box, not for a relay fleet)');
}
fs.mkdirSync(CFG.dataDir, { recursive: true });

const now = () => Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- rate limits
class Buckets {
  constructor(perMin, burst) { this.rate = perMin / 60000; this.burst = burst; this.m = new Map(); }
  take(key, n = 1) {
    const t = now();
    let b = this.m.get(key);
    if (!b) { b = { v: this.burst, t }; this.m.set(key, b); }
    b.v = Math.min(this.burst, b.v + (t - b.t) * this.rate); b.t = t;
    if (b.v < n) return false;
    b.v -= n; return true;
  }
  sweep() { const t = now(); for (const [k, b] of this.m) if (t - b.t > 600000) this.m.delete(k); }
}
const limits = {
  hello: new Buckets(120, 30),
  knock: new Buckets(20, 8),
  knockTarget: new Buckets(30, 10),
  code: new Buckets(10, 4),
  presence: new Buckets(40, 10),
  ping: new Buckets(600, 60),
  utest: new Buckets(4, 2),
};
setInterval(() => Object.values(limits).forEach((l) => l.sweep()), 60000).unref();

// ---------------------------------------------------------------- relay list
function relayList() {
  if (CFG.relays) return CFG.relays;
  if (CFG.mode === 'signal') return [];
  return [{ name: CFG.name, label: CFG.label, host: CFG.relayHost || null, udp: CFG.relayPort, ws: CFG.publicUrl ? CFG.publicUrl.replace(/^http/, 'ws') + '/relay' : null }];
}

function relayToken(sid, exp) {
  return crypto.createHmac('sha256', CFG.secret).update(`${sid}|${exp}`).digest();
}

// ================================================================= SIGNALING
const bindings = new Map(); // id -> pk (first come, first served)
const bindFile = path.join(CFG.dataDir, 'bindings.json');
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(bindFile, 'utf8')))) bindings.set(k, v); } catch {}
const handles = new Map(); // handle -> { id, pk, nick }
const handleFile = path.join(CFG.dataDir, 'handles.json');
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(handleFile, 'utf8')))) handles.set(k, v); } catch {}
let bindDirty = false;
setInterval(() => {
  if (!bindDirty) return; bindDirty = false;
  fs.writeFile(bindFile + '.tmp', JSON.stringify(Object.fromEntries(bindings)), (e) => { if (!e) fs.rename(bindFile + '.tmp', bindFile, () => {}); });
  fs.writeFile(handleFile + '.tmp', JSON.stringify(Object.fromEntries(handles)), (e) => { if (!e) fs.rename(handleFile + '.tmp', handleFile, () => {}); });
}, 5000).unref();

const peers = new Map();  // id -> { pk, nick, handle, status, busy, allow:Set, eps:{v4,v6,ws}, seen }
const codes = new Map();  // code -> { id, exp }

function epKey(ep) { return ep.kind === 'ws' ? 'ws' : ep.fam; }

function sendTo(ep, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  if (ep.kind === 'ws') { if (ep.ws.readyState === 1) ep.ws.send(buf.toString()); }
  else ep.sock.send(buf, ep.port, ep.addr);
}

function sendPeer(id, obj) {
  const p = peers.get(id);
  if (!p) return false;
  const t = now(); let sent = false;
  for (const ep of Object.values(p.eps)) {
    if (ep && t - ep.seen < 75000) { sendTo(ep, obj); sent = true; }
  }
  return sent;
}

function srflxOf(id) {
  const p = peers.get(id); if (!p) return [];
  const out = [];
  for (const ep of Object.values(p.eps)) if (ep && ep.kind === 'udp' && now() - ep.seen < 75000) out.push({ a: ep.addr, p: ep.port, f: ep.fam, k: 'srflx' });
  return out;
}

function online(id) {
  const p = peers.get(id); if (!p) return false;
  return Object.values(p.eps).some((ep) => ep && now() - ep.seen < 75000);
}

function handleSignal(msg, ep) {
  if (!msg || typeof msg.t !== 'string') return;
  const ip = ep.kind === 'ws' ? ep.ip : ep.addr;
  const fresh = typeof msg.ts === 'number' && Math.abs(now() - msg.ts) < 120000;

  switch (msg.t) {
    case 'hello': {
      if (!limits.hello.take(ip)) return;
      if (CFG.accessKey && msg.key !== CFG.accessKey) return sendTo(ep, { t: 'error', e: 'access' });
      if (!isId(msg.id) || !fresh) return sendTo(ep, { t: 'error', e: 'bad' });
      const pk = Buffer.from(String(msg.pk || ''), 'base64');
      if (pk.length !== 32 || deriveId(pk, msg.salt | 0) !== msg.id) return sendTo(ep, { t: 'error', e: 'bad_id' });
      const bound = bindings.get(msg.id);
      if (bound && bound !== msg.pk) return sendTo(ep, { t: 'taken', id: msg.id });
      if (!verifyMsg(msg, msg.pk)) return sendTo(ep, { t: 'error', e: 'bad_sig' });
      if (!bound) { bindings.set(msg.id, msg.pk); bindDirty = true; }
      let p = peers.get(msg.id);
      if (!p) { p = { pk: msg.pk, eps: {} }; peers.set(msg.id, p); }
      p.nick = String(msg.nick || '').slice(0, 32);
      const hRaw = String(msg.handle || '').trim().replace(/^@+/, '').toLowerCase();
      if (/^[a-z0-9_]{3,24}$/.test(hRaw) && !/^\d+$/.test(hRaw)) {
        const hOwner = handles.get(hRaw);
        if (!hOwner || hOwner.id === msg.id) {
          for (const [hk, hv] of handles) if (hv.id === msg.id && hk !== hRaw) handles.delete(hk);
          handles.set(hRaw, { id: msg.id, pk: msg.pk, nick: p.nick });
          p.handle = hRaw;
          bindDirty = true;
        }
      }
      p.status = msg.status && typeof msg.status === 'object' ? { watching: msg.status.watching || null, inParty: msg.status.inParty || null } : null;
      p.busy = !!msg.busy;
      p.allow = new Set((Array.isArray(msg.allow) ? msg.allow : []).filter(isId).slice(0, 500));
      p.seen = now();
      ep.seen = now();
      p.eps[epKey(ep)] = ep;
      return sendTo(ep, { t: 'hi', ip: ep.kind === 'ws' ? ep.ip : ep.addr, port: ep.port || 0, fam: ep.fam || 'ws', relays: relayList(), now: now() });
    }

    case 'presence': {
      if (!limits.presence.take(ip)) return;
      const me = peers.get(msg.id);
      if (!me || !fresh || !verifyMsg(msg, me.pk) || !Array.isArray(msg.ids)) return;
      const on = {}, meta = {};
      for (const id of msg.ids.slice(0, 200)) {
        const p = peers.get(id);
        // Only friends the other side listed may see their status.
        if (p && p.allow && p.allow.has(msg.id) && online(id)) {
          on[id] = p.busy ? 'busy' : 'online';
          meta[id] = { status: p.status || null, handle: p.handle || '', nick: p.nick || '' };
        }
      }
      return sendTo(ep, { t: 'presence', on, meta });
    }

    case 'handle_lookup': {
      if (!limits.presence.take(ip)) return;
      const me = peers.get(msg.id);
      if (!me || !fresh || !verifyMsg(msg, me.pk)) return;
      const h = String(msg.handle || '').trim().replace(/^@+/, '').toLowerCase();
      const rec = /^[a-z0-9_]{3,24}$/.test(h) ? handles.get(h) : null;
      if (rec && isId(rec.id)) return sendTo(ep, { t: 'handle_res', reqId: msg.reqId, handle: h, id: rec.id, pk: rec.pk, nick: rec.nick || rec.id });
      return sendTo(ep, { t: 'handle_res', reqId: msg.reqId, handle: h, notFound: true });
    }

    case 'social': {
      if (!limits.hello.take(ip)) return;
      const me = peers.get(msg.from);
      if (!me || !fresh || !verifyMsg(msg, me.pk) || !isId(msg.to)) return;
      sendPeer(msg.to, { t: 'social', m: msg });
      return;
    }

    case 'code': {
      if (!limits.code.take(ip)) return;
      const me = peers.get(msg.id);
      if (!me || !fresh || !verifyMsg(msg, me.pk)) return;
      for (const [c, v] of codes) if (v.id === msg.id) codes.delete(c);
      if (msg.revoke) return sendTo(ep, { t: 'code', code: null });
      let code;
      do { code = String(crypto.randomInt(100000, 1000000)); } while (codes.has(code));
      const exp = now() + 60 * 60 * 1000;
      codes.set(code, { id: msg.id, exp });
      return sendTo(ep, { t: 'code', code, exp });
    }

    case 'knock': {
      if (!limits.knock.take(ip)) return sendTo(ep, { t: 'knock_fail', sid: msg.sid, reason: 'rate' });
      const me = peers.get(msg.from);
      if (!me || !fresh || !verifyMsg(msg, me.pk) || typeof msg.sid !== 'string' || !/^[0-9a-f]{32}$/.test(msg.sid)) return sendTo(ep, { t: 'knock_fail', sid: msg.sid, reason: 'bad' });
      let target = msg.to;
      if (isCode(target)) {
        const c = codes.get(target);
        target = c && c.exp > now() ? c.id : null;
      }
      if (!target || !isId(target) || !limits.knockTarget.take(target) || !online(target)) {
        return sendTo(ep, { t: 'knock_fail', sid: msg.sid, reason: 'offline' });
      }
      const exp = Math.floor(now() / 1000) + 6 * 3600;
      const relay = { exp, token: relayToken(msg.sid, exp).toString('base64') };
      sendPeer(target, { t: 'knock', m: msg, srflx: srflxOf(msg.from), relay, hostId: target });
      return sendTo(ep, { t: 'knock_ok', sid: msg.sid, hostId: target, hostPk: peers.get(target).pk, relay });
    }

    case 'answer': {
      const me = peers.get(msg.from);
      if (!me || !fresh || !verifyMsg(msg, me.pk) || !isId(msg.to)) return;
      sendPeer(msg.to, { t: 'answer', sid: msg.sid, m: msg, srflx: srflxOf(msg.from) });
      return sendTo(ep, { t: 'answer_ok', sid: msg.sid });
    }

    case 'bye': {
      const me = peers.get(msg.id);
      if (me && verifyMsg(msg, me.pk)) peers.delete(msg.id);
      return;
    }
  }
}

setInterval(() => {
  const t = now();
  for (const [id, p] of peers) {
    for (const k of Object.keys(p.eps)) if (t - p.eps[k].seen > 120000) delete p.eps[k];
    if (!Object.keys(p.eps).length) peers.delete(id);
  }
  for (const [c, v] of codes) if (v.exp < t) codes.delete(c);
}, 30000).unref();

// ================================================================= RELAY
// Packets starting with 'R' (0x52) are relay control. Anything else from a bound address
// is forwarded untouched to the other side of the session.
const R = 0x52;
const sessions = new Map(); // sidHex -> { s:[ep0, ep1], bucket, seen }
const addrMap = new Map();  // "addr|port" -> { sid, role }
const utests = new Map();   // key -> { bytes, count, first, last }

function relaySend(ep, buf) {
  if (ep.kind === 'ws') { if (ep.ws.readyState === 1) ep.ws.send(buf); }
  else ep.sock.send(buf, ep.port, ep.addr);
}

function relayPacket(buf, ep, akey) {
  if (buf.length >= 2 && buf[0] === R) {
    const op = buf[1];
    if (op === 0x50 /* P */ && buf.length <= 64) { // ping
      if (!limits.ping.take(akey)) return;
      const out = Buffer.from(buf); out[1] = 0x51; return relaySend(ep, out);
    }
    if (op === 0x42 /* B */ && buf.length === 2 + 16 + 1 + 4 + 32) { // bind
      const sid = buf.subarray(2, 18).toString('hex');
      const role = buf[18] & 1;
      const exp = buf.readUInt32BE(19);
      const tok = buf.subarray(23, 55);
      if (exp < now() / 1000 || !crypto.timingSafeEqual(tok, relayToken(sid, exp))) return;
      let s = sessions.get(sid);
      if (!s) {
        if (sessions.size >= CFG.maxSessions) return;
        s = { s: [null, null], tokens: CFG.maxSessionMbps * 125000, t: now(), seen: now() };
        sessions.set(sid, s);
      }
      const old = s.s[role];
      if (old && old.kind !== 'ws') addrMap.delete(`${old.addr}|${old.port}`);
      s.s[role] = ep; s.seen = now();
      if (ep.kind === 'ws') ep.bound = { sid, role };
      else addrMap.set(akey, { sid, role });
      const ok = Buffer.alloc(19); ok[0] = R; ok[1] = 0x4b; buf.copy(ok, 2, 2, 18); ok[18] = role;
      return relaySend(ep, ok);
    }
    if (op === 0x54 /* T */ && buf.length >= 10) { // upload test traffic
      const key = `${akey.split('|')[0]}|${buf.readUInt32BE(2)}`;
      let u = utests.get(key);
      if (!u) {
        if (!limits.utest.take(akey.split('|')[0])) return;
        u = { bytes: 0, count: 0, first: now(), last: now() }; utests.set(key, u);
      }
      if (u.bytes > 40e6) return; // cap a single test at ~40 MB
      u.bytes += buf.length; u.count++; u.last = now();
      return;
    }
    if (op === 0x53 /* S */ && buf.length >= 6) { // upload test result
      const key = `${akey.split('|')[0]}|${buf.readUInt32BE(2)}`;
      const u = utests.get(key) || { bytes: 0, count: 0, first: 0, last: 0 };
      const out = Buffer.alloc(18); out[0] = R; out[1] = 0x55;
      buf.copy(out, 2, 2, 6); out.writeUInt32BE(u.count, 6); out.writeUInt32BE(u.bytes, 10); out.writeUInt32BE(Math.max(1, u.last - u.first), 14);
      return relaySend(ep, out);
    }
    return;
  }
  const b = ep.kind === 'ws' ? ep.bound : addrMap.get(akey);
  if (!b) return;
  const s = sessions.get(b.sid);
  if (!s) return;
  const t = now();
  s.tokens = Math.min(CFG.maxSessionMbps * 125000, s.tokens + (t - s.t) * CFG.maxSessionMbps * 125);
  s.t = t; s.seen = t;
  if (s.tokens < buf.length) return;
  s.tokens -= buf.length;
  const other = s.s[b.role ^ 1];
  if (other) relaySend(other, buf);
}

setInterval(() => {
  const t = now();
  for (const [sid, s] of sessions) if (t - s.seen > 45000) {
    for (const ep of s.s) if (ep && ep.kind !== 'ws') addrMap.delete(`${ep.addr}|${ep.port}`);
    sessions.delete(sid);
  }
  for (const [k, u] of utests) if (t - u.last > 60000) utests.delete(k);
}, 15000).unref();

// ================================================================= sockets
function udp(fam, port, onMsg) {
  const sock = dgram.createSocket({ type: fam === 'v6' ? 'udp6' : 'udp4', ipv6Only: fam === 'v6' });
  sock.on('message', (buf, rinfo) => onMsg(sock, fam, buf, rinfo));
  sock.on('error', (e) => log(`[udp ${fam}:${port}]`, e.message));
  try { sock.bind(port); } catch (e) { log('bind failed', fam, port, e.message); }
  return sock;
}

if (CFG.mode !== 'relay') {
  const onSig = (sock, fam, buf, rinfo) => {
    if (buf.length > 8192 || buf[0] !== 0x7b) return;
    let msg; try { msg = JSON.parse(buf); } catch { return; }
    handleSignal(msg, { kind: 'udp', sock, fam, addr: rinfo.address, port: rinfo.port, seen: now() });
  };
  udp('v4', CFG.signalPort, onSig);
  udp('v6', CFG.signalPort, onSig);
}
if (CFG.mode !== 'signal') {
  const onRelay = (sock, fam, buf, rinfo) => {
    const akey = `${rinfo.address}|${rinfo.port}`;
    const m = addrMap.get(akey);
    const ep = m ? sessions.get(m.sid)?.s[m.role] : null;
    relayPacket(buf, ep && ep.addr === rinfo.address && ep.port === rinfo.port ? ep : { kind: 'udp', sock, fam, addr: rinfo.address, port: rinfo.port }, akey);
  };
  udp('v4', CFG.relayPort, onRelay);
  udp('v6', CFG.relayPort, onRelay);
}

// ================================================================= HTTP / WS
const invitePage = fs.readFileSync(path.join(__dirname, 'invite.html'), 'utf8');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const m = u.pathname.match(/^\/(j|c)\/(\d{6}|\d{9})$/);
  if (m) {
    const target = m[2];
    const deep = `majlis://${m[1] === 'c' ? 'code' : 'join'}/${target}`;
    const pretty = target.length === 9 ? `${target.slice(0, 3)} ${target.slice(3, 6)} ${target.slice(6)}` : `${target.slice(0, 3)} ${target.slice(3)}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(invitePage.replaceAll('{{DEEP}}', deep).replaceAll('{{NUM}}', pretty).replaceAll('{{KIND}}', m[1]));
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const kind = req.url.startsWith('/relay') ? 'relay' : 'signal';
  const ep = { kind: 'ws', ws, ip, seen: now() };
  const akey = `ws:${ip}:${crypto.randomBytes(4).toString('hex')}`;
  ws.on('message', (data, isBinary) => {
    ep.seen = now();
    if (kind === 'signal') {
      if (isBinary || data.length > 8192) return;
      let msg; try { msg = JSON.parse(data); } catch { return; }
      return handleSignal(msg, ep);
    }
    if (CFG.mode !== 'signal' && isBinary) relayPacket(Buffer.from(data), ep, akey);
  });
  ws.on('error', () => {});
});
server.listen(CFG.httpPort, () => log(`majlis server: mode=${CFG.mode} signal=udp:${CFG.signalPort} relay=udp:${CFG.relayPort} http=${CFG.httpPort}`));

module.exports = { CFG };
