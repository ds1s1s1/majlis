import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, cinemetaRow, metahub, useCatalog, useCaps, useMarathons, useMeta, useTune, yearOf, type Preview, type Tune } from '../api';
import { useHost, useNav, useT } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { useWatched } from '../ui/CatalogRow';

// genres the viewer leans to, strongest first (a 👍 adds, a 👎 takes away)
function leanings(tune: Tune) {
  const w = new Map<string, number>();
  for (const { v, genres } of Object.values(tune)) for (const g of genres) w.set(g, (w.get(g) || 0) + v);
  return [...w].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

export function Discover() {
  const t = useT(), nav = useNav(), qc = useQueryClient(), { lang } = useHost();
  const tune = useTune().data || {};
  const caps = useCaps().data;
  const movies = useCatalog(cinemetaRow('movie'), []), shows = useCatalog(cinemetaRow('series'), []);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
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
              <div className="mb-3 text-sm text-fg3">{[yearOf(cur), ...(m?.genres || cur.genres || []).slice(0, 3)].filter(Boolean).join(' · ')}</div>
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
        <div className="grid min-h-[460px] grid-cols-2 grid-rows-[1.4fr_1fr] gap-3">
          {/* one big still, two more under it when TMDB has them */}
          {cur ? (stills.length >= 3 ? [0, 1, 2] : [0]).map((i) => (
            <div key={`${cur.id}${i}`} className={`relative overflow-hidden rounded-2xl bg-bg2 ring-1 ring-line fade-in ${i === 0 ? (stills.length >= 3 ? 'col-span-2' : 'col-span-2 row-span-2') : ''}`}>
              <Img srcs={[stills[i] || stills[0], cur.poster]} className="absolute inset-0 h-full w-full object-cover" />
              {i === 0 ? <>
                <div className="shade-b absolute inset-0" />
                <Img srcs={[m?.logo, metahub('logo', cur.id)]} className="absolute bottom-4 start-5 max-h-16 max-w-[50%] object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,.7)]" />
              </> : null}
            </div>
          )) : <div className="skel col-span-2 row-span-2 rounded-2xl" />}
        </div>
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
  const t = useT(), watched = useWatched();
  const a = useCatalog(cinemetaRow('movie'), [['genre', genre]]), b = useCatalog(cinemetaRow('series'), [['genre', genre]]);
  const list = useMemo(() => {
    const x = a.data || [], y = b.data || [], out: Preview[] = [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i]) out.push(x[i]); if (y[i]) out.push(y[i]); }
    return out;
  }, [a.data, b.data]);
  return <Row title={t('for_you', { g: genre })} items={list} width={168} height={262} loading={a.isLoading && b.isLoading} skeleton={<PosterSkeleton />}
    render={(it) => <Poster item={it} watched={watched.has(it.id)} />} />;
}
