'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Trackers } = require('../src/main/media/trackers');
const { Library } = require('../src/main/media/library');

const mk = () => {
  const kv = {};
  return new Trackers({ server: () => 'https://srv', accessKey: () => 'AK', get: (k) => kv[k], set: (k, v) => { kv[k] = v; }, protect: (b) => b.toString('base64'), unprotect: (s) => Buffer.from(s, 'base64'), openExternal: () => {} });
};
const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('trackers: Trakt device sign-in polls the server until approved, then scrobbles with the token', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let polls = 0;
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, o = {}) => {
    seen.push([url, o.method || 'GET', o.headers?.authorization || null, o.body || null]);
    if (url.startsWith('https://srv/oauth/config')) return res(200, { trakt: 'CID', simkl: null });
    if (url.startsWith('https://srv/oauth/trakt/device')) return res(200, { device_code: 'DEV', user_code: 'ABCD', verification_url: 'https://trakt.tv/activate', interval: 1, expires_in: 60 });
    if (url.startsWith('https://srv/oauth/trakt/poll')) return ++polls < 3 ? res(400, {}) : res(200, { access_token: 'TOK', refresh_token: 'R', expires_in: 86400, created_at: Math.floor(Date.now() / 1000) });
    if (url.startsWith('https://api.trakt.tv/scrobble/start')) return res(201, {});
    return res(404, {});
  });
  const tr = mk();
  const done = new Promise((r) => tr.start('trakt', r).then((p) => assert.deepStrictEqual(p, { code: 'ABCD', url: 'https://trakt.tv/activate' })));
  for (let i = 0; i < 6; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(1000); }
  assert.strictEqual(await done, 'trakt');
  assert.strictEqual(tr.status().trakt, 'on');
  assert.ok(seen.every(([u]) => !u.startsWith('https://srv') || u.includes('k=AK')), 'the access key goes to the server');
  tr.scrobble('start', { type: 'series', metaId: 'tt0944947', videoId: 'tt0944947:1:2' }, 12.5);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  const s = seen.find(([u]) => u.includes('/scrobble/start'));
  assert.strictEqual(s[2], 'Bearer TOK');
  assert.deepStrictEqual(JSON.parse(s[3]), { show: { ids: { imdb: 'tt0944947' } }, episode: { season: 1, number: 2 }, progress: 12.5 });
});

test('trackers: Trakt history and watchlist land in the library', async (t) => {
  const tr = mk();
  tr.saveTokens('trakt', { access_token: 'TOK', expires_in: 86400, created_at: Math.floor(Date.now() / 1000) });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/oauth/config')) return res(200, { trakt: 'CID' });
    if (url.endsWith('/sync/watched/movies')) return res(200, [{ movie: { title: 'Heat', ids: { imdb: 'tt0113277' } } }]);
    if (url.endsWith('/sync/watched/shows')) return res(200, [{ show: { title: 'GoT', ids: { imdb: 'tt0944947' } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }] }]);
    if (url.endsWith('/sync/watchlist')) return res(200, [{ movie: { title: 'Dune', ids: { imdb: 'tt1160419' } } }]);
    return res(404, {});
  });
  const lib = new Library({ load: () => null, save: () => {} });
  assert.strictEqual(await tr.importInto(lib), 4);
  assert.ok(lib.isWatched('tt0113277', 'tt0113277') && lib.isWatched('tt0944947', 'tt0944947:1:2'));
  assert.strictEqual(lib.watchlist[0].id, 'tt1160419');
});

test('trackers: AniList and MAL return needs_client_id when absent, sign in, import lists, and scrobble', async (t) => {
  const kv = {};
  let keys = {};
  const tr = new Trackers({ server: () => 'https://srv', accessKey: () => 'AK', keys: () => keys, get: (k) => kv[k], set: (k, v) => { kv[k] = v; }, protect: (b) => b.toString('base64'), unprotect: (s) => Buffer.from(s, 'base64'), openExternal: () => {} });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, o = {}) => {
    calls.push([url, o.method || 'GET', o.body ? String(o.body) : '']);
    if (url.startsWith('https://srv/oauth/config')) return res(200, { trakt: 'CID', simkl: null, anilist: null, mal: null });
    if (url.startsWith('https://srv/oauth/mal/token')) return res(200, { access_token: 'MAL_TOK', refresh_token: 'MAL_REF', expires_in: 3600 });
    if (url === 'https://graphql.anilist.co') {
      const b = JSON.parse(o.body);
      if (b.query.includes('Viewer')) return res(200, { data: { Viewer: { id: 77, name: 'Viewer' } } });
      if (b.query.includes('MediaListCollection')) {
        return res(200, { data: { MediaListCollection: { lists: [
          { status: 'COMPLETED', entries: [{ status: 'COMPLETED', progress: 12, media: { id: 101, format: 'TV', title: { english: 'Mob Psycho' }, coverImage: { large: 'p1' } } }] },
          { status: 'CURRENT', entries: [{ status: 'CURRENT', progress: 3, media: { id: 102, format: 'TV', title: { romaji: 'Frieren' }, coverImage: { large: 'p2' } } }] },
          { status: 'PLANNING', entries: [{ status: 'PLANNING', progress: 0, media: { id: 103, format: 'MOVIE', title: { english: 'Akira' }, coverImage: { large: 'p3' } } }] },
        ] } } });
      }
      if (b.query.includes('SaveMediaListEntry')) return res(200, { data: { SaveMediaListEntry: { id: 1, status: b.variables.status, progress: b.variables.progress } } });
    }
    if (url.startsWith('https://api.myanimelist.net/v2/users/@me/animelist')) {
      return res(200, { data: [
        { node: { id: 201, title: 'Monster', media_type: 'tv' }, list_status: { status: 'watching', num_episodes_watched: 4 } },
        { node: { id: 202, title: 'Spirited Away', media_type: 'movie' }, list_status: { status: 'plan_to_watch', num_episodes_watched: 0 } },
      ] });
    }
    if (url.startsWith('https://api.myanimelist.net/v2/anime/')) return res(200, { status: 'watching', num_episodes_watched: 5 });
    return res(404, {});
  });

  // Absent client ids return { error: 'needs_client_id' }
  assert.deepStrictEqual(await tr.start('anilist'), { error: 'needs_client_id' });
  assert.deepStrictEqual(await tr.start('mal'), { error: 'needs_client_id' });

  // Provide client ids via keys
  keys = { anilist: 'AL_CID', mal: 'MAL_CID' };
  await tr.start('anilist', () => {}, 'eyJhbGciOiJIUzI1NiJ9.token');
  assert.strictEqual(tr.status().anilist, 'on');

  // MAL PKCE start + callback exchange via Worker /oauth/mal/token
  const malPending = await tr.start('mal');
  assert.ok(malPending.url.includes('code_challenge=') && malPending.redirectUri.startsWith('http://127.0.0.1:'));
  await tr.finishMal('AUTH_CODE', malPending.verifier, malPending.redirectUri, 'MAL_CID');
  tr.signOut('mal'); // close local server from start('mal')
  tr.saveTokens('mal', { access_token: 'MAL_TOK', clientId: 'MAL_CID', at: Date.now() });
  assert.strictEqual(tr.status().mal, 'on');

  // Import lists into library
  const lib = new Library({ load: () => null, save: () => {} });
  const count = await tr.importInto(lib);
  assert.strictEqual(count, 5);
  assert.ok(lib.isWatched('anilist:101', 'anilist:101'));
  assert.ok(lib.isWatched('anilist:102', 'anilist:102:1:3') && !lib.isWatched('anilist:102', 'anilist:102:1:4'));
  assert.ok(lib.isWatched('mal:201', 'mal:201:1:4'));
  assert.ok(lib.watchlist.some((w) => w.id === 'anilist:103') && lib.watchlist.some((w) => w.id === 'mal:202'));

  // Scrobble updates progress on AniList & MAL
  tr.scrobble('stop', { type: 'series', metaId: 'anilist:102', videoId: 'anilist:102:1:5' }, 85);
  tr.scrobble('stop', { type: 'series', metaId: 'mal:201', videoId: 'mal:201:1:5' }, 85);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.ok(calls.some(([u, , b]) => u === 'https://graphql.anilist.co' && b.includes('SaveMediaListEntry') && b.includes('"progress":5')));
  assert.ok(calls.some(([u, m, b]) => u.endsWith('/anime/201/my_list_status') && m === 'PATCH' && b.includes('num_watched_episodes=5')));
});
