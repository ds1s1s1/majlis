'use strict';
// Downloads TTF/variable subtitle & Arabic UI fonts into engine/vendor/fonts so libass / libmpv
// renders crisp Arabic & Latin subtitles offline on every Windows machine without falling back.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../engine/vendor/fonts');
const FONTS = [
  {
    name: 'IBMPlexSansArabic-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf',
  },
  {
    name: 'IBMPlexSansArabic-SemiBold.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-SemiBold.ttf',
  },
  {
    name: 'IBMPlexSansArabic-Bold.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf',
  },
  {
    name: 'Vazirmatn[wght].ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/vazirmatn/Vazirmatn%5Bwght%5D.ttf',
  },
];

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let fetched = 0;
  for (const font of FONTS) {
    const dest = path.join(DIR, font.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 16000) continue;
    const res = await fetch(font.url, { headers: { 'User-Agent': 'Majlis-Sidecar-Fetch' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Failed downloading font ${font.name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 16000) throw new Error(`Font ${font.name} unexpectedly small (${buf.length} bytes)`);
    fs.writeFileSync(dest, buf);
    fetched++;
  }
  fs.writeFileSync(path.join(DIR, 'OFL.txt'), [
    'IBM Plex Sans Arabic & Vazirmatn are licensed under the SIL Open Font License 1.1.',
    'Bundled for libass / libmpv subtitle rendering in Majlis.',
  ].join('\r\n'));
  console.log(fetched > 0 ? `Downloaded ${fetched} fonts into ${DIR}` : `Subtitle fonts ready in ${DIR}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
