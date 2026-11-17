import { useMemo, useState } from 'react';
import { Billboard } from '../ui/Billboard';
import { Top10 } from '../ui/Top10';
import { CatalogRow, useWatched } from '../ui/CatalogRow';
import { PosterGrid, Chips, useCatalogPages } from '../ui/Grid';
import { useRows, useTrending, cinemetaRow, CINEMETA } from '../api';
import { useT } from '../host';

// Movies / Shows: today's hero and top 10 of that type, the genres, then every addon row of that type
export function TypePage({ type }: { type: 'movie' | 'series' }) {
  const t = useT();
  const rows = useRows(), trend = useTrending(type), watched = useWatched();
  const [genre, setGenre] = useState<string | null>(null);
  const mine = (rows.data || []).filter((r) => r.type === type);
  const genres = mine.find((r) => r.addon === CINEMETA && r.id === 'top')?.extra.find((x) => x.name === 'genre')?.options || [];
  const base = useMemo(() => cinemetaRow(type), [type]);
  const pages = useCatalogPages(genre ? base : null, genre ? [['genre', genre]] : []);
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      <Billboard items={(trend.data || []).slice(0, 6)} />
      <div className="relative z-10 -mt-4 px-12">
        <Chips value={genre} onChange={setGenre} options={[{ id: null, label: t('all') }, ...genres.map((g) => ({ id: g, label: g }))]} />
      </div>
      {genre ? (
        <div className="px-12 pt-8">
          <PosterGrid items={(pages.data?.pages || []).flat()} watched={watched} loading={pages.isFetching} onEnd={() => pages.hasNextPage && !pages.isFetching && pages.fetchNextPage()} />
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
