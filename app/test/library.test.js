'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Library } = require('../src/main/media/library');

const lib = () => { let saved = null; const l = new Library({ load: () => null, save: (s) => { saved = s; } }); l.saved = () => saved; return l; };
const heat = { id: 'tt0113277', type: 'movie', name: 'Heat' };
const got = { id: 'tt0944947', type: 'series', name: 'Game of Thrones' };

test('library: playing creates a temp item that shows in continue watching only', () => {
  const l = lib();
  l.progress(heat, 'tt0113277', 60000, 10000000, 5000);
  assert.strictEqual(l.library().length, 0);
  assert.strictEqual(l.continueWatching()[0]._id, heat.id);
  l.add(heat);
  assert.strictEqual(l.library().length, 1);
  assert.strictEqual(l.get(heat.id).temp, false);
});

test('library: watched by time actually watched (70%), not by position', () => {
  const l = lib();
  l.progress(heat, 'tt0113277', 9500000, 10000000, 5000); // jumped near the end, barely watched
  assert.ok(!l.isWatched(heat.id, 'tt0113277'));
  for (let t = 0; t < 7100000; t += 50000) l.progress(heat, 'tt0113277', t, 10000000, 50000);
  assert.ok(l.isWatched(heat.id, 'tt0113277'));
  assert.strictEqual(l.get(heat.id).state.timesWatched, 1);
  assert.strictEqual(l.history.length, 1, 'one history entry, not one per update');
});

test('library: leaving in the credits moves a series on to the next episode', () => {
  const l = lib();
  l.progress(got, 'tt0944947:1:1', 3300000, 3500000, 5000);
  l.stopped(got, 'tt0944947:1:2');
  const s = l.get(got.id).state;
  assert.deepStrictEqual([s.video_id, s.timeOffset], ['tt0944947:1:2', 1]);
  l.progress(got, 'tt0944947:1:2', 600000, 3500000, 5000);
  l.stopped(got, 'tt0944947:1:3');
  assert.strictEqual(l.get(got.id).state.video_id, 'tt0944947:1:2', 'mid-episode: stays');
});

test('library: history groups and sync merge by _mtime', () => {
  const day = new Date(2026, 10, 17, 20).getTime(); // a Tuesday
  const g = Library.groupHistory([{ at: day - 3600e3 }, { at: day - 3 * 864e5 }, { at: day - 10 * 864e5 }, { at: new Date(2024, 1, 1).getTime() }], day);
  assert.deepStrictEqual(g.map((x) => x.group), ['today', 'week', 'month', '2024']);
  const l = lib(); l.add(heat);
  l.merge([{ ...l.get(heat.id), name: 'Old', _mtime: '2000-01-01T00:00:00.000Z' }]);
  assert.strictEqual(l.get(heat.id).name, 'Heat', 'an older remote copy loses');
  l.merge([{ ...l.get(heat.id), name: 'New', _mtime: '2999-01-01T00:00:00.000Z' }]);
  assert.strictEqual(l.get(heat.id).name, 'New');
  assert.ok(l.takeDirty().length >= 1);
});
