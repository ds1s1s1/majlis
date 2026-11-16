'use strict';
// Local state: identity key, friends, settings, game library, network history.
// Nothing here ever leaves the machine except the public key and the number.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveId } = require('./ident');

// build-config.json is not in the repo: private builds drop it in to point at their own server.
let BUILD = {};
try { BUILD = require('./build-config.json'); } catch {}

let safeStorage = null;
try { safeStorage = require('electron').safeStorage; } catch {}

const DEFAULTS = {
  nick: '',
  lang: 'ar',
  theme: 'dark',
  server: '',
  accessKey: '',
  serverWs: '',
  relayWs: '',
  inviteBase: '',
  udpPort: 0,
  // stream
  codec: 'auto',          // auto | av1 | hevc | h264
  maxMbps: 40,
  fps: 60,
  tenBit: false,
  hdr: false,
  matchResolution: false,
  display: 0,
  captureWindow: null,    // { hwnd, title } when streaming only a window
  // network
  connType: 'auto',       // auto | fiber | 5g | 4g | wifi
  stability: 'auto',      // auto | on | off
  peakLearning: true,
  // guests
  acceptCodes: true,
  defaultRole: 'pad',
  spectatorQuality: 0.35,
  // watch party
  mode: 'play',           // play | watch
  watchControl: 'host',   // host | all  (who can pause/seek)
  watchMbps: 15,
  nightAudio: false,
  autoNext: true,
  autoDuck: true,
  allowChat: true,
  allowReactions: true,
  cinemaDelay: 180,       // ms of buffer for smooth film playback
  // input & voice
  voice: 'ptt',
  gameVol: 1,
  voiceVol: 1,           // off | ptt | open
  pttKey: 'CapsLock',
  panicKey: 'Control+Alt+Shift+F12',
  overlayKey: 'Control+Alt+M',
  replayKey: 'Control+Alt+R',
  replay: false,
  replaySeconds: 30,
  // integrations
  ffmpeg: '',
  routerLock: '',
  shareStatus: true,
};

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'majlis.json');
    let d = {};
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.d = { settings: {}, friends: [], games: [], peaks: {}, ...d };
    this.d.settings = { ...DEFAULTS, ...this.d.settings };
    this._ensureIdentity();
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.d, null, 1));
    fs.renameSync(tmp, this.file);
  }

  get(k) {
    const v = this.d.settings[k];
    if (k === 'server' && !v) return BUILD.server || '';
    if (k === 'accessKey' && !v) return BUILD.accessKey || '';
    return v;
  }
  hasServer() { return !!String(this.get('server') || '').trim(); }
  set(k, v) { this.d.settings[k] = v; this.save(); }
  all() { return { ...this.d.settings, builtInServer: !!BUILD.server && !this.d.settings.server }; }
  patch(obj) { for (const [k, v] of Object.entries(obj || {})) if (k in DEFAULTS) this.d.settings[k] = v; this.save(); }

  // ---------------------------------------------------------------- identity
  _ensureIdentity() {
    let idn = this.d.identity;
    if (!idn) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
      const sk = privateKey.export({ format: 'der', type: 'pkcs8' });
      idn = { pk: pk.toString('base64'), sk: this._protect(sk), salt: 0 };
      this.d.identity = idn;
      this.flush();
    }
    this._pk = Buffer.from(idn.pk, 'base64');
    this._sk = crypto.createPrivateKey({ key: this._unprotect(idn.sk), format: 'der', type: 'pkcs8' });
  }

  _protect(buf) {
    if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) return 'dpapi:' + safeStorage.encryptString(buf.toString('base64')).toString('base64');
    return 'raw:' + buf.toString('base64');
  }
  _unprotect(s) {
    if (s.startsWith('dpapi:')) return Buffer.from(safeStorage.decryptString(Buffer.from(s.slice(6), 'base64')), 'base64');
    return Buffer.from(s.replace(/^raw:/, ''), 'base64');
  }

  identity() {
    const self = this;
    return {
      get id() { return deriveId(self._pk, self.d.identity.salt); },
      get salt() { return self.d.identity.salt; },
      pkB64: this.d.identity.pk,
      sign: (buf) => crypto.sign(null, buf, this._sk),
    };
  }
  bumpSalt() { this.d.identity.salt++; this.flush(); }
  resetIdentity() { delete this.d.identity; this._ensureIdentity(); }

  // ---------------------------------------------------------------- friends
  friends() { return this.d.friends; }
  friend(id) { return this.d.friends.find((f) => f.id === id); }
  upsertFriend(f) {
    const cur = this.friend(f.id);
    if (cur) Object.assign(cur, f); else this.d.friends.push({ name: f.id, trust: 'ask', added: Date.now(), ...f });
    this.save();
    return this.friend(f.id);
  }
  removeFriend(id) { this.d.friends = this.d.friends.filter((f) => f.id !== id); this.save(); }

  // ---------------------------------------------------------------- games
  games() { return this.d.games; }
  setGames(g) { this.d.games = g; this.save(); }

  // ---------------------------------------------------------------- peak-hour memory
  // Bitrate that held up without congestion, per hour of the week (Saudi evenings and
  // Ramadan nights look very different from mornings).
  peakKey(d = new Date()) { return `${d.getDay()}-${d.getHours()}`; }
  recordPeak(mbps, congested) {
    const k = this.peakKey();
    const p = this.d.peaks[k] || { mbps, events: 0, n: 0 };
    p.mbps = p.mbps * 0.8 + mbps * 0.2;
    p.events = p.events * 0.9 + (congested ? 1 : 0);
    p.n++;
    this.d.peaks[k] = p;
    this.save();
  }
  peakHint(d = new Date()) { return this.d.peaks[this.peakKey(d)] || null; }
  peaks() { return this.d.peaks; }
}

module.exports = { Store, DEFAULTS };
