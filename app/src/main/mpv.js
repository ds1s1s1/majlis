'use strict';
// The film player: mpv in its own process, drawn into a window we give it (--wid), driven over
// its JSON IPC pipe. Its own process so a bad file or a driver crash takes down the picture, not
// the app; a watchdog brings it back where it was.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const net = require('net');
const path = require('path');
const fs = require('fs');

function mpvPath() {
  const packaged = path.join(process.resourcesPath || '', 'mpv', 'mpv.exe');
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '../../../engine/vendor/mpv/mpv.exe');
  return fs.existsSync(dev) ? dev : null;
}

// What every film gets: GPU decode with a safe fallback, the modern renderer, a deep cache for
// instant seeks, speed changes without pitch changes (sync nudges playback 1-3%), Arabic first.
const BASE = [
  '--idle=yes', '--force-window=yes', '--keep-open=yes', '--no-config', '--osc=no', '--osd-level=0',
  '--input-default-bindings=no', '--input-vo-keyboard=no', '--cursor-autohide=no', '--no-terminal',
  '--hwdec=auto-safe', '--vo=gpu-next', '--gpu-api=d3d11',
  '--cache=yes', '--demuxer-max-bytes=512MiB', '--demuxer-max-back-bytes=128MiB', '--hr-seek=yes',
  '--audio-pitch-correction=yes', '--slang=ar,ara,arabic,en,eng', '--sub-auto=fuzzy',
  '--network-timeout=20', '--ytdl=no', '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5',
];

const WATCHED = ['time-pos', 'duration', 'pause', 'paused-for-cache', 'demuxer-cache-duration', 'speed', 'eof-reached', 'track-list', 'volume', 'sub-delay'];

class Mpv extends EventEmitter {
  constructor({ wid, exe = mpvPath(), args = [] } = {}) {
    super();
    this.exe = exe; this.wid = wid; this.args = args;
    this.reqs = new Map(); this.nextId = 1; this.props = {};
    this.restarts = 0; this.stopped = false; this.want = null; // what's loaded: { url, opts }
  }

  start() {
    if (!this.exe) throw new Error('mpv not found');
    this.stopped = false;
    this.pipe = `\\\\.\\pipe\\majlis-mpv-${process.pid}-${Date.now() % 1e6}`;
    const a = [...BASE, `--input-ipc-server=${this.pipe}`, ...this.args];
    if (this.wid) a.push(`--wid=${this.wid}`);
    this.p = spawn(this.exe, a, { windowsHide: !this.wid, stdio: 'ignore' });
    this.p.on('exit', (code) => {
      this.p = null; this.sock?.destroy(); this.sock = null;
      for (const r of this.reqs.values()) r.reject(new Error('mpv exited'));
      this.reqs.clear();
      if (!this.stopped) this._recover(`exit ${code}`);
    });
    return this._connect();
  }

  _connect(tries = 0) {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.pipe);
      s.once('connect', () => {
        this.sock = s; let buf = '';
        s.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) this._line(line); }
        });
        s.on('error', () => {});
        WATCHED.forEach((p, n) => this._send({ command: ['observe_property', n + 1, p] }));
        this._watch();
        this.emit('ready');
        resolve();
      });
      s.once('error', () => {
        s.destroy();
        if (!this.p || tries > 50) return reject(new Error('mpv pipe not reachable'));
        setTimeout(() => this._connect(tries + 1).then(resolve, reject), 100);
      });
    });
  }

  _line(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.request_id != null && this.reqs.has(m.request_id)) {
      const r = this.reqs.get(m.request_id); this.reqs.delete(m.request_id);
      return m.error === 'success' ? r.resolve(m.data) : r.reject(new Error(m.error));
    }
    if (m.event === 'property-change') {
      this.props[m.name] = m.data;
      if (m.name === 'time-pos' && m.data != null) { this.lastPos = m.data; this.posAt = Date.now(); }
      this.emit('prop', m.name, m.data);
    } else if (m.event) this.emit('event', m);
  }

  _send(o) { if (this.sock) this.sock.write(JSON.stringify(o) + '\n'); }

  command(...args) {
    if (!this.sock) return Promise.reject(new Error('mpv not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (this.reqs.delete(id)) reject(new Error(`mpv: ${args[0]} timed out`)); }, 10000);
      this.reqs.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this._send({ command: args, request_id: id });
    });
  }
  set(name, value) { return this.command('set_property', name, value); }
  get(name) { return this.command('get_property', name); }

  // `opts` are per-file options mpv applies on load (start, sub-files, http headers...)
  async load(url, opts = {}) {
    this.want = { url, opts };
    const o = Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',');
    return o ? this.command('loadfile', url, 'replace', -1, o) : this.command('loadfile', url, 'replace');
  }

  // Hung: playing, not waiting for data, yet the clock hasn't moved for 5 s. Or gone: exited.
  // Either way, a fresh mpv picks up at the same moment.
  _watch() {
    clearInterval(this.wd);
    this.posAt = Date.now();
    this.wd = setInterval(() => {
      const pr = this.props;
      const playing = this.want && pr.pause === false && !pr['paused-for-cache'] && !pr['eof-reached'];
      if (playing && Date.now() - this.posAt > 5000) this._recover('stalled');
    }, 1000);
  }

  async _recover(why) {
    if (this.recovering || this.stopped) return;
    if (this.restarts++ > 5) { this.emit('failed', why); return; }
    this.recovering = true;
    this.emit('recovering', why);
    clearInterval(this.wd);
    const at = this.lastPos || 0, want = this.want, paused = this.props.pause, speed = this.props.speed;
    try { this.p?.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try {
      await this.start();
      if (want) await this.load(want.url, { ...want.opts, start: `${at.toFixed(3)}` });
      if (paused) await this.set('pause', true);
      if (speed && speed !== 1) await this.set('speed', speed);
      this.emit('recovered', { why, at });
    } catch (e) { this.emit('failed', e.message); }
    this.recovering = false;
  }

  stop() {
    this.stopped = true; clearInterval(this.wd);
    try { this._send({ command: ['quit'] }); } catch {}
    const p = this.p; setTimeout(() => { try { p?.kill(); } catch {} }, 1000);
  }
}

module.exports = { Mpv, mpvPath, BASE };
