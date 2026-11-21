import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  cin, invoke, social, useMajlisWrapped, usePartyHistory, useRoomPresets, useSearch, useSocialCompare, useSocialRoom, useSocialTaste,
  type CompareColumn, type PartyCursor, type Preview, type TasteFilters, type TastePick,
} from '../api';
import { useHost, useNav, useT } from '../host';
import { fmtLocaleDate, type Key } from '../i18n';
import { Icon } from '../ui/Icon';
import { Img } from '../ui/Img';
import { SocialAvatar, useVote } from '../ui/Social';
import { JoinFriendModal } from '../ui/JoinFriendModal';
import { usePlayQueueStore } from '../store/usePlayQueueStore';
import { useSettingsStore } from '../settings/useSettingsStore';
import { CANONICAL_GENRES, genreLabel } from '../config/genres';

const MOODS: { id: string; key: Key }[] = [
  { id: '', key: 'mood_all' },
  { id: 'chill', key: 'mood_chill' },
  { id: 'thrill', key: 'mood_thrill' },
  { id: 'mindbending', key: 'mood_mindbending' },
  { id: 'epic', key: 'mood_epic' },
  { id: 'feelgood', key: 'mood_feelgood' },
  { id: 'dark', key: 'mood_dark' },
];
const ERAS: { id: string; key: Key }[] = [
  { id: '', key: 'era_all' },
  { id: '2020s', key: 'era_2020s' },
  { id: '2010s', key: 'era_2010s' },
  { id: '2000s', key: 'era_2000s' },
  { id: '1990s', key: 'era_1990s' },
  { id: 'classic', key: 'era_classic' },
];
const WHEEL_COLS = ['#e2a43a', '#e5484d', '#3e63dd', '#12a594', '#8e4ec6', '#f76b15', '#46a758', '#d6409f'];
const MILESTONE_KEY: Record<string, Key> = {
  first_party: 'ms_first_party',
  five_parties: 'ms_five_parties',
  twenty_parties: 'ms_twenty_parties',
  ten_hours: 'ms_ten_hours',
  critic_circle: 'ms_critic_circle',
  night_owl: 'ms_night_owl',
};
const fmtAud = (n: number | null) => (!n ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

export function Party() {
  const t = useT(), nav = useNav(), { lang, toast } = useHost(), qc = useQueryClient();
  const [serverStatus, setServerStatus] = useState<{ noServer?: boolean; serverAuthFailed?: boolean }>({});
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [guestReadyLocal, setGuestReadyLocal] = useState(false);
  useEffect(() => {
    invoke<{ noServer?: boolean; serverAuthFailed?: boolean }>('state')
      .then((st) => { if (st) setServerStatus({ noServer: !!st.noServer, serverAuthFailed: !!st.serverAuthFailed }); })
      .catch(() => {});
  }, []);
  const roomQ = useSocialRoom();
  const vPush = useVote().data;
  const room = roomQ.data;
  const voteItems = vPush?.items?.length ? vPush.items : (room?.vote || []);
  const isHost = vPush?.host ?? (room?.role !== 'guest');

  const compareQ = useSocialCompare(voteItems);
  const [filters, setFilters] = useState<TasteFilters>({});
  const tasteQ = useSocialTaste(filters);
  const [wrappedRange, setWrappedRange] = useState<'month' | 'all'>('all');
  const wrappedQ = useMajlisWrapped(wrappedRange);
  const historyQ = usePartyHistory();
  const delHistory = async (id: string) => {
    await social('party-history-del', { id }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['party-history'] });
    qc.invalidateQueries({ queryKey: ['majlis-wrapped'] });
  };

  // Live nominate search + party chat + cursors + spoiler toggle
  const [nomQ, setNomQ] = useState('');
  const searchQ = useSearch(nomQ);
  const searchHits = useMemo(() => (searchQ.data || []).flatMap((g) => g.metas).slice(0, 8), [searchQ.data]);
  const [chatText, setChatText] = useState('');
  const [watchUrl, setWatchUrl] = useState('');
  const [presetName, setPresetName] = useState('');
  const [simFor, setSimFor] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simAlts, setSimAlts] = useState<Preview[]>([]);
  const presetsQ = useRoomPresets();
  const queueItems = usePlayQueueStore((s) => s.items);
  const enqueueItem = usePlayQueueStore((s) => s.enqueue);
  const moveQueueItem = usePlayQueueStore((s) => s.move);
  const removeQueueItem = usePlayQueueStore((s) => s.remove);
  const clearQueue = usePlayQueueStore((s) => s.clear);
  const setQueueOpen = usePlayQueueStore((s) => s.setOpen);
  const [cursors, setCursors] = useState<PartyCursor[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [swipeIdx, setSwipeIdx] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);
  const lastCursorAt = useRef(0);
  const wheelSeen = useRef<string | null>(null);

  // Listen to live party-cursor & party-updated events pushed from main
  useEffect(() => {
    const off = window.majlis.on((m: { type?: string; cursors?: PartyCursor[] }) => {
      if (m?.type === 'party-cursor' && Array.isArray(m.cursors)) setCursors(m.cursors);
      if (m?.type === 'party-updated') qc.invalidateQueries({ queryKey: ['social-room'] });
    });
    return off;
  }, [qc]);

  useEffect(() => {
    if (room?.cursors) setCursors(room.cursors);
  }, [room?.cursors]);

  // Countdown tick while 30s swipe is active
  const swipe = room?.swipe || null;
  const swipeActive = !!(swipe && swipe.endsAt > nowMs);
  useEffect(() => {
    if (!swipe) return;
    setSwipeIdx(0);
    const iv = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(iv);
  }, [swipe?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smooth wheel spin animation when a new wheel round arrives
  const wheel = room?.wheel || null;
  useEffect(() => {
    if (!wheel || wheelSeen.current === wheel.roundId) return;
    wheelSeen.current = wheel.roundId;
    setSpinning(true);
    const to = setTimeout(() => setSpinning(false), 4300);
    return () => clearTimeout(to);
  }, [wheel?.roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!room?.role) return;
    const now = Date.now();
    if (now - lastCursorAt.current < 90) return;
    lastCursorAt.current = now;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    social('cursor', { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }).catch(() => {});
  };

  const nominate = async (item: { id: string; type: string; name: string; poster?: string | null }) => {
    await invoke('vote:nominate', { id: item.id, type: item.type || 'movie', name: item.name, poster: item.poster || null });
    qc.invalidateQueries({ queryKey: ['social-room'] });
    toast(t('vote_nominated'));
  };
  const castVote = async (id: string) => {
    await invoke('vote:cast', id);
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const smartPlay = async (type: string, id: string, hint?: { name?: string; poster?: string | null }) => {
    toast(t('playing'));
    const found = hint || voteItems.find((x) => x.id === id) || picks.find((x) => x.id === id) || (wheel?.winner.id === id ? wheel.winner : undefined);
    try { await cin('quickplay', { type, id, party: true, ...(found?.name ? { card: { name: found.name, poster: (found as { poster?: string | null }).poster } } : {}) }); }
    catch (err) { toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); nav.open({ kind: 'title', type, id }); }
  };
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    await social('party-chat', { text: chatText.trim() });
    setChatText('');
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const startSwipe = async () => {
    setSwipeIdx(0);
    await social('swipe-start', { filters, durationSec: 30 });
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const voteSwipe = async (like: boolean) => {
    if (!swipe || !swipe.items[swipeIdx]) return;
    const item = swipe.items[swipeIdx];
    setSwipeIdx((i) => i + 1);
    await social('swipe-vote', { roundId: swipe.roundId, itemId: item.id, like });
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const spinWheel = async () => {
    const pool = voteItems.length >= 2 ? voteItems : (tasteQ.data?.picks || []).slice(0, 6);
    if (!pool.length) return;
    await social('wheel-spin', { items: pool });
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };
  const launchPreset = async (id: string, displayName: string) => {
    const r = await invoke<{ ok?: boolean } | null>('party:preset-launch', id).catch(() => null);
    if (r?.ok) {
      qc.invalidateQueries({ queryKey: ['social-room'] });
      qc.invalidateQueries({ queryKey: ['app-state'] });
      toast(t('party_preset_launched', { name: displayName }));
    }
  };
  const savePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    const nm = presetName.trim();
    if (!nm) return;
    const st = await invoke<{ settings?: Record<string, unknown> }>('state').catch(() => null);
    const s = st?.settings || {};
    await invoke('party:preset-save', {
      name: nm,
      mode: 'cinema',
      watchControl: s.watchControl || 'host',
      acceptCodes: s.acceptCodes !== false,
      allowChat: s.allowChat !== false,
      allowReactions: s.allowReactions !== false,
      autoNext: s.autoNext !== false,
      autoDuck: s.autoDuck !== false,
      qualityPreset: s.qualityPreset || 'balanced',
      maxRes: s.maxRes || '1080',
      fps: s.fps || 60,
      defaultRole: s.defaultRole || 'watch',
      roomPin: s.roomPin || '',
    }).catch(() => {});
    setPresetName('');
    qc.invalidateQueries({ queryKey: ['room-presets'] });
  };
  const deletePreset = async (id: string) => {
    await invoke('party:preset-del', id).catch(() => {});
    qc.invalidateQueries({ queryKey: ['room-presets'] });
  };
  const watchUrlTogether = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = watchUrl.trim();
    if (!u) return;
    toast(t('playing'));
    const r = await cin<{ ok: boolean; error?: string }>('play-url', { url: u, party: true }).catch(() => ({ ok: false, error: 'playback_failed' }));
    if (!r.ok) toast(r.error || t('play_url_invalid'));
    else setWatchUrl('');
  };
  const openSimilar = async (col: { id: string; type: string }) => {
    if (simFor === col.id) { setSimFor(null); return; }
    setSimFor(col.id);
    setSimLoading(true);
    try {
      const list = await social<Preview[]>('similar', {
        id: col.id,
        type: col.type || 'movie',
        excludeIds: voteItems.map((x) => x.id),
      });
      setSimAlts(Array.isArray(list) ? list : []);
    } catch {
      setSimAlts([]);
    } finally {
      setSimLoading(false);
    }
  };
  const setRemote = async (mode: 'host' | 'guest' | 'all', holderId?: string | null) => {
    await invoke('host:watch-control', { mode, holderId: holderId || null }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['social-room'] });
  };

  const memberAccent = (name: string) => room?.members.find((m) => m.name === name)?.accent || '#e2a43a';
  const cmp = compareQ.data;
  const bestMap = cmp?.highlights.best;
  const isBest = (row: keyof NonNullable<typeof bestMap>, id: string) => !!bestMap?.[row]?.includes(id);
  const picks: TastePick[] = tasteQ.data?.picks || [];
  const currentSwipe = swipe?.items[swipeIdx] || null;
  const swipeSecLeft = swipe ? Math.max(0, Math.ceil((swipe.endsAt - nowMs) / 1000)) : 0;

  return (
    <div onMouseMove={onMove} className="relative h-full overflow-y-auto px-6 pb-24 pt-28 sm:px-12">
      {/* Live peers' colored cursors */}
      {cursors.length ? (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {cursors.map((c) => (
            <div key={c.id} className="absolute -translate-x-1 -translate-y-1 transition-all duration-75"
              style={{ left: `${Math.max(2, Math.min(96, c.x * 100))}%`, top: `${Math.max(4, Math.min(94, c.y * 100))}%` }}>
              <span className="inline-block size-3 rounded-full ring-2 ring-white shadow" style={{ background: c.accent }} />
              <span className="ms-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-black shadow" style={{ background: c.accent }}>{c.name}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-10">
        {(serverStatus.noServer || serverStatus.serverAuthFailed) ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-acc/30 bg-acc/10 px-4 py-3 text-sm">
            <div className="flex items-center gap-2.5 text-fg">
              <Icon n="spark" s={16} className="text-acc shrink-0" />
              <span>{t(serverStatus.serverAuthFailed ? 'party_server_auth_needed' : 'party_server_needed')}</span>
            </div>
            <button
              onClick={() => {
                useSettingsStore.getState().setActivePage('relay');
                nav.go('settings');
              }}
              className="rounded-full bg-acc px-3.5 py-1.5 text-xs font-bold text-acc-ink transition hover:brightness-110"
            >
              {t('party_open_server_settings')}
            </button>
          </div>
        ) : null}
        {/* Header & Room Members */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">{t('party_hub')}</h1>
            <p className="mt-1 text-sm text-fg2">{t('party_hub_sub')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <JoinFriendModal open={joinOpen} onClose={() => setJoinOpen(false)} />
            {room?.code?.code && room.code.exp > Date.now() ? (
              <span dir="ltr" data-testid="party-active-code" className="rounded-full bg-white/8 px-3 py-1 font-mono text-xs font-bold tracking-wider text-fg ring-1 ring-white/15">
                {room.code.code}
              </span>
            ) : null}
            <button
              type="button"
              data-testid="party-copy-invite-btn"
              disabled={inviteBusy}
              onClick={async () => {
                setInviteBusy(true);
                try {
                  const res = await invoke<{ ok?: boolean; code?: string | null; inviteUrl?: string; myId?: string } | null>('host:code', { revoke: false, roomMode: 'cinema' }).catch(() => null);
                  let targetUrl = res?.inviteUrl || '';
                  if (!targetUrl) {
                    const fallbackId = res?.myId || room?.myId || room?.members.find((m) => m.isHost)?.id || (await invoke<{ id?: string }>('state').catch(() => null))?.id || '';
                    if (fallbackId) targetUrl = await invoke<string>('invite', fallbackId).catch(() => `majlis://join/${fallbackId}`);
                  }
                  if (!targetUrl) return;
                  await invoke('copy', targetUrl).catch(() => {});
                  await navigator.clipboard?.writeText(targetUrl).catch(() => {});
                  qc.invalidateQueries({ queryKey: ['social-room'] });
                  toast(t(res?.code ? 'party_invite_copied' : 'party_invite_id_copied'));
                } finally {
                  setInviteBusy(false);
                }
              }}
              className="flex items-center gap-1.5 rounded-full bg-acc/15 px-3.5 py-1.5 text-xs font-semibold text-acc ring-1 ring-acc/35 hover:bg-acc hover:text-acc-ink disabled:opacity-50"
            >
              <Icon n="share" s={14} /><span>{t('party_copy_invite')}</span>
            </button>
            <button
              type="button"
              data-testid="party-join-btn"
              onClick={() => setJoinOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-fg ring-1 ring-white/15 hover:bg-white/20"
            >
              <Icon n="users" s={14} /><span>{t('join_friend')}</span>
            </button>
            {room?.members.length ? (
              <>
                <span className="text-xs font-semibold uppercase tracking-wider text-fg3">{t('party_members')}</span>
                {room.members.map((m) => (
                  <button key={m.id} onClick={() => nav.open({ kind: 'friend', id: m.id })}
                    className="flex items-center gap-2 rounded-full bg-bg1 py-1 pe-3 ps-1 ring-1 transition hover:bg-bg2"
                    style={{ borderColor: m.accent, boxShadow: `0 0 0 1px color-mix(in srgb, ${m.accent} 40%, transparent)` }}>
                    <SocialAvatar avatar={m.avatar} name={m.name} accent={m.accent} size={28} />
                    <span className="text-xs font-semibold" style={{ color: m.accent }}>{m.name}</span>
                    {m.isHost ? <Icon n="star" s={12} className="text-acc" /> : null}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        </div>

        {/* Live Ready Check Status Card */}
        {(room?.readyState?.active || (room?.readyState?.peers && room.readyState.peers.length > 0) || room?.role) ? (() => {
          const rs = room?.readyState;
          const peers = rs?.peers || [];
          const myReady = room?.role === 'guest'
            ? (peers.find((p) => p.id === room?.myId)?.ready ?? guestReadyLocal)
            : !!rs?.hostReady;
          return (
            <div data-testid="party-ready-card" className="glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 ring-1 ring-acc/25">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg">
                  <span>{t('party_ready_card_title')}</span>
                  {rs?.active ? <span className="rounded-full bg-acc/20 px-2 py-0.5 text-[10px] font-bold text-acc">{t('party_ready_waiting_all')}</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {peers.map((p) => (
                    <span
                      key={p.id}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        p.ready ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/35' : 'bg-white/8 text-fg2'
                      }`}
                    >
                      {p.isHost ? <Icon n="star" s={11} className="text-acc" /> : null}
                      <span>{p.name}</span>
                      <span>{p.ready ? '✓' : '…'}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {room?.role !== 'guest' ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => { await invoke('ready:check').catch(() => {}); qc.invalidateQueries({ queryKey: ['social-room'] }); }}
                      className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink"
                    >
                      {t('party_ready_check')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => { await invoke('ready:go').catch(() => {}); qc.invalidateQueries({ queryKey: ['social-room'] }); }}
                      className="rounded-full bg-acc/20 px-3.5 py-1.5 text-xs font-bold text-acc hover:bg-acc hover:text-acc-ink"
                    >
                      {t('party_countdown')}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid="party-ready-toggle-btn"
                  onClick={async () => {
                    const next = !myReady;
                    if (room?.role === 'guest') setGuestReadyLocal(next);
                    await invoke('ready:ack', next).catch(() => {});
                    qc.invalidateQueries({ queryKey: ['social-room'] });
                  }}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                    myReady
                      ? 'bg-emerald-500 text-black ring-1 ring-emerald-300'
                      : 'bg-acc text-acc-ink hover:brightness-110'
                  }`}
                >
                  {myReady ? t('party_ready_toggle_on') : t('party_ready_yes')}
                </button>
              </div>
            </div>
          );
        })() : null}

        {/* 1-Click Saved Room Presets & Host Quick Controls + Watch Together URL */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="glass rounded-2xl p-4 lg:col-span-2 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-fg2">{t('party_presets_title')}</div>
              {room?.role === 'host' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button onClick={() => invoke('ready:check').catch(() => {})} className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold hover:bg-acc hover:text-acc-ink">
                    {t('party_ready_check')}
                  </button>
                  <button onClick={() => invoke('ready:go').catch(() => {})} className="rounded-full bg-acc/20 px-3 py-1 text-[11px] font-bold text-acc hover:bg-acc hover:text-acc-ink">
                    {t('party_countdown')}
                  </button>
                  <select
                    value={room.control?.mode || 'host'}
                    onChange={(e) => {
                      const m = e.target.value as 'host' | 'guest' | 'all';
                      const firstGuest = room.members.find((x) => !x.isHost)?.id || null;
                      setRemote(m, m === 'guest' ? (room.control?.holderId || firstGuest) : null);
                    }}
                    className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-fg"
                    aria-label={t('party_remote_label')}
                  >
                    <option value="host">{t('party_remote_host')}</option>
                    <option value="guest">{t('party_remote_friend')}</option>
                    <option value="all">{t('party_remote_all')}</option>
                  </select>
                  {room.control?.mode === 'guest' && room.members.some((x) => !x.isHost) ? (
                    <select
                      value={room.control.holderId || ''}
                      onChange={(e) => setRemote('guest', e.target.value)}
                      className="rounded-full bg-acc/20 px-2.5 py-1 text-[11px] font-semibold text-acc"
                    >
                      {room.members.filter((x) => !x.isHost).map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(presetsQ.data || []).map((p) => {
                const label = lang === 'ar' && p.nameAr ? p.nameAr : p.name;
                return (
                  <div key={p.id} className="inline-flex items-center overflow-hidden rounded-full bg-white/8 ring-1 ring-white/15">
                    <button onClick={() => launchPreset(p.id, label)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-fg transition hover:bg-acc hover:text-acc-ink">
                      <Icon n={(p.icon as 'film' | 'users' | 'play') || 'sparkle'} s={13} />
                      <span>{label}</span>
                    </button>
                    {!p.builtin ? (
                      <button onClick={() => deletePreset(p.id)} aria-label={t('dismiss')}
                        className="px-2 py-1.5 text-fg3 hover:bg-red-500/20 hover:text-red-300">
                        <Icon n="x" s={11} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <form onSubmit={savePreset} className="flex flex-1 min-w-[200px] items-center gap-1.5">
                <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t('party_preset_name_ph')}
                  className="min-w-0 flex-1 rounded-full bg-white/6 px-3 py-1.5 text-xs ring-1 ring-line focus:ring-acc" />
                <button type="submit" disabled={!presetName.trim()} className="rounded-full bg-white/12 px-3 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink disabled:opacity-40">
                  {t('party_preset_save')}
                </button>
              </form>
            </div>
          </div>

          <form onSubmit={watchUrlTogether} className="glass flex flex-col justify-between gap-2 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-fg2">{t('party_watch_url_title')}</span>
              <button type="button" onClick={() => setQueueOpen(true)} className="rounded-full bg-acc/15 px-2.5 py-0.5 text-[11px] font-semibold text-acc hover:bg-acc hover:text-acc-ink">
                {t('queue_n', { n: queueItems.length })}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={watchUrl} onChange={(e) => setWatchUrl(e.target.value)} placeholder={t('party_watch_url_ph')}
                className="min-w-0 flex-1 rounded-full bg-white/6 px-3.5 py-2 text-xs ring-1 ring-line focus:ring-acc" />
              <button type="submit" disabled={!watchUrl.trim()} className="rounded-full bg-acc px-3.5 py-2 text-xs font-bold text-acc-ink hover:brightness-110 disabled:opacity-40">
                {t('party_watch_url_btn')}
              </button>
            </div>
          </form>
        </div>

        {/* Quick Search-to-Nominate + Live Party Chat */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl bg-bg1 p-4 ring-1 ring-line lg:col-span-2">
            <div className="flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 ring-1 ring-line focus-within:ring-acc">
              <Icon n="search" s={16} className="text-fg3" />
              <input value={nomQ} onChange={(e) => setNomQ(e.target.value)} placeholder={t('nominate_search_ph')} className="flex-1 text-sm" />
              {nomQ ? <button onClick={() => setNomQ('')}><Icon n="x" s={15} /></button> : null}
            </div>
            {searchHits.length ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {searchHits.map((it: Preview) => (
                  <div key={`${it.type}-${it.id}`} className="flex items-center gap-2.5 rounded-xl bg-bg2 p-2 ring-1 ring-line">
                    <Img srcs={[it.poster]} className="h-12 w-8 flex-none rounded object-cover" fallback={<div className="h-12 w-8 rounded bg-bg3" />} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{it.name}</div>
                      <button onClick={() => nominate(it)} className="mt-1 rounded-full bg-acc/20 px-2.5 py-0.5 text-[11px] font-semibold text-acc hover:bg-acc hover:text-acc-ink">
                        + {t('vote_nominate')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <form onSubmit={sendChat} className="flex flex-col justify-between rounded-2xl bg-bg1 p-4 ring-1 ring-line">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg3">
              <Icon n="chat" s={14} className="text-acc" />{t('party_chat')}
            </div>
            <div className="mb-2 max-h-28 space-y-1 overflow-y-auto text-xs">
              {(room?.chat || []).slice(-6).map((c) => (
                <div key={c.id} className="leading-snug">
                  <span className="font-bold" style={{ color: c.accent }}>{c.from}: </span>
                  <span dir="auto" className="text-fg2">{c.text}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder={t('party_chat_ph')}
                className="min-w-0 flex-1 rounded-full bg-white/6 px-3.5 py-1.5 text-xs ring-1 ring-line focus:ring-acc" />
              <button type="submit" className="rounded-full bg-fg px-3.5 py-1.5 text-xs font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('send_msg')}</button>
            </div>
          </form>
        </div>

        {/* Section 1: Voting & Head-to-Head Comparison Matrix */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">{t('compare_matrix')}</h2>
            <span className="flex-1" />
            {voteItems.length && isHost ? (
              <>
                <button onClick={async () => { const w = await invoke<{ id: string; type: string; name: string } | null>('vote:winner'); if (w) smartPlay(w.type, w.id, { name: w.name }); }}
                  className="flex items-center gap-1.5 rounded-full bg-acc px-4 py-2 text-sm font-semibold text-acc-ink hover:brightness-110">
                  <Icon n="play" s={15} />{t('vote_winner')}
                </button>
                <button onClick={async () => { await invoke('vote:clear'); qc.invalidateQueries({ queryKey: ['social-room'] }); }}
                  className="rounded-full bg-white/8 px-4 py-2 text-sm text-fg2 hover:bg-white/15">
                  {t('vote_clear')}
                </button>
              </>
            ) : null}
          </div>

          {!voteItems.length ? (
            <div className="rounded-2xl bg-bg1 p-8 text-center text-sm text-fg2 ring-1 ring-line">{t('compare_empty')}</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-bg1 ring-1 ring-line">
              <table className="w-full min-w-[680px] border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-line bg-bg2/60">
                    <th className="w-44 p-4 text-start text-xs font-semibold uppercase tracking-wider text-fg3">{t('vote_title')}</th>
                    {(cmp?.columns || voteItems.map((v): CompareColumn => ({ id: v.id, type: v.type, name: v.name, poster: v.poster, by: v.by ?? null, votes: v.votes, voters: v.voters, ratings: { imdb: null, rt: null, letterboxd: null, mal: null }, audience: null, year: null, released: null, genres: [], certification: null, runtime: null, runtimeMin: null, watchedBy: [] }))).map((col) => (
                      <th key={col.id} className="min-w-[180px] p-4 align-top">
                        <div className="flex items-start gap-3">
                          <button onClick={() => nav.open({ kind: 'title', type: col.type, id: col.id })} className="h-20 w-14 flex-none overflow-hidden rounded-lg bg-bg3 ring-1 ring-line hover:ring-acc">
                            <Img srcs={[col.poster]} className="h-full w-full object-cover" />
                          </button>
                          <div className="min-w-0 flex-1 text-start">
                            <button onClick={() => nav.open({ kind: 'title', type: col.type, id: col.id })} className="clamp-2 text-sm font-bold hover:text-acc">{col.name}</button>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className="rounded-full bg-acc/20 px-2 py-0.5 text-[11px] font-semibold text-acc">{t('vote_count', { n: col.votes })}</span>
                              {col.voters.map((vr) => (
                                <span key={vr} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: memberAccent(vr), background: `color-mix(in srgb, ${memberAccent(vr)} 18%, transparent)` }}>{vr}</span>
                              ))}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <button onClick={() => castVote(col.id)} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-acc hover:text-acc-ink">{t('vote_cast')}</button>
                              <button onClick={() => smartPlay(col.type, col.id)} className="rounded-full bg-fg px-2.5 py-1 text-[11px] font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('play')}</button>
                              <button onClick={() => openSimilar(col)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${simFor === col.id ? 'bg-acc text-acc-ink' : 'bg-white/10 text-fg2 hover:bg-white/20'}`}>{t('vote_similar')}</button>
                              <button onClick={() => { enqueueItem({ id: col.id, type: col.type, name: col.name, poster: col.poster }); toast(t('queue_added')); }}
                                className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-fg2 hover:bg-white/20" title={t('ctx_add_queue')}>+</button>
                            </div>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                {cmp?.columns.length ? (
                  <tbody className="divide-y divide-line">
                    <CompareRow label={t('row_imdb')} cols={cmp.columns} render={(c) => <Val hi={isBest('imdb', c.id)} text={c.ratings.imdb ? `★ ${c.ratings.imdb.toFixed(1)}` : '—'} />} />
                    <CompareRow label={t('row_rt')} cols={cmp.columns} render={(c) => <Val hi={isBest('rt', c.id)} text={c.ratings.rt != null ? `${c.ratings.rt}%` : '—'} />} />
                    <CompareRow label={t('row_lb')} cols={cmp.columns} render={(c) => <Val hi={isBest('letterboxd', c.id)} text={c.ratings.letterboxd != null ? `${c.ratings.letterboxd.toFixed(1)} / 5` : '—'} />} />
                    <CompareRow label={t('row_mal')} cols={cmp.columns} render={(c) => <Val hi={isBest('mal', c.id)} text={c.ratings.mal != null ? c.ratings.mal.toFixed(1) : '—'} />} />
                    <CompareRow label={t('row_audience')} cols={cmp.columns} render={(c) => <Val hi={isBest('audience', c.id)} text={fmtAud(c.audience)} />} />
                    <CompareRow label={t('row_year')} cols={cmp.columns} render={(c) => <Val hi={isBest('year', c.id)} text={c.released || (c.year ? String(c.year) : '—')} />} />
                    <CompareRow label={t('row_runtime')} cols={cmp.columns} render={(c) => <Val hi={isBest('runtimeMin', c.id)} text={c.runtime || (c.runtimeMin ? t('min', { n: c.runtimeMin }) : '—')} />} />
                    <CompareRow label={t('row_cert')} cols={cmp.columns} render={(c) => <span dir="ltr" className="rounded border border-line px-1.5 py-0.5 text-xs">{c.certification || '—'}</span>} />
                    <CompareRow label={t('row_genres')} cols={cmp.columns} render={(c) => (
                      <div className="flex flex-wrap gap-1">
                        {c.genres.slice(0, 4).map((g) => (
                          <span key={g} className={`rounded-full px-2 py-0.5 text-[11px] ${cmp.highlights.sharedGenres.includes(g) ? 'bg-acc/20 text-acc font-semibold' : 'bg-white/6 text-fg2'}`}>{genreLabel(g, lang)}</span>
                        ))}
                      </div>
                    )} />
                    <CompareRow label={t('row_friends_saw')} cols={cmp.columns} render={(c) => {
                      const watchers = c.watchedBy.filter((w) => w.watched || w.rating);
                      if (!watchers.length) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">{t('fresh_for_all')}</span>;
                      return (
                        <div className="space-y-1.5">
                          {watchers.map((w) => {
                            const rKey = `${c.id}:${w.id}`;
                            return (
                              <div key={w.id} className="rounded-lg bg-bg2 p-2 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <SocialAvatar avatar={w.avatar} name={w.name} accent={w.accent} size={20} ring={false} />
                                  <span className="font-semibold" style={{ color: w.accent }}>{w.name}</span>
                                  {w.rating ? <span className="ms-auto font-mono text-acc">{'★'.repeat(Math.round(w.rating))}</span> : null}
                                </div>
                                {w.review ? (
                                  revealed.has(rKey)
                                    ? <p dir="auto" className="mt-1 text-[11px] text-fg2">{w.review}</p>
                                    : <button onClick={() => setRevealed((s) => new Set(s).add(rKey))} className="mt-1 text-[11px] text-acc hover:underline">{t('what_said')}</button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }} />
                  </tbody>
                ) : null}
              </table>
            </div>
          )}

          {simFor ? (
            <div className="rounded-2xl bg-bg1 p-4 ring-1 ring-acc/35">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-acc">{t('vote_similar_title')}</h3>
                <button onClick={() => setSimFor(null)} className="text-fg3 hover:text-fg"><Icon n="x" s={14} /></button>
              </div>
              {simLoading ? <div className="text-xs text-fg3">{t('th_sub_searching')}</div> : !simAlts.length ? (
                <div className="text-xs text-fg3">{t('vote_similar_empty')}</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {simAlts.slice(0, 6).map((alt) => (
                    <div key={alt.id} className="flex flex-col gap-1.5 rounded-xl bg-bg2 p-2 ring-1 ring-line">
                      <button onClick={() => nav.open({ kind: 'title', type: alt.type, id: alt.id })} className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-bg3">
                        <Img srcs={[alt.poster]} className="h-full w-full object-cover" />
                      </button>
                      <div dir="auto" className="truncate text-xs font-semibold">{alt.name}</div>
                      <button onClick={() => { nominate(alt); setSimAlts((cur) => cur.filter((x) => x.id !== alt.id)); }}
                        className="mt-auto rounded-full bg-acc/20 py-1 text-[11px] font-semibold text-acc hover:bg-acc hover:text-acc-ink">
                        + {t('vote_nominate')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {queueItems.length ? (
            <div className="rounded-2xl bg-bg1 p-4 ring-1 ring-line space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-fg">{t('party_queue_tab')} · {queueItems.length}</h3>
                <button onClick={clearQueue} className="rounded-full bg-white/8 px-3 py-1 text-[11px] text-fg2 hover:bg-red-500/20 hover:text-red-300">
                  {t('queue_clear')}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {queueItems.map((q, idx) => (
                  <div key={q.key} className="flex items-center gap-2.5 rounded-xl bg-bg2 p-2 ring-1 ring-line">
                    <span className="font-mono text-xs text-fg3">{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div dir="auto" className="truncate text-xs font-semibold text-fg">{q.name}</div>
                      {q.epLabel ? <div dir="ltr" className="font-mono text-[10.5px] text-acc">{q.epLabel}</div> : null}
                    </div>
                    <button onClick={() => { removeQueueItem(q.key); smartPlay(q.type, q.id, { name: q.name, poster: q.poster }); }}
                      className="rounded-full bg-acc px-2 py-1 text-[10.5px] font-bold text-acc-ink">▶</button>
                    <button disabled={idx === 0} onClick={() => moveQueueItem(idx, idx - 1)} className="rounded bg-white/8 px-1.5 py-0.5 text-[10.5px] disabled:opacity-30">↑</button>
                    <button disabled={idx === queueItems.length - 1} onClick={() => moveQueueItem(idx, idx + 1)} className="rounded bg-white/8 px-1.5 py-0.5 text-[10.5px] disabled:opacity-30">↓</button>
                    <button onClick={() => removeQueueItem(q.key)} className="text-fg3 hover:text-red-300"><Icon n="x" s={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Section 2: "Can't Decide?" Group Taste Matcher + Quick Swipe + Tie-Breaker Wheel */}
        <section className="space-y-6 rounded-3xl bg-bg1 p-6 ring-1 ring-line sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-acc"><Icon n="sparkle" s={20} /><span className="text-xs font-bold uppercase tracking-wider">{t('unwatched_by_all')}</span></div>
              <h2 className="mt-1 text-2xl font-bold">{t('cant_decide')}</h2>
              <p className="mt-1 text-sm text-fg2">{t('cant_decide_sub')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={startSwipe} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
                <Icon n="bolt" s={16} className="text-acc" />{t('start_swipe')}
              </button>
              <button onClick={spinWheel} disabled={spinning || (!voteItems.length && !picks.length)}
                className="flex items-center gap-1.5 rounded-full bg-acc px-4 py-2 text-sm font-semibold text-acc-ink hover:brightness-110 disabled:opacity-50">
                <Icon n="dice" s={16} />{spinning ? t('spinning') : t('spin_wheel')}
              </button>
            </div>
          </div>

          {/* Interactive Group Filters */}
          <div className="space-y-3 border-y border-line py-4 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-2 font-semibold text-fg3">{t('mood_label')}:</span>
              {MOODS.map((m) => (
                <button key={m.id} onClick={() => setFilters((f) => ({ ...f, mood: m.id || undefined }))}
                  className={`rounded-full px-3 py-1 transition ${(filters.mood || '') === m.id ? 'bg-fg text-bg font-semibold' : 'bg-white/6 text-fg2 hover:bg-white/12'}`}>
                  {t(m.key)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 font-semibold text-fg3">{t('max_runtime')}:</span>
                {([undefined, 90, 120, 150] as const).map((rt) => (
                  <button key={String(rt)} onClick={() => setFilters((f) => ({ ...f, maxRuntime: rt }))}
                    className={`rounded-full px-3 py-1 transition ${filters.maxRuntime === rt ? 'bg-fg text-bg font-semibold' : 'bg-white/6 text-fg2 hover:bg-white/12'}`}>
                    {rt ? t('min', { n: rt }) : t('runtime_any')}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 font-semibold text-fg3">{t('era_label')}:</span>
                {ERAS.map((era) => (
                  <button key={era.id} onClick={() => setFilters((f) => ({ ...f, era: era.id || undefined }))}
                    className={`rounded-full px-3 py-1 transition ${(filters.era || '') === era.id ? 'bg-fg text-bg font-semibold' : 'bg-white/6 text-fg2 hover:bg-white/12'}`}>
                    {t(era.key)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-1 font-semibold text-fg3">{t('genres_label')}:</span>
              <button
                onClick={() => setFilters((f) => ({ ...f, genres: undefined, genre: undefined }))}
                className={`rounded-full px-3 py-1 transition ${!(filters.genres?.length) ? 'bg-fg text-bg font-semibold' : 'bg-white/6 text-fg2 hover:bg-white/12'}`}
              >
                {t('genres_all')}
              </button>
              {CANONICAL_GENRES.map((g) => {
                const active = (filters.genres || []).includes(g.id);
                return (
                  <button key={g.id} onClick={() => setFilters((f) => {
                    const cur = f.genres || [];
                    const next = cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id];
                    return { ...f, genres: next.length ? next : undefined, genre: undefined };
                  })}
                    className={`rounded-full px-3 py-1 transition ${active ? 'bg-acc text-acc-ink font-semibold' : 'bg-white/6 text-fg2 hover:bg-white/12'}`}>
                    {lang === 'ar' ? g.ar : g.en}
                  </button>
                );
              })}
              {filters.genres?.length ? (
                <>
                  <span className="ms-1 rounded-full bg-acc/15 px-2.5 py-0.5 text-[11px] font-semibold text-acc">
                    {t('genres_selected_n', { n: filters.genres.length })}
                  </span>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, genres: undefined, genre: undefined }))}
                    className="rounded-full px-2 py-0.5 text-[11px] text-fg3 hover:bg-white/10 hover:text-fg"
                  >
                    {t('genres_clear')}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {tasteQ.data?.fallbackHint && tasteQ.data.fallbackHint !== 'exact' ? (
            <div className="flex items-center gap-2 rounded-2xl bg-acc/10 px-4 py-2.5 text-xs text-acc ring-1 ring-acc/25">
              <Icon n="info" s={15} />
              <span>{t(tasteQ.data.fallbackHint === 'partial' ? 'taste_fallback_partial' : 'taste_fallback_relaxed')}</span>
            </div>
          ) : null}

          {/* 5 Unseen Tailored Picks */}
          {tasteQ.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="skel h-72 rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {picks.map((p) => (
                <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl bg-bg2 ring-1 ring-line transition hover:ring-acc/60">
                  <button onClick={() => nav.open({ kind: 'title', type: p.type, id: p.id })} className="relative aspect-[2/3] w-full overflow-hidden bg-bg3">
                    <Img srcs={[p.poster]} className="h-full w-full object-cover" />
                    <span className="absolute start-2 top-2 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-bold text-acc backdrop-blur-md">
                      {t('match_pct', { n: p.matchPct })}
                    </span>
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="clamp-2 text-sm font-bold">{p.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.memberScores.map((ms) => (
                        <span key={ms.id} title={`${ms.name}: ${ms.pct}%`} className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ color: ms.accent, background: `color-mix(in srgb, ${ms.accent} 16%, transparent)` }}>
                          <span className="size-1.5 rounded-full" style={{ background: ms.accent }} />{ms.pct}%
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px] text-fg3">
                      {(p.reasons.genres.length ? p.reasons.genres : (p.genres || [])).slice(0, 3).map((g) => (
                        <span key={g} className="rounded bg-white/6 px-1.5 py-0.5">{genreLabel(g, lang)}</span>
                      ))}
                      {p.reasons.decade ? <span dir="ltr" className="rounded bg-white/6 px-1.5 py-0.5">{p.reasons.decade}</span> : null}
                    </div>
                    <div className="mt-auto flex items-center gap-1.5 pt-1">
                      <button onClick={() => nominate(p)} className="flex-1 rounded-full bg-white/10 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink">{t('vote_nominate')}</button>
                      <button onClick={() => { enqueueItem({ id: p.id, type: p.type, name: p.name, poster: p.poster }); toast(t('queue_added')); }}
                        className="rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20" title={t('ctx_add_queue')}>+</button>
                      <button onClick={() => smartPlay(p.type, p.id)} className="rounded-full bg-fg px-3 py-1.5 text-xs font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('play')}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Swipe (30s) + Tie-Breaker Wheel */}
          {swipe || wheel ? (
            <div className="grid grid-cols-1 gap-6 border-t border-line pt-6 lg:grid-cols-2">
              {swipe ? (
                <div className="rounded-2xl bg-bg2 p-5 ring-1 ring-line">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold">{t('quick_swipe')}</h3>
                      <p className="text-xs text-fg3">{t('quick_swipe_sub')}</p>
                    </div>
                    <span dir="ltr" className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${swipeActive ? 'bg-acc/20 text-acc' : 'bg-white/10 text-fg3'}`}>
                      {t('swipe_time_left', { n: swipeSecLeft })}
                    </span>
                  </div>
                  {currentSwipe && swipeActive ? (
                    <div className="flex flex-col items-center gap-4 sm:flex-row">
                      <Img srcs={[currentSwipe.poster]} className="h-44 w-30 flex-none rounded-xl bg-bg3 object-cover ring-1 ring-line" />
                      <div className="min-w-0 flex-1 space-y-2 text-center sm:text-start">
                        <div className="text-lg font-bold">{currentSwipe.name}</div>
                        <div className="flex flex-wrap justify-center gap-1.5 text-xs text-fg2 sm:justify-start">
                          {currentSwipe.year ? <span>{currentSwipe.year}</span> : null}
                          {currentSwipe.imdbRating ? <span className="font-mono text-[#f5c518]">★ {currentSwipe.imdbRating}</span> : null}
                          {currentSwipe.genres.map((g) => <span key={g} className="rounded bg-white/8 px-2 py-0.5">{genreLabel(g, lang)}</span>)}
                        </div>
                        <div className="flex justify-center gap-2 pt-2 sm:justify-start">
                          <button onClick={() => voteSwipe(false)} className="rounded-full bg-white/10 px-5 py-2 text-sm font-semibold hover:bg-red-500/20 hover:text-red-300">{t('swipe_pass')}</button>
                          <button onClick={() => voteSwipe(true)} className="rounded-full bg-acc px-5 py-2 text-sm font-semibold text-acc-ink hover:brightness-110">{t('swipe_like')}</button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {swipe.matches.length ? (
                    <div className="mt-4 space-y-2 border-t border-line pt-3">
                      <div className="text-xs font-bold text-acc">{t('swipe_matches')}</div>
                      <div className="flex flex-wrap gap-2">
                        {swipe.matches.map((m) => (
                          <button key={m.id} onClick={() => nominate(m)} className="flex items-center gap-2 rounded-full bg-acc/15 px-3 py-1.5 text-xs font-semibold text-acc ring-1 ring-acc/40 hover:bg-acc hover:text-acc-ink">
                            <span>{m.name}</span><span>+</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {wheel ? <TieBreakerWheel wheel={wheel} spinning={spinning} onPlay={() => smartPlay(wheel.winner.type, wheel.winner.id)} /> : null}
            </div>
          ) : null}
        </section>

        {/* Majlis Wrapped · Party Stats */}
        <section className="glass rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-fg">{t('party_wrapped_title')}</h2>
            <div className="flex rounded-full bg-white/8 p-0.5 text-xs">
              {(['month', 'all'] as const).map((r) => (
                <button key={r} onClick={() => setWrappedRange(r)}
                  className={`rounded-full px-3 py-1 font-semibold transition ${wrappedRange === r ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
                  {t(r === 'month' ? 'party_wrapped_month' : 'party_wrapped_all')}
                </button>
              ))}
            </div>
          </div>
          {wrappedQ.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
                  <div className="text-[11px] text-fg2">{t('party_hours_together')}</div>
                  <div dir="ltr" className="mt-1 font-mono text-2xl font-bold text-acc">
                    {(wrappedQ.data.totalMinutes / 60).toFixed(1)}h
                  </div>
                </div>
                <div className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
                  <div className="text-[11px] text-fg2">{t('party_sessions_n')}</div>
                  <div dir="ltr" className="mt-1 font-mono text-2xl font-bold text-fg">
                    {wrappedQ.data.totalSessions}
                  </div>
                </div>
                <div className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
                  <div className="text-[11px] text-fg2">{t('party_avg_rating')}</div>
                  <div dir="ltr" className="mt-1 font-mono text-2xl font-bold text-emerald-300">
                    {wrappedQ.data.avgGroupRating != null ? `${wrappedQ.data.avgGroupRating}/10` : '—'}
                  </div>
                </div>
              </div>

              {wrappedQ.data.topGenres.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-fg2">{t('party_top_genres')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {wrappedQ.data.topGenres.map((g) => (
                      <span key={g.genre} className="rounded-full bg-acc/15 px-3 py-1 text-xs font-semibold text-acc ring-1 ring-acc/30">
                        {genreLabel(g.genre, lang === 'en' ? 'en' : 'ar')} · {g.sessions}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {wrappedQ.data.topBuddies.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-fg2">{t('party_top_buddies')}</div>
                  <div className="flex flex-wrap gap-2">
                    {wrappedQ.data.topBuddies.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-full bg-white/6 px-3 py-1 text-xs ring-1 ring-white/10">
                        <SocialAvatar name={b.name} avatar={b.avatar} accent={b.accent} size={22} />
                        <span className="font-semibold text-fg">{b.name}</span>
                        <span dir="ltr" className="font-mono text-[11px] text-fg2">{t('th_min_short', { n: Math.round(b.minutes) })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {wrappedQ.data.milestones.length ? (
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-fg2">{t('party_milestones')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {wrappedQ.data.milestones.map((m) => (
                      <span key={m} className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-fg">🏅 {MILESTONE_KEY[m] ? t(MILESTONE_KEY[m]) : m}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Watch Party History Archive */}
        <section className="glass rounded-2xl p-5">
          <h2 className="mb-4 text-base font-bold text-fg">{t('party_history_title')}</h2>
          {!(historyQ.data || []).length ? (
            <p className="rounded-xl bg-white/4 p-4 text-sm text-fg2">{t('party_history_empty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(historyQ.data || []).map((item) => (
                <div key={item.id} className="flex items-start gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  {item.poster ? (
                    <Img srcs={[item.poster]} className="h-20 w-14 flex-none rounded-lg bg-black/40 object-cover" />
                  ) : (
                    <div className="grid h-20 w-14 flex-none place-items-center rounded-lg bg-white/8 text-fg3">
                      <Icon n="film" s={18} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div dir="auto" className="truncate text-sm font-bold text-fg">{item.title}</div>
                      <button onClick={() => delHistory(item.id)} title={t('dismiss')}
                        className="grid size-6 flex-none place-items-center rounded-full bg-white/8 text-fg3 hover:bg-red-500/20 hover:text-red-300">
                        <Icon n="x" s={12} />
                      </button>
                    </div>
                    <div dir="ltr" className="font-mono text-[11px] text-fg2">
                      {fmtLocaleDate(item.startedAt, lang)} · {t('th_min_short', { n: Math.max(1, Math.round((item.watchedMs || 0) / 60000)) })}
                      {item.groupRating != null ? ` · ★ ${item.groupRating}/10` : ''}
                    </div>
                    {item.attendees.length ? (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.attendees.map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-[10.5px] text-fg">
                            <span className="size-1.5 rounded-full" style={{ background: a.accent || 'var(--c-acc)' }} />
                            {a.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.notes && item.notes.length ? (
                      <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5 text-[11px]">
                        <div className="font-semibold text-acc">{t('party_notes')} ({item.notes.length})</div>
                        {item.notes.slice(0, 3).map((n) => (
                          <div key={n.id} className="flex items-center gap-1.5 truncate text-fg2">
                            <span dir="ltr" className="font-mono text-[10px] text-acc">{Math.floor(n.t / 60)}:{String(Math.floor(n.t % 60)).padStart(2, '0')}</span>
                            <span className="font-semibold text-fg">{n.authorName}:</span>
                            <span dir="auto" className="truncate">{n.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CompareRow({ label, cols, render }: { label: string; cols: CompareColumn[]; render: (c: CompareColumn) => React.ReactNode }) {
  return (
    <tr className="hover:bg-white/[0.02]">
      <td className="p-4 font-semibold text-fg2">{label}</td>
      {cols.map((c) => <td key={c.id} className="p-4 align-top">{render(c)}</td>)}
    </tr>
  );
}

function Val({ hi, text }: { hi: boolean; text: string }) {
  const t = useT();
  return (
    <span dir="ltr" className={`inline-flex items-center gap-1.5 font-mono ${hi ? 'font-bold text-acc' : 'text-fg'}`}>
      <span>{text}</span>
      {hi && text !== '—' ? <span className="rounded-full bg-acc/20 px-1.5 py-0.5 font-sans text-[10px] font-bold text-acc">{t('best_in_row')}</span> : null}
    </span>
  );
}

function TieBreakerWheel({ wheel, spinning, onPlay }: { wheel: NonNullable<ReturnType<typeof useSocialRoom>['data']>['wheel']; spinning: boolean; onPlay: () => void }) {
  const t = useT();
  if (!wheel) return null;
  const n = wheel.items.length || 1;
  const r = 100, cx = 110, cy = 110;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-bg2 p-5 ring-1 ring-line">
      <div className="flex w-full items-center justify-between">
        <h3 className="text-lg font-bold">{t('tie_wheel')}</h3>
        {!spinning ? (
          <button onClick={onPlay} className="rounded-full bg-acc px-4 py-1.5 text-xs font-semibold text-acc-ink hover:brightness-110">
            {t('play')} · {wheel.winner.name}
          </button>
        ) : null}
      </div>
      <div className="relative flex items-center justify-center">
        <div className="absolute -top-2 z-10 size-0 border-x-8 border-t-[14px] border-x-transparent border-t-fg drop-shadow" />
        <svg viewBox="0 0 220 220" className="size-52 drop-shadow-xl"
          style={{ transform: `rotate(${wheel.angle}deg)`, transition: 'transform 4.2s cubic-bezier(0.12, 0.88, 0.18, 1)' }}>
          {wheel.items.map((item, i) => {
            const a0 = ((i * 2 * Math.PI) / n) - Math.PI / 2;
            const a1 = (((i + 1) * 2 * Math.PI) / n) - Math.PI / 2;
            const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
            const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
            const d = n === 1 ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z` : `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`;
            const mid = ((a0 + a1) / 2) * (180 / Math.PI) + 90;
            return (
              <g key={item.id + i}>
                <path d={d} fill={WHEEL_COLS[i % WHEEL_COLS.length]} stroke="var(--c-bg)" strokeWidth="2" />
                <text x={cx} y={cy - r * 0.56} fill="#141210" fontSize="9.5" fontWeight="700" textAnchor="middle" transform={`rotate(${mid} ${cx} ${cy})`}>
                  {item.name.slice(0, 14)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="text-sm font-semibold text-acc">{t('wheel_winner', { name: wheel.winner.name })}</div>
    </div>
  );
}
