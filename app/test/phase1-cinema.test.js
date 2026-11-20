'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CinemaDimmer } = require('../src/main/dimmer');
const { parseMultiEpisode, detectDoubleLength } = require('../src/main/media/multi-ep');
const { decodeSubtitleBuffer, stripSdhTags, prepareSubtitleFile } = require('../src/main/media/sub-rtl');
const { searchExternalSubtitles } = require('../src/main/media/sub-search');
const { StreamsBucket } = require('../src/main/media/streams-bucket');
const { detectDisplayProfile, VOICE_CLARITY, DISPLAY_PROFILES } = require('../src/main/theater');
const { Mpv, mpvPath } = require('../src/main/mpv');

test('phase1: CinemaDimmer places click-through overlays ONLY on secondary displays and clears cleanly', () => {
  const created = [];
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const sec1 = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
  const sec2 = { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
  const mockScreen = {
    listeners: new Map(),
    getAllDisplays: () => [primary, sec1, sec2],
    getDisplayMatching: () => primary,
    on(ev, fn) { this.listeners.set(ev, fn); },
    off(ev) { this.listeners.delete(ev); },
  };
  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.opacity = 1;
      this.ignoreMouse = null;
      this.shown = false;
      created.push(this);
    }
    setIgnoreMouseEvents(v, o) { this.ignoreMouse = { v, o }; }
    setOpacity(v) { this.opacity = v; }
    setBounds(b) { this.opts = { ...this.opts, ...b }; }
    loadURL(u) { this.url = u; }
    showInactive() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }

  const activeWin = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 100, width: 1280, height: 720 }) };
  const dimmer = new CinemaDimmer({ screen: mockScreen, BrowserWindow: FakeBrowserWindow });
  assert.equal(dimmer.secondaryCount(activeWin), 2);

  const res = dimmer.apply({ activeWin, opacity: 75 });
  assert.deepEqual(res, { active: true, opacity: 75, displays: 2 });
  assert.equal(created.length, 2);
  assert.equal(created[0].opts.x, 1920);
  assert.equal(created[1].opts.x, -1920);
  assert.equal(created[0].opacity, 0.75);
  assert.deepEqual(created[0].ignoreMouse, { v: true, o: { forward: true } });

  dimmer.apply({ activeWin, opacity: 40 });
  assert.equal(created[0].opacity, 0.4);

  const offRes = dimmer.apply({ activeWin, opacity: 0 });
  assert.deepEqual(offRes, { active: false, opacity: 0, displays: 0 });
  assert.equal(created[0].destroyed, true);
  assert.equal(created[1].destroyed, true);
  assert.equal(mockScreen.listeners.size, 0);
});

test('phase1: detectDisplayProfile detects OLED, HDR, and IPS panels accurately', () => {
  assert.equal(detectDisplayProfile({ label: 'LG C3 OLED TV', colorDepth: 24, colorSpace: 'srgb' }), 'oled');
  assert.equal(detectDisplayProfile({ label: 'Alienware AW3423DWF', colorDepth: 30, colorSpace: 'rgb' }), 'oled');
  assert.equal(detectDisplayProfile({ label: 'ASUS ProArt PA32UC', colorDepth: 30, colorSpace: 'hdr10' }), 'hdr');
  assert.equal(detectDisplayProfile({ label: 'Dell U2723QE', colorDepth: 24, colorSpace: 'srgb' }), 'ips');
  assert.ok(DISPLAY_PROFILES.oled && DISPLAY_PROFILES.hdr && DISPLAY_PROFILES.ips && DISPLAY_PROFILES.standard);
});

test('phase1: parseMultiEpisode & detectDoubleLength detect filename and runtime double episodes', () => {
  assert.deepEqual(parseMultiEpisode('Show.S01E01E02.1080p.WEB-DL.mkv'), {
    season: 1, startEp: 1, endEp: 2, episodes: [1, 2], count: 2,
  });
  assert.deepEqual(parseMultiEpisode('Anime - S02E10-E11 [1080p].mkv'), {
    season: 2, startEp: 10, endEp: 11, episodes: [10, 11], count: 2,
  });
  assert.deepEqual(parseMultiEpisode('Series.1x03-04.mkv'), {
    season: 1, startEp: 3, endEp: 4, episodes: [3, 4], count: 2,
  });
  assert.equal(parseMultiEpisode('Normal.S01E05.mkv'), null);

  const eps = [
    { id: 'tt1:1:1', season: 1, episode: 1, name: 'Pilot' },
    { id: 'tt1:1:2', season: 1, episode: 2, name: 'Part Two' },
    { id: 'tt1:1:3', season: 1, episode: 3, name: 'Normal Next' },
  ];
  const byFile = detectDoubleLength({
    durationSec: 2700,
    expectedRuntimeMin: 24,
    filename: 'Frieren.S01E01E02.1080p.mkv',
    episodes: eps,
    currentVideoId: 'tt1:1:1',
  });
  assert.deepEqual(byFile, {
    isMulti: true,
    reason: 'filename',
    coveredIds: ['tt1:1:1', 'tt1:1:2'],
    rangeLabel: 'S01E01–E02',
    nextAfterId: 'tt1:1:3',
  });

  const byRuntime = detectDoubleLength({
    durationSec: 5400,
    expectedRuntimeMin: 45,
    filename: 'Finale.mkv',
    episodes: eps,
    currentVideoId: 'tt1:1:1',
  });
  assert.deepEqual(byRuntime, {
    isMulti: true,
    reason: 'runtime',
    coveredIds: ['tt1:1:1', 'tt1:1:2'],
    rangeLabel: 'S01E01–E02',
    nextAfterId: 'tt1:1:3',
  });
});

test('phase1: decodeSubtitleBuffer fixes Windows-1256 & mojibake Arabic, stripSdhTags strips Arabic/English SDH cues cleanly', async () => {
  // Windows-1256 encoded bytes for "مرحبا بالعالم"
  const cp1256Bytes = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7, 0x20, 0xC8, 0xC7, 0xE1, 0xDA, 0xC7, 0xE1, 0xE3]);
  assert.equal(decodeSubtitleBuffer(cp1256Bytes, 'ar'), 'مرحبا بالعالم');

  // Double-encoded UTF-8-as-Latin1 Arabic mojibake for "مرحبا"
  const utf8Buf = Buffer.from('مرحبا', 'utf8');
  const mojibakeStr = [...utf8Buf].map((b) => String.fromCharCode(b)).join('');
  assert.equal(decodeSubtitleBuffer(Buffer.from(mojibakeStr, 'utf8'), 'ar'), 'مرحبا');

  const rawSrt = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    '[موسيقى هادئة]',
    '',
    '2',
    '00:00:03,000 --> 00:00:05,000',
    'الراوي: [تنهيدة] (ضحك) ♪ أهلاً بكم في المجلس',
    '',
    '3',
    '00:00:06,000 --> 00:00:08,000',
    '[MUSIC PLAYING]',
  ].join('\n');
  const stripped = stripSdhTags(rawSrt);
  assert.ok(!stripped.includes('موسيقى هادئة'));
  assert.ok(!stripped.includes('MUSIC PLAYING'));
  assert.ok(!stripped.includes('الراوي:'));
  assert.ok(stripped.includes('أهلاً بكم في المجلس'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p1sub-'));
  try {
    const srcSrt = path.join(dir, 'legacy.srt');
    const cpSrt = Buffer.concat([Buffer.from('1\n00:00:01,000 --> 00:00:03,000\n', 'ascii'), cp1256Bytes, Buffer.from('\n', 'ascii')]);
    fs.writeFileSync(srcSrt, cpSrt);
    const out = await prepareSubtitleFile(srcSrt, 'ar', path.join(dir, 'out'), { stripSdh: true });
    const body = fs.readFileSync(out, 'utf8');
    assert.ok(body.includes('مرحبا بالعالم'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase1: searchExternalSubtitles merges providers, enforces HTTPS & non-private hosts, and prioritizes Arabic', async () => {
  const mockFetch = async (url) => {
    if (String(url).includes('sub.wyzie.ru')) {
      return {
        ok: true,
        json: async () => [
          { id: 'w1', url: 'https://sub.wyzie.ru/file/1.srt', language: 'ar', display: 'Arabic Wyzie Bluray' },
          { id: 'w2', url: 'http://127.0.0.1/evil.srt', language: 'ar', display: 'Blocked HTTP Local' },
          { id: 'w3', url: 'https://sub.wyzie.ru/file/2.srt', language: 'en', display: 'English Wyzie' },
        ],
      };
    }
    if (String(url).includes('api.subdl.com')) {
      return {
        ok: true,
        json: async () => ({
          subtitles: [
            { url: '/s/subdl1.srt', lang: 'en', release_name: 'SubDL WEB-DL' },
            { url: 'https://sub.wyzie.ru/file/1.srt', lang: 'ar', release_name: 'Duplicate URL' },
          ],
        }),
      };
    }
    return { ok: false, json: async () => [] };
  };

  const results = await searchExternalSubtitles({
    imdbId: 'tt1375666',
    lang: 'all',
    keys: { subdl: 'test-key' },
    addonSubs: [{ url: 'https://addons.example.org/s.srt', lang: 'ar', title: 'OpenSubtitles Addon' }],
    fetchImpl: mockFetch,
  });

  assert.equal(results.some((x) => x.url.includes('127.0.0.1')), false);
  assert.equal(results.filter((x) => x.url === 'https://sub.wyzie.ru/file/1.srt').length, 1);
  assert.equal(results[0].lang, 'ar');
  assert.ok(results.some((x) => x.addon === 'SubDL' && x.url === 'https://dl.subdl.com/subtitle/s/subdl1.srt'));
  assert.ok(results.some((x) => x.url === 'https://addons.example.org/s.srt'));
});

test('phase1: StreamsBucket persists full per-title player settings memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p1-bucket-'));
  try {
    const sb = new StreamsBucket(path.join(dir, 'bucket.json'));
    sb.saveItemState('tt0816692', {
      volume: 135,
      aspect: '21:9',
      panscan: 1,
      audioDelay: 0.25,
      voiceClarity: true,
      warmTint: 45,
      audioLang: 'jpn',
    });
    const reloaded = new StreamsBucket(path.join(dir, 'bucket.json'));
    assert.deepEqual(reloaded.getItemState('tt0816692'), {
      volume: 135,
      aspect: '21:9',
      panscan: 1,
      audioDelay: 0.25,
      voiceClarity: true,
      warmTint: 45,
      audioLang: 'jpn',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase1: real mpv accepts VOICE_CLARITY lavfi audio filter cleanly', { skip: !mpvPath() && 'mpv not available' }, async () => {
  const m = new Mpv({ args: ['--force-window=no', '--vo=null', '--ao=null'] });
  await m.start();
  try {
    await m.load('av://lavfi:sine=frequency=440:duration=10');
    await m.command('af', 'set', VOICE_CLARITY);
    await new Promise((r) => setTimeout(r, 350));
    const afs = await m.get('af');
    assert.ok(Array.isArray(afs) && afs.some((f) => f.label === 'voice'), 'VOICE_CLARITY filter must be accepted by mpv');
    await m.command('af', 'set', '');
  } finally {
    m.stop();
  }
});
