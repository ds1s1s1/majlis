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
