import { useMemo, useState } from 'react';
import { Billboard } from '../ui/Billboard';
import { ShowsCarousel } from '../ui/ShowsCarousel';
import { Top10 } from '../ui/Top10';
import { CatalogRow, isUnreleased, useWatched } from '../ui/CatalogRow';
import { PosterGrid, Chips, useCatalogPages } from '../ui/Grid';
import { useSettingsStore } from '../settings/useSettingsStore';
import { STREAMING_BRANDS, useBrandCatalog, useRows, useTrending, cinemetaRow, CINEMETA } from '../api';
import { ServiceLogo } from '../ui/ServiceLogos';
import { useHost, useT } from '../host';
import { genreLabel } from '../config/genres';

// Movies / Shows: today's hero, Streaming Platform filter chips, Genres, Top 10, and every addon row
export function TypePage({ type }: { type: 'movie' | 'series' }) {
  const t = useT(), { lang } = useHost();
  const rows = useRows(), trend = useTrending(type), watched = useWatched();
  const hideWatched = useSettingsStore((s) => s.data.sources.hideWatchedCatalogs);
  const hideUnreleased = useSettingsStore((s) => s.data.sources.hideUnreleasedCatalogs);
  const [genre, setGenre] = useState<string | null>(null);
  const [brand, setBrand] = useState<(typeof STREAMING_BRANDS)[number] | null>(null);

  const mine = (rows.data || []).filter((r) => r.type === type);
  const genres = mine.find((r) => r.addon === CINEMETA && r.id === 'top')?.extra.find((x) => x.name === 'genre')?.options || [];
  const base = useMemo(() => cinemetaRow(type), [type]);
  const pages = useCatalogPages(genre && !brand ? base : null, genre ? [['genre', genre]] : []);
  const brandQ = useBrandCatalog(brand?.id || 0, brand?.key || '', type, !!brand);
  const filterItems = <T extends { id: string; released?: string | null }>(list: T[]) =>
    (!hideWatched && !hideUnreleased) ? list : list.filter((it) => (!hideWatched || !watched.has(it.id)) && (!hideUnreleased || !isUnreleased(it)));
  const brandItems = useMemo(() => filterItems(brandQ.data || []), [brandQ.data, hideWatched, hideUnreleased, watched]);
  const pageItems = useMemo(() => filterItems((pages.data?.pages || []).flat()), [pages.data, hideWatched, hideUnreleased, watched]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      {type === 'series' ? <ShowsCarousel trending={trend.data || []} /> : <Billboard items={(trend.data || []).slice(0, 6)} />}
      <div className={`relative z-10 space-y-2.5 px-12 ${type === 'series' ? 'mt-2' : '-mt-4'}`}>
        <div className="hscroll flex gap-2 pb-1">
          {STREAMING_BRANDS.map((b) => {
            const on = brand?.id === b.id;
            return (
              <button key={b.id} onClick={() => { setBrand(on ? null : b); if (!on) setGenre(null); }} aria-label={b.name}
                className={`flex h-9 flex-none items-center rounded-full border px-3.5 transition [&>span]:transition-all hover:[&>span]:drop-shadow-[0_0_8px_rgba(226,164,58,0.35)] ${on ? 'border-acc bg-[#1a1610] text-acc shadow-[0_0_16px_rgba(226,164,58,0.2)]' : 'border-white/10 bg-[#12100e] text-[#ebe3d5] hover:border-acc/55 hover:text-acc'}`}>
                <ServiceLogo service={b.key} name={b.name} compact />
              </button>
            );
          })}
        </div>
        <Chips value={genre} onChange={(g) => { setGenre(g); if (g) setBrand(null); }} options={[{ id: null, label: t('all') }, ...genres.map((g) => ({ id: g, label: genreLabel(g, lang) }))]} />
      </div>
      {brand ? (
        <div className="px-12 pt-8">
          <PosterGrid items={brandItems} watched={watched} loading={brandQ.isLoading} />
        </div>
      ) : genre ? (
        <div className="px-12 pt-8">
          <PosterGrid items={pageItems} watched={watched} loading={pages.isFetching} onEnd={() => pages.hasNextPage && !pages.isFetching && pages.fetchNextPage()} />
        </div>
      ) : (
        <div className="relative z-10">
          <Top10 title={type === 'movie' ? t('top10_movies') : t('top10_shows')} items={trend.data || []} />
          {mine.map((r) => <CatalogRow key={`${r.addon}|${r.id}`} row={r} title={r.name} watched={watched} />)}
        </div>
      )}
    </div>
  );
}
