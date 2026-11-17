import { useState } from 'react';
import { useHistory, useLibrary, useLists, type HistoryEntry, type Preview } from '../api';
import { useNav, useT } from '../host';
import type { Key } from '../i18n';
import { PosterGrid, Chips } from '../ui/Grid';
import { useWatched } from '../ui/CatalogRow';
import { Img } from '../ui/Img';

type LTab = 'library' | 'watchlist' | 'history' | 'favorites';
const asPreview = (x: { id: string; type: string; name: string; poster: string | null }): Preview => ({ id: x.id, type: x.type, name: x.name, poster: x.poster });

export function Library() {
  const t = useT();
  const [tab, setTab] = useState<LTab>('library');
  const [type, setType] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'az'>('recent');
  const lib = useLibrary(), lists = useLists(), hist = useHistory(), watched = useWatched();
  const tabs: { id: LTab; label: Key }[] = [{ id: 'library', label: 'library' }, { id: 'watchlist', label: 'watchlist' }, { id: 'history', label: 'history' }, { id: 'favorites', label: 'favorite' }];
  let items: Preview[] = [];
  if (tab === 'library') items = (lib.data || []).map((x) => asPreview({ id: x._id, type: x.type, name: x.name, poster: x.poster }));
  if (tab === 'watchlist' || tab === 'favorites') items = (lists.data?.[tab] || []).map(asPreview);
  if (type) items = items.filter((x) => x.type === type);
  if (sort === 'az') items = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const empty = tab !== 'history' && !items.length && !lib.isLoading;
  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} className={`relative px-4 py-2 text-[15px] transition ${tab === x.id ? 'font-semibold text-fg' : 'text-fg2 hover:text-fg'}`}>
            {t(x.label)}{tab === x.id ? <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-acc" /> : null}
          </button>
        ))}
        <span className="flex-1" />
        {tab !== 'history' ? <>
          <Chips value={type} onChange={setType} options={[{ id: null, label: t('all') }, { id: 'movie', label: t('type_movie') }, { id: 'series', label: t('type_series') }]} />
          <Chips value={sort} onChange={(v) => setSort(v || 'recent')} options={[{ id: 'recent', label: t('sort_recent') }, { id: 'az', label: t('sort_az') }]} />
        </> : null}
      </div>
      {tab === 'history' ? <History groups={hist.data || []} /> : empty ? <p className="py-20 text-center text-fg3">{t('empty_list')}</p> : <PosterGrid items={items} watched={watched} />}
    </div>
  );
}

function History({ groups }: { groups: { group: string; items: HistoryEntry[] }[] }) {
  const t = useT(), nav = useNav();
  if (!groups.length) return <p className="py-20 text-center text-fg3">{t('empty_history')}</p>;
  const name = (g: string) => (g === 'today' ? t('today') : g === 'week' ? t('this_week') : g === 'month' ? t('this_month') : g);
  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <section key={g.group}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-fg3">{name(g.group)}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {g.items.map((h, i) => {
              const ep = /:(\d+):(\d+)$/.exec(h.videoId);
              return (
                <button key={i} onClick={() => nav.open({ kind: 'title', type: h.type, id: h.id })} className="flex items-center gap-3 rounded-xl bg-bg1 p-2.5 text-start ring-1 ring-line transition hover:bg-white/5">
                  <span className="h-[72px] w-12 flex-none overflow-hidden rounded-md bg-bg3"><Img srcs={[h.poster]} className="h-full w-full object-cover" /></span>
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-semibold">{h.name}</span>
                    {ep ? <span className="block font-mono text-xs text-fg2">S{ep[1]}E{ep[2]}</span> : null}
                    <span className="block text-[11px] text-fg3">{new Date(h.at).toLocaleString()}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
