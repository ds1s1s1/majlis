import { useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cin, quickplay, useSocialRoom } from '../api';
import { useHost, useNav, useT } from '../host';
import { usePlayQueueStore, type PlayQueueItem } from '../store/usePlayQueueStore';
import { Icon } from './Icon';
import { Img } from './Img';

export function PlayQueueDrawer() {
  const t = useT();
  const nav = useNav();
  const { toast } = useHost();
  const room = useSocialRoom().data;
  const inParty = !!room?.role;
  const { items, open, setOpen, remove, move, clear } = usePlayQueueStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  if (!open) return null;

  const playNow = async (it: PlayQueueItem) => {
    remove(it.key);
    setOpen(false);
    toast(t('playing'));
    if (it.directUrl) {
      const dr = await cin<{ ok: boolean; error?: string }>('play-url', { url: it.directUrl, name: it.name, party: inParty }).catch(() => ({ ok: false, error: t('error_load') }));
      if (!dr.ok && dr.error) toast(dr.error);
      return;
    }
    const r = await quickplay({
      type: it.type,
      id: it.id,
      videoId: it.videoId,
      party: inParty,
      card: {
        name: it.epLabel ? `${it.name} · ${it.epLabel}` : it.name,
        seriesName: it.name,
        poster: it.poster,
      },
    });
    if (!r.ok && !r.cancelled && r.error) toast(r.error);
  };

  return (
    <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm fade-in">
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('queue_title')}
        className="fixed inset-y-0 end-0 flex w-[min(380px,92vw)] flex-col border-s border-line bg-bg1/96 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon n="list" s={18} className="text-acc" />
            <h2 className="text-base font-bold text-fg">{t('queue_n', { n: items.length })}</h2>
          </div>
          <div className="flex items-center gap-2">
            {items.length ? (
              <button
                onClick={clear}
                className="rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-fg2 transition hover:bg-red-500/20 hover:text-red-300"
              >
                {t('queue_clear')}
              </button>
            ) : null}
            <button
              onClick={() => setOpen(false)}
              aria-label={t('back')}
              className="grid size-8 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg"
            >
              <Icon n="x" s={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {!items.length ? (
            <div className="grid h-full place-items-center px-4 text-center">
              <div className="space-y-2">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-white/6 text-fg3">
                  <Icon n="list" s={22} />
                </div>
                <p className="text-xs leading-relaxed text-fg3">{t('queue_empty')}</p>
              </div>
            </div>
          ) : (
            items.map((it, idx) => (
              <div
                key={it.key}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-2.5 transition hover:border-acc/40"
              >
                <span className="w-5 flex-none text-center font-mono text-xs text-fg3">{idx + 1}</span>
                <button
                  onClick={() => { setOpen(false); nav.open({ kind: 'title', type: it.type, id: it.id }); }}
                  className="h-14 w-10 flex-none overflow-hidden rounded-lg bg-bg3"
                >
                  <Img srcs={[it.poster]} className="h-full w-full object-cover" fallback={<div className="h-full w-full bg-bg3" />} />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    dir="auto"
                    onClick={() => { setOpen(false); nav.open({ kind: 'title', type: it.type, id: it.id }); }}
                    className="block w-full truncate text-start text-sm font-semibold text-fg hover:text-acc"
                  >
                    {it.name}
                  </button>
                  {it.epLabel ? (
                    <div dir="ltr" className="truncate font-mono text-[11px] font-medium text-acc">{it.epLabel}</div>
                  ) : null}
                </div>
                <div className="flex flex-none items-center gap-1">
                  <button
                    onClick={() => playNow(it)}
                    title={t('ctx_play_now')}
                    aria-label={t('ctx_play_now')}
                    className="grid size-8 place-items-center rounded-full bg-acc text-acc-ink transition hover:brightness-110"
                  >
                    <Icon n="play" s={14} />
                  </button>
                  <button
                    onClick={() => move(idx, idx - 1)}
                    disabled={idx === 0}
                    title={t('move_up')}
                    aria-label={t('move_up')}
                    className="grid size-7 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === items.length - 1}
                    title={t('move_down')}
                    aria-label={t('move_down')}
                    className="grid size-7 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => remove(it.key)}
                    title={t('queue_remove')}
                    aria-label={t('queue_remove')}
                    className="grid size-7 place-items-center rounded-full bg-white/8 text-fg3 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Icon n="x" s={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
