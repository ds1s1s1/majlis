import { useEffect, useState } from 'react';
import { useEntityCatalog, type Preview } from '../api';
import { useT } from '../host';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { useWatched } from '../ui/CatalogRow';

export function EntityBrowse({
  entityType,
  id,
  name,
}: {
  entityType: 'company' | 'network';
  id: number;
  name: string;
}) {
  const t = useT();
  const watched = useWatched();
  const [mediaType, setMediaType] = useState<'movie' | 'series'>(entityType === 'network' ? 'series' : 'movie');
  const [page, setPage] = useState(1);
  const [acc, setAcc] = useState<Preview[]>([]);
  const q = useEntityCatalog(entityType, id, mediaType, page);

  useEffect(() => {
    setPage(1);
    setAcc([]);
  }, [entityType, id, mediaType]);

  useEffect(() => {
    if (!q.data) return;
    if (page === 1) setAcc(q.data);
    else setAcc((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return [...prev, ...q.data.filter((x) => !seen.has(x.id))];
    });
  }, [q.data, page]);

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 dir="auto" className="text-3xl font-bold text-fg">{name}</h1>
          <p className="mt-1 text-sm text-fg2">{t('entity_catalog_sub', { name })}</p>
        </div>
        <div className="flex rounded-full bg-bg1 p-0.5 text-xs ring-1 ring-line">
          {([['movie', t('type_movie')], ['series', t('type_series')]] as const).map(([kind, label]) => (
            <button
              key={kind}
              onClick={() => setMediaType(kind)}
              className={`rounded-full px-4 py-1.5 font-semibold transition ${
                mediaType === kind ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && page === 1 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
          {Array.from({ length: 14 }, (_, i) => <PosterSkeleton key={i} w={160} />)}
        </div>
      ) : !acc.length ? (
        <div className="rounded-2xl border border-line bg-bg1/60 py-16 text-center text-sm text-fg3">
          {t('entity_empty')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
            {acc.map((it) => <Poster key={it.id} item={it} w={160} watched={watched.has(it.id)} />)}
          </div>
          {(q.data?.length || 0) >= 18 ? (
            <div className="mt-8 flex justify-center">
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={q.isFetching}
                className="rounded-full bg-white/10 px-6 py-2 text-xs font-semibold text-fg transition hover:bg-acc hover:text-acc-ink disabled:opacity-50"
              >
                {q.isFetching ? '...' : t('see_all')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
