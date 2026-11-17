import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, invoke, type Stream, type Type } from '../api';
import { useT } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';

export interface Download { id: string; name: string; metaId: string; type: Type; videoId: string; poster: string | null; stream: Stream; state: 'queued' | 'downloading' | 'paused' | 'done' | 'failed'; got: number; total: number; speed: number; kind: 'http' | 'torrent' | null; error: string | null }

export const useDownloads = () => useQuery({
  queryKey: ['downloads'], queryFn: () => cin<Download[]>('dl-list'), staleTime: 0,
  refetchInterval: (q) => (q.state.data?.some((d) => d.state === 'downloading') ? 1000 : false),
});
const size = (b: number) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : `${Math.round(b / 2 ** 20)} MB`);

export function Downloads() {
  const t = useT(), qc = useQueryClient();
  const q = useDownloads();
  const act = async (ch: string, a: object) => { await cin(ch, a); qc.invalidateQueries({ queryKey: ['downloads'] }); };
  const playIt = (d: Download) => invoke('media:play', { type: d.type, id: d.videoId, stream: { majlisDownload: d.id }, card: { name: d.name, poster: d.poster, type: d.type, metaId: d.metaId } });
  const list = q.data || [];
  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-8 flex items-center gap-3">
        <h1 className="text-3xl font-bold">{t('downloads')}</h1>
        <span className="flex-1" />
        <button onClick={() => cin('dl-folder')} className="flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm hover:bg-white/15"><Icon n="window" s={16} />{t('open_folder')}</button>
      </div>
      {!list.length && !q.isLoading ? <p className="py-20 text-center text-fg3">{t('dl_empty')}</p> : null}
      <div className="grid grid-cols-1 gap-3">
        {list.map((d) => {
          const pct = d.total ? Math.min(100, (d.got / d.total) * 100) : 0;
          return (
            <div key={d.id} className="flex items-center gap-4 rounded-2xl bg-bg1 p-3 ring-1 ring-line">
              <span className="h-[84px] w-14 flex-none overflow-hidden rounded-lg bg-bg3"><Img srcs={[d.poster]} className="h-full w-full object-cover" /></span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-semibold">{d.name}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg2">
                  <span>{t(`dl_${d.state}` as 'dl_done')}</span>
                  {d.total ? <span dir="ltr">{size(d.got)} / {size(d.total)}</span> : null}
                  {d.state === 'downloading' && d.speed ? <span dir="ltr">{(d.speed / 2 ** 20).toFixed(1)} MB/s</span> : null}
                  {d.kind === 'torrent' ? <span className="text-fg3">BitTorrent</span> : null}
                  {d.error ? <span className="text-red-300">{d.error}</span> : null}
                </span>
                {d.state !== 'done' ? <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${d.state === 'failed' ? 'bg-red-400' : 'bg-acc'}`} style={{ width: `${pct}%` }} /></span> : null}
              </span>
              {d.state === 'done' ? <Btn icon="play" label={t('play')} onClick={() => playIt(d)} primary /> : null}
              {d.state === 'downloading' ? <Btn icon="pause" label={t('pause')} onClick={() => act('dl-pause', { id: d.id })} /> : null}
              {d.state === 'paused' || d.state === 'failed' ? <Btn icon="refresh" label={t('resume_dl')} onClick={() => act('dl-resume', { id: d.id })} /> : null}
              <Btn icon="x" label={t('remove')} onClick={() => act('dl-remove', { id: d.id, deleteFile: confirm(t('delete_file_q')) })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Btn({ icon, label, onClick, primary }: { icon: string; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick}
      className={`grid size-10 flex-none place-items-center rounded-full transition ${primary ? 'bg-fg text-bg hover:bg-acc hover:text-acc-ink' : 'text-fg2 hover:bg-white/10 hover:text-fg'}`}>
      <Icon n={icon} s={18} />
    </button>
  );
}
