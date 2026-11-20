import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Cloud, FolderOpen, Pencil, Play, Plus, RefreshCw, Search as SearchIcon, Server, Trash2, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cin, invoke, useCustomLists, useHistory, useHomeServerItems, useHomeServers,
  useLibrary, useLists, useLocalScan, useSearch, type CloudItem, type HomeServerItem, type LibraryCustomList, type LocalMediaFile, type Preview,
} from '../api';
import { rememberFlip, useHost, useNav, useT } from '../host';
import { fmtLocaleDateTime, type Key } from '../i18n';
import { genreLabel } from '../config/genres';
import { matchesSmartQuery, parseSmartQuery, removeSmartToken } from '../utils/libraryFilter';
import { useSettingsStore } from '../settings/useSettingsStore';
import { PosterGrid, Chips } from '../ui/Grid';
import { useWatched } from '../ui/CatalogRow';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { useDownloads, type Download } from './Downloads';

type LTab = 'library' | 'watchlist' | 'lists' | 'history' | 'local' | 'favorites' | 'cloud' | 'servers';
type WatchFilter = 'all' | 'watched' | 'unwatched';
type SortMode = 'recent' | 'az' | 'za' | 'rating' | 'runtime' | 'year';
type Entry = {
  id: string; videoId: string; type: string; name: string; poster: string | null; at: number;
  year?: number | null; genres?: string[]; runtimeMin?: number | null; imdbRating?: number | null;
  directors?: string[]; cast?: string[]; inProgress?: boolean;
};

const asPreview = (x: { id: string; type: string; name: string; poster: string | null; year?: number | null; genres?: string[] }): Preview => ({
  id: x.id, type: x.type, name: x.name, poster: x.poster, year: x.year ?? null, genres: x.genres || [],
});

function bucketOf(at: number, now = new Date()): string {
  const d = new Date(at || Date.now());
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= startToday) return 'today';
  const day = (now.getDay() + 1) % 7; // Saturday week start
  if (at >= startToday - day * 864e5) return 'week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'month';
  return String(d.getFullYear());
}

function groupEntries(entries: Entry[]): { group: string; items: Entry[] }[] {
  const map = new Map<string, Entry[]>();
  const now = new Date();
  for (const e of entries) {
    const g = bucketOf(e.at, now);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(e);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

export function Library() {
  const t = useT(), { lang } = useHost();
  const [tab, setTab] = useState<LTab>('library');
  const [type, setType] = useState<string | null>(null);
  const [watchFilter, setWatchFilter] = useState<WatchFilter>('all');
  const [yearFilter, setYearFilter] = useState<string>('');
  const [genreFilter, setGenreFilter] = useState<string>('');
  const [smartQuery, setSmartQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [view, setView] = useState<'posters' | 'episodes'>('posters');
  const [grouped, setGrouped] = useState<boolean>(true);
  const lib = useLibrary(), lists = useLists(), hist = useHistory(), dls = useDownloads(), watched = useWatched();

  const tabs: { id: LTab; label: Key }[] = [
    { id: 'library', label: 'library' },
    { id: 'watchlist', label: 'watchlist' },
    { id: 'lists', label: 'tab_lists' },
    { id: 'history', label: 'history' },
    { id: 'local', label: 'local' },
    { id: 'favorites', label: 'favorite' },
    { id: 'cloud', label: 'tab_cloud' },
    { id: 'servers', label: 'tab_servers' },
  ];

  const libMap = useMemo(() => new Map((lib.data || []).map((x) => [x._id, x])), [lib.data]);

  const parsedSmart = useMemo(() => parseSmartQuery(smartQuery), [smartQuery]);

  const baseEntries = useMemo<Entry[]>(() => {
    if (tab === 'library') {
      return (lib.data || []).map((x) => ({
        id: x._id, videoId: x.state?.video_id || x._id, type: x.type, name: x.name, poster: x.poster,
        at: Date.parse(x.state?.lastWatched || x._mtime || '') || 0,
        year: x.year ?? null,
        genres: x.genres || [],
        runtimeMin: x.runtimeMin ?? (x.state?.duration ? Math.round(x.state.duration / 60000) : null),
        imdbRating: x.imdbRating ?? null,
        directors: x.directors || [],
        cast: x.cast || [],
        inProgress: !watched.has(x._id) && ((x.state?.timeOffset || 0) > 30 || (x.state?.timeWatched || 0) > 30),
      }));
    }
    if (tab === 'watchlist' || tab === 'favorites') {
      return (lists.data?.[tab] || []).map((x) => {
        const lm = libMap.get(x.id);
        return {
          id: x.id, videoId: x.videoId || x.id, type: x.type, name: x.name, poster: x.poster, at: x.at || 0,
          year: lm?.year ?? null, genres: lm?.genres || [],
          runtimeMin: lm?.runtimeMin ?? (lm?.state?.duration ? Math.round(lm.state.duration / 60000) : null),
          imdbRating: lm?.imdbRating ?? null, directors: lm?.directors || [], cast: lm?.cast || [],
          inProgress: !!lm && !watched.has(x.id) && ((lm.state?.timeOffset || 0) > 30 || (lm.state?.timeWatched || 0) > 30),
        };
      });
    }
    if (tab === 'history') {
      return (hist.data || []).flatMap((g) => g.items).map((x) => {
        const lm = libMap.get(x.id);
        return {
          ...x, year: lm?.year ?? null, genres: lm?.genres || [],
          runtimeMin: lm?.runtimeMin ?? (lm?.state?.duration ? Math.round(lm.state.duration / 60000) : null),
          imdbRating: lm?.imdbRating ?? null, directors: lm?.directors || [], cast: lm?.cast || [],
          inProgress: !!lm && !watched.has(x.id) && ((lm.state?.timeOffset || 0) > 30 || (lm.state?.timeWatched || 0) > 30),
        };
      });
    }
    return [];
  }, [tab, lib.data, lists.data, hist.data, libMap, watched]);

  const { years, genres } = useMemo(() => {
    const ys = new Set<number>(), gs = new Set<string>();
    for (const x of baseEntries) {
      if (x.year && Number.isFinite(x.year)) ys.add(Number(x.year));
      for (const g of x.genres || []) gs.add(g);
    }
    return {
      years: [...ys].sort((a, b) => b - a),
      genres: [...gs].sort(),
    };
  }, [baseEntries]);

  const entries = useMemo<Entry[]>(() => {
    let raw = baseEntries;
    if (type) raw = raw.filter((x) => x.type === type);
    if (watchFilter === 'watched') raw = raw.filter((x) => watched.has(x.id));
    else if (watchFilter === 'unwatched') raw = raw.filter((x) => !watched.has(x.id));
    if (yearFilter) raw = raw.filter((x) => String(x.year || '') === yearFilter);
    if (genreFilter) raw = raw.filter((x) => (x.genres || []).includes(genreFilter));
    if (smartQuery.trim()) raw = raw.filter((x) => matchesSmartQuery({ ...x, watched: watched.has(x.id) }, parsedSmart));
    if (sort === 'az') raw = [...raw].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'za') raw = [...raw].sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'rating') raw = [...raw].sort((a, b) => (b.imdbRating || 0) - (a.imdbRating || 0));
    else if (sort === 'runtime') raw = [...raw].sort((a, b) => (a.runtimeMin || 9999) - (b.runtimeMin || 9999));
    else if (sort === 'year') raw = [...raw].sort((a, b) => (b.year || 0) - (a.year || 0));
    else raw = [...raw].sort((a, b) => (b.at || 0) - (a.at || 0));
    return raw;
  }, [baseEntries, type, watchFilter, yearFilter, genreFilter, smartQuery, parsedSmart, sort, watched]);

  const groups = useMemo<{ group: string; items: Entry[] }[]>(() => {
    if (tab === 'history' && sort === 'recent' && !type && watchFilter === 'all' && !yearFilter && !genreFilter && !smartQuery.trim() && grouped && hist.data?.length) {
      return hist.data;
    }
    return groupEntries(entries);
  }, [tab, sort, type, watchFilter, yearFilter, genreFilter, smartQuery, grouped, hist.data, entries]);

  const localItems = useMemo(() => {
    let list = (dls.data || []).filter((d) => d.state === 'done');
    if (type) list = list.filter((d) => d.type === type);
    if (sort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'za') list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [dls.data, type, sort]);

  const groupLabel = (g: string) => (g === 'today' ? t('today') : g === 'week' ? t('this_week') : g === 'month' ? t('this_month') : g);
  const showStandardFilters = !['local', 'lists', 'cloud', 'servers'].includes(tab);

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-3">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} className={`relative px-3.5 py-2 text-[14.5px] transition ${tab === x.id ? 'font-semibold text-fg' : 'text-fg2 hover:text-fg'}`}>
            {t(x.label)}{tab === x.id ? <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-acc" /> : null}
          </button>
        ))}
        <span className="flex-1" />
        {!['lists', 'cloud', 'servers'].includes(tab) ? (
          <Chips value={type} onChange={setType} options={[{ id: null, label: t('all') }, { id: 'movie', label: t('type_movie') }, { id: 'series', label: t('type_series') }]} />
        ) : null}
        {showStandardFilters ? (
          <>
            <Chips value={watchFilter} onChange={(v) => setWatchFilter(v || 'all')} options={[
              { id: 'all', label: t('all') },
              { id: 'watched', label: t('filter_watched') },
              { id: 'unwatched', label: t('filter_unwatched') },
            ]} />
            {years.length ? (
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="rounded-full bg-bg1 px-3 py-1.5 text-xs text-fg ring-1 ring-line">
                <option value="">{t('year_all')}</option>
                {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            ) : null}
            {genres.length ? (
              <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)} className="rounded-full bg-bg1 px-3 py-1.5 text-xs text-fg ring-1 ring-line">
                <option value="">{t('genre_all')}</option>
                {genres.map((g) => <option key={g} value={g}>{genreLabel(g, lang)}</option>)}
              </select>
            ) : null}
            <div className="flex rounded-full bg-white/8 p-0.5 text-[12.5px]">
              <button onClick={() => setView('posters')} className={`rounded-full px-3 py-1 transition ${view === 'posters' ? 'bg-fg text-bg font-medium' : 'text-fg2 hover:text-fg'}`}>{t('view_posters')}</button>
              <button onClick={() => setView('episodes')} className={`rounded-full px-3 py-1 transition ${view === 'episodes' ? 'bg-fg text-bg font-medium' : 'text-fg2 hover:text-fg'}`}>{t('view_episodes')}</button>
            </div>
            <div className="flex rounded-full bg-white/8 p-0.5 text-[12.5px]">
              <button onClick={() => setGrouped(true)} className={`rounded-full px-3 py-1 transition ${grouped ? 'bg-fg text-bg font-medium' : 'text-fg2 hover:text-fg'}`}>{t('group_dates')}</button>
              <button onClick={() => setGrouped(false)} className={`rounded-full px-3 py-1 transition ${!grouped ? 'bg-fg text-bg font-medium' : 'text-fg2 hover:text-fg'}`}>{t('one_list')}</button>
            </div>
          </>
        ) : null}
        {tab !== 'lists' && tab !== 'cloud' && tab !== 'servers' ? (
          <Chips value={sort} onChange={(v) => setSort(v || 'recent')} options={[
            { id: 'recent', label: t('sort_recent') },
            { id: 'az', label: t('sort_az') },
            { id: 'za', label: t('sort_za') },
            ...(showStandardFilters ? [
              { id: 'rating' as const, label: t('sort_rating') },
              { id: 'runtime' as const, label: t('sort_runtime_short') },
              { id: 'year' as const, label: t('sort_year_new') },
            ] : []),
          ]} />
        ) : null}
      </div>

      {showStandardFilters ? (
        <div className="mb-6 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 max-w-lg">
              <SearchIcon size={14} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-fg3" />
              <input
                value={smartQuery}
                onChange={(e) => setSmartQuery(e.target.value)}
                placeholder={t('smart_filter_ph')}
                className="w-full rounded-full bg-bg1 py-2 pe-9 ps-9 text-xs text-fg ring-1 ring-line outline-none focus:ring-acc"
              />
              {smartQuery ? (
                <button
                  onClick={() => setSmartQuery('')}
                  aria-label={t('clear_filters')}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-fg3 hover:bg-white/10 hover:text-fg"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                ['movie <90m', t('smart_preset_short_movies')],
                ['7.5+ unwatched', t('smart_preset_top_unwatched')],
                ['90s', t('smart_preset_90s')],
                ['in-progress', t('smart_preset_in_progress')],
              ] as const).map(([qVal, lbl]) => (
                <button
                  key={qVal}
                  onClick={() => setSmartQuery(smartQuery.trim() === qVal ? '' : qVal)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition ${
                    smartQuery.trim() === qVal ? 'bg-acc/20 text-acc ring-acc/50 font-semibold' : 'bg-white/6 text-fg2 ring-white/10 hover:bg-white/12 hover:text-fg'
                  }`}
                >
                  {lbl}
                </button>
              ))}
              {(smartQuery || type || watchFilter !== 'all' || yearFilter || genreFilter) ? (
                <button
                  onClick={() => { setSmartQuery(''); setType(null); setWatchFilter('all'); setYearFilter(''); setGenreFilter(''); }}
                  className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-fg hover:bg-white/20"
                >
                  {t('clear_filters')}
                </button>
              ) : null}
            </div>
          </div>
          {parsedSmart.chips.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {parsedSmart.chips.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setSmartQuery(removeSmartToken(smartQuery, ch.rawToken))}
                  className="inline-flex items-center gap-1.5 rounded-full bg-acc/15 px-2.5 py-0.5 text-[11px] font-semibold text-acc ring-1 ring-acc/35 hover:bg-acc/25"
                >
                  <span>{ch.label}</span>
                  <X size={11} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'lists' ? (
        <CustomListsView watched={watched} />
      ) : tab === 'cloud' ? (
        <CloudList />
      ) : tab === 'servers' ? (
        <ServersList />
      ) : tab === 'local' ? (
        <LocalList items={localItems} loading={dls.isLoading} />
      ) : !entries.length && !lib.isLoading ? (
        <p className="py-20 text-center text-fg3">{tab === 'history' ? t('empty_history') : t('empty_list')}</p>
      ) : grouped && sort === 'recent' ? (
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g.group}>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-fg3">{groupLabel(g.group)}</h2>
              {view === 'posters' ? <PosterGrid items={g.items.map(asPreview)} watched={watched} /> : <EpisodeCards items={g.items} />}
            </section>
          ))}
        </div>
      ) : view === 'posters' ? (
        <PosterGrid items={entries.map(asPreview)} watched={watched} />
      ) : (
        <EpisodeCards items={entries} />
      )}
    </div>
  );
}

function EpisodeCards({ items }: { items: Entry[] }) {
  const nav = useNav(), { lang } = useHost();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {items.map((h, i) => {
        const ep = /:(\d+):(\d+)$/.exec(h.videoId || '');
        return (
          <button key={`${h.id}-${h.videoId}-${i}`} onClick={(e) => { rememberFlip(e.currentTarget.querySelector('span') as HTMLElement, h.poster); nav.open({ kind: 'title', type: h.type, id: h.id }); }}
            className="flex items-center gap-3 rounded-xl bg-bg1 p-2.5 text-start ring-1 ring-line transition hover:bg-white/5">
            <span className="h-[72px] w-12 flex-none overflow-hidden rounded-md bg-bg3"><Img srcs={[h.poster]} className="h-full w-full object-cover" /></span>
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-sm font-semibold">{h.name}</span>
              {ep ? <span dir="ltr" className="block font-mono text-xs text-acc">S{ep[1]}E{ep[2]}</span> : null}
              {h.at ? <span className="block text-[11px] text-fg3">{fmtLocaleDateTime(h.at, lang)}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CustomListsView({ watched }: { watched: Set<string> }) {
  const t = useT(), qc = useQueryClient();
  const q = useCustomLists();
  const lists = q.data || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const active = lists.find((x) => x.id === selectedId) || lists[0] || null;
  const create = async () => {
    if (!newName.trim()) return;
    const created = await cin<LibraryCustomList | null>('custom-list-create', { name: newName.trim() });
    setNewName('');
    await qc.invalidateQueries({ queryKey: ['custom-lists'] });
    if (created?.id) setSelectedId(created.id);
  };
  const rename = async (id: string) => {
    if (!renameText.trim()) { setRenamingId(null); return; }
    await cin('custom-list-rename', { id, name: renameText.trim() });
    setRenamingId(null);
    qc.invalidateQueries({ queryKey: ['custom-lists'] });
  };
  const del = async (id: string) => {
    await cin('custom-list-delete', { id });
    if (selectedId === id) setSelectedId(null);
    qc.invalidateQueries({ queryKey: ['custom-lists'] });
  };
  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= lists.length) return;
    const ids = lists.map((l) => l.id);
    const [picked] = ids.splice(idx, 1);
    ids.splice(target, 0, picked);
    await cin('custom-list-reorder', { ids });
    qc.invalidateQueries({ queryKey: ['custom-lists'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg1 p-3.5 ring-1 ring-line">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder={t('list_name_ph')}
          className="min-w-[200px] flex-1 rounded-xl bg-black/30 px-3.5 py-2 text-xs text-fg ring-1 ring-white/10 placeholder:text-fg3 outline-none focus:ring-acc"
        />
        <button onClick={create} className="inline-flex items-center gap-1.5 rounded-full bg-acc px-4 py-2 text-xs font-bold text-acc-ink hover:brightness-110">
          <Plus size={14} />{t('list_create')}
        </button>
      </div>

      {!lists.length ? (
        <p className="py-16 text-center text-sm text-fg3">{t('list_empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            {lists.map((l, idx) => {
              const on = active?.id === l.id;
              return (
                <div key={l.id} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 transition ${on ? 'border-acc bg-acc/10' : 'border-line bg-bg1 hover:bg-white/5'}`}>
                  {renamingId === l.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => rename(l.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') rename(l.id); if (e.key === 'Escape') setRenamingId(null); }}
                      className="min-w-0 flex-1 rounded bg-black/40 px-2 py-0.5 text-xs text-fg outline-none"
                    />
                  ) : (
                    <button onClick={() => setSelectedId(l.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-start text-xs font-semibold">
                      <span dir="auto" className="truncate">{l.name}</span>
                      <span className="font-mono text-[11px] text-fg3">{l.items.length}</span>
                    </button>
                  )}
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={t('move_up')} className="p-1 text-fg3 hover:text-fg disabled:opacity-25"><ArrowUp size={12} /></button>
                  <button onClick={() => move(idx, 1)} disabled={idx === lists.length - 1} aria-label={t('move_down')} className="p-1 text-fg3 hover:text-fg disabled:opacity-25"><ArrowDown size={12} /></button>
                  <button onClick={() => { setRenamingId(l.id); setRenameText(l.name); }} aria-label={t('list_rename')} title={t('list_rename')} className="p-1 text-fg3 hover:text-acc"><Pencil size={12} /></button>
                  <button onClick={() => del(l.id)} aria-label={t('list_delete')} title={t('list_delete')} className="p-1 text-fg3 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              );
            })}
          </div>
          <div>
            {active?.items.length ? (
              <PosterGrid items={active.items.map(asPreview)} watched={watched} />
            ) : (
              <p className="rounded-2xl border border-line bg-bg1/50 py-16 text-center text-sm text-fg3">{t('empty_list')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CloudList() {
  const t = useT(), nav = useNav(), { toast } = useHost();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const q = useQuery({
    queryKey: ['cloud-list', folderId],
    queryFn: () => cin<{ configured: boolean; service: string | null; items: CloudItem[] }>('cloud-list', { folderId }),
    staleTime: 30000,
  });
  const data = q.data;
  const openSettings = () => {
    useSettingsStore.getState().setActivePage('streaming-services');
    nav.go('settings');
  };
  const playCloudItem = async (item: CloudItem) => {
    try {
      toast(t('playing'));
      const res = await cin<{ url: string; name?: string }>('cloud-resolve', { item });
      await invoke('media:play', {
        type: 'movie',
        id: `cloud:${item.id}`,
        stream: { url: res.url },
        card: { name: res.name || item.name, type: 'movie', metaId: `cloud:${item.id}` },
      });
    } catch {
      toast(t('error_load'));
    }
  };
  const fmtSize = (b: number) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : b > 0 ? `${Math.round(b / 2 ** 20)} MB` : '');

  if (q.isLoading) return <div className="skel h-40 rounded-2xl" />;
  if (data && !data.configured) {
    return (
      <div className="rounded-2xl border border-line bg-bg1/70 px-6 py-16 text-center">
        <Cloud size={32} className="mx-auto mb-3 text-acc" />
        <p className="mx-auto max-w-md text-sm text-fg2">{t('cloud_empty')}</p>
        <button onClick={openSettings} className="mt-5 rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110">
          {t('cloud_setup_btn')}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg1 px-4 py-3 ring-1 ring-line">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Cloud size={16} className="text-acc" />
          <button onClick={() => { setFolderId(null); setFolderName(''); }} className="hover:text-acc">
            {t('cloud_root')}{data?.service ? ` · ${data.service.toUpperCase()}` : ''}
          </button>
          {folderId && folderName ? <span dir="auto" className="text-fg3">/ {folderName}</span> : null}
        </div>
        <button onClick={() => q.refetch()} className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs hover:bg-white/15">
          <RefreshCw size={12} />{t('addon_refresh')}
        </button>
      </div>
      {!(data?.items?.length) ? (
        <p className="py-16 text-center text-sm text-fg3">{t('empty_list')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {data.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 rounded-2xl bg-bg1 p-3.5 ring-1 ring-line transition hover:bg-white/5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-10 flex-none place-items-center rounded-xl bg-black/30 text-acc">
                  {it.kind === 'folder' ? <FolderOpen size={18} /> : <Play size={16} />}
                </span>
                <div className="min-w-0">
                  <div dir="auto" className="truncate text-sm font-semibold text-fg">{it.name}</div>
                  {it.size ? <div dir="ltr" className="text-[11px] text-fg3">{fmtSize(it.size)}</div> : null}
                </div>
              </div>
              {it.kind === 'folder' ? (
                <button onClick={() => { setFolderId(it.id); setFolderName(it.name); }} className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink">
                  {t('see_all')}
                </button>
              ) : (
                <button onClick={() => playCloudItem(it)} className="grid size-9 flex-none place-items-center rounded-full bg-acc text-acc-ink hover:brightness-110" aria-label={t('play')}>
                  <Play size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServersList() {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const serversQ = useHomeServers();
  const servers = serversQ.data || [];
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const itemsQ = useHomeServerItems(selectedId, '', servers.length > 0);

  const openServerSettings = () => {
    useSettingsStore.getState().setActivePage('home-servers');
    nav.go('settings');
  };
  const playServerItem = async (it: HomeServerItem) => {
    try {
      toast(t('playing'));
      const res = await cin<{ url: string; headers?: Record<string, string>; name?: string }>('hs-stream', { serverId: it.homeServer.serverId, itemId: it.homeServer.itemId });
      await invoke('media:play', {
        type: it.type,
        id: it.id,
        stream: { url: res.url, ...(res.headers ? { behaviorHints: { proxyHeaders: { request: res.headers } } } : {}) },
        card: { name: res.name || it.name, poster: it.poster || null, type: it.type, metaId: it.id },
      });
    } catch {
      toast(t('servers_failed'));
    }
  };
  const toggleWatched = async (it: HomeServerItem) => {
    await cin('hs-watched', { serverId: it.homeServer.serverId, itemId: it.homeServer.itemId, watched: !it.watched }).catch(() => false);
    qc.invalidateQueries({ queryKey: ['hs-items'] });
  };

  if (!servers.length && !serversQ.isLoading) {
    return (
      <div className="rounded-2xl border border-line bg-bg1/70 px-6 py-16 text-center">
        <Server size={32} className="mx-auto mb-3 text-acc" />
        <p className="mx-auto max-w-md text-sm text-fg2">{t('servers_empty')}</p>
        <button onClick={openServerSettings} className="mt-5 rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110">
          {t('servers_setup_btn')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setSelectedId(undefined)} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${!selectedId ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:text-fg'}`}>
          {t('all')}
        </button>
        {servers.map((s) => (
          <button key={s.id} onClick={() => setSelectedId(s.id)} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${selectedId === s.id ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:text-fg'}`}>
            {s.name} ({s.kind.toUpperCase()})
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={openServerSettings} className="rounded-full bg-white/8 px-3.5 py-1.5 text-xs text-fg2 hover:text-fg">
          {t('configure')}
        </button>
      </div>

      {itemsQ.isLoading ? (
        <div className="skel h-40 rounded-2xl" />
      ) : !(itemsQ.data?.length) ? (
        <p className="py-16 text-center text-sm text-fg3">{t('empty_list')}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {itemsQ.data.map((it) => (
            <div key={`${it.homeServer.serverId}:${it.homeServer.itemId}`} className="flex items-center gap-3 rounded-2xl bg-bg1 p-3 ring-1 ring-line transition hover:bg-white/5">
              <div className="h-[78px] w-14 flex-none overflow-hidden rounded-lg bg-bg3">
                {it.poster ? <img src={it.poster} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div dir="auto" className="truncate text-sm font-semibold">{it.name}</div>
                <div className="mt-0.5 text-[11px] text-fg3">{it.homeServer.serverName}{it.year ? ` · ${it.year}` : ''}</div>
              </div>
              <button onClick={() => toggleWatched(it)} title={it.watched ? t('mark_unwatched') : t('mark_watched')}
                className={`grid size-8 flex-none place-items-center rounded-full ${it.watched ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg3 hover:text-fg'}`}>
                <Check size={14} />
              </button>
              <button onClick={() => playServerItem(it)} title={t('play')} className="grid size-9 flex-none place-items-center rounded-full bg-fg text-bg hover:bg-acc hover:text-acc-ink">
                <Play size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalList({ items, loading }: { items: Download[]; loading: boolean }) {
  const t = useT(), nav = useNav(), qc = useQueryClient();
  const scan = useLocalScan();
  const scannedFiles = scan.data?.files || [];
  const [matchingFile, setMatchingFile] = useState<LocalMediaFile | null>(null);
  const [matchText, setMatchText] = useState('');
  const matchSearch = useSearch(matchingFile ? matchText : '');

  const scanFolder = async () => {
    const r = await cin<{ folders: string[]; files: LocalMediaFile[] }>('local-scan', { pick: true });
    qc.setQueryData(['local-scan'], r);
  };
  const playLocal = (f: LocalMediaFile) => invoke('media:play', {
    type: f.match?.type || (f.season != null ? 'series' : 'movie'),
    id: f.id,
    stream: { majlisLocalFile: f.id },
    card: { name: f.match?.name || f.name, poster: f.match?.poster || null, type: f.match?.type || (f.season != null ? 'series' : 'movie'), metaId: f.match?.metaId || f.id },
  });
  const saveMatch = async (f: LocalMediaFile, m: Preview) => {
    await cin('local-match', { id: f.id, match: { metaId: m.id, type: m.type, name: m.name, poster: m.poster || null, year: m.year ?? null } });
    setMatchingFile(null);
    qc.invalidateQueries({ queryKey: ['local-scan'] });
  };
  const size = (b: number) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : `${Math.round(b / 2 ** 20)} MB`);
  const playIt = (d: Download) => invoke('media:play', { type: d.type, id: d.videoId, stream: { majlisDownload: d.id }, card: { name: d.name, poster: d.poster, type: d.type, metaId: d.metaId } });
  const matchHits = (matchSearch.data || []).flatMap((g) => g.metas).slice(0, 12);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg1 p-4 ring-1 ring-line">
        <div>
          <div className="text-sm font-semibold">{t('local_files')}</div>
          <div dir="ltr" className="text-xs text-fg3">{(scan.data?.folders || []).join(' · ')}</div>
        </div>
        <button onClick={scanFolder} className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-xs font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
          <Icon n="folder" s={15} />{t('scan_folder')}
        </button>
      </div>
      {scannedFiles.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {scannedFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-3.5 rounded-2xl bg-bg1 p-3.5 ring-1 ring-line transition hover:bg-white/4">
              <div className="h-[78px] w-14 flex-none overflow-hidden rounded-lg bg-bg3">
                {f.match?.poster ? <Img srcs={[f.match.poster]} className="h-full w-full object-cover" /> : (
                  <div className="grid h-full place-items-center text-fg3"><Icon n="film" s={18} /></div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div dir="auto" className="truncate font-semibold">{f.match?.name || f.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg2">
                  {f.season != null ? <span dir="ltr" className="rounded bg-acc/15 px-1.5 py-0.5 font-mono text-acc">S{f.season}E{f.episode}</span> : null}
                  {f.resolution ? <span dir="ltr" className="rounded bg-white/8 px-1.5 py-0.5 font-mono">{f.resolution}</span> : null}
                  <span dir="ltr">{size(f.size)}</span>
                  {(f.sidecarCount || 0) > 0 ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">{t('th_subs')}</span> : null}
                  {!f.match ? <span className="rounded bg-white/8 px-1.5 py-0.5 text-fg3">{t('local_unmatched')}</span> : null}
                </div>
                <button
                  onClick={() => { setMatchingFile(f); setMatchText(f.name); }}
                  className="mt-1.5 text-[11px] font-medium text-acc hover:underline"
                >
                  {t('local_match')}
                </button>
              </div>
              <button onClick={() => playLocal(f)} title={t('play')} aria-label={t('play')}
                className="grid size-11 flex-none place-items-center rounded-full bg-fg text-bg transition hover:bg-acc hover:text-acc-ink">
                <Icon n="play" s={18} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {!items.length && !scannedFiles.length && !loading ? <p className="py-12 text-center text-fg3">{t('dl_empty')}</p> : null}
      {items.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {items.map((d) => {
            const ep = /:(\d+):(\d+)$/.exec(d.videoId || '');
            const metaId = d.metaId || (d.videoId || '').split(':')[0];
            return (
              <div key={d.id} className="flex items-center gap-4 rounded-2xl bg-bg1 p-3 ring-1 ring-line transition hover:bg-white/4">
                <button onClick={(e) => { rememberFlip(e.currentTarget, d.poster); nav.open({ kind: 'title', type: d.type, id: metaId }); }}
                  className="h-[84px] w-14 flex-none overflow-hidden rounded-lg bg-bg3">
                  <Img srcs={[d.poster]} className="h-full w-full object-cover" />
                </button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => nav.open({ kind: 'title', type: d.type, id: metaId })} dir="auto" className="block w-full truncate text-start font-semibold hover:text-acc">
                    {d.name}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg2">
                    {ep ? <span dir="ltr" className="rounded bg-acc/15 px-1.5 py-0.5 font-mono text-acc">S{ep[1]}E{ep[2]}</span> : null}
                    {d.total ? <span dir="ltr">{size(d.total)}</span> : null}
                    <span className="text-emerald-300">{t('dl_local_badge')}</span>
                  </div>
                </div>
                <button onClick={() => playIt(d)} title={t('play')} aria-label={t('play')}
                  className="grid size-11 flex-none place-items-center rounded-full bg-fg text-bg transition hover:bg-acc hover:text-acc-ink">
                  <Icon n="play" s={18} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {matchingFile ? (
        <div onClick={() => setMatchingFile(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm fade-in">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-acc/30 bg-bg1/96 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{t('local_match')}</h3>
              <button onClick={() => setMatchingFile(null)} className="rounded-full p-1 hover:bg-white/10"><Icon n="x" s={16} /></button>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-black/35 px-3 py-2 ring-1 ring-white/10">
              <SearchIcon size={14} className="text-fg3" />
              <input value={matchText} onChange={(e) => setMatchText(e.target.value)} placeholder={t('local_match_ph')} className="flex-1 text-xs text-fg outline-none" />
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {matchHits.map((m) => (
                <button key={`${m.type}:${m.id}`} onClick={() => saveMatch(matchingFile, m)} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2 text-start hover:bg-acc/15">
                  <Img srcs={[m.poster]} className="h-12 w-8 flex-none rounded object-cover bg-bg3" />
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="truncate text-xs font-semibold text-fg">{m.name}</div>
                    <div className="text-[11px] text-fg3">{m.type}{m.year ? ` · ${m.year}` : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
