// The page's only way out: the main process's cin:* handlers (media/hub.js) and the player (theater.js).
import { useQuery, type QueryClient } from '@tanstack/react-query';

declare global {
  interface Window { majlis: { invoke(ch: string, a?: unknown): Promise<any>; on(fn: (m: any) => void): () => void; pathFor?: (file: File) => string } }
}

export const cin = <T,>(ch: string, a?: unknown): Promise<T> => window.majlis.invoke(`cin:${ch}`, a);
export const invoke = <T,>(ch: string, a?: unknown): Promise<T> => window.majlis.invoke(ch, a);

export type Type = 'movie' | 'series' | 'anime' | 'channel' | 'tv' | string;
// a catalog item (Stremio MetaPreview), as addons send it
export interface Preview {
  id: string; type: Type; name: string; poster?: string | null; background?: string | null; logo?: string | null;
  posterShape?: 'poster' | 'landscape' | 'square'; description?: string; releaseInfo?: string | number; imdbRating?: string | null;
  genres?: string[]; genre?: string[]; released?: string | null; year?: number | null; tmdbId?: number;
  malRating?: string | number | null; dub?: boolean; sub?: boolean; inCinema?: boolean; digitalRelease?: string | null;
  ratings?: { imdb?: string | number; mal?: string | number; rt?: string | number; letterboxd?: string | number; metacritic?: string | number; trakt?: string | number };
  airingAt?: number | null; nextEpisode?: { episode: number; at: number } | null;
  directUrl?: string;
}
export interface Video { id: string; season: number | null; episode: number | null; name: string; released: string | null; thumbnail: string | null; overview: string }
export interface Cast { id?: number | null; name: string; character?: string; photo?: string | null }
export interface DirectorCredit { id?: number | null; name: string; photo?: string | null }
export interface LibState { lastWatched: string | null; timeWatched: number; timeOffset: number; duration: number; video_id: string | null; videoReleased?: string | null; majlisWatched?: string[]; flaggedWatched: number }
export interface Item extends Preview {
  description: string; runtime: string; genres: string[]; cast: Cast[]; director: string[]; directors?: DirectorCredit[]; trailer: string | null; videos: Video[];
  backdrops?: string[]; recommendations?: Item[]; collection?: { id: number; name: string } | null; certification?: string | null;
  networks?: string[]; entities?: { type: 'company' | 'network'; id: number; name: string }[];
  trailers?: { key: string; name: string; type: string }[];
  country?: string | null; tagline?: string | null;
  descriptionAr?: string; links: { name: string; category: string; url: string }[]; behaviorHints: Record<string, unknown>;
  library: { inLibrary: boolean; state: LibState } | null;
}
export interface LibItem {
  _id: string; name: string; type: Type; poster: string | null; year?: number | null; genres?: string[];
  runtimeMin?: number | null; imdbRating?: number | null; directors?: string[]; cast?: string[];
  removed: boolean; temp: boolean; _mtime: string; state: LibState; behaviorHints?: Record<string, unknown>;
}
export interface Extra { name: string; isRequired: boolean; options: string[]; optionsLimit: number }
export interface Row { addon: string; addonName: string; type: Type; id: string; name: string; extra: Extra[] }
export interface Stream {
  name?: string; title?: string; description?: string; url?: string; infoHash?: string; fileIdx?: number; ytId?: string; externalUrl?: string;
  rarUrls?: (string | { url: string })[]; zipUrls?: (string | { url: string })[]; '7zipUrls'?: (string | { url: string })[]; tgzUrls?: (string | { url: string })[]; tarUrls?: (string | { url: string })[];
  sources?: string[];
  behaviorHints?: { bingeGroup?: string; filename?: string; videoSize?: number; notWebReady?: boolean; proxyHeaders?: unknown };
}
export interface Facts {
  height: number; seeders: number | null; sizeGb: number | null; instant: boolean; torrent: boolean; cached: boolean; rough: boolean;
  archive?: boolean; external?: boolean;
  hdr: boolean; dv: boolean; remux: boolean; audio: string; codec: string; group: string | null; arabic: boolean;
  arabicDub?: boolean; channels?: string | null; subLangs?: string[]; multiSubs?: boolean; uncachedDebrid?: boolean; bitrateMbps?: number;
}
export interface Ranked { stream: Stream; addon: { url: string; name: string }; addonRank: number; facts: Facts; score: number; tier: number; tier8?: number; trusted?: boolean; trustReason?: string | null; corroborated?: boolean }

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

export interface PersonCredit extends Preview {
  roles?: string[];
  jobs?: string[];
  department?: string;
  character?: string;
  voteCount?: number;
  watched?: boolean;
}
export interface PersonData {
  id: number; imdbId?: string | null; name: string; bio?: string | null;
  birthday?: string | null; deathday?: string | null; place?: string | null;
  knownFor?: string | null; photo?: string | null; credits: PersonCredit[];
}
export interface AnimeHubData { trending: Item[]; season: Item[]; topRated: Item[]; movies: Item[] }
export interface HomePrefs { hiddenRows: string[]; rowOrder?: string[]; showBrands: boolean; showFriends: boolean; zenMode?: boolean }
export interface CinemaStats {
  totalHours: number;
  totalMinutes: number;
  moviesWatched: number;
  episodesWatched: number;
  currentStreak: number;
  longestStreak: number;
  monthlyHours: { ym: string; hours: number }[];
  topGenres: { name: string; id?: number | null; count: number; minutes: number }[];
  topDirectors: { id?: number | null; name: string; count: number; minutes?: number; photo?: string | null }[];
  topActors: { id?: number | null; name: string; count: number; minutes?: number; photo?: string | null }[];
  avgRating: number | null;
}
export interface DiagnosticsCheckItem {
  id: string;
  status: 'ok' | 'warn' | 'fail';
  summary: string;
  fixId?: string;
  details?: Record<string, unknown>;
}
export interface DiagnosticsReport {
  checkedAt: number;
  version: string;
  platform: string;
  arch: string;
  profile: string;
  playing: boolean;
  checks: DiagnosticsCheckItem[];
}
export interface DisplayTarget {
  id: number;
  index?: number;
  label?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  scaleFactor?: number;
  primary?: boolean;
  current?: boolean;
}

export const usePerson = (id: number | null) => useQuery({ queryKey: ['person', id], queryFn: () => cin<PersonData | null>('person', { id }), enabled: !!id, staleTime: H });
export const useSearchPeople = (q: string) => useQuery({ queryKey: ['search-people', q], queryFn: () => cin<{ id: number; name: string; knownFor?: string; photo?: string | null }[]>('search-people', { q }), enabled: q.trim().length > 1, staleTime: 10 * 60000 });
export const useAnimeHub = () => useQuery({ queryKey: ['anime-hub'], queryFn: () => cin<AnimeHubData>('anime-hub'), staleTime: 30 * 60000 });
export const useDiscover = (p: { type?: string; genre?: string; yearFrom?: number; yearTo?: number; minRating?: number; sort?: string; provider?: number; page?: number }) =>
  useQuery({ queryKey: ['discover', p], queryFn: () => cin<Preview[]>('discover', p), staleTime: 15 * 60000 });
export const useEntityCatalog = (entityType: 'company' | 'network', id: number | null, type: 'movie' | 'series' = 'movie', page = 1) =>
  useQuery({ queryKey: ['entity-catalog', entityType, id, type, page], queryFn: () => cin<Preview[]>('entity-catalog', { entityType, id, type, page }), enabled: !!id && id > 0, staleTime: 30 * 60000 });
export const useBrandCatalog = (providerId: number, keyword: string, type = 'movie', enabled = true) =>
  useQuery({ queryKey: ['brand-catalog', providerId, keyword, type], queryFn: () => cin<Preview[]>('brand-catalog', { providerId, keyword, type }), enabled: enabled && providerId > 0, staleTime: 30 * 60000 });
export const useHomePrefs = () => useQuery({ queryKey: ['home-prefs'], queryFn: () => cin<HomePrefs>('home-prefs'), staleTime: 60000 });

export const STREAMING_BRANDS = [
  { id: 8, key: 'netflix', name: 'Netflix', bg: '#e50914', fg: '#ffffff' },
  { id: 350, key: 'apple', name: 'Apple TV+', bg: '#1d1d1f', fg: '#ffffff' },
  { id: 9, key: 'prime', name: 'Prime Video', bg: '#00a8e1', fg: '#ffffff' },
  { id: 337, key: 'disney', name: 'Disney+', bg: '#0063e5', fg: '#ffffff' },
  { id: 1899, key: 'max', name: 'Max', bg: '#002be7', fg: '#ffffff' },
  { id: 15, key: 'hulu', name: 'Hulu', bg: '#1ce783', fg: '#050507' },
  { id: 283, key: 'crunchyroll', name: 'Crunchyroll', bg: '#f47521', fg: '#ffffff' },
  { id: 386, key: 'peacock', name: 'Peacock', bg: '#111111', fg: '#ffffff' },
  { id: 531, key: 'paramount', name: 'Paramount+', bg: '#0064ff', fg: '#ffffff' },
  { id: 43, key: 'starz', name: 'Starz', bg: '#18181b', fg: '#ffffff' },
  { id: 99, key: 'shudder', name: 'Shudder', bg: '#1f1215', fg: '#f87171' },
] as const;

export const quickplay = async (a: {
  type: Type; id: string; videoId?: string; party?: boolean; pos?: number;
  card?: { name?: string; seriesName?: string; poster?: string | null; background?: string | null; logo?: string | null };
}) => {
  return cin<{ ok: boolean; error?: string; cancelled?: boolean }>('quickplay', a);
};

export function toPlayableAudioUrl(raw: string | null | undefined): { url: string | null; revoke: () => void } {
  if (!raw) return { url: null, revoke: () => {} };
  if (!raw.startsWith('data:')) return { url: raw, revoke: () => {} };
  try {
    const comma = raw.indexOf(',');
    if (comma < 0) return { url: null, revoke: () => {} };
    const head = raw.slice(5, comma);
    const mime = head.split(';')[0] || 'audio/ogg';
    const isB64 = head.includes(';base64');
    const body = raw.slice(comma + 1);
    const bytes = isB64
      ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    return { url: null, revoke: () => {} };
  }
}

export const prefetchMeta = (qc: QueryClient, type: Type, id: string) => {
  cin('prefetch', { type, id }).catch(() => {});
  qc.prefetchQuery({ queryKey: ['meta', type, id], queryFn: () => cin<Item>('meta', { type, id }), staleTime: H }).catch(() => {});
};

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
export const play = async (a: { type: Type; videoId: string; meta: Preview; stream: Stream; label?: string; pos?: number; addon?: string; party?: boolean }) => {
  const res = await invoke('media:play', {
    type: a.type, id: a.videoId, stream: a.stream, pos: a.pos, addon: a.addon, party: a.party,
    card: { name: a.label || a.meta.name, seriesName: a.meta.name, poster: a.meta.poster || null, background: (a.meta as Item).background || null, logo: (a.meta as Item).logo || null, type: a.type, metaId: a.meta.id },
  });
  if (a.party) await invoke('party:start').catch(() => {});
  return res;
};

// ---- M3: browsing, calendar, library tabs, addons
export interface Manifest { id: string; name: string; version: string; description?: string; logo?: string; background?: string; types: string[]; idPrefixes?: string[] | null; catalogs: { type: Type; id: string; name: string | null; extra: Extra[] }[]; resources: (string | { name: string })[]; behaviorHints: { configurable?: boolean; configurationRequired?: boolean; adult?: boolean } }
export interface AddonHealthSnapshot {
  status: 'up' | 'slow' | 'down';
  avgMs: number | null;
  p90Ms: number | null;
  dead: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
}
export interface Installed { url: string; manifest?: Manifest; error?: string; enabled?: boolean; dead?: boolean; latencyMs?: number | null; health?: AddonHealthSnapshot }
export interface LocalMatch { metaId: string; type: Type; name: string; poster: string | null; year?: number | null }
export interface LocalMediaFile { id: string; filename: string; name: string; year: number | null; season: number | null; episode: number | null; resolution: string | null; size: number; mtime: number; sidecarCount?: number; match?: LocalMatch | null }
export interface LibraryCustomListItem { id: string; type: Type; name: string; poster: string | null; year?: number | null; genres?: string[]; at: number }
export interface LibraryCustomList { id: string; name: string; items: LibraryCustomListItem[]; createdAt: number }
export interface CloudItem { id: string; torrentId?: string | number; fileId?: string | number; name: string; size: number; kind: 'folder' | 'file'; link?: string | null; service: string }
export interface HomeServerPublic { id: string; kind: 'jellyfin' | 'emby' | 'plex'; name: string; url: string; userId?: string; serverName?: string; version?: string; hasKey: boolean }
export interface HomeServerItem extends Preview { watched?: boolean; homeServer: { serverId: string; serverName: string; itemId: string; kind: string } }

export const useLocalScan = () => useQuery({
  queryKey: ['local-scan'],
  queryFn: () => cin<{ folders: string[]; files: LocalMediaFile[] }>('local-scan', { pick: false }),
  staleTime: 60000,
});
export const useUpcoming = () => useQuery({ queryKey: ['upcoming'], queryFn: () => cin<LibItem[]>('upcoming'), staleTime: 60000 });
export const useCustomLists = () => useQuery({ queryKey: ['custom-lists'], queryFn: () => cin<LibraryCustomList[]>('custom-lists'), staleTime: 10000 });
export const useHomeServers = () => useQuery({ queryKey: ['home-servers'], queryFn: () => cin<HomeServerPublic[]>('hs-list'), staleTime: 15000 });
export const useHomeServerItems = (serverId?: string, query = '', enabled = true) =>
  useQuery({ queryKey: ['hs-items', serverId || 'all', query], queryFn: () => cin<HomeServerItem[]>('hs-items', { serverId, query }), enabled, staleTime: 60000 });
export const useTrackedPeople = () => useQuery({ queryKey: ['tracked-people'], queryFn: () => cin<{ id: number; name: string; photo?: string | null; at: number }[]>('person-track-list'), staleTime: 15000 });
export interface StoreAddon { slug: string; manifestUrl: string; page: string; stars: number; categories: string[]; configurable: boolean; configureUrl: string | null; manifest: Manifest | null }
export interface CalEntry { at: number; day: string; source: string; id: string; type: Type; name: string; title: string; season: number | null; episode: number | null; videoId: string | null; poster: string | null }
export interface HistoryEntry { id: string; videoId: string; type: Type; name: string; poster: string | null; at: number }
export interface Marathon { id: number; name: string; background: string | null; parts: Item[] }
export type Tune = Record<string, { v: 1 | -1; genres: string[] }>;
export interface NotifItem { id: string; metaId?: string; type?: Type; name: string; title?: string; videoId?: string; season?: number | null; episode?: number | null; poster?: string | null; at?: number; read?: boolean }

export const useNotifications = () => useQuery({
  queryKey: ['notifications'],
  queryFn: () => cin<NotifItem[] | { items?: NotifItem[]; unread?: number }>('notifications').then((r) => (Array.isArray(r) ? r : r?.items || [])).catch(() => [] as NotifItem[]),
  staleTime: 60000,
});
export const useCaps = () => useQuery({ queryKey: ['caps'], queryFn: () => cin<{ tmdb: boolean; trakt: boolean; stremio: boolean; debrid: string | null }>('caps'), staleTime: 60000 });
export const useAnimeTrending = (page = 1) => useQuery({ queryKey: ['anime-trending', page], queryFn: () => cin<Item[]>('anime-trending', { page }), staleTime: H });
export const useMarathons = (on = true) => useQuery({ queryKey: ['marathons'], queryFn: () => cin<Marathon[]>('marathons'), staleTime: 24 * H, enabled: on });
export const useTune = () => useQuery({ queryKey: ['tune'], queryFn: () => cin<Tune>('tune'), staleTime: Infinity });
export const useCalendar = (from: number, to: number, sources: string[]) =>
  useQuery({ queryKey: ['calendar', from, to, sources], queryFn: () => cin<CalEntry[]>('calendar', { from, to, sources }), staleTime: 30 * 60000 });
export const useHistory = () => useQuery({ queryKey: ['history'], queryFn: () => cin<{ group: string; items: HistoryEntry[] }[]>('history'), staleTime: 0 });
export const useLists = () => useQuery({ queryKey: ['lists'], queryFn: () => cin<{ watchlist: HistoryEntry[]; favorites: HistoryEntry[] }>('lists'), staleTime: 60000 });
export const useInstalled = () => useQuery({ queryKey: ['addons'], queryFn: () => cin<Installed[]>('addons'), staleTime: 0 });
export const useStore = (q: { search?: string; category?: string; page?: number }) =>
  useQuery({ queryKey: ['store', q], queryFn: () => cin<{ addons: StoreAddon[] }>('store', { ...q, limit: 40 }), staleTime: 30 * 60000 });
export const useStoreCategories = () => useQuery({ queryKey: ['store-categories'], queryFn: () => cin<{ name: string; slug: string }[]>('store-categories'), staleTime: 24 * H });

// Cinemeta's own catalogs take a genre: the base of the type pages and Discover's picks
export const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
export const cinemetaRow = (type: 'movie' | 'series', id: 'top' | 'imdbRating' = 'top'): Row =>
  ({ addon: CINEMETA, addonName: 'Cinemeta', type, id, name: id, extra: [{ name: 'genre', isRequired: false, options: [], optionsLimit: 1 }] });

// ---- Social, Friends, Party Compare & Group Taste Matcher
export const social = <T,>(ch: string, a?: unknown): Promise<T> => window.majlis.invoke(`social:${ch}`, a);

export interface TorrentHealthEntry {
  level: 'green' | 'yellow' | 'red';
  seeders: number | null;
  leechers: number;
  verified: boolean;
  hasMeta: boolean;
  instant?: boolean;
  cached?: boolean;
}
export function useTorrentHealth(items: Ranked[]) {
  const payload = items
    .filter((r) => r.stream?.infoHash)
    .slice(0, 25)
    .map((r) => ({
      infoHash: String(r.stream.infoHash || '').toLowerCase(),
      sources: (r.stream as { sources?: string[] }).sources || [],
      fallbackSeeders: r.facts.seeders,
      hasMeta: !!(r.stream.behaviorHints?.filename || r.facts.height || r.facts.sizeGb),
      corroborated: r.tier >= 2,
      instant: r.facts.instant,
      cached: r.facts.cached,
    }));
  const key = payload.map((x) => x.infoHash).join(',');
  return useQuery({
    queryKey: ['torrent-health', key],
    queryFn: () => cin<Record<string, TorrentHealthEntry>>('torrent-health', { items: payload }),
    enabled: payload.length > 0,
    staleTime: 5 * 60000,
  });
}

export interface TasteCompatibility {
  pct: number | null;
  sharedGenres: string[];
  sharedTopRated: { id: string; type: Type; name: string; poster: string | null; year: number | null; myScore: number | null; friendScore: number | null }[];
  commonWatched: number;
}
export interface PartyNoteItem {
  id: string; titleKey?: string; t: number; text: string; authorId: string; authorName: string; accent: string; at: number;
}
export interface WatchControlState {
  mode: 'host' | 'guest' | 'all'; holderId: string | null; holderName: string | null;
}
export interface ReadyPeerView { id: string; sid?: string; name: string; ready: boolean; isHost: boolean }
export interface ReadyStateView { active: boolean; hostReady?: boolean; peers: ReadyPeerView[]; prompt?: boolean }
export interface RoomPresetItem {
  id: string; builtin?: boolean; name: string; nameAr?: string; icon: string;
  mode: 'play' | 'watch'; watchControl: 'host' | 'guest' | 'all';
  acceptCodes: boolean; allowChat: boolean; allowReactions: boolean;
  autoNext: boolean; autoDuck: boolean; qualityPreset: 'speed' | 'balanced' | 'quality';
  maxRes: 'source' | '720' | '1080' | '1440'; fps: number; defaultRole: 'watch' | 'pad' | 'kbm' | 'full';
  roomPin: string;
}
export interface PartyHistoryItem {
  id: string; startedAt: number; endedAt: number; watchedMs: number;
  titleId: string; videoId: string; type: Type; title: string; poster: string | null;
  genres: string[]; role: 'host' | 'guest';
  attendees: { id: string; name: string; accent: string | null; avatar: string | null }[];
  notes?: PartyNoteItem[];
  ratings: Record<string, { id: string; name: string; accent: string; score: number; at: number }>;
  groupRating: number | null;
}
export interface MajlisWrappedData {
  range: 'month' | 'all'; totalSessions: number; totalMinutes: number;
  topGenres: { genre: string; sessions: number; minutes: number }[];
  topBuddies: { id: string; name: string; accent: string; avatar: string | null; sessions: number; minutes: number }[];
  avgGroupRating: number | null;
  highestRated: { titleId: string; title: string; poster: string | null; groupRating: number } | null;
  milestones: string[];
}
export const usePartyHistory = () => useQuery({ queryKey: ['party-history'], queryFn: () => social<PartyHistoryItem[]>('party-history'), staleTime: 15000 });
export const useMajlisWrapped = (range: 'month' | 'all' = 'all') => useQuery({ queryKey: ['majlis-wrapped', range], queryFn: () => social<MajlisWrappedData>('wrapped', { range }), staleTime: 15000 });

export interface SocialTitle { id: string; type: Type; name: string; poster: string | null; year?: number | null }
export interface CustomList { id: string; name: string; description?: string; items: SocialTitle[] }
export interface CatalogAvatar { id: string; name: string; url: string }
export interface SocialComment { id: string; authorId: string; authorName: string; authorAvatar: string | null; authorAccent: string; body: string; at: number }
export interface SocialMe {
  id: string; profile: string; displayName: string; handle: string; avatar: string | null; accent: string; theme: string;
  bio: string; song: { url?: string; title?: string; start?: number } | null; shareHistory: 'friends' | 'none';
  favorites: SocialTitle[]; lists: CustomList[]; libraryFavorites: SocialTitle[]; catalogAvatars: CatalogAvatar[]; friendLink: string; signedFriendCode?: string;
  ratings?: { id: string; type: Type; title: string; poster: string | null; score: number; ratedAt: number }[];
  comments?: SocialComment[];
  customProfile?: Record<string, unknown> | null;
}
export interface FriendEntry {
  id: string; name: string; handle: string; avatar: string | null; accent: string; bio: string;
  trust: 'ask' | 'always' | 'block'; friendStatus: 'accepted' | 'pending_out' | 'pending_in';
  added: number; lastSeen: number; online: boolean; presence: 'online' | 'busy' | 'offline' | 'blocked';
  watching: { name: string; together?: boolean } | null; inParty: { role: string; count: number; mode?: string } | null;
  compatibility?: TasteCompatibility;
}
export interface FriendRequest {
  id: string; pk?: string | null; direction: 'in' | 'out'; name: string; handle: string; avatar: string | null; accent: string; bio: string; at: number;
}
export interface FriendProfileData {
  id: string; isMe: boolean; displayName: string; handle: string; avatar: string | null; accent: string; bio: string;
  song: { url?: string; title?: string; start?: number } | null; songDataUrl: string | null;
  shareHistory: 'friends' | 'none'; historyHidden: boolean;
  favorites: SocialTitle[]; lists: CustomList[];
  history: HistoryEntry[]; ratings: { id: string | null; name: string; year: number | null; poster?: string | null; watched: boolean; rating: number | null; review: string | null }[];
  online: boolean; presence: string; watching: { name: string; together?: boolean } | null; inParty: { role: string; count: number } | null;
  trust: string | null; isFriend: boolean; cachedAt?: number;
  comments?: SocialComment[];
  compatibility?: TasteCompatibility;
  customProfile?: Record<string, unknown> | null;
}
export interface PartyMember { id: string; sid?: string; name: string; handle: string; avatar: string | null; accent: string; role: string; isHost: boolean }
export interface PartyCursor { id: string; name: string; accent: string; x: number; y: number; at: number }
export interface SwipeItem { id: string; type: Type; name: string; poster: string | null; year: number | null; imdbRating: string | null; genres: string[]; matchPct: number | null }
export interface SwipeState { roundId: string; endsAt: number; items: SwipeItem[]; likes: Record<string, { id: string; name: string; accent: string }[]>; matches: SwipeItem[] }
export interface WheelState { roundId: string; items: SocialTitle[]; winnerIdx: number; winner: SocialTitle; angle: number; at: number }
export interface SocialRoom {
  role: 'host' | 'guest' | null; hostingEnabled: boolean; code: { code: string; exp: number } | null;
  members: PartyMember[]; vote: { id: string; type: string; name: string; poster: string | null; by?: string; votes: number; voters: string[] }[];
  chat: { id: string; from: string; accent: string; text: string; at: number }[];
  cursors: PartyCursor[]; swipe: SwipeState | null; wheel: WheelState | null;
  control?: WatchControlState | null;
  notes?: PartyNoteItem[];
  readyState?: ReadyStateView | null;
}
export interface CompareColumn {
  id: string; type: Type; name: string; poster: string | null; by: string | null; votes: number; voters: string[];
  ratings: { imdb: number | null; rt: number | null; letterboxd: number | null; mal: number | null };
  audience: number | null; year: number | null; released: string | null; genres: string[]; certification: string | null;
  runtime: string | null; runtimeMin: number | null;
  watchedBy: { id: string; name: string; accent: string; avatar: string | null; watched: boolean; rating: number | null; review: string | null }[];
}
export interface CompareMatrix {
  columns: CompareColumn[];
  highlights: { best: Record<'imdb' | 'rt' | 'letterboxd' | 'mal' | 'audience' | 'year' | 'runtimeMin' | 'unwatched', string[]>; sharedGenres: string[] };
}
export interface TastePick extends Item {
  score: number; matchPct: number; runtimeMin: number | null;
  matchTier?: 1 | 2 | 3;
  matchedSelectedGenres?: string[];
  memberScores: { id: string; name: string; accent: string; pct: number }[];
  reasons: { genres: string[]; decade: string | null; people: string[] };
}
export interface TasteFilters { mood?: string; maxRuntime?: number; era?: string; genres?: string[]; genre?: string }

export const useSocialMe = () => useQuery({ queryKey: ['social-me'], queryFn: () => social<SocialMe>('me'), staleTime: 30000 });
export const useSocialFriends = (enabled = true) => useQuery({
  queryKey: ['social-friends'],
  queryFn: () => social<{ myId: string; friendLink: string; signedFriendCode?: string; friends: FriendEntry[]; requests: FriendRequest[] }>('friends'),
  enabled,
  refetchInterval: () => (!enabled || (typeof document !== 'undefined' && document.visibilityState === 'hidden') ? false : 15000),
});
export const useSocialProfile = (id: string | null) => useQuery({ queryKey: ['social-profile', id], queryFn: () => social<FriendProfileData>('profile', { id }), enabled: !!id, staleTime: 15000 });
export const useSocialRoom = (enabled = true) => useQuery({
  queryKey: ['social-room'],
  queryFn: () => social<SocialRoom>('room'),
  enabled,
  refetchInterval: () => (!enabled || (typeof document !== 'undefined' && document.visibilityState === 'hidden') ? false : 3000),
});
export const useRoomPresets = () => useQuery({ queryKey: ['room-presets'], queryFn: () => invoke<RoomPresetItem[]>('party:presets'), staleTime: 30000 });
export const useSocialCompare = (items: { id: string; type?: string; name?: string; poster?: string | null; votes?: number; voters?: string[] }[]) =>
  useQuery({ queryKey: ['social-compare', items.map((x) => `${x.id}:${x.votes ?? 0}`).join(',')], queryFn: () => social<CompareMatrix>('compare', { items }), enabled: items.length > 0, staleTime: 60000 });
export const useSocialTaste = (filters: TasteFilters) =>
  useQuery({ queryKey: ['social-taste', filters], queryFn: () => social<{ picks: TastePick[]; pool: TastePick[]; fallbackHint?: 'exact' | 'partial' | 'relaxed'; members: { id: string; name: string; accent: string; watchedCount: number }[] }>('taste', { filters }), staleTime: 60000 });

