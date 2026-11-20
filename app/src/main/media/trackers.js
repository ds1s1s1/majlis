'use strict';
// Trakt, Simkl, AniList and MyAnimeList: sign in, scrobble what's playing, bring watched history
// and the watchlist in.
//  Trakt:   device code through the Majlis server (/oauth/trakt/*).
//  Simkl:   PIN (client id from the server's /oauth/config or keys).
//  AniList: implicit / PIN grant (client id from build-config/user keys or server).
//  MAL:     OAuth2 PKCE with a 127.0.0.1 callback; token exchange via Worker /oauth/mal/token or direct.
// Tokens are kept encrypted (DPAPI) per profile.
const http = require('http');
const crypto = require('crypto');
const TRAKT = 'https://api.trakt.tv', SIMKL = 'https://api.simkl.com', ANILIST = 'https://graphql.anilist.co', MAL = 'https://api.myanimelist.net/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DONE_HTML = '<!doctype html><meta charset="utf-8"><title>Majlis</title><style>body{background:#11100e;color:#f3eee5;font:16px system-ui;display:grid;place-items:center;height:90vh}</style><p id="m">Signed in — you can close this tab and return to Majlis.</p><script>if(location.hash.includes("access_token=")){fetch("/cb?"+location.hash.slice(1)).then(()=>{} );}</script>';

class Trackers {
  // server(): the Majlis server's https base or null; accessKey(); keys(): { anilist, mal, ... }; get/set(k, v): per-profile store; protect/unprotect: DPAPI
  constructor({ server, accessKey, keys = () => ({}), get, set, protect, unprotect, openExternal }) {
    Object.assign(this, { server, accessKey, keys, get, set, protect, unprotect, openExternal });
    this.pending = {}; // service -> { code?, url, ... } while waiting for the viewer
    this.servers = {}; // service -> http.Server (127.0.0.1 callback)
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

  async clientId(svc) {
    const k = this.keys?.()?.[svc];
    if (k) return String(k).trim();
    if (this.server()) {
      const cfg = await this.config().catch(() => null);
      if (cfg?.[svc]) return String(cfg[svc]).trim();
    }
    return null;
  }

  tokens(svc) { const s = this.get(`oauth_${svc}`); try { return s ? JSON.parse(this.unprotect(s).toString()) : null; } catch { return null; } }
  saveTokens(svc, t) { this.set(`oauth_${svc}`, t ? this.protect(Buffer.from(JSON.stringify(t))) : null); }
  status() {
    return {
      trakt: this.tokens('trakt') ? 'on' : this.pending.trakt || null,
      simkl: this.tokens('simkl') ? 'on' : this.pending.simkl || null,
      anilist: this.tokens('anilist') ? 'on' : this.pending.anilist || null,
      mal: this.tokens('mal') ? 'on' : this.pending.mal || null,
    };
  }
  signOut(svc) {
    this.saveTokens(svc, null);
    delete this.pending[svc];
    try { this.servers[svc]?.close(); } catch {}
    delete this.servers[svc];
  }

  // ---- sign in: returns { code?, url } or { error: 'needs_client_id' } at once; finishes in background (onDone)
  async start(svc, onDone = () => {}, code = null) {
    if (svc === 'anilist') {
      const cid = await this.clientId('anilist');
      if (!cid) return { error: 'needs_client_id' };
      if (code) { await this.finishAnilist(code, cid); onDone('anilist'); return { ok: true }; }
      const state = crypto.randomBytes(16).toString('hex');
      const cb = await this._listenCallback('anilist', async (q) => {
        if (q.get('state') !== state) throw new Error('invalid OAuth state');
        const tok = q.get('access_token') || q.get('code');
        if (!tok) throw new Error('missing AniList token');
        await this.finishAnilist(tok, cid, cb.redirectUri);
      }, onDone);
      const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(cid)}&response_type=token&state=${state}`;
      this.pending.anilist = { url, redirectUri: cb.redirectUri, clientId: cid, state };
      this.openExternal(url);
      return this.pending.anilist;
    }
    if (svc === 'mal') {
      const cid = await this.clientId('mal');
      if (!cid) return { error: 'needs_client_id' };
      const verifier = crypto.randomBytes(48).toString('base64url');
      if (code && this.pending.mal) {
        await this.finishMal(code, this.pending.mal.verifier, this.pending.mal.redirectUri, cid);
        onDone('mal');
        return { ok: true };
      }
      const state = crypto.randomBytes(16).toString('hex');
      const cb = await this._listenCallback('mal', async (q) => {
        if (q.get('state') !== state) throw new Error('invalid OAuth state');
        const c = q.get('code');
        if (!c) throw new Error('missing MAL authorization code');
        await this.finishMal(c, verifier, cb.redirectUri, cid);
      }, onDone);
      const params = new URLSearchParams({ response_type: 'code', client_id: cid, code_challenge: verifier, code_challenge_method: 'plain', redirect_uri: cb.redirectUri, state });
      const url = `https://myanimelist.net/v1/oauth2/authorize?${params}`;
      this.pending.mal = { url, verifier, redirectUri: cb.redirectUri, clientId: cid, state };
      this.openExternal(url);
      return this.pending.mal;
    }
    const cfg = await this.config();
    if (svc === 'trakt') {
      if (!cfg.trakt) return { error: 'needs_client_id' };
      const r = await this.worker('trakt/device');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Trakt ${r.status}`);
      const d = await r.json();
      this.pending.trakt = { code: d.user_code, url: d.verification_url };
      this.openExternal(d.verification_url);
      this.pollTrakt(d).then(onDone, (e) => { delete this.pending.trakt; onDone(e); });
      return this.pending.trakt;
    }
    if (svc === 'simkl') {
      if (!cfg.simkl) return { error: 'needs_client_id' };
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

  async _listenCallback(svc, onQuery, onDone) {
    try { this.servers[svc]?.close(); } catch {}
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DONE_HTML);
      if (u.pathname !== '/cb' || (!u.searchParams.get('code') && !u.searchParams.get('access_token'))) return;
      clearTimeout(timer);
      try { srv.close(); } catch {}
      delete this.servers[svc];
      try { await onQuery(u.searchParams); onDone(svc); } catch (e) { delete this.pending[svc]; onDone(e); }
    });
    const timer = setTimeout(() => { try { srv.close(); } catch {} delete this.servers[svc]; delete this.pending[svc]; }, 300000);
    timer.unref?.();
    await new Promise((r, j) => { srv.once('error', j); srv.listen(0, '127.0.0.1', r); });
    this.servers[svc] = srv;
    return { redirectUri: `http://127.0.0.1:${srv.address().port}/cb` };
  }

  async finishAnilist(input, clientId, redirectUri = 'https://anilist.co/api/v2/oauth/pin') {
    const raw = String(input || '').trim();
    const fromParam = /[?&#](?:access_token|code)=([^&\s#]+)/.exec(raw);
    const val = fromParam ? decodeURIComponent(fromParam[1]) : raw;
    let accessToken = val;
    // Short authorization codes (PIN / code flow) are exchanged through the Worker when not a JWT
    if (!val.startsWith('eyJ') && this.server()) {
      const r = await this.worker('anilist/token', { code: val, client_id: clientId, redirect_uri: redirectUri });
      if (!r.ok) throw new Error(`AniList ${r.status}`);
      const j = await r.json();
      accessToken = j.access_token;
    }
    if (!accessToken) throw new Error('missing AniList access token');
    const v = await this.anilistGql('query{Viewer{id name}}', {}, accessToken);
    const userId = v?.data?.Viewer?.id || null;
    this.saveTokens('anilist', { access_token: accessToken, userId, at: Date.now() });
    delete this.pending.anilist;
    return 'anilist';
  }

  // MAL token exchange: tries the Worker /oauth/mal/token when a server is configured (for apps
  // with a client secret), and falls back to direct PKCE exchange at myanimelist.net
  async finishMal(rawCode, verifier, redirectUri, clientId) {
    const fromParam = /[?&#]code=([^&\s#]+)/.exec(String(rawCode || ''));
    const code = fromParam ? decodeURIComponent(fromParam[1]) : String(rawCode || '').trim();
    let tok = null;
    if (this.server()) {
      try {
        const r = await this.worker('mal/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId });
        if (r.ok) tok = await r.json();
      } catch {}
    }
    if (!tok?.access_token) {
      const form = new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, code_verifier: verifier });
      if (redirectUri) form.set('redirect_uri', redirectUri);
      const r = await fetch('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Majlis' }, body: form });
      if (!r.ok) throw new Error(`MAL ${r.status}`);
      tok = await r.json();
    }
    if (!tok?.access_token) throw new Error('MAL did not return a token');
    this.saveTokens('mal', { ...tok, clientId, at: Date.now() });
    delete this.pending.mal;
    return 'mal';
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

  async malToken() {
    let t = this.tokens('mal');
    if (!t) return null;
    const expires = (t.at || 0) + (t.expires_in || 2592000) * 1000;
    if (t.refresh_token && Date.now() > expires - 3600000) {
      const cid = t.clientId || await this.clientId('mal');
      let next = null;
      if (this.server()) {
        const r = await this.worker('mal/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: cid }).catch(() => null);
        if (r?.ok) next = await r.json().catch(() => null);
      }
      if (!next?.access_token && cid) {
        const r = await fetch('https://myanimelist.net/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: t.refresh_token }) }).catch(() => null);
        if (r?.ok) next = await r.json().catch(() => null);
      }
      if (next?.access_token) { t = { ...t, ...next, at: Date.now() }; this.saveTokens('mal', t); }
    }
    return t.access_token;
  }

  async anilistGql(query, variables = {}, tokenOverride = null) {
    const token = tokenOverride || this.tokens('anilist')?.access_token;
    if (!token) return null;
    const r = await fetch(ANILIST, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { if (!tokenOverride) this.signOut('anilist'); return null; }
    return r.ok ? r.json().catch(() => null) : null;
  }

  async malApi(path, { method = 'GET', form } = {}) {
    const token = await this.malToken();
    if (!token) return null;
    const headers = { authorization: `Bearer ${token}`, 'user-agent': 'Majlis', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) };
    const r = await fetch(path.startsWith('http') ? path : `${MAL}${path}`, { method, headers, body: form ? new URLSearchParams(form) : undefined, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { this.signOut('mal'); return null; }
    return r.ok ? r.json().catch(() => ({})) : null;
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

  async _resolveAnimeIds(metaId) {
    if (!metaId) return {};
    if (metaId.startsWith('anilist:')) return { anilist: +metaId.slice(8) || null, mal: null };
    if (metaId.startsWith('mal:')) return { anilist: null, mal: +metaId.slice(4) || null };
    if (metaId.startsWith('kitsu:')) {
      const r = await fetch(`https://api.ani.zip/mappings?kitsu_id=${encodeURIComponent(metaId.slice(6))}`).then((x) => (x.ok ? x.json() : null), () => null);
      return { anilist: r?.mappings?.anilist_id || null, mal: r?.mappings?.mal_id || null };
    }
    return {};
  }

  // start / pause / stop of what's playing; progress in %
  scrobble(action, { type, metaId, videoId }, progress) {
    if (/^tt\d+$/.test(metaId || '')) {
      const ep = /:(\d+):(\d+)$/.exec(videoId || '');
      const body = type === 'series' && ep
        ? { show: { ids: { imdb: metaId } }, episode: { season: +ep[1], number: +ep[2] }, progress }
        : { movie: { ids: { imdb: metaId } }, progress };
      for (const svc of ['trakt', 'simkl']) if (this.tokens(svc)) this.api(svc, `/scrobble/${action}`, { method: 'POST', body }).catch(() => {});
    }
    if ((this.tokens('anilist') || this.tokens('mal')) && (action === 'stop' || progress >= 70)) {
      const m = /:(\d+):(\d+)$/.exec(videoId || '') || /:(\d+)$/.exec(videoId || '');
      const epNum = m ? +(m[2] || m[1]) : 1;
      this._resolveAnimeIds(metaId).then(({ anilist, mal }) => {
        if (anilist && this.tokens('anilist')) {
          this.anilistGql(
            'mutation($mediaId:Int,$progress:Int,$status:MediaListStatus){SaveMediaListEntry(mediaId:$mediaId,progress:$progress,status:$status){id status progress}}',
            { mediaId: anilist, progress: epNum, status: type === 'movie' ? 'COMPLETED' : 'CURRENT' },
          ).catch(() => {});
        }
        if (mal && this.tokens('mal')) {
          this.malApi(`/anime/${mal}/my_list_status`, {
            method: 'PATCH',
            form: { status: type === 'movie' ? 'completed' : 'watching', num_watched_episodes: String(epNum) },
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  // watched history and watchlist into the library (Trakt, Simkl, AniList, MAL)
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
    if (this.tokens('anilist')) {
      const tok = this.tokens('anilist');
      let userId = tok.userId;
      if (!userId) {
        const v = await this.anilistGql('query{Viewer{id}}').catch(() => null);
        userId = v?.data?.Viewer?.id;
        if (userId) this.saveTokens('anilist', { ...tok, userId });
      }
      if (userId) {
        const c = await this.anilistGql('query($u:Int){MediaListCollection(userId:$u,type:ANIME){lists{status entries{status progress media{id format title{english romaji}coverImage{extraLarge large}}}}}}', { u: userId }).catch(() => null);
        for (const list of c?.data?.MediaListCollection?.lists || []) {
          for (const e of list.entries || []) {
            const m = e.media;
            if (!m?.id) continue;
            const item = { id: `anilist:${m.id}`, type: m.format === 'MOVIE' ? 'movie' : 'series', name: m.title?.english || m.title?.romaji || '', poster: m.coverImage?.extraLarge || m.coverImage?.large || null };
            const st = e.status || list.status;
            if (st === 'COMPLETED') {
              lib.add(item); lib.setWatched(item, item.id, true);
              for (let ep = 1; ep <= (e.progress || 0) && ep <= 500; ep++) lib.setWatched(item, `${item.id}:1:${ep}`, true);
              n++;
            } else if (st === 'CURRENT' || st === 'REPEATING') {
              lib.add(item);
              for (let ep = 1; ep <= (e.progress || 0) && ep <= 500; ep++) lib.setWatched(item, `${item.id}:1:${ep}`, true);
              n++;
            } else if (st === 'PLANNING') {
              if (!lib.watchlist.some((y) => y.id === item.id)) { lib.toggleList('watchlist', item); n++; }
            }
          }
        }
      }
    }
    if (this.tokens('mal')) {
      const r = await this.malApi('/users/@me/animelist?fields=list_status,my_list_status,num_episodes,media_type,main_picture&limit=1000&nsfw=true').catch(() => null);
      for (const x of r?.data || []) {
        const node = x.node, st = x.list_status || node?.my_list_status;
        if (!node?.id || !st) continue;
        const item = { id: `mal:${node.id}`, type: node.media_type === 'movie' ? 'movie' : 'series', name: node.title || '', poster: node.main_picture?.large || node.main_picture?.medium || null };
        if (st.status === 'completed') {
          lib.add(item); lib.setWatched(item, item.id, true);
          for (let ep = 1; ep <= (st.num_episodes_watched || 0) && ep <= 500; ep++) lib.setWatched(item, `${item.id}:1:${ep}`, true);
          n++;
        } else if (st.status === 'watching') {
          lib.add(item);
          for (let ep = 1; ep <= (st.num_episodes_watched || 0) && ep <= 500; ep++) lib.setWatched(item, `${item.id}:1:${ep}`, true);
          n++;
        } else if (st.status === 'plan_to_watch') {
          if (!lib.watchlist.some((y) => y.id === item.id)) { lib.toggleList('watchlist', item); n++; }
        }
      }
    }
    return n;
  }
}

module.exports = { Trackers };
