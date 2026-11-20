'use strict';
// Watch-together where every viewer streams the film on their own line and Majlis only keeps
// the clocks together. Plain logic, no I/O: host.js / guest.js / theater.js move the messages.
//
// Authority: the host owns the state { epoch, seq, pos, at, playing, rate, reason }. Anyone may
// ask (play/pause/seek); only the host applies, bumps seq and sends the new state. A viewer
// applies a state only if it's newer than the last one it applied, so two people pressing pause
// at once, or a late message, can't make players fight (the ping-pong other apps suffer).
// `at` is the host's wall clock (ms) when the film was at `pos` (ms); viewers convert it with
// the link's clock offset.

// micro drift correction 0.97-1.03 (up to 3%): audio-pitch-correction keeps voices natural,
// hysteresis starts nudging at 250 ms and stops at 80 ms; seek ahead >= 1.5s, or behind >= 15s
// when smartCatchUp (1.15x pitch-corrected catch-up) is active.
const SLEW = { dead: 250, settle: 80, seek: 1500, catchUpSpeed: 1.15, catchUpMaxMs: 15000, max: 0.03, min: 0.01, k: 1 / 12000 };
const STALL_MS = 600, READY_S = 3, WAIT_MAX_MS = 20000, DEBOUNCE_MS = 250;

// Where the film should be right now, by a viewer's clock.
function expected(state, nowHost) {
  if (!state.playing) return state.pos;
  return state.pos + (nowHost - state.at) * (state.rate || 1);
}

// How a viewer gets back in line: a small gap is closed by playing slightly faster or slower
// (0.97..1.03, pitch kept, nobody hears it); when behind by 1.5s..15s and smartCatchUp is on,
// speeds smoothly at 1.15x with pitch correction instead of jarring seeks.
function correct(localMs, wantMs, cur = 1, opts = null) {
  const d = localMs - wantMs; // >0: ahead, <0: behind
  const abs = Math.abs(d);
  const catchUpOn = !!opts?.smartCatchUp;
  const catchRate = Number(opts?.catchUpSpeed) > 1 ? Number(opts.catchUpSpeed) : SLEW.catchUpSpeed;
  const catchMax = Number(opts?.catchUpMaxMs) > SLEW.seek ? Number(opts.catchUpMaxMs) : SLEW.catchUpMaxMs;

  if (catchUpOn && d < 0) {
    if (abs >= catchMax) return { seek: wantMs, speed: 1 };
    if (abs >= SLEW.seek) return { speed: catchRate, catchUp: true };
  } else if (abs >= SLEW.seek) {
    return { seek: wantMs, speed: 1 };
  }

  if (abs <= SLEW.settle) return { speed: 1 };
  const nudging = cur !== 1 && ((d > 0 && cur < 1) || (d < 0 && cur > 1));
  if (!nudging && abs < SLEW.dead) return { speed: 1 };
  const mag = Math.max(SLEW.min, Math.min(SLEW.max, abs * SLEW.k));
  return { speed: Math.round((1 - Math.sign(d) * mag) * 1000) / 1000 };
}

class SyncHost {
  constructor(now = Date.now) {
    this.now = now; this.state = null; this.viewers = new Map(); this.waitSince = 0; this.lastAction = null; this.brb = null;
  }

  peers(nameOf = (x) => x) {
    return [...this.viewers.entries()].map(([id, v]) => {
      const mapped = nameOf(id);
      const name = v.name || (mapped && mapped !== id ? mapped : null) || mapped || id;
      const cache = Math.round((v.cache || 0) * 10) / 10;
      const cacheSpeed = Math.max(0, Math.round(Number(v.cacheSpeed) || 0));
      const ready = !v.stalled && (v.cache ?? 0) >= READY_S;
      return { id, name, cache, cacheSpeed, stalled: !!v.stalled, ready };
    });
  }

  // starts paused at `pos`; plays by itself once all peers in the quorum report buffered >= READY_S
  open(src, meta, pos = src?.pos ?? 0, peers = src?.peers) {
    const epoch = ((this.state?.epoch || 0) + 1) >>> 0;
    const t = this.now();
    this.viewers.clear();
    this.waitSince = t;
    this.lastAction = null;
    this.brb = null;
    if (Array.isArray(peers)) {
      for (const p of peers) {
        const id = typeof p === 'string' ? p : p?.id;
        const name = typeof p === 'object' ? p?.name : null;
        if (id) this.viewers.set(id, { epoch, stalled: false, cache: 0, cacheSpeed: 0, ready: false, name, t });
      }
    }
    const waitingFor = this.viewers.size ? [...this.viewers.entries()].map(([k, v]) => v.name || k) : [];
    this.state = { epoch, seq: 0, pos, at: t, playing: false, rate: 1, reason: 'start', waitingFor, waitEndsAt: t + WAIT_MAX_MS, brb: null, peers: this.peers(), src, meta };
    return this.state;
  }

  _set(patch, reason) {
    const s = this.state, t = this.now();
    // freeze the film position at this instant, then apply the change from here
    const pos = patch.pos ?? expected(s, t);
    const waitEndsAt = patch.waitEndsAt !== undefined
      ? patch.waitEndsAt
      : ((reason === 'buffering' || reason === 'start') && this.waitSince ? this.waitSince + WAIT_MAX_MS : 0);
    this.state = {
      ...s,
      ...patch,
      pos: Math.max(0, pos),
      at: t,
      seq: s.seq + 1,
      reason,
      waitEndsAt,
      brb: patch.brb !== undefined ? patch.brb : this.brb,
      peers: patch.peers || this.peers(),
    };
    return this.state;
  }

  forceResume() {
    if (!this.state) return null;
    this.waitSince = 0;
    this.brb = null;
    return this._set({ playing: true, waitingFor: [], waitEndsAt: 0, brb: null }, 'play');
  }

  setBrb(info) {
    if (!this.state) return null;
    if (info) {
      this.brb = info;
      this.waitSince = 0;
      return this._set({ playing: false, waitingFor: [], waitEndsAt: 0, brb: info }, 'brb');
    }
    this.brb = null;
    return this._set({ playing: true, waitingFor: [], waitEndsAt: 0, brb: null }, 'play');
  }

  // a request from anyone (the host's own player included): { epoch, action, pos, seq?, from? }
  request(r) {
    const s = this.state;
    if (!s || r.epoch !== s.epoch) return null;
    const t = this.now();
    if (r.seq != null && r.seq < s.seq && (r.action === 'play' || r.action === 'pause') && t - s.at < DEBOUNCE_MS) return null;
    if (r.from && this.lastAction && this.lastAction.from === r.from && this.lastAction.action === r.action && t - this.lastAction.at < DEBOUNCE_MS) return null;
    if (r.action === 'play') {
      if (s.playing && !this.brb) return null;
      this.waitSince = 0;
      this.brb = null;
      this.lastAction = { from: r.from || null, action: 'play', at: t };
      return this._set({ playing: true, waitingFor: [], waitEndsAt: 0, brb: null }, 'play');
    }
    if (r.action === 'pause') {
      if (!s.playing && s.reason === 'pause') return null;
      this.lastAction = { from: r.from || null, action: 'pause', at: t };
      return this._set({ playing: false, waitingFor: [] }, 'pause');
    }
    if (r.action === 'seek') {
      this.lastAction = { from: r.from || null, action: 'seek', at: t };
      return this._set({ pos: r.pos }, 'seek');
    }
    if (r.action === 'speed') {
      const rate = Math.max(0.25, Math.min(4, Number(r.rate) || 1));
      this.lastAction = { from: r.from || null, action: 'speed', at: t };
      return this._set({ rate }, 'speed');
    }
    return null;
  }

  // a viewer's report: { epoch, stalled (bool), cache (s ahead), cacheSpeed?, ready, name? } -> a new state if the
  // party has to wait for someone, or can carry on
  report(id, r, nameOf = (x) => x) {
    const s = this.state;
    if (!s || r.epoch !== s.epoch) return null;
    const t = this.now();
    const prev = this.viewers.get(id) || {};
    const mapped = nameOf(id);
    const name = r.name || (mapped && mapped !== id ? mapped : null) || prev.name || mapped || id;
    const v = { ...prev, ...r, name, t };
    if (r.stalled) v.stalledSince = prev.stalledSince || t; else v.stalledSince = 0;
    this.viewers.set(id, v);
    s.peers = this.peers(nameOf);
    if (s.reason === 'brb' && this.brb) return null;
    const stuck = [...this.viewers.entries()].filter(([, x]) => x.stalledSince && t - x.stalledSince > STALL_MS);
    if (s.playing && stuck.length) {
      this.waitSince = t;
      return this._set({ playing: false, waitingFor: stuck.map(([k, x]) => x.name || nameOf(k)), waitEndsAt: t + WAIT_MAX_MS, peers: this.peers(nameOf) }, 'buffering');
    }
    if (!s.playing && (s.reason === 'buffering' || s.reason === 'start')) {
      const notReady = [...this.viewers.entries()].filter(([, x]) => x.stalled || (x.cache ?? 0) < READY_S);
      s.waitingFor = notReady.map(([k, x]) => x.name || nameOf(k));
      const ready = this.viewers.size > 0 && notReady.length === 0;
      if (ready || t - this.waitSince > WAIT_MAX_MS) {
        this.waitSince = 0;
        return this._set({ playing: true, waitingFor: [], waitEndsAt: 0, peers: this.peers(nameOf) }, ready ? 'resume' : 'gave-up-waiting');
      }
    }
    return null;
  }

  leave(id) {
    this.viewers.delete(id);
    const s = this.state;
    if (!s) return null;
    s.peers = this.peers();
    if (!s.playing && (s.reason === 'buffering' || s.reason === 'start') && this.viewers.size > 0) {
      const notReady = [...this.viewers.entries()].filter(([, x]) => x.stalled || (x.cache ?? 0) < READY_S);
      s.waitingFor = notReady.map(([k, x]) => x.name || k);
      if (notReady.length === 0) return this._set({ playing: true, waitingFor: [], peers: this.peers() }, 'resume');
    }
    return null;
  }
}

// The viewer's side: keeps the last state it applied and says what the player must do.
class SyncViewer {
  constructor(opts = {}) {
    this.state = null; this.speed = 1; this.ownSeq = -1; this.lastReqAt = 0; this.lastReqAction = null;
    this.smartCatchUp = opts?.smartCatchUp !== false;
    this.catchingUp = false;
  }

  setSmartCatchUp(on) { this.smartCatchUp = !!on; }

  // debounce local play/pause requests and tag with current seq so echoes never ping-pong
  canRequest(action, now = Date.now()) {
    if ((action === 'play' || action === 'pause') && this.lastReqAction === action && now - this.lastReqAt < DEBOUNCE_MS) return false;
    this.lastReqAt = now;
    this.lastReqAction = action;
    this.ownSeq = this.state?.seq ?? -1;
    return true;
  }

  // a state from the host: true if it's news (newer epoch, or newer seq in this epoch)
  accept(s) {
    if (!s) return false;
    const c = this.state;
    if (c && (s.epoch < c.epoch || (s.epoch === c.epoch && s.seq <= c.seq))) return false;
    this.state = s;
    return true;
  }

  // every ~250 ms with the player's position (ms), the host's clock now, and the speed the
  // player really runs at (not what we last asked for: a request sent before the player was up
  // is lost, and the viewer stayed a second behind for good): { pause?, seek?, speed?, catchUp?, driftMs? }
  step(localMs, nowHost, paused, speed = this.speed) {
    this.speed = speed;
    const s = this.state;
    if (!s) { this.catchingUp = false; return {}; }
    const out = {};
    if (paused !== !s.playing) out.pause = !s.playing;
    const want = expected(s, nowHost);
    const baseRate = s.rate || 1;
    if (!s.playing) {
      this.catchingUp = false;
      if (Math.abs(localMs - want) > 250) out.seek = want;
      if (Math.abs(this.speed - baseRate) > 0.005) { out.speed = baseRate; this.speed = baseRate; }
      return out;
    }
    const c = correct(localMs, want, this.speed / baseRate, { smartCatchUp: this.smartCatchUp });
    this.catchingUp = !!c.catchUp;
    const nextSpeed = Math.min(4, Math.round(baseRate * c.speed * 1000) / 1000);
    if (c.seek != null) out.seek = c.seek;
    if (Math.abs(nextSpeed - this.speed) > 0.002) { out.speed = nextSpeed; this.speed = nextSpeed; }
    out.catchUp = this.catchingUp;
    out.driftMs = Math.round(localMs - want);
    return out;
  }
}

module.exports = { SyncHost, SyncViewer, expected, correct, SLEW, STALL_MS, READY_S, WAIT_MAX_MS, DEBOUNCE_MS };

