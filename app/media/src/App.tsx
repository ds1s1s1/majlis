import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavCtx, bus, useHost, useT, type Nav, type Route, type Tab } from './host';
import type { Key } from './i18n';
import { Icon } from './ui/Icon';
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
import { Addons } from './pages/Addons';
import { Downloads } from './pages/Downloads';
import { Profile, Avatar, usePrefs } from './pages/Profile';
import { Onboarding } from './pages/Onboarding';

// text on the accent: dark on light colours, light on dark ones
const inkFor = (hex: string) => { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#141210' : '#fff8ec'; };

// the tabs in the pill, in order (each one is a page below)
const TABS: { id: Tab; label: Key; page: (active: boolean) => ReactNode }[] = [
  { id: 'home', label: 'home', page: () => <Home /> },
  { id: 'discover', label: 'discover', page: () => <Discover /> },
  { id: 'catalogs', label: 'catalogs', page: () => <Catalogs /> },
  { id: 'movies', label: 'movies', page: () => <TypePage type="movie" /> },
  { id: 'shows', label: 'shows', page: () => <TypePage type="series" /> },
  { id: 'anime', label: 'anime', page: () => <Anime /> },
  { id: 'calendar', label: 'calendar', page: () => <Calendar /> },
  { id: 'library', label: 'library', page: () => <Library /> },
  { id: 'collections', label: 'collections', page: () => <Collections /> },
  { id: 'downloads', label: 'downloads', page: () => <Downloads /> },
  { id: 'addons', label: 'addons', page: () => <Addons /> },
];

export function App() {
  const host = useHost(), t = useT();
  const prefs = usePrefs().data;
  const look = prefs?.look;
  const [tab, setTab] = useState<Tab>('home');
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set(['home']));
  const [stack, setStack] = useState<Route[]>([]);
  const go = useCallback((x: Tab) => { setStack([]); setTab(x); setSeen((s) => (s.has(x) ? s : new Set(s).add(x))); }, []);
  const open = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const nav: Nav = useMemo(() => ({ tab, go, open, back, depth: stack.length }), [tab, go, open, back, stack.length]);

  useEffect(() => {
    const h = (e: Event) => open((e as CustomEvent<Route>).detail);
    const g = (e: Event) => go((e as CustomEvent<Tab>).detail);
    bus.addEventListener('open', h); bus.addEventListener('go', g);
    return () => { bus.removeEventListener('open', h); bus.removeEventListener('go', g); };
  }, [open, go]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack.length && !(e.target as HTMLElement)?.matches?.('input')) back(); };
    const mouse = (e: MouseEvent) => { if (e.button === 3 && stack.length) { e.preventDefault(); back(); } };
    window.addEventListener('keydown', key); window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); };
  }, [stack.length, back]);

  const pages: { id: Tab; node: ReactNode }[] = [
    ...TABS.filter((x) => seen.has(x.id)).map((x) => ({ id: x.id, node: x.page(tab === x.id && !stack.length) })),
    ...(seen.has('search') ? [{ id: 'search' as Tab, node: <Search active={tab === 'search' && !stack.length} /> }] : []),
    ...(seen.has('profile') ? [{ id: 'profile' as Tab, node: <Profile /> }] : []),
  ];
  return (
    <NavCtx.Provider value={nav}>
      <div className="cin" data-theme={look?.theme || host.theme} dir={host.lang === 'ar' ? 'rtl' : 'ltr'}
        style={look?.accent ? ({ '--c-acc': look.accent, '--c-acc-ink': inkFor(look.accent) } as React.CSSProperties) : undefined}>
        {/* tabs stay mounted (scroll, loaded rows); only the visible one is interactive */}
        {pages.map((p) => {
          const on = p.id === tab && !stack.length;
          return <div key={p.id} className="absolute inset-0" hidden={!on} inert={!on}>{p.node}</div>;
        })}
        {stack.map((r, i) => {
          const on = i === stack.length - 1;
          return (
            <div key={i} className="absolute inset-0 z-20 bg-bg" hidden={!on} inert={!on}>
              {r.kind === 'title' ? <Detail route={r} /> : <Collection id={r.id} name={r.name} />}
            </div>
          );
        })}

        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-24 items-start gap-4 bg-gradient-to-b from-bg/85 via-bg/40 to-transparent px-6 pt-4">
          <div className="pointer-events-auto flex items-center gap-2">
            <button onClick={host.leave} title={t('back_majlis')} className="flex items-center gap-2 rounded-full bg-black/35 px-3.5 py-2 text-sm text-fg2 ring-1 ring-white/10 backdrop-blur-xl transition hover:text-fg">
              <Icon n="home" s={16} />{t('back_majlis')}
            </button>
            {stack.length ? (
              <button onClick={back} aria-label={t('back')} className="grid size-10 place-items-center rounded-full bg-black/35 ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-white/15">
                <Icon n="chevl" s={20} className="flip" />
              </button>
            ) : null}
          </div>
          <nav className="hscroll pointer-events-auto mx-auto flex min-w-0 items-center gap-0.5 rounded-full bg-black/40 p-1.5 ring-1 ring-white/10 backdrop-blur-xl">
            {TABS.map((x) => (
              <button key={x.id} onClick={() => go(x.id)}
                className={`flex-none rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition ${tab === x.id && !stack.length ? 'bg-fg text-bg' : 'text-fg2 hover:bg-white/10 hover:text-fg'}`}>
                {t(x.label)}
              </button>
            ))}
          </nav>
          <div className="pointer-events-auto flex items-center gap-2">
            <button onClick={() => go('search')} aria-label={t('search')} title={t('search')}
              className={`grid size-10 place-items-center rounded-full ring-1 ring-white/10 backdrop-blur-xl transition ${tab === 'search' && !stack.length ? 'bg-fg text-bg' : 'bg-black/35 hover:bg-white/15'}`}>
              <Icon n="search" s={18} />
            </button>
            {prefs ? (
              <button onClick={() => go('profile')} aria-label={t('profile')} title={prefs.profile === 'default' ? t('profile') : prefs.profile}
                className={`rounded-full ring-2 transition ${tab === 'profile' && !stack.length ? 'ring-fg' : 'ring-transparent hover:ring-white/40'}`}>
                <Avatar look={prefs.look} name={prefs.profile} size={40} />
              </button>
            ) : null}
          </div>
        </header>
        {prefs && prefs.cinemaOnboarded !== true ? <Onboarding /> : null}
      </div>
    </NavCtx.Provider>
  );
}
