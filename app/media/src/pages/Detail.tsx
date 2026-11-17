import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, invoke, useMeta, metahub, yearOf, type Item, type Video } from '../api';
import { useHost, useNav, useT, type Route } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Poster } from '../ui/Poster';
import { StreamList } from '../ui/Streams';

type TitleRoute = Extract<Route, { kind: 'title' }>;
const label = (m: Item, v?: Video | null) => (v && v.season != null ? `${m.name} · S${v.season}E${v.episode}` : m.name);

export function Detail({ route }: { route: TitleRoute }) {
  const q = useMeta(route.type, route.id);
  const t = useT();
  if (q.isError) return (
    <div className="grid h-full place-items-center"><div className="text-center"><p className="mb-4 text-fg2">{t('error_load')}</p>
      <button onClick={() => q.refetch()} className="rounded-full bg-white/10 px-5 py-2 hover:bg-white/20">{t('retry')}</button></div></div>
  );
  if (!q.data) return <div className="skel h-[70vh] w-full" />;
  return <Title m={q.data} route={route} />;
}

function Title({ m, route }: { m: Item; route: TitleRoute }) {
  const t = useT(), nav = useNav(), { lang } = useHost(), qc = useQueryClient();
  const series = m.type === 'series' || m.videos.some((v) => v.season != null);
  const st = m.library?.state;
  const eps = useMemo(() => m.videos.filter((v) => v.season != null).sort((a, b) => (a.season! - b.season!) || ((a.episode ?? 0) - (b.episode ?? 0))), [m.videos]);
  const watchedIds = new Set(st?.majlisWatched || []);
  // where to pick up: the library's episode, else the first one not watched
  const nextUp = eps.find((v) => v.id === st?.video_id) || eps.find((v) => v.season! > 0 && !watchedIds.has(v.id)) || eps.find((v) => v.season! > 0) || eps[0] || null;
  const seasons = [...new Set(eps.map((v) => v.season!))].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const [season, setSeason] = useState<number | null>(nextUp?.season ?? seasons[0] ?? null);
  // the episode whose sources are open (series), and whether to start the best one by itself
  const [pick, setPick] = useState<{ id: string; auto: boolean; pos?: number } | null>(null);
  const [inLib, setInLib] = useState(!!m.library?.inLibrary);
  const lists = useQuery({ queryKey: ['lists'], queryFn: () => cin<{ watchlist: { id: string }[]; favorites: { id: string }[] }>('lists') });
  const onList = (l: 'watchlist' | 'favorites') => !!lists.data?.[l].some((x) => x.id === m.id);

  useEffect(() => {
    if (!route.autoplay) return;
    if (series) { const v = eps.find((x) => x.id === route.autoplay); if (v) { setSeason(v.season); setPick({ id: v.id, auto: true, pos: route.pos }); } }
    else setPick({ id: m.id, auto: true, pos: route.pos });
  }, [route.autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = { id: m.id, type: m.type, name: m.name, poster: m.poster };
  const toggleLib = async () => {
    if (inLib) await cin('lib-remove', { id: m.id }); else await cin('lib-add', { meta: card });
    setInLib(!inLib); qc.invalidateQueries({ queryKey: ['library'] });
  };
  const toggleList = async (l: 'watchlist' | 'favorites') => { await cin('lib-toggle', { list: l, meta: card }); lists.refetch(); };
  const resumeOf = (id: string) => (st?.video_id === id && st.timeOffset > 1 ? st.timeOffset : undefined);
  const playMain = () => setPick(series ? (nextUp ? { id: nextUp.id, auto: true, pos: resumeOf(nextUp.id) } : null) : { id: m.id, auto: true, pos: resumeOf(m.id) });
  const resuming = !!(st && st.timeOffset > 1 && st.duration);
  const desc = (lang === 'ar' && m.descriptionAr) || m.description;
  const picked = pick ? eps.find((v) => v.id === pick.id) || null : null;

  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden pb-24">
      <section className="relative h-[min(74vh,720px)] min-h-[440px] w-full">
        <Img eager srcs={[m.background, metahub('background', m.id, 'large'), m.backdrops?.[0]]} className="absolute inset-0 h-full w-full object-cover object-top" />
        <div className="shade-s absolute inset-0" />
        <div className="shade-b absolute inset-0" />
        <div className="absolute bottom-10 start-12 max-w-[min(620px,52vw)] fade-in">
          <Img eager srcs={[m.logo, metahub('logo', m.id, 'large')]} alt={m.name} className="mb-5 max-h-40 max-w-[min(480px,42vw)] object-contain object-[var(--a)] drop-shadow-[0_4px_24px_rgba(0,0,0,.6)] [--a:left] rtl:[--a:right]"
            fallback={<h1 className="mb-4 text-5xl font-bold leading-tight">{m.name}</h1>} />
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg2">
            {m.imdbRating ? <span className="font-mono font-semibold text-[#f5c518]">★ {m.imdbRating}</span> : null}
            {yearOf(m) ? <span>{yearOf(m)}</span> : null}
            {m.certification ? <span className="rounded border border-fg3 px-1.5 text-xs">{m.certification}</span> : null}
            {m.runtime ? <span dir="ltr">{m.runtime}</span> : null}
            {series && seasons.filter((s) => s > 0).length ? <span>{t('seasons_n', { n: seasons.filter((s) => s > 0).length })}</span> : null}
            {m.genres.slice(0, 4).map((g) => <span key={g} className="text-fg3">{g}</span>)}
          </div>
          {desc ? <p dir="auto" className="clamp-3 mb-5 text-[15px] leading-relaxed text-fg2">{desc}</p> : null}
          {resuming ? (
            <div className="mb-4 flex max-w-xs items-center gap-3 text-xs text-fg2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-acc" style={{ width: `${Math.min(100, (st!.timeOffset / st!.duration) * 100)}%` }} /></div>
              {series && nextUp ? <span className="font-mono">S{nextUp.season}E{nextUp.episode}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={playMain} className="flex items-center gap-2 rounded-full bg-fg px-7 py-3 text-[15px] font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
              <Icon n="play" s={20} />{resuming ? t('resume') : t('play')}{series && nextUp ? <span className="font-mono text-sm opacity-70">S{nextUp.season}E{nextUp.episode}</span> : null}
            </button>
            {m.trailer ? <button onClick={() => invoke('open', `https://www.youtube.com/watch?v=${m.trailer}`)} className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-semibold backdrop-blur-md transition hover:bg-white/25"><Icon n="film" s={18} />{t('trailer')}</button> : null}
            <Circle on={inLib} icon={inLib ? 'check' : 'plus'} label={inLib ? t('in_library') : t('add_library')} onClick={toggleLib} />
            <Circle on={onList('watchlist')} icon="bookmark" label={t('watchlist')} onClick={() => toggleList('watchlist')} />
            <Circle on={onList('favorites')} icon="heart" label={t('favorite')} onClick={() => toggleList('favorites')} />
          </div>
        </div>
      </section>

      <div className="relative px-12">
        {m.collection ? (
          <button onClick={() => nav.open({ kind: 'collection', id: m.collection!.id, name: m.collection!.name })} className="mb-2 mt-6 flex items-center gap-2 text-sm text-fg2 hover:text-acc">
            <Icon n="layers" s={16} />{t('part_of', { name: m.collection.name })}<Icon n="chevr" s={14} className="flip" />
          </button>
        ) : null}

        {series ? (
          <section className="mt-8">
            <div className="mb-4 flex items-center gap-2 overflow-x-auto">
              <h2 className="me-3 text-xl font-semibold">{t('episodes')}</h2>
              {seasons.map((s) => (
                <button key={s} onClick={() => setSeason(s)} className={`flex-none rounded-full px-4 py-1.5 text-sm transition ${season === s ? 'bg-fg text-bg' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
                  {s === 0 ? t('specials') : t('season', { n: s })}
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              {eps.filter((v) => v.season === season).map((v) => (
                <Episode key={v.id} v={v} watched={watchedIds.has(v.id)} progress={st?.video_id === v.id && st.duration ? st.timeOffset / st.duration : 0}
                  onPlay={() => setPick({ id: v.id, auto: false, pos: resumeOf(v.id) })} />
              ))}
            </div>
          </section>
        ) : (
          <section className="mt-8 max-w-4xl">
            <h2 className="mb-3 text-xl font-semibold">{t('sources')}</h2>
            <StreamList type={m.type} meta={m} videoId={m.id} auto={pick?.auto} pos={pick?.pos} />
          </section>
        )}

        {m.cast.length ? (
          <section className="mt-10">
            <h2 className="mb-4 text-xl font-semibold">{t('cast')}</h2>
            <div className="hscroll flex gap-5 pb-2">
              {m.cast.map((c, i) => (
                <div key={i} className="w-[104px] flex-none text-center">
                  <div className="mx-auto mb-2 size-[88px] overflow-hidden rounded-full bg-bg3 ring-1 ring-line">
                    <Img srcs={[c.photo]} className="h-full w-full object-cover" fallback={<div className="grid h-full place-items-center text-2xl font-semibold text-fg3">{c.name.slice(0, 1)}</div>} />
                  </div>
                  <div className="truncate text-[13px] text-fg">{c.name}</div>
                  {c.character ? <div className="truncate text-[11px] text-fg3">{c.character}</div> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {m.recommendations?.length ? <div className="-mx-0"><Row title={t('more_like')} items={m.recommendations} width={168} height={262} render={(it) => <Poster item={it} />} /></div> : null}

      {series && pick ? (
        <aside className="fixed inset-y-0 end-0 z-40 flex w-[min(520px,92vw)] flex-col border-s border-line bg-bg1/95 shadow-2xl backdrop-blur-xl fade-in">
          <div className="flex items-start gap-3 border-b border-line p-5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg3">{m.name}</div>
              <div className="truncate text-lg font-semibold">{picked ? `S${picked.season}E${picked.episode} · ${picked.name}` : ''}</div>
            </div>
            <button aria-label={t('back')} onClick={() => setPick(null)} className="grid size-9 place-items-center rounded-full bg-white/8 hover:bg-white/15"><Icon n="x" s={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <StreamList type="series" meta={m} videoId={pick.id} label={label(m, picked)} auto={pick.auto} pos={pick.pos} onStarted={() => setPick(null)} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function Circle({ on, icon, label, onClick }: { on: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={on}
      className={`grid size-12 place-items-center rounded-full ring-1 backdrop-blur-md transition ${on ? 'bg-acc text-acc-ink ring-acc' : 'bg-white/10 ring-white/25 hover:bg-white/20'}`}>
      <Icon n={icon} s={20} />
    </button>
  );
}

function Episode({ v, watched, progress, onPlay }: { v: Video; watched: boolean; progress: number; onPlay: () => void }) {
  const t = useT();
  const future = v.released && Date.parse(v.released) > Date.now();
  return (
    <button onClick={onPlay} disabled={!!future} className="group flex items-center gap-5 rounded-2xl p-3 text-start transition hover:bg-white/5 disabled:opacity-50">
      <span className="w-6 flex-none text-center font-mono text-lg text-fg3">{v.episode}</span>
      <span className="relative aspect-video w-[200px] flex-none overflow-hidden rounded-lg bg-bg3">
        <Img srcs={[v.thumbnail]} className="h-full w-full object-cover" />
        {!future ? <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100"><Icon n="play" s={26} /></span> : null}
        {progress > 0 ? <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span className="block h-full bg-acc" style={{ width: `${Math.min(100, progress * 100)}%` }} /></span> : null}
        {watched ? <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-acc text-acc-ink"><Icon n="check" s={14} /></span> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="mb-1 block truncate text-[15px] font-semibold">{v.name || t('episode_n', { n: v.episode ?? '' })}</span>
        {v.overview ? <span dir="auto" className="clamp-2 block text-[13px] leading-relaxed text-fg2">{v.overview}</span> : null}
        {future ? <span className="mt-1 block text-xs text-acc">{t('released_on', { d: new Date(v.released!).toLocaleDateString() })}</span> : null}
      </span>
    </button>
  );
}
