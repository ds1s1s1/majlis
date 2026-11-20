// Entry: app.js imports this module and mounts Cinema into the page (see mountMedia in app.js).
import './styles.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostCtx, bus, type HostApi, type Route, type Tab } from './host';
import { App } from './App';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, refetchIntervalInBackground: false, gcTime: 30 * 60000 } } });

export function mount(el: HTMLElement, host: HostApi) {
  const root = createRoot(el);
  let cur = host;
  const render = (h: HostApi) => {
    cur = h;
    const api: HostApi = {
      ...h,
      setLang: (lang) => {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
        if (cur.setLang) Promise.resolve(cur.setLang(lang)).catch(() => {});
        else window.majlis?.invoke('settings', { lang }).catch(() => {});
        render({ ...cur, lang });
      },
    };
    root.render(<HostCtx.Provider value={api}><QueryClientProvider client={qc}><App /></QueryClientProvider></HostCtx.Provider>);
  };
  render(host);
  return {
    update: (h: HostApi) => render(h),
    // the library changed outside the page (the player saved progress)
    refresh: (what?: string) => { if (what) { qc.invalidateQueries({ queryKey: [what] }); return; } qc.invalidateQueries({ queryKey: ['continue'] }); qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['meta'] }); },
    // tonight's vote, pushed by the room
    setVote: (v: unknown) => { qc.setQueryData(['vote'], v); qc.invalidateQueries({ queryKey: ['room'] }); },
    mergeStreams: (part: { key?: string; streams?: unknown[]; errors?: unknown[] }) => {
      if (!part?.key || !Array.isArray(part.streams)) return;
      const idx = part.key.indexOf(':');
      if (idx <= 0) return;
      const type = part.key.slice(0, idx), id = part.key.slice(idx + 1);
      qc.setQueryData(['streams', type, id], { streams: part.streams, errors: part.errors || [] });
    },
    deepLinkAddon: (url: string) => bus.dispatchEvent(new CustomEvent('deeplink-addon', { detail: { url } })),
    open: (r: Route) => bus.dispatchEvent(new CustomEvent('open', { detail: r })),
    go: (tab: Tab) => bus.dispatchEvent(new CustomEvent('go', { detail: tab })),
    unmount: () => root.unmount(),
  };
}
