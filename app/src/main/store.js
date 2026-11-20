'use strict';
// Local state: identity key, friends, settings, game library, network history.
// Nothing here ever leaves the machine except the public key and the number.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveId } = require('./ident');

// build-config.json is not in the repo: private builds drop it in to point at their own server.
let BUILD = {};
try { BUILD = require('./build-config.json'); } catch {}

let safeStorage = null;
try { safeStorage = require('electron').safeStorage; } catch {}

const DEFAULTS = {
  nick: '',
  lang: 'ar',
  theme: 'dark',
  server: '',
  accessKey: '',
  serverWs: '',
  relayWs: '',
  inviteBase: '',
  udpPort: 0,
  // stream
  codec: 'auto',          // auto | av1 | hevc | h264
  maxMbps: 40,
  fps: 60,
  tenBit: false,
  hdr: false,
  matchResolution: false,
  display: 0,
  captureWindow: null,    // { hwnd, title } when streaming only a window
  // network
  connType: 'auto',       // auto | fiber | 5g | 4g | wifi
  stability: 'auto',      // auto | on | off
  peakLearning: true,
  // guests
  acceptCodes: true,
  defaultRole: 'pad',
  spectatorQuality: 0.35,
  // watch party
  mode: 'play',           // play | watch
  watchControl: 'host',   // host | guest | all  (who can pause/seek)
  watchControlHolder: null, // friend 9-digit id (or sid) when watchControl === 'guest'
  smartCatchUp: true,     // 1.15x pitch-corrected auto catch-up when behind in Watch Party
  soundEffects: true,     // subtle custom Majlis chimes
  sfxMuteDuringPlayback: true, // auto-mute non-countdown SFX while Theater video is playing
  mediaMaxHeight: 1080,   // cinema: preferred top resolution when picking a stream
  debridOnly: false,      // cinema: only instant (debrid / direct) streams, never torrents
  subLang2: 'eng',        // cinema: subtitle language after Arabic
  discordClientId: '',    // Discord application id (public); empty: build default or off
  discordPresence: true,  // show what we're doing on our Discord profile
  discordHideTitle: false,
  discordShowWhenPaused: true,
  discordShowBrowsing: false,
  discordShowPoster: true,
  discordShowTimestamp: true,
  discordShowPartyJoin: true,
  discordEchoGuard: true,
  shareActivity: true,    // tell friends in the room what we've watched / rated
  watchMbps: 15,
  nightAudio: false,
  autoNext: true,
  autoDuck: true,
  spatialVoice: true,     // friends' voices placed left to right
  allowChat: true,
  noVsync: false,
  closeToTray: false,
  minimizeToTray: false,
  startMinimized: false,
  launchOnStartup: false,
  alwaysOnTop: false,
  pauseOnMinimize: false,
  pauseOnFocusLost: false,
  mediaVsr: false,
  rtxHdr: false,
  decoderMode: 1,
  mediaVolume: 100,
  subFilterSdh: false,
  cinemaTheme: 'majlis',
  cinemaOnboarded: false,
  mediaProfile: 'default',
  mediaProfiles: [],
  mediaLooks: {},
  mediaKeys: {},
  debridService: '',
  downloadDir: '',
  maxRes: 'source',        // source | 720 | 1080 | 1440
  qualityPreset: 'balanced', // speed | balanced | quality
  lightSpectators: false,
  windowAudioOnly: true,    // sharing one window: send only that program's sound
  dataSaver: false,
  roomPin: '',
  mouseSens: 1,
  padDeadzone: 0.08,
  padSwapAB: false,
  avOffset: 0,
  knockSound: true,
  allowReactions: true,
  cinemaDelay: 180,       // ms of buffer for smooth film playback
  // input & voice
  voice: 'ptt',
  gameVol: 1,
  voiceVol: 1,           // off | ptt | open
  pttKey: 'CapsLock',
  panicKey: 'Control+Alt+Shift+F12',
  overlayKey: 'Control+Alt+M',
  replayKey: 'Control+Alt+R',
  replay: false,
  replaySeconds: 30,
  // integrations
  ffmpeg: '',
  routerLock: '',
  shareStatus: true,
  handle: '',
  bio: '',
  accent: '#e2a43a',
  avatar: null,
  shareHistory: 'friends',
  installerPrefsApplied: false,
  // notifications, cache & auto-backup
  desktopNotifications: true,
  discordWebhookUrl: '',
  telegramBotToken: '',
  telegramChatId: '',
  keepCachedDays: 7,
  maxCacheGb: 5,
  deleteCacheAfterWatch: false,
  cachePath: '',
  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  autoBackupKeep: 6,
  lastBackupAt: 0,
  backupDir: '',
  cinemaHideWatched: false,
  cinemaHideUnreleased: false,
  cinemaAutoPlayTrailer: true,
  playerExternalMpv: false,
  playerHwAccel: true,
  playerHdr: true,
  playerToneMapping: 'bt.2446a',
  playerBufferSize: 'auto',
  playerAnime4k: false,
  playerAnime4kMode: 'A',
  playerCustomMpvConf: '',
  subAutoSync: false,
  subStyle: null,
  safetyFilter: 'strict',
  resultOrder: 'smart',
  streamPriorityOrder: ['Debrid', 'Addon', 'Server', 'Direct'],
  sourceWaitSec: 15,
  autoSkipIntros: false,
  autoSkipRecaps: false,
  autoSkipCredits: false,
  showSkipButton: true,
  cinemaDimmerPct: 0,
  playerDisplayProfile: 'auto',
  voiceClarity: false,
  cinemaWarmTint: 0,
  controllerHud: false,
  privacyCurtain: false,
  gamePreset: 'balanced',
  pixelArt: false,
  friendVolumes: {},
  isp: 'auto',
  preferredRelay: 'auto',
  streamRules: { preferHevc: false, prefer4kHdr: false, blockCamTs: true, maxSizeGb: 0, excludeKeywords: '' },
  autoSkipStalled: false,
  cinemaPerfMode: false,
  maxConcurrentDownloads: 2,
};

class Store {
  constructor(dir, preloadedData = null, opts = {}) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'majlis.json');
    const isFirstRun = !preloadedData && !fs.existsSync(this.file);
    let d = preloadedData && typeof preloadedData === 'object' ? preloadedData : {};
    if (!preloadedData) {
      try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    }
    this.d = { settings: {}, friends: [], friendRequests: [], friendProfiles: {}, socialProfiles: {}, profileComments: {}, handleDir: {}, games: [], peaks: {}, partyHistory: [], ...d };
    this.d.settings = { ...DEFAULTS, ...this.d.settings };
    this._timer = null;
    this._unprotectSecrets();
    this._ensureIdentity();
    this._applyInstallerPrefs(isFirstRun, opts?.installerPrefsPath);
  }

  _applyInstallerPrefs(isFirstRun, explicitPrefsPath = null) {
    if (this.d.settings.installerPrefsApplied) return;
    if (!isFirstRun) {
      this.d.settings.installerPrefsApplied = true;
      return;
    }
    const candidates = [
      explicitPrefsPath,
      path.join(path.dirname(process.execPath), 'installer_prefs.json'),
      path.join(this.dir, 'installer_prefs.json'),
    ].filter(Boolean);
    for (const p of candidates) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!raw || typeof raw !== 'object') continue;
      if (raw.language === 'ar' || raw.language === 'en') this.d.settings.lang = raw.language;
      if (typeof raw.launchStartup === 'boolean' || typeof raw.launchOnStartup === 'boolean') {
        this.d.settings.launchOnStartup = !!(raw.launchStartup ?? raw.launchOnStartup);
      }
      if (Array.isArray(raw.optionalComponents)) {
        this.d.settings.installerOptionalComponents = raw.optionalComponents.map((x) => String(x));
        if (this.d.settings.installerOptionalComponents.includes('opt_discord')) this.d.settings.discordPresence = true;
      }
      if (typeof raw.cinemaTheme === 'string' && raw.cinemaTheme) this.d.settings.cinemaTheme = raw.cinemaTheme;
      break;
    }
    this.d.settings.installerPrefsApplied = true;
    this.save();
  }

  _protectText(s) {
    if (typeof s !== 'string' || !s) return '';
    return this._protect(Buffer.from(s, 'utf8'));
  }
  _unprotectText(s) {
    if (typeof s !== 'string' || !s) return '';
    if (!s.startsWith('dpapi:') && !s.startsWith('raw:')) return s;
    try { return this._unprotect(s).toString('utf8'); } catch { return ''; }
  }
  _unprotectSecrets() {
    const s = this.d.settings;
    for (const k of ['accessKey', 'discordWebhookUrl', 'telegramBotToken']) {
      if (typeof s[k] === 'string') s[k] = this._unprotectText(s[k]);
    }
    if (s.mediaKeys && typeof s.mediaKeys === 'object') {
      const dec = {};
      for (const [k, v] of Object.entries(s.mediaKeys)) dec[k] = typeof v === 'string' ? this._unprotectText(v) : v;
      s.mediaKeys = dec;
    }
  }
  _serializedCopy() {
    const s = { ...this.d.settings };
    for (const k of ['accessKey', 'discordWebhookUrl', 'telegramBotToken']) {
      if (typeof s[k] === 'string' && s[k]) s[k] = this._protectText(s[k]);
    }
    if (s.mediaKeys && typeof s.mediaKeys === 'object') {
      const enc = {};
      for (const [k, v] of Object.entries(s.mediaKeys)) enc[k] = typeof v === 'string' && v ? this._protectText(v) : v;
      s.mediaKeys = enc;
    }
    return { ...this.d, settings: s };
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this._serializedCopy(), null, 1));
    fs.renameSync(tmp, this.file);
  }

  get(k) {
    const v = this.d.settings[k];
    if (k === 'server' && !v) return BUILD.server || '';
    // Discord application id: public, so a build may carry a default (build-config.json)
    if (k === 'discordClientId' && !v) return BUILD.discordClientId || '';
    // On the built-in server the built-in key always wins: a number typed into the key box
    // by mistake (easy to confuse with the room PIN) must never lock you out.
    if (k === 'accessKey' && BUILD.accessKey && this.usingBuiltIn()) return BUILD.accessKey;
    if (k === 'accessKey' && !v) return BUILD.accessKey || '';
    return v;
  }
  usingBuiltIn() {
    const srv = this.d.settings.server;
    return !!BUILD.server && (!srv || String(srv).replace(/\/+$/, '') === BUILD.server.replace(/\/+$/, ''));
  }
  hasServer() { return !!String(this.get('server') || '').trim(); }
  set(k, v) {
    this.d.settings[k] = v;
    if (k === 'nick' && typeof v === 'string' && v.trim()) {
      const prof = this.d.settings.mediaProfile || 'default';
      (this.d.socialProfiles ||= {})[prof] = { ...((this.d.socialProfiles ||= {})[prof] || {}), displayName: v.trim().slice(0, 40) };
    }
    this.save();
  }
  all() { return { ...this.d.settings, builtInServer: this.usingBuiltIn() }; }
  patch(obj) {
    for (const [k, v] of Object.entries(obj || {})) if (k in DEFAULTS) this.d.settings[k] = v;
    if (typeof obj?.nick === 'string' && obj.nick.trim()) {
      const prof = this.d.settings.mediaProfile || 'default';
      (this.d.socialProfiles ||= {})[prof] = { ...((this.d.socialProfiles ||= {})[prof] || {}), displayName: obj.nick.trim().slice(0, 40) };
    }
    this.save();
  }

  // ---------------------------------------------------------------- identity
  _ensureIdentity() {
    let idn = this.d.identity;
    if (!idn) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
      const sk = privateKey.export({ format: 'der', type: 'pkcs8' });
      idn = { pk: pk.toString('base64'), sk: this._protect(sk), salt: 0 };
      this.d.identity = idn;
      this.flush();
    }
    this._pk = Buffer.from(idn.pk, 'base64');
    this._sk = crypto.createPrivateKey({ key: this._unprotect(idn.sk), format: 'der', type: 'pkcs8' });
  }

  _protect(buf) {
    if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) return 'dpapi:' + safeStorage.encryptString(buf.toString('base64')).toString('base64');
    return 'raw:' + buf.toString('base64');
  }
  _unprotect(s) {
    if (s.startsWith('dpapi:')) return Buffer.from(safeStorage.decryptString(Buffer.from(s.slice(6), 'base64')), 'base64');
    return Buffer.from(s.replace(/^raw:/, ''), 'base64');
  }

  identity() {
    const self = this;
    return {
      get id() { return deriveId(self._pk, self.d.identity.salt); },
      get salt() { return self.d.identity.salt; },
      pkB64: this.d.identity.pk,
      sign: (buf) => crypto.sign(null, buf, this._sk),
    };
  }
  bumpSalt() { this.d.identity.salt++; this.flush(); }
  resetIdentity() { delete this.d.identity; this._ensureIdentity(); }

  // ---------------------------------------------------------------- community profile
  socialProfile(prof = this.get('mediaProfile') || 'default') {
    const sp = (this.d.socialProfiles ||= {})[prof] || {};
    const look = (this.d.settings.mediaLooks || {})[prof] || {};
    return {
      id: this.identity().id,
      profile: prof,
      displayName: sp.displayName || (prof === 'default' ? (this.d.settings.nick || '') : prof),
      handle: sp.handle || (prof === 'default' ? (this.d.settings.handle || '') : ''),
      avatar: look.avatar ?? sp.avatar ?? this.d.settings.avatar ?? null,
      accent: look.accent ?? sp.accent ?? this.d.settings.accent ?? '#e2a43a',
      theme: look.theme || sp.theme || 'majlis',
      bio: sp.bio ?? this.d.settings.bio ?? '',
      song: sp.song || null,
      shareHistory: sp.shareHistory || this.d.settings.shareHistory || (this.d.settings.shareActivity === false ? 'none' : 'friends'),
      favorites: Array.isArray(sp.favorites) ? sp.favorites : [],
      lists: Array.isArray(sp.lists) ? sp.lists : [],
      ratings: Array.isArray(sp.ratings) ? sp.ratings : [],
      customProfile: sp.customProfile && typeof sp.customProfile === 'object' ? sp.customProfile : null,
    };
  }

  _sanitizeCustomProfile(cp) {
    if (!cp || typeof cp !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const out = {};
    if (typeof cp.status === 'string') out.status = str(cp.status, 60);
    if (typeof cp.pronouns === 'string') out.pronouns = str(cp.pronouns, 24);
    if (typeof cp.location === 'string') out.location = str(cp.location, 60);
    if (typeof cp.customUrl === 'string') out.customUrl = str(cp.customUrl, 32);
    if (typeof cp.themeId === 'string') out.themeId = str(cp.themeId, 24);
    if (cp.customColors && typeof cp.customColors === 'object') {
      out.customColors = {
        bg: str(cp.customColors.bg, 16) || '#12100E',
        card: str(cp.customColors.card, 16) || '#181613',
        accent: str(cp.customColors.accent, 16) || '#E5A93C',
        text: str(cp.customColors.text, 16) || '#F2EFE9',
      };
    }
    if ('transparentCards' in cp) out.transparentCards = !!cp.transparentCards;
    if ('gradientMode' in cp) out.gradientMode = !!cp.gradientMode;
    if (cp.privacy && typeof cp.privacy === 'object') {
      out.privacy = {
        privateProfile: !!cp.privacy.privateProfile,
        friendsListVisibility: ['everyone', 'friends', 'only_me'].includes(cp.privacy.friendsListVisibility) ? cp.privacy.friendsListVisibility : 'everyone',
        shareWatchActivity: cp.privacy.shareWatchActivity !== false,
        shareLiveStatus: cp.privacy.shareLiveStatus !== false,
        showGamingCard: cp.privacy.showGamingCard !== false,
        showExternalTrackerCard: cp.privacy.showExternalTrackerCard !== false,
      };
    }
    if (cp.showcase && typeof cp.showcase === 'object') {
      out.showcase = {
        featuredListIds: Array.isArray(cp.showcase.featuredListIds) ? cp.showcase.featuredListIds.slice(0, 6).map((x) => str(x, 48)) : [],
        heroStats: Array.isArray(cp.showcase.heroStats) ? cp.showcase.heroStats.slice(0, 4).map((x) => str(x, 24)) : undefined,
        leftCards: Array.isArray(cp.showcase.leftCards) ? cp.showcase.leftCards.slice(0, 12).map((c) => ({ id: str(c?.id, 24), visible: !!c?.visible })) : undefined,
        rightCards: Array.isArray(cp.showcase.rightCards) ? cp.showcase.rightCards.slice(0, 12).map((c) => ({ id: str(c?.id, 24), visible: !!c?.visible })) : undefined,
        gamingCard: cp.showcase.gamingCard && typeof cp.showcase.gamingCard === 'object' ? {
          enabled: !!cp.showcase.gamingCard.enabled,
          platform: ['steam', 'xbox', 'playstation', 'minecraft'].includes(cp.showcase.gamingCard.platform) ? cp.showcase.gamingCard.platform : 'steam',
          gamertag: str(cp.showcase.gamingCard.gamertag, 48),
        } : undefined,
      };
    }
    if (Array.isArray(cp.socials)) {
      out.socials = cp.socials.slice(0, 8).map((s) => ({ id: str(s?.id, 32), platform: str(s?.platform, 24), handle: str(s?.handle, 80) }));
    }
    if (Array.isArray(cp.groups)) {
      out.groups = cp.groups.slice(0, 12).map((g) => ({
        id: str(g?.id, 48), name: str(g?.name, 60), description: str(g?.description, 200),
        membersCount: Math.max(1, Number(g?.membersCount) || 1),
        privacy: str(g?.privacy, 16) || 'invite', color: str(g?.color, 16) || '#E5A93C',
        tags: Array.isArray(g?.tags) ? g.tags.slice(0, 6).map((t) => str(t, 24)) : [],
      }));
    }
    if (cp.customCanvas && typeof cp.customCanvas === 'object') {
      out.customCanvas = {
        enabled: !!cp.customCanvas.enabled,
        showToVisitors: cp.customCanvas.showToVisitors !== false,
        font: str(cp.customCanvas.font, 48),
        pageBgColor: str(cp.customCanvas.pageBgColor, 16),
        canvasHeight: Math.max(120, Math.min(800, Number(cp.customCanvas.canvasHeight) || 220)),
        pageBgImage: typeof cp.customCanvas.pageBgImage === 'string' && cp.customCanvas.pageBgImage.length <= 200000 ? cp.customCanvas.pageBgImage : '',
        hideTopBanner: !!cp.customCanvas.hideTopBanner,
        hideCardTitles: !!cp.customCanvas.hideCardTitles,
        favicon: str(cp.customCanvas.favicon, 500),
        customHtml: str(cp.customCanvas.customHtml, 16000),
        customCss: str(cp.customCanvas.customCss, 16000),
      };
    }
    return out;
  }

  profileComments(targetId) {
    const tid = String(targetId || '').slice(0, 64);
    const list = (this.d.profileComments ||= {})[tid];
    return Array.isArray(list) ? list : [];
  }

  addProfileComment(targetId, entry) {
    const tid = String(targetId || '').slice(0, 64);
    const body = String(entry?.body || '').trim().slice(0, 800);
    if (!tid || !body) return null;
    const cid = String(entry?.id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
    const comment = {
      id: cid,
      authorId: String(entry?.authorId || '').slice(0, 64),
      authorName: String(entry?.authorName || 'Me').slice(0, 40),
      authorAvatar: typeof entry?.authorAvatar === 'string' && entry.authorAvatar.length < 30000 ? entry.authorAvatar : null,
      authorAccent: /^#[0-9a-f]{6}$/i.test(String(entry?.authorAccent || '')) ? String(entry.authorAccent) : '#E5A93C',
      body,
      at: Number(entry?.at) || Date.now(),
    };
    const prev = this.profileComments(tid).filter((c) => c.id !== cid);
    this.d.profileComments[tid] = [comment, ...prev].slice(0, 100);
    this.save();
    return comment;
  }

  deleteProfileComment(targetId, commentId, requesterId = '') {
    const tid = String(targetId || '').slice(0, 64);
    const cid = String(commentId || '').slice(0, 64);
    const req = String(requesterId || '').slice(0, 64);
    const list = this.profileComments(tid);
    const hit = list.find((c) => c.id === cid);
    if (!hit) return false;
    if (req && hit.authorId !== req && tid !== req) return false;
    this.d.profileComments[tid] = list.filter((c) => c.id !== cid);
    this.save();
    return true;
  }

  addSocialRating(entry, prof = this.get('mediaProfile') || 'default') {
    const id = String(entry?.id || '').slice(0, 64);
    const score = Math.max(1, Math.min(10, Math.round(Number(entry?.score) || 0)));
    if (!id || !score) return null;
    const sp = { ...((this.d.socialProfiles ||= {})[prof] || {}) };
    const list = Array.isArray(sp.ratings) ? sp.ratings.filter((r) => r.id !== id) : [];
    const item = {
      id,
      type: entry.type === 'series' ? 'series' : 'movie',
      title: String(entry.title || id).slice(0, 140),
      poster: typeof entry.poster === 'string' ? entry.poster.slice(0, 500) : null,
      score,
      ratedAt: Number(entry.ratedAt) || Date.now(),
      partyId: entry.partyId ? String(entry.partyId).slice(0, 64) : null,
    };
    sp.ratings = [item, ...list].slice(0, 1000);
    this.d.socialProfiles[prof] = sp;
    this.save();
    return item;
  }

  partyHistory() {
    return Array.isArray(this.d.partyHistory) ? this.d.partyHistory : [];
  }

  addPartyHistory(entry) {
    if (!entry || !entry.id || !entry.titleId) return null;
    const list = Array.isArray(this.d.partyHistory) ? [...this.d.partyHistory] : [];
    const idx = list.findIndex((x) => x.id === entry.id);
    const clean = {
      id: String(entry.id).slice(0, 64),
      startedAt: Number(entry.startedAt) || Date.now(),
      endedAt: Number(entry.endedAt) || Date.now(),
      watchedMs: Math.max(0, Math.round(Number(entry.watchedMs) || 0)),
      titleId: String(entry.titleId).slice(0, 64),
      videoId: String(entry.videoId || entry.titleId).slice(0, 80),
      type: entry.type === 'series' ? 'series' : 'movie',
      title: String(entry.title || entry.titleId).slice(0, 160),
      poster: typeof entry.poster === 'string' ? entry.poster.slice(0, 500) : null,
      genres: Array.isArray(entry.genres) ? entry.genres.slice(0, 6).map((g) => String(g).slice(0, 40)) : [],
      role: entry.role === 'host' ? 'host' : 'guest',
      attendees: (Array.isArray(entry.attendees) ? entry.attendees : []).slice(0, 16).map((a) => ({
        id: String(a?.id || '').slice(0, 64),
        name: String(a?.name || '').slice(0, 40),
        accent: typeof a?.accent === 'string' ? a.accent.slice(0, 16) : null,
        avatar: typeof a?.avatar === 'string' && a.avatar.length < 30000 ? a.avatar : null,
      })),
      notes: (Array.isArray(entry.notes) ? entry.notes : []).slice(0, 100).map((n) => ({
        id: String(n?.id || '').slice(0, 48),
        t: Math.max(0, Number(n?.t) || 0),
        text: String(n?.text || '').slice(0, 240),
        authorId: String(n?.authorId || '').slice(0, 64),
        authorName: String(n?.authorName || '').slice(0, 40),
        accent: typeof n?.accent === 'string' ? n.accent.slice(0, 16) : '#e2a43a',
        at: Number(n?.at) || Date.now(),
      })).filter((n) => n.text),
      ratings: entry.ratings && typeof entry.ratings === 'object' ? entry.ratings : {},
      groupRating: Number.isFinite(Number(entry.groupRating)) ? Number(entry.groupRating) : null,
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...clean, ratings: { ...(list[idx].ratings || {}), ...(clean.ratings || {}) } };
    else list.unshift(clean);
    this.d.partyHistory = list.slice(0, 500);
    this.save();
    return clean;
  }

  updatePartyHistoryRating(sessionOrTitleId, memberId, ratingEntry) {
    const list = Array.isArray(this.d.partyHistory) ? this.d.partyHistory : [];
    const target = list.find((x) => x.id === sessionOrTitleId || x.titleId === sessionOrTitleId);
    if (!target || !memberId) return null;
    target.ratings = target.ratings && typeof target.ratings === 'object' ? { ...target.ratings } : {};
    target.ratings[String(memberId)] = ratingEntry;
    const vals = Object.values(target.ratings).map((v) => Number(v?.score)).filter((n) => n >= 1 && n <= 10);
    target.groupRating = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
    this.save();
    return target;
  }

  deletePartyHistory(id) {
    if (!Array.isArray(this.d.partyHistory)) return false;
    const before = this.d.partyHistory.length;
    this.d.partyHistory = this.d.partyHistory.filter((x) => x.id !== id);
    if (this.d.partyHistory.length !== before) { this.save(); return true; }
    return false;
  }

  setSocialProfile(patch, prof = this.get('mediaProfile') || 'default') {
    const sp = { ...((this.d.socialProfiles ||= {})[prof] || {}) };
    const looks = { ...(this.d.settings.mediaLooks || {}) };
    const look = { avatar: null, accent: null, theme: 'majlis', ...(looks[prof] || {}) };
    if (typeof patch.displayName === 'string') {
      sp.displayName = patch.displayName.trim().slice(0, 40);
      if (prof === 'default') this.d.settings.nick = sp.displayName;
    }
    if (typeof patch.handle === 'string') {
      const h = patch.handle.trim().replace(/^@+/, '').toLowerCase();
      if (!h || /^[a-z0-9_]{3,24}$/.test(h)) {
        sp.handle = h;
        if (prof === 'default') this.d.settings.handle = h;
      }
    }
    if ('avatar' in patch) {
      sp.avatar = patch.avatar;
      look.avatar = patch.avatar;
    }
    if (patch.accent === null || /^#[0-9a-f]{6}$/i.test(patch.accent || '')) {
      sp.accent = patch.accent || '#e2a43a';
      look.accent = patch.accent;
    }
    if (typeof patch.theme === 'string') {
      sp.theme = patch.theme;
      look.theme = patch.theme;
    }
    if (typeof patch.bio === 'string') sp.bio = patch.bio.slice(0, 280);
    if ('song' in patch) sp.song = patch.song;
    if (patch.shareHistory === 'friends' || patch.shareHistory === 'none') {
      sp.shareHistory = patch.shareHistory;
      this.d.settings.shareHistory = patch.shareHistory;
      this.d.settings.shareActivity = patch.shareHistory === 'friends';
    }
    if (Array.isArray(patch.favorites)) {
      sp.favorites = patch.favorites.slice(0, 24).map((x) => ({
        id: String(x.id || '').slice(0, 64),
        type: x.type === 'series' ? 'series' : 'movie',
        name: String(x.name || '').slice(0, 120),
        poster: typeof x.poster === 'string' ? x.poster.slice(0, 500) : null,
        year: x.year ? Number(x.year) || null : null,
      })).filter((x) => x.id);
    }
    if (Array.isArray(patch.lists)) {
      sp.lists = patch.lists.slice(0, 30).map((l, i) => ({
        id: String(l.id || `list-${Date.now()}-${i}`).slice(0, 48),
        name: String(l.name || 'List').trim().slice(0, 60) || 'List',
        description: typeof l.description === 'string' ? l.description.slice(0, 200) : '',
        items: (Array.isArray(l.items) ? l.items : []).slice(0, 100).map((x) => ({
          id: String(x.id || '').slice(0, 64),
          type: x.type === 'series' ? 'series' : 'movie',
          name: String(x.name || '').slice(0, 120),
          poster: typeof x.poster === 'string' ? x.poster.slice(0, 500) : null,
          year: x.year ? Number(x.year) || null : null,
        })).filter((x) => x.id),
      }));
    }
    if (patch.customProfile && typeof patch.customProfile === 'object') {
      sp.customProfile = this._sanitizeCustomProfile(patch.customProfile);
    }
    this.d.socialProfiles[prof] = sp;
    looks[prof] = look;
    this.d.settings.mediaLooks = looks;
    this.save();
    return this.socialProfile(prof);
  }

  // ---------------------------------------------------------------- friends & requests
  friends() { return this.d.friends; }
  friend(id) { return this.d.friends.find((f) => f.id === id); }
  upsertFriend(f) {
    const cur = this.friend(f.id);
    if (cur) Object.assign(cur, f); else this.d.friends.push({ name: f.id, trust: 'ask', added: Date.now(), ...f });
    const saved = this.friend(f.id);
    if (saved?.handle) this.rememberHandle(saved.handle, { id: saved.id, pk: saved.pk || null, name: saved.name });
    this.save();
    return saved;
  }
  removeFriend(id) {
    this.d.friends = this.d.friends.filter((f) => f.id !== id);
    this.removeFriendRequest(id);
    this.save();
  }

  friendRequests() { return (this.d.friendRequests ||= []); }
  upsertFriendRequest(r) {
    if (!r || !r.id) return null;
    const list = this.friendRequests();
    const cur = list.find((x) => x.id === r.id);
    if (cur) Object.assign(cur, r);
    else list.unshift({ at: Date.now(), direction: 'in', ...r });
    if (r.handle) this.rememberHandle(r.handle, { id: r.id, pk: r.pk || null, name: r.name || r.id });
    this.save();
    return list.find((x) => x.id === r.id);
  }
  removeFriendRequest(id) {
    this.d.friendRequests = (this.d.friendRequests || []).filter((x) => x.id !== id);
    this.save();
  }

  friendProfile(id) { return (this.d.friendProfiles ||= {})[id] || null; }
  saveFriendProfile(id, prof) {
    if (!id || !prof) return null;
    (this.d.friendProfiles ||= {})[id] = { ...prof, id, cachedAt: Date.now() };
    if (prof.handle) this.rememberHandle(prof.handle, { id, pk: prof.pk || null, name: prof.displayName || prof.name || id });
    this.save();
    return this.d.friendProfiles[id];
  }

  rememberHandle(handle, info) {
    const h = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(h) || !info?.id) return;
    (this.d.handleDir ||= {})[h] = { id: info.id, pk: info.pk || null, name: info.name || info.id, handle: h, at: Date.now() };
    this.save();
  }
  lookupLocalHandle(handle) {
    const h = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!h) return null;
    const f = this.d.friends.find((x) => String(x.handle || '').toLowerCase() === h);
    if (f) return { id: f.id, pk: f.pk || null, name: f.name, handle: h };
    return (this.d.handleDir || {})[h] || null;
  }

  // ---------------------------------------------------------------- games
  games() { return this.d.games; }
  setGames(g) { this.d.games = g; this.save(); }

  // ---------------------------------------------------------------- peak-hour memory
  // Bitrate that held up without congestion, per hour of the week (Saudi evenings and
  // Ramadan nights look very different from mornings).
  peakKey(d = new Date()) { return `${d.getDay()}-${d.getHours()}`; }
  recordPeak(mbps, congested) {
    const k = this.peakKey();
    const p = this.d.peaks[k] || { mbps, events: 0, n: 0 };
    p.mbps = p.mbps * 0.8 + mbps * 0.2;
    p.events = p.events * 0.9 + (congested ? 1 : 0);
    p.n++;
    this.d.peaks[k] = p;
    this.save();
  }
  peakHint(d = new Date()) { return this.d.peaks[this.peakKey(d)] || null; }
  peaks() { return this.d.peaks; }

  // ---------------------------------------------------------------- room launch presets
  roomPresets() {
    if (!Array.isArray(this.d.roomPresets) || !this.d.roomPresets.length) {
      this.d.roomPresets = DEFAULT_ROOM_PRESETS.map((p) => ({ ...p }));
      this.save();
    }
    return this.d.roomPresets.map((p) => ({ ...p }));
  }

  saveRoomPreset(input) {
    const clean = sanitizeRoomPreset(input);
    if (!clean) return null;
    const list = this.roomPresets();
    const idx = list.findIndex((x) => x.id === clean.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...clean, builtin: !!list[idx].builtin };
    else list.unshift(clean);
    this.d.roomPresets = list.slice(0, 20);
    this.save();
    return clean;
  }

  deleteRoomPreset(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return false;
    const list = this.roomPresets();
    const target = list.find((x) => x.id === cleanId);
    if (!target || target.builtin) return false;
    this.d.roomPresets = list.filter((x) => x.id !== cleanId);
    this.save();
    return true;
  }
}

const DEFAULT_ROOM_PRESETS = [
  {
    id: 'preset-cinema-night',
    builtin: true,
    name: 'Movie Night',
    nameAr: 'سهرة سينما',
    icon: 'film',
    mode: 'watch',
    watchControl: 'host',
    acceptCodes: true,
    allowChat: true,
    allowReactions: true,
    autoNext: true,
    autoDuck: true,
    qualityPreset: 'quality',
    maxRes: 'source',
    fps: 60,
    defaultRole: 'watch',
    roomPin: '',
  },
  {
    id: 'preset-open-majlis',
    builtin: true,
    name: 'Open Watch Room',
    nameAr: 'مجلس مفتوح للجميع',
    icon: 'users',
    mode: 'watch',
    watchControl: 'all',
    acceptCodes: true,
    allowChat: true,
    allowReactions: true,
    autoNext: true,
    autoDuck: true,
    qualityPreset: 'balanced',
    maxRes: '1080',
    fps: 60,
    defaultRole: 'watch',
    roomPin: '',
  },
  {
    id: 'preset-coop-squad',
    builtin: true,
    name: 'Co-op Squad',
    nameAr: 'سهرة لعب جماعي',
    icon: 'gamepad',
    mode: 'play',
    watchControl: 'host',
    acceptCodes: false,
    allowChat: true,
    allowReactions: true,
    autoNext: false,
    autoDuck: true,
    qualityPreset: 'speed',
    maxRes: '1080',
    fps: 60,
    defaultRole: 'pad',
    roomPin: '',
  },
];

function sanitizeRoomPreset(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name || '').trim().slice(0, 48);
  if (!name) return null;
  const idRaw = String(input.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const res = String(input.maxRes || '1080');
  const qp = String(input.qualityPreset || 'balanced');
  const role = String(input.defaultRole || 'pad');
  const wc = input.watchControl === 'all' ? 'all' : input.watchControl === 'guest' ? 'guest' : 'host';
  return {
    id: idRaw || `preset-${Date.now()}`,
    builtin: false,
    name,
    nameAr: typeof input.nameAr === 'string' && input.nameAr.trim() ? input.nameAr.trim().slice(0, 48) : undefined,
    icon: ['film', 'users', 'gamepad', 'sparkles'].includes(input.icon) ? input.icon : 'sparkles',
    mode: input.mode === 'watch' ? 'watch' : 'play',
    watchControl: wc,
    acceptCodes: input.acceptCodes !== false,
    allowChat: input.allowChat !== false,
    allowReactions: input.allowReactions !== false,
    autoNext: input.autoNext !== false,
    autoDuck: input.autoDuck !== false,
    qualityPreset: ['speed', 'balanced', 'quality'].includes(qp) ? qp : 'balanced',
    maxRes: ['source', '720', '1080', '1440'].includes(res) ? res : '1080',
    fps: [30, 60, 120].includes(Number(input.fps)) ? Number(input.fps) : 60,
    defaultRole: ['watch', 'pad', 'kbm', 'full'].includes(role) ? role : 'pad',
    roomPin: String(input.roomPin || '').replace(/[^\w-]/g, '').slice(0, 8),
  };
}

module.exports = { Store, DEFAULTS, sanitizeRoomPreset, DEFAULT_ROOM_PRESETS };
