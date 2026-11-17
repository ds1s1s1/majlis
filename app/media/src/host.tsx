// What the Cinema page gets from the rest of Majlis, plus its own navigation.
import { createContext, useContext } from 'react';
import { translate, type Key, type Lang } from './i18n';
import type { Type } from './api';

export interface HostApi { lang: Lang; theme: string; toast: (msg: string) => void; leave: () => void }
export type Tab = 'home' | 'discover' | 'catalogs' | 'movies' | 'shows' | 'anime' | 'calendar' | 'library' | 'collections' | 'downloads' | 'addons' | 'search' | 'profile';
export type Route = { kind: 'title'; type: Type; id: string; autoplay?: string; pos?: number } | { kind: 'collection'; id: number; name: string };

export interface Nav { tab: Tab; go: (t: Tab) => void; open: (r: Route) => void; back: () => void; depth: number }
export const HostCtx = createContext<HostApi>(null!);
// mount().open(route) -> App
export const bus = new EventTarget();
export const NavCtx = createContext<Nav>(null!);
export const useHost = () => useContext(HostCtx);
export const useNav = () => useContext(NavCtx);
export function useT() {
  const { lang } = useHost();
  return (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
