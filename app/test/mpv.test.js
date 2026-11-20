'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Mpv, mpvPath, buildMpvArgs, SPDIF_CODECS, VSR_VF } = require('../src/main/mpv');
const { LibMpv, libmpvPath, buildLibMpvOptions } = require('../src/main/libmpv');
const { core } = require('../src/main/net');

const until = (fn, ms = 15000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); resolve(v); } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timed out')); } }, 50);
});

test('mpv args: VSR forces d3d11va, default high-quality + bt.2446a, 150/50MiB cache, Arabic libass, optional spdif', () => {
  const base = buildMpvArgs({ vsr: false, spdif: false, fontsDir: null });
  assert.ok(base.includes('--hwdec=auto-safe'));
  assert.ok(!base.includes('--hwdec=d3d11va'));
  assert.ok(base.includes('--profile=high-quality'));
  assert.ok(base.includes('--scale=spline36'));
  assert.ok(base.includes('--cscale=spline36'));
  assert.ok(base.includes('--dscale=mitchell'));
  assert.ok(base.includes('--deband=yes'));
  assert.ok(base.includes('--demuxer-max-bytes=150MiB'));
  assert.ok(base.includes('--demuxer-max-back-bytes=50MiB'));
  assert.ok(base.includes('--tone-mapping=bt.2446a'));
  assert.ok(base.includes('--target-peak=auto'));
  assert.ok(base.includes('--target-colorspace-hint=yes'));
  assert.ok(base.includes('--sub-font=Segoe UI'));
  assert.ok(base.includes('--sub-pos=94'));
  assert.ok(base.includes('--sub-margin-y=26'));
  assert.ok(base.includes('--sub-font-size=40'));
  assert.ok(base.includes('--sub-ass-force-margins=yes'));
  assert.ok(base.includes('--sub-ass-shaper=complex'));
  assert.ok(base.includes('--sub-ass-override=scale'));
  assert.ok(base.includes('--d3d11-flip=yes'));
  assert.ok(base.includes('--video-sync=display-resample'));
  assert.ok(base.includes('--interpolation=yes'));
  assert.ok(base.includes('--tscale=oversample'));
  assert.ok(base.includes('--framedrop=vo'));

  const embOpts = Object.fromEntries(buildLibMpvOptions({ vsr: false, decoderMode: 1, displayFps: 144 }));
  assert.strictEqual(embOpts.vo, 'gpu-next');
  assert.strictEqual(embOpts['gpu-api'], 'd3d11');
  assert.strictEqual(embOpts['d3d11-flip'], 'yes');
  assert.strictEqual(embOpts.hwdec, 'auto-safe');
  assert.strictEqual(embOpts.profile, 'high-quality');
  assert.strictEqual(embOpts['tone-mapping'], 'spline');
  assert.strictEqual(embOpts['video-sync'], 'audio');
  assert.strictEqual(embOpts.interpolation, 'no');
  assert.strictEqual(embOpts['demuxer-max-bytes'], '128MiB');
  assert.strictEqual(embOpts['demuxer-max-back-bytes'], '32MiB');
  assert.strictEqual(embOpts['sub-font'], 'IBM Plex Sans Arabic');
  assert.strictEqual(embOpts['sub-pos'], '93');
  assert.strictEqual(embOpts['sub-ass-shaper'], 'complex');
  assert.ok(!embOpts['stream-lavf-o'].includes('reconnect_streamed'));

  const vsr = buildMpvArgs({ vsr: true, spdif: true, fontsDir: 'C:\\fonts' });
  assert.ok(vsr.includes('--hwdec=d3d11va'), 'VSR needs d3d11va frames');
  assert.ok(!vsr.includes('--hwdec=auto-safe'), 'auto-safe removed when VSR is on');
  assert.ok(vsr.includes(`--vf=${VSR_VF}`));
  assert.ok(base.some((x) => x.startsWith('--user-agent=Mozilla/')));
  assert.ok(vsr.includes(`--audio-spdif=${SPDIF_CODECS}`));
  assert.ok(vsr.includes('--sub-fonts-dir=C:\\fonts'));
});

test('mpv: vsr enabled starts real mpv.exe without option parse error', { skip: !mpvPath() && 'mpv not available' }, async () => {
  const m = new Mpv({ vsr: true, args: ['--border=no', '--geometry=1x1+-32000+-32000', '--ao=null'] });
  await m.start();
  try {
    await m.load(CLIP);
    await until(() => m.props['time-pos'] > 0.5);
    assert.ok(m.props['time-pos'] > 0.5);
  } finally {
    m.stop();
  }
});

// A generated clip (no media files needed), no window, no sound device.
const CLIP = 'av://lavfi:testsrc=duration=120:size=320x240:rate=24';
const HEADLESS = ['--force-window=no', '--vo=null', '--ao=null'];

test('mpv: plays, nudges speed, toggles night audio filter, seeks, and comes back after a crash', { skip: !mpvPath() && 'mpv not available' }, async () => {
  const m = new Mpv({ args: HEADLESS });
  await m.start();
  try {
    await m.load(CLIP);
    await until(() => m.props['time-pos'] > 1);
    // the sync engine's drift correction
    await m.set('speed', 1.03);
    assert.strictEqual(await m.get('speed'), 1.03);
    assert.strictEqual(await m.get('audio-pitch-correction'), true);
    // Night mode filter toggle
    const nightAf = '@night:lavfi=[dynaudnorm=f=150:g=15:p=0.9,acompressor=threshold=-20dB:ratio=3:attack=10:release=250]';
    await m.command('af', 'toggle', nightAf);
    const afs = await m.get('af');
    assert.ok(Array.isArray(afs) && afs.some((f) => f.label === 'night'), 'night filter active');
    await m.command('af', 'toggle', nightAf);
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

test('libmpv NativeMpvPlayer + proc_guard: plays headless source, emits property changes, pauses, and destroys cleanly', {
  skip: !(core?.NativeMpvPlayer && libmpvPath()) && 'native NativeMpvPlayer or libmpv-2.dll unavailable',
}, async () => {
  assert.strictEqual(typeof core.adoptProcess, 'function');
  assert.strictEqual(core.detectDisplayHdr('0'), false);

  const props = {};
  const p = new core.NativeMpvPlayer(
    libmpvPath(),
    [['vo', 'null'], ['ao', 'null'], ['hwdec', 'no'], ['idle', 'yes'], ['msg-level', 'all=warn']],
    ['time-pos', 'duration', 'pause'],
    '0',
    '0',
    (jsonStr) => {
      try {
        const ev = JSON.parse(jsonStr);
        if (ev.event === 'property-change') props[ev.name] = ev.data;
      } catch {}
    },
  );
  try {
    p.command(['loadfile', "av://lavfi:color=c=black:s=128x128:d=4"]);
    await until(() => (props['time-pos'] || 0) > 0.15, 8000);
    p.setProperty('pause', 'yes');
    assert.strictEqual(p.getProperty('pause'), 'yes');
    p.releaseMedia();
  } finally {
    p.destroy();
  }
});

