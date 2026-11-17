'use strict';
// Trakt and Simkl: sign in, scrobble what's playing, bring watched history and the watchlist in.
//  Trakt: device code. The token exchange needs the client secret, so it goes through the
//         Majlis server (cloud/src/worker.js /oauth/trakt/*); API calls go straight to Trakt.
//  Simkl: PIN. Only the public client id is needed (from the server's /oauth/config).
// Tokens are kept encrypted (DPAPI) per profile.
const TRAKT = 'https://api.trakt.tv', SIMKL = 'https://api.simkl.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Trackers {
  // server(): the Majlis server's https base or null; accessKey(); get/set(k, v): per-profile store; protect/unprotect: DPAPI
  constructor({ server, accessKey, get, set, protect, unprotect, openExternal }) {
    Object.assign(this, { server, accessKey, get, set, protect, unprotect, openExternal });
    this.pending = {}; // service -> { code, url } while waiting for the viewer
    this.cfg = null;
  }

  async config() {
    const base = this.server();
    if (!base) throw new Error('sign-ins need a Majlis server (set one in settings)');
    if (!this.cfg) {
      const r = await fetch(`${base}/oauth/config?k=${encodeURIComponent(this.accessKey() || '')}`);
      if (!r.ok) throw new Error(`server ${r.status}`);
      this.cfg = await r.json();
    }
    return this.cfg;
  }
  async worker(path, body) {
    return fetch(`${this.server()}/oauth/${path}?k=${encodeURIComponent(this.accessKey() || '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  tokens(svc) { const s = this.get(`oauth_${svc}`); try { return s ? JSON.parse(this.unprotect(s).toString()) : null; } catch { return null; } }
  saveTokens(svc, t) { this.set(`oauth_${svc}`, t ? this.protect(Buffer.from(JSON.stringify(t))) : null); }
  status() { return { trakt: this.tokens('trakt') ? 'on' : this.pending.trakt || null, simkl: this.tokens('simkl') ? 'on' : this.pending.simkl || null }; }
  signOut(svc) { this.saveTokens(svc, null); delete this.pending[svc]; }

  // ---- sign in: returns { code, url } at once; the sign-in finishes in the background (onDone)
  async start(svc, onDone = () => {}) {
    const cfg = await this.config();
    if (svc === 'trakt') {
      if (!cfg.trakt) throw new Error('Trakt is not set up on the server');
      const r = await this.worker('trakt/device');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Trakt ${r.status}`);
      const d = await r.json();
      this.pending.trakt = { code: d.user_code, url: d.verification_url };
      this.openExternal(d.verification_url);
      this.pollTrakt(d).then(onDone, (e) => { delete this.pending.trakt; onDone(e); });
      return this.pending.trakt;
    }
    if (svc === 'simkl') {
      if (!cfg.simkl) throw new Error('Simkl is not set up on the server');
      const r = await fetch(`${SIMKL}/oauth/pin?client_id=${cfg.simkl}`);
      if (!r.ok) throw new Error(`Simkl ${r.status}`);
      const d = await r.json();
      const url = d.verification_url?.startsWith('http') ? `${d.verification_url.replace(/\/$/, '')}/${d.user_code}` : `https://simkl.com/pin/${d.user_code}`;
      this.pending.simkl = { code: d.user_code, url };
      this.openExternal(url);
      this.pollSimkl(d, cfg.simkl).then(onDone, (e) => { delete this.pending.simkl; onDone(e); });
      return this.pending.simkl;
    }
    throw new Error('unknown service');
  }

  async pollTrakt(d) {
    let every = (d.interval || 5) * 1000;
    const until = Date.now() + (d.expires_in || 600) * 1000;
    while (Date.now() < until && this.pending.trakt) {
      await sleep(every);
      const r = await this.worker('trakt/poll', { code: d.device_code });
      if (r.status === 200) { const t = await r.json(); this.saveTokens('trakt', { ...t, at: Date.now() }); delete this.pending.trakt; return 'trakt'; }
      if (r.status === 429) { every += 1000; continue; }
      if (r.status === 400) continue; // the viewer hasn't approved yet
      throw new Error({ 404: 'Trakt code not found', 409: 'Trakt code already used', 410: 'Trakt code expired', 418: 'Trakt sign-in was declined' }[r.status] || `Trakt ${r.status}`);
    }
    throw new Error('Trakt code expired');
  }

  async pollSimkl(d, clientId) {
    const until = Date.now() + (d.expires_in || 900) * 1000;
    while (Date.now() < until && this.pending.simkl) {
      await sleep((d.interval || 5) * 1000);
      const r = await fetch(`${SIMKL}/oauth/pin/${d.user_code}?client_id=${clientId}`);
      const j = await r.json().catch(() => ({}));
      if (j.result === 'OK' && j.access_token) { this.saveTokens('simkl', { access_token: j.access_token, at: Date.now() }); delete this.pending.simkl; return 'simkl'; }
    }
    throw new Error('Simkl code expired');
  }

  // a Trakt token that's still good (they last 24 h now; refreshed through the server)
  async traktToken() {
    let t = this.tokens('trakt');
    if (!t) return null;
    const expires = (t.created_at ? t.created_at * 1000 : t.at) + (t.expires_in || 86400) * 1000;
    if (Date.now() > expires - 3600000) {
      const r = await this.worker('trakt/refresh', { refresh_token: t.refresh_token });
      if (!r.ok) { if (r.status === 400 || r.status === 401) this.signOut('trakt'); return null; }
      t = { ...(await r.json()), at: Date.now() };
      this.saveTokens('trakt', t);
    }
    return t.access_token;
  }

  async api(svc, path, { method = 'GET', body } = {}) {
    const cfg = await this.config();
    const token = svc === 'trakt' ? await this.traktToken() : this.tokens('simkl')?.access_token;
    if (!token) return null;
    const headers = svc === 'trakt'
      ? { 'trakt-api-version': '2', 'trakt-api-key': cfg.trakt, authorization: `Bearer ${token}` }
      : { 'simkl-api-key': cfg.simkl, authorization: `Bearer ${token}` };
    const r = await fetch(`${svc === 'trakt' ? TRAKT : SIMKL}${path}`, { method, headers: { 'content-type': 'application/json', 'user-agent': 'Majlis', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { this.signOut(svc); return null; }
    return r.ok ? r.json().catch(() => ({})) : null;
  }

  // start / pause / stop of what's playing; progress in % (both services take Trakt's shape)
  scrobble(action, { type, metaId, videoId }, progress) {
    if (!/^tt\d+$/.test(metaId || '')) return;
    const ep = /:(\d+):(\d+)$/.exec(videoId || '');
    const body = type === 'series' && ep
      ? { show: { ids: { imdb: metaId } }, episode: { season: +ep[1], number: +ep[2] }, progress }
      : { movie: { ids: { imdb: metaId } }, progress };
    for (const svc of ['trakt', 'simkl']) if (this.tokens(svc)) this.api(svc, `/scrobble/${action}`, { method: 'POST', body }).catch(() => {});
  }

  // watched history and watchlist into the library (Trakt; Simkl's watched list)
  async importInto(lib) {
    let n = 0;
    const tr = this.tokens('trakt') ? await Promise.all(['/sync/watched/movies', '/sync/watched/shows', '/sync/watchlist']).then((ps) => Promise.all(ps.map((p) => this.api('trakt', p).catch(() => null)))) : [null, null, null];
    const [movies, shows, watchlist] = await tr;
    for (const m of movies || []) { const id = m.movie?.ids?.imdb; if (id) { lib.setWatched({ id, type: 'movie', name: m.movie.title }, id, true); n++; } }
    for (const s of shows || []) {
      const id = s.show?.ids?.imdb;
      if (!id) continue;
      for (const se of s.seasons || []) for (const e of se.episodes || []) { lib.setWatched({ id, type: 'series', name: s.show.title }, `${id}:${se.number}:${e.number}`, true); n++; }
    }
    for (const w of watchlist || []) {
      const x = w.movie || w.show, id = x?.ids?.imdb;
      if (id && !lib.watchlist.some((y) => y.id === id)) { lib.toggleList('watchlist', { id, type: w.movie ? 'movie' : 'series', name: x.title }); n++; }
    }
    if (this.tokens('simkl')) {
      const all = await this.api('simkl', '/sync/all-items/?extended=full').catch(() => null);
      for (const m of all?.movies || []) { const id = m.movie?.ids?.imdb; if (id && m.status === 'completed') { lib.setWatched({ id, type: 'movie', name: m.movie.title }, id, true); n++; } }
      for (const s of all?.shows || []) {
        const id = s.show?.ids?.imdb;
        if (!id) continue;
        for (const se of s.seasons || []) for (const e of se.episodes || []) { lib.setWatched({ id, type: 'series', name: s.show.title }, `${id}:${se.number}:${e.number}`, true); n++; }
      }
    }
    return n;
  }
}

module.exports = { Trackers };
