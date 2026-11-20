import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cin, invoke } from '../api';

export type SettingsPageId =
  // 1. Account & setup
  | 'get-started' | 'your-profile' | 'profiles' | 'addon-sync'
  | 'tracker-trakt' | 'tracker-simkl' | 'tracker-anilist' | 'tracker-mal' | 'tracker-letterboxd' | 'tracker-publicmetadb'
  | 'relay' | 'manage-accounts'
  // 2. Playback
  | 'when-you-press-play' | 'video-player' | 'aspect-ratio' | 'audio' | 'on-screen-controls' | 'xray'
  | 'ad-skipping' | 'intros' | 'up-next' | 'trailers' | 'video-quality' | 'picture-adjustments'
  | 'playback-buffering' | 'mpv-conf' | 'anime-shaders' | 'manga-shaders' | 'image-shaders'
  | 'motion-smoothing' | 'svp-interpolation'
  // 3. Languages
  | 'app-language' | 'audio-languages' | 'discovery-languages' | 'subtitle-languages'
  | 'subtitle-sources' | 'subtitle-sync' | 'subtitle-style'
  // 4. Sources & library
  | 'streaming-services' | 'home-servers' | 'source-preferences' | 'source-order' | 'source-picker'
  | 'stream-filters' | 'p2p-engine' | 'streaming-server' | 'home' | 'cards' | 'detail-pages'
  | 'metadata-providers' | 'search' | 'library'
  // 5. Plugins
  | 'installed-plugins' | 'plugin-repositories'
  // 6. Appearance
  | 'theme-background' | 'your-themes' | 'theme-library' | 'logo-icon' | 'typography' | 'interface'
  | 'motion-sound' | 'window' | 'player-layout' | 'stream-badges' | 'badge-rules' | 'badge-packs' | 'award-icons'
  // 7. Controls & devices
  | 'keyboard-shortcuts' | 'keyboard-behavior' | 'controller' | 'buttons-sticks' | 'remotes'
  | 'tv-devices' | 'tv-appearance' | 'tv-playback' | 'tv-content' | 'big-picture'
  // 8. System
  | 'storage-overview' | 'stream-cache' | 'caches' | 'notification-destinations' | 'notification-sources'
  | 'downloads-folders' | 'startup-system' | 'privacy-discord' | 'repair-diagnostics' | 'custom-code' | 'about'
  // 9. Help & about
  | 'report-bug' | 'licenses-attribution' | 'icons-animation'
  // 10. Updates & backup
  | 'updates-backup';

export type SettingsCategoryId =
  | 'account-setup' | 'playback' | 'languages' | 'sources-library' | 'plugins'
  | 'appearance' | 'controls-devices' | 'system' | 'help-about';

export interface HomeServerEntry { id: string; kind: 'jellyfin' | 'emby' | 'plex'; name: string; url: string; apiKey: string; }
export interface StreamFilterPreset {
  id: string; name: string; minRes: string; maxRes: string; hdrOnly: boolean;
  audioCodec: string; maxSizeGb: number; excludeKeywords: string;
}
export interface BadgeRule { id: string; name: string; pattern: string; imageUrl: string; prioritize: boolean; }
export interface AutomationRule { id: string; event: 'new-episode' | 'upcoming' | 'watchlist'; destination: 'desktop' | 'discord' | 'telegram'; enabled: boolean; }

export interface SettingsState {
  account: {
    profileMode: 'shared' | 'independent';
    secondaryPrivileges: {
      editOwnProfile: boolean;
      startupDefaults: boolean;
      manageExternalProviders: boolean;
      signOutFromMenu: boolean;
    };
    profileSongsMode: 'auto' | 'manual' | 'never';
    addonInstallLinks: boolean;
    sportsLive: boolean;
    sportsSchedules: boolean;
    sportsConsentAccepted: boolean;
    letterboxdMode: 'public' | 'full';
    letterboxdUsername: string;
    letterboxdScrobble: boolean;
    letterboxdLogWatches: boolean;
    letterboxdListSync: boolean;
    traktShowComments: boolean;
    traktHideCommentsDefault: boolean;
    relayServerUrl: string;
    relayAccessKey: string;
  };
  playback: {
    engine: 'auto' | 'html5' | 'mpv';
    pipStyle: 'window' | 'mini';
    playLooksFirst: 'online' | 'local' | 'ask';
    pressPlayMode: 'instant' | 'pick';
    stayOnSourceSession: boolean;
    instantPrep: boolean;
    rememberLastStream: boolean;
    resumeLeftOff: boolean;
    promptBeforeResume: boolean;
    autoSkipStalled: boolean;
    keepSameSourceNext: boolean;
    downloadWholeFile: boolean;
    externalMpv: boolean;
    embedMpv: boolean;
    hdrMode: 'sdr' | 'hdr-window' | 'hdr-embedded';
    displayPanel: 'auto' | 'oled' | 'lcd';
    rtxVideoHdr: boolean;
    rtxVsr: boolean;
    deviceCompat: 'auto' | 'transcode' | 'direct';
    internetSpeedCap: 'unlimited' | '10' | '25' | '50' | '100' | '300' | '1000';
    cleanMode: boolean;
    aspectRatio: 'fit' | 'fill' | 'stretch' | '16:9' | '4:3' | '21:9' | '1.85:1' | '2.39:1';
    normalizeLoudness: boolean;
    mixSurroundStereo: boolean;
    equalizer: 'off' | 'bass' | 'vocal' | 'less-bass' | 'night';
    maxVolumeBoost: 100 | 150 | 200 | 250 | 300 | 400;
    outputDevice: string;
    streamQualityInPlayer: boolean;
    showControlsOnKeyboardPause: boolean;
    sleepTimerInTopBar: boolean;
    fullscreenClass: 'true' | 'borderless';
    stayFullscreenAfterClose: boolean;
    restoreWindowPos: boolean;
    volumePopup: boolean;
    volumePopupPos: 'top' | 'top-left' | 'top-right';
    xrayEnabled: boolean;
    adSkipEnabled: boolean;
    showSkipButton: boolean;
    autoSkipIntros: boolean;
    autoSkipRecaps: boolean;
    autoSkipCredits: boolean;
    hideSkipAfter: 'off' | '5' | '10' | '15' | '30';
    introDbKey: string;
    nextEpisodePrompt: 'auto' | 'off' | '30' | '60' | '90';
    autoPlayNext: boolean;
    stillWatchingPrompt: boolean;
    autoPlayPlaylist: boolean;
    moreLikeThisOffset: string;
    hideWatchedUpNext: boolean;
    stillAiringNext: boolean;
    upNextCountdown: boolean;
    upNextCountdownLen: 5 | 10 | 15 | 20 | 30;
    upNextEndBehavior: 'move' | 'stay';
    trailerQuality: 'auto' | '2160' | '1080' | '720' | '480';
    autoPlayTrailerDetail: boolean;
    scrollUpTrailer: boolean;
    videoQualityPreset: 'weak' | 'balanced' | 'max';
    hwAccel: 'force' | 'cpu';
    renderer: 'gpu-next' | 'gpu';
    simpleColorMode: boolean;
    picture: {
      brightness: number; contrast: number; saturation: number; gamma: number; sharpen: number;
      toneMapping: 'auto' | 'bt.2446a' | 'bt.2390' | 'hable' | 'mobius' | 'reinhard' | 'spline';
      boostSdrToHdr: boolean;
    };
    bufferSize: 'auto' | 'small' | 'medium' | 'large' | 'max';
    customMpvConf: string;
    anime4kEnabled: boolean;
    anime4kOnlyAnime: boolean;
    anime4kIndicator: boolean;
    anime4kTier: 'quality' | 'performance';
    anime4kMode: 'A' | 'B' | 'C' | 'AA' | 'BB' | 'CA';
    shadersInstalled: boolean;
    enabledShaders: Record<string, boolean>;
    mangaFast2x: boolean;
    motionSmoothing: boolean;
    svpEnabled: boolean;
    svpTarget: 'all' | 'anime' | 'movies-tv';
    svpRate: 'double' | '60' | '120' | 'display';
  };
  languages: {
    region: string;
    displayLanguage: string;
    metadataLang: string;
    translateTitles: boolean;
    translateOverviews: boolean;
    animeTitleLang: 'english' | 'romaji' | 'native';
    artworkLanguages: string[];
    audioPriority: string[];
    skipTrackKeywordsEnabled: boolean;
    skipTrackKeywords: string[];
    discoveryHomeCatalogs: string[];
    fewerLocalTitles: boolean;
    streamRankingLangs: string[];
    onlyShowMyLangStreams: boolean;
    subtitlePriority: string[];
    secondSubtitleLang: string;
    preferEmbeddedSubs: boolean;
    forcedSubsWithNative: boolean;
    upgradeBetterSubs: boolean;
    startWithSubsOn: boolean;
    chooseSubsBeforePlay: boolean;
    subIndicatorDot: boolean;
    subSources: { opensubtitles: boolean; subdl: boolean; addons: boolean; subsource: boolean };
    subLanguageOrder: string;
    subAutoSync: boolean;
    subSyncModelDownloaded: boolean;
    subPrivateMode: boolean;
    subFilterSdh: boolean;
    subStyle: {
      font: string;
      background: 'outline' | 'shadow' | 'bar';
      outlinePx: number;
      sizePct: number;
      bold: boolean;
      opacityPct: number;
      bottomPct: number;
      align: 'left' | 'center' | 'right';
      color: string;
    };
  };
  sources: {
    usenetEasynewsUrl: string;
    enabledCatalogs: Record<string, boolean>;
    homeServers: HomeServerEntry[];
    safetyFilter: 'strict' | 'balanced' | 'off';
    preferAnimeFansub: boolean;
    addonWaitSec: 5 | 10 | 15 | 30 | 45;
    resultOrder: 'smart' | 'addon';
    streamPriorityOrder: string[];
    aggregateAddons: boolean;
    pickerLayout: 'condensed' | 'cards';
    sourceMode: 'both' | 'debrid' | 'p2p';
    moveRefreshNextToBack: boolean;
    showReleaseName: boolean;
    showFullDescriptions: boolean;
    savedFilters: StreamFilterPreset[];
    activeFilterId: string;
    p2p: {
      showStatusChip: boolean;
      keepDownloadingAfterLeave: boolean;
      onlyStartWhenNeeded: boolean;
      disableEntirely: boolean;
      localCaching: boolean;
      autoConfirmP2P: boolean;
    };
    streamingServerRunning: boolean;
    remoteServerUrl: string;
    homeHeroSource: 'trending' | 'popular' | 'watchlist' | 'off';
    homeFullHeroBanner: boolean;
    homeFullQualityHero: boolean;
    homeHideWatchedHero: boolean;
    homePlayTrailersHero: boolean;
    homeHeroShadowPct: number;
    homeStyle: 'hero' | 'classic';
    showNewEpisodesRow: boolean;
    hideBuiltInCatalogs: boolean;
    hideWatchedCatalogs: boolean;
    hideUnreleasedCatalogs: boolean;
    watchlistSavedOnly: boolean;
    cwAdvanceNextEp: boolean;
    cwLatestEndBehavior: 'hide' | 'stay';
    cwCardStyle: 'wide' | 'card' | 'poster';
    cwClickBehavior: 'stream' | 'details' | 'details_upcoming';
    cwResumePrompt: boolean;
    cwSplitUpcoming: boolean;
    cwUnfinishedEps: boolean;
    cwAnimeOnlyRoom: boolean;
    cwPrivatePerProfile: boolean;
    cwSources: { appLibrary: boolean; downloads: boolean; trakt: boolean; simkl: boolean; publicmetadb: boolean };
    showPlaylistsTab: boolean;
    smoothScrolling: boolean;
    cwFrameRetentionDays: 7 | 30 | 90;
    cwFrameQuality: 'balanced' | 'high';
    cwPreferEpisodeStill: boolean;
    cards: {
      showLogo: boolean;
      awardMode: 'badge' | 'none';
      top10Ribbon: boolean;
      watchlistBookmark: boolean;
      bookmarkCorner: 'tl' | 'tr' | 'bl' | 'br';
      watchedBadge: boolean;
      onDiskBadge: boolean;
      animeDubBadge: boolean;
      scoreProviders: Record<string, { cards: boolean; details: boolean }>;
      scorePosition: 'top' | 'bottom';
      maxScoresPerCard: number;
      animeControlSource: 'anilist' | 'mal';
      hideTitles: boolean;
      identifyCurrentSong: boolean;
      peekOnHover: boolean;
      shineOnHover: boolean;
    };
    details: {
      markWatchedBtn: boolean;
      rememberPlace: boolean;
      cycleBackdrop: boolean;
      softenBackdrop: boolean;
      hideSpoilers: boolean;
      blurSpoilers: boolean;
      showImdbOnEps: boolean;
      showEpDescription: boolean;
      epCardSize: 'default' | 'large' | 'xl';
      hqEpImages: boolean;
      hideSkipEpisodes: boolean;
      filterFiller: boolean;
    };
    metadata: {
      sportsApiKey: string;
      gameAgeRating: 'ESRB' | 'PEGI';
      useScreenshotsMissingArt: boolean;
      useCoversLibraryIcons: boolean;
      builtInMetadata: boolean;
      useTmdbTopMatch: boolean;
      useFallbackMeta: boolean;
      allowDetailsWithoutTmdb: boolean;
      episodeOrder: 'tvdb' | 'tmdb';
      seasonExplorer: boolean;
      richSeasonPanel: boolean;
      songIdProvider: 'audd' | 'acoustid' | 'disabled';
      songIdKey: string;
      omdbDailyBudget: number;
    };
    search: {
      quickShortcut: boolean;
      aiProvider: 'openrouter' | 'openai' | 'deepseek' | 'gemini' | 'ollama';
      aiApiKey: string;
      aiModel: string;
      aiCustomModel: string;
      jinaReader: boolean;
      tavily: boolean;
      liveSearchSource: 'auto' | 'duckduckgo' | 'tavily';
    };
    library: {
      hideAnime: boolean;
      hideAdult: boolean;
      keepLocalUpToDate: boolean;
      minFileSizeMb: number;
      exportArtwork: boolean;
      posterQuality: 'original' | 'high' | 'medium';
      backdropQuality: 'original' | 'high' | 'medium';
      logoQuality: 'original' | 'high' | 'medium';
    };
  };
  plugins: {
    enabled: boolean;
    showInCatalogs: boolean;
    groupByRepo: boolean;
    hideBackgroundDetails: boolean;
    showLanguageOnPosters: boolean;
    showQualityOnPosters: boolean;
    waitTimeSec: number;
    repositories: { id: string; url: string; lastChecked: number }[];
    checkReposDaily: boolean;
  };
  appearance: {
    themePreset: 'default' | 'nord' | 'obsidian' | 'roast' | 'dracula' | 'forest' | 'noir' | 'custom';
    customAccent: string;
    backgroundImageDataUrl: string;
    backgroundDimPct: number;
    customLogoDataUrl: string;
    wordmarkDataUrl: string;
    appIconPreset: 'majlis-gold' | 'minimal-dark' | 'classic-ruby' | 'emerald';
    albumArtAsIcon: boolean;
    fontFamily: 'IBM Plex Sans Arabic' | 'Inter' | 'Outfit' | 'Plus Jakarta Sans' | 'Geist' | 'System UI';
    quickLibrary: boolean;
    openGamesInLib: boolean;
    posterStyle: 'poster' | 'tv';
    posterSizePct: number;
    posterRadiusPx: number;
    posterLoadEffect: 'blur' | 'instant';
    posterQuality: 'balanced' | 'high' | 'max';
    focusedCard: boolean;
    expandingCards: boolean;
    cardTitleSizePct: number;
    playerTitleSizePct: number;
    useTitleArtworkPlayer: boolean;
    seriesNameFirstPlayer: boolean;
    uiScalePct: number;
    liquidGlass: boolean;
    animatedSidebarIcons: boolean;
    ambientScreensaver: boolean;
    screensaverStyle: 'default' | 'posters' | 'minimal';
    screensaverAfterMin: 2 | 5 | 10 | 15;
    soundEffects: 'off' | 'subtle' | 'cinematic' | 'retro';
    nativeTitleBar: boolean;
    nativeStyleTopBar: boolean;
    topBarStyle: 'translucent' | 'glass' | 'solid';
    floatTopBarScroll: boolean;
    dragAnywhere: boolean;
    playerLayout: {
      profileName: string;
      playerTheme: 'default' | 'match' | 'custom';
      ignoreThemeTints: boolean;
      showControlLock: boolean;
      timeFormat: 'elapsed-total' | 'elapsed-remaining' | 'elapsed-only';
      volumeControl: 'slider' | 'vertical' | 'stepper' | 'icon';
      advisoryTheme: 'colored' | 'monochrome';
      showIgnoreButton: boolean;
      fullscreenClock: boolean;
      hoverThumbPreview: boolean;
      seekStyle: 'pinstripe' | 'boldline';
      seekHeightPx: number;
      seekColor: string;
      revealDotHover: boolean;
      bufferFill: boolean;
      bufferBrightnessPct: number;
      seekDotShape: 'circle' | 'square' | 'custom';
      seekDotSizePx: number;
      visibleControls: string[];
    };
    showStreamFormatChips: boolean;
    enabledBadges: Record<string, boolean>;
    badgeRules: BadgeRule[];
    awardsCustomIcons: Record<string, string>;
  };
  controls: {
    shortcuts: Record<string, string>;
    tvNav: boolean;
    tvNavPlayer: boolean;
    escExitsFullscreenFirst: boolean;
    askBeforeLeaving: boolean;
    seekBackSec: 5 | 10 | 15 | 30;
    seekFwdSec: 5 | 10 | 15 | 30;
    shortSeekSec: 1 | 3 | 5;
    controllerEnabled: boolean;
    controllerBackground: boolean;
    showControllerCursor: boolean;
    cursorShape: 'dot' | 'ring' | 'pointer' | 'feather' | 'custom';
    cursorSizePx: number;
    cursorIdleHideSec: number;
    stickDeadzonePct: number;
    repeatSpeedMs: number;
    initialDelayMs: number;
    serveRemoteNetwork: boolean;
    tvAppearance: {
      theme: string;
      subPreset: 'default' | 'large' | 'cinema' | 'minimal';
      subSize: number;
      subOpacity: number;
      subEdge: 'shadow' | 'outline' | 'box';
      edgeMargin: 'off' | '2%' | '3.5%' | '5%';
      backdropDetail: 'balanced' | 'high';
      fadeBackdrops: boolean;
    };
    tvPlayback: {
      homeLayout: 'classic' | 'modern';
      hideWatched: boolean;
      heroTrailerPreview: boolean;
      titleLang: string;
      instantPlay: boolean;
      minimalSourceRows: boolean;
      autoPlayNext: boolean;
      stillWatchingAfter: number;
      skipIntrosCredits: boolean;
      hideSkipAfter: number;
      showClockWhilePlaying: boolean;
      showEpRatings: boolean;
      showEpDescriptions: boolean;
      hideEpThumbnails: boolean;
    };
    bigPictureStart: boolean;
    bigPictureButton: boolean;
    bigPictureAnimatedBackdrop: boolean;
    bigPictureSounds: 'off' | 'subtle' | 'modern' | 'cinematic' | 'retro';
    bigPictureEdgeMargin: 'off' | '2%' | '3.5%' | '5%';
  };
  system: {
    keepCachedDays: 1 | 3 | 7 | 0;
    maxCacheGb: 5 | 10 | 25 | 0;
    deleteCacheAfterWatch: boolean;
    cachePath: string;
    desktopNotifications: boolean;
    discordWebhookUrl: string;
    telegramBotToken: string;
    telegramChatId: string;
    automations: AutomationRule[];
    organizeDownloads: boolean;
    extrasFolderPath: string;
    extrasSubfolders: boolean;
    closeToTray: boolean;
    minimizeToTray: boolean;
    startMinimized: boolean;
    launchOnStartup: boolean;
    alwaysOnTop: boolean;
    pauseOnMinimize: boolean;
    pauseOnFocusLost: boolean;
    graphicsBackend: 'auto' | 'd3d' | 'opengl' | 'vulkan' | 'software';
    blockAdsTrackers: boolean;
    discordRpc: {
      enabled: boolean;
      hideTitle: boolean;
      showPaused: boolean;
      showBrowsing: boolean;
      showPoster: boolean;
      showElapsed: boolean;
      showListening: boolean;
      hideMusicPaused: boolean;
      watchPartyPresence: boolean;
    };
    customCodeRevealed: boolean;
    customCss: string;
    customJs: string;
    customHtmlOverlay: string;
  };
  updates: {
    betaChannel: boolean;
    buildFeedback: 'worse' | 'same' | 'better' | null;
  };
}

export const DEFAULT_SCORE_PROVIDERS: Record<string, { cards: boolean; details: boolean }> = {
  IMDb: { cards: true, details: true },
  TMDB: { cards: false, details: true },
  'Rotten Tomatoes': { cards: true, details: true },
  Audience: { cards: false, details: true },
  Metacritic: { cards: false, details: true },
  Letterboxd: { cards: false, details: true },
  MDBList: { cards: false, details: true },
  Trakt: { cards: false, details: true },
  SIMKL: { cards: false, details: true },
  MAL: { cards: true, details: true },
};

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  'global.search': '/',
  'global.settings': 'Ctrl+,',
  'global.scaleUp': 'Ctrl+=',
  'global.scaleDown': 'Ctrl+-',
  'global.scaleReset': 'Ctrl+0',
  'player.close': 'Escape',
  'player.playPause': 'Space',
  'player.fullscreen': 'F',
  'player.pip': 'P',
  'player.lock': 'L',
  'player.stats': 'I',
  'player.aspect': 'A',
  'player.screenshot': 'S',
  'player.gif': 'G',
  'player.clip': 'Q',
  'player.anime4k': 'Ctrl+Shift+4',
  'player.rtx': 'Ctrl+Shift+H',
  'seek.back': 'ArrowLeft',
  'seek.fwd': 'ArrowRight',
  'seek.shortBack': 'Shift+ArrowLeft',
  'seek.shortFwd': 'Shift+ArrowRight',
  'seek.back30': 'PageDown',
  'seek.fwd30': 'PageUp',
  'seek.prevFrame': ',',
  'seek.nextFrame': '.',
  'seek.start': 'Home',
  'seek.end': 'End',
  'av.volUp': 'ArrowUp',
  'av.volDown': 'ArrowDown',
  'av.mute': 'M',
  'av.cycleSubs': 'V',
  'av.subDelayMinus': 'Z',
  'av.subDelayPlus': 'X',
  'av.cycleAudio': 'B',
  'ep.next': 'N',
  'ep.prev': 'Shift+N',
  'ep.speedUp': ']',
  'ep.speedDown': '[',
  'ep.sources': 'K',
  'ep.upNext': 'U',
  'ep.sleepTimer': 'T',
  'ep.reload': 'R',
};

export const AI_PROVIDER_DEFAULT_MODELS: Record<SettingsState['sources']['search']['aiProvider'], string> = {
  openrouter: 'openrouter/auto',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.2',
};

export function createDefaultSettings(): SettingsState {
  return {
    account: {
      profileMode: 'shared',
      secondaryPrivileges: {
        editOwnProfile: true, startupDefaults: true,
        manageExternalProviders: true, signOutFromMenu: true,
      },
      profileSongsMode: 'auto',
      addonInstallLinks: true,
      sportsLive: false,
      sportsSchedules: false,
      sportsConsentAccepted: false,
      letterboxdMode: 'public',
      letterboxdUsername: '',
      letterboxdScrobble: true,
      letterboxdLogWatches: true,
      letterboxdListSync: false,
      traktShowComments: true,
      traktHideCommentsDefault: false,
      relayServerUrl: '',
      relayAccessKey: '',
    },
    playback: {
      engine: 'auto',
      pipStyle: 'window',
      playLooksFirst: 'online',
      pressPlayMode: 'pick',
      stayOnSourceSession: true,
      instantPrep: true,
      rememberLastStream: true,
      resumeLeftOff: true,
      promptBeforeResume: false,
      autoSkipStalled: true,
      keepSameSourceNext: true,
      downloadWholeFile: false,
      externalMpv: false,
      embedMpv: true,
      hdrMode: 'sdr',
      displayPanel: 'auto',
      rtxVideoHdr: false,
      rtxVsr: false,
      deviceCompat: 'auto',
      internetSpeedCap: 'unlimited',
      cleanMode: false,
      aspectRatio: 'fit',
      normalizeLoudness: false,
      mixSurroundStereo: true,
      equalizer: 'off',
      maxVolumeBoost: 150,
      outputDevice: 'system-default',
      streamQualityInPlayer: true,
      showControlsOnKeyboardPause: true,
      sleepTimerInTopBar: true,
      fullscreenClass: 'borderless',
      stayFullscreenAfterClose: false,
      restoreWindowPos: true,
      volumePopup: true,
      volumePopupPos: 'top',
      xrayEnabled: false,
      adSkipEnabled: false,
      showSkipButton: true,
      autoSkipIntros: false,
      autoSkipRecaps: false,
      autoSkipCredits: false,
      hideSkipAfter: '10',
      introDbKey: '',
      nextEpisodePrompt: 'auto',
      autoPlayNext: true,
      stillWatchingPrompt: true,
      autoPlayPlaylist: true,
      moreLikeThisOffset: '30s',
      hideWatchedUpNext: true,
      stillAiringNext: true,
      upNextCountdown: true,
      upNextCountdownLen: 15,
      upNextEndBehavior: 'move',
      trailerQuality: '1080',
      autoPlayTrailerDetail: false,
      scrollUpTrailer: true,
      videoQualityPreset: 'balanced',
      hwAccel: 'force',
      renderer: 'gpu-next',
      simpleColorMode: false,
      picture: { brightness: 0, contrast: 0, saturation: 0, gamma: 0, sharpen: 0, toneMapping: 'auto', boostSdrToHdr: false },
      bufferSize: 'auto',
      customMpvConf: '# Custom mpv options\n',
      anime4kEnabled: false,
      anime4kOnlyAnime: true,
      anime4kIndicator: true,
      anime4kTier: 'quality',
      anime4kMode: 'A',
      shadersInstalled: false,
      enabledShaders: {
        fsrcnnx: false, ravu: false, nnedi3: false, fsr: false, nis: false,
        sgsr: false, ssim: false, krig: false, adaptive: false, cas: false, hdrtoys: false,
      },
      mangaFast2x: false,
      motionSmoothing: false,
      svpEnabled: false,
      svpTarget: 'anime',
      svpRate: '60',
    },
    languages: {
      region: 'SA',
      displayLanguage: 'ar',
      metadataLang: 'ar',
      translateTitles: false,
      translateOverviews: true,
      animeTitleLang: 'english',
      artworkLanguages: ['English', 'Original'],
      audioPriority: ['English', 'Arabic', 'Japanese'],
      skipTrackKeywordsEnabled: true,
      skipTrackKeywords: ['commentary', 'audio description'],
      discoveryHomeCatalogs: [],
      fewerLocalTitles: false,
      streamRankingLangs: ['Arabic', 'English'],
      onlyShowMyLangStreams: false,
      subtitlePriority: ['Arabic', 'English'],
      secondSubtitleLang: 'off',
      preferEmbeddedSubs: true,
      forcedSubsWithNative: true,
      upgradeBetterSubs: true,
      startWithSubsOn: true,
      chooseSubsBeforePlay: false,
      subIndicatorDot: true,
      subSources: { opensubtitles: true, subdl: true, addons: true, subsource: false },
      subLanguageOrder: 'priority',
      subAutoSync: true,
      subSyncModelDownloaded: true,
      subPrivateMode: false,
      subFilterSdh: false,
      subStyle: { font: 'Segoe UI', background: 'outline', outlinePx: 3, sizePct: 100, bold: false, opacityPct: 95, bottomPct: 8, align: 'center', color: '#FFFFFF' },
    },
    sources: {
      usenetEasynewsUrl: '',
      enabledCatalogs: { Netflix: true, 'Disney+': true, 'Prime Video': true, 'Apple TV+': true, Max: true, Crunchyroll: true, Hulu: false, Peacock: false },
      homeServers: [],
      safetyFilter: 'strict',
      preferAnimeFansub: true,
      addonWaitSec: 15,
      resultOrder: 'smart',
      streamPriorityOrder: ['Debrid Instant', 'Torrentio / Indexers', 'Home Media Server', 'Direct HTTP'],
      aggregateAddons: true,
      pickerLayout: 'condensed',
      sourceMode: 'both',
      moveRefreshNextToBack: false,
      showReleaseName: true,
      showFullDescriptions: false,
      savedFilters: [
        { id: 'default', name: 'No filter', minRes: '720p', maxRes: '4K', hdrOnly: false, audioCodec: 'any', maxSizeGb: 0, excludeKeywords: '' },
      ],
      activeFilterId: 'default',
      p2p: {
        showStatusChip: true, keepDownloadingAfterLeave: false, onlyStartWhenNeeded: true,
        disableEntirely: false, localCaching: true, autoConfirmP2P: false,
      },
      streamingServerRunning: true,
      remoteServerUrl: '',
      homeHeroSource: 'trending',
      homeFullHeroBanner: true,
      homeFullQualityHero: true,
      homeHideWatchedHero: false,
      homePlayTrailersHero: true,
      homeHeroShadowPct: 78,
      homeStyle: 'hero',
      showNewEpisodesRow: true,
      hideBuiltInCatalogs: false,
      hideWatchedCatalogs: false,
      hideUnreleasedCatalogs: false,
      watchlistSavedOnly: false,
      cwAdvanceNextEp: true,
      cwLatestEndBehavior: 'hide',
      cwCardStyle: 'wide',
      cwClickBehavior: 'stream',
      cwResumePrompt: false,
      cwSplitUpcoming: true,
      cwUnfinishedEps: true,
      cwAnimeOnlyRoom: false,
      cwPrivatePerProfile: false,
      cwSources: { appLibrary: true, downloads: true, trakt: true, simkl: false, publicmetadb: false },
      showPlaylistsTab: true,
      smoothScrolling: true,
      cwFrameRetentionDays: 30,
      cwFrameQuality: 'high',
      cwPreferEpisodeStill: true,
      cards: {
        showLogo: false, awardMode: 'badge', top10Ribbon: true, watchlistBookmark: true,
        bookmarkCorner: 'tr', watchedBadge: true, onDiskBadge: true, animeDubBadge: true,
        scoreProviders: DEFAULT_SCORE_PROVIDERS, scorePosition: 'top', maxScoresPerCard: 2,
        animeControlSource: 'anilist', hideTitles: false, identifyCurrentSong: true, peekOnHover: true, shineOnHover: true,
      },
      details: {
        markWatchedBtn: true, rememberPlace: true, cycleBackdrop: false, softenBackdrop: true,
        hideSpoilers: false, blurSpoilers: true, showImdbOnEps: true, showEpDescription: true,
        epCardSize: 'default', hqEpImages: true, hideSkipEpisodes: false, filterFiller: false,
      },
      metadata: {
        sportsApiKey: '', gameAgeRating: 'ESRB', useScreenshotsMissingArt: true, useCoversLibraryIcons: true,
        builtInMetadata: true, useTmdbTopMatch: true, useFallbackMeta: true, allowDetailsWithoutTmdb: true,
        episodeOrder: 'tmdb', seasonExplorer: true, richSeasonPanel: true,
        songIdProvider: 'audd', songIdKey: '', omdbDailyBudget: 500,
      },
      search: {
        quickShortcut: true, aiProvider: 'openrouter', aiApiKey: '', aiModel: 'openrouter/auto',
        aiCustomModel: '', jinaReader: false, tavily: false, liveSearchSource: 'auto',
      },
      library: {
        hideAnime: false, hideAdult: true, keepLocalUpToDate: true, minFileSizeMb: 50,
        exportArtwork: false, posterQuality: 'high', backdropQuality: 'high', logoQuality: 'high',
      },
    },
    plugins: {
      enabled: true, showInCatalogs: true, groupByRepo: true, hideBackgroundDetails: false,
      showLanguageOnPosters: true, showQualityOnPosters: true, waitTimeSec: 15,
      repositories: [], checkReposDaily: true,
    },
    appearance: {
      themePreset: 'default',
      customAccent: '#E5A93C',
      backgroundImageDataUrl: '',
      backgroundDimPct: 65,
      customLogoDataUrl: '',
      wordmarkDataUrl: '',
      appIconPreset: 'majlis-gold',
      albumArtAsIcon: true,
      fontFamily: 'IBM Plex Sans Arabic',
      quickLibrary: true,
      openGamesInLib: false,
      posterStyle: 'poster',
      posterSizePct: 100,
      posterRadiusPx: 14,
      posterLoadEffect: 'blur',
      posterQuality: 'high',
      focusedCard: true,
      expandingCards: false,
      cardTitleSizePct: 100,
      playerTitleSizePct: 100,
      useTitleArtworkPlayer: true,
      seriesNameFirstPlayer: true,
      uiScalePct: 100,
      liquidGlass: true,
      animatedSidebarIcons: true,
      ambientScreensaver: false,
      screensaverStyle: 'default',
      screensaverAfterMin: 5,
      soundEffects: 'subtle',
      nativeTitleBar: false,
      nativeStyleTopBar: false,
      topBarStyle: 'translucent',
      floatTopBarScroll: true,
      dragAnywhere: false,
      playerLayout: {
        profileName: 'Default Theater',
        playerTheme: 'default',
        ignoreThemeTints: false,
        showControlLock: true,
        timeFormat: 'elapsed-total',
        volumeControl: 'slider',
        advisoryTheme: 'colored',
        showIgnoreButton: true,
        fullscreenClock: true,
        hoverThumbPreview: true,
        seekStyle: 'boldline',
        seekHeightPx: 4,
        seekColor: '#E5A93C',
        revealDotHover: true,
        bufferFill: true,
        bufferBrightnessPct: 35,
        seekDotShape: 'circle',
        seekDotSizePx: 14,
        visibleControls: ['play', 'seek', 'volume', 'time', 'subtitles', 'audio', 'streams', 'speed', 'night', 'aspect', 'pip', 'fullscreen'],
      },
      showStreamFormatChips: true,
      enabledBadges: { '4K': true, '1080p': true, 'REMUX': true, 'WEB-DL': true, 'DV': true, 'HDR10': true, 'Atmos': true, 'HEVC': true, 'AV1': true },
      badgeRules: [
        { id: 'rule-dv', name: 'Dolby Vision', pattern: '\\b(DoVi|DV|Dolby\\.?Vision)\\b', imageUrl: '', prioritize: true },
        { id: 'rule-remux', name: 'Bluray Remux', pattern: '\\bREMUX\\b', imageUrl: '', prioritize: true },
      ],
      awardsCustomIcons: {},
    },
    controls: {
      shortcuts: DEFAULT_SHORTCUTS,
      tvNav: false,
      tvNavPlayer: false,
      escExitsFullscreenFirst: true,
      askBeforeLeaving: false,
      seekBackSec: 10,
      seekFwdSec: 10,
      shortSeekSec: 3,
      controllerEnabled: true,
      controllerBackground: false,
      showControllerCursor: true,
      cursorShape: 'dot',
      cursorSizePx: 18,
      cursorIdleHideSec: 3,
      stickDeadzonePct: 18,
      repeatSpeedMs: 120,
      initialDelayMs: 400,
      serveRemoteNetwork: false,
      tvAppearance: { theme: 'default', subPreset: 'default', subSize: 110, subOpacity: 95, subEdge: 'shadow', edgeMargin: '3.5%', backdropDetail: 'balanced', fadeBackdrops: true },
      tvPlayback: {
        homeLayout: 'modern', hideWatched: false, heroTrailerPreview: true, titleLang: 'ar', instantPlay: false,
        minimalSourceRows: true, autoPlayNext: true, stillWatchingAfter: 3, skipIntrosCredits: true, hideSkipAfter: 10,
        showClockWhilePlaying: true, showEpRatings: true, showEpDescriptions: true, hideEpThumbnails: false,
      },
      bigPictureStart: false,
      bigPictureButton: true,
      bigPictureAnimatedBackdrop: true,
      bigPictureSounds: 'subtle',
      bigPictureEdgeMargin: '3.5%',
    },
    system: {
      keepCachedDays: 7,
      maxCacheGb: 5,
      deleteCacheAfterWatch: false,
      cachePath: '%LOCALAPPDATA%\\Majlis\\cache',
      desktopNotifications: true,
      discordWebhookUrl: '',
      telegramBotToken: '',
      telegramChatId: '',
      automations: [
        { id: 'auto-1', event: 'new-episode', destination: 'desktop', enabled: true },
      ],
      organizeDownloads: true,
      extrasFolderPath: '',
      extrasSubfolders: true,
      closeToTray: false,
      minimizeToTray: false,
      startMinimized: false,
      launchOnStartup: false,
      alwaysOnTop: false,
      pauseOnMinimize: false,
      pauseOnFocusLost: false,
      graphicsBackend: 'auto',
      blockAdsTrackers: true,
      discordRpc: {
        enabled: true, hideTitle: false, showPaused: true, showBrowsing: true,
        showPoster: true, showElapsed: true, showListening: true, hideMusicPaused: true, watchPartyPresence: true,
      },
      customCodeRevealed: false,
      customCss: '/* Optional custom CSS rules */\n',
      customJs: '// Optional custom JavaScript snippet\n',
      customHtmlOverlay: '',
    },
    updates: {
      betaChannel: false,
      buildFeedback: null,
    },
  };
}

interface SettingsStore {
  data: SettingsState;
  activePage: SettingsPageId;
  searchQuery: string;
  hydrated: boolean;
  setActivePage: (p: SettingsPageId) => void;
  setSearchQuery: (q: string) => void;
  update: (updater: (s: SettingsState) => void) => void;
  hydrateFromBackend: () => Promise<void>;
  exportSettingsJson: () => string;
  importSettingsJson: (raw: string) => { ok: boolean; changedCount: number; error?: string };
  applySettingsSnapshot: (incoming: Record<string, unknown>) => void;
  resetPageSection: (section: keyof SettingsState) => void;
  resetAll: () => void;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const LANG_TO_ISO3: Record<string, string> = {
  off: 'off', Arabic: 'ara', English: 'eng', Japanese: 'jpn', French: 'fre', Spanish: 'spa',
  German: 'ger', Turkish: 'tur', Korean: 'kor', Italian: 'ita', Portuguese: 'por', Russian: 'rus', Chinese: 'chi',
};
const ISO_TO_LANG: Record<string, string> = {
  off: 'off', ar: 'Arabic', ara: 'Arabic', en: 'English', eng: 'English', ja: 'Japanese', jpn: 'Japanese',
  fr: 'French', fre: 'French', fra: 'French', es: 'Spanish', spa: 'Spanish', de: 'German', ger: 'German', deu: 'German',
  tr: 'Turkish', tur: 'Turkish', ko: 'Korean', kor: 'Korean', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese',
  ru: 'Russian', rus: 'Russian', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
};

// Push relevant changes cleanly to Majlis IPC store without sending auto-relaunch keys (server/accessKey)
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBackendSync(next: SettingsState) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const winPatch = {
      closeToTray: next.system.closeToTray,
      minimizeToTray: next.system.minimizeToTray,
      startMinimized: next.system.startMinimized,
      launchOnStartup: next.system.launchOnStartup,
      alwaysOnTop: next.system.alwaysOnTop,
      pauseOnMinimize: next.system.pauseOnMinimize,
      pauseOnFocusLost: next.system.pauseOnFocusLost,
      subDelayStep: next.controls.shortSeekSec,
      discordPresence: next.system.discordRpc.enabled,
      discordHideTitle: next.system.discordRpc.hideTitle,
      discordShowWhenPaused: next.system.discordRpc.showPaused,
      discordShowBrowsing: next.system.discordRpc.showBrowsing,
      discordShowPoster: next.system.discordRpc.showPoster,
      discordShowTimestamp: next.system.discordRpc.showElapsed,
      discordShowPartyJoin: next.system.discordRpc.watchPartyPresence,
      desktopNotifications: next.system.desktopNotifications,
      discordWebhookUrl: next.system.discordWebhookUrl,
      telegramBotToken: next.system.telegramBotToken,
      telegramChatId: next.system.telegramChatId,
      keepCachedDays: next.system.keepCachedDays,
      maxCacheGb: next.system.maxCacheGb,
      deleteCacheAfterWatch: next.system.deleteCacheAfterWatch,
      cachePath: next.system.cachePath,
      cinemaTheme: next.appearance.themePreset === 'default' ? 'majlis' : next.appearance.themePreset,
    };
    invoke('settings', winPatch).catch(() => {});
    const mirrorCopy = clone(next);
    mirrorCopy.sources.search.aiApiKey = '';
    mirrorCopy.system.discordWebhookUrl = '';
    mirrorCopy.system.telegramBotToken = '';
    invoke('backup:mirror', { settingsV2: mirrorCopy }).catch(() => {});

    const fallbackSub = next.languages.subtitlePriority.find((x) => x !== 'Arabic') || next.languages.subtitlePriority[0] || 'English';
    const sub2Name = next.languages.secondSubtitleLang === 'off' ? 'off' : (next.languages.secondSubtitleLang || fallbackSub);
    const themeName = next.appearance.themePreset === 'default' ? 'majlis' : next.appearance.themePreset;
    const validAccent = /^#[0-9a-f]{6}$/i.test(next.appearance.customAccent) ? next.appearance.customAccent : null;
    const prefPatch = {
      look: { theme: themeName, accent: validAccent },
      mediaVsr: next.playback.rtxVsr,
      autoNext: next.playback.autoPlayNext,
      mediaMaxHeight: next.playback.videoQualityPreset === 'max' ? 2160 : next.playback.videoQualityPreset === 'balanced' ? 1080 : 720,
      debridOnly: next.sources.sourceMode === 'debrid',
      cinemaHideWatched: next.sources.hideWatchedCatalogs,
      cinemaHideUnreleased: next.sources.hideUnreleasedCatalogs,
      cinemaAutoPlayTrailer: next.playback.autoPlayTrailerDetail,
      playerExternalMpv: next.playback.externalMpv,
      playerHwAccel: next.playback.hwAccel === 'force',
      playerHdr: next.playback.hdrMode !== 'sdr',
      playerToneMapping: next.playback.picture.toneMapping === 'auto' ? 'bt.2446a' : next.playback.picture.toneMapping,
      playerBufferSize: next.playback.bufferSize,
      playerAnime4k: next.playback.anime4kEnabled,
      playerAnime4kMode: next.playback.anime4kMode,
      playerCustomMpvConf: next.playback.customMpvConf,
      subLang2: LANG_TO_ISO3[sub2Name] || 'eng',
      subFilterSdh: next.languages.subFilterSdh,
      subAutoSync: next.languages.subAutoSync,
      subStyle: next.languages.subStyle,
      safetyFilter: next.sources.safetyFilter,
      resultOrder: next.sources.resultOrder,
      streamPriorityOrder: next.sources.streamPriorityOrder,
      sourceWaitSec: next.sources.addonWaitSec,
      autoSkipIntros: next.playback.autoSkipIntros,
      autoSkipRecaps: next.playback.autoSkipRecaps,
      autoSkipCredits: next.playback.autoSkipCredits,
      showSkipButton: next.playback.showSkipButton,
    };
    cin('prefs-set', prefPatch)
      .then(() => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('majlis-appearance-updated')); })
      .catch(() => {});
  }, 220);
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      data: createDefaultSettings(),
      activePage: 'get-started',
      searchQuery: '',
      hydrated: false,

      setActivePage: (activePage) => set({ activePage }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      update: (updater) => {
        const next = clone(get().data);
        updater(next);
        set({ data: next });
        scheduleBackendSync(next);
      },

      hydrateFromBackend: async () => {
        if (get().hydrated) return;
        try {
          const [rawCfg, prefs, keysRes] = await Promise.all([
            invoke<{ settings?: Record<string, unknown> }>('state').catch(() => null),
            cin<Record<string, unknown>>('prefs').catch(() => null),
            cin<{ user?: Record<string, string> }>('keys').catch(() => null),
          ]);
          const next = clone(get().data);
          const s = (rawCfg?.settings || rawCfg || {}) as Record<string, unknown>;
          if (typeof s.server === 'string') next.account.relayServerUrl = s.server;
          if (typeof s.closeToTray === 'boolean') next.system.closeToTray = s.closeToTray;
          if (typeof s.minimizeToTray === 'boolean') next.system.minimizeToTray = s.minimizeToTray;
          if (typeof s.startMinimized === 'boolean') next.system.startMinimized = s.startMinimized;
          if (typeof s.launchOnStartup === 'boolean') next.system.launchOnStartup = s.launchOnStartup;
          if (typeof s.alwaysOnTop === 'boolean') next.system.alwaysOnTop = s.alwaysOnTop;
          if (typeof s.pauseOnMinimize === 'boolean') next.system.pauseOnMinimize = s.pauseOnMinimize;
          if (typeof s.pauseOnFocusLost === 'boolean') next.system.pauseOnFocusLost = s.pauseOnFocusLost;
          if (typeof s.desktopNotifications === 'boolean') next.system.desktopNotifications = s.desktopNotifications;
          if (typeof s.discordWebhookUrl === 'string') next.system.discordWebhookUrl = s.discordWebhookUrl;
          if (typeof s.telegramBotToken === 'string') next.system.telegramBotToken = s.telegramBotToken;
          if (typeof s.telegramChatId === 'string') next.system.telegramChatId = s.telegramChatId;
          if (s.keepCachedDays === 0 || s.keepCachedDays === 1 || s.keepCachedDays === 3 || s.keepCachedDays === 7) next.system.keepCachedDays = s.keepCachedDays;
          if (s.maxCacheGb === 0 || s.maxCacheGb === 5 || s.maxCacheGb === 10 || s.maxCacheGb === 25) next.system.maxCacheGb = s.maxCacheGb;
          if (typeof s.deleteCacheAfterWatch === 'boolean') next.system.deleteCacheAfterWatch = s.deleteCacheAfterWatch;
          if (typeof s.cachePath === 'string' && s.cachePath) next.system.cachePath = s.cachePath;
          if (typeof s.discordPresence === 'boolean') next.system.discordRpc.enabled = s.discordPresence;
          if (typeof s.discordHideTitle === 'boolean') next.system.discordRpc.hideTitle = s.discordHideTitle;
          if (typeof s.discordShowWhenPaused === 'boolean') next.system.discordRpc.showPaused = s.discordShowWhenPaused;
          if (typeof s.discordShowBrowsing === 'boolean') next.system.discordRpc.showBrowsing = s.discordShowBrowsing;
          if (typeof s.discordShowPoster === 'boolean') next.system.discordRpc.showPoster = s.discordShowPoster;
          if (typeof s.discordShowTimestamp === 'boolean') next.system.discordRpc.showElapsed = s.discordShowTimestamp;
          if (typeof s.discordShowPartyJoin === 'boolean') next.system.discordRpc.watchPartyPresence = s.discordShowPartyJoin;
          if (typeof s.lang === 'string') next.languages.displayLanguage = s.lang;
          if (typeof keysRes?.user?.aiApiKey === 'string') next.sources.search.aiApiKey = keysRes.user.aiApiKey;

          if (prefs) {
            if (typeof prefs.mediaVsr === 'boolean') next.playback.rtxVsr = prefs.mediaVsr;
            if (typeof prefs.autoNext === 'boolean') next.playback.autoPlayNext = prefs.autoNext;
            if (typeof prefs.debridOnly === 'boolean') next.sources.sourceMode = prefs.debridOnly ? 'debrid' : 'both';
            if (typeof prefs.cinemaHideWatched === 'boolean') next.sources.hideWatchedCatalogs = prefs.cinemaHideWatched;
            if (typeof prefs.cinemaHideUnreleased === 'boolean') next.sources.hideUnreleasedCatalogs = prefs.cinemaHideUnreleased;
            if (typeof prefs.cinemaAutoPlayTrailer === 'boolean') next.playback.autoPlayTrailerDetail = prefs.cinemaAutoPlayTrailer;
            if (typeof prefs.playerExternalMpv === 'boolean') next.playback.externalMpv = prefs.playerExternalMpv;
            if (typeof prefs.playerHwAccel === 'boolean') next.playback.hwAccel = prefs.playerHwAccel ? 'force' : 'cpu';
            if (typeof prefs.playerHdr === 'boolean') next.playback.hdrMode = prefs.playerHdr ? (next.playback.hdrMode === 'sdr' ? 'hdr-embedded' : next.playback.hdrMode) : 'sdr';
            if (typeof prefs.playerToneMapping === 'string' && ['bt.2446a', 'bt.2390', 'hable', 'mobius', 'reinhard', 'spline'].includes(prefs.playerToneMapping)) {
              next.playback.picture.toneMapping = prefs.playerToneMapping as SettingsState['playback']['picture']['toneMapping'];
            }
            if (typeof prefs.playerBufferSize === 'string' && ['auto', 'small', 'medium', 'large', 'max'].includes(prefs.playerBufferSize)) {
              next.playback.bufferSize = prefs.playerBufferSize as SettingsState['playback']['bufferSize'];
            }
            if (typeof prefs.playerAnime4k === 'boolean') next.playback.anime4kEnabled = prefs.playerAnime4k;
            if (typeof prefs.playerAnime4kMode === 'string' && ['A', 'B', 'C', 'AA', 'BB', 'CA'].includes(prefs.playerAnime4kMode)) {
              next.playback.anime4kMode = prefs.playerAnime4kMode as SettingsState['playback']['anime4kMode'];
            }
            if (typeof prefs.playerCustomMpvConf === 'string' && prefs.playerCustomMpvConf) next.playback.customMpvConf = prefs.playerCustomMpvConf;
            if (typeof prefs.subLang2 === 'string' && ISO_TO_LANG[prefs.subLang2]) {
              next.languages.secondSubtitleLang = ISO_TO_LANG[prefs.subLang2];
            }
            if (typeof prefs.subFilterSdh === 'boolean') next.languages.subFilterSdh = prefs.subFilterSdh;
            if (typeof prefs.subAutoSync === 'boolean') next.languages.subAutoSync = prefs.subAutoSync;
            if (prefs.subStyle && typeof prefs.subStyle === 'object') {
              next.languages.subStyle = { ...next.languages.subStyle, ...(prefs.subStyle as Record<string, unknown>) };
            }
            if (typeof prefs.safetyFilter === 'string' && ['strict', 'balanced', 'off'].includes(prefs.safetyFilter)) {
              next.sources.safetyFilter = prefs.safetyFilter as SettingsState['sources']['safetyFilter'];
            }
            if (typeof prefs.resultOrder === 'string' && ['smart', 'addon'].includes(prefs.resultOrder)) {
              next.sources.resultOrder = prefs.resultOrder as SettingsState['sources']['resultOrder'];
            }
            if (Array.isArray(prefs.streamPriorityOrder) && prefs.streamPriorityOrder.length) {
              next.sources.streamPriorityOrder = prefs.streamPriorityOrder.map(String);
            }
            if (typeof prefs.sourceWaitSec === 'number' && [5, 10, 15, 30, 45].includes(prefs.sourceWaitSec)) {
              next.sources.addonWaitSec = prefs.sourceWaitSec as SettingsState['sources']['addonWaitSec'];
            }
            if (typeof prefs.autoSkipIntros === 'boolean') next.playback.autoSkipIntros = prefs.autoSkipIntros;
            if (typeof prefs.autoSkipRecaps === 'boolean') next.playback.autoSkipRecaps = prefs.autoSkipRecaps;
            if (typeof prefs.autoSkipCredits === 'boolean') next.playback.autoSkipCredits = prefs.autoSkipCredits;
            if (typeof prefs.showSkipButton === 'boolean') next.playback.showSkipButton = prefs.showSkipButton;
            if (typeof prefs.mediaMaxHeight === 'number') {
              next.playback.videoQualityPreset = prefs.mediaMaxHeight >= 2160 ? 'max' : prefs.mediaMaxHeight >= 1080 ? 'balanced' : 'weak';
            }
            const look = prefs.look as { theme?: string; accent?: string | null } | undefined;
            if (look && typeof look.theme === 'string') {
              const mapped = look.theme === 'majlis' ? 'default' : look.theme;
              if (['default', 'nord', 'obsidian', 'roast', 'dracula', 'forest', 'noir', 'custom'].includes(mapped)) {
                next.appearance.themePreset = mapped as SettingsState['appearance']['themePreset'];
              }
            }
            if (look && typeof look.accent === 'string' && /^#[0-9a-f]{6}$/i.test(look.accent)) {
              next.appearance.customAccent = look.accent;
            }
          }
          set({ data: next, hydrated: true });
        } catch {
          set({ hydrated: true });
        }
      },

      exportSettingsJson: () => JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), settings: get().data }, null, 2),

      importSettingsJson: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          const incoming = parsed?.settings || parsed;
          if (!incoming || typeof incoming !== 'object') return { ok: false, changedCount: 0, error: 'Invalid settings JSON' };
          const def = createDefaultSettings();
          let changed = 0;
          const merged: SettingsState = clone(def);
          (Object.keys(def) as (keyof SettingsState)[]).forEach((section) => {
            if (incoming[section] && typeof incoming[section] === 'object') {
              (merged as unknown as Record<string, unknown>)[section] = {
                ...(def[section] as Record<string, unknown>),
                ...incoming[section],
              };
              changed++;
            }
          });
          set({ data: merged });
          scheduleBackendSync(merged);
          return { ok: true, changedCount: changed };
        } catch (e) {
          return { ok: false, changedCount: 0, error: (e as Error).message };
        }
      },

      applySettingsSnapshot: (incoming) => {
        if (!incoming || typeof incoming !== 'object') return;
        const def = createDefaultSettings();
        const merged: SettingsState = clone(def);
        (Object.keys(def) as (keyof SettingsState)[]).forEach((section) => {
          const patch = incoming[section];
          if (patch && typeof patch === 'object') {
            (merged as unknown as Record<string, unknown>)[section] = {
              ...(def[section] as Record<string, unknown>),
              ...(patch as Record<string, unknown>),
            };
          }
        });
        set({ data: merged });
        scheduleBackendSync(merged);
      },

      resetPageSection: (section) => {
        const def = createDefaultSettings();
        const next = clone(get().data);
        (next as unknown as Record<string, unknown>)[section] = clone(def[section]);
        set({ data: next });
        scheduleBackendSync(next);
      },

      resetAll: () => {
        const def = createDefaultSettings();
        set({ data: def });
        scheduleBackendSync(def);
      },
    }),
    {
      name: 'majlis:settings-v2',
      partialize: (state) => {
        const cleanData = clone(state.data);
        cleanData.sources.search.aiApiKey = '';
        cleanData.system.discordWebhookUrl = '';
        cleanData.system.telegramBotToken = '';
        return { data: cleanData };
      },
    },
  ),
);
