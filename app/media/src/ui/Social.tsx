import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, social, useSocialRoom, type Item, type Preview } from '../api';
import { useHost, useNav, useT } from '../host';
import { Img } from './Img';
import { Icon } from './Icon';
import { Row } from './Row';

export interface VoteItem { id: string; type: string; name: string; poster: string | null; by?: string; votes: number; voters: string[] }
export interface VoteState { items: VoteItem[]; host: boolean }
// pushed by the room (main -> app.js -> mount().setVote), never fetched
export const useVote = () => useQuery<VoteState | null>({ queryKey: ['vote'], queryFn: () => null, staleTime: Infinity, enabled: false });
export const useRoom = () => useQuery({ queryKey: ['room'], queryFn: () => invoke<'host' | 'guest' | null>('vote:room').catch(() => null), staleTime: 10000 });

export function SocialAvatar({ avatar, name, accent = '#e2a43a', size = 40, ring = true }: { avatar?: string | null; name: string; accent?: string | null; size?: number; ring?: boolean }) {
  const col = accent || '#e2a43a';
  const isImg = typeof avatar === 'string' && avatar.startsWith('data:');
  return (
    <span
      className="grid flex-none place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        background: isImg ? undefined : `linear-gradient(135deg, ${col}, color-mix(in srgb, ${col} 42%, #000))`,
        boxShadow: ring ? `0 0 0 2px ${col}` : undefined,
      }}
    >
      {isImg ? <img src={avatar!} alt="" className="h-full w-full object-cover" /> : (avatar || (name || '?').slice(0, 1).toUpperCase())}
    </span>
  );
}

// Tonight's vote: everyone in the room has one vote; the host opens the winner, or anyone can compare head-to-head in Party
export function VoteRow() {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const v = useVote().data;
  const room = useSocialRoom().data;
  const [simId, setSimId] = useState<string | null>(null);
  const [simAlts, setSimAlts] = useState<Preview[]>([]);
  const [simBusy, setSimBusy] = useState(false);
  const items = v?.items?.length ? v.items : (room?.vote || []);
  const isHost = v?.host ?? (room?.role !== 'guest');
  if (!items.length) return null;

  const memberAccent = (name: string) => room?.members.find((m) => m.name === name)?.accent || '#e2a43a';
  const winner = async () => {
    const w = await invoke<VoteItem | null>('vote:winner');
    if (w) { toast(t('vote_won', { n: w.name })); nav.open({ kind: 'title', type: w.type, id: w.id }); }
  };
  const cast = async (id: string) => {
    await invoke('vote:cast', id);
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const findSimilar = async (item: VoteItem) => {
    if (simId === item.id) { setSimId(null); return; }
    setSimId(item.id);
    setSimBusy(true);
    try {
      const list = await social<Preview[]>('similar', { id: item.id, type: item.type, excludeIds: items.map((x) => x.id) });
      setSimAlts(Array.isArray(list) ? list : []);
    } catch {
      setSimAlts([]);
    } finally {
      setSimBusy(false);
    }
  };

  return (
    <>
      <Row title={t('vote_title')} items={items} width={210} height={390}
        action={<span className="flex flex-wrap items-center gap-2">
          <button onClick={() => nav.go('party')} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-semibold hover:bg-white/20">
            <Icon n="sliders" s={15} />{t('compare_matrix')}
          </button>
          {isHost ? (<>
            <button onClick={winner} className="flex items-center gap-1.5 rounded-full bg-acc px-4 py-1.5 text-sm font-semibold text-acc-ink"><Icon n="star" s={15} />{t('vote_winner')}</button>
            <button onClick={async () => { await invoke('vote:clear'); qc.invalidateQueries({ queryKey: ['social-room'] }); }} className="rounded-full px-3 py-1.5 text-sm text-fg2 hover:bg-white/8">{t('vote_clear')}</button>
          </>) : null}
        </span>}
        render={(x) => (
          <div className="w-[210px]">
            <button onClick={() => nav.open({ kind: 'title', type: x.type, id: x.id })} className="block aspect-[2/3] w-full overflow-hidden rounded-xl bg-bg2 ring-1 ring-line hover:ring-2 hover:ring-acc/70">
              <Img srcs={[x.poster]} className="h-full w-full object-cover" fallback={<div className="p-3 text-sm">{x.name}</div>} />
            </button>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{x.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-fg2">
                  <span>{t('vote_count', { n: x.votes })}</span>
                  {x.voters.map((vr) => (
                    <span key={vr} className="rounded-full px-1.5 py-0.2 text-[11px] font-semibold" style={{ color: memberAccent(vr), background: `color-mix(in srgb, ${memberAccent(vr)} 16%, transparent)` }}>
                      {vr}
                    </span>
                  ))}
                </span>
              </span>
              <button onClick={() => findSimilar(x)} title={t('vote_similar')} className="flex-none rounded-full bg-white/10 px-2 py-1.5 text-[11px] text-fg2 hover:bg-white/20">{t('vote_similar')}</button>
              <button onClick={() => cast(x.id)} className="flex-none rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink">{t('vote_cast')}</button>
            </div>
          </div>
        )} />
      {simId ? (
        <div className="glass mx-6 -mt-4 mb-6 rounded-2xl p-4 sm:mx-12">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-bold text-acc">{t('vote_similar_title')}</span>
            <button onClick={() => setSimId(null)} className="text-fg3 hover:text-fg"><Icon n="x" s={14} /></button>
          </div>
          {simBusy ? <div className="text-xs text-fg3">{t('th_sub_searching')}</div> : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {simAlts.slice(0, 6).map((alt) => (
                <div key={alt.id} className="flex w-28 flex-none flex-col gap-1.5 rounded-xl bg-bg1 p-2 ring-1 ring-line">
                  <Img srcs={[alt.poster]} className="aspect-[2/3] w-full rounded-lg object-cover bg-bg2" />
                  <div dir="auto" className="truncate text-xs font-semibold">{alt.name}</div>
                  <button onClick={async () => {
                    await invoke('vote:nominate', { id: alt.id, type: alt.type, name: alt.name, poster: alt.poster || null });
                    qc.invalidateQueries({ queryKey: ['social-room'] });
                    toast(t('vote_nominated'));
                  }} className="rounded-full bg-acc/20 py-1 text-[10.5px] font-semibold text-acc hover:bg-acc hover:text-acc-ink">
                    + {t('vote_nominate')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

export function NominateButton({ m }: { m: Item }) {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const nominate = async () => {
    await invoke('vote:nominate', { id: m.id, type: m.type, name: m.name, poster: m.poster });
    qc.invalidateQueries({ queryKey: ['social-room'] });
    toast(t('vote_nominated'));
  };
  return (
    <button onClick={nominate}
      className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-semibold backdrop-blur-md transition hover:bg-white/25">
      <Icon n="star" s={18} />{t('vote_nominate')}
    </button>
  );
}

interface FriendSaw { id?: string; name: string; accent?: string | null; avatar?: string | null; watched: boolean; rating: number | null; review: string | null; progress: number | null }
// What people in the room thought. Reviews hide behind a tap until you've watched it yourself.
export function FriendsSaw({ m, watchedIt }: { m: Item; watchedIt: boolean }) {
  const t = useT(), nav = useNav();
  const q = useQuery({ queryKey: ['friends-on', m.id], queryFn: () => invoke<FriendSaw[]>('media:friends-on', { id: m.id, name: m.name, year: m.releaseInfo || m.year }), staleTime: 60000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!q.data?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">{t('friends_saw')}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {q.data.map((f) => {
          const col = f.accent || '#e2a43a';
          return (
            <div key={f.id || f.name} className="rounded-xl bg-bg1 p-4 ring-1 ring-line">
              <div className="mb-1.5 flex items-center gap-2.5">
                <SocialAvatar avatar={f.avatar} name={f.name} accent={col} size={32} />
                {f.id ? (
                  <button onClick={() => nav.open({ kind: 'friend', id: f.id! })} className="flex-1 truncate text-start font-semibold hover:underline" style={{ color: col }}>
                    {f.name}
                  </button>
                ) : (
                  <span className="flex-1 truncate font-semibold" style={{ color: col }}>{f.name}</span>
                )}
                {f.rating ? <span className="font-mono text-sm text-acc">{'★'.repeat(Math.round(f.rating))}</span> : null}
              </div>
              <div className="text-xs text-fg2">{f.watched ? t('friend_watched') : f.progress != null ? t('friend_progress', { p: f.progress }) : ''}</div>
              {f.review ? (watchedIt || open.has(f.name)
                ? <p dir="auto" className="mt-2 text-sm leading-relaxed text-fg2">{f.review}</p>
                : <button onClick={() => setOpen(new Set(open).add(f.name))} className="mt-2 text-sm text-acc hover:underline">{t('what_said')}</button>) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
