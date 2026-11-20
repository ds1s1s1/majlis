'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SyncHost, SyncViewer, correct, expected, WAIT_MAX_MS } = require('../src/main/sync');

test('drift: hysteresis starts nudging at 250 ms, keeps nudging down to 80 ms, stays in 0.97-1.03, and seeks above 1.5 s', () => {
  assert.deepStrictEqual(correct(10000, 10020, 1), { speed: 1 });            // 20 ms: nothing
  assert.deepStrictEqual(correct(10180, 10000, 1), { speed: 1 });            // 180 ms (< 250 ms start threshold): still 1
  const slow = correct(10300, 10000, 1).speed;
  assert.ok(slow < 1 && slow >= 0.97, `300 ms ahead: slower (${slow})`);     // >= 250 ms: starts nudging
  const fast = correct(9700, 10000, 1).speed;
  assert.ok(fast > 1 && fast <= 1.03, `300 ms behind: faster (${fast})`);
  // hysteresis band (80 ms < drift < 250 ms): keeps nudging while already nudging
  assert.ok(correct(10150, 10000, slow).speed < 1, '150 ms while nudging keeps nudging');
  assert.deepStrictEqual(correct(10075, 10000, slow), { speed: 1 });         // <= 80 ms: stops nudging
  assert.ok(Math.abs(correct(11400, 10000, 1).speed - 1) <= 0.03 + 1e-9);    // never past 3% (0.97..1.03)
  assert.deepStrictEqual(correct(12000, 10000, 1), { seek: 10000, speed: 1 }); // 2 s (>= 1.5 s): jump
  assert.deepStrictEqual(correct(10010, 10000, 1.02), { speed: 1 });          // caught up: normal speed
});

test('authority: stale or duplicate states never apply, and play/pause ping-pong is suppressed', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({ kind: 'url', url: 'x' }, {});
  const v = new SyncViewer();
  assert.ok(v.accept(s0));
  t = 1000; const a = h.request({ epoch: s0.epoch, action: 'play' });
  assert.strictEqual(h.request({ epoch: s0.epoch, action: 'play' }), null, 'duplicate play when already playing is ignored');
  t = 1010; const b = h.request({ epoch: s0.epoch, action: 'pause' });   // two people, nearly at once
  assert.strictEqual(h.request({ epoch: s0.epoch, action: 'pause' }), null, 'duplicate pause when already paused is ignored');
  t = 1050; assert.strictEqual(h.request({ epoch: s0.epoch, action: 'play', seq: a.seq }), null, 'stale-seq toggle within debounce window is ignored');
  assert.ok(v.accept(b));
  assert.ok(!v.accept(a), 'the older play must not undo the newer pause');
  assert.ok(!v.accept(b), 'the same state twice is not news');
  assert.strictEqual(h.request({ epoch: s0.epoch + 9, action: 'play' }), null, 'requests for another film are ignored');
  // viewer request debounce
  assert.ok(v.canRequest('pause', 2000));
  assert.ok(!v.canRequest('pause', 2100), 'rapid duplicate request from viewer is debounced');
  assert.ok(v.canRequest('play', 2150), 'opposite action is allowed');
});

test('a viewer converges on the shared clock within 80 ms and returns to 1x speed', () => {
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
  assert.ok(Math.abs(local - expected(v.state, t)) <= 80, `still ${local - expected(v.state, t)} ms off`);
  assert.strictEqual(speed, 1, 'back to normal speed once inside 80 ms settle threshold');
});

test('buffering: everyone waits for a stalled viewer, then carries on, with live per-peer buffer health', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({}, {});
  h.request({ epoch: s0.epoch, action: 'play' });
  h.report('a', { epoch: s0.epoch, stalled: false, cache: 30, name: 'Ahmad' });
  t = 1000; assert.strictEqual(h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 }), null, 'a short hiccup is ignored');
  t = 1700; const w = h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 }, (id) => `name-${id}`);
  assert.strictEqual(w.playing, false); assert.strictEqual(w.reason, 'buffering'); assert.deepStrictEqual(w.waitingFor, ['name-b']);
  assert.deepStrictEqual(w.peers, [
    { id: 'a', name: 'Ahmad', cache: 30, cacheSpeed: 0, stalled: false, ready: true },
    { id: 'b', name: 'name-b', cache: 0, cacheSpeed: 0, stalled: true, ready: false },
  ]);
  t = 3000; assert.strictEqual(h.report('b', { epoch: s0.epoch, stalled: false, cache: 1 }), null, 'not enough buffered yet');
  t = 4000; const r = h.report('b', { epoch: s0.epoch, stalled: false, cache: 5 });
  assert.strictEqual(r.playing, true); assert.strictEqual(r.reason, 'resume');
  // someone who never recovers doesn't hold everyone forever
  t = 5000; h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 });
  t = 5700; h.report('b', { epoch: s0.epoch, stalled: true, cache: 0 });
  t = 5700 + WAIT_MAX_MS + 1; const g = h.report('a', { epoch: s0.epoch, stalled: false, cache: 30 });
  assert.strictEqual(g.playing, true); assert.strictEqual(g.reason, 'gave-up-waiting');
});

test('pre-play Ready Quorum: waits for all peers to buffer >= 3s, tracks waitingFor names, and starts at pos', () => {
  let t = 0; const h = new SyncHost(() => t);
  const s0 = h.open({ pos: 60000, peers: [{ id: 'host', name: 'Faisal' }, { id: 'g1', name: 'Sara' }] }, {});
  assert.strictEqual(s0.playing, false);
  assert.strictEqual(s0.pos, 60000);
  assert.deepStrictEqual(s0.waitingFor, ['Faisal', 'Sara']);
  t = 500; assert.strictEqual(h.report('host', { epoch: s0.epoch, stalled: false, cache: 8 }), null, 'still waiting for Sara');
  assert.deepStrictEqual(h.state.waitingFor, ['Sara']);
  t = 1200; assert.strictEqual(h.report('g1', { epoch: s0.epoch, stalled: false, cache: 1.5 }), null, 'Sara under 3s');
  t = 2500; const go = h.report('g1', { epoch: s0.epoch, stalled: false, cache: 4 });
  assert.strictEqual(go.playing, true);
  assert.strictEqual(go.pos, 60000, 'starts where it was opened');
  assert.deepStrictEqual(go.waitingFor, []);
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

test('track 3: forceResume, setBrb, cacheSpeed, and waitEndsAt state synchronization', () => {
  let t = 1000;
  const h = new SyncHost(() => t);
  const s0 = h.open({}, {});
  h.request({ epoch: s0.epoch, action: 'play' });

  // Slow peer triggers buffering with waitEndsAt + cacheSpeed
  h.report('a', { epoch: s0.epoch, stalled: false, cache: 25, cacheSpeed: 4200000, name: 'Faisal' });
  t = 2000;
  h.report('b', { epoch: s0.epoch, stalled: true, cache: 0, cacheSpeed: 128000, name: 'Sara' });
  t = 2700;
  const buf = h.report('b', { epoch: s0.epoch, stalled: true, cache: 0, cacheSpeed: 256000, name: 'Sara' });
  assert.strictEqual(buf.playing, false);
  assert.strictEqual(buf.reason, 'buffering');
  assert.strictEqual(buf.waitEndsAt, 2700 + WAIT_MAX_MS);
  assert.strictEqual(buf.peers[1].cacheSpeed, 256000);

  // Host force-resumes immediately despite stalled peer
  const forced = h.forceResume();
  assert.strictEqual(forced.playing, true);
  assert.strictEqual(forced.reason, 'play');
  assert.deepStrictEqual(forced.waitingFor, []);
  assert.strictEqual(forced.waitEndsAt, 0);

  // BRB quick pause pauses playback with BRB metadata, clearing back to play on null
  const brbInfo = { active: true, byId: 'g1', byName: 'Sara', endsAt: t + 120000, durationSec: 120 };
  const brbState = h.setBrb(brbInfo);
  assert.strictEqual(brbState.playing, false);
  assert.strictEqual(brbState.reason, 'brb');
  assert.deepStrictEqual(brbState.brb, brbInfo);

  const resumed = h.setBrb(null);
  assert.strictEqual(resumed.playing, true);
  assert.strictEqual(resumed.reason, 'play');
  assert.strictEqual(resumed.brb, null);
});

