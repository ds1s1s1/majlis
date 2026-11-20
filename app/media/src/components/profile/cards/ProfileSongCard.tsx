import { useEffect, useRef, useState } from 'react';
import { Disc3, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { toPlayableAudioUrl } from '../../../api';
import { useHost } from '../../../host';

export function ProfileSongCard({
  songTitle,
  songArtist,
  playableSrc,
  externalUrl,
  active,
  transparent,
}: {
  songTitle: string;
  songArtist: string;
  playableSrc: string | null;
  externalUrl?: string;
  active: boolean;
  transparent?: boolean;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const audioRef = useRef<{ a: HTMLAudioElement; revoke: () => void } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.a.pause();
      audioRef.current.a.src = '';
      audioRef.current.revoke();
      audioRef.current = null;
    }
    setPlaying(false);
  };

  useEffect(() => {
    if (!active) stopAudio();
    return () => stopAudio();
  }, [active, playableSrc]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.a.muted = muted;
  }, [muted]);

  const togglePlay = () => {
    if (playing && audioRef.current) {
      audioRef.current.a.pause();
      setPlaying(false);
      return;
    }
    if (!playableSrc) return;
    if (!audioRef.current) {
      const { url, revoke } = toPlayableAudioUrl(playableSrc);
      if (!url) return;
      const a = new Audio(url);
      a.loop = true;
      a.volume = 0.25;
      a.muted = muted;
      a.ontimeupdate = () => {
        if (a.duration) setProgress((a.currentTime / a.duration) * 100);
      };
      a.onended = () => setPlaying(false);
      audioRef.current = { a, revoke };
    }
    audioRef.current.a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const scrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setProgress(v);
    const a = audioRef.current?.a;
    if (a && a.duration) a.currentTime = (v / 100) * a.duration;
  };

  return (
    <section
      className={`rounded-2xl border border-[var(--pf-card-border)] p-3.5 ${transparent ? 'backdrop-blur-md' : ''}`}
      style={{ background: 'var(--pf-card)' }}
    >
      <div className="flex items-center gap-3">
        <div className="relative grid size-11 flex-none place-items-center overflow-hidden rounded-xl bg-black/35 ring-1 ring-white/10 text-[var(--pf-accent)]">
          <Disc3 size={22} className={playing ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div dir="auto" className="truncate text-[13px] font-bold text-[var(--pf-text)]">
            {songTitle || (ar ? 'أغنية الملف' : 'Profile Song')}
          </div>
          <div dir="auto" className="truncate text-[11.5px] text-[var(--pf-text-muted)]">
            {songArtist || (playableSrc ? (ar ? 'مقطع صوتي' : 'Audio clip') : externalUrl ? externalUrl.slice(0, 28) : (ar ? 'اضغط لتشغيل أغنية الملف' : 'Click to play profile song'))}
          </div>
        </div>
        {playing ? (
          <div className="flex h-4 items-end gap-0.5 px-1" aria-hidden>
            <span className="w-0.5 animate-pulse rounded bg-[var(--pf-accent)] h-2.5" />
            <span className="w-0.5 animate-pulse rounded bg-[var(--pf-accent)] h-4" />
            <span className="w-0.5 animate-pulse rounded bg-[var(--pf-accent)] h-2" />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="grid size-7 place-items-center rounded-full text-[var(--pf-text-muted)] hover:bg-white/10 hover:text-[var(--pf-text)]"
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!playableSrc}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-8 flex-none place-items-center rounded-full transition hover:brightness-110 disabled:opacity-40"
          style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ms-0.5" />}
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={progress}
          onChange={scrub}
          disabled={!playableSrc}
          className="h-1 flex-1 accent-[var(--pf-accent)]"
        />
      </div>
    </section>
  );
}
