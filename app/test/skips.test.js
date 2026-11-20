'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skipsForVideo } = require('../src/main/media/hub');

test('skipsForVideo merges IntroDB outro with TheIntroDB intro in parallel', async () => {
  const calls = [];
  const fakeHttp = {
    async json(url) {
      calls.push(url);
      if (url.startsWith('https://api.introdb.app/segments')) {
        return { intro: null, recap: null, outro: { start_ms: 2800000, end_ms: 2880000 } };
      }
      if (url.startsWith('https://api.theintrodb.org/v4/media')) {
        return {
          intro: [{ start_sec: 228.6, end_sec: 246.5 }],
          recap: [{ start_ms: 0, end_ms: 45000 }],
          credits: [{ start_sec: 2790, end_sec: 2880 }],
        };
      }
      return null;
    },
  };

  const out = await skipsForVideo({
    videoId: 'tt0903747:1:1',
    durationSec: 3480,
    httpClient: fakeHttp,
  });

  assert.ok(calls.some((u) => u.startsWith('https://api.introdb.app/')));
  assert.ok(calls.some((u) => u.startsWith('https://api.theintrodb.org/')));
  assert.deepStrictEqual(out, [
    { kind: 'recap', start: 0, end: 45 },
    { kind: 'op', start: 228.6, end: 246.5 },
    { kind: 'ed', start: 2800, end: 2880 },
  ]);
});

test('skipsForVideo supports TMDB episode IDs with metaImdbId and AniSkip on Season 2+', async () => {
  const fakeHttp = {
    async json(url) {
      if (url.startsWith('https://api.introdb.app/')) return null;
      if (url.startsWith('https://api.theintrodb.org/')) return null;
      if (url.startsWith('https://api.ani.zip/mappings?imdb_id=tt1234567')) {
        return { mappings: { mal_id: 9999 } };
      }
      if (url.startsWith('https://api.aniskip.com/v2/skip-times/9999/5')) {
        return {
          results: [
            { skipType: 'op', interval: { startTime: 85.2, endTime: 175.0 } },
            { skipType: 'ed', interval: { startTime: 1300.0, endTime: 1390.0 } },
          ],
        };
      }
      return null;
    },
  };

  const out = await skipsForVideo({
    videoId: 'tmdb:777:2:5',
    durationSec: 1420,
    metaImdbId: 'tt1234567',
    httpClient: fakeHttp,
  });

  assert.deepStrictEqual(out, [
    { kind: 'op', start: 85.2, end: 175.0 },
    { kind: 'ed', start: 1300.0, end: 1390.0 },
  ]);
});
