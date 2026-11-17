import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { cin, type Preview, type Row } from '../api';
import { Poster, PosterSkeleton } from './Poster';

// a catalog page by page (Stremio's skip = how many items we already have), only when the catalog takes skip
export function useCatalogPages(row: Row | null, extra: [string, string][]) {
  const paged = !!row?.extra.some((x) => x.name === 'skip');
  return useInfiniteQuery({
    queryKey: ['catalog-pages', row?.addon, row?.type, row?.id, extra],
    enabled: !!row,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => cin<Preview[]>('catalog', { addon: row!.addon, type: row!.type, id: row!.id, extra: pageParam ? [...extra, ['skip', String(pageParam)]] : extra }).catch(() => [] as Preview[]),
    getNextPageParam: (last, all) => (paged && last.length ? all.reduce((n, p) => n + p.length, 0) : undefined),
    staleTime: 30 * 60000,
  });
}

// posters in a wrapping grid; `onEnd` when the last row comes near the screen
export function PosterGrid({ items, watched, onEnd, loading, w = 160 }: { items: Preview[]; watched?: Set<string>; onEnd?: () => void; loading?: boolean; w?: number }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onEnd || !end.current) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) onEnd(); }, { rootMargin: '900px' });
    io.observe(end.current);
    return () => io.disconnect();
  }, [onEnd, items.length]);
  const seen = new Set<string>();
  return (
    <>
      <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${w}px, 1fr))` }}>
        {items.filter((m) => !seen.has(m.id) && seen.add(m.id)).map((m) => (
          <div key={m.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_260px]"><Poster item={m} w={w} watched={watched?.has(m.id)} /></div>
        ))}
        {loading ? Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={`s${i}`} w={w} />) : null}
      </div>
      <div ref={end} className="h-px" />
    </>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T | null; options: { id: T | null; label: string }[]; onChange: (v: T | null) => void }) {
  return (
    <div className="hscroll flex gap-2 pb-1">
      {options.map((o) => (
        <button key={String(o.id)} onClick={() => onChange(o.id)}
          className={`flex-none rounded-full px-4 py-1.5 text-[13px] transition ${value === o.id ? 'bg-fg text-bg' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'}`}>{o.label}</button>
      ))}
    </div>
  );
}
