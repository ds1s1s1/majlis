import { memo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Img } from './Img';
import { Icon } from './Icon';
import { openPosterContextMenu } from './PosterContextMenu';
import { rememberFlip, useHost, useNav, useT } from '../host';
import { cin, prefetchMeta, quickplay, useLists, type Preview } from '../api';

const DAY = 864e5;
export const isNew = (p: Preview) => { const t = Date.parse(p.released || ''); return t > Date.now() - 30 * DAY && t <= Date.now(); };
export const isInCinema = (p: Preview) => {
  if (p.inCinema) return true;
  if (p.type !== 'movie') return false;
  const t = Date.parse(p.released || '');
  return t > Date.now() - 60 * DAY && t <= Date.now() && !p.digitalRelease && !/digital|web|stream/i.test(String(p.releaseInfo || ''));
};
export const isAnimeItem = (p: Preview) => p.type === 'anime' || /^(kitsu|anilist|mal):/i.test(p.id) || [...(p.genres || []), ...(p.genre || [])].some((g) => /anime/i.test(g));
export const animeAudio = (p: Preview): 'dub' | 'sub' | null => {
  if (!isAnimeItem(p)) return null;
  if (p.dub || /\b(dub|dubbed|dual|مدبلج)\b/i.test(`${p.name} ${p.description || ''} ${p.releaseInfo || ''}`)) return 'dub';
  return 'sub';
};

// a 2:3 poster card: opens the title page; smart corner badges + 150ms hover prefetch + bookmark toggle
export const Poster = memo(function Poster({ item, w = 168, watched = false }: { item: Preview; w?: number; watched?: boolean }) {
  const nav = useNav(), t = useT(), { toast } = useHost(), qc = useQueryClient();
  const lists = useLists().data;
  const saved = !!lists?.watchlist?.some((x) => x.id === item.id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => prefetchMeta(qc, item.type, item.id), 150);
  };
  const onLeave = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const metaCard = { id: item.id, type: item.type, name: item.name, poster: item.poster || null };
  const toggleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await cin('lib-toggle', { list: 'watchlist', meta: metaCard });
    qc.invalidateQueries({ queryKey: ['lists'] });
  };
  const playNow = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    toast(t('playing'));
    const r = await quickplay({
      type: item.type, id: item.id,
      card: { name: item.name, seriesName: item.name, poster: item.poster || null },
    });
    if (!r.ok && !r.cancelled && r.error) toast(r.error);
  };

  const anime = isAnimeItem(item), audio = animeAudio(item);
  const mal = item.malRating ?? item.ratings?.mal ?? (anime && /^(anilist|mal|kitsu):/i.test(item.id) ? item.imdbRating : null);
  const imdb = item.ratings?.imdb ?? (!mal ? item.imdbRating : null);
  const cinema = isInCinema(item), fresh = isNew(item);
  const title = <div className="absolute inset-0 flex items-end bg-gradient-to-b from-bg2 to-bg3 p-3 text-sm font-semibold leading-snug text-fg2">{item.name}</div>;
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      onContextMenu={(e) => openPosterContextMenu(e, item, { watched })}
      style={{ width: w }} className="group relative flex-none">
      <button onClick={(e) => { rememberFlip(e.currentTarget, item.poster); nav.open({ kind: 'title', type: item.type, id: item.id }); }}
        title={item.name} className="block w-full text-start outline-none">
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition duration-300 ease-out-soft group-hover:-translate-y-1 group-hover:ring-2 group-hover:ring-acc/70 group-focus-visible:ring-2 group-focus-visible:ring-acc">
          <Img srcs={[item.poster]} alt="" className="absolute inset-0 h-full w-full object-cover" fallback={title} />
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
            <div className="flex flex-col items-start gap-1">
              {imdb ? <span dir="ltr" className="rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[#f5c518] backdrop-blur">IMDb ★ {imdb}</span> : null}
              {mal ? <span dir="ltr" className="rounded-md bg-[#2e51a2]/90 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white backdrop-blur">MAL ★ {mal}</span> : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              {watched ? <span title={t('watched')} className="grid size-6 place-items-center rounded-full bg-acc text-acc-ink shadow"><Icon n="check" s={14} /></span> : null}
              {cinema ? <span className="rounded-md bg-amber-500/95 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-black shadow">{t('in_cinema')}</span>
                : fresh ? <span className="rounded-md bg-acc px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc-ink shadow">{t('new')}</span> : null}
              {audio ? <span className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider backdrop-blur ${audio === 'dub' ? 'bg-acc/90 text-acc-ink' : 'bg-black/75 text-fg2 ring-1 ring-white/15'}`}>{t(audio)}</span> : null}
            </div>
          </div>
        </div>
      </button>
      <button onClick={(e) => playNow(e)} title={t('play')} aria-label={t('play')}
        className="absolute bottom-2.5 start-2.5 z-10 grid size-8 place-items-center rounded-full bg-acc text-acc-ink opacity-0 shadow-lg transition duration-200 hover:scale-105 group-hover:-translate-y-1 group-hover:opacity-100 focus-visible:opacity-100">
        <Icon n="play" s={14} />
      </button>
      <div className="absolute bottom-2.5 end-2.5 z-10 flex items-center gap-1 transition duration-200 group-hover:-translate-y-1">
        <button onClick={(e) => openPosterContextMenu(e, item, { watched })} title={t('more')} aria-label={t('more')}
          className="grid size-7 place-items-center rounded-full bg-black/70 text-fg2 opacity-0 backdrop-blur transition hover:bg-black/90 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100">
          <Icon n="more" s={14} />
        </button>
        <button onClick={toggleBookmark} title={t('watchlist')} aria-label={t('watchlist')} aria-pressed={saved}
          className={`grid size-7 place-items-center rounded-full backdrop-blur transition ${saved ? 'bg-acc text-acc-ink opacity-100 shadow' : 'bg-black/70 text-fg2 opacity-0 hover:bg-black/90 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100'}`}>
          <Icon n="bookmark" s={14} />
        </button>
      </div>
    </div>
  );
});

export function PosterSkeleton({ w = 168 }: { w?: number }) {
  return <div style={{ width: w }} className="skel aspect-[2/3] flex-none rounded-xl" />;
}
