'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Mpv, mpvPath } = require('../src/main/mpv');

const until = (fn, ms = 15000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); resolve(v); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timed out')); } }, 50);
});

// A generated clip (no media files needed), no window, no sound device.
const CLIP = 'av://lavfi:testsrc=duration=120:size=320x240:rate=24';
const HEADLESS = ['--force-window=no', '--vo=null', '--ao=null'];

test('mpv: plays, nudges speed, seeks, and comes back after a crash', { skip: !mpvPath() && 'mpv not available' }, async () => {
  const m = new Mpv({ args: HEADLESS });
  await m.start();
  try {
    await m.load(CLIP);
    await until(() => m.props['time-pos'] > 1);
    // the sync engine's drift correction
    await m.set('speed', 1.03);
    assert.strictEqual(await m.get('speed'), 1.03);
    assert.strictEqual(await m.get('audio-pitch-correction'), true);
    await m.command('seek', 60, 'absolute+exact');
    await until(() => m.props['time-pos'] >= 60);
    // crash: the watchdog starts a new mpv and resumes where the old one was
    const before = m.props['time-pos'];
    const recovered = new Promise((r) => m.once('recovered', r));
    m.p.kill();
    const info = await recovered;
    assert.ok(Math.abs(info.at - before) < 2, `resumed at ${info.at}, was at ${before}`);
    await until(() => m.props['time-pos'] >= before - 1);
    assert.strictEqual(await m.get('speed'), 1.03);
  } finally {
    m.stop();
  }
});
