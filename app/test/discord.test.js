'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Discord, activity, joinTarget, frame, unframe, inviteLinks, resolveDiscordClientId, safeImage, safeAssetText } = require('../src/main/discord');

test('discord ipc frames survive being split and joined', () => {
  const a = frame(1, { cmd: 'X', n: 1 }), b = frame(3, { p: 2 });
  const both = Buffer.concat([a, b]);
  const half = unframe(both.subarray(0, a.length + 5));
  assert.deepStrictEqual(half.frames, [{ op: 1, data: { cmd: 'X', n: 1 } }]);
  const rest = unframe(Buffer.concat([half.rest, both.subarray(a.length + 5)]));
  assert.deepStrictEqual(rest.frames, [{ op: 3, data: { p: 2 } }]);
  assert.strictEqual(rest.rest.length, 0);
});

test('presence: watching shows Harbor-grade movie/series metadata, privacy toggles, and safe artwork', () => {
  const w = activity({ watching: { name: 'The Kid', poster: 'https://x/p.jpg', pos: 600, dur: 4080, paused: false, together: true }, hosting: { guests: 2, max: 8, mode: 'watch', since: 1 }, id: '123456789' });
  assert.strictEqual(w.status_display_type, 2);
  assert.strictEqual(w.details, 'The Kid'); assert.strictEqual(w.state, 'Watching together');
  assert.strictEqual(w.assets.large_image, 'https://x/p.jpg');
  assert.strictEqual(w.assets.small_image, 'majlis');
  assert.strictEqual(w.timestamps.end - w.timestamps.start, 4080 * 1000);
  assert.deepStrictEqual(w.party.size, [3, 8]);
  assert.strictEqual(joinTarget(w.secrets.join), '123456789');

  const ep = activity({
    watching: {
      seriesName: 'Breaking Bad',
      type: 'series',
      season: 5,
      episode: 14,
      epTitle: 'Ozymandias',
      poster: 'https://images.example.org/poster.jpg',
      still: 'https://images.example.org/still.jpg',
      pos: 120,
      dur: 2800,
      paused: false,
      together: false,
    },
  });
  assert.strictEqual(ep.details, 'Breaking Bad');
  assert.strictEqual(ep.state, 'S5 E14 · Ozymandias');
  assert.strictEqual(ep.assets.large_image, 'https://images.example.org/poster.jpg');
  assert.strictEqual(ep.assets.small_image, 'https://images.example.org/still.jpg');
  assert.strictEqual(ep.assets.small_text, 'Ozymandias');

  const movieYr = activity({ watching: { name: 'Dune: Part Two', year: '2024', pos: 10, dur: 100, paused: false } });
  assert.strictEqual(movieYr.details, 'Dune: Part Two (2024)');

  assert.strictEqual(activity({ watching: { name: 'Dune', paused: true, dur: 100 }, privacy: { showWhenPaused: false } }), null);
  const hidden = activity({ watching: { name: 'Secret Film', poster: 'https://x/p.jpg', dur: 100 }, privacy: { hideTitle: true } });
  assert.strictEqual(hidden.details, 'Watching on Majlis');
  assert.strictEqual(hidden.assets.large_image, 'majlis');

  const noPosterPref = activity({ watching: { name: 'Dune', poster: 'https://x/p.jpg', pos: 10, dur: 100 }, privacy: { showPoster: false, showTimestamp: false } });
  assert.strictEqual(noPosterPref.assets.large_image, 'majlis');
  assert.strictEqual(noPosterPref.timestamps, undefined);

  const browsing = activity({ browsing: true, privacy: { showBrowsing: true } });
  assert.strictEqual(browsing.details, 'Browsing Cinema');
  assert.strictEqual(activity({ browsing: true, privacy: { showBrowsing: false } }), null);

  assert.strictEqual(safeImage('https://127.0.0.1/p.jpg'), null);
  assert.strictEqual(safeImage('https://192.168.1.5/p.jpg'), null);
  assert.strictEqual(safeImage('https://discord.gg/abc'), null);
  assert.strictEqual(safeImage('http://cdn.example.org/a.jpg'), null);
  assert.strictEqual(safeAssetText('X', 'Majlis'), 'Majlis');

  const noPoster = activity({ watching: { name: 'Local', poster: 'file:///C:/film.mkv', pos: 1, dur: 10, paused: true } });
  assert.strictEqual(noPoster.assets.large_image, 'majlis');
  assert.strictEqual(noPoster.timestamps, undefined, 'no running clock while paused');
  assert.strictEqual(activity({}), null);
  assert.strictEqual(joinTarget('majlis:12'), null);
  assert.strictEqual(joinTarget('evil:123456789'), null);
});

test('discord: inviteLinks, client id fallback, and voice echo guard events', () => {
  assert.deepStrictEqual(inviteLinks('123456789'), { join: 'majlis://join/123456789', friend: 'majlis://friend/123456789' });
  assert.strictEqual(resolveDiscordClientId('', '123456789012345678'), '123456789012345678');
  assert.strictEqual(resolveDiscordClientId('bad', ''), null);

  const d = new Discord('123456789012345678');
  const seen = [];
  d.on('voice-active', (v) => seen.push(v.active));
  d._in({ op: 1, data: { evt: 'VOICE_SETTINGS_UPDATE', data: { deaf: false, mute: false, input: { device_id: 'mic1' } } } });
  d._in({ op: 1, data: { evt: 'VOICE_SETTINGS_UPDATE', data: { deaf: false, mute: true, input: { device_id: 'mic1' } } } });
  assert.deepStrictEqual(seen, [true, false]);
});
