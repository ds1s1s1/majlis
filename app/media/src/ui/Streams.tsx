import { useEffect, useRef } from 'react';
import { useStreams, play, type Item, type Ranked, type Type } from '../api';
import { useHost, useT } from '../host';
import { Icon } from './Icon';

const res = (h: number) => (h >= 2160 ? '4K' : h ? `${h}p` : null);

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'acc' | 'ok' | 'bad' }) {
  const c = { plain: 'bg-white/8 text-fg2', acc: 'bg-acc/15 text-acc', ok: 'bg-emerald-400/12 text-emerald-300', bad: 'bg-red-500/15 text-red-300' }[tone];
  return <span dir="ltr" className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${c}`}>{children}</span>;
}

// One ranked copy: what it is (resolution, HDR, size, swarm) and where it comes from
function StreamRow({ r, best, onPlay }: { r: Ranked; best: boolean; onPlay: () => void }) {
  const t = useT(), f = r.facts, s = r.stream;
  const text = [s.title, s.description, s.name].filter(Boolean).join('\n').split('\n').filter((l) => l.trim());
  return (
    <button onClick={onPlay} className={`group flex w-full items-start gap-4 rounded-xl p-3.5 text-start transition hover:bg-white/6 ${best ? 'bg-acc/8 ring-1 ring-acc/40' : ''}`}>
      <span className={`mt-0.5 grid size-9 flex-none place-items-center rounded-full transition ${best ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 group-hover:bg-fg group-hover:text-bg'}`}><Icon n="play" s={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {best ? <Badge tone="acc">{t('best_source')}</Badge> : null}
          {res(f.height) ? <Badge>{res(f.height)}</Badge> : null}
          {f.dv ? <Badge>DV</Badge> : f.hdr ? <Badge>HDR</Badge> : null}
          {f.remux ? <Badge>REMUX</Badge> : null}
          {f.instant ? <Badge tone="ok">⚡ {t('instant')}</Badge> : f.cached ? <Badge tone="ok">⚡ {t('cached')}</Badge> : null}
          {f.torrent && !f.instant && f.seeders != null ? <Badge tone={f.seeders > 0 ? 'plain' : 'bad'}>{f.seeders > 0 ? `👤 ${f.seeders}` : t('dead')}</Badge> : null}
          {f.sizeGb ? <Badge>{f.sizeGb >= 1 ? `${f.sizeGb.toFixed(1)} GB` : `${Math.round(f.sizeGb * 1024)} MB`}</Badge> : null}
          {f.rough ? <Badge tone="bad">{t('rough')}</Badge> : null}
          {f.arabic ? <Badge tone="acc">{t('arabic_sub')}</Badge> : null}
          <span className="ms-auto truncate text-[11px] text-fg3">{r.addon.name}</span>
        </span>
        <span className="clamp-2 block break-all text-[13px] leading-snug text-fg2" dir="ltr">{text[0]}</span>
      </span>
    </button>
  );
}

// Every addon's copies of one video, best first. `auto`: play the best as soon as they're in.
export function StreamList({ type, meta, videoId, label, auto, pos, onStarted }: {
  type: Type; meta: Item; videoId: string; label?: string; auto?: boolean; pos?: number; onStarted?: () => void;
}) {
  const t = useT(), { toast } = useHost();
  const q = useStreams(type, videoId);
  const list = (q.data?.streams || []).filter((r) => r.score > -1e5);
  const fired = useRef(false);
  const start = (r: Ranked) => {
    toast(t('playing'));
    play({ type, videoId, meta, stream: r.stream, label, pos }).catch((e: Error) => toast(e.message));
    onStarted?.();
  };
  useEffect(() => {
    if (!auto || fired.current || !list.length) return;
    fired.current = true;
    start(list[0]);
  }, [auto, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="skel h-[68px] rounded-xl" />)}
    </div>
  );
  if (!list.length) return <p className="rounded-xl bg-white/4 p-5 text-sm text-fg2">{t('no_sources')}</p>;
  return <div className="space-y-1">{list.slice(0, 60).map((r, i) => <StreamRow key={i} r={r} best={i === 0 && r.tier > 0} onPlay={() => start(r)} />)}</div>;
}
