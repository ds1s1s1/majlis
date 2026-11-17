'use strict';
// Discord Rich Presence over Discord's local IPC pipe (no SDK needed, works whenever the Discord
// app runs). Shows what you're playing or watching on your profile, with a "Join" that friends
// can press: Discord hands their Majlis our join secret, and it knocks on our door like typing
// our number would (we still accept or refuse). Needs a Discord application id (public, not a
// secret) from the settings or build-config.json; without one this stays off.
const net = require('net');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const h = Buffer.alloc(8);
  h.writeInt32LE(op, 0); h.writeInt32LE(json.length, 4);
  return Buffer.concat([h, json]);
}

// complete frames out of what came in so far: [{ op, data }], rest
function unframe(buf) {
  const out = [];
  let o = 0;
  while (buf.length - o >= 8) {
    const op = buf.readInt32LE(o), len = buf.readInt32LE(o + 4);
    if (buf.length - o - 8 < len) break;
    let data = null; try { data = JSON.parse(buf.subarray(o + 8, o + 8 + len).toString()); } catch {}
    out.push({ op, data }); o += 8 + len;
  }
  return { frames: out, rest: buf.subarray(o) };
}

class Discord extends EventEmitter {
  constructor(clientId) { super(); this.clientId = clientId; this.sock = null; this.ready = false; this.want = null; this.sent = null; this.lastSend = 0; }

  start() {
    if (!this.clientId || this.stopped === false) return;
    this.stopped = false;
    this._connect(0);
    // Discord allows ~5 updates per 20 s: send the latest wish at most every 5 s
    this.iv = setInterval(() => this._flush(), 5000);
  }

  _connect(n) {
    if (this.stopped) return;
    if (n > 9) { this.retry = setTimeout(() => this._connect(0), 20000); return; } // Discord not running: try later
    const s = net.connect(`\\\\?\\pipe\\discord-ipc-${n}`);
    let buf = Buffer.alloc(0);
    s.once('error', () => { s.destroy(); if (!this.sock) this._connect(n + 1); });
    s.once('connect', () => {
      this.sock = s;
      s.write(frame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { frames, rest } = unframe(buf); buf = rest;
      for (const f of frames) this._in(f);
    });
    s.on('close', () => {
      const was = this.sock === s;
      if (was) { this.sock = null; this.ready = false; this.sent = null; }
      if (was && !this.stopped) this.retry = setTimeout(() => this._connect(0), 10000);
    });
  }

  _in({ op, data }) {
    if (op === OP.PING) return this.sock?.write(frame(OP.PONG, data));
    if (op === OP.CLOSE) { this.emit('error', new Error(data?.message || 'closed by Discord')); return this.sock?.destroy(); }
    if (op !== OP.FRAME || !data) return;
    if (data.evt === 'READY') {
      this.ready = true; this.user = data.data?.user;
      this.emit('ready', this.user);
      this._cmd('SUBSCRIBE', {}, 'ACTIVITY_JOIN');
      this._flush(true);
    } else if (data.evt === 'ACTIVITY_JOIN') {
      // a friend pressed Join on our profile, and Discord opened us on their side with our secret
      this.emit('join', data.data?.secret);
    } else if (data.evt === 'ERROR') this.emit('error', new Error(data.data?.message || 'discord error'));
  }

  _cmd(cmd, args, evt) { this.sock?.write(frame(OP.FRAME, { cmd, args, evt, nonce: crypto.randomUUID() })); }

  // what we'd like to show (null clears it); sent when Discord is there and the rate allows
  set(activity) { this.want = activity; }

  _flush(force) {
    if (!this.ready) return;
    const j = JSON.stringify(this.want);
    if (!force && j === this.sent) return;
    this.sent = j;
    this._cmd('SET_ACTIVITY', { pid: process.pid, activity: this.want || undefined });
  }

  stop() {
    this.stopped = true; clearInterval(this.iv); clearTimeout(this.retry);
    try { if (this.ready) this._cmd('SET_ACTIVITY', { pid: process.pid }); } catch {}
    setTimeout(() => this.sock?.destroy(), 200);
  }
}

// What the profile says, from what Majlis is doing. `s`: { watching: { name, poster, pos, dur,
// paused, together }, hosting: { guests, max, mode }, id (our Majlis number) }
function activity(s) {
  const join = s.hosting && s.id ? { secrets: { join: `majlis:${s.id}` }, party: { id: `majlis-${s.id}`, size: [Math.min(s.hosting.guests + 1, s.hosting.max), s.hosting.max] } } : {};
  if (s.watching) {
    const w = s.watching;
    const a = { type: 3, details: w.name.slice(0, 128), state: (w.together ? 'Watching together' : 'Watching').slice(0, 128), assets: { large_image: w.poster || 'majlis', large_text: w.name.slice(0, 128) }, ...join };
    if (!w.paused && w.dur) a.timestamps = { start: Date.now() - Math.round(w.pos * 1000), end: Date.now() + Math.round((w.dur - w.pos) * 1000) };
    return a;
  }
  if (s.hosting) return { details: s.hosting.mode === 'watch' ? 'Hosting a movie night' : 'Hosting a game', state: `${s.hosting.guests} in the room`, assets: { large_image: 'majlis', large_text: 'Majlis' }, timestamps: { start: s.hosting.since }, ...join };
  return null;
}

// the Majlis number in a join secret Discord gave back
function joinTarget(secret) { const m = /^majlis:(\d{9})$/.exec(secret || ''); return m ? m[1] : null; }

module.exports = { Discord, activity, joinTarget, frame, unframe };
