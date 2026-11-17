'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Calendar } = require('../src/main/media/calendar');
const { Library } = require('../src/main/media/library');

const from = new Date(2026, 10, 1).getTime(), to = new Date(2026, 11, 1).getTime();

test('calendar: library episodes in range, TVMaze duplicates dropped, sorted by time', async () => {
  const lib = new Library({ load: () => null, save: () => {} });
  lib.add({ id: 'tt1234567', type: 'series', name: 'Show' });
  const get = async (url) => {
    if (url.includes('cinemeta')) return { meta: { videos: [
      { id: 'tt1234567:2:1', season: 2, episode: 1, released: '2026-11-20T02:00:00.000Z', name: 'Back' },
      { id: 'tt1234567:1:9', season: 1, episode: 9, released: '2025-01-01T00:00:00.000Z' },
      { id: 'tt1234567:0:1', season: 0, episode: 1, released: '2026-11-05T00:00:00.000Z' }, // specials stay out
    ] } };
    if (url.includes('schedule/web?date=2026-11-03')) return [{ airstamp: '2026-11-03T20:00:00Z', season: 1, number: 4, name: 'Other', _embedded: { show: { id: 9, name: 'Other Show', externals: { imdb: 'tt999' } } } }];
    if (url.includes('schedule?date=2026-11-20')) return [{ airstamp: '2026-11-20T02:00:00.000Z', season: 2, number: 1, show: { id: 1, name: 'Show', externals: { imdb: 'tt1234567' } } }];
    return [];
  };
  const cal = new Calendar({ meta: { anilist: async () => null, tmdbOn: () => false }, library: lib, get });
  const r = await cal.range(from, to, ['library', 'tv', 'movies']);
  assert.deepStrictEqual(r.map((e) => [e.source, e.id, e.season, e.episode]), [['tv', 'tt999', 1, 4], ['library', 'tt1234567', 2, 1]]);
  assert.strictEqual(r[1].videoId, 'tt1234567:2:1');
  assert.strictEqual(r[0].videoId, 'tt999:1:4');
});
