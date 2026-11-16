'use strict';
// Game library: games the host added by hand plus whatever Steam has installed.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function regQuery(key, value) {
  return new Promise((res) => execFile('reg', ['query', key, '/v', value], { windowsHide: true, encoding: 'utf8' }, (e, out) => {
    if (e) return res(null);
    const m = out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
    res(m ? m[1].trim() : null);
  }));
}

function vdfPaths(text) {
  return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
}

function acf(text, key) { return (text.match(new RegExp(`"${key}"\\s+"([^"]*)"`)) || [])[1]; }

async function steamGames() {
  const steam = (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'))?.replace(/\//g, '\\');
  if (!steam || !fs.existsSync(steam)) return [];
  let libs = [steam];
  try { libs = [...new Set([steam, ...vdfPaths(fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8'))])]; } catch {}
  const out = [];
  for (const lib of libs) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const t = fs.readFileSync(path.join(dir, f), 'utf8');
        const appid = acf(t, 'appid'), name = acf(t, 'name');
        if (!appid || !name || /Steamworks|Redistributable|Proton|Steam Linux Runtime/i.test(name)) continue;
        out.push({ id: `steam:${appid}`, name, source: 'steam', appid, cover: steamCover(steam, appid) });
      } catch {}
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function steamCover(steam, appid) {
  const base = path.join(steam, 'appcache', 'librarycache');
  const cands = [path.join(base, `${appid}_library_600x900.jpg`), path.join(base, appid, 'library_600x900.jpg')];
  for (const c of cands) if (fs.existsSync(c)) return c;
  // newer Steam keeps images in hashed subfolders
  try {
    const d = path.join(base, appid);
    for (const sub of fs.readdirSync(d)) {
      const p = path.join(d, sub, 'library_600x900.jpg');
      if (fs.existsSync(p)) return p;
    }
    const any = fs.readdirSync(d).find((x) => /library_600x900/.test(x));
    if (any) return path.join(d, any);
  } catch {}
  return null;
}

module.exports = { steamGames };
