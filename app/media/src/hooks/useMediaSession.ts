import { useEffect, useRef } from 'react';

function buildSilentWavBlob(): Blob {
  const sampleRate = 8000;
  const numSamples = 8000;
  const buf = new ArrayBuffer(44 + numSamples);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + numSamples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, numSamples, true);
  new Uint8Array(buf, 44).fill(0x80); // silence in unsigned 8-bit PCM
  return new Blob([buf], { type: 'audio/wav' });
}

export interface MediaSessionOptions {
  active: boolean;
  hasFirstFrame: boolean;
  paused: boolean;
  pos: number;
  dur: number;
  speed: number;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  incognito?: boolean;
  hasNext?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeekRelative: (deltaSec: number) => void;
  onSeekAbsolute: (sec: number) => void;
  onNext?: () => void;
  onStop?: () => void;
}

export function useMediaSession(opts: MediaSessionOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const lastPosSyncRef = useRef<{ at: number; paused: boolean; dur: number; speed: number }>({
    at: 0, paused: true, dur: 0, speed: 1,
  });
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const audio = new Audio();
    const url = URL.createObjectURL(buildSilentWavBlob());
    audio.src = url;
    audio.loop = true;
    audio.muted = false;
    audio.volume = 1;
    audioRef.current = audio;
    urlRef.current = url;

    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (ms) {
      const bind = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
        try { ms.setActionHandler(action, fn); } catch {}
      };
      bind('play', () => optsRef.current.onPlay());
      bind('pause', () => optsRef.current.onPause());
      bind('seekbackward', (d) => optsRef.current.onSeekRelative(-(d.seekOffset || 10)));
      bind('seekforward', (d) => optsRef.current.onSeekRelative(d.seekOffset || 10));
      bind('seekto', (d) => { if (typeof d.seekTime === 'number') optsRef.current.onSeekAbsolute(d.seekTime); });
      bind('stop', () => optsRef.current.onStop?.());
    }

    const onGesture = () => {
      const cur = optsRef.current;
      if (cur.active && cur.hasFirstFrame && !cur.paused && audio.paused) {
        audio.play().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      if (ms) {
        for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'stop'] as MediaSessionAction[]) {
          try { ms.setActionHandler(a, null); } catch {}
        }
        try { ms.playbackState = 'none'; } catch {}
      }
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
      audioRef.current = null;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (ms) {
      try {
        ms.setActionHandler('nexttrack', opts.hasNext && opts.onNext ? () => optsRef.current.onNext?.() : null);
      } catch {}
    }
    if (!opts.active || !opts.hasFirstFrame) {
      if (audio && !audio.paused) audio.pause();
      if (ms) try { ms.playbackState = 'none'; } catch {}
      return;
    }
    if (audio) {
      if (opts.paused) {
        if (!audio.paused) audio.pause();
      } else if (audio.paused) {
        audio.play().catch(() => {});
      }
    }
    if (ms) {
      try { ms.playbackState = opts.paused ? 'paused' : 'playing'; } catch {}
    }
  }, [opts.active, opts.hasFirstFrame, opts.paused, opts.hasNext, opts.onNext]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (!ms || typeof MediaMetadata === 'undefined' || !opts.active) return;
    if (opts.incognito) {
      try {
        ms.metadata = new MediaMetadata({ title: 'Majlis Cinema', artist: '', album: '', artwork: [] });
      } catch {}
      return;
    }
    const safeArt = opts.artworkUrl && /^(https?:|data:image\/)/i.test(opts.artworkUrl) ? opts.artworkUrl : '';
    try {
      ms.metadata = new MediaMetadata({
        title: opts.title || 'Majlis Cinema',
        artist: opts.artist || 'Majlis',
        album: opts.album || '',
        artwork: safeArt ? [{ src: safeArt, sizes: '512x512' }] : [],
      });
    } catch {}
  }, [opts.active, opts.incognito, opts.title, opts.artist, opts.album, opts.artworkUrl]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
    if (!ms || typeof ms.setPositionState !== 'function' || !opts.active || !opts.hasFirstFrame) return;
    const dur = Number(opts.dur);
    const rate = Number(opts.speed) || 1;
    if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(rate) || rate <= 0) return;
    const now = Date.now();
    const prev = lastPosSyncRef.current;
    if (prev.paused === opts.paused && prev.dur === dur && prev.speed === rate && now - prev.at < 950) return;
    lastPosSyncRef.current = { at: now, paused: opts.paused, dur, speed: rate };
    const clampedPos = Math.max(0, Math.min(dur, Number(opts.pos) || 0));
    try {
      ms.setPositionState({ duration: dur, playbackRate: rate, position: clampedPos });
    } catch {}
  }, [opts.active, opts.hasFirstFrame, opts.pos, opts.dur, opts.speed, opts.paused]);
}
