// Lightweight synthesized Web Audio Majlis chimes (zero external audio files).
// Uses a single shared AudioContext and automatically respects mute-during-playback.

export type SfxKind =
  | 'join'
  | 'leave'
  | 'ready'
  | 'tick'
  | 'go'
  | 'chat'
  | 'note'
  | 'reveal'
  | 'remote'
  | 'vote';

let sharedCtx: AudioContext | null = null;
const config = {
  enabled: true,
  muteDuringPlayback: true,
  theaterPlaying: false,
};

export function configureSfx(patch: Partial<typeof config>) {
  Object.assign(config, patch);
}

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AC();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

const PATTERNS: Record<SfxKind, { f: number; d: number; len: number; gain: number; type?: OscillatorType }[]> = {
  join: [{ f: 523.25, d: 0, len: 0.18, gain: 0.06 }, { f: 659.25, d: 0.09, len: 0.24, gain: 0.06 }],
  leave: [{ f: 523.25, d: 0, len: 0.16, gain: 0.05 }, { f: 392.0, d: 0.1, len: 0.22, gain: 0.05 }],
  ready: [{ f: 587.33, d: 0, len: 0.15, gain: 0.07 }, { f: 880.0, d: 0.11, len: 0.26, gain: 0.07 }],
  tick: [{ f: 660, d: 0, len: 0.09, gain: 0.08, type: 'triangle' }],
  go: [{ f: 523.25, d: 0, len: 0.12, gain: 0.08 }, { f: 783.99, d: 0.07, len: 0.28, gain: 0.09 }],
  chat: [{ f: 740, d: 0, len: 0.09, gain: 0.04 }],
  note: [{ f: 698.46, d: 0, len: 0.12, gain: 0.05 }, { f: 932.33, d: 0.07, len: 0.14, gain: 0.04 }],
  reveal: [{ f: 440, d: 0, len: 0.14, gain: 0.06 }, { f: 554.37, d: 0.08, len: 0.16, gain: 0.06 }, { f: 659.25, d: 0.16, len: 0.28, gain: 0.07 }],
  remote: [{ f: 622.25, d: 0, len: 0.11, gain: 0.06 }, { f: 830.61, d: 0.08, len: 0.16, gain: 0.05 }],
  vote: [{ f: 587.33, d: 0, len: 0.12, gain: 0.05 }],
};

export function playSfx(kind: SfxKind, opts?: { force?: boolean }): boolean {
  if (!config.enabled) return false;
  const allowDuringPlay = kind === 'tick' || kind === 'go' || opts?.force;
  if (!allowDuringPlay && config.muteDuringPlayback && config.theaterPlaying) return false;
  try {
    const ac = ctx();
    if (!ac) return false;
    const t0 = ac.currentTime;
    for (const n of PATTERNS[kind] || []) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = n.type || 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, t0 + n.d);
      gain.gain.linearRampToValueAtTime(n.gain, t0 + n.d + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d + n.len);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + n.d);
      osc.stop(t0 + n.d + n.len + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}
