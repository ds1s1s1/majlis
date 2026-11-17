import { useEffect, useRef, useState } from 'react';
import { useSearch, type Preview } from '../api';
import { useT } from '../host';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { useWatched } from '../ui/CatalogRow';
import { Icon } from '../ui/Icon';

// One box, every addon catalog that can search; films first, then shows, duplicates dropped
export function Search({ active }: { active: boolean }) {
  const t = useT();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const watched = useWatched();
  useEffect(() => { if (active) input.current?.focus(); }, [active]);
  useEffect(() => { const id = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(id); }, [text]);
  const r = useSearch(q);
  const groups = new Map<string, Preview[]>(), seen = new Set<string>();
  for (const g of r.data || []) for (const m of g.metas) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const k = m.type === 'movie' ? t('type_movie') : m.type === 'series' ? t('type_series') : m.type;
    groups.set(k, [...(groups.get(k) || []), m]);
  }
  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <label className="mx-auto mb-10 flex max-w-3xl items-center gap-3 rounded-full bg-white/8 px-6 py-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-acc">
        <Icon n="search" s={22} className="text-fg3" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search_ph')} className="flex-1 text-xl placeholder:text-fg3" />
        {text ? <button aria-label="clear" onClick={() => setText('')} className="text-fg3 hover:text-fg"><Icon n="x" s={18} /></button> : null}
      </label>
      {q.length < 2 ? <p className="text-center text-fg3">{t('search_empty')}</p>
        : r.isLoading ? <div className="flex flex-wrap gap-4">{Array.from({ length: 14 }, (_, i) => <PosterSkeleton key={i} w={160} />)}</div>
        : !seen.size ? <p className="text-center text-fg2">{t('no_results', { q })}</p>
        : [...groups].map(([k, list]) => (
          <section key={k} className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">{k}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
              {list.map((m) => <Poster key={m.id} item={m} w={160} watched={watched.has(m.id)} />)}
            </div>
          </section>
        ))}
    </div>
  );
}
