// Entry: app.js imports this module and mounts Cinema into the page (see mountMedia in app.js).
import './styles.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostCtx, bus, type HostApi, type Route, type Tab } from './host';
import { App } from './App';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 30 * 60000 } } });

export function mount(el: HTMLElement, host: HostApi) {
  const root = createRoot(el);
  const render = (h: HostApi) => root.render(
    <HostCtx.Provider value={h}><QueryClientProvider client={qc}><App /></QueryClientProvider></HostCtx.Provider>,
  );
  render(host);
  return {
    update: (h: HostApi) => render(h),
    // the library changed outside the page (the player saved progress)
    refresh: () => { qc.invalidateQueries({ queryKey: ['continue'] }); qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['meta'] }); },
    open: (r: Route) => bus.dispatchEvent(new CustomEvent('open', { detail: r })),
    go: (tab: Tab) => bus.dispatchEvent(new CustomEvent('go', { detail: tab })),
    unmount: () => root.unmount(),
  };
}
