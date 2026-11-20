'use strict';
// Talks to majlis-engine.exe (Rust): the desktop side of hosting (input injection, virtual
// pads, game audio, pointer, window/display lists) and the video engine (capture + NVENC).
// One process, one pipe each way:
//   stdin  one JSON command per line
//   stdout [type u8][len u32 LE][payload]: 1 JSON event, 2 Opus game audio, 3 pointer, 4 video frame
// If it ever exits unexpectedly it's back within a second ('restart'), and the host re-applies
// pads, audio and streams.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

let isPackaged = false;
try { isPackaged = !!require('electron').app?.isPackaged; } catch {}

function helperPath() {
  const cands = [
    isPackaged ? null : process.env.MAJLIS_ENGINE,
    path.join(process.resourcesPath || '', 'engine', 'majlis-engine.exe'),
    path.join(__dirname, '../../../engine/target/release/majlis-engine.exe'),
  ];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

class Helper extends EventEmitter {
  constructor() {
    super();
    this.p = null; this.buf = Buffer.alloc(0); this.ready = false; this.info = null;
    this.stopped = false; this.restarts = 0;
    this.setMaxListeners(50);
    this.on('error', () => {}); // never let a stray 'error' take the app down
  }

  start() {
    if (this.p) return true;
    const exe = helperPath();
    if (!exe) { this.emit('missing'); return false; }
    this.stopped = false;
    const p = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.p = p;
    try { if (p.pid) require('./net').core?.adoptProcess?.(p.pid); } catch {}
    p.stdout.on('data', (d) => this._feed(d));
    p.on('exit', (code) => {
      if (this.p !== p) return;
      this.ready = false; this.p = null; this.buf = Buffer.alloc(0);
      this.emit('exit', code);
      // crashed: come back, and let everyone using it set things up again
      if (!this.stopped && this.restarts++ < 20) setTimeout(() => { if (!this.stopped && !this.p && this.start()) this.once('hello', () => this.emit('restart')); }, 800);
    });
    p.on('error', () => {});
    p.stdin.on('error', () => {});
    this.cmd({ cmd: 'hello' });
    return true;
  }

  _feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let o = 0;
    while (this.buf.length - o >= 5) {
      const type = this.buf[o], len = this.buf.readUInt32LE(o + 1);
      if (this.buf.length - o - 5 < len) break;
      const payload = this.buf.subarray(o + 5, o + 5 + len);
      o += 5 + len;
      if (type === 1) {
        let m; try { m = JSON.parse(payload); } catch { continue; }
        if (m.ev === 'hello') { this.ready = true; this.info = m; }
        this.emit('ev', m);
        // 'error' is special for EventEmitter (throws when nobody listens), so failures from
        // the engine travel under their own name
        this.emit(m.ev === 'error' ? 'helper-error' : m.ev, m);
      } else if (type === 2) this.emit('opus', Buffer.from(payload));
      else if (type === 3) this.emit('cursor', { x: payload.readFloatLE(0), y: payload.readFloatLE(4), visible: payload[8] === 1, shape: payload.readInt32LE(9) });
      else if (type === 4) this.emit('vframe', payload);
    }
    this.buf = o ? Buffer.from(this.buf.subarray(o)) : this.buf;
  }

  cmd(obj) {
    if (!this.p) return false;
    try { this.p.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  }

  // Send a command and wait for its reply event. If the engine reports that this command
  // failed, resolve right away with null (and the reason on `lastError`) instead of timing out.
  request(obj, ev, timeout = 4000) {
    return new Promise((res) => {
      const done = (v) => { clearTimeout(to); this.off(ev, ok); this.off('helper-error', fail); res(v); };
      const ok = (m) => done(m);
      const fail = (m) => { if (m.cmd === obj.cmd) { this.lastError = m.msg; done(null); } };
      const to = setTimeout(() => done(null), timeout);
      this.on(ev, ok);
      this.on('helper-error', fail);
      if (!this.cmd(obj)) done(null);
    });
  }

  stop(immediate = false) {
    this.stopped = true;
    this.cmd({ cmd: 'quit' });
    const p = this.p;
    if (!p) return;
    if (immediate) { try { p.kill(); } catch {} this.p = null; return; }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 500);
    t.unref?.();
  }
}

module.exports = { Helper, helperPath };
