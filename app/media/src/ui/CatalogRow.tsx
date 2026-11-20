import { useMemo } from 'react';
import { Row } from './Row';
import { Poster, PosterSkeleton } from './Poster';
import { useInView } from './useInView';
import { useCatalog, useLibrary, type Row as RowT } from '../api';
import { useSettingsStore } from '../settings/useSettingsStore';

export function isUnreleased(item: { released?: string | null; year?: number | null }, nowMs = Date.now()): boolean {
  if (item.released) {
    const t = Date.parse(item.released);
    if (Number.isFinite(t)) return t > nowMs;
  }
  return false;
}

// ids the viewer has watched (whole titles), for the ✓ on posters
export function useWatched() {
  const { data } = useLibrary();
  return useMemo(() => new Set((data || []).filter((x) => x.state.flaggedWatched || x.state.majlisWatched?.includes(x._id)).map((x) => x._id)), [data]);
}

// an addon catalog as a row; it asks the addon only when it scrolls near the screen
export function CatalogRow({ row, title, watched }: { row: RowT; title: string; watched: Set<string> }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const q = useCatalog(row, [], seen);
  const hideWatched = useSettingsStore((s) => s.data.sources.hideWatchedCatalogs);
  const hideUnreleased = useSettingsStore((s) => s.data.sources.hideUnreleasedCatalogs);
  const filtered = useMemo(() => {
    const raw = q.data || [];
    if (!hideWatched && !hideUnreleased) return raw;
    return raw.filter((it) => (!hideWatched || !watched.has(it.id)) && (!hideUnreleased || !isUnreleased(it)));
  }, [q.data, hideWatched, hideUnreleased, watched]);

  if (q.isError || (q.data && !filtered.length)) return null;
  return (
    <div ref={ref} className="min-h-[300px]">
      {seen ? <Row title={title} sub={row.addonName} items={filtered} width={168} height={262} loading={q.isLoading}
        skeleton={<PosterSkeleton />} render={(it) => <Poster item={it} watched={watched.has(it.id)} />} /> : null}
    </div>
  );
}
