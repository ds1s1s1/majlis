'use strict';
// Downloads yt-dlp (pinned release, SHA-256 checked) into engine/vendor/ytdlp so profile songs
// can extract a 30 s Opus clip without bundling or downloading unverified executables at runtime.
// Run once before packaging: npm run ytdlp
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const URL = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe';
const SHA256 = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d';
const DIR = path.join(__dirname, '../../engine/vendor/ytdlp');

(async () => {
  const exe = path.join(DIR, 'yt-dlp.exe');
  if (fs.existsSync(exe)) {
    const cur = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    if (cur === SHA256) { console.log('yt-dlp already in', DIR); return; }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const r = await fetch(URL, { headers: { 'user-agent': 'Majlis' } });
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== SHA256) throw new Error(`checksum mismatch: ${sum}`);
  const tmp = exe + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, exe);
  fs.writeFileSync(path.join(DIR, 'LICENSE-ytdlp.txt'), [
    'yt-dlp (https://github.com/yt-dlp/yt-dlp) is dedicated to the public domain under The Unlicense.',
    'Pinned release: 2026.10.26 (SHA-256 verified before packaging).',
    'Majlis runs yt-dlp as a separate helper program; it is not linked into Majlis.',
  ].join('\r\n'));
  console.log('yt-dlp ready in', DIR);
})().catch((e) => { console.error(e.message); process.exit(1); });
