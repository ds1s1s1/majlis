import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, invoke, quickplay, useCustomLists, useLibrary, useLists, type Preview } from '../api';
import { useHost, useNav, useT } from '../host';
import { usePlayQueueStore } from '../store/usePlayQueueStore';
import { Icon } from './Icon';

interface MenuState {
  item: Preview;
  watched: boolean;
  x: number;
  y: number;
}

type Listener = (s: MenuState | null) => void;
const listeners = new Set<Listener>();
let activeMenu: MenuState | null = null;

function broadcast(next: MenuState | null) {
  activeMenu = next;
  for (const fn of listeners) fn(next);
}

export function openPosterContextMenu(e: React.MouseEvent, item: Preview, opts?: { watched?: boolean }) {
  e.preventDefault();
  e.stopPropagation();
  broadcast({
    item,
    watched: !!opts?.watched,
    x: e.clientX,
    y: e.clientY,
  });
}

export function closePosterContextMenu() {
  if (activeMenu) broadcast(null);
}

export function PosterContextMenuHost() {
  const t = useT();
  const nav = useNav();
  const { toast } = useHost();
  const qc = useQueryClient();
  const libQ = useLibrary();
  const listsQ = useLists();
  const customListsQ = useCustomLists();
  const queueItems = usePlayQueueStore((s) => s.items);
  const enqueue = usePlayQueueStore((s) => s.enqueue);

  const [state, setState] = useState<MenuState | null>(activeMenu);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) closePosterContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePosterContextMenu();
      }
    };
    const onScroll = () => closePosterContextMenu();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [state]);

  useLayoutEffect(() => {
    if (!state) return;
    const el = menuRef.current;
    const w = el?.offsetWidth || 232;
    const h = el?.offsetHeight || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(state.x, vw - w - 8));
    const top = Math.max(8, Math.min(state.y, vh - h - 8));
    setPos({ left, top });
  }, [state]);

  if (!state) return null;
  const { item, watched } = state;
  const meta = { id: item.id, type: item.type, name: item.name, poster: item.poster || null, year: item.year ?? null, genres: item.genres || [] };
  const libEntry = libQ.data?.find((x) => x._id === item.id);
  const inLib = !!libEntry && !libEntry.removed;
  const canRewind = (libEntry?.state?.timeOffset || 0) > 0;
  const inWatchlist = !!listsQ.data?.watchlist?.some((x) => x.id === item.id);
  const inFav = !!listsQ.data?.favorites?.some((x) => x.id === item.id);
  const inQueue = queueItems.some((x) => x.key === item.id);
  const customLists = customListsQ.data || [];

  const playNow = async (party = false) => {
    closePosterContextMenu();
    toast(party ? t('party_started') : t('playing'));
    const r = await quickplay({
      type: item.type,
      id: item.id,
      party,
      card: { name: item.name, seriesName: item.name, poster: item.poster || null },
    });
    if (!r.ok && !r.cancelled && r.error) toast(r.error);
  };

  const openDetails = () => {
    closePosterContextMenu();
    nav.open({ kind: 'title', type: item.type, id: item.id });
  };

  const toggleLibrary = async () => {
    closePosterContextMenu();
    if (inLib) await cin('lib-remove', { id: item.id });
    else await cin('lib-add', { meta });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['meta', item.type, item.id] });
  };

  const toggleWatched = async () => {
    closePosterContextMenu();
    await cin('lib-watched', { meta, videoId: item.id, on: !watched });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['meta', item.type, item.id] });
  };

  const addToQueue = () => {
    closePosterContextMenu();
    const added = enqueue({ id: item.id, type: item.type, name: item.name, poster: item.poster || null });
    toast(added ? t('queue_added') : t('ctx_in_queue'));
  };

  const copyTitle = async () => {
    closePosterContextMenu();
    try {
      await navigator.clipboard?.writeText(item.name);
    } catch {
      await invoke('copy', item.name).catch(() => {});
    }
    toast(t('ctx_copied'));
  };

  const toggleList = async (list: 'watchlist' | 'favorites') => {
    closePosterContextMenu();
    await cin('lib-toggle', { list, meta });
    qc.invalidateQueries({ queryKey: ['lists'] });
  };

  const nominate = async () => {
    closePosterContextMenu();
    await invoke('vote:nominate', meta).catch(() => {});
    qc.invalidateQueries({ queryKey: ['social-room'] });
    toast(t('vote_nominated'));
  };

  const rewindItem = async () => {
    closePosterContextMenu();
    await cin('lib-rewind', { id: item.id });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };

  const toggleCustomList = async (listId: string) => {
    closePosterContextMenu();
    await cin('custom-list-toggle', { listId, meta });
    qc.invalidateQueries({ queryKey: ['custom-lists'] });
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[80] w-60 max-h-[calc(100vh-16px)] overflow-y-auto rounded-2xl bg-bg1/96 p-1.5 text-xs shadow-2xl ring-1 ring-acc/30 backdrop-blur-xl fade-in"
    >
      <div dir="auto" className="mb-1 truncate border-b border-line px-2.5 py-1.5 text-[11px] font-semibold text-fg3">
        {item.name}
      </div>
      <CtxBtn icon="play" label={t('ctx_play_now')} accent onClick={() => playNow(false)} />
      <CtxBtn icon="info" label={t('ctx_open_details')} onClick={openDetails} />
      <CtxBtn icon={inLib ? 'check' : 'plus'} label={inLib ? t('in_library') : t('add_library')} active={inLib} onClick={toggleLibrary} />
      <CtxBtn icon="check" label={watched ? t('mark_unwatched') : t('mark_watched')} active={watched} onClick={toggleWatched} />
      {canRewind ? (
        <button
          role="menuitem"
          onClick={rewindItem}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-fg2 transition hover:bg-white/10 hover:text-fg"
        >
          <RotateCcw size={14} />
          <span className="truncate">{t('cw_rewind')}</span>
        </button>
      ) : null}
      <CtxBtn icon="list" label={inQueue ? t('ctx_in_queue') : t('ctx_add_queue')} active={inQueue} onClick={addToQueue} />
      <CtxBtn icon="copy" label={t('ctx_copy_title')} onClick={copyTitle} />
      <div className="my-1 border-t border-line" />
      <CtxBtn icon="users" label={t('watch_party')} onClick={() => playNow(true)} />
      <CtxBtn icon="bookmark" label={t('watchlist')} active={inWatchlist} onClick={() => toggleList('watchlist')} />
      <CtxBtn icon="heart" label={t('favorite')} active={inFav} onClick={() => toggleList('favorites')} />
      <CtxBtn icon="star" label={t('vote_nominate')} onClick={nominate} />
      {customLists.length ? (
        <>
          <div className="my-1 border-t border-line px-2.5 pt-1.5 text-[10px] font-bold text-fg3">{t('list_add_to')}</div>
          <div className="max-h-32 space-y-0.5 overflow-y-auto">
            {customLists.map((cl) => {
              const has = cl.items.some((x) => x.id === item.id);
              return (
                <CtxBtn key={cl.id} icon={has ? 'check' : 'plus'} label={cl.name} active={has} onClick={() => toggleCustomList(cl.id)} />
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CtxBtn({
  icon,
  label,
  active,
  accent,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition hover:bg-white/10 ${
        accent ? 'font-semibold text-acc' : active ? 'text-acc' : 'text-fg2 hover:text-fg'
      }`}
    >
      <Icon n={icon} s={15} />
      <span className="truncate">{label}</span>
    </button>
  );
}
