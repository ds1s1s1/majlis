'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { activity, joinTarget, frame, unframe } = require('../src/main/discord');

test('discord ipc frames survive being split and joined', () => {
  const a = frame(1, { cmd: 'X', n: 1 }), b = frame(3, { p: 2 });
  const both = Buffer.concat([a, b]);
  const half = unframe(both.subarray(0, a.length + 5));
  assert.deepStrictEqual(half.frames, [{ op: 1, data: { cmd: 'X', n: 1 } }]);
  const rest = unframe(Buffer.concat([half.rest, both.subarray(a.length + 5)]));
  assert.deepStrictEqual(rest.frames, [{ op: 3, data: { p: 2 } }]);
  assert.strictEqual(rest.rest.length, 0);
});

test('presence: watching shows the film and time left, hosting offers a join', () => {
  const w = activity({ watching: { name: 'The Kid', poster: 'https://x/p.jpg', pos: 600, dur: 4080, paused: false, together: true }, hosting: { guests: 2, max: 8, mode: 'watch', since: 1 }, id: '123456789' });
  assert.strictEqual(w.details, 'The Kid'); assert.strictEqual(w.state, 'Watching together');
  assert.ok(w.timestamps.end - w.timestamps.start === 4080 * 1000);
  assert.deepStrictEqual(w.party.size, [3, 8]);
  assert.strictEqual(joinTarget(w.secrets.join), '123456789');
  const paused = activity({ watching: { name: 'A', pos: 1, dur: 10, paused: true } });
  assert.strictEqual(paused.timestamps, undefined, 'no running clock while paused');
  assert.strictEqual(activity({}), null);
  assert.strictEqual(joinTarget('majlis:12'), null);
  assert.strictEqual(joinTarget('evil:123456789'), null);
});
