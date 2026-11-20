'use strict';
// Every network read of the media center goes through here (main process: no CORS, one cache
// for all pages). Per-host concurrency limit, in-flight dedupe (two pages asking for the same
// catalog share one request), a memory LRU, a disk cache for long-lived answers, and a short
// negative cache so a dead addon isn't hammered on every scroll.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const httpMod = require('http');
const httpsMod = require('https');
const zlib = require('zlib');

const PER_HOST = 6, TIMEOUT_MS = 15000, MEM_MAX = 3000, NEG_TTL = 120000, SWR_MAX = 7 * 86400000;
const mem = new Map();          // url -> { t, ttl, body, err? } (insertion order = LRU order)
const inflight = new Map();     // url -> Promise
const hosts = new Map();        // host -> { active, queue, agentHttp, agentHttps, tokens, tokenAt }
// Per-host token buckets: TVMaze allows ~20 req / 10 s; 18 / 10 s keeps a safe margin
const RATE_LIMITS = { 'api.tvmaze.com': { rate: 18 / 10000, burst: 18 } };
let diskDir = null;

function init(dir) { diskDir = dir; try { fs.mkdirSync(dir, { recursive: true }); } catch {} }
function setRateLimit(host, lim) { if (lim) RATE_LIMITS[host] = lim; else delete RATE_LIMITS[host]; hosts.delete(host); }

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; }
}

function key(url) { return crypto.createHash('sha1').update(url).digest('hex'); }

function hostEntry(host) {
  let h = hosts.get(host);
  if (!h) {
    const opts = { keepAlive: true, keepAliveMsecs: 30000, maxSockets: PER_HOST, maxFreeSockets: PER_HOST, scheduling: 'lifo' };
    h = { active: 0, queue: [], agentHttp: new httpMod.Agent(opts), agentHttps: new httpsMod.Agent(opts), tokens: undefined, tokenAt: 0 };
    hosts.set(host, h);
  }
  return h;
}

function agentFor(urlOrHost) {
  const u = urlOrHost instanceof URL ? urlOrHost
    : (typeof urlOrHost === 'string' && urlOrHost.includes('://') ? new URL(urlOrHost) : { protocol: 'https:', host: String(urlOrHost) });
  const h = hostEntry(u.host);
  return u.protocol === 'http:' ? h.agentHttp : h.agentHttps;
}

function memGet(url) {
  const e = mem.get(url);
  if (!e) return null;
  const age = Date.now() - e.t;
  if (e.err ? age > e.ttl : age > e.ttl + SWR_MAX) { mem.delete(url); return null; }
  mem.delete(url); mem.set(url, e); // most recently used goes last
  return { ...e, stale: !e.err && age > e.ttl };
}
function memSet(url, e) {
  mem.delete(url);
  mem.set(url, e);
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

function diskGet(url) {
  if (!diskDir) return null;
  try {
    const fp = path.join(diskDir, key(url) + '.json');
    const e = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (e.url !== url) return null;
    const now = new Date();
    fs.utimes(fp, now, now, () => {});
    const age = Date.now() - e.t;
    return age <= e.ttl + SWR_MAX ? { ...e, stale: age > e.ttl } : null;
  } catch { return null; }
}
function diskSet(url, e) {
  if (!diskDir) return;
  const f = path.join(diskDir, key(url) + '.json');
  // write then rename: a crash mid-write never leaves a half file behind
  fs.writeFile(f + '.tmp', JSON.stringify({ url, t: e.t, ttl: e.ttl, body: e.body }), (err) => { if (!err) fs.rename(f + '.tmp', f, () => {}); });
}

async function slot(host) {
  const h = hostEntry(host);
  if (h.active >= PER_HOST) await new Promise((r) => h.queue.push(r));
  h.active++;
  const lim = RATE_LIMITS[host];
  if (lim) {
    const now = Date.now();
    h.tokens = Math.min(lim.burst, (h.tokens ?? lim.burst) + (now - (h.tokenAt || now)) * lim.rate);
    h.tokenAt = now;
    if (h.tokens >= 1) h.tokens -= 1;
    else {
      const wait = Math.ceil((1 - h.tokens) / lim.rate);
      h.tokens -= 1;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return () => { h.active--; const n = h.queue.shift(); if (n) n(); };
}

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::') return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/i.test(h)) return true;
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32ToHex(b32) {
  const clean = String(b32 || '').toUpperCase().replace(/=+$/, '');
  if (clean.length !== 32) return null;
  let bits = 0, val = 0, out = '';
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out += ((val >> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return out.length === 40 ? out : null;
}

function validatePlayUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 4096) return { ok: false, error: 'invalid_url' };
  if (/^magnet:\?/i.test(s)) {
    const qs = new URLSearchParams(s.slice(7));
    const xts = qs.getAll('xt');
    let infoHash = null;
    for (const xt of xts) {
      const m40 = /^urn:btih:([0-9a-f]{40})$/i.exec(xt);
      if (m40) { infoHash = m40[1].toLowerCase(); break; }
      const m32 = /^urn:btih:([a-z2-7]{32})$/i.exec(xt);
      if (m32) {
        const hex = base32ToHex(m32[1]);
        if (hex) { infoHash = hex; break; }
      }
    }
    if (!infoHash) return { ok: false, error: 'invalid_magnet' };
    const dn = qs.get('dn') ? String(qs.get('dn')).trim().slice(0, 200) : '';
    const sources = qs.getAll('tr').filter(Boolean).slice(0, 16).map((t) => `tracker:${t}`);
    return { ok: true, kind: 'magnet', infoHash, sources, name: dn || `Magnet ${infoHash.slice(0, 8)}`, raw: s };
  }
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'unsupported_protocol' };
  if (isPrivateHost(u.hostname)) return { ok: false, error: 'private_host_blocked' };
  let baseName = u.hostname;
  try {
    const p = decodeURIComponent(path.basename(u.pathname) || '');
    if (p) baseName = p;
  } catch {}
  return { ok: true, kind: 'http', url: u.toString(), name: baseName.slice(0, 200), raw: s };
}

function requestOnce(urlStr, { method, headers, body, timeout }, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error(`unsupported protocol: ${u.protocol}`));
    const mod = u.protocol === 'http:' ? httpMod : httpsMod;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(to); fn(v); } };
    const reqHeaders = {
      'user-agent': 'Majlis',
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'keep-alive',
      ...headers,
    };
    const payload = body != null && typeof body !== 'string' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
    if (payload != null && reqHeaders['content-length'] == null) reqHeaders['content-length'] = Buffer.byteLength(payload);
    const req = mod.request(u, { method, agent: agentFor(u), headers: reqHeaders }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects < 5) {
        res.resume();
        const next = new URL(res.headers.location, u);
        if (!['http:', 'https:'].includes(next.protocol)) return done(reject, new Error('blocked redirect protocol'));
        if (!isPrivateHost(u.hostname) && isPrivateHost(next.hostname)) return done(reject, new Error('blocked redirect to private host'));
        const nextMethod = code === 307 || code === 308 ? method : 'GET';
        return done(resolve, requestOnce(next.toString(), { method: nextMethod, headers, body: nextMethod === 'GET' ? undefined : body, timeout }, redirects + 1));
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
          : enc === 'deflate' ? res.pipe(zlib.createInflate())
            : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', (err) => done(reject, err));
      stream.on('end', () => done(resolve, { status: code, ok: code >= 200 && code < 300, text: Buffer.concat(chunks).toString('utf8') }));
    });
    const to = setTimeout(() => { req.destroy(new Error(`timeout: ${urlStr}`)); }, timeout);
    req.on('error', (err) => done(reject, err));
    if (payload != null) req.write(payload);
    req.end();
  });
}

function fetchRun(url, ck, { ttl, headers, timeout, method, body, cacheable }) {
  const run = (async () => {
    const u = new URL(url);
    const release = await slot(u.host);
    try {
      const r = await requestOnce(url, { method, headers, body, timeout });
      if (!r.ok) {
        if (cacheable && r.status !== 429) memSet(ck, { t: Date.now(), ttl: NEG_TTL, err: r.status });
        throw new HttpError(r.status, url);
      }
      const data = JSON.parse(r.text);
      if (cacheable) { const e = { t: Date.now(), ttl, body: data }; memSet(ck, e); if (ttl >= 3600000) diskSet(ck, e); }
      return data;
    } finally { release(); }
  })();
  if (cacheable) { inflight.set(ck, run); run.finally(() => inflight.delete(ck)).catch(() => {}); }
  return run;
}

// GET a JSON document. `ttl` ms (0: no caching). Answers older than an hour are also kept on
// disk so a restart (or a flaky addon) still shows the page straight away. Stale hits return
// immediately and refresh in the background (stale-while-revalidate).
// `cacheKey` lets a POST be cached too (GraphQL APIs): it names the answer instead of the URL
async function json(url, { ttl = 0, headers = {}, timeout = TIMEOUT_MS, method = 'GET', body, cacheKey } = {}) {
  const ck = cacheKey || url;
  const cacheable = ttl > 0 && (method === 'GET' || !!cacheKey);
  if (cacheable) {
    const hit = memGet(ck) || (ttl >= 3600000 ? diskGet(ck) : null);
    if (hit) {
      if (hit.err) throw new HttpError(hit.err, url);
      if (!mem.has(ck)) memSet(ck, { t: hit.t, ttl: hit.ttl, body: hit.body });
      if (hit.stale && !inflight.has(ck)) fetchRun(url, ck, { ttl, headers, timeout, method, body, cacheable }).catch(() => {});
      return hit.body;
    }
    if (inflight.has(ck)) return inflight.get(ck);
  }
  return fetchRun(url, ck, { ttl, headers, timeout, method, body, cacheable });
}

// drop everything cached for urls starting with `prefix` (an addon removed, a key changed)
function forget(prefix) { for (const u of [...mem.keys()]) if (u.startsWith(prefix)) mem.delete(u); }
function closeAgents() { for (const h of hosts.values()) { try { h.agentHttp.destroy(); } catch {} try { h.agentHttps.destroy(); } catch {} } hosts.clear(); }

module.exports = { init, json, forget, agentFor, setRateLimit, closeAgents, isPrivateHost, validatePlayUrl, HttpError };
