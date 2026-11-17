'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { csv, letterboxdFrom, letterboxdKey, stremioLibrary } = require('../src/main/imports');

test('csv: quotes, doubled quotes, commas and newlines inside fields', () => {
  const rows = csv('Date,Name,Year,Review\r\n2024-01-02,"Crouching Tiger, Hidden Dragon",2000,"Said ""wow""\nthen left"\n2024-02-03,Heat,1995,\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].Name, 'Crouching Tiger, Hidden Dragon');
  assert.strictEqual(rows[0].Review, 'Said "wow"\nthen left');
  assert.strictEqual(rows[1].Year, '1995');
});

test('letterboxd: watched, ratings, diary, reviews and watchlist merge per film', () => {
  const lb = letterboxdFrom({
    'watched.csv': 'Date,Name,Year,Letterboxd URI\n2023-05-01,Heat,1995,https://boxd.it/a\n',
    'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2023-05-02,Heat,1995,https://boxd.it/a,4.5\n',
    'reviews.csv': 'Date,Name,Year,Letterboxd URI,Rating,Review\n2023-05-02,Heat,1995,https://boxd.it/a,4.5,"The bank scene."\n',
    'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-01,Dune,2021,https://boxd.it/b\n',
  });
  const heat = lb[letterboxdKey('Heat', 1995)];
  assert.strictEqual(heat.rating, 4.5); assert.strictEqual(heat.watched, '2023-05-01'); assert.strictEqual(heat.review, 'The bank scene.');
  assert.strictEqual(lb[letterboxdKey('dune', '2021')].watchlist, true);
});

test('stremio library: removed items dropped, progress in seconds', () => {
  const l = stremioLibrary([
    { _id: 'tt0113277', type: 'movie', name: 'Heat', state: { timeOffset: 600000, duration: 10200000, timesWatched: 1, lastWatched: '2024-01-01T00:00:00Z' } },
    { _id: 'tt1', type: 'movie', name: 'Gone', removed: true, state: {} },
  ]);
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual([l[0].t, l[0].d, l[0].watched], [600, 10200, true]);
});
