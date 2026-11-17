import { memo } from 'react';
import { Img } from './Img';
import { Icon } from './Icon';
import { useNav, useT } from '../host';
import type { Preview } from '../api';

const DAY = 864e5;
export const isNew = (p: Preview) => { const t = Date.parse(p.released || ''); return t > Date.now() - 45 * DAY && t <= Date.now(); };

// a 2:3 poster card: opens the title page; badges for rating, new, watched
export const Poster = memo(function Poster({ item, w = 168, watched = false }: { item: Preview; w?: number; watched?: boolean }) {
  const nav = useNav(), t = useT();
  const title = <div className="absolute inset-0 flex items-end bg-gradient-to-b from-bg2 to-bg3 p-3 text-sm font-semibold leading-snug text-fg2">{item.name}</div>;
  return (
    <button onClick={() => nav.open({ kind: 'title', type: item.type, id: item.id })} title={item.name} style={{ width: w }}
      className="group relative flex-none text-start outline-none">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition duration-300 ease-out-soft group-hover:-translate-y-1 group-hover:ring-2 group-hover:ring-acc/70 group-focus-visible:ring-2 group-focus-visible:ring-acc">
        <Img srcs={[item.poster]} alt="" className="absolute inset-0 h-full w-full object-cover" fallback={title} />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
          {item.imdbRating ? <span className="rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#f5c518] backdrop-blur">★ {item.imdbRating}</span> : <span />}
          {watched ? <span className="grid size-6 place-items-center rounded-full bg-acc text-acc-ink"><Icon n="check" s={14} /></span>
            : isNew(item) ? <span className="rounded-md bg-acc px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc-ink">{t('new')}</span> : null}
        </div>
      </div>
    </button>
  );
});

export function PosterSkeleton({ w = 168 }: { w?: number }) {
  return <div style={{ width: w }} className="skel aspect-[2/3] flex-none rounded-xl" />;
}
