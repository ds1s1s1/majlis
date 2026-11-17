'use strict';
// Bringing a viewer's history in: their Stremio account (addons + library, one-time, nothing of
// the login is kept) and their Letterboxd export (watched, ratings, watchlist from the ZIP that
// Letterboxd's settings page gives out; we don't scrape their site).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STREMIO = 'https://api.strem.io/api';

async function stremioCall(method, body) {
  const r = await fetch(`${STREMIO}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || String(j.error));
  return j.result;
}

// addons (their manifest URLs, in the user's order) and library items worth keeping
async function stremioImport(email, password) {
  const { authKey } = await stremioCall('login', { type: 'Login', email, password, facebook: false });
  try {
    const col = await stremioCall('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
    const lib = await stremioCall('datastoreGet', { type: 'DatastoreGet', authKey, collection: 'libraryItem', ids: [], all: true });
    return { addons: (col.addons || []).map((a) => a.transportUrl).filter((u) => /^https?:\/\//.test(u)), library: stremioLibrary(lib) };
  } finally {
    stremioCall('logout', { type: 'Logout', authKey }).catch(() => {});
  }
}

// Stremio library items -> { id, type, name, poster, watched, t, d, at }
function stremioLibrary(items) {
  return (items || []).filter((x) => !x.removed && x._id && x.type).map((x) => {
    const s = x.state || {};
    return { id: x._id, type: x.type, name: x.name, poster: x.poster || null, watched: (s.timesWatched || 0) > 0 || !!s.flaggedWatched, t: (s.timeOffset || 0) / 1000, d: (s.duration || 0) / 1000, at: Date.parse(s.lastWatched || x._mtime || 0) || 0, video: s.video_id || null };
  });
}

// RFC 4180-ish CSV (quoted fields, doubled quotes, commas and newlines inside quotes)
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...rest] = rows.filter((r) => r.some((x) => x !== ''));
  return rest.map((r) => Object.fromEntries((head || []).map((h, i) => [h.trim(), r[i] ?? ''])));
}

// films keyed "name|year" (Letterboxd has no IMDb ids in its export): matched to titles by name and year
function letterboxdKey(name, year) { return `${String(name || '').trim().toLowerCase()}|${String(year || '').trim()}`; }

function letterboxdFrom(files) {
  const out = {};
  const get = (r) => (out[letterboxdKey(r.Name, r.Year)] ||= { name: r.Name, year: r.Year, uri: r['Letterboxd URI'] });
  for (const r of csv(files['watched.csv'] || '')) get(r).watched = r.Date || true;
  for (const r of csv(files['ratings.csv'] || '')) { const e = get(r); e.rating = +r.Rating || null; e.watched ||= r.Date || true; }
  for (const r of csv(files['diary.csv'] || '')) { const e = get(r); e.watched ||= r['Watched Date'] || r.Date || true; if (r.Rating) e.rating ||= +r.Rating; }
  for (const r of csv(files['reviews.csv'] || '')) { const e = get(r); if (r.Review) e.review = r.Review.slice(0, 2000); }
  for (const r of csv(files['watchlist.csv'] || '')) get(r).watchlist = true;
  return out;
}

// the export ZIP from letterboxd.com/settings/data: Windows' own tar reads ZIP files
function letterboxdZip(zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-lb-'));
  try {
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', dir]);
    const files = {};
    for (const n of ['watched.csv', 'ratings.csv', 'diary.csv', 'reviews.csv', 'watchlist.csv']) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) files[n] = fs.readFileSync(p, 'utf8');
    }
    if (!Object.keys(files).length) throw new Error('not a Letterboxd export');
    return letterboxdFrom(files);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { stremioImport, stremioLibrary, csv, letterboxdFrom, letterboxdZip, letterboxdKey };
