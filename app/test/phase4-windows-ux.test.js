'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');
const { Library } = require('../src/main/media/library');
const { Meta } = require('../src/main/media/meta');
const { computeCinemaDashboard, localDayKey } = require('../src/main/media/stats');

function withMockElectron(mockElectron, fn) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return mockElectron;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    return fn();
  } finally {
    Module._load = origLoad;
  }
}

test('phase4 thumbar: creates valid 24x24 RGBA PNGs and manages Win32 taskbar buttons with cache', () => {
  const thumbarPath = require.resolve('../src/main/thumbar');
  const setCalls = [];
  const mockElectron = {
    nativeImage: {
      createFromBuffer: (buf) => ({ isMockImg: true, len: buf.length }),
    },
  };

  let thumbar;
  withMockElectron(mockElectron, () => {
    delete require.cache[thumbarPath];
    thumbar = require(thumbarPath);
  });

  try {
    for (const k of ['prev', 'play', 'pause', 'next']) {
      const png = thumbar.createIconPng(k);
      assert.ok(Buffer.isBuffer(png));
      // PNG signature
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      // IHDR width/height 24x24
      assert.equal(png.readUInt32BE(16), 24);
      assert.equal(png.readUInt32BE(20), 24);
    }

    const mockWin = {
      isDestroyed: () => false,
      setThumbarButtons: (btns) => { setCalls.push(btns); return true; },
    };

    if (process.platform === 'win32') {
      assert.equal(thumbar.updateThumbar(mockWin, { open: true, paused: false, hasNext: true, lang: 'ar' }), true);
      assert.equal(setCalls.length, 1);
      assert.equal(setCalls[0].length, 3);
      assert.match(setCalls[0][1].tooltip, /إيقاف/);

      // Duplicate call is cached
      assert.equal(thumbar.updateThumbar(mockWin, { open: true, paused: false, hasNext: true, lang: 'ar' }), false);
      assert.equal(setCalls.length, 1);

      // English paused state updates buttons
      assert.equal(thumbar.updateThumbar(mockWin, { open: true, paused: true, hasNext: false, lang: 'en' }), true);
      assert.equal(setCalls.length, 2);
      assert.equal(setCalls[1][1].tooltip, 'Play');
      assert.equal(setCalls[1][2].tooltip, 'Forward 10s');

      // resetCache allows re-applying identical state
      thumbar.resetCache(mockWin);
      assert.equal(thumbar.updateThumbar(mockWin, { open: true, paused: true, hasNext: false, lang: 'en' }), true);
      assert.equal(setCalls.length, 3);

      // Closing theater clears buttons to []
      assert.equal(thumbar.updateThumbar(mockWin, { open: false }), true);
      assert.deepEqual(setCalls[3], []);
    }
  } finally {
    delete require.cache[thumbarPath];
  }
});

test('phase4 stats: computeCinemaDashboard computes totals, streaks, monthly chart, rankings & avgRating', () => {
  const now = new Date('2026-11-20T12:00:00');
  const dayOffset = (dAgo) => localDayKey(now.getTime() - dAgo * 86400000);

  const watchLog = {
    [dayOffset(0)]: 90 * 60000,   // today: 1.5h
    [dayOffset(1)]: 60 * 60000,   // yesterday: 1h
    [dayOffset(2)]: 30 * 60000,   // 2d ago: 0.5h => current streak 3d
    // gap at dayOffset(3)
    [dayOffset(10)]: 45 * 60000,
    [dayOffset(11)]: 45 * 60000,
    [dayOffset(12)]: 45 * 60000,
    [dayOffset(13)]: 45 * 60000,  // older streak 4d
  };

  const res = computeCinemaDashboard({
    now,
    watchLog,
    items: {
      tt1: {
        _id: 'tt1',
        type: 'movie',
        name: 'Interstellar',
        runtimeMin: 169,
        genres: ['Sci-Fi', 'Drama'],
        directors: [{ id: 525, name: 'Christopher Nolan' }],
        cast: [{ id: 10297, name: 'Matthew McConaughey' }],
        state: { flaggedWatched: 1, overallTimeWatched: 120 * 60000, lastWatched: '2026-11-20T10:00:00.000Z' },
      },
      tt2: {
        _id: 'tt2',
        type: 'series',
        name: 'Dark',
        runtimeMin: 55,
        genres: ['Sci-Fi', 'Mystery'],
        directors: ['Baran bo Odar'],
        cast: ['Louis Hofmann'],
        state: { majlisWatched: ['tt2:1:1', 'tt2:1:2'], overallTimeWatched: 90 * 60000, lastWatched: '2026-11-19T10:00:00.000Z' },
      },
    },
    ratings: [{ score: 9 }, { score: 7 }],
  });

  // logMsTotal = 360 min = 6h (> itemMsTotal 210 min)
  assert.equal(res.totalMinutes, 360);
  assert.equal(res.totalHours, 6);
  assert.equal(res.moviesWatched, 1);
  assert.equal(res.episodesWatched, 2);
  assert.equal(res.currentStreak, 3);
  assert.equal(res.longestStreak, 4);
  assert.equal(res.monthlyHours.length, 12);
  assert.equal(res.monthlyHours[11].ym, '2026-11');
  assert.equal(res.monthlyHours[11].hours, 6);
  assert.equal(res.topGenres[0].name, 'Sci-Fi');
  assert.equal(res.topGenres[0].count, 2);
  assert.equal(res.topDirectors[0].name, 'Christopher Nolan');
  assert.equal(res.topActors[0].name, 'Matthew McConaughey');
  assert.equal(res.avgRating, 8);
});

test('phase4 library: persists enriched metadata and daily watchLog across reload', (t) => {
  let saved = null;
  const lib = new Library({ load: () => saved, save: (d) => { saved = d; } });
  t.after(() => clearTimeout(lib.timer));

  lib.add({
    id: 'tt0816692',
    type: 'movie',
    name: 'Interstellar',
    poster: 'p.jpg',
    year: 2014,
    genres: ['Sci-Fi', 'Adventure'],
    runtime: '169 min',
    imdbRating: '8.7',
    directors: [{ id: 525, name: 'Christopher Nolan' }],
    cast: [{ id: 10297, name: 'Matthew McConaughey' }],
  });
  lib.progress(
    { id: 'tt0816692', type: 'movie', name: 'Interstellar', poster: 'p.jpg' },
    'tt0816692',
    25000,
    169 * 60000,
    25000,
  );
  lib.progress(
    { id: 'tt0816692', type: 'movie', name: 'Interstellar', poster: 'p.jpg' },
    'tt0816692',
    50000,
    169 * 60000,
    25000,
  );
  lib.flush();

  const reloaded = new Library({ load: () => saved, save: () => {} });
  t.after(() => clearTimeout(reloaded.timer));

  const item = reloaded.get('tt0816692');
  assert.equal(item.year, 2014);
  assert.deepEqual(item.genres, ['Sci-Fi', 'Adventure']);
  assert.equal(item.runtimeMin, 169);
  assert.equal(item.imdbRating, 8.7);
  assert.deepEqual(item.directors, [{ id: 525, name: 'Christopher Nolan' }]);
  assert.deepEqual(item.cast, [{ id: 10297, name: 'Matthew McConaughey' }]);

  const logEntries = Object.values(reloaded.watchLog || {});
  assert.ok(logEntries.some((ms) => ms === 50000));
});

test('phase4 meta: details() exposes director IDs/photos and person() merges dual Acting+Directing roles', async () => {
  const m = new Meta({ keys: () => ({ tmdb: 'fake-tmdb-key' }), lang: () => 'en' });
  m.tmdb = async (p) => {
    if (p.startsWith('/find/tt0047478')) {
      return { movie_results: [{ id: 42, media_type: 'movie' }] };
    }
    if (p.startsWith('/movie/42')) {
      return {
        id: 42,
        overview: 'Plot summary',
        credits: {
          cast: [{ id: 7, name: 'Actor One', character: 'Hero', profile_path: '/a.jpg' }],
          crew: [
            { id: 99, name: 'Kurosawa', job: 'Director', profile_path: '/d.jpg' },
            { id: 99, name: 'Kurosawa', job: 'Producer', profile_path: '/d.jpg' },
          ],
        },
        videos: { results: [] },
        similar: { results: [] },
        recommendations: { results: [] },
        keywords: { keywords: [] },
        images: { backdrops: [] },
      };
    }
    if (p.startsWith('/person/99')) {
      return {
        id: 99,
        name: 'Clint Eastwood',
        biography: 'Actor and Director',
        birthday: '1930-05-31',
        known_for_department: 'Directing',
        combined_credits: {
          cast: [{ id: 501, media_type: 'movie', title: 'Unforgiven', release_date: '1992-08-07', poster_path: '/u.jpg', character: 'Will Munny', vote_count: 4000 }],
          crew: [
            { id: 501, media_type: 'movie', title: 'Unforgiven', release_date: '1992-08-07', poster_path: '/u.jpg', job: 'Director', department: 'Directing', vote_count: 4000 },
            { id: 502, media_type: 'movie', title: 'Sully', release_date: '2016-09-09', poster_path: '/s.jpg', job: 'Director', department: 'Directing', vote_count: 3500 },
          ],
        },
      };
    }
    return {};
  };

  const detail = await m.details('movie', 'tt0047478', { id: 'tt0047478', type: 'movie', name: 'Seven Samurai' });
  assert.deepEqual(detail.director, ['Kurosawa']);
  assert.equal(detail.directors.length, 1);
  assert.equal(detail.directors[0].id, 99);
  assert.equal(detail.directors[0].name, 'Kurosawa');
  assert.match(detail.directors[0].photo, /\/d\.jpg$/);

  const person = await m.person(99);
  assert.equal(person.credits.length, 2);
  const dual = person.credits.find((c) => c.id === 'tmdb:movie:501');
  assert.ok(dual);
  assert.ok(dual.roles.includes('cast'));
  assert.ok(dual.roles.includes('crew'));
  assert.ok(dual.jobs.includes('Director'));
  assert.equal(dual.character, 'Will Munny');
  assert.equal(dual.voteCount, 4000);
});

test('phase4 hub helpers: annotatePersonWatched & scrubDiagnosticsReport', () => {
  const hubPath = require.resolve('../src/main/media/hub');
  let hubMod;
  const mockElectron = { app: { getVersion: () => '0.1.0-beta' }, BrowserWindow: {}, dialog: {}, ipcMain: { handle() {} } };
  withMockElectron(mockElectron, () => {
    delete require.cache[hubPath];
    hubMod = require(hubPath);
  });

  try {
    const fakeLib = {
      items: {
        tt0133093: { _id: 'tt0133093', type: 'movie', name: 'The Matrix', year: 1999, state: { flaggedWatched: 1 } },
        tt0110912: { _id: 'tt0110912', type: 'movie', name: 'Pulp Fiction', year: 1994, state: { timeWatched: 10, duration: 100 } },
      },
      history: [{ id: 'tmdb:603', type: 'movie', name: 'The Matrix', year: 1999 }],
    };
    const out = hubMod.annotatePersonWatched(
      [
        { id: 'tt0133093', type: 'movie', name: 'The Matrix', year: 1999 },
        { id: 'tmdb:99999', type: 'movie', name: 'The Matrix', year: 1999 },
        { id: 'tmdb:88888', type: 'movie', name: 'Inception', year: 2010 },
        { id: 'tt0110912', type: 'movie', name: 'Pulp Fiction', year: 1994 },
      ],
      fakeLib,
      { 'inception-2010': { watched: true, name: 'Inception', year: 2010 } },
    );
    assert.equal(out[0].watched, true);
    assert.equal(out[1].watched, true);
    assert.equal(out[2].watched, true);
    assert.equal(out[3].watched, false);

    const dirty = {
      header: 'Authorization: Bearer super-secret-jwt-token-value',
      token: 'trakt_access_123456',
      userDir: path.join(os.homedir(), 'Videos', 'Majlis'),
      email: 'viewer@example.org',
      customKey: 'my-private-debrid-key-999',
    };
    const scrubbed = JSON.stringify(hubMod.scrubDiagnosticsReport(dirty, ['my-private-debrid-key-999']));
    assert.doesNotMatch(scrubbed, /super-secret-jwt-token-value/);
    assert.doesNotMatch(scrubbed, /trakt_access_123456/);
    assert.doesNotMatch(scrubbed, /viewer@example\.org/);
    assert.doesNotMatch(scrubbed, /my-private-debrid-key-999/);
    assert.doesNotMatch(scrubbed, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  } finally {
    delete require.cache[hubPath];
  }
});

test('phase4 incognito & diagnostics IPC: suppresses theater.info() + hub progress and executes diagnostics-run/heal', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p4-incog-'));
  const store = new Store(dir);
  const ipcHandlers = new Map();
  let incogOn = false;
  let clearedCaches = 0;
  let resetPlayers = 0;

  const mockScreen = new EventEmitter();
  mockScreen.getAllDisplays = () => [
    { id: 1, label: 'Built-in', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, label: 'LG OLED', bounds: { x: 1920, y: 0, width: 3840, height: 2160 } },
  ];
  mockScreen.getPrimaryDisplay = () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
  mockScreen.getDisplayMatching = () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } });

  const mockElectron = {
    app: { getVersion: () => '0.6.1', getPath: () => dir },
    BrowserWindow: class {},
    ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn), removeHandler: (ch) => ipcHandlers.delete(ch) },
    screen: mockScreen,
    dialog: {},
    powerSaveBlocker: { start: () => 1, stop: () => {} },
    clipboard: { writeText: () => {} },
    nativeImage: { createFromBuffer: () => ({}) },
    session: { defaultSession: { clearCache: async () => { clearedCaches++; } } },
  };

  const theaterPath = require.resolve('../src/main/theater');
  const hubPath = require.resolve('../src/main/media/hub');
  let theaterInst, hubInst;

  withMockElectron(mockElectron, () => {
    delete require.cache[theaterPath];
    delete require.cache[hubPath];
    const theaterMod = require(theaterPath);
    const hubMod = require(hubPath);
    const fakeWin = {
      isDestroyed: () => false,
      getBounds: () => ({ x: 10, y: 10, width: 1280, height: 720 }),
      isMaximized: () => false,
      unmaximize: () => {},
      setBounds: () => {},
      setFullScreen: () => {},
      webContents: { send: () => {} },
    };

    hubInst = hubMod.setup({
      store,
      dataDir: dir,
      openExternal: () => {},
      emit: () => {},
      getWin: () => fakeWin,
      isIncognito: () => incogOn,
      setIncognito: (v) => { incogOn = !!v; return incogOn; },
      getCacheManager: () => ({
        clear: async () => { clearedCaches++; return { ok: true }; },
        enforce: async () => ({ ok: true }),
        stats: async () => ({ totalBytes: 0, limitGb: 10 }),
      }),
      getDiagnosticsHooks: () => ({
        theater: () => ({ info: () => ({ id: 'x' }), close: () => { resetPlayers++; } }),
      }),
    });

    theaterInst = theaterMod.setup({
      getWin: () => fakeWin,
      store,
      emit: () => {},
      preload: '',
      theaterPreload: '',
      rendererDir: '',
      getHost: () => null,
      getGuest: () => null,
      getMediaHub: () => hubInst,
      isIncognito: () => incogOn,
    });
  });

  t.after(() => {
    try { theaterInst?.stop(true); } catch {}
    try { hubInst?.flush?.(); } catch {}
    try { store.flush(); } catch {}
    delete require.cache[theaterPath];
    delete require.cache[hubPath];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cinIncog = ipcHandlers.get('cin:incognito-set');
  const cinHistory = ipcHandlers.get('cin:history');
  const cinDiagRun = ipcHandlers.get('cin:diagnostics-run');
  const cinDiagHeal = ipcHandlers.get('cin:diagnostics-heal');
  const cinStats = ipcHandlers.get('cin:cinema-stats');
  const playerCmd = ipcHandlers.get('player:cmd');
  assert.equal(typeof cinIncog, 'function');
  assert.equal(typeof playerCmd, 'function');

  const displays = await playerCmd(null, { cmd: 'displays' });
  assert.equal(displays.length, 2);
  assert.equal(displays[0].primary, true);

  // Toggle incognito on via IPC and verify suppression across theater, scrobbler & streamsBucket
  const togRes = await cinIncog(null, { on: true });
  assert.equal(togRes.on, true);
  assert.equal(theaterInst.info(), null);
  assert.equal(hubInst.scrobble('stop', { id: 'tt999', type: 'movie', name: 'Secret' }, 95), null);
  assert.equal(hubInst.streamsBucket.record('tt999', 'tt999', { url: 'https://example/stream.mkv' }), null);

  const histAfter = await cinHistory(null, {});
  assert.equal(histAfter.length, 0);

  // Diagnostics run & heal
  const diag = await cinDiagRun(null, {});
  assert.ok(Array.isArray(diag.checks) && diag.checks.length >= 6);
  assert.equal(typeof diag.version, 'string');

  const healAll = await cinDiagHeal(null, { fixId: 'heal_all' });
  assert.equal(healAll.ok, true);
  assert.ok(clearedCaches >= 1);

  const resetRes = await cinDiagHeal(null, { fixId: 'reset_player' });
  assert.equal(resetRes.ok, true);
  assert.ok(resetPlayers >= 1);
  assert.ok(resetRes.report && Array.isArray(resetRes.report.checks));

  const stats = await cinStats(null, {});
  assert.equal(stats.totalMinutes, 0);
  assert.equal(stats.monthlyHours.length, 12);
});

test('phase4 libraryFilter.ts: EN + AR compound queries, presets & removeSmartToken', () => {
  const esbuild = require('esbuild');
  const built = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'media', 'src', 'utils', 'libraryFilter.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', built.outputFiles[0].text);
  fn(mod.exports, require, mod);
  const { parseSmartQuery, matchesSmartQuery, removeSmartToken } = mod.exports;

  const matrix = { name: 'The Matrix', type: 'movie', year: 1999, genres: ['Action', 'Sci-Fi'], runtimeMin: 136, imdbRating: 8.7, watched: false };
  const shortComedy = { name: 'Quick Laugh', type: 'movie', year: 2022, genres: ['Comedy'], runtimeMin: 82, imdbRating: 7.6, watched: false };
  const longShow = { name: 'Epic Saga', type: 'series', year: 2021, genres: ['Drama'], runtimeMin: 55, imdbRating: 8.4, watched: true, inProgress: false };

  // English compound query
  const qEn = parseSmartQuery('sci-fi 90s 7.5+ unwatched');
  assert.equal(matchesSmartQuery(matrix, qEn), true);
  assert.equal(matchesSmartQuery(shortComedy, qEn), false);

  // Arabic compound query with genres, decade, rating & watch filter
  const qAr = parseSmartQuery('أكشن التسعينات أعلى من 7 غير مشاهد');
  assert.equal(matchesSmartQuery(matrix, qAr), true);
  assert.equal(matchesSmartQuery(longShow, qAr), false);

  // Runtime + type query in EN & AR
  assert.equal(matchesSmartQuery(shortComedy, 'movie <90m'), true);
  assert.equal(matchesSmartQuery(matrix, 'movie <90m'), false);
  assert.equal(matchesSmartQuery(shortComedy, 'فيلم أقصر من 90'), true);
  assert.equal(matchesSmartQuery(longShow, 'مشاهد بعد 2020'), true);

  // Chip token removal preserves remaining tokens
  assert.equal(removeSmartToken('sci-fi 90s unwatched', '90s'), 'sci-fi unwatched');
});

test('phase4 server-optional & signaling auth halt: zero traffic without server and immediate halt on access error', async () => {
  const { Net } = require('../src/main/net');
  const id = {
    id: '123456789',
    pkB64: Buffer.alloc(32, 1).toString('base64'),
    salt: 'salt',
    sign: () => Buffer.alloc(64, 2),
  };

  // 1) No server configured -> Net sets noServer=true, never sends signaling, and connect() fast-fails with no_server
  const emptySettings = new Map([['server', ''], ['udpPort', 0]]);
  const netNoSrv = new Net(id, { get: (k) => emptySettings.get(k) });
  let sentCount = 0;
  const origSignal = netNoSrv.signal.bind(netNoSrv);
  netNoSrv.signal = (obj) => { sentCount++; return origSignal(obj); };
  await netNoSrv.start();
  assert.equal(netNoSrv.noServer, true);
  assert.equal(netNoSrv.helloTimer, undefined);
  netNoSrv._hello();
  assert.equal(sentCount, 0);
  await assert.rejects(() => netNoSrv.connect('987654321'), (err) => err.code === 'no_server');
  netNoSrv.stop();

  // 2) Private server returns { t: 'error', e: 'access' } -> Net halts timers and emits server-error once
  const srvSettings = new Map([['server', '127.0.0.1:7700'], ['accessKey', 'wrong'], ['udpPort', 0]]);
  const netAuth = new Net(id, { get: (k) => srvSettings.get(k) });
  const errors = [];
  netAuth.on('server-error', (e) => errors.push(e));
  await netAuth.start();
  assert.ok(netAuth.helloTimer);

  // Trigger access error twice; only the first should emit and timers must be cleared
  netAuth._onSignal({ t: 'error', e: 'access' }, 'ws');
  netAuth._onSignal({ t: 'error', e: 'access' }, 'ws');
  assert.equal(netAuth.authFailed, true);
  assert.equal(netAuth.helloTimer, null);
  assert.equal(netAuth.wsRetryTimer, null);
  assert.deepEqual(errors, ['access']);

  let afterHaltSent = 0;
  netAuth.signal = () => { afterHaltSent++; return true; };
  netAuth._hello();
  assert.equal(afterHaltSent, 0);
  await assert.rejects(() => netAuth.connect('987654321'), (err) => err.code === 'server_access');
  netAuth.stop();
});
