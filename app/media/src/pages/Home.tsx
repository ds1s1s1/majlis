import { useMemo } from 'react';
import { Billboard } from '../ui/Billboard';
import { ContinueRow } from '../ui/ContinueRow';
import { Top10 } from '../ui/Top10';
import { CatalogRow, useWatched } from '../ui/CatalogRow';
import { useRows, useTrending } from '../api';
import { useT } from '../host';

export function Home() {
  const t = useT();
  const rows = useRows();
  const tm = useTrending('movie'), ts = useTrending('series');
  const watched = useWatched();
  // the hero alternates today's films and shows
  const hero = useMemo(() => {
    const a = tm.data || [], b = ts.data || [], out = [];
    for (let i = 0; i < 4; i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
    return out;
  }, [tm.data, ts.data]);
  const names = new Map<string, number>();
  for (const r of rows.data || []) names.set(r.name, (names.get(r.name) || 0) + 1);
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      <Billboard items={hero} />
      <div className="relative z-10 -mt-20">
        <ContinueRow />
        <Top10 title={t('top10_movies')} items={tm.data || []} />
        {(rows.data || []).map((r) => (
          <CatalogRow key={`${r.addon}|${r.type}|${r.id}`} row={r} watched={watched}
            title={(names.get(r.name) || 0) > 1 ? `${r.name} · ${r.type === 'movie' ? t('type_movie') : r.type === 'series' ? t('type_series') : r.type}` : r.name} />
        ))}
        <Top10 title={t('top10_shows')} items={ts.data || []} />
      </div>
    </div>
  );
}
