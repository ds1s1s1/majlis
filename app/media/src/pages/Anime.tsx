import { useMemo, useState } from 'react';
import { Billboard } from '../ui/Billboard';
import { Row } from '../ui/Row';
import { Poster, PosterSkeleton, animeAudio } from '../ui/Poster';
import { CatalogRow, useWatched } from '../ui/CatalogRow';
import { PosterGrid, Chips } from '../ui/Grid';
import { useAnimeHub, useRows, type Item } from '../api';
import { useHost, useT } from '../host';
import { genreLabel } from '../config/genres';

const fmtCountdown = (at: number | null | undefined, t: ReturnType<typeof useT>) => {
  if (!at) return null;
  const diff = at - Date.now();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000);
  return d > 0 ? `${t('th_day_short', { n: d })} ${t('th_hr_short', { n: h })}` : t('th_hr_short', { n: Math.max(1, h) });
};

type Section = 'trending' | 'season' | 'top' | 'movies';
type AudioFilter = 'all' | 'sub' | 'dub';

// Anime Hub: AniList trending, current season airing schedule, top rated, anime movies + addon catalogs
export function Anime() {
  const t = useT(), { lang } = useHost();
  const hub = useAnimeHub(), rows = useRows(), watched = useWatched();
  const [sec, setSec] = useState<Section>('trending');
  const [audio, setAudio] = useState<AudioFilter>('all');
  const [genre, setGenre] = useState<string | null>(null);

  const data = hub.data;
  const activeList = useMemo<Item[]>(() => {
    if (!data) return [];
    const base = sec === 'season' ? data.season : sec === 'top' ? data.topRated : sec === 'movies' ? data.movies : data.trending;
    return base.filter((it) => {
      if (audio !== 'all' && animeAudio(it) !== audio) return false;
      if (genre && !(it.genres || []).includes(genre)) return false;
      return true;
    });
  }, [data, sec, audio, genre]);

  const genres = useMemo(() => {
    const all = new Set<string>();
    for (const it of data?.trending || []) for (const g of it.genres || []) all.add(g);
    return [...all].slice(0, 12);
  }, [data?.trending]);

  const mine = (rows.data || []).filter((r) => r.type === 'anime' || /kitsu|anime/i.test(r.addon + r.id));

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      <Billboard items={(data?.trending || []).filter((x) => x.background).slice(0, 6)} />
      <div className="relative z-10 -mt-20 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-12">
          <div className="flex flex-wrap gap-2">
            {([
              ['trending', t('trending_now')],
              ['season', t('anime_this_season')],
              ['top', t('anime_top')],
              ['movies', t('anime_movies')],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setSec(id)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${sec === id ? 'bg-acc text-acc-ink' : 'bg-white/10 text-fg2 hover:bg-white/15 hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-full bg-white/8 p-0.5 text-xs">
            {([
              ['all', t('filter_all')],
              ['sub', t('anime_sub_only')],
              ['dub', t('anime_dub_only')],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setAudio(id)}
                className={`rounded-full px-3 py-1 font-medium transition ${audio === id ? 'bg-fg text-bg' : 'text-fg2 hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {genres.length ? (
          <div className="px-12">
            <Chips value={genre} onChange={setGenre} options={[{ id: null, label: t('all') }, ...genres.map((g) => ({ id: g, label: genreLabel(g, lang) }))]} />
          </div>
        ) : null}

        {sec === 'season' || genre || audio !== 'all' ? (
          <div className="px-12">
            {sec === 'season' && !genre && audio === 'all' && activeList.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
                {activeList.map((it) => {
                  const cd = fmtCountdown(it.nextEpisode?.at, t);
                  return (
                    <div key={it.id} className="space-y-1.5">
                      <Poster item={it} w={160} watched={watched.has(it.id)} />
                      {it.nextEpisode ? (
                        <div className="flex items-center justify-between px-1 text-[11px] font-medium text-acc">
                          <span>E{it.nextEpisode.episode}</span>
                          {cd ? <span>{t('next_ep_countdown', { d: cd })}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <PosterGrid items={activeList} watched={watched} loading={hub.isLoading} />
            )}
          </div>
        ) : (
          <Row title={sec === 'top' ? t('anime_top') : sec === 'movies' ? t('anime_movies') : t('trending_now')} sub="AniList"
            items={activeList} width={168} height={262} loading={hub.isLoading} skeleton={<PosterSkeleton />}
            render={(it) => <Poster item={it} watched={watched.has(it.id)} />} />
        )}

        {sec === 'trending' && !genre && audio === 'all' && data?.season?.length ? (
          <Row title={t('anime_this_season')} sub="AniList" items={data.season} width={168} height={284} render={(it) => {
            const cd = fmtCountdown(it.nextEpisode?.at, t);
            return (
              <div>
                <Poster item={it} watched={watched.has(it.id)} />
                {it.nextEpisode && cd ? <div className="mt-1 truncate text-[11px] font-medium text-acc">E{it.nextEpisode.episode} · {t('next_ep_countdown', { d: cd })}</div> : null}
              </div>
            );
          }} />
        ) : null}

        {mine.map((r) => <CatalogRow key={`${r.addon}|${r.type}|${r.id}`} row={r} title={r.name} watched={watched} />)}
      </div>
    </div>
  );
}
