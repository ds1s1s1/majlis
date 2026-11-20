'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isYouTubeUrl, pickBitrate, setSong, clearSong, getSong, cacheFriendSong, MAX_BYTES } = require('../src/main/media/ytdlp');

test('ytdlp: validates strict YouTube URLs only', () => {
  assert.strictEqual(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=30'), true);
  assert.strictEqual(isYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.strictEqual(isYouTubeUrl('https://youtube.com/shorts/abcdef123'), true);
  assert.strictEqual(isYouTubeUrl('https://evil.example/watch?v=dQw4w9WgXcQ'), false);
  assert.strictEqual(isYouTubeUrl('file:///C:/Windows/System32/calc.exe'), false);
  assert.strictEqual(isYouTubeUrl('https://www.youtube.com/watch?v=x'), false);
});

test('ytdlp: pickBitrate steps down until <= 500 KB and rejects oversized clips', async () => {
  const tried = [];
  const res = await pickBitrate(async (kbps) => {
    tried.push(kbps);
    return kbps >= 96 ? 620 * 1024 : 380 * 1024;
  });
  assert.deepStrictEqual(tried, [96, 64]);
  assert.strictEqual(res.kbps, 64);
  assert.ok(res.bytes <= MAX_BYTES);

  await assert.rejects(() => pickBitrate(async () => MAX_BYTES + 1), /exceeds 500 KB/);
});

test('ytdlp: setSong, getSong, clearSong and cacheFriendSong round-trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-song-'));
  try {
    const out = await setSong({
      dataDir: dir,
      profile: 'ali',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      start: 42,
      getFfmpeg: () => 'ffmpeg',
      exec: async (bin, args) => {
        if (bin.includes('yt-dlp')) {
          const tpl = args[args.indexOf('-o') + 1];
          fs.writeFileSync(tpl.replace('%(ext)s', 'webm'), Buffer.from('raw-audio'));
        } else {
          const outFile = args[args.length - 1];
          fs.writeFileSync(outFile, Buffer.alloc(120 * 1024, 0x4f));
        }
        return { stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.bytes, 120 * 1024);
    assert.strictEqual(out.start, 42);
    const got = getSong({ dataDir: dir, profile: 'ali' });
    assert.ok(got && got.dataUrl.startsWith('data:audio/ogg;base64,'));
    assert.strictEqual(got.bytes, 120 * 1024);

    assert.strictEqual(cacheFriendSong({ dataDir: dir, friendId: '123456789', dataUrl: got.dataUrl }), true);
    assert.strictEqual(getSong({ dataDir: dir, friendId: '123456789' }).bytes, 120 * 1024);

    clearSong({ dataDir: dir, profile: 'ali' });
    assert.strictEqual(getSong({ dataDir: dir, profile: 'ali' }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
