import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cin, invoke, social, type FriendProfileData, type LibItem, type SocialMe, type HistoryEntry } from '../api';
import {
  createEmptyProfileState, inlinePoster, type CardPlacement, type HeroStatKey, type LeftCardId,
  type ProfileComment, type ProfileFavoriteWork, type ProfileGroup, type ProfileList,
  type ProfileMusicArtist, type ProfileRating, type ProfileSocialLink, type RightCardId, type UserProfileState,
} from '../data/profileMockSeed';

export type ProfileDraft = UserProfileState;

interface ProfileStore {
  saved: UserProfileState;
  draft: ProfileDraft | null;
  editing: boolean;
  hydrating: boolean;
  customiseView: boolean;
  activityView: boolean;

  setCustomiseView: (on: boolean) => void;
  setActivityView: (on: boolean) => void;
  startEdit: () => void;
  cancelEdit: () => void;
  updateDraft: (updater: (d: ProfileDraft) => void) => void;
  saveDraft: () => Promise<void>;
  updateSaved: (updater: (s: UserProfileState) => void) => void;

  // Interactive operations
  setFeaturedLists: (ids: string[]) => void;
  setHeroStats: (stats: [HeroStatKey, HeroStatKey, HeroStatKey, HeroStatKey]) => void;
  setCardPlacements: (left: CardPlacement<LeftCardId>[], right: CardPlacement<RightCardId>[]) => void;
  setGamingCard: (g: UserProfileState['showcase']['gamingCard']) => void;
  setFavoritesGames: (games: ProfileFavoriteWork[]) => void;
  setFavoritesBooks: (books: ProfileFavoriteWork[]) => void;
  setFavoritesMusic: (music: ProfileMusicArtist[]) => void;
  setSocialLinks: (links: ProfileSocialLink[]) => void;
  addGroup: (grp: Omit<ProfileGroup, 'id'>) => void;
  addComment: (body: string, targetId?: string) => Promise<void>;
  deleteComment: (id: string, targetId?: string) => Promise<void>;
  addRating: (r: Omit<ProfileRating, 'at'>) => void;
  importRatingsCsv: (rows: { name: string; year?: number; rating?: number; review?: string }[]) => void;
  hydrateFromMajlis: () => Promise<void>;
  switchProfile: (name: string) => Promise<void>;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      saved: createEmptyProfileState(),
      draft: null,
      editing: false,
      hydrating: false,
      customiseView: false,
      activityView: false,

      setCustomiseView: (on) => set({ customiseView: on }),
      setActivityView: (on) => set({ activityView: on }),

      switchProfile: async (name) => {
        const clean = String(name || '').trim() || 'default';
        await cin('profile-use', { name: clean }).catch(() => {});
        const blank = createEmptyProfileState();
        if (clean !== 'default') blank.general.alias = clean;
        set({
          saved: blank,
          draft: null,
          editing: false,
          customiseView: false,
          activityView: false,
          hydrating: false,
        });
        await get().hydrateFromMajlis();
      },

      startEdit: () => set((st) => ({ editing: true, customiseView: false, draft: clone(st.saved) })),
      cancelEdit: () => set({ editing: false, customiseView: false, draft: null }),

      updateDraft: (updater) => set((st) => {
        const next = clone(st.draft || st.saved);
        updater(next);
        return { draft: next };
      }),

      saveDraft: async () => {
        const d = get().draft;
        if (!d) { set({ editing: false, customiseView: false }); return; }
        set({ saved: clone(d), draft: null, editing: false, customiseView: false });
        try {
          const customProfile = {
            status: d.general.status,
            pronouns: d.general.pronouns,
            location: d.general.location,
            customUrl: d.general.customUrl,
            themeId: d.look.themeId,
            customColors: d.look.customColors,
            transparentCards: d.look.transparentCards,
            gradientMode: d.look.gradientMode,
            privacy: d.privacy,
            showcase: d.showcase,
            socials: d.socials,
            groups: d.groups,
            customCanvas: d.customCanvas,
          };
          await social('profile-save', {
            displayName: d.general.alias,
            handle: '',
            bio: d.general.about,
            avatar: d.general.avatar,
            accent: d.look.customColors.accent,
            theme: d.look.themeId,
            shareHistory: d.privacy.shareWatchActivity ? 'friends' : 'none',
            customProfile: { ...customProfile, customUrl: '' },
          });
          if (d.general.alias.trim()) {
            await invoke('settings', { nick: d.general.alias.trim() }).catch(() => {});
          }
          await cin('prefs-set', {
            look: {
              avatar: d.general.avatar,
              accent: d.look.customColors.accent,
              theme: ['majlis', 'oled', 'nord', 'dracula', 'noir'].includes(d.look.themeId) ? d.look.themeId : 'majlis',
            },
          });
        } catch {}
      },

      updateSaved: (updater) => set((st) => {
        const next = clone(st.saved);
        updater(next);
        invoke('backup:mirror', { profileV1: next }).catch(() => {});
        return { saved: next, ...(st.draft ? { draft: (() => { const nd = clone(st.draft); updater(nd); return nd; })() } : {}) };
      }),

      setFeaturedLists: (ids) => get().updateSaved((s) => { s.showcase.featuredListIds = ids.slice(0, 3); }),
      setHeroStats: (stats) => get().updateSaved((s) => { s.showcase.heroStats = stats; }),
      setCardPlacements: (left, right) => get().updateSaved((s) => { s.showcase.leftCards = left; s.showcase.rightCards = right; }),
      setGamingCard: (g) => get().updateSaved((s) => { s.showcase.gamingCard = g; }),
      setFavoritesGames: (games) => get().updateSaved((s) => { s.favorites.games = games.slice(0, 5); }),
      setFavoritesBooks: (books) => get().updateSaved((s) => { s.favorites.books = books.slice(0, 5); }),
      setFavoritesMusic: (music) => get().updateSaved((s) => { s.favorites.music = music.slice(0, 12); }),
      setSocialLinks: (links) => get().updateSaved((s) => { s.socials = links.slice(0, 8); }),

      addGroup: (grp) => get().updateSaved((s) => {
        s.groups.unshift({ id: `grp-${Date.now()}`, ...grp });
      }),

      addComment: async (body, targetId) => {
        const trimmed = body.trim().slice(0, 800);
        if (!trimmed) return;
        const myId = get().saved.id;
        const target = targetId || myId;
        const res = await social<{ ok?: boolean; comment?: ProfileComment; comments?: ProfileComment[] }>('comment-add', {
          ...(target && target !== 'default' ? { targetId: target } : {}),
          body: trimmed,
        }).catch(() => null);
        const s = get().saved;
        const nextComment: ProfileComment = res?.comment || {
          id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          authorId: s.id,
          authorName: s.general.alias || 'Me',
          authorAvatar: s.general.avatar,
          authorAccent: s.look.customColors.accent || '#E5A93C',
          body: trimmed,
          at: Date.now(),
        };
        if (!targetId || targetId === myId) {
          get().updateSaved((draft) => {
            draft.comments = Array.isArray(res?.comments) ? res.comments : [nextComment, ...draft.comments.filter((x) => x.id !== nextComment.id)];
          });
        }
      },

      deleteComment: async (id, targetId) => {
        const myId = get().saved.id;
        const target = targetId || myId;
        const res = await social<{ ok?: boolean; comments?: ProfileComment[] }>('comment-del', {
          ...(target && target !== 'default' ? { targetId: target } : {}),
          commentId: id,
        }).catch(() => null);
        if (!targetId || targetId === myId) {
          get().updateSaved((s) => {
            s.comments = Array.isArray(res?.comments) ? res.comments : s.comments.filter((c) => c.id !== id);
          });
        }
      },

      addRating: (r) => get().updateSaved((s) => {
        s.ratings = [
          { ...r, at: Date.now() },
          ...s.ratings.filter((x) => x.id !== r.id),
        ];
        if (r.review) s.stats.reviewsCount = s.ratings.filter((x) => !!x.review).length;
      }),

      importRatingsCsv: (rows) => get().updateSaved((s) => {
        const imported: ProfileRating[] = rows.filter((r) => r.name).slice(0, 100).map((r, i) => ({
          id: `imp-${Date.now()}-${i}`,
          title: r.name,
          type: 'movie',
          poster: inlinePoster(r.name, '#2d2419', '#12100E'),
          score: Math.max(1, Math.min(10, Math.round((r.rating || 4) * (r.rating && r.rating <= 5 ? 2 : 1)))),
          review: r.review,
          year: r.year || null,
          at: Date.now() - i * 1000,
        }));
        s.ratings = [...imported, ...s.ratings].slice(0, 150);
        s.stats.reviewsCount = s.ratings.filter((x) => !!x.review).length;
      }),

      hydrateFromMajlis: async () => {
        if (get().hydrating) return;
        set({ hydrating: true });
        try {
          const [me, fr, lib, hist, lists] = await Promise.all([
            social<SocialMe>('me').catch(() => null),
            social<{ friends?: any[]; requests?: any[] }>('friends').catch(() => null),
            cin<LibItem[]>('library').catch(() => null),
            cin<{ group: string; items: HistoryEntry[] }[]>('history').catch(() => null),
            cin<{ watchlist: HistoryEntry[]; favorites: HistoryEntry[] }>('lists').catch(() => null),
          ]);
          get().updateSaved((s) => {
            if (me) {
              s.id = me.id || s.id;
              if (me.displayName) s.general.alias = me.displayName;
              s.general.handle = '';
              s.general.customUrl = '';
              if (me.avatar !== undefined) s.general.avatar = me.avatar;
              if (me.bio) s.general.about = me.bio;
              if (me.accent) s.look.customColors.accent = me.accent;
              if (me.song?.url) {
                s.general.profileSongUrl = me.song.url;
                s.general.profileSongTitle = me.song.title || 'Profile Song';
              }
              if (Array.isArray(me.comments)) s.comments = me.comments;
              if (me.customProfile && typeof me.customProfile === 'object') {
                const cp = me.customProfile as Record<string, any>;
                if (typeof cp.status === 'string') s.general.status = cp.status;
                if (typeof cp.pronouns === 'string') s.general.pronouns = cp.pronouns;
                if (typeof cp.location === 'string') s.general.location = cp.location;
                if (typeof cp.customUrl === 'string') s.general.customUrl = cp.customUrl;
                if (typeof cp.themeId === 'string') s.look.themeId = cp.themeId as UserProfileState['look']['themeId'];
                if (cp.customColors && typeof cp.customColors === 'object') s.look.customColors = { ...s.look.customColors, ...cp.customColors };
                if (typeof cp.transparentCards === 'boolean') s.look.transparentCards = cp.transparentCards;
                if (typeof cp.gradientMode === 'boolean') s.look.gradientMode = cp.gradientMode;
                if (cp.privacy && typeof cp.privacy === 'object') s.privacy = { ...s.privacy, ...cp.privacy };
                if (cp.showcase && typeof cp.showcase === 'object') s.showcase = { ...s.showcase, ...cp.showcase };
                if (Array.isArray(cp.socials)) s.socials = cp.socials;
                if (Array.isArray(cp.groups)) s.groups = cp.groups;
                if (cp.customCanvas && typeof cp.customCanvas === 'object') s.customCanvas = { ...s.customCanvas, ...cp.customCanvas };
              }
              if (Array.isArray(me.lists) && me.lists.length) {
                const mapped: ProfileList[] = me.lists.map((l) => ({
                  id: l.id, name: l.name, description: l.description,
                  items: (l.items || []).map((it) => ({ id: it.id, type: (it.type as 'movie' | 'series' | 'anime') || 'movie', name: it.name, poster: it.poster, year: it.year })),
                }));
                s.lists = mapped;
                if (!s.showcase.featuredListIds.some((fid) => mapped.some((m) => m.id === fid))) {
                  s.showcase.featuredListIds = mapped.slice(0, 3).map((m) => m.id);
                }
              }
            }
            if (me?.ratings?.length) {
              const seen = new Set(s.ratings.map((x) => `${x.type}:${x.id}`));
              for (const r of me.ratings) {
                const k = `${r.type}:${r.id}`;
                if (!seen.has(k) && r.score > 0) {
                  seen.add(k);
                  s.ratings.push({
                    id: r.id,
                    title: r.title,
                    type: r.type === 'series' ? 'series' : 'movie',
                    poster: r.poster || null,
                    score: Math.max(1, Math.min(10, Math.round(r.score))),
                    at: r.ratedAt || Date.now(),
                  });
                }
              }
            }
            const favSrc = (me?.libraryFavorites?.length ? me.libraryFavorites : lists?.favorites) || [];
            const mergedFavs = [...(me?.favorites || []), ...favSrc].filter((f, idx, arr) => f?.id && arr.findIndex((x) => x.id === f.id) === idx);
            if (mergedFavs.length) {
              const nextItems = mergedFavs.slice(0, 12).map((f) => ({
                id: f.id, type: (f.type === 'series' ? 'series' : 'movie') as 'movie' | 'series', name: f.name, poster: f.poster || null,
              }));
              const existIdx = s.lists.findIndex((l) => l.id === 'majlis-favs');
              if (existIdx >= 0) s.lists[existIdx] = { ...s.lists[existIdx], items: nextItems };
              else s.lists.unshift({ id: 'majlis-favs', name: 'Majlis Favorites', items: nextItems });
            }
            if (Array.isArray(lib) && lib.length) {
              const movies = lib.filter((x) => x.type === 'movie').length;
              const eps = lib.filter((x) => x.type !== 'movie').reduce((n, x) => n + (x.state?.majlisWatched?.length || 0), 0);
              const mins = Math.round(lib.reduce((n, x) => n + ((x.state as { overallTimeWatched?: number })?.overallTimeWatched || x.state?.timeWatched || 0), 0) / 60000);
              if (movies > 0) s.stats.moviesCount = movies;
              if (eps > 0) s.stats.episodesCount = eps;
              if (mins > 0) s.stats.timeWatchedMinutes = mins;
            }
            if (Array.isArray(hist)) {
              const items = hist.flatMap((g) => g.items || []).slice(0, 24);
              if (items.length) {
                s.activity = items.map((x, i) => ({
                  id: `hist-${x.id}-${x.at}-${i}`, kind: 'watched', mediaId: x.id,
                  mediaType: x.type === 'series' ? 'series' : 'movie',
                  title: x.name, detail: 'Watched on Majlis', poster: x.poster, at: x.at || Date.now(),
                }));
              }
            }
            if (fr?.friends) {
              s.friends = fr.friends.map((f) => ({
                id: f.id, name: f.name || f.id, handle: f.handle || '', avatar: f.avatar || null,
                accent: f.accent || '#E5A93C', online: !!f.online,
                statusText: f.watching ? `Watching ${f.watching.name}` : f.online ? 'Online' : 'Offline',
              }));
            }
            if (fr?.requests) {
              s.incomingRequests = fr.requests.filter((r) => r.direction === 'in').map((r) => ({
                id: r.id, name: r.name || r.id, handle: r.handle || '', avatar: r.avatar || null,
              }));
            }
          });
        } finally {
          set({ hydrating: false });
        }
      },
    }),
    {
      name: 'majlis:user-profile-v1',
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== 'object' || version >= 3) return persisted as ProfileStore;
        const st = persisted as { saved?: UserProfileState };
        if (st.saved) {
          const s = st.saved;
          const isMockAlias = s.general?.alias === 'PlayerOne' || s.general?.alias === 'Majlis Member';
          if (s.general) {
            if (isMockAlias) s.general.alias = '';
            s.general.handle = '';
            s.general.customUrl = '';
            if (s.general.status === 'Ready for a late-night watch party') s.general.status = '';
            if (s.general.about?.includes('**sci-fi epics**')) s.general.about = '';
            if (s.general.profileSongTitle === 'Ambient Theme') s.general.profileSongTitle = '';
            if (s.general.profileSongArtist === 'Majlis Studio') s.general.profileSongArtist = '';
            s.general.verified = false;
          }
          if (isMockAlias) {
            if (s.showcase?.gamingCard?.gamertag === 'PlayerOne') s.showcase.gamingCard = { enabled: false, platform: 'steam', gamertag: '' };
            if (s.tracker?.handle === 'player_one') s.tracker = { name: 'Letterboxd', handle: '', connected: false, filmsCount: 0, ratingsCount: 0, publicLists: 0 };
            s.badges = (s.badges || []).filter((b) => b.id !== 'b-host' && b.id !== 'b-critic');
            s.favorites = { games: [], books: [], music: s.favorites?.music || [] };
            s.socials = (s.socials || []).filter((x) => x.id !== 'soc-1' && x.id !== 'soc-2');
          }
          if (s.tracker?.handle === 'player_one') s.tracker = { name: 'Letterboxd', handle: '', connected: false, filmsCount: 0, ratingsCount: 0, publicLists: 0 };
          if (s.stats?.timeWatchedMinutes === 7741 && s.stats?.episodesCount === 4712 && s.stats?.moviesCount === 113) {
            s.stats = { timeWatchedMinutes: 0, episodesCount: 0, moviesCount: 0, reviewsCount: 0 };
          }
          s.ratings = (s.ratings || []).filter((r) => !String(r.id || '').startsWith('demo-'));
          s.lists = (s.lists || []).filter((l) => !(l.id === 'list-favorites' || l.id === 'list-weekend') || l.items.some((it) => !String(it.id || '').startsWith('demo-')));
          s.activity = (s.activity || []).filter((a) => a.id !== 'act-1' && a.id !== 'act-2');
          s.groups = (s.groups || []).filter((g) => !(g.id === 'grp-1' && g.name === 'Thursday Movie Night'));
        }
        return st as ProfileStore;
      },
    },
  ),
);

export function friendDataToProfileState(f: FriendProfileData): UserProfileState {
  const seed = createEmptyProfileState();
  const cp = (f.customProfile && typeof f.customProfile === 'object' ? f.customProfile : null) as Record<string, any> | null;
  return {
    ...seed,
    id: f.id,
    general: {
      ...seed.general,
      alias: f.displayName || f.id,
      handle: f.handle || '',
      avatar: f.avatar || null,
      about: f.bio || '',
      profileSongUrl: f.songDataUrl || f.song?.url || '',
      profileSongTitle: f.song?.title || (f.songDataUrl || f.song?.url ? 'Profile Song' : ''),
      presence: f.online ? (f.inParty ? 'session' : 'online') : 'offline',
      status: f.watching ? `Watching ${f.watching.name}` : (typeof cp?.status === 'string' ? cp.status : ''),
      pronouns: typeof cp?.pronouns === 'string' ? cp.pronouns : '',
      location: typeof cp?.location === 'string' ? cp.location : '',
      customUrl: typeof cp?.customUrl === 'string' ? cp.customUrl : '',
    },
    look: {
      ...seed.look,
      ...(typeof cp?.themeId === 'string' ? { themeId: cp.themeId as UserProfileState['look']['themeId'] } : {}),
      ...(typeof cp?.transparentCards === 'boolean' ? { transparentCards: cp.transparentCards } : {}),
      ...(typeof cp?.gradientMode === 'boolean' ? { gradientMode: cp.gradientMode } : {}),
      customColors: {
        ...seed.look.customColors,
        ...(cp?.customColors && typeof cp.customColors === 'object' ? cp.customColors : {}),
        accent: f.accent || '#E5A93C',
      },
    },
    privacy: {
      ...seed.privacy,
      ...(cp?.privacy && typeof cp.privacy === 'object' ? cp.privacy : {}),
      privateProfile: f.historyHidden,
      shareWatchActivity: !f.historyHidden,
    },
    showcase: cp?.showcase && typeof cp.showcase === 'object' ? { ...seed.showcase, ...cp.showcase } : seed.showcase,
    customCanvas: cp?.customCanvas && typeof cp.customCanvas === 'object' ? { ...seed.customCanvas, ...cp.customCanvas } : seed.customCanvas,
    lists: (f.lists || []).map((l) => ({
      id: l.id, name: l.name, description: l.description,
      items: (l.items || []).map((it) => ({ id: it.id, type: it.type === 'series' ? 'series' : 'movie', name: it.name, poster: it.poster, year: it.year })),
    })),
    ratings: (f.ratings || []).map((r, i) => ({
      id: r.id || `fr-${i}`, title: r.name, type: 'movie', poster: r.poster || null,
      score: Math.max(1, Math.min(10, Math.round((r.rating || 4) * ((r.rating || 0) <= 5 ? 2 : 1)))),
      review: r.review || undefined, year: r.year || null, at: Date.now() - i * 864e5,
    })),
    activity: (f.history || []).map((h, i) => ({
      id: `fa-${i}`, kind: 'watched', mediaId: h.id, mediaType: h.type === 'series' ? 'series' : 'movie',
      title: h.name, detail: 'Watched', poster: h.poster || null, at: h.at || Date.now(),
    })),
    comments: Array.isArray(f.comments) ? f.comments : [],
    friends: [],
    groups: Array.isArray(cp?.groups) ? cp.groups : [],
    socials: Array.isArray(cp?.socials) ? cp.socials : [],
  };
}
