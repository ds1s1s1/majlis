import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke, type Item } from '../api';
import { useHost, useNav, useT } from '../host';
import { Img } from './Img';
import { Icon } from './Icon';
import { Row } from './Row';

export interface VoteItem { id: string; type: string; name: string; poster: string | null; votes: number; voters: string[] }
export interface VoteState { items: VoteItem[]; host: boolean }
// pushed by the room (main -> app.js -> mount().setVote), never fetched
export const useVote = () => useQuery<VoteState | null>({ queryKey: ['vote'], queryFn: () => null, staleTime: Infinity, enabled: false });
export const useRoom = () => useQuery({ queryKey: ['room'], queryFn: () => invoke<'host' | 'guest' | null>('vote:room').catch(() => null), staleTime: 10000 });

// Tonight's vote: everyone in the room has one vote; the host opens the winner
export function VoteRow() {
  const t = useT(), nav = useNav(), { toast } = useHost();
  const v = useVote().data;
  if (!v?.items.length) return null;
  const winner = async () => { const w = await invoke<VoteItem | null>('vote:winner'); if (w) { toast(t('vote_won', { n: w.name })); nav.open({ kind: 'title', type: w.type, id: w.id }); } };
  return (
    <Row title={t('vote_title')} items={v.items} width={200} height={380}
      action={v.host ? <span className="flex gap-2">
        <button onClick={winner} className="flex items-center gap-1.5 rounded-full bg-acc px-4 py-1.5 text-sm font-semibold text-acc-ink"><Icon n="star" s={15} />{t('vote_winner')}</button>
        <button onClick={() => invoke('vote:clear')} className="rounded-full px-3 py-1.5 text-sm text-fg2 hover:bg-white/8">{t('vote_clear')}</button>
      </span> : null}
      render={(x) => (
        <div className="w-[200px]">
          <button onClick={() => nav.open({ kind: 'title', type: x.type, id: x.id })} className="block aspect-[2/3] w-full overflow-hidden rounded-xl bg-bg2 ring-1 ring-line hover:ring-2 hover:ring-acc/70">
            <Img srcs={[x.poster]} className="h-full w-full object-cover" fallback={<div className="p-3 text-sm">{x.name}</div>} />
          </button>
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{x.name}</span>
              <span className="block truncate text-xs text-fg2">{t('vote_count', { n: x.votes })}{x.voters.length ? ` · ${x.voters.join('، ')}` : ''}</span>
            </span>
            <button onClick={() => invoke('vote:cast', x.id)} className="flex-none rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink">{t('vote_cast')}</button>
          </div>
        </div>
      )} />
  );
}

export function NominateButton({ m }: { m: Item }) {
  const t = useT(), { toast } = useHost();
  const room = useRoom().data;
  if (!room) return null;
  return (
    <button onClick={async () => { await invoke('vote:nominate', { id: m.id, type: m.type, name: m.name, poster: m.poster }); toast(t('vote_nominated')); }}
      className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 font-semibold backdrop-blur-md transition hover:bg-white/25">
      <Icon n="star" s={18} />{t('vote_nominate')}
    </button>
  );
}

interface FriendSaw { name: string; watched: boolean; rating: number | null; review: string | null; progress: number | null }
// What people in the room thought. Reviews hide behind a tap until you've watched it yourself.
export function FriendsSaw({ m, watchedIt }: { m: Item; watchedIt: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ['friends-on', m.id], queryFn: () => invoke<FriendSaw[]>('media:friends-on', { id: m.id, name: m.name, year: m.releaseInfo || m.year }), staleTime: 60000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!q.data?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">{t('friends_saw')}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {q.data.map((f) => (
          <div key={f.name} className="rounded-xl bg-bg1 p-4 ring-1 ring-line">
            <div className="mb-1 flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-acc/20 font-semibold text-acc">{f.name.slice(0, 1)}</span>
              <span className="flex-1 truncate font-semibold">{f.name}</span>
              {f.rating ? <span className="font-mono text-sm text-acc">{'★'.repeat(Math.round(f.rating))}</span> : null}
            </div>
            <div className="text-xs text-fg2">{f.watched ? t('friend_watched') : f.progress != null ? t('friend_progress', { p: f.progress }) : ''}</div>
            {f.review ? (watchedIt || open.has(f.name)
              ? <p dir="auto" className="mt-2 text-sm leading-relaxed text-fg2">{f.review}</p>
              : <button onClick={() => setOpen(new Set(open).add(f.name))} className="mt-2 text-sm text-acc hover:underline">{t('what_said')}</button>) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
