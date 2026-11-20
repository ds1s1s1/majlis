import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ListPlus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, invoke, quickplay, useMeta, metahub, yearOf, type Item, type Video } from '../api';
import { consumeFlip, useHost, useNav, useT, type Route } from '../host';
import { fmtLocaleDate, type Key } from '../i18n';
import { genreLabel } from '../config/genres';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Row } from '../ui/Row';
import { Poster } from '../ui/Poster';
import { StreamList } from '../ui/Streams';
import { FriendsSaw, NominateButton } from '../ui/Social';
import { useSettingsStore } from '../settings/useSettingsStore';
import { usePlayQueueStore } from '../store/usePlayQueueStore';

type TitleRoute = Extract<Route, { kind: 'title' }>;
const label = (m: Item, v?: Video | null) => (v && v.season != null ? `${m.name} · S${v.season}E${v.episode}` : m.name);
const TRAILER_TYPE_KEY: Record<string, Key> = {
  Trailer: 'trailer_type_trailer',
  Teaser: 'trailer_type_teaser',
  Clip: 'trailer_type_clip',
  Featurette: 'trailer_type_featurette',
};

export function Detail({ route, active = true }: { route: TitleRoute; active?: boolean }) {
  const q = useMeta(route.type, route.id);
  const t = useT();
  if (q.isError) return (
    <div className="grid h-full place-items-center"><div className="text-center"><p className="mb-4 text-fg2">{t('error_load')}</p>
      <button onClick={() => q.refetch()} className="rounded-full bg-white/10 px-5 py-2 hover:bg-white/20">{t('retry')}</button></div></div>
  );
  if (!q.data) return <div className="skel h-[70vh] w-full" />;
  return <Title m={q.data} route={route} active={active} />;
}

function Title({ m, route, active = true }: { m: Item; route: TitleRoute; active?: boolean }) {
  const t = useT(), nav = useNav(), host = useHost(), { lang, toast } = host, qc = useQueryClient();
  const series = m.type === 'series' || m.videos.some((v) => v.season != null);
  const st = m.library?.state;
  const eps = useMemo(() => m.videos.filter((v) => v.season != null).sort((a, b) => (a.season! - b.season!) || ((a.episode ?? 0) - (b.episode ?? 0))), [m.videos]);
  const watchedIds = new Set(st?.majlisWatched || []);
  // where to pick up: the library's episode, else the first one not watched
  const nextUp = eps.find((v) => v.id === st?.video_id) || eps.find((v) => v.season! > 0 && !watchedIds.has(v.id)) || eps.find((v) => v.season! > 0) || eps[0] || null;
  const seasons = [...new Set(eps.map((v) => v.season!))].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const [season, setSeason] = useState<number | null>(nextUp?.season ?? seasons[0] ?? null);
  // the episode whose sources are open (series), and whether to start the best one by itself (solo or watch party)
  const [pick, setPick] = useState<{ id: string; auto: boolean; party?: boolean; pos?: number } | null>(null);
  const [inLib, setInLib] = useState(!!m.library?.inLibrary);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [activeTrailerKey, setActiveTrailerKey] = useState<string | null>(null);
  const [trailerFilter, setTrailerFilter] = useState<string>('all');
  const [heroPreviewOn, setHeroPreviewOn] = useState(false);
  const [shuffledEp, setShuffledEp] = useState<Video | null>(null);
  const autoPlayTrailer = useSettingsStore((s) => s.data.playback.autoPlayTrailerDetail);
  const queueItems = usePlayQueueStore((s) => s.items);
  const enqueueQueue = usePlayQueueStore((s) => s.enqueue);
  const removeQueue = usePlayQueueStore((s) => s.remove);
  const blurDefault = useSettingsStore((s) => s.data.sources.details.blurSpoilers || s.data.sources.details.hideSpoilers || s.data.controls.tvPlayback.hideEpThumbnails);
  const [spoilerBlur, setSpoilerBlur] = useState(blurDefault);
  const [revealedEps, setRevealedEps] = useState<Set<string>>(() => new Set());
  useEffect(() => setSpoilerBlur(blurDefault), [blurDefault]);
  const lastWatched = useMemo(() => {
    const watchedList = eps.filter((v) => v.season! > 0 && watchedIds.has(v.id));
    return watchedList.length ? watchedList[watchedList.length - 1] : null;
  }, [eps, st?.majlisWatched]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useQuery({ queryKey: ['lists'], queryFn: () => cin<{ watchlist: { id: string }[]; favorites: { id: string }[] }>('lists') });
  const onList = (l: 'watchlist' | 'favorites') => !!lists.data?.[l].some((x) => x.id === m.id);
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active && trailerOpen) { setTrailerOpen(false); setActiveTrailerKey(null); }
    if (!active && shuffledEp) setShuffledEp(null);
  }, [active, trailerOpen, shuffledEp]);

  useEffect(() => {
    if (!trailerOpen || !active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setTrailerOpen(false); setActiveTrailerKey(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [trailerOpen, active]);

  useEffect(() => {
    if (!shuffledEp || !active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setShuffledEp(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shuffledEp, active]);

  // Muted background trailer preview after 1.2s settle; unmounts immediately on route leave or Theater start
  useEffect(() => {
    setHeroPreviewOn(false);
    if (!active || host.theaterOpen || trailerOpen || pick || !autoPlayTrailer || !m.trailer) return;
    const id = setTimeout(() => setHeroPreviewOn(true), 1200);
    return () => {
      clearTimeout(id);
      setHeroPreviewOn(false);
    };
  }, [active, host.theaterOpen, trailerOpen, pick, autoPlayTrailer, m.trailer, m.id]);

  useLayoutEffect(() => {
    const f = consumeFlip();
    const el = heroRef.current;
    if (!f || !el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dx = f.x + f.w / 2 - (r.left + r.width / 2);
    const dy = f.y + f.h / 2 - (r.top + r.height / 2);
    const sx = Math.max(0.18, Math.min(1, f.w / r.width));
    const sy = Math.max(0.18, Math.min(1, f.h / r.height));
    el.animate(
      [
        { opacity: 0.72, transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
      ],
      { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [m.id]);

  useEffect(() => {
    if (!route.autoplay) return;
    if (series) { const v = eps.find((x) => x.id === route.autoplay); if (v) { setSeason(v.season); setPick({ id: v.id, auto: true, pos: route.pos }); } }
    else setPick({ id: m.id, auto: true, pos: route.pos });
  }, [route.autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  const mMeta = m as { rating?: unknown; imdbRating?: unknown };
  const parsedRating = Number(mMeta.imdbRating ?? mMeta.rating);
  const card = {
    id: m.id,
    type: m.type,
    name: m.name,
    poster: m.poster,
    year: m.year ?? null,
    genres: m.genres || [],
    runtimeMin: parseInt(String(m.runtime || ''), 10) || undefined,
    imdbRating: Number.isFinite(parsedRating) && parsedRating > 0 ? parsedRating : undefined,
    directors: m.director || [],
    cast: (m.cast || []).slice(0, 6).map((c) => c.name).filter(Boolean),
  };
  const toggleLib = async () => {
    if (inLib) await cin('lib-remove', { id: m.id }); else await cin('lib-add', { meta: card });
    setInLib(!inLib); qc.invalidateQueries({ queryKey: ['library'] });
  };
  const toggleList = async (l: 'watchlist' | 'favorites') => { await cin('lib-toggle', { list: l, meta: card }); lists.refetch(); };
  const toggleEpWatched = async (v: Video, watched: boolean) => {
    await cin('lib-watched', { meta: card, videoId: v.id, on: !watched });
    qc.invalidateQueries({ queryKey: ['meta', route.type, route.id] });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };
  const markSeasonWatched = async () => {
    const seasonVideos = eps.filter((v) => v.season === season);
    await cin('lib-season', { meta: card, seasonVideos, on: true, allVideos: eps });
    qc.invalidateQueries({ queryKey: ['meta', route.type, route.id] });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };
  const markPrevWatched = async (v: Video) => {
    await cin('lib-mark-prev', { meta: card, videos: eps, videoId: v.id, on: true });
    qc.invalidateQueries({ queryKey: ['meta', route.type, route.id] });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };
  const pickRandomEpisode = () => {
    const nowMs = Date.now();
    const releasedEps = eps.filter((v) => (v.season ?? 0) > 0 && (!v.released || !Number.isFinite(Date.parse(v.released)) || Date.parse(v.released) <= nowMs));
    const unwatchedPool = releasedEps.filter((v) => !watchedIds.has(v.id));
    const pool = unwatchedPool.length ? unwatchedPool : releasedEps;
    if (!pool.length) return;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    setShuffledEp(chosen);
  };
  const queueMainKey = series && nextUp ? nextUp.id : m.id;
  const inMainQueue = queueItems.some((x) => x.key === queueMainKey);
  const toggleMainQueue = () => {
    if (inMainQueue) {
      removeQueue(queueMainKey);
      return;
    }
    const added = enqueueQueue({
      id: m.id,
      type: m.type,
      name: m.name,
      poster: m.poster || null,
      videoId: series && nextUp ? nextUp.id : undefined,
      epLabel: series && nextUp ? `S${nextUp.season}E${nextUp.episode}` : undefined,
    });
    toast(added ? t('queue_added') : t('ctx_in_queue'));
  };
  const enqueueEpisode = (v: Video) => {
    const added = enqueueQueue({
      id: m.id,
      type: 'series',
      name: m.name,
      poster: m.poster || null,
      videoId: v.id,
      epLabel: `S${v.season}E${v.episode}`,
    });
    toast(added ? t('queue_added') : t('ctx_in_queue'));
  };
  const trailerItems = m.trailers || [];
  const trailerTypes = useMemo(() => [...new Set(trailerItems.map((x) => x.type))], [trailerItems]);
  const visibleTrailers = useMemo(
    () => (trailerFilter === 'all' ? trailerItems : trailerItems.filter((x) => x.type === trailerFilter)),
    [trailerItems, trailerFilter],
  );
  const modalTrailerKey = activeTrailerKey || m.trailer;
  const resumeOf = (id: string) => (st?.video_id === id && st.timeOffset > 1 ? st.timeOffset : undefined);
  const playMain = async (party = false) => {
    const vid = series ? nextUp?.id : m.id;
    if (!vid) return;
    const pos = resumeOf(vid);
    toast(party ? t('party_started') : t('playing'));
    const res = await quickplay({
      type: m.type, id: m.id, videoId: vid, party, pos,
      card: { name: m.name, seriesName: m.name, poster: m.poster || null, background: m.background || null, logo: m.logo || null },
    });
    if (!res.ok && !res.cancelled && res.error) toast(res.error);
  };
  const resuming = !!(st && st.timeOffset > 1 && st.duration);
  const desc = (lang === 'ar' && m.descriptionAr) || m.description;
  const picked = pick ? eps.find((v) => v.id === pick.id) || null : null;

  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden pb-24">
      <section ref={heroRef} className="relative h-[min(74vh,720px)] min-h-[440px] w-full overflow-hidden origin-center will-change-transform">
        <Img eager srcs={[m.background, metahub('background', m.id, 'large'), m.backdrops?.[0]]} className="absolute inset-0 h-full w-full object-cover object-top" />
        {heroPreviewOn && active && !host.theaterOpen && !trailerOpen && !pick && m.trailer ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.trailer)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(m.trailer)}&rel=0&modestbranding=1`}
            className="pointer-events-none absolute inset-0 h-full w-full scale-[1.18] border-0 opacity-45 transition-opacity duration-700"
            allow="autoplay; encrypted-media"
            title={`${m.name} preview`}
          />
        ) : null}
        <div className="shade-s absolute inset-0" />
        <div className="shade-b absolute inset-0" />
        <div className="absolute bottom-10 start-12 max-w-[min(620px,52vw)] fade-in">
          <Img eager srcs={[m.logo, metahub('logo', m.id, 'large')]} alt={m.name} className="mb-5 max-h-40 max-w-[min(480px,42vw)] object-contain object-[var(--a)] drop-shadow-[0_4px_24px_rgba(0,0,0,.6)] [--a:left] rtl:[--a:right]"
            fallback={<h1 className="mb-4 text-5xl font-bold leading-tight">{m.name}</h1>} />
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg2">
            {(m.ratings?.imdb ?? m.imdbRating) ? <span dir="ltr" className="rounded-md bg-[#f5c518]/15 px-2 py-0.5 font-mono text-xs font-semibold text-[#f5c518]">IMDb ★ {m.ratings?.imdb ?? m.imdbRating}</span> : null}
            {m.ratings?.rt != null ? <span dir="ltr" className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-red-300">🍅 {m.ratings.rt}%</span> : null}
            {m.ratings?.metacritic != null ? <span dir="ltr" className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300">MC {m.ratings.metacritic}</span> : null}
            {m.ratings?.letterboxd != null ? <span dir="ltr" className="rounded-md bg-sky-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-sky-300">LB {m.ratings.letterboxd}</span> : null}
            {m.ratings?.trakt != null ? <span dir="ltr" className="rounded-md bg-rose-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-rose-300">Trakt {m.ratings.trakt}%</span> : null}
            {(m.ratings?.mal ?? m.malRating) != null ? <span dir="ltr" className="rounded-md bg-[#2e51a2]/40 px-2 py-0.5 font-mono text-xs font-semibold text-white">MAL ★ {m.ratings?.mal ?? m.malRating}</span> : null}
            {yearOf(m) ? <span>{yearOf(m)}</span> : null}
            {m.certification ? <span className="rounded border border-fg3 px-1.5 text-xs">{m.certification}</span> : null}
            {m.runtime ? <span dir="ltr">{m.runtime}</span> : null}
            {series && seasons.filter((s) => s > 0).length ? <span>{t('seasons_n', { n: seasons.filter((s) => s > 0).length })}</span> : null}
            {m.country ? <span>{m.country}</span> : null}
            {m.genres.slice(0, 4).map((g) => <span key={g} className="text-fg3">{genreLabel(g, lang)}</span>)}
          </div>
          {m.tagline ? <p dir="auto" className="mb-1.5 text-xs font-medium italic text-acc/90">“{m.tagline}”</p> : null}
          {desc ? <p dir="auto" className="clamp-3 mb-4 text-[15px] leading-relaxed text-fg2">{desc}</p> : null}
          {(m.directors?.length || m.director?.length || m.entities?.length || m.networks?.length) ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg3">
              {(m.directors?.length || m.director?.length) ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <b className="text-fg2">{t('director')}:</b>
                  {(m.directors?.length ? m.directors : m.director.map((name) => ({ id: null as number | null, name, photo: null as string | null }))).map((d, idx) =>
                    d.id ? (
                      <button
                        key={`${d.id}-${idx}`}
                        onClick={() => nav.open({ kind: 'person', id: d.id!, name: d.name })}
                        className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-fg transition hover:bg-acc hover:text-acc-ink"
                      >
                        {d.photo ? <Img srcs={[d.photo]} className="size-4 rounded-full object-cover" /> : null}
                        <span>{d.name}</span>
                      </button>
                    ) : (
                      <span key={`${d.name}-${idx}`} className="inline-flex items-center rounded-full bg-white/8 px-2.5 py-0.5 text-fg2">
                        {d.name}
                      </span>
                    ),
                  )}
                </span>
              ) : null}
              {m.entities?.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <b className="text-fg2">{t('studios')}:</b>
                  {m.entities.map((ent) => (
                    <button
                      key={`${ent.type}:${ent.id}`}
                      onClick={() => nav.open({ kind: 'entity', entityType: ent.type, id: ent.id, name: ent.name })}
                      className="rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-fg2 ring-1 ring-white/10 transition hover:bg-acc/20 hover:text-acc hover:ring-acc/40"
                    >
                      {ent.name}
                    </button>
                  ))}
                </div>
              ) : m.networks?.length ? (
                <span><b className="text-fg2">{t('studios')}:</b> {m.networks.join(', ')}</span>
              ) : null}
            </div>
          ) : null}
          {resuming ? (
            <div className="mb-4 flex max-w-xs items-center gap-3 text-xs text-fg2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-acc" style={{ width: `${Math.min(100, (st!.timeOffset / st!.duration) * 100)}%` }} /></div>
              {series && nextUp ? <span className="font-mono">S{nextUp.season}E{nextUp.episode}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => playMain(false)} title={t('watch_solo')} className="flex items-center gap-2 rounded-full bg-fg px-7 py-3 text-[15px] font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
              <Icon n="play" s={20} />{resuming ? t('resume') : t('play')}{series && nextUp ? <span className="font-mono text-sm opacity-70">S{nextUp.season}E{nextUp.episode}</span> : null}
            </button>
            <button onClick={() => playMain(true)} className="flex items-center gap-2 rounded-full bg-acc/20 px-5 py-3 text-[14.5px] font-semibold text-acc ring-1 ring-acc/40 backdrop-blur-md transition hover:bg-acc hover:text-acc-ink">
              <Icon n="users" s={18} />{t('start_party')}
            </button>
            {m.trailer ? <button onClick={() => { setActiveTrailerKey(m.trailer); setTrailerOpen(true); }} className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-semibold backdrop-blur-md transition hover:bg-white/25"><Icon n="film" s={18} />{t('trailer')}</button> : null}
            <NominateButton m={m} />
            <Circle on={inLib} icon={inLib ? 'check' : 'plus'} label={inLib ? t('in_library') : t('add_library')} onClick={toggleLib} />
            <Circle on={onList('watchlist')} icon="bookmark" label={t('watchlist')} onClick={() => toggleList('watchlist')} />
            <Circle on={onList('favorites')} icon="heart" label={t('favorite')} onClick={() => toggleList('favorites')} />
            <Circle on={inMainQueue} icon="list" label={inMainQueue ? t('ctx_in_queue') : t('ctx_add_queue')} onClick={toggleMainQueue} />
          </div>
        </div>
      </section>

      <div className="relative px-12">
        {m.collection ? (
          <button onClick={() => nav.open({ kind: 'collection', id: m.collection!.id, name: m.collection!.name })} className="mb-2 mt-6 flex items-center gap-2 text-sm text-fg2 hover:text-acc">
            <Icon n="layers" s={16} />{t('part_of', { name: m.collection.name })}<Icon n="chevr" s={14} className="flip" />
          </button>
        ) : null}

        {series && lastWatched ? (
          <section className="mt-6 rounded-2xl border border-acc/30 bg-gradient-to-r from-[#1a1610] via-bg1 to-bg1 p-4 ring-1 ring-white/5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-acc/20 px-3 py-0.5 text-xs font-bold text-acc">
                <Icon n="clock" s={13} />{t('where_was_i')}
              </span>
              <span className="text-[11px] text-fg3">{t('last_watched_ep')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {lastWatched.thumbnail ? (
                <Img srcs={[lastWatched.thumbnail]} className="aspect-video w-36 flex-none rounded-xl bg-bg3 object-cover ring-1 ring-line" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-fg">
                  S{String(lastWatched.season).padStart(2, '0')}E{String(lastWatched.episode ?? 0).padStart(2, '0')} · {lastWatched.name || t('episode_n', { n: lastWatched.episode ?? '' })}
                </div>
                {lastWatched.overview ? (
                  <p dir="auto" className="clamp-2 mt-1 text-xs leading-relaxed text-fg2">{lastWatched.overview}</p>
                ) : null}
              </div>
              <button
                onClick={() => playMain(false)}
                className="flex flex-none items-center gap-2 rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110"
              >
                <Icon n="play" s={14} />{nextUp ? `${t('resume')} S${String(nextUp.season).padStart(2, '0')}E${String(nextUp.episode ?? 0).padStart(2, '0')}` : t('resume')}
              </button>
            </div>
          </section>
        ) : null}

        {series ? (
          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-center gap-2 overflow-x-auto">
              <h2 className="me-3 text-xl font-semibold">{t('episodes')}</h2>
              {seasons.map((s) => (
                <button key={s} onClick={() => setSeason(s)} className={`flex-none rounded-full px-4 py-1.5 text-sm transition ${season === s ? 'bg-fg text-bg' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
                  {s === 0 ? t('specials') : t('season', { n: s })}
                </button>
              ))}
              <button
                onClick={pickRandomEpisode}
                className="ms-auto flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-xs font-medium text-fg2 transition hover:bg-acc/20 hover:text-acc"
              >
                <Icon n="shuffle" s={14} />{t('ep_shuffle')}
              </button>
              <button
                onClick={() => setSpoilerBlur((b) => !b)}
                aria-pressed={spoilerBlur}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${spoilerBlur ? 'bg-acc/20 text-acc ring-1 ring-acc/40' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}
              >
                <Icon n={spoilerBlur ? 'eyeoff' : 'eye'} s={14} />{t('anti_spoiler')}
              </button>
              {eps.some((v) => v.season === season && !watchedIds.has(v.id)) ? (
                <button onClick={markSeasonWatched} className="flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-xs font-medium text-fg2 transition hover:bg-acc hover:text-acc-ink">
                  <Icon n="check" s={14} />{t('mark_season_watched')}
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {eps.filter((v) => v.season === season).map((v) => {
                const w = watchedIds.has(v.id);
                const blurred = spoilerBlur && !w && !revealedEps.has(v.id);
                return (
                  <Episode key={v.id} v={v} watched={w} blurred={blurred}
                    onReveal={() => setRevealedEps((prev) => new Set(prev).add(v.id))}
                    progress={st?.video_id === v.id && st.duration ? st.timeOffset / st.duration : 0}
                    onPlay={() => setPick({ id: v.id, auto: false, pos: resumeOf(v.id) })}
                    onToggleWatched={() => toggleEpWatched(v, w)}
                    onMarkPrev={() => markPrevWatched(v)}
                    onQueue={() => enqueueEpisode(v)} />
                );
              })}
            </div>
          </section>
        ) : (
          <section className="mt-8 max-w-4xl">
            <h2 className="mb-3 text-xl font-semibold">{t('sources')}</h2>
            <StreamList type={m.type} meta={m} videoId={m.id} auto={pick?.auto} party={pick?.party} pos={pick?.pos} />
          </section>
        )}

        {trailerItems.length ? (
          <section className="mt-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">{t('trailers_clips')}</h2>
              {trailerTypes.length > 1 ? (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button
                    onClick={() => setTrailerFilter('all')}
                    className={`rounded-full px-3 py-1 font-medium transition ${trailerFilter === 'all' ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}
                  >
                    {t('trailer_type_all')}
                  </button>
                  {trailerTypes.map((ty) => (
                    <button
                      key={ty}
                      onClick={() => setTrailerFilter(ty)}
                      className={`rounded-full px-3 py-1 font-medium transition ${trailerFilter === ty ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}
                    >
                      {TRAILER_TYPE_KEY[ty] ? t(TRAILER_TYPE_KEY[ty]) : ty}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="hscroll flex gap-4 pb-2">
              {visibleTrailers.map((tr) => (
                <button
                  key={`${tr.type}:${tr.key}`}
                  onClick={() => { setActiveTrailerKey(tr.key); setTrailerOpen(true); }}
                  className="group w-64 flex-none text-start"
                >
                  <div className="relative aspect-video overflow-hidden rounded-xl bg-bg3 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc">
                    <img src={`https://i.ytimg.com/vi/${encodeURIComponent(tr.key)}/mqdefault.jpg`} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                    <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-80 transition group-hover:bg-black/20 group-hover:opacity-100">
                      <span className="grid size-10 place-items-center rounded-full bg-acc text-acc-ink shadow-lg"><Icon n="play" s={16} /></span>
                    </span>
                    <span className="absolute bottom-2 start-2 rounded bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {TRAILER_TYPE_KEY[tr.type] ? t(TRAILER_TYPE_KEY[tr.type]) : tr.type}
                    </span>
                  </div>
                  <div dir="auto" className="mt-1.5 truncate text-xs font-medium text-fg2 group-hover:text-fg">{tr.name}</div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {m.cast.length ? (
          <section className="mt-10">
            <h2 className="mb-4 text-xl font-semibold">{t('cast')}</h2>
            <div className="hscroll flex gap-5 pb-2">
              {m.cast.map((c, i) => {
                const inner = (
                  <>
                    <div className="mx-auto mb-2 size-[88px] overflow-hidden rounded-full bg-bg3 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc">
                      <Img srcs={[c.photo]} className="h-full w-full object-cover" fallback={<div className="grid h-full place-items-center text-2xl font-semibold text-fg3">{c.name.slice(0, 1)}</div>} />
                    </div>
                    <div className="truncate text-[13px] text-fg group-hover:text-acc">{c.name}</div>
                    {c.character ? <div className="truncate text-[11px] text-fg3">{c.character}</div> : null}
                  </>
                );
                return c.id ? (
                  <button key={i} onClick={() => nav.open({ kind: 'person', id: c.id!, name: c.name })} className="group w-[104px] flex-none text-center">
                    {inner}
                  </button>
                ) : (
                  <div key={i} className="w-[104px] flex-none text-center">{inner}</div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      <div className="px-12"><FriendsSaw m={m} watchedIt={watchedIds.size > 0 || !!st?.flaggedWatched} /></div>

      {m.recommendations?.length ? <div className="-mx-0"><Row title={t('more_like')} items={m.recommendations} width={168} height={262} render={(it) => <Poster item={it} />} /></div> : null}

      {series && pick ? (
        <aside className="fixed inset-y-0 end-0 z-40 flex w-[min(520px,92vw)] flex-col border-s border-line bg-bg1/95 shadow-2xl backdrop-blur-xl fade-in">
          <div className="flex items-start gap-3 border-b border-line p-5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg3">{m.name}</div>
              <div className="truncate text-lg font-semibold">{picked ? `S${picked.season}E${picked.episode} · ${picked.name}` : ''}</div>
            </div>
            <button onClick={() => setPick({ ...pick, auto: true, party: true })} className="flex items-center gap-1.5 rounded-full bg-acc/20 px-3.5 py-1.5 text-xs font-semibold text-acc hover:bg-acc hover:text-acc-ink">
              <Icon n="users" s={14} />{t('start_party')}
            </button>
            <button aria-label={t('back')} onClick={() => setPick(null)} className="grid size-9 place-items-center rounded-full bg-white/8 hover:bg-white/15"><Icon n="x" s={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <StreamList type="series" meta={m} videoId={pick.id} label={label(m, picked)} auto={pick.auto} party={pick.party} pos={pick.pos} onStarted={() => setPick(null)} />
          </div>
        </aside>
      ) : null}
      {active && trailerOpen && modalTrailerKey ? (
        <div onClick={() => { setTrailerOpen(false); setActiveTrailerKey(null); }} className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6 backdrop-blur-md fade-in">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl overflow-hidden rounded-2xl bg-bg1 ring-1 ring-white/15 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="truncate text-sm font-semibold">{m.name} · {t('trailer')}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => invoke('open', `https://www.youtube.com/watch?v=${modalTrailerKey}`)} className="rounded-full bg-white/10 px-3 py-1 text-xs text-fg2 hover:bg-white/20 hover:text-fg">
                  {t('open_youtube')}
                </button>
                <button onClick={() => { setTrailerOpen(false); setActiveTrailerKey(null); }} aria-label={t('back')} className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20">
                  <Icon n="x" s={16} />
                </button>
              </div>
            </div>
            <div className="aspect-video w-full bg-black">
              <iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(modalTrailerKey)}?autoplay=1&rel=0`}
                className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen" allowFullScreen title={m.name} />
            </div>
          </div>
        </div>
      ) : null}

      {active && shuffledEp ? (
        <div onClick={() => setShuffledEp(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-md fade-in">
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-md overflow-hidden rounded-2xl border border-acc/30 bg-bg1/96 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-acc">
                <Icon n="shuffle" s={16} /><span>{t('ep_shuffle')}</span>
              </div>
              <button onClick={() => setShuffledEp(null)} aria-label={t('back')} className="grid size-7 place-items-center rounded-full bg-white/8 hover:bg-white/15">
                <Icon n="x" s={14} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              {shuffledEp.thumbnail ? (
                <div className="aspect-video overflow-hidden rounded-xl bg-bg3 ring-1 ring-line">
                  <Img srcs={[shuffledEp.thumbnail]} className="h-full w-full object-cover" />
                </div>
              ) : null}
              <div>
                <div dir="ltr" className="font-mono text-xs font-bold text-acc">S{shuffledEp.season}E{shuffledEp.episode}</div>
                <div dir="auto" className="mt-0.5 text-base font-bold text-fg">{shuffledEp.name || t('episode_n', { n: shuffledEp.episode ?? '' })}</div>
                {shuffledEp.overview ? <p dir="auto" className="clamp-3 mt-1.5 text-xs leading-relaxed text-fg2">{shuffledEp.overview}</p> : null}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    const target = shuffledEp;
                    setShuffledEp(null);
                    setSeason(target.season);
                    setPick({ id: target.id, auto: false, pos: resumeOf(target.id) });
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-acc px-4 py-2.5 text-xs font-bold text-acc-ink hover:brightness-110"
                >
                  <Icon n="play" s={14} />{t('th_play_now')}
                </button>
                <button
                  onClick={pickRandomEpisode}
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2.5 text-xs font-semibold text-fg hover:bg-white/15"
                >
                  <Icon n="shuffle" s={14} />{t('ep_shuffle_another')}
                </button>
              </div>
            </div>
          </div>
        </div>
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

function Episode({
  v, watched, blurred, progress, onPlay, onToggleWatched, onMarkPrev, onQueue, onReveal,
}: {
  v: Video; watched: boolean; blurred: boolean; progress: number;
  onPlay: () => void; onToggleWatched: () => void; onMarkPrev: () => void; onQueue: () => void; onReveal: () => void;
}) {
  const t = useT(), { lang } = useHost();
  const future = v.released && Date.parse(v.released) > Date.now();
  return (
    <div className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5">
      <button onClick={onPlay} disabled={!!future} className="flex min-w-0 flex-1 items-center gap-5 p-1 text-start disabled:opacity-50">
        <span className="w-6 flex-none text-center font-mono text-lg text-fg3">{v.episode}</span>
        <span className="relative aspect-video w-[200px] flex-none overflow-hidden rounded-lg bg-bg3">
          <Img srcs={[v.thumbnail]} className={`h-full w-full object-cover transition duration-300 ${blurred ? 'scale-110 blur-md brightness-50' : ''}`} />
          {blurred ? (
            <span onClick={(e) => { e.stopPropagation(); onReveal(); }}
              title={t('reveal_ep')}
              className="absolute inset-0 grid place-items-center bg-black/25 text-white/80 hover:text-acc">
              <Icon n="eyeoff" s={22} />
            </span>
          ) : (!future ? <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100"><Icon n="play" s={26} /></span> : null)}
          {progress > 0 ? <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span className="block h-full bg-acc" style={{ width: `${Math.min(100, progress * 100)}%` }} /></span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span dir="auto" className="mb-1 block truncate text-[15px] font-semibold">{v.name || t('episode_n', { n: v.episode ?? '' })}</span>
          {v.overview ? (
            <span
              dir="auto"
              onClick={(e) => { if (blurred) { e.stopPropagation(); onReveal(); } }}
              title={blurred ? t('reveal_ep') : undefined}
              className={`clamp-2 block text-[13px] leading-relaxed text-fg2 transition ${blurred ? 'select-none blur-[5px]' : ''}`}
            >
              {v.overview}
            </span>
          ) : null}
          {future ? <span className="mt-1 block text-xs text-acc">{t('released_on', { d: fmtLocaleDate(v.released!, lang) })}</span> : null}
        </span>
      </button>
      <div className="me-2 flex flex-none items-center gap-1.5">
        {!future ? (
          <button onClick={onQueue} title={t('ctx_add_queue')} aria-label={t('ctx_add_queue')}
            className="grid size-8 place-items-center rounded-full bg-white/8 text-fg3 opacity-0 transition hover:bg-acc/20 hover:text-acc group-hover:opacity-100 focus-visible:opacity-100">
            <ListPlus size={15} />
          </button>
        ) : null}
        <button onClick={onMarkPrev} title={t('mark_prev_watched')} aria-label={t('mark_prev_watched')}
          className="grid size-8 place-items-center rounded-full bg-white/8 text-fg3 opacity-0 transition hover:bg-white/20 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100">
          <CheckCheck size={15} />
        </button>
        <button onClick={onToggleWatched} title={watched ? t('mark_unwatched') : t('mark_watched')} aria-label={watched ? t('mark_unwatched') : t('mark_watched')} aria-pressed={watched}
          className={`grid size-9 place-items-center rounded-full transition ${watched ? 'bg-acc text-acc-ink shadow' : 'bg-white/8 text-fg3 opacity-0 hover:bg-white/20 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100'}`}>
          <Icon n="check" s={16} />
        </button>
      </div>
    </div>
  );
}
