'use strict';
// Runs majlis-media.exe (engine/majlis-media) and talks to it over its local HTTP API.
// It prints {"ready",port,key} on start and quits when our end of its stdin closes, so it never
// outlives the app. If it dies, the next call starts a new one.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_ADDONS = [
  'https://v3-cinemeta.strem.io/manifest.json',
  'https://catalog.ers.pw/manifest.json',          // Streaming Catalogs: Netflix, HBO, Disney+... rows
  'https://opensubtitles-v3.strem.io/manifest.json',
  'https://anime-kitsu.strem.fun/manifest.json',     // anime catalogs and Kitsu ids (what anime stream addons use)
];

function exePath() {
  for (const p of [path.join(process.resourcesPath || '', 'engine', 'majlis-media.exe'), path.join(__dirname, '../../../engine/target/release/majlis-media.exe')]) if (fs.existsSync(p)) return p;
  return null;
}

class MediaService {
  constructor() { this.ready = null; }

  _start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const exe = exePath();
      if (!exe) return reject(new Error('majlis-media.exe not found'));
      const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      this.p = p;
      let buf = '';
      const onData = (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i < 0) return;
        p.stdout.off('data', onData);
        try { const r = JSON.parse(buf.slice(0, i)); this.base = `http://127.0.0.1:${r.port}`; this.key = r.key; resolve(); } catch (e) { reject(e); }
      };
      p.stdout.on('data', onData);
      p.on('error', reject);
      p.on('exit', () => { this.p = null; this.ready = null; reject(new Error('majlis-media exited')); });
    });
    return this.ready;
  }

  async call(route, body) {
    await this._start();
    const r = await fetch(`${this.base}/${this.key}/${route}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `media ${r.status}`);
    return j;
  }

  // a stream path from /play as a URL mpv can open
  async url(p) { await this._start(); return this.base + p; }

  stop() { try { this.p?.stdin.end(); } catch {} }
}

module.exports = { MediaService, DEFAULT_ADDONS, exePath };
