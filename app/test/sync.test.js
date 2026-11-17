'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SyncHost, SyncViewer, correct, expected, WAIT_MAX_MS } = require('../src/main/sync');

test('drift: small gaps slew, big gaps seek, tiny gaps are left alone', () => {
  assert.deepStrictEqual(correct(10000, 10020, 1), { speed: 1 });            // 20 ms: nothing
  assert.ok(correct(10300, 10000, 1).speed < 1);                              // 300 ms ahead: slower
  assert.ok(correct(9700, 10000, 1).speed > 1);                               // 300 ms behind: faster
  assert.ok(Math.abs(correct(11400, 10000, 1).speed - 1) <= 0.05 + 1e-9);    // never past 5%
  assert.deepStrictEqual(correct(12000, 10000, 1), { seek: 10000, speed: 1 }); // 2 s: jump
  assert.deepStrictEqual(correct(10010, 10000, 1.02), { speed: 1 });          // caught up: normal speed
});

test('authority: stale or duplicate states never apply (no ping-pong)', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({ kind: 'url', url: 'x' }, {});
  const v = new SyncViewer();
  assert.ok(v.accept(s0));
  t = 1000; const a = h.request({ epoch: s0.epoch, action: 'play' });
  t = 1010; const b = h.request({ epoch: s0.epoch, action: 'pause' });   // two people, nearly at once
  assert.ok(v.accept(b));
  assert.ok(!v.accept(a), 'the older play must not undo the newer pause');
  assert.ok(!v.accept(b), 'the same state twice is not news');
  assert.strictEqual(h.request({ epoch: s0.epoch + 9, action: 'play' }), null, 'requests for another film are ignored');
});

test('a viewer converges on the shared clock', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({}, {}); t = 0;
  const st = h.request({ epoch: s0.epoch, action: 'play' });
  const v = new SyncViewer(); v.accept(st);
  // the viewer's player runs 400 ms behind and plays at whatever speed it's told
  let local = -400, speed = 1;
  for (t = 0; t < 30000; t += 250) {
    const o = v.step(local, t, false);
    if (o.seek != null) local = o.seek;
    if (o.speed != null) speed = o.speed;
    local += 250 * speed;
  }
  assert.ok(Math.abs(local - expected(v.state, t)) < 60, `still ${local - expected(v.state, t)} ms off`);
  assert.strictEqual(speed, 1, 'back to normal speed once in line');
});

test('buffering: everyone waits for a stalled viewer, then carries on', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({}, {});
  h.request({ epoch: s0.epoch, action: 'play' });
  h.report('a', { epoch: s0.epoch, stalled: false, cache: 30 });
  t = 1000; assert.strictEqual(h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 }), null, 'a short hiccup is ignored');
  t = 1700; const w = h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 }, (id) => `name-${id}`);
  assert.strictEqual(w.playing, false); assert.strictEqual(w.reason, 'buffering'); assert.deepStrictEqual(w.waitingFor, ['name-b']);
  t = 3000; assert.strictEqual(h.report('b', { epoch: s0.epoch, stalled: false, cache: 1 }), null, 'not enough buffered yet');
  t = 4000; const r = h.report('b', { epoch: s0.epoch, stalled: false, cache: 5 });
  assert.strictEqual(r.playing, true); assert.strictEqual(r.reason, 'resume');
  // someone who never recovers doesn't hold everyone forever
  t = 5000; h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 });
  t = 5700; h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 });
  t = 5700 + WAIT_MAX_MS + 1; const g = h.report('a', { epoch: s0.epoch, stalled: false, cache: 30 });
  assert.strictEqual(g.playing, true); assert.strictEqual(g.reason, 'gave-up-waiting');
});

test('a party starts by itself once everyone has the film buffered', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({}, {}, 60000);
  assert.strictEqual(s0.playing, false); assert.strictEqual(s0.pos, 60000);
  t = 500; assert.strictEqual(h.report('a', { epoch: s0.epoch, stalled: false, cache: 1 }), null);
  t = 2500; const go = h.report('a', { epoch: s0.epoch, stalled: false, cache: 4 });
  assert.strictEqual(go.playing, true); assert.strictEqual(go.pos, 60000, 'starts where it was opened');
});

test('a speed request that never reached the player is sent again', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({}, {}); const st = h.request({ epoch: s0.epoch, action: 'play' });
  const v = new SyncViewer(); v.accept(st);
  const first = v.step(-800, 0, false, 1);
  assert.ok(first.speed > 1);
  // the player ignored it (still at 1): the next step asks again
  const again = v.step(-800, 250, false, 1);
  assert.ok(again.speed > 1, 'asked again');
});
