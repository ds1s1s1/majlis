'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { VideoTx, VideoRx, RateControl } = require('../src/main/media');

test('frames survive 5% packet loss, keep their timestamps, and big frames are paced', async () => {
  const got = [];
  const rx = new VideoRx({ onFrame: (f) => got.push(f), onNeedKey: () => {} });
  let sent = 0, first = 0, last = 0;
  const link = { send: (p) => { sent++; const t = performance.now(); if (!first) first = t; last = t; if (Math.random() > 0.05) rx.push(p); } };
  const tx = new VideoTx(link);
  tx.fecRatio = 0.2;
  const frames = [];
  for (let i = 1; i <= 30; i++) {
    const size = i === 1 ? 300000 : 8000 + (i % 5) * 3000; // first one is a big keyframe
    const f = { data: crypto.randomBytes(size), key: i === 1, epoch: 1, id: i, encMs: 3, pts: i * 16 };
    frames.push(f); tx.send(f);
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(got.length >= 27, `delivered ${got.length}/30`);
  for (const f of got) {
    const src = frames.find((x) => x.id === f.id);
    assert.ok(f.data.equals(src.data), 'payload intact');
    assert.equal(f.pts, src.pts, 'pts carried');
  }
  assert.ok(last - first >= 1.5, 'keyframe was spread out, not dumped at once');
  const r = rx.report();
  assert.ok(r.jitter < 50, 'jitter is a deviation, not the frame interval');
});

test('rate control ignores one noisy report and steps down on a trend', () => {
  const rc = new RateControl({ maxKbps: 40000, startKbps: 20000 });
  assert.equal(rc.feedback({ kbps: 19000, loss: 0, lost: 0, qd: 40, jitter: 2 }), null);
  assert.equal(rc.feedback({ kbps: 19000, loss: 0, lost: 0, qd: 40, jitter: 2 }), 'down');
  assert.ok(rc.target < 20000 && rc.target > 15000);
  // a jittery line doesn't count as congestion by itself
  const rc2 = new RateControl({ maxKbps: 40000, startKbps: 20000 });
  for (let i = 0; i < 30; i++) rc2.feedback({ kbps: 19000, loss: 0, lost: 0, qd: 30, jitter: 15 });
  assert.equal(rc2.congestions, 0);
});
