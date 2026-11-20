import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, useNotifications, useSocialFriends, useSocialRoom, type NotifItem } from './api';
import { configureSfx, playSfx } from './utils/sfx';
import { NavCtx, bus, useHost, useT, type Nav, type Route, type Tab } from './host';
import type { Key } from './i18n';
import { Icon } from './ui/Icon';
import { Img } from './ui/Img';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { Detail } from './pages/Detail';
import { Collection } from './pages/Collection';
import { Discover } from './pages/Discover';
import { Catalogs } from './pages/Catalogs';
import { TypePage } from './pages/TypePage';
import { Anime } from './pages/Anime';
import { Calendar } from './pages/Calendar';
import { Library } from './pages/Library';
import { Collections } from './pages/Collections';
import { Addons, DeepLinkAddonModal } from './pages/Addons';
import { Downloads } from './pages/Downloads';
import { Avatar, usePrefs } from './pages/Profile';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsShell } from './settings/SettingsShell';
import { useSettingsStore } from './settings/useSettingsStore';
import { useProfileStore } from './store/useProfileStore';
import { Onboarding } from './pages/Onboarding';
import { Friends } from './pages/Friends';
import { Party } from './pages/Party';
import { Person } from './pages/Person';
import { EntityBrowse } from './pages/EntityBrowse';
import { TheaterApp } from './theater/TheaterApp';
import { CommandPalette } from './ui/CommandPalette';
import { JoinFriendModal } from './ui/JoinFriendModal';
import { PosterContextMenuHost } from './ui/PosterContextMenu';
import { PlayQueueDrawer } from './ui/PlayQueueDrawer';
import { usePlayQueueStore } from './store/usePlayQueueStore';
import { useGamepadNav } from './hooks/useGamepadNav';

// text on the accent: dark on light colours, light on dark ones
const inkFor = (hex: string) => { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#141210' : '#fff8ec'; };

// the tabs in the pill, in order (core 9 first so they stay visible; secondary tabs overflow cleanly)
const TABS: { id: Tab; label: Key; page: (active: boolean) => ReactNode }[] = [
  { id: 'home', label: 'home', page: () => <Home /> },
  { id: 'discover', label: 'discover', page: () => <Discover /> },
  { id: 'movies', label: 'movies', page: () => <TypePage type="movie" /> },
  { id: 'shows', label: 'shows', page: () => <TypePage type="series" /> },
  { id: 'anime', label: 'anime', page: () => <Anime /> },
  { id: 'library', label: 'library', page: () => <Library /> },
  { id: 'addons', label: 'addons', page: () => <Addons /> },
  { id: 'friends', label: 'friends', page: () => <Friends /> },
  { id: 'party', label: 'party', page: () => <Party /> },
  { id: 'catalogs', label: 'catalogs', page: () => <Catalogs /> },
  { id: 'calendar', label: 'calendar', page: () => <Calendar /> },
  { id: 'collections', label: 'collections', page: () => <Collections /> },
  { id: 'downloads', label: 'downloads', page: () => <Downloads /> },
];

export function App() {
  const host = useHost(), t = useT(), qc = useQueryClient();
  const prefs = usePrefs().data;
  const look = prefs?.look;
  const queueCount = usePlayQueueStore((s) => s.items.length);
  const setQueueOpen = usePlayQueueStore((s) => s.setOpen);
  const notifs = useNotifications().data || [];
  const friendsData = useSocialFriends(!host.theaterOpen).data;
  const roomData = useSocialRoom(!host.theaterOpen).data;
  const unreadNotifs = notifs.filter((n) => !n.read).length;
  const incomingReqs = (friendsData?.requests || []).filter((r) => r.direction === 'in').length;
  const partyActive = !!(roomData?.role || (roomData?.vote?.length || 0) > 0);

  const [tab, setTab] = useState<Tab>('home');
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set(['home']));
  const [stack, setStack] = useState<Route[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [updateBanner, setUpdateBanner] = useState<{ latestTag: string; releaseUrl?: string } | null>(null);
  const profilePopRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [maxVisible, setMaxVisible] = useState(TABS.length);
  const [docVisible, setDocVisible] = useState(() => document.visibilityState !== 'hidden');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const updPrefs = useSettingsStore.getState().data.updates;
    if (updPrefs.autoCheckOnStartup === false) return;
    const timer = setTimeout(() => {
      cin<{ updateAvailable?: boolean; latestTag?: string; releaseUrl?: string }>('updater-check', {
        betaChannel: !!useSettingsStore.getState().data.updates.betaChannel,
      }).then((r) => {
        if (r?.updateAvailable && r.latestTag) {
          setUpdateBanner({ latestTag: r.latestTag, releaseUrl: r.releaseUrl });
        }
      }).catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  const appStateQ = useQuery({
    queryKey: ['app-state'],
    queryFn: () => window.majlis?.invoke('state').catch(() => null) as Promise<{ id?: string; settings?: { soundEffects?: boolean; sfxMuteDuringPlayback?: boolean } } | null>,
    staleTime: 5000,
  });
  const appSfx = appStateQ.data?.settings;
  useEffect(() => {
    configureSfx({
      enabled: appSfx?.soundEffects !== false,
      muteDuringPlayback: appSfx?.sfxMuteDuringPlayback !== false,
      theaterPlaying: !!host.theaterOpen,
    });
  }, [appSfx?.soundEffects, appSfx?.sfxMuteDuringPlayback, host.theaterOpen]);

  const seenMembersRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const members = roomData?.members;
    if (!roomData?.role || !Array.isArray(members)) {
      seenMembersRef.current = null;
      return;
    }
    const cur = new Set(members.map((m) => m.id));
    if (!seenMembersRef.current) {
      seenMembersRef.current = cur;
      return;
    }
    const prev = seenMembersRef.current;
    const myId = appStateQ.data?.id;
    let joined = false;
    let left = false;
    for (const id of cur) if (!prev.has(id) && id !== myId) joined = true;
    for (const id of prev) if (!cur.has(id) && id !== myId) left = true;
    seenMembersRef.current = cur;
    if (joined) playSfx('join');
    else if (left) playSfx('leave');
  }, [roomData?.role, roomData?.members, appStateQ.data?.id]);

  const hostActive = docVisible && host.visible !== false && !host.theaterOpen;

  const go = useCallback((x: Tab) => { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); setJoinOpen(false); setStack([]); setTab(x); setSeen((s) => (s.has(x) ? s : new Set(s).add(x))); }, []);
  const open = useCallback((r: Route) => { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); setJoinOpen(false); setStack((s) => [...s, r]); }, []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const nav: Nav = useMemo(() => ({ tab, go, open, back, depth: stack.length }), [tab, go, open, back, stack.length]);

  useEffect(() => {
    const h = (e: Event) => open((e as CustomEvent<Route>).detail);
    const g = (e: Event) => go((e as CustomEvent<Tab>).detail);
    const ap = () => qc.invalidateQueries({ queryKey: ['prefs'] });
    bus.addEventListener('open', h); bus.addEventListener('go', g);
    window.addEventListener('majlis-appearance-updated', ap);
    const offMajlis = window.majlis?.on?.((m: any) => {
      if (m?.type === 'incognito') qc.invalidateQueries({ queryKey: ['prefs'] });
      else if (m?.type === 'profile-changed') qc.invalidateQueries();
      else if (m?.type === 'party-updated' || m?.type === 'ready-state') qc.invalidateQueries({ queryKey: ['social-room'] });
    });
    return () => {
      bus.removeEventListener('open', h); bus.removeEventListener('go', g);
      window.removeEventListener('majlis-appearance-updated', ap);
      offMajlis?.();
    };
  }, [open, go, qc]);

  useEffect(() => {
    if (!profileOpen) return;
    const onDown = (e: MouseEvent) => {
      if (profilePopRef.current && !profilePopRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [profileOpen]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); go('settings'); return; }
      if (e.key === 'Escape') {
        if (joinOpen) { setJoinOpen(false); return; }
        if (moreOpen || notifOpen || modeOpen || profileOpen) { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); return; }
        if (stack.length && !(e.target as HTMLElement)?.matches?.('input')) back();
      }
    };
    const mouse = (e: MouseEvent) => { if (e.button === 3 && stack.length) { e.preventDefault(); back(); } };
    window.addEventListener('keydown', key); window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); };
  }, [stack.length, back, go, moreOpen, notifOpen, modeOpen, profileOpen]);

  useGamepadNav({
    active: hostActive,
    theaterOpen: !!host.theaterOpen,
    onBack: () => {
      if (moreOpen || notifOpen || modeOpen || profileOpen) { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); return; }
      if (stack.length) back();
    },
    onCycleTab: (dir) => {
      const idx = TABS.findIndex((x) => x.id === tab);
      const base = idx >= 0 ? idx : 0;
      const next = TABS[(base + dir + TABS.length) % TABS.length];
      if (next) go(next.id);
    },
  });

  // Responsive overflow for the top pill bar on narrower windows
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1460) setMaxVisible(TABS.length);
      else if (w >= 1340) setMaxVisible(11);
      else if (w >= 1180) setMaxVisible(9);
      else if (w >= 1040) setMaxVisible(7);
      else setMaxVisible(5);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Performance hook (MAJLIS_PERF=1): scrolls rows over ~90 frames and reports rAF p50/p95/max
  useEffect(() => {
    if (!prefs?.perf) return;
    let stop = false;
    const timer = setTimeout(() => {
      const scroller = rootRef.current?.querySelector('.hscroll') as HTMLElement | null;
      if (!scroller) return;
      const dts: number[] = [];
      let prev = performance.now(), frames = 0;
      const step = (now: number) => {
        if (stop) return;
        dts.push(now - prev);
        prev = now;
        frames++;
        scroller.scrollLeft += (host.lang === 'ar' ? -14 : 14);
        if (frames < 90) requestAnimationFrame(step);
        else {
          const sorted = [...dts].sort((a, b) => a - b);
          const pick = (p: number) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);
          console.log('[MAJLIS_PERF]', JSON.stringify({ frames, p50: pick(0.5), p95: pick(0.95), max: +sorted[sorted.length - 1].toFixed(2) }));
        }
      };
      requestAnimationFrame(step);
    }, 1800);
    return () => { stop = true; clearTimeout(timer); };
  }, [prefs?.perf, host.lang]);

  const primaryTabs = TABS.slice(0, maxVisible);
  const overflowTabs = TABS.slice(maxVisible);
  const pages: { id: Tab; node: ReactNode }[] = [
    ...TABS.filter((x) => seen.has(x.id)).map((x) => ({ id: x.id, node: x.page(tab === x.id && !stack.length && hostActive) })),
    ...(seen.has('search') ? [{ id: 'search' as Tab, node: <Search active={tab === 'search' && !stack.length && hostActive} /> }] : []),
    ...(seen.has('profile') ? [{ id: 'profile' as Tab, node: <ProfilePage active={tab === 'profile' && !stack.length && hostActive} /> }] : []),
    ...(seen.has('settings') ? [{ id: 'settings' as Tab, node: <SettingsShell /> }] : []),
  ];

  const openNotif = async (n: NotifItem) => {
    setNotifOpen(false);
    if (!n.read) { await cin('notif-read', { ids: [n.id] }).catch(() => {}); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    open({ kind: 'title', type: n.type || 'series', id: n.metaId || n.id.split(':')[0] });
  };
  const markAllRead = async () => {
    await cin('notif-read', { all: true }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const tabDot = (id: Tab) => {
    if (id === 'friends' && incomingReqs > 0) return <span className="ms-1 inline-flex size-2 rounded-full bg-acc" />;
    if (id === 'party' && partyActive) return <span className="ms-1 inline-flex size-2 rounded-full bg-emerald-400" />;
    return null;
  };

  return (
    <NavCtx.Provider value={nav}>
      <div
        ref={rootRef}
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          const file = e.dataTransfer?.files?.[0];
          const filePath = file ? (window.majlis?.pathFor?.(file) || (file as File & { path?: string }).path || '') : '';
          if (filePath) {
            const r = await cin<{ ok: boolean; error?: string }>('drop-file', { filePath }).catch(() => ({ ok: false, error: 'drop_failed' }));
            if (!r?.ok) host.toast(t('drop_unsupported'));
            return;
          }
          const uri = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim();
          if (/^(magnet:\?|https?:\/\/)/i.test(uri)) {
            const r = await cin<{ ok?: boolean }>('play-url', { url: uri }).catch(() => null);
            if (!r?.ok) host.toast(t('drop_unsupported'));
            return;
          }
          host.toast(t('drop_unsupported'));
        }}
        className={host.theaterOpen ? 'cin theater-active bg-black' : 'cin'}
        data-perf={prefs?.perf ? '1' : undefined}
        data-theme={look?.theme || host.theme}
        dir={host.lang === 'ar' ? 'rtl' : 'ltr'}
        style={look?.accent ? ({ '--c-acc': look.accent, '--c-acc-ink': inkFor(look.accent) } as React.CSSProperties) : undefined}
      >
        {/* tabs stay mounted (scroll, loaded rows); GPU-only opacity/transform transition + inert offscreen & during Theater */}
        {pages.map((p) => {
          const on = !host.theaterOpen && p.id === tab && !stack.length;
          const cls = host.theaterOpen ? 'cin-page-off' : (on ? 'cin-page-on' : (p.id === tab && stack.length ? 'cin-page-under' : 'cin-page-off'));
          return <div key={p.id} className={`cin-page absolute inset-0 ${cls}`} aria-hidden={!on} inert={!on}>{p.node}</div>;
        })}
        {stack.map((r, i) => {
          const on = !host.theaterOpen && i === stack.length - 1;
          return (
            <div key={i} className={`cin-page absolute inset-0 z-20 bg-bg ${host.theaterOpen ? 'cin-page-off' : (on ? 'cin-route-on' : 'cin-route-under')}`} aria-hidden={!on} inert={!on}>
              {r.kind === 'title' ? <Detail route={r} active={on && hostActive} /> : r.kind === 'friend' ? <ProfilePage friendId={r.id} active={on && hostActive} /> : r.kind === 'person' ? <Person id={r.id} name={r.name} /> : r.kind === 'entity' ? <EntityBrowse entityType={r.entityType} id={r.id} name={r.name} /> : <Collection id={r.id} name={r.name} />}
            </div>
          );
        })}

        {!host.theaterOpen ? (
        <header
          onDoubleClick={(e) => { if (e.target === e.currentTarget) window.majlis?.invoke?.('win:maximize')?.catch(() => {}); }}
          className="app-drag pointer-events-auto absolute inset-x-0 top-0 z-30 flex h-18 items-start gap-3 bg-gradient-to-b from-bg/85 via-bg/40 to-transparent px-5 pt-4 sm:px-6"
        >
          <div className="app-no-drag relative flex flex-none items-center gap-2">
            <button onClick={() => { setMoreOpen(false); setNotifOpen(false); setModeOpen((o) => !o); }}
              className="flex items-center gap-2 rounded-full bg-black/40 px-3.5 py-2 text-sm font-medium text-fg ring-1 ring-white/15 backdrop-blur-xl transition hover:bg-white/15">
              <Icon n="film" s={16} className="text-acc" />
              <span className="hidden sm:inline">{t('switch_mode')}</span>
              <Icon n="more" s={13} className="text-fg3" />
            </button>
            {modeOpen ? (
              <div className="absolute start-0 top-12 z-50 w-64 rounded-2xl bg-bg1/96 p-2 shadow-2xl ring-1 ring-line backdrop-blur-xl fade-in">
                <button onClick={() => { setModeOpen(false); go('home'); }}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-acc/15 px-3.5 py-2.5 text-start text-[14px] font-semibold text-acc">
                  <Icon n="film" s={17} /><span>{t('mode_cinema_label')}</span>
                </button>
                <div className="my-1 border-t border-line" />
                {([
                  ['play', 'pad', 'mode_coop_gaming'],
                  ['room', 'room', 'mode_watch_room'],
                  ['net', 'net', 'mode_network'],
                  ['lib', 'lib', 'mode_games'],
                ] as const).map(([m, ic, k]) => (
                  <button key={m} onClick={() => { setModeOpen(false); host.switchMode ? host.switchMode(m) : host.leave(); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-start text-[14px] font-medium text-fg2 transition hover:bg-white/10 hover:text-fg">
                    <Icon n={ic} s={17} /><span>{t(k)}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-line" />
                <button onClick={() => go('settings')}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-start text-[14px] font-medium text-fg2 transition hover:bg-white/10 hover:text-fg">
                  <Icon n="set" s={17} /><span>{t('settings')}</span>
                </button>
              </div>
            ) : null}
            {stack.length ? (
              <button onClick={back} aria-label={t('back')} className="grid size-10 place-items-center rounded-full bg-black/35 ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-white/15">
                <Icon n="chevl" s={20} className="flip" />
              </button>
            ) : null}
          </div>

          <div className="relative mx-auto flex min-w-0 items-center">
            <nav className="hscroll pointer-events-auto flex min-w-0 items-center gap-0.5 rounded-full bg-black/40 p-1.5 ring-1 ring-white/10 backdrop-blur-xl">
              {primaryTabs.map((x) => (
                <button key={x.id} onClick={() => go(x.id)}
                  className={`flex flex-none items-center rounded-full px-3 py-1.5 text-[13px] font-medium transition ${tab === x.id && !stack.length ? 'bg-fg text-bg' : 'text-fg2 hover:bg-white/10 hover:text-fg'}`}>
                  {t(x.label)}{tabDot(x.id)}
                </button>
              ))}
              {overflowTabs.length ? (
                <button onClick={() => { setNotifOpen(false); setMoreOpen((o) => !o); }}
                  className={`flex flex-none items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${overflowTabs.some((x) => x.id === tab) && !stack.length ? 'bg-fg text-bg' : 'text-fg2 hover:bg-white/10 hover:text-fg'}`}>
                  {t('more')}<Icon n="more" s={14} />
                </button>
              ) : null}
            </nav>
            {moreOpen && overflowTabs.length ? (
              <div className="pointer-events-auto absolute end-0 top-13 z-50 w-56 rounded-2xl bg-bg1/95 p-2 shadow-2xl ring-1 ring-line backdrop-blur-xl fade-in">
                {overflowTabs.map((x) => (
                  <button key={x.id} onClick={() => go(x.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition ${tab === x.id && !stack.length ? 'bg-fg text-bg font-semibold' : 'text-fg2 hover:bg-white/10 hover:text-fg'}`}>
                    <span>{t(x.label)}</span>{tabDot(x.id)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="app-no-drag relative flex flex-none items-center gap-2">
            <button
              type="button"
              data-testid="header-join-btn"
              onClick={() => { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); setJoinOpen(true); }}
              aria-label={t('join_btn')}
              title={t('join_btn')}
              className="flex h-10 items-center gap-1.5 rounded-full bg-white/8 px-3.5 text-xs font-semibold text-fg ring-1 ring-white/15 backdrop-blur-xl transition hover:bg-acc hover:text-acc-ink"
            >
              <Icon n="users" s={15} />
              <span className="hidden md:inline">{t('join_btn')}</span>
            </button>
            <button onClick={() => { setModeOpen(false); setMoreOpen(false); setProfileOpen(false); setNotifOpen((o) => !o); }} aria-label={t('notifications')} title={t('notifications')}
              className={`relative grid size-10 place-items-center rounded-full ring-1 ring-white/10 backdrop-blur-xl transition ${notifOpen ? 'bg-fg text-bg' : 'bg-black/35 hover:bg-white/15'}`}>
              <Icon n="bell" s={18} />
              {unreadNotifs > 0 ? (
                <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-acc px-1 text-[10px] font-bold text-acc-ink">
                  {unreadNotifs > 9 ? '9+' : unreadNotifs}
                </span>
              ) : null}
            </button>
            <button onClick={() => { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen(false); setQueueOpen(true); }} aria-label={t('queue_title')} title={t('queue_title')}
              className="relative grid size-10 place-items-center rounded-full bg-black/35 ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-white/15">
              <Icon n="list" s={18} />
              {queueCount > 0 ? (
                <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-acc px-1 text-[10px] font-bold text-acc-ink">
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              ) : null}
            </button>
            <button onClick={() => go('search')} aria-label={t('search')} title={t('search')}
              className={`grid size-10 place-items-center rounded-full ring-1 ring-white/10 backdrop-blur-xl transition ${tab === 'search' && !stack.length ? 'bg-fg text-bg' : 'bg-black/35 hover:bg-white/15'}`}>
              <Icon n="search" s={18} />
            </button>
            <button onClick={() => go('settings')} aria-label={t('settings')} title={`${t('settings')} (Ctrl+,)`}
              className={`grid size-10 place-items-center rounded-full ring-1 ring-white/10 backdrop-blur-xl transition ${tab === 'settings' && !stack.length ? 'bg-fg text-bg' : 'bg-black/35 hover:bg-white/15'}`}>
              <Icon n="set" s={18} />
            </button>
            {prefs?.incognito ? (
              <button
                onClick={async () => {
                  await cin('incognito-set', { on: false }).catch(() => {});
                  qc.invalidateQueries({ queryKey: ['prefs'] });
                }}
                title={t('incognito_desc')}
                className="flex h-10 items-center gap-1.5 rounded-full bg-purple-600/35 px-3 text-xs font-bold text-purple-100 ring-1 ring-purple-400/50 backdrop-blur-xl transition hover:bg-purple-600/50"
              >
                <Icon n="eyeoff" s={14} />
                <span>{t('incognito_on')}</span>
              </button>
            ) : null}
            {prefs ? (
              <div ref={profilePopRef} className="relative">
                <button
                  onClick={() => { setModeOpen(false); setMoreOpen(false); setNotifOpen(false); setProfileOpen((o) => !o); }}
                  aria-label={t('profile')}
                  title={prefs.profile === 'default' ? t('profile') : prefs.profile}
                  className={`rounded-full ring-2 transition ${profileOpen || (tab === 'profile' && !stack.length) ? 'ring-fg' : prefs.incognito ? 'ring-purple-400' : 'ring-transparent hover:ring-white/40'}`}
                >
                  <Avatar look={prefs.look} name={prefs.profile} size={40} />
                </button>
                {profileOpen ? (
                  <div className="absolute end-0 top-12 z-50 w-72 overflow-hidden rounded-2xl bg-bg1/96 p-3 shadow-2xl ring-1 ring-line backdrop-blur-xl fade-in">
                    <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-line pb-2.5">
                      <button
                        onClick={() => go('profile')}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-start transition hover:bg-white/6"
                      >
                        <Avatar look={prefs.look} name={prefs.profile} size={36} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-fg">{prefs.profile === 'default' ? t('profile') : prefs.profile}</div>
                          <div className="text-[11px] text-acc">{t('profile')}</div>
                        </div>
                      </button>
                    </div>

                    <button
                      onClick={async () => {
                        await cin('incognito-set', { on: !prefs.incognito }).catch(() => {});
                        qc.invalidateQueries({ queryKey: ['prefs'] });
                      }}
                      className={`mb-2.5 flex w-full items-center justify-between gap-2 rounded-xl p-2.5 text-start ring-1 transition ${
                        prefs.incognito ? 'bg-purple-600/20 ring-purple-400/50' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-fg">
                          <Icon n="eyeoff" s={13} className={prefs.incognito ? 'text-purple-300' : 'text-fg2'} />
                          <span>{t('incognito_mode')}</span>
                        </div>
                        <div className="mt-0.5 text-[10.5px] leading-snug text-fg3">{t('incognito_desc')}</div>
                      </div>
                      <span className={`inline-block h-4 w-7 flex-none rounded-full p-0.5 transition ${prefs.incognito ? 'bg-purple-400' : 'bg-white/20'}`}>
                        <span className={`block size-3 rounded-full bg-[#12100E] transition-transform ${prefs.incognito ? 'translate-x-3 rtl:-translate-x-3' : ''}`} />
                      </span>
                    </button>

                    <div className="mb-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider text-fg3">{t('switch_profile')}</div>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {(prefs.profiles || [{ name: 'default', ...prefs.look }]).map((p) => {
                        const active = p.name === prefs.profile;
                        return (
                          <button
                            key={p.name}
                            onClick={async () => {
                              setProfileOpen(false);
                              if (!active) {
                                await useProfileStore.getState().switchProfile(p.name);
                                qc.invalidateQueries();
                                host.toast(t('profile_switched', { name: p.name === 'default' ? t('profile') : p.name }));
                              }
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-start transition ${active ? 'bg-acc/15 ring-1 ring-acc/40' : 'hover:bg-white/8'}`}
                          >
                            <Avatar look={p} name={p.name} size={28} />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{p.name === 'default' ? t('profile') : p.name}</span>
                            {active ? <span className="size-2 rounded-full bg-acc" /> : null}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        useSettingsStore.getState().setActivePage('profiles');
                        go('settings');
                      }}
                      className="mt-2.5 w-full rounded-xl bg-white/8 py-2 text-center text-xs font-semibold text-fg2 transition hover:bg-white/15 hover:text-fg"
                    >
                      {t('manage_profiles')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {notifOpen ? (
              <div className="absolute end-0 top-12 z-50 w-80 overflow-hidden rounded-2xl bg-bg1/96 shadow-2xl ring-1 ring-line backdrop-blur-xl fade-in">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <span className="text-sm font-semibold">{t('notifications')}</span>
                  {unreadNotifs > 0 ? <button onClick={markAllRead} className="text-xs font-medium text-acc hover:underline">{t('mark_all_read')}</button> : null}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-line">
                  {notifs.length ? notifs.slice(0, 20).map((n) => (
                    <button key={n.id} onClick={() => openNotif(n)} className={`flex w-full items-center gap-3 p-3 text-start transition hover:bg-white/6 ${n.read ? 'opacity-65' : 'bg-acc/[0.06]'}`}>
                      <Img srcs={[n.poster]} className="h-12 w-8 flex-none rounded bg-bg2 object-cover" fallback={<div className="h-12 w-8 rounded bg-bg2" />} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{n.name}</div>
                        <div className="truncate text-xs text-fg2">{n.season && n.episode ? `S${n.season}E${n.episode} · ` : ''}{n.title}</div>
                      </div>
                      {!n.read ? <span className="size-2 flex-none rounded-full bg-acc" /> : null}
                    </button>
                  )) : <p className="p-6 text-center text-xs text-fg3">{t('notif_empty')}</p>}
                </div>
              </div>
            ) : null}
          </div>
        </header>
        ) : null}

        <DeepLinkAddonModal />
        <CommandPalette />
        <PosterContextMenuHost />
        <PlayQueueDrawer />
        {dragOver ? (
          <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-black/75 p-6 backdrop-blur-md fade-in">
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-acc bg-bg1/95 px-12 py-10 text-center shadow-2xl">
              <Icon n="film" s={38} className="text-acc" />
              <div className="text-lg font-bold text-fg">{t('drop_overlay_title')}</div>
            </div>
          </div>
        ) : null}
        <JoinFriendModal open={joinOpen} onClose={() => setJoinOpen(false)} />
        {updateBanner && !host.theaterOpen ? (
          <div
            data-testid="startup-update-banner"
            className="fixed bottom-5 start-5 z-40 flex items-center gap-3 rounded-2xl border border-acc/35 bg-bg1/95 px-4 py-2.5 text-xs shadow-2xl backdrop-blur-xl fade-in"
          >
            <Icon n="spark" s={15} className="text-acc shrink-0" />
            <span className="font-semibold text-fg">{t('upd_available_banner', { tag: updateBanner.latestTag })}</span>
            <button
              type="button"
              onClick={() => {
                useSettingsStore.getState().setActivePage('updates-backup');
                setUpdateBanner(null);
                go('settings');
              }}
              className="rounded-full bg-acc px-3 py-1 font-bold text-acc-ink hover:brightness-110"
            >
              {t('upd_view_update')}
            </button>
            <button
              type="button"
              onClick={() => setUpdateBanner(null)}
              aria-label={t('close')}
              className="grid size-6 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15"
            >
              <Icon n="x" s={12} />
            </button>
          </div>
        ) : null}
        {prefs && prefs.cinemaOnboarded !== true ? <Onboarding /> : null}
        {host.theaterOpen ? <div className="fixed inset-0 z-50 bg-black"><TheaterApp /></div> : null}
      </div>
    </NavCtx.Provider>
  );
}
