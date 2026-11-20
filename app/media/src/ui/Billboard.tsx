import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Img } from './Img';
import { Icon } from './Icon';
import { cin, useMeta, metahub, yearOf, type Item, type Preview } from '../api';
import { useNav, useT, useHost } from '../host';
import { genreLabel } from '../config/genres';

// The full-bleed hero: a few titles in turn (every 9 s, paused while the pointer is on it) with GPU crossfade
export function Billboard({ items }: { items: Preview[] }) {
  const list = items.filter((x) => x.background || /^tt/.test(x.id)).slice(0, 6);
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const qc = useQueryClient();
  const activeIdx = list.length ? i % list.length : 0;
  const cur = list[activeIdx];
  const { data: m } = useMeta(cur?.type ?? null, cur?.id ?? null);
  const nav = useNav(), t = useT(), { lang } = useHost();

  useEffect(() => {
    if (hold || list.length < 2) return;
    const next = list[(activeIdx + 1) % list.length];
    qc.prefetchQuery({ queryKey: ['meta', next.type, next.id], queryFn: () => cin<Item>('meta', { type: next.type, id: next.id }), staleTime: 3600000 });
    const id = setTimeout(() => setI((x) => (x + 1) % list.length), 9000);
    return () => clearTimeout(id);
  }, [activeIdx, hold, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return <div className="skel h-[min(78vh,760px)] w-full" />;
  const item = { ...cur, ...(m || {}) } as Item;
  const desc = (lang === 'ar' && item.descriptionAr) || item.description;
  const imdb = item.ratings?.imdb ?? item.imdbRating;
  const mal = item.malRating ?? item.ratings?.mal;
  const rt = item.ratings?.rt;
  return (
    <section onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} className="relative h-[min(78vh,760px)] min-h-[460px] w-full overflow-hidden">
      {list.map((slide, k) => {
        const on = k === activeIdx;
        const bg = on && m?.background ? m.background : slide.background;
        return (
          <div key={slide.id} className={`absolute inset-0 transition-opacity duration-700 ease-out ${on ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <Img eager={on} srcs={[bg, metahub('background', slide.id, 'large'), slide.poster]}
              className={`h-full w-full scale-[1.04] object-cover object-top ${on ? 'animate-[cin-drift_14s_ease-out_both]' : ''}`} />
          </div>
        );
      })}
      <div className="shade-s absolute inset-0" />
      <div className="shade-b absolute inset-0" />
      <div key={`t${item.id}`} className="absolute bottom-[14%] start-12 max-w-[min(560px,48vw)] fade-in">
        <Img eager srcs={[item.logo, metahub('logo', item.id, 'large')]} alt={item.name} className="mb-5 max-h-36 max-w-[min(460px,40vw)] object-contain object-[var(--a)] drop-shadow-[0_4px_24px_rgba(0,0,0,.6)] [--a:left] rtl:[--a:right]"
          fallback={<h1 className="mb-4 text-5xl font-bold leading-tight">{item.name}</h1>} />
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg2">
          {imdb ? <span dir="ltr" className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#f5c518]">IMDb ★ {imdb}</span> : null}
          {mal ? <span dir="ltr" className="rounded bg-[#2e51a2]/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">MAL ★ {mal}</span> : null}
          {rt ? <span dir="ltr" className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-red-300">🍅 {rt}</span> : null}
          {yearOf(item) ? <span>{yearOf(item)}</span> : null}
          {item.certification ? <span className="rounded border border-fg3 px-1.5 text-xs">{item.certification}</span> : null}
          {item.runtime ? <span dir="ltr">{item.runtime}</span> : null}
          {(item.genres || []).slice(0, 3).map((g) => <span key={g} className="text-fg3">{genreLabel(g, lang)}</span>)}
        </div>
        {desc ? <p dir="auto" className="clamp-3 mb-6 text-[15px] leading-relaxed text-fg2">{desc}</p> : null}
        <div className="flex gap-3">
          <button onClick={() => nav.open({ kind: 'title', type: item.type, id: item.id, autoplay: item.type === 'movie' ? item.id : undefined })}
            className="flex items-center gap-2 rounded-full bg-fg px-7 py-3 text-[15px] font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
            <Icon n="play" s={20} />{t('play')}
          </button>
          <button onClick={() => nav.open({ kind: 'title', type: item.type, id: item.id })}
            className="flex items-center gap-2 rounded-full bg-white/15 px-6 py-3 text-[15px] font-semibold backdrop-blur-md transition hover:bg-white/25">
            <Icon n="info" s={20} />{t('more_info')}
          </button>
        </div>
      </div>
      {list.length > 1 ? (
        <div className="absolute bottom-[7%] end-12 flex gap-1.5">
          {list.map((x, k) => <button key={x.id} aria-label={x.name} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === activeIdx ? 'w-7 bg-fg' : 'w-1.5 bg-fg/40 hover:bg-fg/70'}`} />)}
        </div>
      ) : null}
    </section>
  );
}
