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

// up to 5% (as Syncplay): scaletempo2 keeps voices natural, and a 1 s gap closes in ~20 s
const SLEW = { dead: 40, seek: 1500, max: 0.05, k: 1 / 2000, settle: 20 };
const STALL_MS = 600, READY_S = 3, WAIT_MAX_MS = 20000;

// Where the film should be right now, by a viewer's clock.
function expected(state, nowHost) {
  if (!state.playing) return state.pos;
  return state.pos + (nowHost - state.at) * (state.rate || 1);
}

// How a viewer gets back in line: a small gap is closed by playing slightly faster or slower
// (pitch kept, nobody hears it); only a big one is a seek. `cur` is the speed in use now.
function correct(localMs, wantMs, cur = 1) {
  const d = localMs - wantMs; // >0: ahead
  if (Math.abs(d) >= SLEW.seek) return { seek: wantMs, speed: 1 };
  if (Math.abs(d) < SLEW.settle && cur !== 1) return { speed: 1 };
  if (Math.abs(d) < SLEW.dead) return { speed: cur };
  return { speed: Math.round((1 - Math.max(-SLEW.max, Math.min(SLEW.max, d * SLEW.k))) * 1000) / 1000 };
}

class SyncHost {
  constructor(now = Date.now) { this.now = now; this.state = null; this.viewers = new Map(); this.waitSince = 0; }

  // starts paused at `pos`; it plays by itself once everyone has enough buffered (as after a stall)
  open(src, meta, pos = 0) {
    const epoch = ((this.state?.epoch || 0) + 1) >>> 0;
    this.state = { epoch, seq: 0, pos, at: this.now(), playing: false, rate: 1, reason: 'start', src, meta };
    this.viewers.clear();
    this.waitSince = this.now();
    return this.state;
  }

  _set(patch, reason) {
    const s = this.state, t = this.now();
    // freeze the film position at this instant, then apply the change from here
    const pos = patch.pos ?? expected(s, t);
    this.state = { ...s, ...patch, pos: Math.max(0, pos), at: t, seq: s.seq + 1, reason };
    return this.state;
  }

  // a request from anyone (the host's own player included): { epoch, action, pos }
  request(r) {
    const s = this.state;
    if (!s || r.epoch !== s.epoch) return null;
    if (r.action === 'play') { this.waitSince = 0; return this._set({ playing: true }, 'play'); }
    if (r.action === 'pause') return this._set({ playing: false }, 'pause');
    if (r.action === 'seek') return this._set({ pos: r.pos }, 'seek');
    return null;
  }

  // a viewer's report: { epoch, stalled (bool), cache (s ahead), ready } -> a new state if the
  // party has to wait for someone, or can carry on
  report(id, r, nameOf = (x) => x) {
    const s = this.state;
    if (!s || r.epoch !== s.epoch) return null;
    const v = { ...(this.viewers.get(id) || {}), ...r, t: this.now() };
    if (r.stalled) v.stalledSince ||= this.now(); else v.stalledSince = 0;
    this.viewers.set(id, v);
    const t = this.now();
    const stuck = [...this.viewers.entries()].filter(([, x]) => x.stalledSince && t - x.stalledSince > STALL_MS);
    if (s.playing && stuck.length) {
      this.waitSince = t;
      return this._set({ playing: false, waitingFor: stuck.map(([k]) => nameOf(k)) }, 'buffering');
    }
    if (!s.playing && (s.reason === 'buffering' || s.reason === 'start')) {
      const ready = [...this.viewers.values()].every((x) => !x.stalled && (x.cache ?? 0) >= READY_S);
      if (ready || t - this.waitSince > WAIT_MAX_MS) return this._set({ playing: true, waitingFor: [] }, ready ? 'resume' : 'gave-up-waiting');
    }
    return null;
  }

  leave(id) { this.viewers.delete(id); }
}

// The viewer's side: keeps the last state it applied and says what the player must do.
class SyncViewer {
  constructor() { this.state = null; this.speed = 1; }

  // a state from the host: true if it's news (newer epoch, or newer seq in this epoch)
  accept(s) {
    const c = this.state;
    if (c && (s.epoch < c.epoch || (s.epoch === c.epoch && s.seq <= c.seq))) return false;
    this.state = s;
    return true;
  }

  // every ~250 ms with the player's position (ms), the host's clock now, and the speed the
  // player really runs at (not what we last asked for: a request sent before the player was up
  // is lost, and the viewer stayed a second behind for good): { pause?, seek?, speed? }
  step(localMs, nowHost, paused, speed = this.speed) {
    this.speed = speed;
    const s = this.state;
    if (!s) return {};
    const out = {};
    if (paused !== !s.playing) out.pause = !s.playing;
    const want = expected(s, nowHost);
    if (!s.playing) {
      if (Math.abs(localMs - want) > 250) out.seek = want;
      if (this.speed !== 1) { out.speed = 1; this.speed = 1; }
      return out;
    }
    const c = correct(localMs, want, this.speed);
    if (c.seek != null) out.seek = c.seek;
    if (c.speed !== this.speed) { out.speed = c.speed; this.speed = c.speed; }
    return out;
  }
}

module.exports = { SyncHost, SyncViewer, expected, correct, SLEW, STALL_MS, READY_S, WAIT_MAX_MS };
