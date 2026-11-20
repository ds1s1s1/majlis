import { useEffect, useMemo, useRef, useState } from 'react';
import { Img } from './Img';
import { Icon } from './Icon';
import { episodeOf, metahub, useContinue, useMeta, yearOf, type LibItem, type Preview } from '../api';
import { rememberFlip, useHost, useNav, useT } from '../host';
import { genreLabel } from '../config/genres';

interface Slide {
  id: string;
  name: string;
  poster?: string | null;
  background?: string | null;
  logo?: string | null;
  imdbRating?: string | null;
  releaseInfo?: string | number;
  year?: number | null;
  description?: string;
  videoId?: string;
  pos?: number;
  pct?: number;
  ep?: { season: number; episode: number } | null;
  fromContinue?: boolean;
}

function circularOffset(index: number, active: number, total: number): number {
  let d = index - active;
  if (d > total / 2) d -= total;
  if (d < -total / 2) d += total;
  return d;
}

// 3D stacked "One more episode" carousel on Shows: center focus, perspective, rotateY, opacity, keyboard + wheel + drag
export function ShowsCarousel({ trending }: { trending: Preview[] }) {
  const t = useT(), nav = useNav(), { lang } = useHost();
  const rtl = lang === 'ar';
  const cont = useContinue();

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const seen = new Set<string>();
    for (const c of (cont.data || []).filter((x: LibItem) => x.type === 'series')) {
      if (seen.has(c._id)) continue;
      seen.add(c._id);
      const s = c.state, ep = episodeOf(s.video_id);
      const pct = s.duration ? Math.min(100, (s.timeOffset / s.duration) * 100) : 0;
      out.push({
        id: c._id, name: c.name, poster: c.poster, videoId: s.video_id || undefined,
        pos: s.timeOffset > 1 ? s.timeOffset : undefined, pct, ep, fromContinue: true,
      });
    }
    for (const tr of trending) {
      if (out.length >= 8) break;
      if (seen.has(tr.id)) continue;
      seen.add(tr.id);
      out.push({
        id: tr.id, name: tr.name, poster: tr.poster, background: tr.background, logo: tr.logo,
        imdbRating: tr.imdbRating, releaseInfo: tr.releaseInfo, year: tr.year, description: tr.description,
      });
    }
    return out;
  }, [cont.data, trending]);

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPx, setDragPx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const vel = useRef(0);
  const moved = useRef(false);
  const wheelLock = useRef(0);

  const len = slides.length;
  const idx = len ? ((active % len) + len) % len : 0;
  const step = (delta: number) => { if (len > 1) setActive((a) => (a + delta + len) % len); };

  useEffect(() => {
    if (paused || dragging || len < 2) return;
    const id = setInterval(() => setActive((a) => (a + 1) % len), 8500);
    return () => clearInterval(id);
  }, [paused, dragging, len]);

  if (!len) return <div className="skel h-[520px] w-full" />;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || len < 2) return;
    setDragging(true);
    moved.current = false;
    startX.current = lastX.current = e.clientX;
    lastT.current = performance.now();
    vel.current = 0;
    setDragPx(0);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6 && !moved.current) {
      moved.current = true;
      try { trackRef.current?.setPointerCapture(e.pointerId); } catch {}
    }
    const now = performance.now(), dt = now - lastT.current;
    if (dt > 0) vel.current = vel.current * 0.6 + ((e.clientX - lastX.current) / dt) * 0.4;
    lastX.current = e.clientX;
    lastT.current = now;
    setDragPx(dx);
  };
  const onPointerEnd = () => {
    if (!dragging) return;
    setDragging(false);
    const w = trackRef.current?.clientWidth || 900;
    if (Math.abs(vel.current) > 0.38 || Math.abs(dragPx) > w * 0.12) {
      const dir = (dragPx < 0 ? 1 : -1) * (rtl ? -1 : 1);
      step(dir);
    }
    setDragPx(0);
    vel.current = 0;
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (Math.abs(d) < 18) return;
    const now = performance.now();
    if (now - wheelLock.current < 260) return;
    wheelLock.current = now;
    step((d > 0 ? 1 : -1) * (rtl ? -1 : 1));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(rtl ? 1 : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(rtl ? -1 : 1); }
  };

  return (
    <section
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label={t('one_more_ep')}
      className="relative px-12 pb-6 pt-28 outline-none"
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-acc">{t('shows')}</span>
          <h1 className="text-3xl font-bold">{t('one_more_ep')}</h1>
          <p className="text-sm text-fg2">{t('one_more_sub')}</p>
        </div>
        {len > 1 ? (
          <div className="flex items-center gap-2">
            <button aria-label="previous" onClick={() => step(-1)} className="grid size-9 place-items-center rounded-full bg-white/8 text-fg2 transition hover:bg-white/15 hover:text-fg">
              <Icon n="chevl" s={18} className="flip" />
            </button>
            <button aria-label="next" onClick={() => step(1)} className="grid size-9 place-items-center rounded-full bg-white/8 text-fg2 transition hover:bg-white/15 hover:text-fg">
              <Icon n="chevr" s={18} className="flip" />
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={onWheel}
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } }}
        className={`relative h-[420px] w-full select-none overflow-visible ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ perspective: '1400px', touchAction: 'pan-y' }}
      >
        {slides.map((s, i) => {
          const offset = circularOffset(i, idx, len);
          if (Math.abs(offset) > 2) return null;
          return (
            <CarouselCard
              key={s.id}
              slide={s}
              offset={offset}
              active={offset === 0}
              rtl={rtl}
              dragging={dragging}
              dragPx={dragPx}
              trackWidth={trackRef.current?.clientWidth || 1000}
              onSelect={() => setActive(i)}
              onOpen={(el, auto) => {
                rememberFlip(el, s.poster);
                nav.open({ kind: 'title', type: 'series', id: s.id, autoplay: auto ? (s.videoId || s.id) : undefined, pos: auto ? s.pos : undefined });
              }}
            />
          );
        })}
      </div>

      {len > 1 ? (
        <div className="mt-4 flex justify-center gap-1.5">
          {slides.map((s, i) => (
            <button key={s.id} aria-label={s.name} onClick={() => setActive(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? 'w-8 bg-acc' : 'w-1.5 bg-fg/35 hover:bg-fg/65'}`} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CarouselCard({ slide, offset, active, rtl, dragging, dragPx, trackWidth, onSelect, onOpen }: {
  slide: Slide; offset: number; active: boolean; rtl: boolean; dragging: boolean; dragPx: number; trackWidth: number;
  onSelect: () => void; onOpen: (el: HTMLElement | null, auto: boolean) => void;
}) {
  const t = useT(), { lang } = useHost();
  const { data: m } = useMeta(Math.abs(offset) <= 1 ? 'series' : null, Math.abs(offset) <= 1 ? slide.id : null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragPct = dragging && trackWidth > 0 ? (dragPx / trackWidth) * 100 : 0;
  const dirOffset = rtl ? -offset : offset;
  const xPct = dirOffset * 52 + dragPct;
  const rotY = -dirOffset * 22;
  const scale = active ? 1 : Math.max(0.72, 1 - Math.abs(offset) * 0.14);
  const zPx = -Math.abs(offset) * 110;
  const opacity = active ? 1 : Math.abs(offset) === 1 ? 0.56 : 0.22;
  const zIndex = 20 - Math.abs(offset) * 5;
  const desc = (lang === 'ar' && m?.descriptionAr) || m?.description || slide.description;
  const imdb = m?.ratings?.imdb ?? m?.imdbRating ?? slide.imdbRating;
  const yr = yearOf((m || slide) as Preview);

  return (
    <div
      ref={cardRef}
      onClick={() => (active ? onOpen(cardRef.current, false) : onSelect())}
      className="
        absolute left-1/2 top-1/2 h-[400px] w-[min(860px,74vw)] overflow-hidden rounded-2xl bg-bg2
        ring-1 ring-white/12 shadow-[0_28px_64px_-20px_rgba(0,0,0,0.85)]
      "
      style={{
        transform: `translate(-50%, -50%) translate3d(${xPct}%, 0, ${zPx}px) scale(${scale}) rotateY(${rotY}deg)`,
        transition: dragging ? 'none' : 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 560ms cubic-bezier(0.22, 1, 0.36, 1)',
        opacity,
        zIndex,
        willChange: 'transform, opacity',
      }}
    >
      <Img eager={active} srcs={[m?.background, slide.background, metahub('background', slide.id, 'large'), slide.poster]}
        className="absolute inset-0 h-full w-full object-cover object-top" />
      <div className="shade-s absolute inset-0" />
      <div className="shade-b absolute inset-0" />

      <div className="absolute bottom-8 start-8 end-8 max-w-[520px]">
        <Img eager={active} srcs={[m?.logo, slide.logo, metahub('logo', slide.id, 'large')]} alt={slide.name}
          className="mb-3 max-h-24 max-w-[340px] object-contain object-[var(--a)] drop-shadow-[0_4px_18px_rgba(0,0,0,.75)] [--a:left] rtl:[--a:right]"
          fallback={<h2 className="mb-2 text-3xl font-bold leading-tight">{slide.name}</h2>} />

        <div className="mb-2.5 flex flex-wrap items-center gap-2.5 text-xs text-fg2">
          {slide.ep ? (
            <span dir="ltr" className="rounded-md bg-acc px-2 py-0.5 font-mono font-bold text-acc-ink">
              ▶ S{slide.ep.season}E{slide.ep.episode} · {t('up_next')}
            </span>
          ) : slide.fromContinue ? (
            <span className="rounded-md bg-acc px-2 py-0.5 font-bold text-acc-ink">▶ {t('resume')}</span>
          ) : null}
          {imdb ? <span dir="ltr" className="rounded bg-black/55 px-1.5 py-0.5 font-mono font-semibold text-[#f5c518]">IMDb ★ {imdb}</span> : null}
          {yr ? <span>{yr}</span> : null}
          {(m?.genres || []).slice(0, 3).map((g) => <span key={g} className="text-fg3">{genreLabel(g, lang)}</span>)}
        </div>

        {desc ? <p dir="auto" className="clamp-2 mb-4 text-[13.5px] leading-relaxed text-fg2">{desc}</p> : null}

        {active ? (
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onOpen(cardRef.current, true)}
              className="flex items-center gap-2 rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
              <Icon n="play" s={18} />{slide.fromContinue ? t('resume') : t('play')}
            </button>
            <button onClick={() => onOpen(cardRef.current, false)}
              className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold backdrop-blur-md transition hover:bg-white/25">
              <Icon n="info" s={18} />{t('more_info')}
            </button>
          </div>
        ) : null}
      </div>

      {slide.pct && slide.pct > 0 ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <div className="h-full bg-acc" style={{ width: `${Math.min(100, slide.pct)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
