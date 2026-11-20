import { useEffect, useMemo, useRef, useState } from 'react';
import { cin, invoke, useHomeServerItems, useHomeServers, useSearch, useSearchPeople, type HomeServerItem, type Preview } from '../api';
import { useHost, useNav, useT } from '../host';
import { Img } from '../ui/Img';
import { Poster, PosterSkeleton, isAnimeItem } from '../ui/Poster';
import { useWatched } from '../ui/CatalogRow';
import { Icon } from '../ui/Icon';

const RECENT_KEY = 'majlis:recent-searches';
const MAX_RECENT = 12;
const readRecent = (): string[] => {
  try { const x = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, MAX_RECENT) : []; } catch { return []; }
};

type SearchTab = 'all' | 'movie' | 'series' | 'anime' | 'people';

// One box, every addon catalog + TMDB People, type tabs, and recent searches
export function Search({ active }: { active: boolean }) {
  const t = useT(), nav = useNav(), { toast } = useHost();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<SearchTab>('all');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [playErr, setPlayErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const watched = useWatched();

  useEffect(() => { if (active) input.current?.focus(); }, [active]);
  useEffect(() => { setPlayErr(''); const id = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(id); }, [text]);
  useEffect(() => {
    if (q.length < 2 || /^(magnet:\?|https?:\/\/)/i.test(q)) return;
    setRecent((prev) => {
      const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [q]);

  const r = useSearch(q);
  const people = useSearchPeople(q);
  const homeServers = useHomeServers().data || [];
  const hsQuery = useHomeServerItems(undefined, q, q.length >= 2 && homeServers.length > 0 && !/^(magnet:\?|https?:\/\/)/i.test(q));

  const { groups, total } = useMemo(() => {
    const map = new Map<string, Preview[]>(), seen = new Set<string>();
    for (const g of r.data || []) for (const m of g.metas) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const anime = isAnimeItem(m);
      if (tab === 'movie' && (m.type !== 'movie' || anime)) continue;
      if (tab === 'series' && (m.type !== 'series' || anime)) continue;
      if (tab === 'anime' && !anime) continue;
      if (tab === 'people') continue;
      const k = anime ? t('anime') : m.type === 'movie' ? t('type_movie') : m.type === 'series' ? t('type_series') : m.type;
      map.set(k, [...(map.get(k) || []), m]);
    }
    return { groups: map, total: seen.size };
  }, [r.data, tab, t]);

  const peopleList = (tab === 'all' || tab === 'people') ? (people.data || []) : [];
  const hsList = tab === 'people' ? [] : (hsQuery.data || []);
  const trimmed = text.trim();
  const isDirectLink = /^(magnet:\?|https?:\/\/)/i.test(trimmed);
  const isMagnetLink = /^magnet:\?/i.test(trimmed);
  const hasAny = total > 0 || peopleList.length > 0 || hsList.length > 0;
  const playHomeItem = async (it: HomeServerItem) => {
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
  const clearRecent = () => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch {} };
  const removeRecent = (term: string) => {
    setRecent((prev) => {
      const next = prev.filter((x) => x !== term);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const playDirectUrl = async (url: string, name?: string) => {
    setPlayErr('');
    const res = await cin<{ ok: boolean; error?: string }>('play-url', { url, name }).catch(() => ({ ok: false, error: 'invalid_url' }));
    if (!res.ok) setPlayErr(t('play_url_invalid'));
  };

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <label className="mx-auto mb-5 flex max-w-3xl items-center gap-3 rounded-full bg-white/8 px-6 py-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-acc">
        <Icon n="search" s={22} className="text-fg3" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search_ph')} className="flex-1 text-xl placeholder:text-fg3" />
        {text ? <button aria-label="clear" onClick={() => setText('')} className="text-fg3 hover:text-fg"><Icon n="x" s={18} /></button> : null}
      </label>

      <div className="mx-auto mb-8 flex max-w-3xl flex-wrap justify-center gap-2">
        {([
          ['all', t('filter_all')],
          ['movie', t('movies')],
          ['series', t('shows')],
          ['anime', t('anime')],
          ['people', t('tab_people')],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${tab === id ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {isDirectLink ? (
        <div className="mx-auto mb-8 max-w-3xl rounded-2xl border border-acc/40 bg-bg1/90 p-4 shadow-xl ring-1 ring-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-acc">{isMagnetLink ? t('play_url_magnet') : t('play_url_direct')}</div>
              <div dir="ltr" className="mt-1 truncate font-mono text-xs text-fg2">{trimmed}</div>
            </div>
            <button
              onClick={() => playDirectUrl(trimmed)}
              className="flex flex-none items-center gap-2 rounded-full bg-acc px-5 py-2.5 text-xs font-bold text-acc-ink hover:brightness-110"
            >
              <Icon n="play" s={14} />{t('play_direct')}
            </button>
          </div>
          {playErr ? <p className="mt-2 text-xs text-red-400">{playErr}</p> : null}
        </div>
      ) : null}

      {q.length < 2 ? (
        <div className="mx-auto max-w-3xl text-center">
          {recent.length ? (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-center gap-3 text-xs text-fg3">
                <span>{t('recent_searches')}</span>
                <button onClick={clearRecent} className="text-acc hover:underline">{t('clear_recent')}</button>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {recent.map((term) => (
                  <span key={term} className="inline-flex items-center gap-1 rounded-full bg-white/8 ps-3.5 pe-2 py-1 text-xs text-fg2 transition hover:bg-white/15">
                    <button onClick={() => setText(term)} className="hover:text-fg">{term}</button>
                    <button
                      onClick={() => removeRecent(term)}
                      title={t('remove_recent')}
                      aria-label={t('remove_recent')}
                      className="grid size-4 place-items-center rounded-full text-fg3 hover:bg-white/15 hover:text-fg"
                    >
                      <Icon n="x" s={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-fg3">{t('search_empty')}</p>
        </div>
      ) : r.isLoading && !hasAny ? (
        <div className="flex flex-wrap gap-4">{Array.from({ length: 14 }, (_, i) => <PosterSkeleton key={i} w={160} />)}</div>
      ) : !hasAny ? (
        isDirectLink ? null : <p className="text-center text-fg2">{t('no_results', { q })}</p>
      ) : (
        <>
          {peopleList.length ? (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold">{t('tab_people')}</h2>
              <div className="hscroll flex gap-5 pb-2">
                {peopleList.map((p) => (
                  <button key={p.id} onClick={() => nav.open({ kind: 'person', id: p.id, name: p.name })} className="group w-[112px] flex-none text-center">
                    <div className="mx-auto mb-2 size-[92px] overflow-hidden rounded-full bg-bg3 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc">
                      <Img srcs={[p.photo]} className="h-full w-full object-cover" fallback={<div className="grid h-full place-items-center text-2xl font-semibold text-fg3">{p.name.slice(0, 1)}</div>} />
                    </div>
                    <div className="truncate text-xs font-semibold text-fg group-hover:text-acc">{p.name}</div>
                    {p.knownFor ? <div className="truncate text-[11px] text-fg3">{p.knownFor}</div> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {hsList.length ? (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold">{t('tab_servers')}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                {hsList.map((it) => (
                  <button
                    key={`${it.homeServer.serverId}:${it.homeServer.itemId}`}
                    onClick={() => (/^tt\d+/.test(it.id) ? nav.open({ kind: 'title', type: it.type, id: it.id }) : playHomeItem(it))}
                    className="flex items-center gap-3 rounded-2xl bg-bg1 p-3 text-start ring-1 ring-line transition hover:bg-white/5 hover:ring-acc/50"
                  >
                    <span className="h-16 w-11 flex-none overflow-hidden rounded-lg bg-bg3">
                      <Img srcs={[it.poster]} className="h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate text-sm font-semibold text-fg">{it.name}</span>
                      <span className="block truncate text-[11px] text-fg3">{it.homeServer.serverName}{it.year ? ` · ${it.year}` : ''}</span>
                    </span>
                    <span onClick={(e) => { e.stopPropagation(); playHomeItem(it); }} className="grid size-9 flex-none place-items-center rounded-full bg-acc text-acc-ink">
                      <Icon n="play" s={14} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {[...groups].map(([k, list]) => {
            const direct = list.filter((m) => m.directUrl);
            const normal = list.filter((m) => !m.directUrl);
            return (
              <section key={k} className="mb-10">
                <h2 className="mb-4 text-xl font-semibold">{k}</h2>
                {direct.length ? (
                  <div className="mb-4 space-y-2">
                    {direct.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-4 rounded-2xl bg-bg1 p-4 ring-1 ring-acc/40">
                        <div className="min-w-0 flex-1">
                          <div dir="auto" className="truncate font-semibold">{m.name}</div>
                          <div dir="ltr" className="truncate text-xs text-fg3">{m.directUrl}</div>
                        </div>
                        <button onClick={() => m.directUrl && playDirectUrl(m.directUrl, m.name)} className="flex items-center gap-2 rounded-full bg-acc px-5 py-2.5 text-sm font-semibold text-acc-ink hover:brightness-110">
                          <Icon n="play" s={16} />{t('play_direct')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {normal.length ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
                    {normal.map((m) => <Poster key={m.id} item={m} w={160} watched={watched.has(m.id)} />)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
