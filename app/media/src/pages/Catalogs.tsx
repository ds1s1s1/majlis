import { useState } from 'react';
import { useRows } from '../api';
import { useHost, useT } from '../host';
import { genreLabel } from '../config/genres';
import { PosterGrid, Chips, useCatalogPages } from '../ui/Grid';
import { useWatched } from '../ui/CatalogRow';

// Stremio's Discover: pick a type, one of the addons' catalogs, a genre; scroll for more
export function Catalogs() {
  const t = useT(), { lang } = useHost();
  const rows = useRows(), watched = useWatched();
  const all = rows.data || [];
  const types = [...new Set(all.map((r) => r.type))];
  const [type, setType] = useState<string | null>(null);
  const ty = type || types[0] || null;
  const cats = all.filter((r) => r.type === ty);
  const [catKey, setCatKey] = useState<string | null>(null);
  const cat = cats.find((r) => `${r.addon}|${r.id}` === catKey) || cats[0] || null;
  const genres = cat?.extra.find((x) => x.name === 'genre')?.options || [];
  const [genre, setGenre] = useState<string | null>(null);
  const g = genre && genres.includes(genre) ? genre : null;
  const pages = useCatalogPages(cat, g ? [['genre', g]] : []);
  const typeName = (x: string) => (x === 'movie' ? t('type_movie') : x === 'series' ? t('type_series') : x === 'anime' ? t('anime') : x);
  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-6 space-y-3">
        <Chips value={ty} onChange={(v) => { setType(v); setCatKey(null); setGenre(null); }} options={types.map((x) => ({ id: x, label: typeName(x) }))} />
        <Chips value={cat ? `${cat.addon}|${cat.id}` : null} onChange={(v) => { setCatKey(v); setGenre(null); }}
          options={cats.map((r) => ({ id: `${r.addon}|${r.id}`, label: `${r.name} · ${r.addonName}` }))} />
        {genres.length ? <Chips value={g} onChange={setGenre} options={[{ id: null, label: t('all') }, ...genres.map((x) => ({ id: x, label: genreLabel(x, lang) }))]} /> : null}
      </div>
      <PosterGrid items={(pages.data?.pages || []).flat()} watched={watched} loading={pages.isFetching}
        onEnd={() => pages.hasNextPage && !pages.isFetching && pages.fetchNextPage()} />
    </div>
  );
}
