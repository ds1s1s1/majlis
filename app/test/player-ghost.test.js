'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Mpv } = require('../src/main/mpv');

test('clearPlayback synchronously cancels watchdog, clears want, and resets playback state', () => {
  const mpv = new Mpv({ wid: null, exe: 'mock-mpv' });
  mpv.want = { url: 'https://example.com/movie.mkv', opts: { start: '120' } };
  mpv.restarts = 3;
  mpv.props['time-pos'] = 540;
  mpv.props.duration = 7200;
  mpv.wd = setInterval(() => {}, 5000);

  mpv.clearPlayback();

  assert.equal(mpv.want, null);
  assert.equal(mpv.restarts, 0);
  assert.equal(mpv.wd, null);
  assert.equal(mpv.props['time-pos'], undefined);
  assert.equal(mpv.props.duration, undefined);
});

test('_recover does not respawn mpv after clearPlayback or stop', async () => {
  const mpv = new Mpv({ wid: null, exe: 'mock-mpv' });
  let started = false;
  let loaded = false;
  mpv.start = async () => { started = true; };
  mpv.load = async () => { loaded = true; };

  await mpv._recover('exit 1');
  assert.equal(started, false);
  assert.equal(loaded, false);

  mpv.want = { url: 'https://example.com/a.mp4', opts: {} };
  mpv.stop(true);
  await mpv._recover('exit 1');
  assert.equal(started, false);
  assert.equal(loaded, false);
});

test('clearPlayback mid-recovery aborts respawn before start/load runs', async () => {
  const mpv = new Mpv({ wid: null, exe: 'mock-mpv' });
  let startCount = 0;
  let loadCount = 0;
  mpv.start = async () => { startCount++; };
  mpv.load = async () => { loadCount++; };
  mpv.want = { url: 'https://example.com/b.mp4', opts: {} };

  const recoverPromise = mpv._recover('stalled');
  // Close triggers clearPlayback while _recover is waiting on its 300ms delay
  setTimeout(() => mpv.clearPlayback(), 40);
  await recoverPromise;

  assert.equal(startCount, 0);
  assert.equal(loadCount, 0);
  assert.equal(mpv.recovering, false);
});
