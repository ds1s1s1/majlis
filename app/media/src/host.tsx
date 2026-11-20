// What the Cinema page gets from the rest of Majlis, plus its own navigation.
import { createContext, useContext } from 'react';
import { translate, type Key, type Lang } from './i18n';
import type { Type } from './api';

export interface HostApi {
  lang: Lang;
  theme: string;
  toast: (msg: string) => void;
  leave: () => void;
  setLang?: (l: Lang) => void;
  visible?: boolean;
  theaterOpen?: boolean;
  switchMode?: (mode: string) => void;
}
export type Tab = 'home' | 'discover' | 'catalogs' | 'movies' | 'shows' | 'anime' | 'calendar' | 'library' | 'collections' | 'downloads' | 'addons' | 'friends' | 'party' | 'search' | 'profile' | 'settings';
export type Route =
  | { kind: 'title'; type: Type; id: string; autoplay?: string; pos?: number }
  | { kind: 'collection'; id: number; name: string }
  | { kind: 'friend'; id: string }
  | { kind: 'person'; id: number; name: string }
  | { kind: 'entity'; entityType: 'company' | 'network'; id: number; name: string };

export interface FlipOrigin { x: number; y: number; w: number; h: number; poster?: string | null; at: number }
let lastFlip: FlipOrigin | null = null;
export function rememberFlip(el: HTMLElement | null | undefined, poster?: string | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) lastFlip = { x: r.left, y: r.top, w: r.width, h: r.height, poster, at: performance.now() };
}
export function consumeFlip(): FlipOrigin | null {
  const f = lastFlip;
  lastFlip = null;
  return f && performance.now() - f.at < 600 ? f : null;
}

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
