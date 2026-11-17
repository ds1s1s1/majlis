'use strict';
// Every network read of the media center goes through here (main process: no CORS, one cache
// for all pages). Per-host concurrency limit, in-flight dedupe (two pages asking for the same
// catalog share one request), a memory LRU, a disk cache for long-lived answers, and a short
// negative cache so a dead addon isn't hammered on every scroll.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PER_HOST = 6, TIMEOUT_MS = 15000, MEM_MAX = 3000, NEG_TTL = 120000;
const mem = new Map();          // url -> { t, ttl, body } (insertion order = LRU order)
const inflight = new Map();     // url -> Promise
const hosts = new Map();        // host -> { active, queue: [resolve] }
let diskDir = null;

function init(dir) { diskDir = dir; try { fs.mkdirSync(dir, { recursive: true }); } catch {} }

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; }
}

function key(url) { return crypto.createHash('sha1').update(url).digest('hex'); }

function memGet(url) {
  const e = mem.get(url);
  if (!e) return null;
  if (Date.now() - e.t > e.ttl) { mem.delete(url); return null; }
  mem.delete(url); mem.set(url, e); // most recently used goes last
  return e;
}
function memSet(url, e) {
  mem.set(url, e);
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

function diskGet(url) {
  if (!diskDir) return null;
  try {
    const e = JSON.parse(fs.readFileSync(path.join(diskDir, key(url) + '.json'), 'utf8'));
    return e.url === url && Date.now() - e.t <= e.ttl ? e : null;
  } catch { return null; }
}
function diskSet(url, e) {
  if (!diskDir) return;
  const f = path.join(diskDir, key(url) + '.json');
  // write then rename: a crash mid-write never leaves a half file behind
  fs.writeFile(f + '.tmp', JSON.stringify({ url, ...e }), (err) => { if (!err) fs.rename(f + '.tmp', f, () => {}); });
}

async function slot(host) {
  const h = hosts.get(host) || { active: 0, queue: [] };
  hosts.set(host, h);
  if (h.active >= PER_HOST) await new Promise((r) => h.queue.push(r));
  h.active++;
  return () => { h.active--; const n = h.queue.shift(); if (n) n(); };
}

// GET a JSON document. `ttl` ms (0: no caching). Answers older than an hour are also kept on
// disk so a restart (or a flaky addon) still shows the page straight away.
// `cacheKey` lets a POST be cached too (GraphQL APIs): it names the answer instead of the URL
async function json(url, { ttl = 0, headers = {}, timeout = TIMEOUT_MS, method = 'GET', body, cacheKey } = {}) {
  const ck = cacheKey || url;
  const cacheable = ttl > 0 && (method === 'GET' || !!cacheKey);
  if (cacheable) {
    const hit = memGet(ck) || (ttl >= 3600000 ? diskGet(ck) : null);
    if (hit) { if (hit.err) throw new HttpError(hit.err, url); if (!mem.has(ck)) memSet(ck, hit); return hit.body; }
    if (inflight.has(ck)) return inflight.get(ck);
  }
  const run = (async () => {
    const release = await slot(new URL(url).host);
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { method, headers: { 'user-agent': 'Majlis', accept: 'application/json', ...headers }, body, signal: ac.signal });
      if (!r.ok) {
        if (cacheable && r.status !== 429) memSet(ck, { t: Date.now(), ttl: NEG_TTL, err: r.status });
        throw new HttpError(r.status, url);
      }
      const data = await r.json();
      if (cacheable) { const e = { t: Date.now(), ttl, body: data }; memSet(ck, e); if (ttl >= 3600000) diskSet(ck, e); }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`timeout: ${url}`);
      throw e;
    } finally { clearTimeout(to); release(); }
  })();
  if (cacheable) { inflight.set(ck, run); run.finally(() => inflight.delete(ck)).catch(() => {}); }
  return run;
}

// drop everything cached for urls starting with `prefix` (an addon removed, a key changed)
function forget(prefix) { for (const u of [...mem.keys()]) if (u.startsWith(prefix)) mem.delete(u); }

module.exports = { init, json, forget, HttpError };
