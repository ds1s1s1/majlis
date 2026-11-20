'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkBatch } = require('../src/main/media/torrent-health');
const {
  buildMpvArgs, parseSafeMpvConf, subStyleToMpvOpts, normalizeSubLang2,
} = require('../src/main/mpv');
const { buildLibMpvOptions } = require('../src/main/libmpv');
const { stripSdhTags, isolateArabicSrt, prepareSubtitleFile } = require('../src/main/media/sub-rtl');
const { facts, rank } = require('../src/main/media/ranking');
const { StreamsBucket } = require('../src/main/media/streams-bucket');

test('phase3: torrent-health accepts both fallbackSeeders and legacy seeders payloads', async () => {
  const h1 = '1111111111111111111111111111111111111111';
  const h2 = '2222222222222222222222222222222222222222';
  const h3 = '3333333333333333333333333333333333333333';
  const h4 = '4444444444444444444444444444444444444444';

  const res = await checkBatch([
    { infoHash: h1, fallbackSeeders: 40, hasMeta: true },
    { infoHash: h2, seeders: 0, hasMeta: true, corroborated: false },
    { infoHash: h3, corroborated: true, hasMeta: false },
    { infoHash: h4, instant: true, cached: true },
  ], { disableNetwork: true });

  assert.equal(res[h1].level, 'green');
  assert.equal(res[h1].seeders, 40);
  assert.equal(res[h2].level, 'red');
  assert.equal(res[h3].level, 'yellow');
  assert.equal(res[h4].level, 'green');
  assert.equal(res[h4].instant, true);
});

test('phase3: mpv & libmpv options enforce safe custom conf allowlist, hwAccel, buffer presets & subStyle', () => {
  const parsed = parseSafeMpvConf([
    '# comment',
    'deband=yes',
    'sharpen=0.5',
    'script=evil.lua',
    'input-ipc-server=\\\\.\\pipe\\hijack',
    'run=calc.exe',
  ].join('\n'));
  assert.deepEqual(parsed, [['deband', 'yes'], ['sharpen', '0.5']]);

  const args = buildMpvArgs({
    fontsDir: null,
    hwAccel: false,
    hdrMode: 'sdr',
    toneMapping: 'bt.2390',
    bufferSize: 'large',
    anime4k: true,
    subFilterSdh: true,
    subLang2: 'Japanese',
    subStyle: { font: 'Cairo', color: '#E5A93C', bold: true, sizePct: 120, bottomPct: 10, align: 'center', background: 'bar', outlinePx: 2, opacityPct: 90 },
    customMpvConf: 'deband=no\nscript=blocked.lua',
  });
  assert.ok(args.includes('--hwdec=no'));
  assert.ok(args.includes('--target-colorspace-hint=no'));
  assert.ok(args.includes('--tone-mapping=bt.2390'));
  assert.ok(args.includes('--demuxer-max-bytes=512MiB'));
  assert.ok(args.includes('--demuxer-max-back-bytes=128MiB'));
  assert.ok(args.includes('--sub-filter-sdh=yes'));
  assert.ok(args.includes('--sub-font=Cairo'));
  assert.ok(args.includes('--sub-border-style=opaque-box'));
  assert.ok(args.includes('--slang=ar,ara,arabic,jpn,en,eng'));
  assert.ok(!args.some((x) => x.includes('script=')));

  const emb = Object.fromEntries(buildLibMpvOptions({
    fontsDir: null,
    hwAccel: false,
    bufferSize: 'large',
    toneMapping: 'hable',
    customMpvConf: 'sharpen=0.4\nrun=evil',
  }));
  assert.equal(emb.vo, 'gpu-next');
  assert.equal(emb['gpu-api'], 'd3d11');
  assert.equal(emb['d3d11-flip'], 'yes');
  assert.equal(emb['video-sync'], 'audio');
  assert.equal(emb.interpolation, 'no');
  assert.equal(emb['sub-font'], 'IBM Plex Sans Arabic');
  assert.equal(emb.hwdec, 'no');
  assert.equal(emb['demuxer-max-bytes'], '512MiB');
  assert.equal(emb['tone-mapping'], 'hable');
  assert.equal(emb.sharpen, '0.4');
  assert.equal(emb.run, undefined);
  assert.ok(!emb['stream-lavf-o'].includes('reconnect_streamed'));

  const smooth = Object.fromEntries(buildLibMpvOptions({
    fontsDir: null,
    motionInterpolation: true,
    renderer: 'gpu',
    displayHdr: true,
    hdrMode: 'hdr-embedded',
  }));
  assert.equal(smooth.vo, 'gpu');
  assert.equal(smooth['video-sync'], 'display-resample');
  assert.equal(smooth.interpolation, 'yes');
  assert.equal(smooth.tscale, 'oversample');
  assert.equal(smooth['target-colorspace-hint'], 'yes');

  assert.equal(normalizeSubLang2('off'), '');
  assert.equal(normalizeSubLang2('Japanese'), 'jpn');
  assert.ok(subStyleToMpvOpts({ font: 'Tajawal', bold: true }).some(([k, v]) => k === 'sub-font' && v === 'Tajawal'));
});

test('phase3: sub-rtl stripSdhTags removes SDH cues while keeping indices, timestamps, and RTL isolation', async () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    '[DRAMATIC MUSIC] NARRATOR: (SIGHS) ♪ La la ♪ مرحبا يا صديقي!',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    'MAN: Hello there',
  ].join('\n');

  const stripped = stripSdhTags(srt);
  assert.ok(!stripped.includes('DRAMATIC MUSIC'));
  assert.ok(!stripped.includes('SIGHS'));
  assert.ok(!stripped.includes('La la'));
  assert.ok(!stripped.includes('MAN:'));
  assert.ok(stripped.includes('00:00:01,000 --> 00:00:03,000'));
  assert.ok(stripped.includes('مرحبا يا صديقي!'));

  const shaped = isolateArabicSrt(stripped);
  assert.ok(shaped.includes('\u202B'));
  assert.ok(shaped.includes('\u202C'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p3sub-'));
  try {
    const f = path.join(dir, 'test.ar.srt');
    fs.writeFileSync(f, srt, 'utf8');
    const outFile = await prepareSubtitleFile(f, 'ar', path.join(dir, 'out'), { stripSdh: true });
    const body = fs.readFileSync(outFile, 'utf8');
    assert.ok(!body.includes('SIGHS'));
    assert.ok(body.includes('\u202B'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase3: ranking handles safetyFilter, resultOrder, streamPriorityOrder, bingeGroup, and archive/external facts', () => {
  const arFacts = facts({ name: 'Archive', zipUrls: ['https://example.com/movie.zip'] });
  assert.equal(arFacts.archive, true);
  assert.equal(arFacts.external, false);

  const extFacts = facts({ name: 'Browser', externalUrl: 'https://example.com/watch' });
  assert.equal(extFacts.external, true);

  const zeroSeed = { stream: { name: 'A', title: 'Movie.1080p\n👤 0 💾 2 GB', infoHash: 'a'.repeat(40) }, addon: { url: 'https://a/manifest.json', name: 'A' }, addonRank: 1 };
  const healthy = { stream: { name: 'B', title: 'Movie.1080p\n👤 20 💾 2 GB', infoHash: 'b'.repeat(40) }, addon: { url: 'https://b/manifest.json', name: 'B' }, addonRank: 0 };

  assert.equal(rank([zeroSeed], { safetyFilter: 'strict' })[0].trusted, false);
  assert.equal(rank([zeroSeed], { safetyFilter: 'balanced' })[0].trusted, true);
  assert.equal(rank([zeroSeed], { safetyFilter: 'off' })[0].trusted, true);

  const addonOrdered = rank([zeroSeed, healthy], { resultOrder: 'addon', safetyFilter: 'off' });
  assert.equal(addonOrdered[0].addon.name, 'B');
  assert.equal(addonOrdered[1].addon.name, 'A');

  const direct = { stream: { name: 'Direct', title: 'Movie.1080p', url: 'https://cdn.example/m.mkv' }, addon: { url: 'https://a/manifest.json', name: 'DirectAddon' }, addonRank: 0 };
  const srv = { stream: { name: 'NAS', title: 'Movie.1080p', url: 'http://192.168.1.10:8096/s.mkv' }, addon: { url: 'homeserver://nas', name: 'Jellyfin' }, addonRank: 1 };
  const prioSrv = rank([direct, srv], { maxHeight: 1080, streamPriorityOrder: ['Server', 'Direct', 'Debrid', 'Addon'] });
  assert.equal(prioSrv[0].addon.name, 'Jellyfin');

  const bg1 = { stream: { name: 'Rel1', title: 'Show.S01E05.1080p\n👤 50', infoHash: 'c'.repeat(40), behaviorHints: { bingeGroup: 'group-A' } }, addon: { url: 'u1', name: 'U1' }, addonRank: 0 };
  const bg2 = { stream: { name: 'Rel2', title: 'Show.S01E05.1080p\n👤 900', infoHash: 'd'.repeat(40), behaviorHints: { bingeGroup: 'group-B' } }, addon: { url: 'u2', name: 'U2' }, addonRank: 0 };
  assert.equal(rank([bg2, bg1], { bingeGroup: 'group-A', resultOrder: 'addon' })[0].stream.behaviorHints.bingeGroup, 'group-A');
});

test('phase3: StreamsBucket persists StreamItemState and looks back across series episodes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-bucket-'));
  try {
    const file = path.join(dir, 'streams-bucket.json');
    const b1 = new StreamsBucket(file);
    b1.saveItemState('tt7654321', { subDelay: -0.4, subSpeed: 23.976 / 25, subFont: 'Cairo', subBold: true, subFilterSdh: true });
    b1.record('tt7654321', 'tt7654321:1:3', { stream: { behaviorHints: { bingeGroup: 'FLUX-1080p', filename: 'ep3.mkv' } }, addonUrl: 'https://addon/manifest.json' });

    const b2 = new StreamsBucket(file);
    const st = b2.getItemState('tt7654321');
    assert.equal(st.subDelay, -0.4);
    assert.equal(st.subFont, 'Cairo');
    assert.equal(st.subBold, true);
    assert.equal(st.subFilterSdh, true);

    const hint = b2.hintFor('tt7654321', 'tt7654321:1:5', ['tt7654321:1:1', 'tt7654321:1:2', 'tt7654321:1:3', 'tt7654321:1:4', 'tt7654321:1:5']);
    assert.equal(hint.bingeGroup, 'FLUX-1080p');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase3: KEY_NAMES, i18n parity & hygiene, and preload IPC allowlist hold cleanly', () => {
  const hubSrc = fs.readFileSync(path.join(__dirname, '../src/main/media/hub.js'), 'utf8');
  for (const k of ['omdb', 'tvdb', 'topposters', 'simkl', 'debridlink', 'subdl', 'subsource', 'introdb']) {
    assert.ok(hubSrc.includes(`'${k}'`), `hub.js KEY_NAMES missing ${k}`);
  }

  const i18nSrc = fs.readFileSync(path.join(__dirname, '../media/src/i18n.ts'), 'utf8');
  assert.ok(!/[٠-٩]/.test(i18nSrc), 'i18n.ts must never contain Arabic-Indic numerals [٠-٩]');
  const arBlock = i18nSrc.slice(i18nSrc.indexOf('ar: {'), i18nSrc.indexOf('en: {'));
  assert.ok(!/[<>]/.test(arBlock), 'Arabic strings must not contain raw < or > symbols');

  const preloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  for (const ch of ['cin:addon-check-url', 'cin:player-probes', 'cin:p2p-status', 'win:start-drag']) {
    assert.ok(preloadSrc.includes(`'${ch}'`), `preload.js missing ${ch}`);
  }
  const theaterPreloadSrc = fs.readFileSync(path.join(__dirname, '../src/preload/preload-theater.js'), 'utf8');
  for (const ch of ['win:start-drag', 'theater:html5-event', 'win:minimize', 'win:close']) {
    assert.ok(theaterPreloadSrc.includes(`'${ch}'`), `preload-theater.js missing ${ch}`);
  }
});
