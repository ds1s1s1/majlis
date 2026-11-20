'use strict';
// Discord Rich Presence + Join + voice-echo guard over Discord's local IPC pipe (no SDK binary
// needed when Discord is running). Shows what you're watching (dynamic HTTPS poster) or hosting,
// handles Join secret knocks, and exposes 1-click majlis:// invite helpers for Discord DMs.
const net = require('net');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
// Public default fallback Discord Application ID can come from build-config.json or settings
const DEFAULT_DISCORD_CLIENT_ID = '';
const MIN_UPDATE_GAP_MS = 400;

function safeImage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 512) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = (u.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host === '::1' || host === '[::1]' || host.endsWith('.local')) return null;
  if (host === 'discord.gg' || host.endsWith('.discord.gg')) return null;
  if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
  return u.toString();
}

function safeAssetText(raw, fallback = 'Majlis') {
  const fb = String(fallback || 'Majlis').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() || 'Majlis';
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return (s.length >= 2 ? s : fb).slice(0, 128);
}

function resolveDiscordClientId(storeValue, buildConfigId = DEFAULT_DISCORD_CLIENT_ID) {
  const id = String(storeValue || buildConfigId || '').trim();
  return /^\d{15,22}$/.test(id) ? id : null;
}

function inviteLinks(id) {
  const clean = String(id || '').trim();
  if (!/^\d{6}|\d{9}$/.test(clean)) return { join: '', friend: '' };
  return {
    join: `majlis://join/${clean}`,
    friend: `majlis://friend/${clean}`,
  };
}

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
    if (len < 0 || buf.length - o - 8 < len) break;
    let data = null; try { data = JSON.parse(buf.subarray(o + 8, o + 8 + len).toString()); } catch {}
    out.push({ op, data }); o += 8 + len;
  }
  return { frames: out, rest: buf.subarray(o) };
}

class Discord extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.sock = null;
    this.ready = false;
    this.want = null;
    this.sent = null;
    this.lastSend = 0;
    this.discordVoiceActive = false;
    this._backoffMs = 1000;
    this._flushTimer = null;
    this._lastSig = '';
    this._lastStartMs = 0;
  }

  start() {
    if (!this.clientId || this.stopped === false) return;
    this.stopped = false;
    this._backoffMs = 1000;
    this._connect(0);
    // Discord allows ~5 updates per 20 s: keep heartbeat flush at 5 s
    this.iv = setInterval(() => this._flush(), 5000);
  }

  _scheduleReconnect(ms) {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this._connect(0), ms);
  }

  _connect(n) {
    if (this.stopped) return;
    if (n > 9) {
      const wait = this._backoffMs;
      this._backoffMs = Math.min(60000, this._backoffMs * 2);
      this._scheduleReconnect(wait);
      return;
    }
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
      if (was) { this.sock = null; this.ready = false; this.sent = null; this._lastSig = ''; this._setVoice(false); }
      if (was && !this.stopped) {
        const wait = this._backoffMs;
        this._backoffMs = Math.min(60000, this._backoffMs * 2);
        this._scheduleReconnect(wait);
      }
    });
  }

  _setVoice(active) {
    const next = !!active;
    if (next === this.discordVoiceActive) return;
    this.discordVoiceActive = next;
    this.emit('voice-active', { active: next });
  }

  _in({ op, data }) {
    if (op === OP.PING) return this.sock?.write(frame(OP.PONG, data));
    if (op === OP.CLOSE) { this.emit('error', new Error(data?.message || 'closed by Discord')); return this.sock?.destroy(); }
    if (op !== OP.FRAME || !data) return;
    if (data.evt === 'READY') {
      this.ready = true;
      this._backoffMs = 1000;
      this.user = data.data?.user;
      this.emit('ready', this.user);
      this._cmd('SUBSCRIBE', {}, 'ACTIVITY_JOIN');
      this._cmd('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
      this._flush(true);
    } else if (data.evt === 'ACTIVITY_JOIN') {
      // a friend pressed Join on our profile, and Discord opened us on their side with our secret
      this.emit('join', data.data?.secret);
    } else if (data.evt === 'VOICE_SETTINGS_UPDATE') {
      const v = data.data;
      // If user isn't deafened/self-muted in Discord while in a call/mode, avoid double-mic echo
      const active = !!(v && v.deaf === false && v.mute === false && v.input?.device_id);
      this._setVoice(active);
    } else if (data.evt === 'ERROR') this.emit('error', new Error(data.data?.message || 'discord error'));
  }

  _cmd(cmd, args, evt) { this.sock?.write(frame(OP.FRAME, { cmd, args, evt, nonce: crypto.randomUUID() })); }

  _signature(act) {
    if (!act) return { sig: 'null', startMs: 0 };
    const startMs = act.timestamps?.start || 0;
    const sig = JSON.stringify({
      type: act.type,
      details: act.details,
      state: act.state,
      large: act.assets?.large_image,
      small: act.assets?.small_image,
      hasEnd: !!act.timestamps?.end,
      party: act.party?.size || null,
      join: !!act.secrets?.join,
    });
    return { sig, startMs };
  }

  // what we'd like to show (null clears it); rate-limited immediate flush on play/pause/seek changes
  set(act, { immediate = false } = {}) {
    this.want = act || null;
    if (!this.ready) return;
    const { sig, startMs } = this._signature(this.want);
    const drifted = startMs && this._lastStartMs
      ? Math.abs(startMs - this._lastStartMs) > 3000
      : (!!startMs !== !!this._lastStartMs);
    if (!immediate && sig === this._lastSig && !drifted) return;
    const elapsed = Date.now() - this.lastSend;
    if (elapsed >= MIN_UPDATE_GAP_MS) {
      if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
      this._flush(true);
    } else if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this._flush(true);
      }, MIN_UPDATE_GAP_MS - elapsed);
      this._flushTimer.unref?.();
    }
  }

  _flush(force) {
    if (!this.ready) return;
    const { sig, startMs } = this._signature(this.want);
    const j = JSON.stringify(this.want);
    if (!force && j === this.sent) return;
    const drifted = startMs && this._lastStartMs
      ? Math.abs(startMs - this._lastStartMs) > 3000
      : (!!startMs !== !!this._lastStartMs);
    if (!force && sig === this._lastSig && !drifted) return;
    this.sent = j;
    this._lastSig = sig;
    this._lastStartMs = startMs;
    this.lastSend = Date.now();
    this._cmd('SET_ACTIVITY', { pid: process.pid, activity: this.want || undefined });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.iv);
    clearTimeout(this.retry);
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    this._setVoice(false);
    try { if (this.ready) this._cmd('SET_ACTIVITY', { pid: process.pid }); } catch {}
    setTimeout(() => this.sock?.destroy(), 200);
  }
}

// What the profile says, from what Majlis is doing. `s`: { watching, hosting, browsing, id, privacy }
function activity(s = {}) {
  const p = s.privacy || {};
  const hideTitle = !!p.hideTitle;
  const showWhenPaused = p.showWhenPaused !== false;
  const showPoster = p.showPoster !== false;
  const showTimestamp = p.showTimestamp !== false;
  const showPartyJoin = p.showPartyJoin !== false;
  const showBrowsing = !!p.showBrowsing;

  const join = s.hosting && s.id && showPartyJoin
    ? { secrets: { join: `majlis:${s.id}` }, party: { id: `majlis-${s.id}`, size: [Math.min(s.hosting.guests + 1, s.hosting.max), s.hosting.max] } }
    : {};

  if (s.watching) {
    const w = s.watching;
    if (w.paused && !showWhenPaused) return null;

    if (hideTitle) {
      const a = {
        type: 3,
        status_display_type: 2,
        details: 'Watching on Majlis',
        state: w.paused ? 'Paused' : (w.together ? 'Watch Party' : 'Cinema'),
        assets: { large_image: 'majlis', large_text: 'Majlis', small_image: 'majlis', small_text: 'Majlis' },
        ...join,
      };
      if (!w.paused && showTimestamp && w.dur > 0) {
        const start = Date.now() - Math.round((w.pos || 0) * 1000);
        a.timestamps = { start, end: start + Math.round(w.dur * 1000) };
      }
      return a;
    }

    const isSeries = (w.season != null && w.episode != null) || (w.type === 'series' && (w.seriesName || w.epTitle));
    let details;
    let state;
    if (isSeries) {
      details = safeAssetText(w.seriesName || w.name, 'Majlis');
      const epCode = (w.season != null && w.episode != null) ? `S${w.season} E${w.episode}` : '';
      const epTag = epCode && w.epTitle ? `${epCode} · ${w.epTitle}` : (epCode || w.epTitle || '');
      if (w.paused) state = safeAssetText(epTag ? `Paused · ${epTag}` : 'Paused', 'Paused');
      else if (w.together) state = safeAssetText(epTag ? `${epTag} · Watch Party` : 'Watching together', 'Watching together');
      else state = safeAssetText(epTag || 'Watching', 'Watching');
    } else {
      const baseName = String(w.name || 'Majlis').trim() || 'Majlis';
      const titleWithYear = (w.year && !baseName.includes(String(w.year))) ? `${baseName} (${w.year})` : baseName;
      details = safeAssetText(titleWithYear, 'Majlis');
      state = w.paused ? 'Paused' : (w.together ? 'Watching together' : 'Watching');
    }

    const posterUrl = showPoster ? safeImage(w.poster) : null;
    const stillUrl = showPoster ? safeImage(w.still) : null;
    const largeImage = posterUrl || 'majlis';
    const smallImage = (stillUrl && stillUrl !== largeImage) ? stillUrl : 'majlis';
    const smallText = safeAssetText(w.paused ? 'Paused · Majlis' : (w.epTitle || 'Majlis'), 'Majlis');

    const a = {
      type: 3,
      status_display_type: 2,
      details,
      state,
      assets: { large_image: largeImage, large_text: details, small_image: smallImage, small_text: smallText },
      ...join,
    };
    if (!w.paused && showTimestamp && w.dur > 0) {
      const start = Date.now() - Math.round((w.pos || 0) * 1000);
      a.timestamps = { start, end: start + Math.round(w.dur * 1000) };
    }
    return a;
  }

  if (s.hosting) {
    const details = safeAssetText(s.hosting.game || (s.hosting.mode === 'watch' ? 'Hosting a movie night' : 'Hosting a game'), 'Majlis');
    const a = {
      type: s.hosting.mode === 'watch' ? 3 : 0,
      status_display_type: 2,
      details,
      state: `${s.hosting.guests} in the room`,
      assets: { large_image: 'majlis', large_text: 'Majlis' },
      ...join,
    };
    if (showTimestamp && s.hosting.since) a.timestamps = { start: s.hosting.since };
    return a;
  }

  if (s.browsing && showBrowsing) {
    return {
      type: 3,
      status_display_type: 2,
      details: 'Browsing Cinema',
      state: 'Majlis',
      assets: { large_image: 'majlis', large_text: 'Majlis' },
    };
  }

  return null;
}

// the Majlis number in a join secret Discord gave back
function joinTarget(secret) { const m = /^majlis:(\d{9})$/.exec(secret || ''); return m ? m[1] : null; }

module.exports = { Discord, activity, joinTarget, frame, unframe, inviteLinks, resolveDiscordClientId, DEFAULT_DISCORD_CLIENT_ID, safeImage, safeAssetText };
