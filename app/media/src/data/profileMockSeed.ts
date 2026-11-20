// Anonymous offline-safe seed data (strictly zero personal user data or third-party domains).
import type { SocialPlatformId } from '../components/profile/icons/SocialIcons';
import type { ProfileThemeId } from '../config/profileThemes';

export const inlinePoster = (title: string, bg1: string, bg2: string): string => {
  const esc = title.replace(/[<>&"]/g, '').slice(0, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><rect x="14" y="14" width="172" height="272" rx="12" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/><text x="100" y="160" text-anchor="middle" fill="#F2EFE9" font-family="system-ui,sans-serif" font-size="16" font-weight="700">${esc}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const inlineBanner = (bg1 = '#2a1f10', bg2 = '#12100E'): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 320" preserveAspectRatio="none"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="55%" stop-color="#1d1812"/><stop offset="100%" stop-color="${bg2}"/></linearGradient><radialGradient id="gl" cx="72%" cy="22%" r="48%"><stop offset="0%" stop-color="#E5A93C" stop-opacity="0.28"/><stop offset="100%" stop-color="#E5A93C" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="320" fill="url(#bg)"/><rect width="1200" height="320" fill="url(#gl)"/><path d="M0 245 L60 220 L120 245 L180 220 L240 245 L300 220 L360 245 L420 220 L480 245 L540 220 L600 245 L660 220 L720 245 L780 220 L840 245 L900 220 L960 245 L1020 220 L1080 245 L1140 220 L1200 245" fill="none" stroke="rgba(229,169,60,0.22)" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export interface ProfileListItem {
  id: string;
  type: 'movie' | 'series' | 'anime';
  name: string;
  poster: string | null;
  year?: number | null;
}

export interface ProfileList {
  id: string;
  name: string;
  description?: string;
  items: ProfileListItem[];
}

export interface ProfileRating {
  id: string;
  title: string;
  type: 'movie' | 'series';
  poster: string | null;
  score: number; // 1..10
  review?: string;
  year?: number | null;
  at: number;
}

export interface ProfileFavoriteWork {
  id: string;
  title: string;
  cover: string;
  kind: 'games' | 'books';
  subtitle?: string;
}

export interface ProfileMusicArtist {
  id: string;
  name: string;
  avatar: string | null;
  genre?: string;
}

export interface ProfileBadge {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  icon: 'flame' | 'film' | 'users' | 'star' | 'sparkles' | 'compass';
  earnedAt: number;
}

export interface ProfileActivityItem {
  id: string;
  kind: 'watched' | 'rated' | 'lists' | 'social';
  mediaId?: string;
  mediaType?: 'movie' | 'series';
  title: string;
  detail: string;
  poster: string | null;
  score?: number | null;
  at: number;
}

export interface ProfileComment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorAccent: string;
  body: string;
  at: number;
}

export interface ProfileFriend {
  id: string;
  name: string;
  handle: string;
  avatar: string | null;
  accent: string;
  online: boolean;
  statusText: string;
}

export interface ProfileGroup {
  id: string;
  name: string;
  description: string;
  membersCount: number;
  privacy: 'public' | 'invite';
  color: string;
  tags: string[];
}

export interface ProfileSocialLink {
  id: string;
  platform: SocialPlatformId;
  handle: string;
}

export type HeroStatKey =
  | 'timeWatched'
  | 'episodes'
  | 'movies'
  | 'reviews'
  | 'ratings'
  | 'lists'
  | 'games'
  | 'books'
  | 'friends'
  | 'groups';

export type LeftCardId = 'about' | 'lists' | 'ratings' | 'games' | 'books' | 'music' | 'badges' | 'activity' | 'comments';
export type RightCardId = 'song' | 'tracker' | 'gaming' | 'friends' | 'groups' | 'socials';

export interface CardPlacement<T extends string> {
  id: T;
  visible: boolean;
}

export interface UserProfileState {
  id: string;
  general: {
    alias: string;
    handle: string;
    status: string;
    pronouns: string;
    location: string;
    customUrl: string;
    profileSongUrl: string;
    profileSongTitle: string;
    profileSongArtist: string;
    about: string;
    avatar: string | null;
    banner: string | null;
    verified: boolean;
    presence: 'online' | 'session' | 'offline';
  };
  look: {
    themeId: ProfileThemeId;
    customColors: { bg: string; card: string; accent: string; text: string };
    transparentCards: boolean;
    gradientMode: boolean;
  };
  customCanvas: {
    enabled: boolean;
    showToVisitors: boolean;
    font: string;
    pageBgColor: string;
    canvasHeight: number;
    pageBgImage: string;
    hideTopBanner: boolean;
    hideCardTitles: boolean;
    favicon: string;
    customHtml: string;
    customCss: string;
  };
  showcase: {
    featuredListIds: string[];
    heroStats: [HeroStatKey, HeroStatKey, HeroStatKey, HeroStatKey];
    leftCards: CardPlacement<LeftCardId>[];
    rightCards: CardPlacement<RightCardId>[];
    gamingCard: { enabled: boolean; platform: 'steam' | 'xbox' | 'playstation' | 'minecraft'; gamertag: string };
  };
  privacy: {
    privateProfile: boolean;
    friendsListVisibility: 'everyone' | 'friends' | 'only_me';
    shareWatchActivity: boolean;
    shareLiveStatus: boolean;
    showGamingCard: boolean;
    showExternalTrackerCard: boolean;
  };
  tracker: {
    name: string;
    handle: string;
    connected: boolean;
    filmsCount: number;
    ratingsCount: number;
    publicLists: number;
  };
  stats: {
    timeWatchedMinutes: number;
    episodesCount: number;
    moviesCount: number;
    reviewsCount: number;
  };
  lists: ProfileList[];
  ratings: ProfileRating[];
  favorites: {
    games: ProfileFavoriteWork[];
    books: ProfileFavoriteWork[];
    music: ProfileMusicArtist[];
  };
  badges: ProfileBadge[];
  friends: ProfileFriend[];
  incomingRequests: { id: string; name: string; handle: string; avatar: string | null }[];
  groups: ProfileGroup[];
  socials: ProfileSocialLink[];
  comments: ProfileComment[];
  activity: ProfileActivityItem[];
}

export const DEMO_GAME_CATALOG: ProfileFavoriteWork[] = [
  { id: 'game-1', title: 'Shadow Odyssey', kind: 'games', subtitle: 'Action RPG', cover: inlinePoster('Shadow Odyssey', '#2d1c10', '#0f172a') },
  { id: 'game-2', title: 'Desert Drift', kind: 'games', subtitle: 'Co-op Racing', cover: inlinePoster('Desert Drift', '#3b240c', '#181410') },
  { id: 'game-3', title: 'Orbit Foundry', kind: 'games', subtitle: 'Strategy', cover: inlinePoster('Orbit Foundry', '#132a3e', '#0b101b') },
  { id: 'game-4', title: 'Citadel Echoes', kind: 'games', subtitle: 'Adventure', cover: inlinePoster('Citadel Echoes', '#29173b', '#130f1d') },
  { id: 'game-5', title: 'Signal Zero', kind: 'games', subtitle: 'Co-op Tactical', cover: inlinePoster('Signal Zero', '#143326', '#0c1410') },
  { id: 'game-6', title: 'Dune Runner', kind: 'games', subtitle: 'Indie Survival', cover: inlinePoster('Dune Runner', '#452811', '#1a120b') },
];

export const DEMO_BOOK_CATALOG: ProfileFavoriteWork[] = [
  { id: 'book-1', title: 'Glass Meridians', kind: 'books', subtitle: 'Speculative Fiction', cover: inlinePoster('Glass Meridians', '#1e293b', '#0f172a') },
  { id: 'book-2', title: 'The Starlight Atlas', kind: 'books', subtitle: 'Sci-Fi', cover: inlinePoster('Starlight Atlas', '#2a183b', '#130f1d') },
  { id: 'book-3', title: 'Cedar & Sand', kind: 'books', subtitle: 'Drama', cover: inlinePoster('Cedar & Sand', '#3a2912', '#17120c') },
  { id: 'book-4', title: 'Silent Harbors', kind: 'books', subtitle: 'Mystery', cover: inlinePoster('Silent Harbors', '#122923', '#0b1512') },
  { id: 'book-5', title: 'Clockwork Caravan', kind: 'books', subtitle: 'Fantasy', cover: inlinePoster('Clockwork', '#3f1e18', '#170e0c') },
];

export const DEMO_MUSIC_CATALOG: ProfileMusicArtist[] = [
  { id: 'mus-1', name: 'Horizon Synth', avatar: inlinePoster('HS', '#3b240c', '#12100E'), genre: 'Synthwave' },
  { id: 'mus-2', name: 'Dune Ensemble', avatar: inlinePoster('DE', '#162c3d', '#0b101b'), genre: 'Ambient' },
  { id: 'mus-3', name: 'Amber Quartet', avatar: inlinePoster('AQ', '#3d1c28', '#170e12'), genre: 'OST / Acoustic' },
  { id: 'mus-4', name: 'Nocturne Beat', avatar: inlinePoster('NB', '#23163d', '#130f1d'), genre: 'Electronic' },
];

export const DEMO_FRIEND_DIRECTORY: { id: string; name: string; handle: string; accent: string; statusText: string }[] = [];

export function createEmptyProfileState(): UserProfileState {
  return {
    id: 'default',
    general: {
      alias: '',
      handle: '',
      status: '',
      pronouns: '',
      location: '',
      customUrl: '',
      profileSongUrl: '',
      profileSongTitle: '',
      profileSongArtist: '',
      about: '',
      avatar: null,
      banner: inlineBanner(),
      verified: false,
      presence: 'online',
    },
    look: {
      themeId: 'majlis',
      customColors: { bg: '#12100E', card: '#181613', accent: '#E5A93C', text: '#F2EFE9' },
      transparentCards: false,
      gradientMode: true,
    },
    customCanvas: {
      enabled: false,
      showToVisitors: true,
      font: 'IBM Plex Sans Arabic',
      pageBgColor: '#12100E',
      canvasHeight: 220,
      pageBgImage: '',
      hideTopBanner: false,
      hideCardTitles: false,
      favicon: '',
      customHtml: '',
      customCss: '',
    },
    showcase: {
      featuredListIds: [],
      heroStats: ['timeWatched', 'episodes', 'movies', 'reviews'],
      leftCards: [
        { id: 'about', visible: true },
        { id: 'lists', visible: true },
        { id: 'ratings', visible: true },
        { id: 'games', visible: true },
        { id: 'books', visible: true },
        { id: 'music', visible: true },
        { id: 'badges', visible: true },
        { id: 'activity', visible: true },
        { id: 'comments', visible: true },
      ],
      rightCards: [
        { id: 'song', visible: true },
        { id: 'tracker', visible: true },
        { id: 'gaming', visible: false },
        { id: 'friends', visible: true },
        { id: 'groups', visible: true },
        { id: 'socials', visible: true },
      ],
      gamingCard: { enabled: false, platform: 'steam', gamertag: '' },
    },
    privacy: {
      privateProfile: false,
      friendsListVisibility: 'everyone',
      shareWatchActivity: true,
      shareLiveStatus: true,
      showGamingCard: true,
      showExternalTrackerCard: true,
    },
    tracker: {
      name: 'Letterboxd',
      handle: '',
      connected: false,
      filmsCount: 0,
      ratingsCount: 0,
      publicLists: 0,
    },
    stats: {
      timeWatchedMinutes: 0,
      episodesCount: 0,
      moviesCount: 0,
      reviewsCount: 0,
    },
    lists: [],
    ratings: [],
    favorites: { games: [], books: [], music: [] },
    badges: [],
    friends: [],
    incomingRequests: [],
    groups: [],
    socials: [],
    comments: [],
    activity: [],
  };
}

export function createInitialProfileSeed(): UserProfileState {
  return createEmptyProfileState();
}
