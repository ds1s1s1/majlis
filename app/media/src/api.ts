// The page's only way out: the main process's cin:* handlers (media/hub.js) and the player (theater.js).
import { useQuery } from '@tanstack/react-query';

declare global {
  interface Window { majlis: { invoke(ch: string, a?: unknown): Promise<any>; on(fn: (m: any) => void): () => void } }
}

export const cin = <T,>(ch: string, a?: unknown): Promise<T> => window.majlis.invoke(`cin:${ch}`, a);
export const invoke = <T,>(ch: string, a?: unknown): Promise<T> => window.majlis.invoke(ch, a);

export type Type = 'movie' | 'series' | 'anime' | 'channel' | 'tv' | string;
// a catalog item (Stremio MetaPreview), as addons send it
export interface Preview {
  id: string; type: Type; name: string; poster?: string | null; background?: string | null; logo?: string | null;
  posterShape?: 'poster' | 'landscape' | 'square'; description?: string; releaseInfo?: string | number; imdbRating?: string | null;
  genres?: string[]; genre?: string[]; released?: string | null; year?: number | null; tmdbId?: number;
}
export interface Video { id: string; season: number | null; episode: number | null; name: string; released: string | null; thumbnail: string | null; overview: string }
export interface Cast { name: string; character?: string; photo?: string | null }
export interface LibState { lastWatched: string | null; timeWatched: number; timeOffset: number; duration: number; video_id: string | null; majlisWatched?: string[]; flaggedWatched: number }
export interface Item extends Preview {
  description: string; runtime: string; genres: string[]; cast: Cast[]; director: string[]; trailer: string | null; videos: Video[];
  backdrops?: string[]; recommendations?: Item[]; collection?: { id: number; name: string } | null; certification?: string | null;
  descriptionAr?: string; links: { name: string; category: string; url: string }[]; behaviorHints: Record<string, unknown>;
  library: { inLibrary: boolean; state: LibState } | null;
}
export interface LibItem { _id: string; name: string; type: Type; poster: string | null; removed: boolean; temp: boolean; _mtime: string; state: LibState; behaviorHints?: Record<string, unknown> }
export interface Extra { name: string; isRequired: boolean; options: string[]; optionsLimit: number }
export interface Row { addon: string; addonName: string; type: Type; id: string; name: string; extra: Extra[] }
export interface Stream {
  name?: string; title?: string; description?: string; url?: string; infoHash?: string; fileIdx?: number; ytId?: string; externalUrl?: string;
  behaviorHints?: { bingeGroup?: string; filename?: string; videoSize?: number; notWebReady?: boolean; proxyHeaders?: unknown };
}
export interface Facts { height: number; seeders: number | null; sizeGb: number | null; instant: boolean; torrent: boolean; cached: boolean; rough: boolean; hdr: boolean; dv: boolean; remux: boolean; audio: string; codec: string; group: string | null; arabic: boolean }
export interface Ranked { stream: Stream; addon: { url: string; name: string }; addonRank: number; facts: Facts; score: number; tier: number }

const H = 3600000;
export const useRows = () => useQuery({ queryKey: ['rows'], queryFn: () => cin<Row[]>('rows'), staleTime: H });
export const useCatalog = (r: Row | null, extra: [string, string][] = [], enabled = true) =>
  useQuery({ queryKey: ['catalog', r?.addon, r?.type, r?.id, extra], queryFn: () => cin<Preview[]>('catalog', { addon: r!.addon, type: r!.type, id: r!.id, extra }), enabled: !!r && enabled, staleTime: 30 * 60000 });
export const useMeta = (type: Type | null, id: string | null) =>
  useQuery({ queryKey: ['meta', type, id], queryFn: () => cin<Item>('meta', { type, id }), enabled: !!type && !!id, staleTime: H });
export const useTrending = (type: 'movie' | 'series') => useQuery({ queryKey: ['trending', type], queryFn: () => cin<Item[]>('trending', { type }), staleTime: H });
export const useContinue = () => useQuery({ queryKey: ['continue'], queryFn: () => cin<LibItem[]>('continue'), staleTime: 0 });
export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: () => cin<LibItem[]>('library'), staleTime: 0 });
export const useStreams = (type: Type, id: string | null, bingeGroup?: string) =>
  useQuery({ queryKey: ['streams', type, id], queryFn: () => cin<{ streams: Ranked[]; errors: { addon: string; error: string }[] }>('streams', { type, id, bingeGroup }), enabled: !!id, staleTime: 2 * 60000 });
export const useSearch = (q: string) =>
  useQuery({ queryKey: ['search', q], queryFn: () => cin<{ addon: string; type: Type; name: string; metas: Preview[] }[]>('search', { q }), enabled: q.trim().length > 1, staleTime: 10 * 60000 });

// images Stremio's own apps use for IMDb ids (no key): wide backdrops and title logos
export const metahub = (kind: 'background' | 'logo' | 'poster', id: string, size: 'small' | 'medium' | 'large' = 'medium') =>
  /^tt\d+/.test(id) ? `https://images.metahub.space/${kind}/${size}/${id.split(':')[0]}/img` : null;

// "S2 E5" from a video id (tt..:2:5)
export const episodeOf = (videoId: string | null | undefined) => {
  const m = /:(\d+):(\d+)$/.exec(videoId || '');
  return m ? { season: +m[1], episode: +m[2] } : null;
};
export const yearOf = (p: Preview) => String(p.releaseInfo ?? p.year ?? '').slice(0, 4);

// open a copy in the player (theater.js): card carries what "continue watching" and next-episode need
export const play = (a: { type: Type; videoId: string; meta: Preview; stream: Stream; label?: string; pos?: number; addon?: string }) =>
  invoke('media:play', { type: a.type, id: a.videoId, stream: a.stream, pos: a.pos, addon: a.addon, card: { name: a.label || a.meta.name, seriesName: a.meta.name, poster: a.meta.poster || null, type: a.type, metaId: a.meta.id } });

// ---- M3: browsing, calendar, library tabs, addons
export interface Manifest { id: string; name: string; version: string; description?: string; logo?: string; background?: string; types: string[]; catalogs: { type: Type; id: string; name: string | null; extra: Extra[] }[]; resources: { name: string }[]; behaviorHints: { configurable?: boolean; configurationRequired?: boolean; adult?: boolean } }
export interface Installed { url: string; manifest?: Manifest; error?: string }
export interface StoreAddon { slug: string; manifestUrl: string; page: string; stars: number; categories: string[]; configurable: boolean; configureUrl: string | null; manifest: Manifest | null }
export interface CalEntry { at: number; day: string; source: string; id: string; type: Type; name: string; title: string; season: number | null; episode: number | null; videoId: string | null; poster: string | null }
export interface HistoryEntry { id: string; videoId: string; type: Type; name: string; poster: string | null; at: number }
export interface Marathon { id: number; name: string; background: string | null; parts: Item[] }
export type Tune = Record<string, { v: 1 | -1; genres: string[] }>;

export const useCaps = () => useQuery({ queryKey: ['caps'], queryFn: () => cin<{ tmdb: boolean; trakt: boolean; stremio: boolean }>('caps'), staleTime: 60000 });
export const useAnimeTrending = (page = 1) => useQuery({ queryKey: ['anime-trending', page], queryFn: () => cin<Item[]>('anime-trending', { page }), staleTime: H });
export const useMarathons = (on = true) => useQuery({ queryKey: ['marathons'], queryFn: () => cin<Marathon[]>('marathons'), staleTime: 24 * H, enabled: on });
export const useTune = () => useQuery({ queryKey: ['tune'], queryFn: () => cin<Tune>('tune'), staleTime: Infinity });
export const useCalendar = (from: number, to: number, sources: string[]) =>
  useQuery({ queryKey: ['calendar', from, to, sources], queryFn: () => cin<CalEntry[]>('calendar', { from, to, sources }), staleTime: 30 * 60000 });
export const useHistory = () => useQuery({ queryKey: ['history'], queryFn: () => cin<{ group: string; items: HistoryEntry[] }[]>('history'), staleTime: 0 });
export const useLists = () => useQuery({ queryKey: ['lists'], queryFn: () => cin<{ watchlist: HistoryEntry[]; favorites: HistoryEntry[] }>('lists'), staleTime: 0 });
export const useInstalled = () => useQuery({ queryKey: ['addons'], queryFn: () => cin<Installed[]>('addons'), staleTime: 0 });
export const useStore = (q: { search?: string; category?: string; page?: number }) =>
  useQuery({ queryKey: ['store', q], queryFn: () => cin<{ addons: StoreAddon[] }>('store', { ...q, limit: 40 }), staleTime: 30 * 60000 });
export const useStoreCategories = () => useQuery({ queryKey: ['store-categories'], queryFn: () => cin<{ name: string; slug: string }[]>('store-categories'), staleTime: 24 * H });

// Cinemeta's own catalogs take a genre: the base of the type pages and Discover's picks
export const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
export const cinemetaRow = (type: 'movie' | 'series', id: 'top' | 'imdbRating' = 'top'): Row =>
  ({ addon: CINEMETA, addonName: 'Cinemeta', type, id, name: id, extra: [{ name: 'genre', isRequired: false, options: [], optionsLimit: 1 }] });
