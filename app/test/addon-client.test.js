'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/main/media/addon-client');

test('urls: encodeURIComponent parts, query string kept, extra encoded', () => {
  assert.strictEqual(A.resourceUrl('https://a.example/x/manifest.json', { resource: 'stream', type: 'series', id: 'tt0944947:1:2' }),
    'https://a.example/x/stream/series/tt0944947%3A1%3A2.json');
  assert.strictEqual(A.resourceUrl('https://a.example/cfg=abc/manifest.json?token=1', { resource: 'catalog', type: 'movie', id: 'top', extra: [['genre', 'Sci-Fi & Fantasy'], ['skip', '100']] }),
    'https://a.example/cfg=abc/catalog/movie/top/genre=Sci-Fi%20%26%20Fantasy&skip=100.json?token=1');
  assert.strictEqual(A.transportKind('https://x/stremio/v1'), 'legacy');
  assert.strictEqual(A.transportKind('https://x/y'), null);
  assert.strictEqual(A.normalizeUrl(' stremio://a.example/manifest.json '), 'https://a.example/manifest.json');
});

test('extra: a new prop goes in front; optionsLimit toggles and caps', () => {
  const skip = A.SKIP_PROP, genre = { name: 'genre', isRequired: false, options: [], optionsLimit: 1 };
  assert.deepStrictEqual(A.extendExtra([['genre', 'Action']], skip, 100), [['skip', '100'], ['genre', 'Action']]);
  assert.deepStrictEqual(A.extendExtra([['skip', '100'], ['genre', 'Action']], genre, 'Drama'), [['genre', 'Drama'], ['skip', '100']]);
  assert.deepStrictEqual(A.extendExtra([['genre', 'Action']], genre, null), []);
  const multi = { name: 'g', isRequired: false, options: [], optionsLimit: 2 };
  assert.deepStrictEqual(A.extendExtra([['g', 'a']], multi, 'b'), [['g', 'b'], ['g', 'a']]);
  assert.deepStrictEqual(A.extendExtra([['g', 'b'], ['g', 'a']], multi, 'c'), [['g', 'c'], ['g', 'b']]);
  assert.deepStrictEqual(A.extendExtra([['g', 'b'], ['g', 'a']], multi, 'a'), [['g', 'b']], 'setting a set value toggles it off');
});

test('routing: full-form resources do not inherit manifest types; empty idPrefixes = all ids', () => {
  const m = A.normManifest({ id: 'x', name: 'X', types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['meta', { name: 'stream', idPrefixes: ['tt'] }, { name: 'subtitles', types: ['movie'], idPrefixes: [] }],
    catalogs: [{ type: 'movie', id: 'top', extra: [{ name: 'search', isRequired: true }, { name: 'skip', isRequired: true }] }, { type: 'movie', id: 'top', extra: [] }] });
  assert.ok(A.isResourceSupported(m, { resource: 'meta', type: 'series', id: 'tt1' }));
  assert.ok(!A.isResourceSupported(m, { resource: 'meta', type: 'series', id: 'kitsu:1' }));
  assert.ok(!A.isResourceSupported(m, { resource: 'stream', type: 'movie', id: 'tt1' }), 'stream has no types of its own');
  assert.ok(A.isResourceSupported(m, { resource: 'subtitles', type: 'movie', id: 'anything' }));
  assert.strictEqual(m.catalogs.length, 1, 'duplicate catalogs (same id+type) are dropped');
  assert.deepStrictEqual(m.catalogs[0].extra.find((p) => p.name === 'skip'), A.SKIP_PROP, 'skip is never required');
  assert.ok(A.isResourceSupported(m, { resource: 'catalog', type: 'movie', id: 'top', extra: [['search', 'heat']] }));
  assert.ok(!A.isResourceSupported(m, { resource: 'catalog', type: 'movie', id: 'top' }), 'search is required');
  assert.ok(!A.isResourceSupported(m, { resource: 'catalog', type: 'movie', id: 'top', extra: [['search', 'x'], ['genre', 'y']] }), 'undeclared extra');
  const legacyShort = A.normManifest({ id: 'y', name: 'Y', types: ['movie'], resources: [], catalogs: [{ type: 'movie', id: 'c', extraRequired: ['genre'], extraSupported: ['genre', 'skip'] }] });
  assert.deepStrictEqual(legacyShort.catalogs[0].extra.map((p) => [p.name, p.isRequired]), [['genre', true], ['skip', false]]);
});

// the exact expectations from stremio-core legacy/mod.rs tests
test('legacy transport: identical to stremio-core', () => {
  assert.strictEqual(A.legacyUrl('https://stremio-mixer.schneider.ax/stremioget/stremio/v1', { resource: 'catalog', type: 'tv', id: 'popularities.mixer' }),
    'https://stremio-mixer.schneider.ax/stremioget/stremio/v1/q.json?b=eyJpZCI6MSwianNvbnJwYyI6IjIuMCIsIm1ldGhvZCI6Im1ldGEuZmluZCIsInBhcmFtcyI6W251bGwseyJsaW1pdCI6MTAwLCJxdWVyeSI6eyJ0eXBlIjoidHYifSwic2tpcCI6MCwic29ydCI6eyJwb3B1bGFyaXRpZXMubWl4ZXIiOi0xLCJwb3B1bGFyaXR5IjotMX19XX0=');
  assert.strictEqual(A.legacyUrl('https://legacywatchhub.strem.io/stremio/v1', { resource: 'stream', type: 'series', id: 'tt0386676:5:1' }),
    'https://legacywatchhub.strem.io/stremio/v1/q.json?b=eyJpZCI6MSwianNvbnJwYyI6IjIuMCIsIm1ldGhvZCI6InN0cmVhbS5maW5kIiwicGFyYW1zIjpbbnVsbCx7InF1ZXJ5Ijp7ImVwaXNvZGUiOjEsImltZGJfaWQiOiJ0dDAzODY2NzYiLCJzZWFzb24iOjUsInR5cGUiOiJzZXJpZXMifX1dfQ==');
  assert.strictEqual(A.legacyUrl('https://legacywatchhub.strem.io/stremio/v1', { resource: 'subtitles', type: 'series', id: 'tt0386676:5:1' }),
    'https://legacywatchhub.strem.io/stremio/v1/q.json?b=eyJpZCI6MSwianNvbnJwYyI6IjIuMCIsIm1ldGhvZCI6InN1YnRpdGxlcy5maW5kIiwicGFyYW1zIjpbbnVsbCx7InF1ZXJ5Ijp7Iml0ZW1IYXNoIjoidHQwMzg2Njc2IDUgMSJ9fV19');
  assert.strictEqual(A.legacyUrl('https://legacywatchhub.strem.io/stremio/v1', { resource: 'subtitles', type: 'series', id: 'tt0386676:5:1', extra: [['videoHash', 'ffffffffff'], ['videoSize', '1000000000']] }),
    'https://legacywatchhub.strem.io/stremio/v1/q.json?b=eyJpZCI6MSwianNvbnJwYyI6IjIuMCIsIm1ldGhvZCI6InN1YnRpdGxlcy5maW5kIiwicGFyYW1zIjpbbnVsbCx7InF1ZXJ5Ijp7Iml0ZW1IYXNoIjoidHQwMzg2Njc2IDUgMSIsInZpZGVvSGFzaCI6ImZmZmZmZmZmZmYiLCJ2aWRlb1NpemUiOjEwMDAwMDAwMDB9fV19');
  const m = A.fromLegacyManifest({ manifest: { id: 'l', name: 'L', version: '1.0.0', methods: ['meta.find', 'stream.find'], types: ['movie', 'series'], idProperty: ['imdb_id', 'kitsu_id'], sorts: [{ prop: 'popular', name: 'Popular', types: ['movie'] }] } });
  assert.deepStrictEqual(m.idPrefixes, ['tt', 'kitsu_id:']);
  assert.deepStrictEqual(m.catalogs.map((c) => `${c.type}/${c.id}`), ['movie/popular']);
  assert.deepStrictEqual(m.resources.map((r) => r.name), ['stream']);
});

test('responses: exactly one key, bad items dropped, empty is an error', () => {
  assert.throws(() => A.parseResponse({ metas: [], streams: [] }), /exactly one/);
  assert.throws(() => A.parseResponse({ streams: [] }), (e) => e.kind === 'empty');
  assert.throws(() => A.parseResponse({ streams: null }), (e) => e.kind === 'empty');
  const r = A.parseResponse({ streams: [{ url: 'https://x/a.mkv' }, { infoHash: 'xyz' }, { infoHash: 'a'.repeat(40), fileIdx: 1 }, { title: 'nothing to play' }] });
  assert.strictEqual(r.streams.length, 2);
  const meta = A.parseResponse({ meta: { id: 'tt1', type: 'series', videos: [{ id: 'a' }, { id: 'a' }, { title: 'no id' }, { id: 'b' }] } });
  assert.deepStrictEqual(meta.meta.videos.map((v) => v.id), ['a', 'b']);
});
