// Majlis on Cloudflare: signaling in a Durable Object (WebSocket), relaying through
// Cloudflare TURN. Same message format as server/index.js, so the app speaks to either.
import { DurableObject } from 'cloudflare:workers';
import invitePage from './invite.html';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const now = () => Date.now();
const isId = (s) => typeof s === 'string' && /^[1-9]\d{8}$/.test(s);
const isCode = (s) => typeof s === 'string' && /^\d{6}$/.test(s);
const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/signal') {
      if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
    }
    if (url.pathname === '/info') return json({ colo: req.cf?.colo || null, country: req.cf?.country || null, ip: req.headers.get('cf-connecting-ip'), asn: req.cf?.asn || null, isp: req.cf?.asOrganization || null });
    if (url.pathname === '/up' && req.method === 'POST') {
      if (env.ACCESS_KEY && url.searchParams.get('k') !== env.ACCESS_KEY) return new Response('forbidden', { status: 403 });
      // upload test: count what arrives
      const t0 = Date.now(); let bytes = 0;
      const reader = req.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 60e6) break; }
      return json({ bytes, ms: Date.now() - t0, colo: req.cf?.colo });
    }
    if (url.pathname === '/health') return new Response('ok');
    const m = url.pathname.match(/^\/(j|c)\/(\d{6}|\d{9})$/);
    if (m) {
      const t = m[2];
      const pretty = t.length === 9 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : `${t.slice(0, 3)} ${t.slice(3)}`;
      const html = invitePage.replaceAll('{{DEEP}}', `majlis://${m[1] === 'c' ? 'code' : 'join'}/${t}`).replaceAll('{{NUM}}', pretty).replaceAll('{{KIND}}', m[1]);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('Majlis', { status: 404 });
  },
};

// ------------------------------------------------------------------------------ crypto
async function deriveId(pk, salt) {
  const s = enc.encode(String(salt | 0));
  const buf = new Uint8Array(12 + pk.length + s.length);
  buf.set(enc.encode('majlis-id-v1')); buf.set(pk, 12); buf.set(s, 12 + pk.length);
  const h = new DataView(await crypto.subtle.digest('SHA-256', buf));
  return (h.getBigUint64(0) % 900000000n + 100000000n).toString();
}

async function verify(msg, pkB64) {
  try {
    if (typeof msg.sig !== 'string' || typeof pkB64 !== 'string') return false;
    const pk = b64(pkB64);
    if (pk.length !== 32) return false;
    const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, b64(msg.sig), enc.encode(JSON.stringify({ ...msg, sig: undefined })));
  } catch { return false; }
}

// ------------------------------------------------------------------------------ hub
export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.buckets = new Map();
    this.allowCache = new Map();
  }

  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ip: req.headers.get('cf-connecting-ip') || '', colo: req.cf?.colo || null });
    return new Response(null, { status: 101, webSocket: client });
  }

  take(key, perMin, burst) {
    const t = now();
    let b = this.buckets.get(key);
    if (!b) { b = { v: burst, t }; this.buckets.set(key, b); }
    b.v = Math.min(burst, b.v + ((t - b.t) * perMin) / 60000); b.t = t;
    if (b.v < 1) return false;
    b.v -= 1; return true;
  }

  socketsOf(id) { return this.ctx.getWebSockets().filter((w) => w.deserializeAttachment()?.id === id); }
  online(id) { return this.socketsOf(id).length > 0; }
  peer(id) { return this.socketsOf(id)[0]?.deserializeAttachment() || null; }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch {} }
  sendPeer(id, o) { const list = this.socketsOf(id); list.forEach((w) => this.send(w, o)); return list.length > 0; }

  async allowOf(id) {
    if (this.allowCache.has(id)) return this.allowCache.get(id);
    const a = new Set((await this.ctx.storage.get(`allow:${id}`)) || []);
    this.allowCache.set(id, a);
    return a;
  }

  async turnCreds() {
    if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_API_TOKEN) return null;
    if (this.cred && this.cred.exp > now() + 3600e3) return this.cred.v;
    const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials`;
    const opts = { method: 'POST', headers: { authorization: `Bearer ${this.env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 6 * 3600 }) };
    let r = await fetch(`${base}/generate-ice-servers`, opts);
    if (!r.ok) r = await fetch(`${base}/generate`, opts);
    if (!r.ok) return null;
    const d = await r.json();
    const list = Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers];
    const t = list.find((x) => x && x.username) || {};
    const urls = list.flatMap((x) => (Array.isArray(x.urls) ? x.urls : [x.urls])).filter(Boolean);
    const v = { username: t.username, credential: t.credential, urls };
    this.cred = { v, exp: now() + 6 * 3600e3 };
    return v;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 8192) return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const ip = att.ip || '';
    const fresh = typeof msg.ts === 'number' && Math.abs(now() - msg.ts) < 120000;

    switch (msg.t) {
      case 'hello': {
        if (!this.take(`h:${ip}`, 60, 20)) return;
        // private server: only builds that carry the key may register
        if (this.env.ACCESS_KEY && msg.key !== this.env.ACCESS_KEY) { this.send(ws, { t: 'error', e: 'access' }); try { ws.close(4003, 'access'); } catch {} return; }
        if (!isId(msg.id) || !fresh) return this.send(ws, { t: 'error', e: 'bad' });
        let pk; try { pk = b64(String(msg.pk || '')); } catch { return; }
        if (pk.length !== 32 || (await deriveId(pk, msg.salt)) !== msg.id) return this.send(ws, { t: 'error', e: 'bad_id' });
        const bound = await this.ctx.storage.get(`bind:${msg.id}`);
        if (bound && bound !== msg.pk) return this.send(ws, { t: 'taken', id: msg.id });
        if (!(await verify(msg, msg.pk))) return this.send(ws, { t: 'error', e: 'bad_sig' });
        if (!bound) await this.ctx.storage.put(`bind:${msg.id}`, msg.pk);
        const allow = (Array.isArray(msg.allow) ? msg.allow : []).filter(isId).slice(0, 500);
        if (JSON.stringify([...(await this.allowOf(msg.id))]) !== JSON.stringify(allow)) {
          await this.ctx.storage.put(`allow:${msg.id}`, allow);
          this.allowCache.set(msg.id, new Set(allow));
        }
        ws.serializeAttachment({ ip, colo: att.colo, id: msg.id, pk: msg.pk, nick: String(msg.nick || '').slice(0, 32), busy: !!msg.busy });
        return this.send(ws, { t: 'hi', ip, fam: 'ws', colo: att.colo, relays: [{ name: 'cf', label: 'Cloudflare', turn: true }], stun: 'stun.cloudflare.com:3478', now: now() });
      }

      case 'presence': {
        if (!this.take(`p:${ip}`, 40, 10) || !att.id || att.id !== msg.id || !fresh || !(await verify(msg, att.pk)) || !Array.isArray(msg.ids)) return;
        const on = {};
        for (const id of msg.ids.slice(0, 200)) {
          const p = this.peer(id);
          if (p && (await this.allowOf(id)).has(msg.id)) on[id] = p.busy ? 'busy' : 'online';
        }
        return this.send(ws, { t: 'presence', on });
      }

      case 'code': {
        if (!this.take(`c:${ip}`, 10, 4) || !att.id || att.id !== msg.id || !fresh || !(await verify(msg, att.pk))) return;
        const old = await this.ctx.storage.get(`codeof:${msg.id}`);
        if (old) await this.ctx.storage.delete([`code:${old}`, `codeof:${msg.id}`]);
        if (msg.revoke) return this.send(ws, { t: 'code', code: null });
        let code;
        do { code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while (await this.ctx.storage.get(`code:${code}`));
        const exp = now() + 3600e3;
        await this.ctx.storage.put({ [`code:${code}`]: { id: msg.id, exp }, [`codeof:${msg.id}`]: code });
        return this.send(ws, { t: 'code', code, exp });
      }

      case 'knock': {
        if (!this.take(`k:${ip}`, 20, 8)) return this.send(ws, { t: 'knock_fail', sid: msg.sid, reason: 'rate' });
        if (!att.id || att.id !== msg.from || !fresh || !(await verify(msg, att.pk)) || !/^[0-9a-f]{32}$/.test(String(msg.sid))) return this.send(ws, { t: 'knock_fail', sid: msg.sid, reason: 'bad' });
        let target = msg.to;
        if (isCode(target)) { const c = await this.ctx.storage.get(`code:${target}`); target = c && c.exp > now() ? c.id : null; }
        if (!target || !isId(target) || !this.take(`kt:${target}`, 30, 10) || !this.online(target)) return this.send(ws, { t: 'knock_fail', sid: msg.sid, reason: 'offline' });
        const turn = await this.turnCreds();
        this.sendPeer(target, { t: 'knock', m: msg, srflx: [], turn, hostId: target });
        return this.send(ws, { t: 'knock_ok', sid: msg.sid, hostId: target, hostPk: this.peer(target).pk, turn });
      }

      case 'answer': case 'cand': {
        if (!att.id || att.id !== msg.from || !fresh || !isId(msg.to) || !(await verify(msg, att.pk))) return;
        this.sendPeer(msg.to, { t: msg.t, sid: msg.sid, m: msg, srflx: [] });
        if (msg.t === 'answer') this.send(ws, { t: 'answer_ok', sid: msg.sid });
        return;
      }

      case 'bye': {
        if (att.id && att.id === msg.id && (await verify(msg, att.pk))) { ws.serializeAttachment({ ip, colo: att.colo }); ws.close(1000, 'bye'); }
        return;
      }
    }
  }

  webSocketClose(ws, code) { try { ws.close(code, 'closing'); } catch {} }
  webSocketError() {}
}
