import { useCaps, useMarathons } from '../api';
import { useNav, useT } from '../host';
import { Img } from '../ui/Img';

// Film series to watch in order (TMDB collections)
export function Collections() {
  const t = useT(), nav = useNav();
  const caps = useCaps().data;
  const q = useMarathons(!!caps?.tmdb);
  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <h1 className="mb-2 text-3xl font-bold">{t('collections')}</h1>
      <p className="mb-8 text-fg2">{t('collections_sub')}</p>
      {caps && !caps.tmdb ? <p className="rounded-xl bg-white/4 p-5 text-sm text-fg2">{t('needs_tmdb')}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
        {q.isLoading ? Array.from({ length: 9 }, (_, i) => <div key={i} className="skel aspect-video rounded-xl" />) : null}
        {(q.data || []).map((c) => (
          <button key={c.id} onClick={() => nav.open({ kind: 'collection', id: c.id, name: c.name })} className="group text-start">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc/70">
              <Img srcs={[c.background]} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              <div className="shade-b absolute inset-0" />
              <div className="absolute inset-x-4 bottom-3 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold">{c.name}</div>
                  <div className="text-xs text-fg2">{t('films_n', { n: c.parts.length })}</div>
                </div>
                <div className="flex -space-x-6 rtl:space-x-reverse">
                  {c.parts.slice(0, 4).map((p) => <span key={p.id} className="h-16 w-11 overflow-hidden rounded-md ring-2 ring-bg"><Img srcs={[p.poster]} className="h-full w-full object-cover" /></span>)}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
