import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, cinemetaRow, metahub, useCatalog, useCaps, useDiscover, useMarathons, useMeta, useTune, yearOf, type Preview, type Tune } from '../api';
import { useHost, useNav, useT } from '../host';
import type { Key } from '../i18n';
import { genreLabel } from '../config/genres';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { isUnreleased, useWatched } from '../ui/CatalogRow';
import { useSettingsStore } from '../settings/useSettingsStore';

// genres the viewer leans to, strongest first (a 👍 adds, a 👎 takes away)
function leanings(tune: Tune) {
  const w = new Map<string, number>();
  for (const { v, genres } of Object.values(tune)) for (const g of genres) w.set(g, (w.get(g) || 0) + v);
  return [...w].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

const DISCOVER_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller'];
const ERAS: { id: string; from?: number; to?: number; key?: Key }[] = [
  { id: 'all', from: undefined, to: undefined },
  { id: '2020s', from: 2020, to: 2026, key: 'era_2020s' },
  { id: '2010s', from: 2010, to: 2019, key: 'era_2010s' },
  { id: '2000s', from: 2000, to: 2009, key: 'era_2000s' },
  { id: '1990s', from: 1990, to: 1999, key: 'era_1990s' },
  { id: 'classic', from: 1950, to: 1989, key: 'era_classic' },
];

export function Discover() {
  const t = useT(), nav = useNav(), qc = useQueryClient(), { lang } = useHost();
  const tune = useTune().data || {};
  const caps = useCaps().data;
  const watched = useWatched();
  const hideWatched = useSettingsStore((s) => s.data.sources.hideWatchedCatalogs);
  const hideUnreleased = useSettingsStore((s) => s.data.sources.hideUnreleasedCatalogs);
  const movies = useCatalog(cinemetaRow('movie'), []), shows = useCatalog(cinemetaRow('series'), []);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const [fType, setFType] = useState<'movie' | 'series'>('movie');
  const [fGenre, setFGenre] = useState('');
  const [fEra, setFEra] = useState('all');
  const [fRating, setFRating] = useState(0);
  const [fSort, setFSort] = useState<'popular' | 'rating' | 'newest'>('popular');
  const [fPage, setFPage] = useState(1);
  const [accItems, setAccItems] = useState<Preview[]>([]);

  useEffect(() => { setFPage(1); setAccItems([]); }, [fType, fGenre, fEra, fRating, fSort]);

  const eraObj = ERAS.find((e) => e.id === fEra) || ERAS[0];
  const sortParam = fSort === 'rating' ? 'vote_average.desc' : fSort === 'newest' ? (fType === 'series' ? 'first_air_date.desc' : 'primary_release_date.desc') : 'popularity.desc';
  const filtered = useDiscover({ type: fType, genre: fGenre || undefined, yearFrom: eraObj.from, yearTo: eraObj.to, minRating: fRating || undefined, sort: sortParam, page: fPage });

  useEffect(() => {
    if (!filtered.data) return;
    if (fPage === 1) setAccItems(filtered.data);
    else setAccItems((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return [...prev, ...filtered.data.filter((x) => !seen.has(x.id))];
    });
  }, [filtered.data, fPage]);

  // titles to rate: popular films and shows, in turn, that haven't been rated or skipped
  const pool = useMemo(() => {
    const a = movies.data || [], b = shows.data || [], out: Preview[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
    return out;
  }, [movies.data, shows.data]);
  const cur = pool.find((x) => !tune[x.id] && !skipped.has(x.id)) || null;
  const { data: m } = useMeta(cur?.type ?? null, cur?.id ?? null);
  const rated = Object.keys(tune).length;
  const genres = leanings(tune).slice(0, 3);
  const marathons = useMarathons(!!caps?.tmdb);

  const rate = async (v: 1 | -1) => {
    if (!cur) return;
    const next = await cin<Tune>('tune-set', { id: cur.id, v, genres: m?.genres || cur.genres || [] });
    qc.setQueryData(['tune'], next);
  };
  const surprise = () => {
    const picks = pool.filter((x) => !tune[x.id] || tune[x.id].v > 0);
    const g = genres.length ? picks.filter((x) => (x.genres || x.genre || []).some((y) => genres.includes(y))) : picks;
    const list = g.length ? g : picks;
    const x = list[Math.floor(Math.random() * list.length)];
    if (x) nav.open({ kind: 'title', type: x.type, id: x.id });
  };
  const desc = m ? (lang === 'ar' && m.descriptionAr) || m.description : cur?.description;
  const stills = [m?.background || metahub('background', cur?.id || ''), ...(m?.backdrops || [])].filter(Boolean).slice(0, 4) as string[];

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20 pt-24">
      <section className="grid min-h-[520px] grid-cols-1 gap-10 px-12 lg:grid-cols-[minmax(320px,0.8fr)_1.2fr]">
        <div className="flex flex-col justify-center">
          <h1 className="mb-3 text-4xl font-bold leading-tight">{t('discover_title')}</h1>
          <p className="mb-8 max-w-md text-[15px] leading-relaxed text-fg2">{t('discover_sub')}</p>
          {cur ? (
            <div className="mb-8">
              <div className="mb-1 text-xs uppercase tracking-wider text-fg3">{t('tune_q')}</div>
              <button onClick={() => nav.open({ kind: 'title', type: cur.type, id: cur.id })} className="mb-1 text-start text-2xl font-semibold hover:text-acc">{cur.name}</button>
              <div className="mb-3 text-sm text-fg3">{[yearOf(cur), ...(m?.genres || cur.genres || []).slice(0, 3).map((g) => genreLabel(g, lang))].filter(Boolean).join(' · ')}</div>
              {desc ? <p dir="auto" className="clamp-3 mb-5 max-w-md text-sm leading-relaxed text-fg2">{desc}</p> : null}
              <div className="flex gap-3">
                <TuneBtn icon="thumbup" label={t('like')} onClick={() => rate(1)} />
                <TuneBtn icon="thumbdown" label={t('dislike')} onClick={() => rate(-1)} />
                <button onClick={() => setSkipped(new Set(skipped).add(cur.id))} className="rounded-full px-5 text-sm text-fg2 ring-1 ring-line hover:bg-white/8 hover:text-fg">{t('not_seen')}</button>
              </div>
              <div className="mt-3 text-xs text-fg3">{t('tuned_n', { n: rated })}</div>
            </div>
          ) : null}
          <button onClick={surprise} className="flex w-fit items-center gap-2 rounded-full bg-acc px-6 py-3 font-semibold text-acc-ink transition hover:brightness-110">
            <Icon n="dice" s={20} />{t('surprise')}
          </button>
        </div>
        <div className="grid min-h-[460px] grid-cols-3 grid-rows-[1.4fr_1fr] gap-3">
          {/* 4-still masonry layout: one large still on top + 3 secondary stills underneath */}
          {cur ? (stills.length >= 4 ? [0, 1, 2, 3] : stills.length >= 3 ? [0, 1, 2] : [0]).map((i) => {
            const span = i === 0
              ? (stills.length >= 4 ? 'col-span-3' : stills.length >= 3 ? 'col-span-3' : 'col-span-3 row-span-2')
              : (stills.length === 3 && i === 1 ? 'col-span-2' : '');
            return (
              <div key={`${cur.id}${i}`} className={`relative overflow-hidden rounded-2xl bg-bg2 ring-1 ring-line fade-in ${span}`}>
                <Img srcs={[stills[i] || stills[0], cur.poster]} className="absolute inset-0 h-full w-full object-cover" />
                {i === 0 ? <>
                  <div className="shade-b absolute inset-0" />
                  <Img srcs={[m?.logo, metahub('logo', cur.id)]} className="absolute bottom-4 start-5 max-h-16 max-w-[50%] object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,.7)]" />
                </> : null}
              </div>
            );
          }) : <div className="skel col-span-3 row-span-2 rounded-2xl" />}
        </div>
      </section>

      {/* Interactive Explore Filters Bar */}
      <section className="mt-12 px-12">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">{t('discover_filters')}</h2>
          <div className="flex rounded-full bg-white/8 p-0.5 text-xs">
            {([['movie', t('type_movie')], ['series', t('type_series')]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFType(id)} className={`rounded-full px-3.5 py-1 font-semibold transition ${fType === id ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={fGenre} onChange={(e) => setFGenre(e.target.value)} className="rounded-full bg-bg1 px-3.5 py-1.5 text-xs text-fg ring-1 ring-line">
            <option value="">{t('all')}</option>
            {DISCOVER_GENRES.map((g) => <option key={g} value={g}>{genreLabel(g, lang)}</option>)}
          </select>
          <select value={fEra} onChange={(e) => setFEra(e.target.value)} className="rounded-full bg-bg1 px-3.5 py-1.5 text-xs text-fg ring-1 ring-line">
            {ERAS.map((e) => <option key={e.id} value={e.id}>{e.key ? t(e.key) : `${t('era')}: ${t('all')}`}</option>)}
          </select>
          <select value={fRating} onChange={(e) => setFRating(+e.target.value)} className="rounded-full bg-bg1 px-3.5 py-1.5 text-xs text-fg ring-1 ring-line">
            <option value={0}>{t('min_rating')}: {t('all')}</option>
            <option value={6}>★ 6+</option>
            <option value={7}>★ 7+</option>
            <option value={8}>★ 8+</option>
          </select>
          <select value={fSort} onChange={(e) => setFSort(e.target.value as 'popular' | 'rating' | 'newest')} className="rounded-full bg-bg1 px-3.5 py-1.5 text-xs text-fg ring-1 ring-line">
            <option value="popular">{t('sort_popular')}</option>
            <option value="rating">{t('sort_rating')}</option>
            <option value="newest">{t('sort_newest')}</option>
          </select>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
          {filtered.isLoading && fPage === 1 ? Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} w={160} />)
            : accItems
                .filter((it) => (!hideWatched || !watched.has(it.id)) && (!hideUnreleased || !isUnreleased(it)))
                .map((it) => <Poster key={it.id} item={it} w={160} watched={watched.has(it.id)} />)}
        </div>
        {(filtered.data?.length || 0) >= 12 ? (
          <div className="mt-6 flex justify-center">
            <button onClick={() => setFPage((p) => p + 1)} disabled={filtered.isFetching}
              className="rounded-full bg-white/10 px-6 py-2 text-xs font-semibold text-fg hover:bg-acc hover:text-acc-ink disabled:opacity-50">
              {filtered.isFetching ? '...' : t('see_all')}
            </button>
          </div>
        ) : null}
      </section>

      {genres.map((g) => <GenreRow key={g} genre={g} />)}

      {marathons.data?.length ? (
        <Row title={t('marathons')} items={marathons.data} width={360} height={230} render={(c) => (
          <button onClick={() => nav.open({ kind: 'collection', id: c.id, name: c.name })} className="group block w-[360px] text-start">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc/70">
              <Img srcs={[c.background]} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              <div className="shade-b absolute inset-0" />
              <div className="absolute bottom-3 start-4 end-4">
                <div className="truncate text-lg font-semibold">{c.name}</div>
                <div className="text-xs text-fg2">{t('films_n', { n: c.parts.length })}</div>
              </div>
            </div>
          </button>
        )} />
      ) : null}
    </div>
  );
}

function TuneBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="grid size-12 place-items-center rounded-full bg-white/8 ring-1 ring-line transition hover:bg-acc hover:text-acc-ink hover:ring-acc">
      <Icon n={icon} s={20} />
    </button>
  );
}

// films and shows of a genre the viewer likes
function GenreRow({ genre }: { genre: string }) {
  const t = useT(), { lang } = useHost(), watched = useWatched();
  const a = useCatalog(cinemetaRow('movie'), [['genre', genre]]), b = useCatalog(cinemetaRow('series'), [['genre', genre]]);
  const list = useMemo(() => {
    const x = a.data || [], y = b.data || [], out: Preview[] = [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i]) out.push(x[i]); if (y[i]) out.push(y[i]); }
    return out;
  }, [a.data, b.data]);
  return <Row title={t('for_you', { g: genreLabel(genre, lang) })} items={list} width={168} height={262} loading={a.isLoading && b.isLoading} skeleton={<PosterSkeleton />}
    render={(it) => <Poster item={it} watched={watched.has(it.id)} />} />;
}
