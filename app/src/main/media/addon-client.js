'use strict';
// Stremio addon protocol, ported rule for rule from stremio-core (src/types/addon/*,
// src/addon_transport/http_transport/*) so any addon behaves here exactly as in Stremio:
//  - URLs: transportUrl.replace('/manifest.json', path) (query string kept), every path part
//    encoded like encodeURIComponent (so "tt1:1:2" -> "tt1%3A1%3A2");
//  - extra: a newly set prop goes in FRONT of the others (skip=100&genre=Action);
//  - routing: full-form resources don't inherit the manifest's types; empty idPrefixes = all;
//  - legacy addons (/stremio/v1): JSON-RPC in base64 at /q.json?b=..., keys sorted like serde;
//  - responses: exactly one known key, invalid items dropped, an empty list is "no content".
const http = require('./http');

const TTL = { manifest: 3600000, catalog: 1800000, meta: 3600000, stream: 120000, subtitles: 1800000, addon_catalog: 3600000 };
const RESPONSE_KEYS = ['metas', 'metasDetailed', 'meta', 'streams', 'subtitles', 'addons'];
const SKIP_PROP = { name: 'skip', isRequired: false, options: [], optionsLimit: 1 };
const enc = encodeURIComponent; // leaves A-Z a-z 0-9 - _ . ! ~ * ' ( ): stremio-core's URI_COMPONENT_ENCODE_SET

class AddonError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }

// Permanent hard block for adult / NSFW / pornographic / 18+ addons across store & manual install.
const ADULT_EXPLICIT_RE = /(?:^|[^a-z0-9])(nsfw|porn|porno|pornography|pornhub|xvideos|xnxx|xhamster|redtube|youporn|spankbang|eporner|brazzers|chaturbate|stripchat|onlyfans|cam4|bongacams|xxx|hentai|hanime|nhentai|doujin|ecchi|erotica|erotic|jav|milf|fetish|bdsm|rule34|r34|camgirl|livecam|playboy|penthouse|hustler|dirtyflix|lustcinema|sex\s*cams?|uncensored\s*18|18\+|21\+)(?:$|[^a-z0-9])/i;
const ADULT_SLUG_RE = /(?:^|[^a-z0-9])(adult|adults|nsfw|porn|porno|xxx|hentai|hanime|erotica|erotic|jav|18\+|21\+|sex|nude|nudity|xvideos|pornhub|xnxx|xhamster|redtube|youporn|spankbang|eporner|brazzers|chaturbate|onlyfans)(?:$|[^a-z0-9])/i;
const ADULT_DESC_RE = /(?<!young\s)\b(?:adults?\s*(?:only|content|videos?|movies?|streams?|channels?|entertainment|addons?|catalogs?|18\+?))\b/i;

function isAdultCategory(cat) {
  const slug = String(typeof cat === 'string' ? cat : (cat?.slug || cat?.id || '')).trim();
  const name = String(typeof cat === 'string' ? cat : (cat?.name || '')).trim();
  return ADULT_SLUG_RE.test(slug) || ADULT_SLUG_RE.test(name);
}

function isAdultAddon(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const m = entry.manifest && typeof entry.manifest === 'object' ? entry.manifest : entry;
  if (entry.nsfw === true || entry.adult === true) return true;
  if (m.nsfw === true || m.adult === true || m.behaviorHints?.adult === true) return true;
  const cats = Array.isArray(entry.categories) ? entry.categories : [];
  if (cats.some(isAdultCategory)) return true;
  const tags = Array.isArray(entry.tags) ? entry.tags : (Array.isArray(m.tags) ? m.tags : []);
  if (tags.some((t) => ADULT_SLUG_RE.test(String(t || '')))) return true;
  const types = Array.isArray(m.types) ? m.types : [];
  if (types.some((t) => ADULT_SLUG_RE.test(String(t || '')))) return true;
  const idFields = [entry.slug, entry.manifestUrl, entry.page, entry.url, m.id, m.transportUrl].filter(Boolean).join(' ');
  if (ADULT_SLUG_RE.test(idFields)) return true;
  const textFields = [
    entry.name, m.name, entry.description, m.description,
    ...(Array.isArray(m.catalogs) ? m.catalogs.flatMap((c) => [c?.id, c?.name, c?.type]) : []),
  ].filter(Boolean).join(' ');
  if (ADULT_EXPLICIT_RE.test(textFields) || ADULT_DESC_RE.test(textFields)) return true;
  if (/\badult\b/i.test(String(m.name || entry.name || '')) && !/\byoung\s+adult\b/i.test(String(m.name || entry.name || ''))) return true;
  return false;
}

function transportKind(url) {
  const u = String(url).split('?')[0].replace(/\/+$/, '');
  if (u.endsWith('/manifest.json')) return 'http';
  if (u.endsWith('/stremio/v1')) return 'legacy';
  return null;
}

// "stremio://host/x/manifest.json" is how addon links are shared; it's https underneath
function normalizeUrl(url) { return String(url || '').trim().replace(/^stremio:\/\//i, 'https://'); }

// ---------------------------------------------------------------- manifest
function uniqueBy(list, keyOf) { const seen = new Set(); return list.filter((x) => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true; }); }

function normCatalog(c) {
  let extra;
  if (Array.isArray(c.extra)) {
    extra = uniqueBy(c.extra.filter((p) => p && typeof p.name === 'string'), (p) => p.name).map((p) => (p.name === 'skip' ? { ...SKIP_PROP }
      : { name: p.name, isRequired: !!p.isRequired, options: Array.isArray(p.options) ? p.options.filter((o) => typeof o === 'string') : [], optionsLimit: Number.isInteger(p.optionsLimit) && p.optionsLimit >= 0 ? p.optionsLimit : 1 }));
  } else {
    // legacy short form: only names listed in extraSupported exist; extraRequired marks some
    const req = uniqueBy((c.extraRequired || []).filter((x) => typeof x === 'string'), (x) => x);
    extra = uniqueBy((c.extraSupported || []).filter((x) => typeof x === 'string'), (x) => x).map((name) => ({ name, isRequired: req.includes(name), options: [], optionsLimit: 1 }));
  }
  return { type: String(c.type), id: String(c.id), name: typeof c.name === 'string' ? c.name : null, extra };
}

function normManifest(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.name !== 'string' || !Array.isArray(m.types) || !Array.isArray(m.resources)) throw new AddonError('bad-manifest', 'not a Stremio addon manifest');
  const resources = m.resources.map((r) => (typeof r === 'string' ? { name: r, short: true }
    : r && typeof r.name === 'string' ? { name: r.name, short: false, types: Array.isArray(r.types) ? r.types : null, idPrefixes: Array.isArray(r.idPrefixes) ? r.idPrefixes : null } : null)).filter(Boolean);
  const cats = (list) => uniqueBy((Array.isArray(list) ? list : []).filter((c) => c && c.type != null && c.id != null).map(normCatalog), (c) => `${c.id}\u0000${c.type}`);
  return {
    ...m, resources, types: m.types.filter((t) => typeof t === 'string'),
    idPrefixes: Array.isArray(m.idPrefixes) ? m.idPrefixes : null,
    catalogs: cats(m.catalogs), addonCatalogs: cats(m.addonCatalogs),
    behaviorHints: m.behaviorHints && typeof m.behaviorHints === 'object' ? m.behaviorHints : {},
  };
}

// stremio-core legacy_manifest.rs
function fromLegacyManifest(resp) {
  const m = resp?.manifest;
  if (!m || typeof m.id !== 'string' || !Array.isArray(m.methods) || !Array.isArray(m.types)) throw new AddonError('bad-manifest', 'not a legacy addon manifest');
  const catalogs = m.methods.includes('meta.find')
    ? (Array.isArray(m.sorts) ? m.sorts.flatMap((s) => (s.types || m.types).map((t) => ({ type: t, id: s.prop, name: s.name || null, extra: [] })))
      : m.types.map((t) => ({ type: t, id: 'top', name: null, extra: [] })))
    : [];
  const props = m.idProperty == null ? null : [].concat(m.idProperty);
  const idPrefixes = props && props.map((p) => (p === 'imdb_id' ? 'tt' : p === 'yt_id' ? 'UC' : `${p}:`));
  const resources = [['meta.get', 'meta'], ['stream.find', 'stream'], ['subtitles.find', 'subtitles']].filter(([k]) => m.methods.includes(k)).map(([, n]) => n);
  return normManifest({ id: m.id, name: m.name, description: m.description, logo: m.logo, background: m.background, version: m.version, types: m.types, resources, catalogs, idPrefixes });
}

// ---------------------------------------------------------------- routing (manifest.rs)
function isExtraSupported(catalog, extra) {
  return extra.every(([k]) => catalog.extra.some((p) => p.name === k)) && catalog.extra.filter((p) => p.isRequired).every((p) => extra.some(([k]) => k === p.name));
}

function isResourceSupported(m, { resource, type, id, extra = [] }) {
  if (resource === 'catalog' || resource === 'addon_catalog') {
    const list = resource === 'catalog' ? m.catalogs : m.addonCatalogs;
    return list.some((c) => c.type === type && c.id === id && isExtraSupported(c, extra));
  }
  const r = m.resources.find((x) => x.name === resource);
  if (!r) return false;
  const types = r.short ? m.types : r.types;          // a full-form resource never inherits
  const prefixes = r.short ? m.idPrefixes : r.idPrefixes;
  return !!types && types.includes(type) && (!prefixes || !prefixes.length || prefixes.some((p) => id.startsWith(p)));
}

// ---------------------------------------------------------------- extra (request.rs extend_one)
function extendExtra(extra, prop, value) {
  const same = extra.filter(([k]) => k === prop.name), other = extra.filter(([k]) => k !== prop.name);
  let mine;
  if (value != null && prop.optionsLimit === 1) mine = [[prop.name, String(value)]];
  else if (value != null && prop.optionsLimit > 1) mine = same.some(([, v]) => v === String(value)) ? same.filter(([, v]) => v !== String(value)) : [[prop.name, String(value)], ...same].slice(0, prop.optionsLimit);
  else if (value == null && !prop.isRequired) mine = [];
  else if (prop.optionsLimit === 0) mine = [];
  else mine = same;
  return [...mine, ...other];
}

// ---------------------------------------------------------------- URLs
function resourceUrl(transportUrl, { resource, type, id, extra = [] }) {
  const p = extra.length
    ? `/${enc(resource)}/${enc(type)}/${enc(id)}/${extra.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}.json`
    : `/${enc(resource)}/${enc(type)}/${enc(id)}.json`;
  return transportUrl.split('/manifest.json').join(p); // every occurrence, query string kept
}

// serde_json without preserve_order: object keys come out sorted
function sortedJson(v) {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function queryFromId(id) {
  const parts = id.split(':');
  if (id.startsWith('tt')) return parts.length === 3 ? { imdb_id: parts[0], season: parseInt(parts[1], 10) || 1, episode: parseInt(parts[2], 10) || 1 } : { imdb_id: parts[0] };
  if (id.startsWith('UC')) return parts.length === 2 ? { yt_id: parts[0], video_id: parts[1] } : { yt_id: parts[0] };
  if (parts.length === 3) return { [parts[0]]: parts[1], video_id: parts[2] };
  if (parts.length === 2) return { [parts[0]]: parts[1] };
  return null;
}

const LEGACY_MANIFEST_PARAM = Buffer.from('{"params":[],"method":"meta","id":1,"jsonrpc":"2.0"}').toString('base64');

function legacyUrl(transportUrl, { resource, type, id, extra = [] }) {
  const first = (k) => extra.find(([n]) => n === k)?.[1];
  let params, method;
  if (resource === 'catalog') {
    const genre = first('genre');
    method = 'meta.find';
    params = { query: genre ? { type, genre } : { type }, limit: 100, sort: id !== 'top' ? { [id]: -1, popularity: -1 } : null, skip: parseInt(first('skip') || '0', 10) || 0 };
  } else if (resource === 'meta') { method = 'meta.get'; params = { query: queryFromId(id) }; }
  else if (resource === 'stream') {
    const q = queryFromId(id);
    if (!q) throw new AddonError('unsupported', 'legacy: stream request without a valid id');
    method = 'stream.find'; params = { query: { ...q, type } };
  } else if (resource === 'subtitles') {
    const q = { itemHash: id.replace(/:/g, ' ') };
    if (first('videoHash')) q.videoHash = first('videoHash');
    const size = parseInt(first('videoSize'), 10); if (Number.isFinite(size)) q.videoSize = size;
    if (first('filename')) q.filename = first('filename');
    method = 'subtitles.find'; params = { query: q };
  } else throw new AddonError('unsupported', `legacy: ${resource} not supported`);
  // standard (not URL-safe) base64, on purpose: that's what the original addons expect
  return `${transportUrl.replace(/\/+$/, '')}/q.json?b=${Buffer.from(sortedJson({ params: [null, params], method, id: 1, jsonrpc: '2.0' })).toString('base64')}`;
}

// ---------------------------------------------------------------- responses (response.rs)
const HEX40 = /^[0-9a-fA-F]{40}$/;
function validStream(s) {
  if (!s || typeof s !== 'object') return false;
  return typeof s.url === 'string' || typeof s.ytId === 'string' || (typeof s.infoHash === 'string' && HEX40.test(s.infoHash))
    || ['rarUrls', 'zipUrls', '7zipUrls', 'tgzUrls', 'tarUrls'].some((k) => Array.isArray(s[k])) || typeof s.nzbUrl === 'string'
    || typeof s.playerFrameUrl === 'string' || ['externalUrl', 'androidTvUrl', 'tizenUrl', 'webosUrl'].some((k) => typeof s[k] === 'string');
}
const VALID = {
  metas: (x) => x && typeof x.id === 'string' && typeof x.type === 'string',
  metasDetailed: (x) => x && typeof x.id === 'string' && typeof x.type === 'string',
  streams: validStream,
  subtitles: (x) => x && typeof x.url === 'string' && typeof x.lang === 'string',
  addons: (x) => x && typeof x.transportUrl === 'string' && x.manifest,
};

function parseResponse(body) {
  if (!body || typeof body !== 'object') throw new AddonError('bad-response', 'not an object');
  const keys = RESPONSE_KEYS.filter((k) => k in body);
  if (keys.length !== 1) throw new AddonError('bad-response', `expected exactly one of ${RESPONSE_KEYS.join('/')}`);
  const k = keys[0];
  if (k === 'meta') {
    if (!body.meta || typeof body.meta.id !== 'string') throw new AddonError('bad-response', 'meta without id');
    const m = body.meta;
    if (Array.isArray(m.videos)) m.videos = uniqueBy(m.videos.filter((v) => v && typeof v.id === 'string'), (v) => v.id);
    return { meta: m };
  }
  const list = (body[k] == null ? [] : Array.isArray(body[k]) ? body[k] : []).filter(VALID[k]);
  if (!list.length) throw new AddonError('empty', 'no content');
  return { [k]: list };
}

// ---------------------------------------------------------------- client
// The installed addons (in the user's order), their manifests, and requests routed like Stremio.
class AddonClient {
  constructor() { this.manifests = new Map(); this.latencies = new Map(); this.health = new Map(); this.healthMeta = new Map(); }

  static isLocal(url) { return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(String(url || '')); }

  isDead(url) {
    const h = this.health.get(normalizeUrl(url));
    return !!h && h.deadUntil > Date.now();
  }

  recordSuccess(url, ms) {
    url = normalizeUrl(url);
    this.health.delete(url);
    this.healthMeta.set(url, { lastCheckedAt: Date.now(), lastError: null });
    this.recordLatency(url, ms);
  }

  recordFailure(url, err) {
    url = normalizeUrl(url);
    this.healthMeta.set(url, { lastCheckedAt: Date.now(), lastError: String(err?.message || err || 'error').slice(0, 120) });
    const prev = this.health.get(url) || { fails: 0, deadUntil: 0 };
    const status = err?.status || 0;
    const isTransient = !status || status >= 500 || err?.name === 'AbortError' || /timeout|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(err?.message || '');
    if (!isTransient) return;
    const fails = prev.fails + 1;
    // Dead localhost servers (e.g. closed local Stremio on 127.0.0.1:11470) trip immediately for 15 min
    const cooldown = AddonClient.isLocal(url) ? 15 * 60000 : (fails >= 2 ? 5 * 60000 : 0);
    this.health.set(url, { fails, deadUntil: cooldown ? Date.now() + cooldown : 0 });
  }

  resetHealth(url) {
    if (url) {
      const u = normalizeUrl(url);
      this.health.delete(u);
      this.healthMeta.delete(u);
    } else {
      this.health.clear();
      this.healthMeta.clear();
    }
  }

  healthSnapshot(url) {
    const u = normalizeUrl(url);
    const list = this.latencies.get(u) || [];
    const avgMs = list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
    const p90Ms = this.p90(u);
    const dead = this.isDead(u);
    const meta = this.healthMeta.get(u) || { lastCheckedAt: null, lastError: null };
    const status = dead ? 'down' : ((p90Ms != null && p90Ms >= 2000) || (avgMs != null && avgMs >= 2000)) ? 'slow' : 'up';
    return {
      url: u,
      status,
      dead,
      avgMs,
      p90Ms,
      lastCheckedAt: meta.lastCheckedAt,
      lastError: meta.lastError,
    };
  }

  async pingAll(urls = []) {
    const clean = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u.trim());
    await Promise.allSettled(clean.map((u) => this.manifest(u, { force: true, timeout: 4500 })));
    return clean.map((u) => this.healthSnapshot(u));
  }

  recordLatency(url, ms) {
    url = normalizeUrl(url);
    const list = this.latencies.get(url) || [];
    list.push(Math.max(1, Math.round(ms)));
    if (list.length > 20) list.shift();
    this.latencies.set(url, list);
  }

  p90(url) {
    const list = this.latencies.get(normalizeUrl(url));
    if (!list?.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  }

  // adaptive timeout per addon family: localhost 1200ms, streams up to 10s, catalogs 5.5s
  timeoutFor(url, resource = null) {
    if (AddonClient.isLocal(url)) return 1200;
    const p = this.p90(url);
    const maxCap = resource === 'stream' ? 10000 : resource === 'catalog' ? 5500 : 8500;
    return p == null ? Math.min(6500, maxCap) : Math.max(2000, Math.min(maxCap, Math.round(2 * p)));
  }

  async manifest(url, opts = {}) {
    url = normalizeUrl(url);
    const kind = transportKind(url);
    if (!kind) throw new AddonError('bad-url', 'an addon link ends with /manifest.json');
    if (!opts.force && this.manifests.has(url)) return this.manifests.get(url);
    if (!opts.force && this.isDead(url)) throw new AddonError('dead', 'addon temporarily offline');
    const t0 = Date.now(), timeout = opts.timeout || this.timeoutFor(url, 'manifest');
    try {
      const m = kind === 'legacy'
        ? fromLegacyManifest((await http.json(`${url.replace(/\/+$/, '')}/q.json?b=${LEGACY_MANIFEST_PARAM}`, { ttl: opts.force ? 0 : TTL.manifest, timeout })).result)
        : normManifest(await http.json(url, { ttl: opts.force ? 0 : TTL.manifest, timeout }));
      this.recordSuccess(url, Date.now() - t0);
      m.transportUrl = url;
      this.manifests.set(url, m);
      return m;
    } catch (err) {
      this.recordFailure(url, err);
      throw err;
    }
  }

  // a manifest the user is about to install: refused when it can't work unconfigured or is adult/NSFW
  async check(url) {
    this.resetHealth(url);
    const m = await this.manifest(url, { force: true });
    if (isAdultAddon({ manifestUrl: url, manifest: m })) throw new AddonError('adult-blocked', 'Adult / NSFW addons are not permitted in Majlis');
    if (m.behaviorHints.configurationRequired) throw new AddonError('needs-config', 'this addon must be configured on its own page first');
    return m;
  }

  async request(url, path, opts = {}) {
    url = normalizeUrl(url);
    if (!opts.force && this.isDead(url)) throw new AddonError('dead', 'addon temporarily offline');
    const kind = transportKind(url);
    const u = kind === 'legacy' ? legacyUrl(url, path) : resourceUrl(url, path);
    const t0 = Date.now();
    const ttlDefault = TTL[path.resource] ?? 300000;
    try {
      const body = await http.json(u, { ttl: opts.force ? 0 : ttlDefault, timeout: opts.timeout || this.timeoutFor(url, path.resource) });
      this.recordSuccess(url, Date.now() - t0);
      const parsed = parseResponse(kind === 'legacy' ? legacyResult(path.resource, body) : body);
      if (Number.isFinite(body?.cacheMaxAge)) parsed.cacheMaxAge = Math.max(0, Number(body.cacheMaxAge));
      if (Number.isFinite(body?.staleRevalidate)) parsed.staleRevalidate = Math.max(0, Number(body.staleRevalidate));
      if (Number.isFinite(body?.staleError)) parsed.staleError = Math.max(0, Number(body.staleError));
      return parsed;
    } catch (err) {
      if (err?.kind !== 'empty') this.recordFailure(url, err);
      throw err;
    }
  }

  // every installed addon that serves `path`, all at once; [{ url, manifest, addonRank, result | error }]
  async all(urls, path, onEach, { maxWaitMs = 0 } = {}) {
    const ms = await Promise.all(urls.map((u) => (this.isDead(u) ? Promise.resolve(null) : this.manifest(u).then((m) => m, () => null))));
    const jobs = urls.map((u, i) => (ms[i] && isResourceSupported(ms[i], path)
      ? this.request(u, path).then(
        (result) => { const x = { url: u, manifest: ms[i], addonRank: i, result }; onEach?.(x); return x; },
        (error) => { const x = { url: u, manifest: ms[i], addonRank: i, error }; onEach?.(x); return x; },
      )
      : null)).filter(Boolean);
    if (!maxWaitMs || !jobs.length) return Promise.all(jobs);
    const settled = [];
    jobs.forEach((p) => p.then((x) => settled.push(x)));
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, maxWaitMs))]);
    return settled;
  }

  // resolves with the first batch as soon as at least one addon returns content (plus a short grace
  // window), OR when `collectMs > 0` waits a full collection window (only short-circuiting early if
  // 100% of enabled stream addons have returned), while slower addons keep streaming via `onEach`
  async progressive(urls, path, { onEach, graceMs = 60, collectMs = 0, maxWaitMs = 0 } = {}) {
    const ms = await Promise.all(urls.map((u) => (this.isDead(u) ? Promise.resolve(null) : this.manifest(u).then((m) => m, () => null))));
    const settled = [];
    let pending = 0, timer = null, collectTimer = null, capTimer = null, done = false, hasResult = false, windowElapsed = !(collectMs > 0);
    return new Promise((resolve) => {
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(collectTimer);
        clearTimeout(capTimer);
        resolve([...settled]);
      };
      if (maxWaitMs > 0) { capTimer = setTimeout(finish, maxWaitMs); capTimer.unref?.(); }
      if (collectMs > 0) {
        collectTimer = setTimeout(() => {
          windowElapsed = true;
          if (hasResult || pending === 0) finish();
        }, collectMs);
        collectTimer.unref?.();
      }
      const jobs = urls.map((u, i) => {
        if (!ms[i] || !isResourceSupported(ms[i], path)) return null;
        pending++;
        return this.request(u, path).then(
          (result) => ({ url: u, manifest: ms[i], addonRank: i, result }),
          (error) => ({ url: u, manifest: ms[i], addonRank: i, error }),
        ).then((x) => {
          settled.push(x);
          pending--;
          if (x.result) hasResult = true;
          onEach?.(x, done);
          if (pending === 0) finish();
          else if (!done && x.result) {
            if (collectMs > 0) {
              if (windowElapsed) finish();
            } else if (!timer) {
              timer = setTimeout(finish, graceMs);
              timer.unref?.();
            }
          }
        });
      }).filter(Boolean);
      if (!jobs.length) finish();
    });
  }

  forget(url) { url = normalizeUrl(url); this.manifests.delete(url); this.latencies.delete(url); this.health.delete(url); this.healthMeta.delete(url); http.forget(String(url).replace('/manifest.json', '')); }
}

// legacy JSON-RPC answers wrap the result; shape it like a v3 response
function legacyResult(resource, body) {
  if (body?.error) throw new AddonError('legacy-error', body.error.message || 'legacy addon error');
  const r = body?.result;
  if (resource === 'catalog') return { metas: Array.isArray(r) ? r : [] };
  if (resource === 'meta') return { meta: r };
  if (resource === 'stream') return { streams: Array.isArray(r) ? r : [] };
  if (resource === 'subtitles') return { subtitles: Array.isArray(r?.all) ? r.all : Array.isArray(r) ? r : [] };
  return {};
}

module.exports = { AddonClient, AddonError, normManifest, fromLegacyManifest, isResourceSupported, isExtraSupported, extendExtra, resourceUrl, legacyUrl, parseResponse, normalizeUrl, transportKind, sortedJson, SKIP_PROP, isAdultAddon, isAdultCategory };
