'use strict';
// Asynchronous, non-blocking BEP-15 UDP / HTTP tracker pre-flight scraper.
// Strictly visual only: never called in the stream resolution / playback critical path.
const dgram = require('dgram');
const crypto = require('crypto');

const FALLBACK_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
];
const CONN_MAGIC_HI = 0x00000417;
const CONN_MAGIC_LO = 0x27101980;
const SCRAPE_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 8 * 60 * 1000;
const CACHE_MAX = 400;

const cache = new Map();

function normalizeInfoHash(h) {
  const s = String(h || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(s) ? s : null;
}

function encodeUdpConnect(txId) {
  const buf = Buffer.allocUnsafe(16);
  buf.writeUInt32BE(CONN_MAGIC_HI, 0);
  buf.writeUInt32BE(CONN_MAGIC_LO, 4);
  buf.writeUInt32BE(0, 8); // action = connect
  buf.writeUInt32BE(txId >>> 0, 12);
  return buf;
}

function decodeUdpConnect(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const action = buf.readUInt32BE(0);
  const txId = buf.readUInt32BE(4);
  if (action !== 0) return null;
  return { txId, connId: buf.subarray(8, 16) };
}

function encodeUdpScrape(connId, txId, hexHashes) {
  const hashes = hexHashes.map((h) => Buffer.from(h, 'hex')).filter((b) => b.length === 20).slice(0, 74);
  const buf = Buffer.allocUnsafe(16 + hashes.length * 20);
  connId.copy(buf, 0, 0, 8);
  buf.writeUInt32BE(2, 8); // action = scrape
  buf.writeUInt32BE(txId >>> 0, 12);
  hashes.forEach((h, i) => h.copy(buf, 16 + i * 20));
  return { buf, count: hashes.length };
}

function decodeUdpScrape(buf, hexHashes) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const action = buf.readUInt32BE(0);
  const txId = buf.readUInt32BE(4);
  if (action !== 2) return null;
  const out = {};
  const n = Math.min(hexHashes.length, Math.floor((buf.length - 8) / 12));
  for (let i = 0; i < n; i++) {
    const off = 8 + i * 12;
    out[hexHashes[i]] = {
      seeders: buf.readUInt32BE(off),
      completed: buf.readUInt32BE(off + 4),
      leechers: buf.readUInt32BE(off + 8),
    };
  }
  return { txId, out };
}

function classifyHealth({ seeders = null, leechers = 0, instant = false, cached = false, hasMeta = false, corroborated = false, verified = false }) {
  if (instant || cached) return { level: 'green', seeders: seeders ?? 0, leechers, verified: true, hasMeta: true, instant: !!instant, cached: !!cached };
  if (typeof seeders === 'number' && Number.isFinite(seeders)) {
    if (seeders >= 15 && hasMeta) return { level: 'green', seeders, leechers, verified, hasMeta };
    if (seeders >= 1 || corroborated) return { level: 'yellow', seeders, leechers, verified, hasMeta };
    return { level: 'red', seeders: 0, leechers, verified, hasMeta };
  }
  if (corroborated) return { level: 'yellow', seeders: null, leechers, verified: false, hasMeta };
  return { level: 'yellow', seeders: null, leechers, verified: false, hasMeta };
}

function scrapeUdpTracker(trackerUrl, hexHashes, timeoutMs = SCRAPE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(trackerUrl); } catch { return resolve(null); }
    if (parsed.protocol !== 'udp:' || !parsed.hostname) return resolve(null);
    const port = Number(parsed.port) || 80;
    const hashes = [...new Set(hexHashes.map(normalizeInfoHash).filter(Boolean))].slice(0, 74);
    if (!hashes.length) return resolve({});

    const sock = dgram.createSocket('udp4');
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.close(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const txConnect = crypto.randomInt(1, 0x7fffffff);
    const txScrape = crypto.randomInt(1, 0x7fffffff);
    let stage = 'connect';

    sock.on('error', () => done(null));
    sock.on('message', (msg) => {
      if (stage === 'connect') {
        const c = decodeUdpConnect(msg);
        if (!c || c.txId !== txConnect) return;
        stage = 'scrape';
        const { buf } = encodeUdpScrape(c.connId, txScrape, hashes);
        sock.send(buf, port, parsed.hostname);
      } else if (stage === 'scrape') {
        const sc = decodeUdpScrape(msg, hashes);
        if (!sc || sc.txId !== txScrape) return;
        done(sc.out);
      }
    });

    try { sock.send(encodeUdpConnect(txConnect), port, parsed.hostname); }
    catch { done(null); }
  });
}

function extractUdpTrackers(sources) {
  const set = new Set();
  for (const src of Array.isArray(sources) ? sources : []) {
    const s = String(src || '').replace(/^tracker:/i, '').trim();
    if (/^udp:\/\/[a-z0-9.-]+(:\d+)?/i.test(s)) set.add(s);
  }
  for (const fb of FALLBACK_TRACKERS) set.add(fb);
  return [...set].slice(0, 4);
}

async function checkBatch(items = [], opts = {}) {
  const now = Date.now();
  const out = {};
  const toScrape = new Map(); // trackerUrl -> Set<hex>
  const metaMap = new Map();
  const list = Array.isArray(items) ? items.slice(0, 25) : [];

  for (const raw of list) {
    const ih = normalizeInfoHash(raw?.infoHash);
    if (!ih) continue;
    metaMap.set(ih, {
      hasMeta: !!(raw?.hasMeta),
      corroborated: !!(raw?.corroborated),
      fallbackSeeders: typeof raw?.fallbackSeeders === 'number' ? raw.fallbackSeeders : (typeof raw?.seeders === 'number' ? raw.seeders : null),
      instant: !!(raw?.instant),
      cached: !!(raw?.cached),
    });
    if (raw?.instant || raw?.cached) {
      out[ih] = classifyHealth({ instant: !!raw.instant, cached: !!raw.cached, hasMeta: true });
      continue;
    }
    const cached = cache.get(ih);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      out[ih] = cached.val;
      continue;
    }
    const trks = opts.disableNetwork ? [] : extractUdpTrackers(raw?.sources);
    for (const tr of trks) {
      if (!toScrape.has(tr)) toScrape.set(tr, new Set());
      toScrape.get(tr).add(ih);
    }
  }

  const scrapeFn = opts.scrapeUdpFn || scrapeUdpTracker;
  const trackerResults = await Promise.all(
    [...toScrape.entries()].slice(0, 4).map(([tr, set]) => scrapeFn(tr, [...set]).catch(() => null))
  );

  for (const [ih, meta] of metaMap.entries()) {
    if (out[ih]) continue;
    let bestSeeders = null;
    let bestLeechers = 0;
    let verified = false;
    for (const res of trackerResults) {
      const hit = res?.[ih];
      if (!hit) continue;
      verified = true;
      if (bestSeeders == null || hit.seeders > bestSeeders) {
        bestSeeders = hit.seeders;
        bestLeechers = hit.leechers || 0;
      }
    }
    const val = classifyHealth({
      seeders: verified ? bestSeeders : meta.fallbackSeeders,
      leechers: bestLeechers,
      hasMeta: meta.hasMeta,
      corroborated: meta.corroborated,
      verified,
    });
    if (verified) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(ih, { at: now, val });
    }
    out[ih] = val;
  }

  return out;
}

module.exports = {
  normalizeInfoHash,
  encodeUdpConnect,
  decodeUdpConnect,
  encodeUdpScrape,
  decodeUdpScrape,
  classifyHealth,
  extractUdpTrackers,
  checkBatch,
};
