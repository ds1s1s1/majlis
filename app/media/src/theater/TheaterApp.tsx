import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AudioLines, Camera, Coffee, EyeOff, Gauge, Layers, ListVideo, Lock, Maximize, MessageSquare,
  MessageSquareQuote, Mic, MicOff, Minimize, Minus, MoreHorizontal, Pause, PictureInPicture2, Play, Plus, RotateCcw,
  RotateCw, SlidersHorizontal, Subtitles, Tv, Unlock, Users, Volume1, Volume2, VolumeX, X,
} from 'lucide-react';
import { metahub, type DisplayTarget, type PartyNoteItem, type Ranked, type ReadyStateView, type Stream } from '../api';
import { useHost } from '../host';
import { fmtLocaleTime, translate, type Key, type Lang } from '../i18n';
import { useMediaSession } from '../hooks/useMediaSession';
import { useSettingsStore } from '../settings/useSettingsStore';
import { useProfileStore } from '../store/useProfileStore';
import { usePlayQueueStore, type PlayQueueItem } from '../store/usePlayQueueStore';
import { configureSfx, playSfx } from '../utils/sfx';
import { Img } from '../ui/Img';
import { Html5Stage, type Html5Cmd } from './Html5Stage';
import type {
  AddonSub, BookmarkItem, BrbState, ChatMsg, DrawerKind, EpItem,
  PartyView, RatingRoundView, RatingVoteView, SourceMismatchInfo, TheaterPropsMap, VoiceStateView, VoteItem,
} from './TheaterDrawers';
import { TheaterPopovers, type SleepSetting } from './TheaterPopovers';

declare global {
  interface Window { majlis: { invoke(ch: string, a?: unknown): Promise<any>; on(fn: (m: any) => void): () => void; pathFor?: (file: File) => string } }
}

const INTRO = /\b(intro|opening|op)\b|مقدمة|شارة البداية/i;
const RECAP = /\b(recap|previously)\b|ملخص/i;
const OUTRO = /\b(credits|ending|ed|outro|preview)\b|شارة النهاية/i;
const RAW_ID_RE = /^(tt\d+|(kitsu|anilist|mal):)/i;
const api = window.majlis;
const cmd = (c: string, x: Record<string, unknown> = {}) => api.invoke('player:cmd', { cmd: c, ...x });
const fmtTime = (s: number) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};
const fmtClock = (s: number) => {
  const n = Math.max(0, Math.ceil(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

interface CardMeta { name?: string; seriesName?: string; poster?: string | null; background?: string | null; logo?: string | null; type?: string; metaId?: string; postCredits?: { after?: boolean; during?: boolean } | null }
interface SkipSeg { kind: string; start: number; end: number }
interface MultiEpInfo { isMulti: boolean; reason?: string; coveredIds?: string[]; rangeLabel?: string; nextAfterId?: string | null }
interface PostCreditsInfo { after?: boolean; during?: boolean; resumeAt?: number | null }

export function TheaterApp() {
  const host = useHost();
  const playbackCfg = useSettingsStore((s) => s.data.playback);
  const apCfg = useSettingsStore((s) => s.data.appearance);
  const ctrlCfg = useSettingsStore((s) => s.data.controls);
  const pl = apCfg.playerLayout;
  const maxVol = playbackCfg.maxVolumeBoost || 150;
  const [lang, setLang] = useState<Lang>(host?.lang === 'en' ? 'en' : 'ar');
  const [theme, setTheme] = useState(host?.theme || 'majlis');
  const [accent, setAccent] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [miniOn, setMiniOn] = useState(false);
  const [pipLocked, setPipLocked] = useState(false);
  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const [props, setProps] = useState<TheaterPropsMap>({});
  const [card, setCard] = useState<CardMeta>({});
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [phase, setPhase] = useState<'searching' | 'opening' | 'trying-source' | 'buffering' | ''>('searching');
  const [statusMsg, setStatusMsg] = useState('');
  const [activeCand, setActiveCand] = useState<Ranked | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ message: string; ranked: Ranked[] } | null>(null);

  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [compactW, setCompactW] = useState(false);
  const [night, setNight] = useState(false);
  const [autoDuck, setAutoDuck] = useState(true);
  const [spdif, setSpdif] = useState(false);
  const [vsr, setVsr] = useState(false);
  const [aspect, setAspect] = useState('fit');
  const [tone, setTone] = useState('spline');
  const [subColor, setSubColor] = useState('#FFFFFF');
  const [hwAccel, setHwAccel] = useState(true);
  const [sdhFilter, setSdhFilter] = useState(false);
  const [subFont, setSubFont] = useState('Segoe UI');
  const [subBold, setSubBold] = useState(false);
  const [subOutline, setSubOutline] = useState(2.2);
  const [subBgAlpha, setSubBgAlpha] = useState(0);
  const [subFpsMode, setSubFpsMode] = useState('reset');
  const [skipHidden, setSkipHidden] = useState(false);
  const autoSkippedRef = useRef(new Set<string>());
  const [ambientGlow, setAmbientGlow] = useState(false);
  const [html5State, setHtml5State] = useState<{ active: boolean; url: string; startPos: number; isHls: boolean }>({ active: false, url: '', startPos: 0, isHls: false });
  const [html5Cmd, setHtml5Cmd] = useState<{ seq: number; cmd: Html5Cmd } | null>(null);
  const html5CmdSeqRef = useRef(1);
  const [voiceClarity, setVoiceClarity] = useState(false);
  const [displayProfile, setDisplayProfile] = useState('auto');
  const [detectedDisplayProfile, setDetectedDisplayProfile] = useState('ips');
  const [warmTint, setWarmTint] = useState(0);
  const [dimmerPct, setDimmerPct] = useState(0);
  const [secondaryDisplays, setSecondaryDisplays] = useState(0);
  const [incognito, setIncognito] = useState(false);
  const [displays, setDisplays] = useState<DisplayTarget[]>([]);
  const [compareActive, setCompareActive] = useState(false);
  const [compareSplit, setCompareSplit] = useState(0.5);
  const [multiEp, setMultiEp] = useState<MultiEpInfo | null>(null);
  const [postCredits, setPostCredits] = useState<PostCreditsInfo | null>(null);
  const [shotWithSubs, setShotWithSubs] = useState(true);
  const [loadedSubMap, setLoadedSubMap] = useState<Record<string, string>>({});
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [nextMeta, setNextMeta] = useState<{ id: string | null; title: string | null; thumb: string | null }>({ id: null, title: null, thumb: null });
  const [nextCancelled, setNextCancelled] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [sleepSetting, setSleepSetting] = useState<SleepSetting>(0);
  const [durWarning, setDurWarning] = useState<SourceMismatchInfo | null>(null);
  const [tip, setTip] = useState<{ text: string; r: DOMRect } | null>(null);

  const [skips, setSkips] = useState<SkipSeg[]>([]);
  const [saidText, setSaidText] = useState('');
  const [seekFlash, setSeekFlash] = useState('');
  const [miniToast, setMiniToast] = useState('');
  const [failoverPrompt, setFailoverPrompt] = useState<{ reason: string; candidate: Ranked; autoSwitchSec: number; posMs: number } | null>(null);
  const [volBoostVal, setVolBoostVal] = useState<number | null>(null);
  const [volUi, setVolUi] = useState<number>(100);
  const [volMenuOpen, setVolMenuOpen] = useState(false);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [drawerFromMore, setDrawerFromMore] = useState(false);
  const [holdSpeed, setHoldSpeed] = useState(false);

  const [sources, setSources] = useState<{ streams: Ranked[]; current: Stream | null; loading: boolean }>({ streams: [], current: null, loading: false });
  const [episodes, setEpisodes] = useState<{ list: EpItem[]; current: string; seriesName: string; loading: boolean }>({ list: [], current: '', seriesName: '', loading: false });
  const [addonSubs, setAddonSubs] = useState<AddonSub[]>([]);

  const [partyInfo, setPartyInfo] = useState<{ canStart: boolean; on: boolean; role: string | null }>({ canStart: false, on: false, role: null });
  const [partyState, setPartyState] = useState<PartyView | null>(null);
  const [brbState, setBrbState] = useState<BrbState | null>(null);
  const [ratingRound, setRatingRound] = useState<RatingRoundView | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [voiceState, setVoiceState] = useState<VoiceStateView>(() =>
    (window as any).__majlisVoice?.getState?.() || { mode: 'ptt', pttKey: 'CapsLock', micOpen: false, autoDuck: true, talkers: [] }
  );
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [partyVotes, setPartyVotes] = useState<VoteItem[]>([]);
  const [partyNotes, setPartyNotes] = useState<PartyNoteItem[]>([]);
  const [partyQueue, setPartyQueue] = useState<PlayQueueItem[]>(() => usePlayQueueStore.getState().items);
  const [readyState, setReadyState] = useState<ReadyStateView | null>(null);
  const [myReadyLocal, setMyReadyLocal] = useState(false);
  const [countdownEnd, setCountdownEnd] = useState<number>(0);
  const [countdownNum, setCountdownNum] = useState<number>(0);
  const [catchUp, setCatchUp] = useState<{ active: boolean; speed: number; driftMs: number } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [floats, setFloats] = useState<{ id: number; emoji: string; from?: string; left: number }[]>([]);

  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [hoverThumb, setHoverThumb] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const thumbsRef = useRef(new Map<number, string>());
  const thumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const miniToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volBoostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const pttRef = useRef(voiceState);
  pttRef.current = voiceState;
  const floatIdRef = useRef(1);

  const showMiniToast = useCallback((msg: string) => {
    if (!msg) return;
    setMiniToast(msg);
    if (miniToastTimerRef.current) clearTimeout(miniToastTimerRef.current);
    miniToastTimerRef.current = setTimeout(() => setMiniToast(''), 2200);
  }, []);

  const volLockUntilRef = useRef(0);
  const draggingVolRef = useRef(false);
  const lastNonZeroVolRef = useRef(100);
  const maxVolRef = useRef(maxVol);
  maxVolRef.current = maxVol;
  const propsRef = useRef(props);
  propsRef.current = props;
  const volUiRef = useRef(volUi);
  volUiRef.current = volUi;
  const playbackPopupRef = useRef(playbackCfg.volumePopup);
  playbackPopupRef.current = playbackCfg.volumePopup;
  const autoHideMsRef = useRef(3000);
  autoHideMsRef.current = Math.max(1500, (pl.autoHideDelaySec || 3) * 1000);

  const setVolume = useCallback((next: number, showPopup = true) => {
    const cap = maxVolRef.current || 150;
    const clamped = Math.max(0, Math.min(cap, Math.round(next)));
    if (clamped > 0) lastNonZeroVolRef.current = clamped;
    volLockUntilRef.current = Date.now() + 380;
    setVolUi(clamped);
    cmd('volume', { v: clamped });
    if (propsRef.current.mute && clamped > 0) cmd('mute');
    if (clamped > 100 || (showPopup && playbackPopupRef.current)) {
      setVolBoostVal(clamped);
      if (volBoostTimerRef.current) clearTimeout(volBoostTimerRef.current);
      volBoostTimerRef.current = setTimeout(() => setVolBoostVal(null), 1300);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (propsRef.current.mute && volUiRef.current <= 0) {
      const restore = Math.max(10, Math.min(maxVolRef.current || 150, lastNonZeroVolRef.current || 100));
      volLockUntilRef.current = Date.now() + 380;
      setVolUi(restore);
      cmd('volume', { v: restore });
    }
    cmd('mute');
  }, []);

  const refreshPartyButton = () => api.invoke('party:info').then((r) => r && setPartyInfo(r)).catch(() => {});
  const handleResumeAnyway = () => { cmd('party-resume-anyway').catch(() => {}); };
  const handleBrb = (durationSec: number) => {
    api.invoke('social:brb', durationSec > 0 ? { action: 'start', durationSec } : { action: 'end' }).catch(() => {});
  };
  const handleBrbExtend = () => { api.invoke('social:brb', { action: 'extend', addSec: 120 }).catch(() => {}); };
  const handleVoiceMode = (mode: 'off' | 'ptt' | 'open') => { (window as any).__majlisVoice?.setMode?.(mode); };
  const handleVoicePtt = (down: boolean) => { (window as any).__majlisVoice?.setPtt?.(down); };

  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const pauseRef = useRef(false);
  pauseRef.current = !!props.pause;
  const drawerRef = useRef<DrawerKind>(drawer);
  drawerRef.current = drawer;

  const wake = useCallback((curPause?: boolean, curDrawer?: DrawerKind) => {
    if (focusModeRef.current) return;
    setIdle(false);
    setSkipHidden(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const p = curPause ?? pauseRef.current;
    const d = curDrawer !== undefined ? curDrawer : drawerRef.current;
    idleTimerRef.current = setTimeout(() => { if (!p && !d) setIdle(true); }, autoHideMsRef.current);
  }, []);
  const wakeRef = useRef(wake);
  wakeRef.current = wake;

  useEffect(() => {
    let lastWakeAt = 0;
    const onPointerMove = () => {
      const nowTs = Date.now();
      if (nowTs - lastWakeAt < 120) return;
      lastWakeAt = nowTs;
      wakeRef.current?.();
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  useEffect(() => {
    const syncVoice = (ev?: Event) => {
      const d = (ev as CustomEvent)?.detail || (window as any).__majlisVoice?.getState?.();
      if (d) setVoiceState(d);
    };
    syncVoice();
    window.addEventListener('majlis-voice', syncVoice);
    const onMouse = (down: boolean) => (e: MouseEvent) => {
      const v = pttRef.current;
      if (v.mode === 'ptt' && v.pttKey === `Mouse${e.button + 1}`) (window as any).__majlisVoice?.setPtt?.(down);
    };
    const onMd = onMouse(true), onMu = onMouse(false);
    window.addEventListener('mousedown', onMd, true);
    window.addEventListener('mouseup', onMu, true);
    return () => {
      window.removeEventListener('majlis-voice', syncVoice);
      window.removeEventListener('mousedown', onMd, true);
      window.removeEventListener('mouseup', onMu, true);
    };
  }, []);

  useEffect(() => {
    configureSfx({ theaterPlaying: hasFirstFrame && !props.pause });
  }, [hasFirstFrame, props.pause]);

  useEffect(() => {
    if (!countdownEnd) { setCountdownNum(0); return; }
    let lastTick = 0;
    const update = () => {
      const rem = countdownEnd - Date.now();
      if (rem <= 0) {
        setCountdownEnd(0);
        setCountdownNum(0);
        playSfx('go', { force: true });
        return false;
      }
      const n = Math.ceil(rem / 1000);
      setCountdownNum(n);
      if (n !== lastTick) {
        lastTick = n;
        playSfx('tick', { force: true });
      }
      return true;
    };
    if (!update()) return;
    const iv = setInterval(() => { if (!update()) clearInterval(iv); }, 100);
    return () => clearInterval(iv);
  }, [countdownEnd]);

  const needCountdown = (isFullscreen && pl.fullscreenClock) || !!brbState?.active || partyState?.reason === 'buffering';
  useEffect(() => {
    if (!needCountdown) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), (brbState?.active || partyState?.reason === 'buffering') ? 500 : 10000);
    return () => clearInterval(id);
  }, [needCountdown, brbState?.active, partyState?.reason]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || window.innerWidth;
      setCompactW(w < 1040);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hudShown = hasFirstFrame && !miniOn && !focusMode && (!idle || !!drawer);
  useEffect(() => {
    if (!hasFirstFrame) return;
    cmd('hud-visible', { on: hudShown }).catch(() => {});
  }, [hasFirstFrame, hudShown]);

  useEffect(() => { setTip(null); }, [idle, drawer, miniOn]);

  useEffect(() => {
    if (host?.lang === 'en' || host?.lang === 'ar') setLang(host.lang);
    if (host?.theme) setTheme(host.theme);
  }, [host?.lang, host?.theme]);

  useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById('cinRoot')) {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }
  }, [lang]);

  useEffect(() => {
    const checkFs = () => {
      const full = !!document.fullscreenElement || (window.innerWidth >= window.screen.width - 2 && window.innerHeight >= window.screen.height - 2);
      setIsFullscreen(full);
    };
    checkFs();
    window.addEventListener('resize', checkFs);
    document.addEventListener('fullscreenchange', checkFs);
    return () => {
      window.removeEventListener('resize', checkFs);
      document.removeEventListener('fullscreenchange', checkFs);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api.invoke('state').then((st) => {
      if (!alive || !st) return;
      const l: Lang = st.settings?.lang === 'en' ? 'en' : 'ar';
      setLang(l);
      if (st.settings?.accent) setAccent(st.settings.accent);
      if (st.settings?.cinemaTheme) setTheme(st.settings.cinemaTheme);
      configureSfx({
        enabled: st.settings?.soundEffects !== false,
        muteDuringPlayback: st.settings?.sfxMuteDuringPlayback !== false,
      });
    }).catch(() => {});

    cmd('state').then((st) => {
      if (!alive || !st) return;
      setProps(st);
      if (st.now?.card) setCard(st.now.card);
      if (st.now?.nextVideoId) setNextMeta((cur) => ({ ...cur, id: st.now.nextVideoId }));
      if (st.phase) setPhase(st.phase);
      if (st.statusMsg) setStatusMsg(st.statusMsg);
      if (st.now?.ranked) setSources((s) => ({ ...s, streams: st.now.ranked }));
      if (st.autoDuck !== undefined) setAutoDuck(st.autoDuck);
      if (st.spdif !== undefined) setSpdif(st.spdif);
      if (st.vsr !== undefined) setVsr(st.vsr);
      if (st.hwAccel !== undefined) setHwAccel(!!st.hwAccel);
      if (st.sdhFilter !== undefined) setSdhFilter(!!st.sdhFilter);
      if (st.subFpsMode) setSubFpsMode(String(st.subFpsMode));
      if (st.subStyle && typeof st.subStyle === 'object') {
        if (st.subStyle.subFont || st.subStyle.font) setSubFont(String(st.subStyle.subFont || st.subStyle.font));
        if (st.subStyle.subColor || st.subStyle.color) setSubColor(String(st.subStyle.subColor || st.subStyle.color));
        if (st.subStyle.subBold !== undefined || st.subStyle.bold !== undefined) setSubBold(!!(st.subStyle.subBold ?? st.subStyle.bold));
        if (Number.isFinite(Number(st.subStyle.subOutlinePx ?? st.subStyle.outlinePx))) setSubOutline(Number(st.subStyle.subOutlinePx ?? st.subStyle.outlinePx));
        if (Number.isFinite(Number(st.subStyle.subBackAlpha))) setSubBgAlpha(Number(st.subStyle.subBackAlpha));
      }
      if (st.ambientGlow !== undefined) setAmbientGlow(!!st.ambientGlow);
      if (st.night !== undefined) setNight(!!st.night);
      if (st.voiceClarity !== undefined) setVoiceClarity(!!st.voiceClarity);
      if (st.displayProfile) setDisplayProfile(String(st.displayProfile));
      if (st.detectedDisplayProfile) setDetectedDisplayProfile(String(st.detectedDisplayProfile));
      if (st.warmTint !== undefined) setWarmTint(Number(st.warmTint) || 0);
      if (st.dimmerPct !== undefined) setDimmerPct(Number(st.dimmerPct) || 0);
      if (st.secondaryDisplays !== undefined) setSecondaryDisplays(Number(st.secondaryDisplays) || 0);
      if (st.incognito !== undefined) setIncognito(!!st.incognito);
      if (st.multiEp) setMultiEp(st.multiEp);
      if (st.postCredits) setPostCredits(st.postCredits);
      if (st.loadedSubMap) setLoadedSubMap(st.loadedSubMap);
      if (Array.isArray(st.skips)) setSkips(st.skips);
      if (typeof st.volume === 'number') {
        if (st.volume > 0) lastNonZeroVolRef.current = st.volume;
        setVolUi(Math.max(0, Math.min(maxVolRef.current || 150, st.volume)));
      }
      if (Array.isArray(st.bookmarks)) setBookmarks(st.bookmarks);
      if (st.aspect) setAspect(st.aspect);
      if (st.toneMapping) setTone(st.toneMapping);
      if (st.partyState) {
        setPartyState(st.partyState);
        setBrbState(st.partyState?.brb?.active ? st.partyState.brb : null);
      }
      if (Array.isArray(st.partyVotes)) setPartyVotes(st.partyVotes);
      if (Array.isArray(st.partyNotes)) setPartyNotes(st.partyNotes);
      if (Array.isArray(st.partyQueue)) setPartyQueue(st.partyQueue);
      if (st.readyState) setReadyState(st.readyState);
      if ((st['time-pos'] || 0) > 0.05) setHasFirstFrame(true);
    }).catch(() => {});
    cmd('displays').then((d) => Array.isArray(d) && setDisplays(d)).catch(() => {});
    refreshPartyButton();

    const off = api.on((m) => {
      if (m.type === 'player') {
        setProps((prev) => ({ ...prev, [m.name]: m.value }));
        if (m.name === 'volume' && typeof m.value === 'number') {
          if (m.value > 0) lastNonZeroVolRef.current = m.value;
          if (!draggingVolRef.current && Date.now() > volLockUntilRef.current) {
            setVolUi(Math.max(0, Math.min(maxVolRef.current || 150, m.value)));
          }
        }
        if (m.name === 'time-pos' && typeof m.value === 'number' && m.value > 0.01) {
          setHasFirstFrame(true);
          setErrorInfo(null);
          setPhase('');
        }
        if (m.name === 'pause') wake(!!m.value);
      } else if (m.type === 'multi-ep') {
        setMultiEp(m.isMulti ? { isMulti: true, reason: m.reason, coveredIds: m.coveredIds, rangeLabel: m.rangeLabel, nextAfterId: m.nextAfterId } : null);
      } else if (m.type === 'post-credits') {
        setPostCredits({ after: !!m.after, during: !!m.during, resumeAt: m.resumeAt ?? null });
      } else if (m.type === 'theater') {
        setCard(m.card || {});
        setSkips([]);
        setErrorInfo(null);
        setSaidText('');
        setDurWarning(null);
        setNextCancelled(false);
        setMultiEp(null);
        setPostCredits(m.card?.postCredits || null);
        setCatchUp(null);
        thumbsRef.current.clear();
        if (m.loading) {
          setHtml5State({ active: false, url: '', startPos: 0, isHls: false });
          setFocusMode(false);
          setHasFirstFrame(false);
          setProps((prev) => ({ ...prev, 'time-pos': undefined, duration: undefined, 'core-idle': undefined }));
          setPhase(m.phase || 'searching');
          setStatusMsg('');
          setNight(false);
          setLoopA(null);
          setLoopB(null);
          setSkipHidden(false);
          autoSkippedRef.current.clear();
          setNextMeta({ id: null, title: null, thumb: null });
          setSleepSetting(0);
          setBrbState(null);
          setRatingRound(null);
          setMyScore(0);
          setFailoverPrompt(null);
          cmd('bookmark-list').then((list) => Array.isArray(list) && setBookmarks(list)).catch(() => {});
        } else if (m.phase) {
          setPhase(m.phase);
        }
        if (Array.isArray(m.ranked)) setSources((s) => ({ ...s, streams: m.ranked }));
        if (m.autoDuck !== undefined) setAutoDuck(m.autoDuck);
        if (m.spdif !== undefined) setSpdif(m.spdif);
        if (m.vsr !== undefined) setVsr(m.vsr);
        if (m.voiceClarity !== undefined) setVoiceClarity(!!m.voiceClarity);
        if (m.displayProfile) setDisplayProfile(String(m.displayProfile));
        if (m.detectedDisplayProfile) setDetectedDisplayProfile(String(m.detectedDisplayProfile));
        if (m.warmTint !== undefined) setWarmTint(Number(m.warmTint) || 0);
        if (m.hwAccel !== undefined) setHwAccel(!!m.hwAccel);
        if (m.sdhFilter !== undefined) setSdhFilter(!!m.sdhFilter);
        if (m.incognito !== undefined) setIncognito(!!m.incognito);
        if (m.aspect) setAspect(m.aspect);
        if (m.toneMapping) setTone(m.toneMapping);
        refreshPartyButton();
      } else if (m.type === 'incognito') {
        setIncognito(!!m.on);
      } else if (m.type === 'player-state') {
        if (m.candidate) setActiveCand(m.candidate);
        if (m.state === 'opening' || m.state === 'trying-source' || m.state === 'recovering') {
          setPhase(m.state === 'trying-source' ? 'trying-source' : 'opening');
          setStatusMsg(m.detail || '');
        } else if (m.state === 'vsr-fallback') {
          setStatusMsg(t('th_vsr_fallback'));
        } else if (m.state === 'failed') {
          setErrorInfo({ message: String(m.detail || 'Playback failed'), ranked: [] });
        }
      } else if (m.type === 'player-error') {
        setErrorInfo({ message: String(m.message || 'Playback error'), ranked: Array.isArray(m.ranked) ? m.ranked : [] });
        if (Array.isArray(m.ranked)) setSources((s) => ({ ...s, streams: m.ranked, loading: false }));
      } else if (m.type === 'failover-prompt') {
        if (m.clear || !m.candidate) setFailoverPrompt(null);
        else setFailoverPrompt({
          reason: String(m.reason || 'stall'),
          candidate: m.candidate,
          autoSwitchSec: Number(m.autoSwitchSec) || 0,
          posMs: Number(m.posMs) || 0,
        });
      } else if (m.type === 'skips') {
        setSkips(m.list || []);
      } else if (m.type === 'toast') {
        const L = langRef.current;
        if (m.kind === 'sub') {
          showMiniToast(translate(L, 'th_sub_loaded', { s: m.text || '' }));
          cmd('state').then((st) => st?.loadedSubMap && setLoadedSubMap(st.loadedSubMap)).catch(() => {});
        } else if (m.kind === 'shot') showMiniToast(translate(L, 'th_shot_saved'));
        else if (m.kind === 'clip') showMiniToast(translate(L, 'th_clip_saved', { s: m.text || '' }));
        else if (m.kind === 'sync') showMiniToast(translate(L, 'th_sub_synced', { s: m.text || '' }));
        else if (m.kind === 'remote-locked') {
          const holder = partyState?.control?.holderName || translate(L, 'party_remote_host');
          showMiniToast(translate(L, 'party_remote_locked', { name: holder }));
        }
        else if (m.text) showMiniToast(String(m.text));
      } else if (m.type === 'mini') {
        const on = !!m.on;
        setMiniOn(on);
        setTip(null);
        if (on) {
          setDrawer(null);
          setFocusMode(false);
        } else {
          setPipLocked(false);
          setFocusMode(false);
          setDrawer(null);
          if (typeof m.isFullscreen === 'boolean') setIsFullscreen(m.isFullscreen);
          wakeRef.current?.(false, null);
        }
      } else if (m.type === 'bookmarks') {
        setBookmarks(Array.isArray(m.list) ? m.list : []);
      } else if (m.type === 'next-meta') {
        setNextMeta({ id: m.nextVideoId || null, title: m.nextTitle || null, thumb: m.nextThumb || null });
      } else if (m.type === 'sleep-eof-triggered') {
        setSleepSetting(0);
      } else if (m.type === 'party') {
        setPartyState(m.state || null);
        setBrbState(m.state?.brb?.active ? m.state.brb : null);
        if (!m.state) { setCatchUp(null); setReadyState(null); }
        if (m.state?.mismatch) setDurWarning(m.state.mismatch);
        else if (!m.state) setDurWarning(null);
        refreshPartyButton();
      } else if (m.type === 'party-catchup') {
        setCatchUp(m.active ? { active: true, speed: Number(m.speed) || 1.15, driftMs: Number(m.driftMs) || 0 } : null);
      } else if (m.type === 'party-ready') {
        if (m.prompt) setMyReadyLocal(false);
        setReadyState((prev) => ({
          active: m.active !== undefined ? !!m.active : !!prev?.active,
          hostReady: m.hostReady ?? prev?.hostReady,
          peers: Array.isArray(m.peers) && m.peers.length ? m.peers : (prev?.peers || []),
          prompt: m.prompt ?? prev?.prompt,
        }));
        if (m.active || m.prompt) playSfx('ready');
      } else if (m.type === 'party-countdown') {
        setMyReadyLocal(false);
        setReadyState(null);
        const startAt = Number(m.startAt) || (Date.now() + (Number(m.ms) || 3000));
        setCountdownEnd(startAt);
      } else if (m.type === 'party-control') {
        setPartyState((prev) => prev ? { ...prev, control: m.control || { mode: m.mode, holderId: m.holderId, holderName: m.holderName }, canControl: typeof m.canControl === 'boolean' ? m.canControl : prev.canControl } : prev);
        playSfx('remote');
      } else if (m.type === 'party-notes') {
        setPartyNotes(Array.isArray(m.notes) ? m.notes : []);
        playSfx('note');
      } else if (m.type === 'cin:queue-updated') {
        setPartyQueue(Array.isArray(m.items) ? m.items : []);
      } else if (m.type === 'party-brb') {
        setBrbState(m.brb?.active ? m.brb : null);
      } else if (m.type === 'party-rating-open') {
        setRatingRound(m.round || null);
        setMyScore(0);
      } else if (m.type === 'party-rating-state') {
        setRatingRound((cur) => {
          if (m.round?.revealed && !cur?.revealed) playSfx('reveal');
          return m.round || cur;
        });
      } else if (m.type === 'party-mismatch') {
        setDurWarning({
          reason: m.reason === 'edition' ? 'edition' : 'duration',
          diffSec: m.diffSec ?? (m.hostDur && m.localDur ? Math.round(Math.abs(m.hostDur - m.localDur)) : undefined),
          hostDur: m.hostDur,
          localDur: m.localDur,
          hostEdition: m.hostEdition,
          localEdition: m.localEdition,
        });
      } else if (m.type === 'party-chat') {
        setChatMsgs((prev) => [...prev.slice(-80), { id: m.id || String(Date.now()), from: m.from, accent: m.accent, text: m.text, at: m.at }]);
        playSfx('chat');
      } else if (m.type === 'party-react') {
        const id = floatIdRef.current++;
        setFloats((prev) => [...prev.slice(-14), { id, emoji: m.r || '🔥', from: m.from, left: 20 + Math.floor(Math.random() * 60) }]);
        setTimeout(() => setFloats((prev) => prev.filter((x) => x.id !== id)), 2500);
      } else if (m.type === 'party-vote') {
        setPartyVotes(Array.isArray(m.items) ? m.items : []);
        playSfx('vote');
      } else if (m.type === 'html5-fallback') {
        if (m.active && m.url) {
          setHtml5State({ active: true, url: String(m.url), startPos: Number(m.startPos) || 0, isHls: !!m.isHls });
        } else {
          setHtml5State({ active: false, url: '', startPos: 0, isHls: false });
        }
      } else if (m.type === 'html5-cmd') {
        setHtml5Cmd({ seq: html5CmdSeqRef.current++, cmd: m as Html5Cmd });
      }
    });
    return () => {
      off?.();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
      if (miniToastTimerRef.current) clearTimeout(miniToastTimerRef.current);
      if (volBoostTimerRef.current) clearTimeout(volBoostTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!failoverPrompt || failoverPrompt.autoSwitchSec <= 0) return;
    const tmr = setTimeout(() => {
      setFailoverPrompt((cur) => {
        if (!cur) return null;
        if (cur.autoSwitchSec <= 1) {
          cmd('failover-switch', { candidate: cur.candidate, posMs: cur.posMs }).catch(() => {});
          return null;
        }
        return { ...cur, autoSwitchSec: cur.autoSwitchSec - 1 };
      });
    }, 1000);
    return () => clearTimeout(tmr);
  }, [failoverPrompt]);

  // Keyboard shortcuts + Hold Space 2x (guarded against INPUT elements & Ctrl/Cmd combinations)
  useEffect(() => {
    let spaceTimer: ReturnType<typeof setTimeout> | null = null;
    let holdingSpace = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') {
        if (e.key === 'Escape') { (e.target as HTMLElement).blur(); setDrawer(null); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setStatsOpen((x) => !x);
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        cmd('screenshot', { withSubs: shotWithSubs });
        return;
      }
      if (pttRef.current.mode === 'ptt' && e.code === (pttRef.current.pttKey || 'CapsLock')) {
        e.preventDefault();
        if (!e.repeat) handleVoicePtt(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && !drawer && !miniOn && activeSkipRef.current) {
        e.preventDefault();
        const sk = activeSkipRef.current;
        cmd('seek', { to: sk.to, abs: true });
        setSkipHidden(true);
        showMiniToast(translate(langRef.current, 'th_skip_done', { s: translate(langRef.current, sk.labelKey) }));
        return;
      }
      wake();
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceTimer = setTimeout(() => { holdingSpace = true; setHoldSpeed(true); cmd('speed', { v: 2 }); }, 280);
        return;
      }
      const backSec = ctrlCfg.seekBackSec || 10;
      const fwdSec = ctrlCfg.seekFwdSec || 10;
      switch (e.key.toLowerCase()) {
        case 'k': e.preventDefault(); cmd('toggle'); break;
        case 'arrowleft': e.preventDefault(); flashSeek(lang === 'ar' ? `+${fwdSec}s` : `−${backSec}s`); cmd('seek', { to: lang === 'ar' ? fwdSec : -backSec }); break;
        case 'arrowright': e.preventDefault(); flashSeek(lang === 'ar' ? `−${backSec}s` : `+${fwdSec}s`); cmd('seek', { to: lang === 'ar' ? -backSec : fwdSec }); break;
        case 'j': flashSeek(`−${backSec}s`); cmd('seek', { to: -backSec }); break;
        case 'l': flashSeek(`+${fwdSec}s`); cmd('seek', { to: fwdSec }); break;
        case 'arrowup': e.preventDefault(); setVolume(volUiRef.current + 5, true); break;
        case 'arrowdown': e.preventDefault(); setVolume(volUiRef.current - 5, true); break;
        case 'm': toggleMute(); break;
        case 'f': cmd('fullscreen').then((fs) => { if (typeof fs === 'boolean') setIsFullscreen(fs); }).catch(() => {}); break;
        case 'p': api.invoke('mini').catch(() => {}); break;
        case 'i': setStatsOpen((x) => !x); break;
        case 's': openDrawer('subs'); break;
        case 'a': openDrawer('audio'); break;
        case 'e': if (card.type === 'series') openDrawer('episodes'); break;
        case 'c': openDrawer('chapters'); break;
        case 'v': openDrawer('sources'); break;
        case 'n': setNight((n) => { cmd('night'); return !n; }); break;
        case 'h': {
          e.preventDefault();
          const next = !focusModeRef.current;
          setFocusMode(next);
          if (next) {
            setDrawer(null);
            setIdle(true);
            showMiniToast(translate(langRef.current, 'th_focus_hint'));
          } else {
            setIdle(false);
          }
          break;
        }
        case 'escape':
          if (focusModeRef.current) { setFocusMode(false); setIdle(false); }
          else if (drawer) setDrawer(null);
          else if (miniOn) api.invoke('mini').catch(() => {});
          else if (isFullscreen && ctrlCfg.escExitsFullscreenFirst) {
            cmd('fullscreen').then((fs) => { if (typeof fs === 'boolean') setIsFullscreen(fs); }).catch(() => {});
          }
          else cmd('close');
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (pttRef.current.mode === 'ptt' && e.code === (pttRef.current.pttKey || 'CapsLock')) {
        e.preventDefault();
        handleVoicePtt(false);
        return;
      }
      if (e.code !== 'Space') return;
      if (spaceTimer) { clearTimeout(spaceTimer); spaceTimer = null; }
      if (holdingSpace) { holdingSpace = false; setHoldSpeed(false); cmd('speed', { v: 1 }); }
      else cmd('toggle');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [lang, drawer, card.type, shotWithSubs, miniOn, isFullscreen, setVolume, toggleMute, ctrlCfg.seekBackSec, ctrlCfg.seekFwdSec, ctrlCfg.escExitsFullscreenFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  const flashSeek = (label: string) => {
    setSeekFlash(label);
    setTimeout(() => setSeekFlash((cur) => (cur === label ? '' : cur)), 650);
  };

  const triggerWhatSaid = useCallback(async () => {
    const s = await cmd('sub-text').catch(() => '');
    setSaidText(s || t('th_said_none'));
    setTimeout(() => setSaidText(''), 4200);
  }, [t]);

  const openDrawer = async (next: DrawerKind, fromMore = false) => {
    setVolMenuOpen(false);
    if (drawer === next) { setDrawer(null); setDrawerFromMore(false); return; }
    setDrawerFromMore(fromMore && (next === 'sources' || next === 'episodes' || next === 'chapters'));
    setDrawer(next);
    wake(undefined, next);
    if (next === 'sources') {
      setSources((s) => ({ ...s, loading: true }));
      const r = await cmd('sources').catch(() => ({ streams: [], current: null }));
      setSources({ streams: r?.streams || [], current: r?.current || null, loading: false });
    } else if (next === 'episodes') {
      setEpisodes((ep) => ({ ...ep, loading: true }));
      const r = await cmd('episodes').catch(() => ({ episodes: [], current: '', seriesName: '' }));
      setEpisodes({ list: r?.episodes || [], current: r?.current || '', seriesName: r?.seriesName || '', loading: false });
    } else if (next === 'subs') {
      const list = await cmd('addon-subs').catch(() => []);
      setAddonSubs(Array.isArray(list) ? list : []);
    } else if (next === 'party') {
      const v = await cmd('party-vote').catch(() => []);
      if (Array.isArray(v)) setPartyVotes(v);
    } else if (next === 'tools') {
      const bms = await cmd('bookmark-list').catch(() => null);
      if (Array.isArray(bms)) setBookmarks(bms);
    } else if (next === 'video') {
      cmd('displays').then((d) => Array.isArray(d) && setDisplays(d)).catch(() => {});
    } else if (next === 'more') {
      cmd('displays').then((d) => Array.isArray(d) && setDisplays(d)).catch(() => {});
      cmd('bookmark-list').then((bms) => Array.isArray(bms) && setBookmarks(bms)).catch(() => {});
    }
  };

  const applySleep = (val: SleepSetting) => {
    setSleepSetting(val);
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    cmd('sleep-eof', { on: val === 'eof' }).catch(() => {});
    if (typeof val === 'number' && val > 0) {
      sleepTimerRef.current = setTimeout(() => { cmd('pause', { on: true }); setSleepSetting(0); }, val * 60000);
    }
  };

  const handlePopoverCmd = async (c: string, a?: Record<string, unknown>) => {
    const res = await cmd(c, a);
    if (c === 'duck') setAutoDuck(!!res);
    if (c === 'spdif') setSpdif(!!res);
    if (c === 'vsr-toggle') setVsr(!!res);
    if (c === 'voice-clarity') setVoiceClarity(!!res);
    if (c === 'warm-tint' && res !== undefined) setWarmTint(Number(res) || 0);
    if (c === 'dimmer' && res) {
      setDimmerPct(Number(res.opacity) || 0);
      if (res.displays !== undefined) setSecondaryDisplays(Number(res.displays) || 0);
    }
    if (c === 'display-profile' && res) {
      if (res.mode) setDisplayProfile(String(res.mode));
      if (res.detected) setDetectedDisplayProfile(String(res.detected));
      if (res.toneMapping) setTone(String(res.toneMapping));
    }
    if (c === 'hwdec-toggle') setHwAccel(!!res);
    if (c === 'sdh-toggle') setSdhFilter(!!res);
    if (c === 'sub-fps-shift' && res?.mode) setSubFpsMode(String(res.mode));
    if (c === 'external-launch' && res && !res.ok) showMiniToast(t('th_ext_missing', { p: a?.player === 'vlc' ? 'VLC' : 'mpv' }));
    if (c === 'export-m3u' && res?.ok) showMiniToast(t('th_m3u_saved'));
    if (c === 'ambient-glow') setAmbientGlow(!!res);
    if (c === 'aspect') setAspect(String(res));
    if (c === 'tone-mapping') setTone(String(res));
    if (c === 'ab-loop' && res) {
      if ('a' in res) setLoopA(res.a);
      if ('b' in res) setLoopB(res.b);
    }
    if (c === 'addon-sub-add' && res) {
      cmd('state').then((st) => st?.loadedSubMap && setLoadedSubMap(st.loadedSubMap)).catch(() => {});
    }
    if ((c === 'bookmark-add' || c === 'bookmark-del') && Array.isArray(res)) setBookmarks(res);
    if (c === 'move-display') {
      cmd('displays').then((d) => Array.isArray(d) && setDisplays(d)).catch(() => {});
    }
    return res;
  };

  const dur = props.duration || 0;
  const pos = props['time-pos'] || 0;
  const cacheEnd = dur ? Math.min(100, ((pos + (props['demuxer-cache-duration'] || 0)) / dur) * 100) : 0;
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  const endsAt = useMemo(() => {
    if (!dur || dur <= pos) return '';
    const d = new Date(Date.now() + (dur - pos) * 1000);
    return fmtLocaleTime(d, lang, { hour: '2-digit', minute: '2-digit' });
  }, [dur, pos, lang]);

  const chapters = props['chapter-list'] || [];
  const curChapIdx = props.chapter ?? -1;
  const curChapterTitle = chapters[curChapIdx]?.title || '';

  const activeSkip = useMemo(() => {
    const sk = skips.find((s) => pos >= s.start && pos < s.end - 1);
    const canSkipOutro = sk && sk.kind === 'ed' && (card.type !== 'series' || (dur > 0 && sk.end < dur - 20));
    if (sk && (sk.kind !== 'ed' || canSkipOutro)) {
      const k = sk.kind.toLowerCase();
      return { to: sk.end, kind: (k === 'recap' ? 'recap' : k === 'ed' ? 'ed' : 'op') as 'op' | 'recap' | 'ed', labelKey: (k === 'recap' ? 'th_skip_recap' : k === 'ed' ? 'th_skip_credits' : 'th_skip_intro') as Key };
    }
    if (chapters[curChapIdx] && INTRO.test(chapters[curChapIdx].title || '') && chapters[curChapIdx + 1]) {
      return { to: chapters[curChapIdx + 1].time, kind: 'op' as const, labelKey: 'th_skip_intro' as Key };
    }
    if (chapters[curChapIdx] && RECAP.test(chapters[curChapIdx].title || '') && chapters[curChapIdx + 1]) {
      return { to: chapters[curChapIdx + 1].time, kind: 'recap' as const, labelKey: 'th_skip_recap' as Key };
    }
    if (chapters[curChapIdx] && OUTRO.test(chapters[curChapIdx].title || '') && chapters[curChapIdx + 1] && dur > 0 && chapters[curChapIdx + 1].time < dur - 20) {
      return { to: chapters[curChapIdx + 1].time, kind: 'ed' as const, labelKey: 'th_skip_credits' as Key };
    }
    return null;
  }, [skips, pos, dur, card.type, chapters, curChapIdx]);
  const activeSkipRef = useRef(activeSkip);
  activeSkipRef.current = activeSkip;

  useEffect(() => {
    if (!hasFirstFrame || !activeSkip || partyState?.role === 'guest' || miniOn) return;
    const shouldAuto =
      (activeSkip.kind === 'op' && playbackCfg.autoSkipIntros) ||
      (activeSkip.kind === 'recap' && playbackCfg.autoSkipRecaps) ||
      (activeSkip.kind === 'ed' && playbackCfg.autoSkipCredits);
    const segKey = `${card.metaId || card.name || 'cur'}:${activeSkip.kind}:${Math.round(activeSkip.to)}`;
    if (!shouldAuto || autoSkippedRef.current.has(segKey)) return;
    autoSkippedRef.current.add(segKey);
    cmd('seek', { to: activeSkip.to, abs: true }).catch(() => {});
    showMiniToast(t('th_auto_skipped'));
  }, [hasFirstFrame, activeSkip, partyState?.role, miniOn, playbackCfg.autoSkipIntros, playbackCfg.autoSkipRecaps, playbackCfg.autoSkipCredits, card.metaId, card.name, showMiniToast, t]);

  const activeSkipKey = activeSkip ? `${activeSkip.labelKey}:${Math.round(activeSkip.to)}` : '';
  useEffect(() => {
    setSkipHidden(false);
    if (!activeSkipKey || playbackCfg.hideSkipAfter === 'off') return;
    const sec = Number(playbackCfg.hideSkipAfter);
    if (!Number.isFinite(sec) || sec <= 0) return;
    const id = setTimeout(() => setSkipHidden(true), sec * 1000);
    return () => clearTimeout(id);
  }, [activeSkipKey, playbackCfg.hideSkipAfter]);

  const nextLeftSec = dur > 60 ? Math.max(0, Math.ceil(dur - pos)) : 0;
  const showNextCountdown = card.type === 'series' && hasFirstFrame && !miniOn && !errorInfo && !nextCancelled && sleepSetting !== 'eof' && !!nextMeta.id && dur > 60 && dur - pos <= 20 && dur - pos > 0.2;
  const showNextEpPill = !showNextCountdown && !miniOn && card.type === 'series' && (
    skips.some((s) => s.kind === 'ed' && pos >= s.start) || (!!chapters[curChapIdx] && OUTRO.test(chapters[curChapIdx].title || '')) || (dur > 0 && pos > dur - 60)
  );

  const showCurtain = !hasFirstFrame && !errorInfo;
  const waitingMidPlay = hasFirstFrame && !errorInfo && (!!props['paused-for-cache'] || (props['core-idle'] && !props.pause));

  const seekAt = (clientX: number) => {
    const el = seekRef.current;
    if (!el || !dur) return 0;
    const r = el.getBoundingClientRect();
    let f = (clientX - r.left) / r.width;
    if (lang === 'ar') f = 1 - f;
    return Math.max(0, Math.min(1, f)) * dur;
  };

  const onSeekMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dur || !seekRef.current) return;
    const sec = seekAt(e.clientX), bucket = Math.floor(sec / 4) * 4;
    const r = seekRef.current.getBoundingClientRect();
    setHoverSec(sec);
    setHoverX(Math.max(88, Math.min(r.width - 88, e.clientX - r.left)));
    if (!pl.hoverThumbPreview) { setHoverThumb(null); return; }
    const cached = thumbsRef.current.get(bucket);
    if (cached) { setHoverThumb(cached); return; }
    setHoverThumb(null);
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(async () => {
      const url = await cmd('thumb', { t: bucket }).catch(() => null);
      if (url) {
        if (thumbsRef.current.size > 120) thumbsRef.current.delete(thumbsRef.current.keys().next().value!);
        thumbsRef.current.set(bucket, url);
        setHoverThumb(url);
      }
    }, 120);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (drawer) return;
    wake();
    if (e.shiftKey) {
      if (dur > 0) {
        const s = e.deltaY < 0 ? 5 : -5;
        flashSeek(s > 0 ? '+5s' : '−5s');
        cmd('seek', { to: s });
      }
    } else {
      const delta = e.deltaY < 0 ? 5 : -5;
      setVolume(volUiRef.current + delta, true);
    }
  };

  const displayTitle = useMemo(() => {
    const clean = (s?: string) => (s && !RAW_ID_RE.test(s.trim()) ? s.trim() : '');
    const main = clean(card.name);
    const ser = clean(card.seriesName);
    if (apCfg.seriesNameFirstPlayer && ser && main && !main.startsWith(ser)) {
      return `${ser} · ${main}`;
    }
    return main || ser || t('playing');
  }, [card.name, card.seriesName, apCfg.seriesNameFirstPlayer, t]);

  const bgUrl = card.background || (card.metaId ? metahub('background', card.metaId, 'large') : null) || card.poster;
  const logoUrl = card.logo || (card.metaId ? metahub('logo', card.metaId, 'large') : null);
  const vp = props['video-params'];
  const resTag = vp?.h ? (vp.h >= 2160 ? '4K' : `${vp.h}p`) : activeCand?.facts?.height ? (activeCand.facts.height >= 2160 ? '4K' : `${activeCand.facts.height}p`) : null;
  const hwTag = props['hwdec-current'] && props['hwdec-current'] !== 'no' ? props['hwdec-current'] : null;

  useMediaSession({
    active: !!(card.name || props.duration),
    hasFirstFrame,
    paused: !!props.pause,
    pos,
    dur,
    speed: Number(props.speed) || 1,
    title: displayTitle,
    artist: card.seriesName && card.seriesName !== displayTitle ? card.seriesName : undefined,
    artworkUrl: card.poster || bgUrl || null,
    incognito,
    hasNext: card.type === 'series' && !!nextMeta.id,
    onPlay: () => cmd('pause', { on: false }).catch(() => {}),
    onPause: () => cmd('pause', { on: true }).catch(() => {}),
    onSeekRelative: (deltaSec) => cmd('seek', { to: deltaSec }).catch(() => {}),
    onSeekAbsolute: (sec) => cmd('seek', { to: sec, abs: true }).catch(() => {}),
    onNext: () => api.invoke('player:next').catch(() => {}),
    onStop: () => cmd('close').catch(() => {}),
  });

  const handleRate = async (score: number) => {
    if (!ratingRound) return;
    setMyScore(score);
    try {
      const res = await api.invoke('social:rate', {
        id: ratingRound.id,
        type: ratingRound.type || card.type || 'movie',
        title: ratingRound.title || displayTitle,
        poster: ratingRound.poster ?? card.poster ?? null,
        score,
        sessionId: ratingRound.sessionId,
      });
      if (res?.round) setRatingRound(res.round);
      useProfileStore.getState().addRating({
        id: ratingRound.id,
        title: ratingRound.title || displayTitle,
        type: ratingRound.type === 'series' ? 'series' : 'movie',
        poster: ratingRound.poster ?? card.poster ?? null,
        score,
      });
      showMiniToast(t('th_rating_saved'));
    } catch {}
  };

  const waitLeftSec = partyState?.waitEndsAt ? Math.max(0, Math.ceil((partyState.waitEndsAt - nowMs) / 1000)) : 0;
  const brbLeftSec = brbState?.active ? Math.max(0, Math.ceil((brbState.endsAt - nowMs) / 1000)) : 0;
  const waitingPeers = (partyState?.peers || []).filter((p) => p.stalled || (partyState?.waitingFor || []).includes(p.name || p.id));
  const waitingNames = (partyState?.waitingFor?.length ? partyState.waitingFor : waitingPeers.map((p) => p.name || p.id)).join(', ');
  const ratingVotes: RatingVoteView[] = ratingRound
    ? (Array.isArray(ratingRound.votes) ? ratingRound.votes : Object.values(ratingRound.votes || {}))
    : [];

  const startWinDrag = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || isFullscreen) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest('button,a,input,select,textarea,[data-no-drag]')) return;
    api.invoke('win:start-drag').catch(() => {});
  }, [isFullscreen]);

  const winControlsEl = !isFullscreen && !miniOn ? (
    <div data-no-drag className="app-no-drag pointer-events-auto flex flex-none items-center gap-1 rounded-full bg-black/55 p-1 ring-1 ring-white/15 backdrop-blur-xl">
      <button type="button" onClick={() => api.invoke('win:minimize').catch(() => {})} aria-label={t('th_win_min')}
        className="grid size-7 place-items-center rounded-full text-fg2 transition hover:bg-white/15 hover:text-fg">
        <Minus size={13} strokeWidth={2} />
      </button>
      <button type="button" onClick={() => api.invoke('win:maximize').catch(() => {})} aria-label={t('th_win_max')}
        className="grid size-7 place-items-center rounded-full text-fg2 transition hover:bg-white/15 hover:text-fg">
        <Maximize size={12} strokeWidth={2} />
      </button>
      <button type="button" onClick={() => api.invoke('win:close').catch(() => {})} aria-label={t('close')}
        className="grid size-7 place-items-center rounded-full text-fg2 transition hover:bg-red-500/80 hover:text-white">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  ) : null;

  return (
    <div ref={shellRef} dir={lang === 'ar' ? 'rtl' : 'ltr'} onMouseMove={() => wake()} onWheel={onWheel}
      onPointerOver={(e) => { const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null; setTip(el ? { text: el.dataset.tip || '', r: el.getBoundingClientRect() } : null); }}
      onPointerLeave={() => setTip(null)} onPointerDown={() => setTip(null)}
      className={`th-shell !bg-transparent ${idle && !miniOn ? 'cursor-none' : ''} ${miniOn ? 'group/pip ring-1 ring-white/25' : ''}`}
      data-theme={theme} style={accent ? ({ '--c-acc': accent } as React.CSSProperties) : undefined}>

      {/* Warm Obsidian Gold Edge Aura when enabled */}
      {ambientGlow && hasFirstFrame && !miniOn ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[1] opacity-35 transition-all duration-700"
          style={{
            boxShadow: 'inset 0 80px 100px -45px rgba(217,164,65,0.45), inset 0 -80px 100px -45px rgba(217,164,65,0.35)',
          }}
        />
      ) : null}

      {warmTint > 0 && hasFirstFrame ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] mix-blend-multiply transition-opacity duration-300"
          style={{ backgroundColor: '#ff9638', opacity: Math.min(0.42, (warmTint / 100) * 0.42) }}
        />
      ) : null}

      {/* 0. Native D3D11 Video shows through transparent stage; mount HTML5 HLSv2/MSE fallback only when active */}
      {html5State.active && html5State.url ? (
        <Html5Stage
          url={html5State.url}
          startPos={html5State.startPos}
          isHls={html5State.isHls}
          cmdSeq={html5Cmd}
          onFirstFrame={() => { setHasFirstFrame(true); setErrorInfo(null); setPhase(''); }}
        />
      ) : null}

      {/* Interactive Split-Screen A/B Quality Comparator Divider */}
      {compareActive && !miniOn ? (
        <div
          className="app-no-drag absolute inset-0 z-[18] select-none cursor-ew-resize"
          onPointerDown={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const updateAt = (cx: number) => setCompareSplit(Math.max(0.08, Math.min(0.92, (cx - box.left) / box.width)));
            updateAt(e.clientX);
            const onMove = (mv: PointerEvent) => updateAt(mv.clientX);
            const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp, { once: true });
          }}
        >
          <span style={{ left: `calc(${compareSplit * 100}% - 76px)` }} className="pointer-events-none absolute top-16 rounded-full bg-black/75 px-2.5 py-0.5 text-[11px] font-semibold text-fg2 ring-1 ring-white/15 backdrop-blur">
            {t('th_ab_before')}
          </span>
          <span style={{ left: `calc(${compareSplit * 100}% + 12px)` }} className="pointer-events-none absolute top-16 rounded-full bg-acc/90 px-2.5 py-0.5 text-[11px] font-bold text-acc-ink shadow">
            {t('th_ab_after')}
          </span>
          <div style={{ left: `${compareSplit * 100}%` }} className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-acc shadow-[0_0_12px_rgba(226,164,58,0.85)]">
            <div className="absolute top-1/2 start-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-acc text-xs font-black text-acc-ink shadow-xl ring-2 ring-black/60">
              ↔
            </div>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCompareActive(false)}
            className="absolute top-16 end-5 grid size-7 place-items-center rounded-full bg-black/75 text-fg ring-1 ring-white/20 hover:bg-white/20"
            data-tip={t('cancel')}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      {/* 0b. Subtle Top Window Drag Handle when HUD auto-hides (or full drag surface in PiP mini-player) */}
      {miniOn ? (
        <>
          <div onMouseDown={startWinDrag} onDoubleClick={() => api.invoke('mini', false).catch(() => {})} className="absolute inset-0 z-20 cursor-move" />
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between bg-gradient-to-t from-black/80 via-transparent to-black/70 p-2.5 opacity-0 transition-opacity group-hover/pip:opacity-100">
            <div className="flex items-center justify-between gap-2">
              <span dir="auto" className="truncate text-[11px] font-bold text-fg drop-shadow">{displayTitle}</span>
              <div className="app-no-drag pointer-events-auto flex items-center gap-1">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { const next = !pipLocked; setPipLocked(next); cmd('pip-lock', { locked: next }).catch(() => {}); }}
                  data-tip={t(pipLocked ? 'th_pip_unlock' : 'th_pip_lock')}
                  className={`grid size-6 place-items-center rounded-full ${pipLocked ? 'bg-acc text-acc-ink' : 'bg-white/15 text-fg hover:bg-white/25'}`}
                >
                  {pipLocked ? <Lock size={11} strokeWidth={2} /> : <Unlock size={11} strokeWidth={2} />}
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); api.invoke('mini', false).catch(() => {}); }}
                  data-tip={t('th_pip_return')}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-semibold text-fg hover:bg-acc hover:text-acc-ink"
                >
                  {t('th_pip_return')}
                </button>
                <button onClick={() => cmd('close')} data-tip={t('th_close_player')}
                  className="grid size-6 place-items-center rounded-full bg-white/15 text-fg hover:bg-red-500/80">
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="app-no-drag pointer-events-auto flex items-center justify-center gap-2">
                <button onClick={() => cmd('seek', { to: -10 })} className="grid size-8 place-items-center rounded-full bg-black/70 text-fg ring-1 ring-white/20 hover:bg-white/20">
                  <RotateCcw size={14} strokeWidth={2} />
                </button>
                <button onClick={() => cmd('toggle')} className="grid size-10 place-items-center rounded-full bg-black/75 text-fg ring-1 ring-white/25 hover:bg-acc hover:text-acc-ink">
                  {props.pause ? <Play size={18} strokeWidth={2} className="fill-current" /> : <Pause size={18} strokeWidth={2} className="fill-current" />}
                </button>
                <button onClick={() => cmd('seek', { to: 10 })} className="grid size-8 place-items-center rounded-full bg-black/70 text-fg ring-1 ring-white/20 hover:bg-white/20">
                  <RotateCw size={14} strokeWidth={2} />
                </button>
                <button onClick={() => cmd('mute')} className="grid size-8 place-items-center rounded-full bg-black/70 text-fg ring-1 ring-white/20 hover:bg-white/20">
                  {props.mute ? <VolumeX size={14} strokeWidth={2} /> : <Volume2 size={14} strokeWidth={2} />}
                </button>
              </div>
              {dur > 0 ? (
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
                  <div className="h-full bg-acc transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, (pos / dur) * 100))}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (!isFullscreen ? (
        <div onMouseDown={startWinDrag} onDoubleClick={() => api.invoke('win:maximize').catch(() => {})} className="absolute inset-x-0 top-0 z-[15] h-10 pe-[116px]" />
      ) : null)}

      {/* 1. Blurred ClearLogo Cinematic Curtain before first video frame */}
      <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#050507] transition-opacity duration-500 ${showCurtain ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        {!isFullscreen ? (
          <div onMouseDown={startWinDrag} onDoubleClick={() => api.invoke('win:maximize').catch(() => {})} className="absolute inset-x-0 top-0 flex h-12 items-center justify-end px-4">
            {winControlsEl}
          </div>
        ) : null}
        {bgUrl ? <Img eager srcs={[bgUrl]} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" /> : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/65 to-[#050507]/85" />
        <div className="relative z-10 flex max-w-lg flex-col items-center px-6 text-center">
          {logoUrl ? <Img eager srcs={[logoUrl]} alt={displayTitle} className="mb-4 max-h-[clamp(76px,11vh,120px)] max-w-[clamp(230px,26vw,360px)] object-contain drop-shadow-[0_8px_28px_rgba(0,0,0,.9)]" />
            : <h1 className="mb-3 text-[clamp(22px,2.2vw,34px)] font-bold text-fg">{displayTitle}</h1>}
          {logoUrl && card.name && !RAW_ID_RE.test(card.name.trim()) ? (
            <div dir="auto" className="mb-3 text-[clamp(13px,1vw,16px)] font-semibold text-fg/85">{displayTitle}</div>
          ) : null}
          <div className="mb-4 flex flex-wrap justify-center gap-1.5 text-[clamp(11px,0.85vw,13px)]">
            {activeCand?.addon?.name ? <span className="rounded-full bg-white/10 px-3 py-0.5 font-medium text-fg">{activeCand.addon.name}</span> : null}
            {resTag ? <span dir="ltr" className="rounded-full bg-acc/20 px-3 py-0.5 font-mono font-bold text-acc">{resTag}</span> : null}
            {activeCand?.facts?.hdr ? <span className="rounded-full bg-amber-400/20 px-3 py-0.5 font-mono font-bold text-amber-300">HDR</span> : null}
          </div>
          <div className="mb-3 h-1.5 w-60 overflow-hidden rounded-full bg-white/15">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-acc" />
          </div>
          <p className="mb-6 text-[clamp(12px,0.95vw,15px)] text-fg2">
            {phase === 'searching' ? t('th_searching') : phase === 'trying-source' ? t('th_trying_source', { s: statusMsg }) : phase === 'opening' ? t('th_opening', { s: statusMsg }) : t('th_buffering')}
          </p>
          <div className="flex gap-3">
            <button onClick={() => openDrawer('sources')} className="rounded-full bg-white/10 px-[clamp(16px,1.3vw,22px)] py-[clamp(8px,0.8vh,11px)] text-[clamp(12px,0.95vw,15px)] font-semibold hover:bg-white/20">{t('th_sources')}</button>
            <button onClick={() => cmd('close')} className="rounded-full bg-white/10 px-[clamp(16px,1.3vw,22px)] py-[clamp(8px,0.8vh,11px)] text-[clamp(12px,0.95vw,15px)] font-semibold text-fg2 hover:bg-white/20 hover:text-fg">{t('cancel')}</button>
          </div>
        </div>
      </div>

      {/* 2. Actionable Source Error Card */}
      {errorInfo ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[#050507]/95 p-5 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-2xl bg-bg1 p-6 text-center ring-1 ring-white/15 shadow-2xl">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-red-500/15 text-red-400">
              <X size={24} strokeWidth={2} />
            </div>
            <h2 className="mb-2 text-[clamp(17px,1.3vw,22px)] font-bold">{t('th_failed')}</h2>
            <p dir="auto" className="mb-5 text-[clamp(12px,0.95vw,14px)] leading-relaxed text-fg2">{errorInfo.message}</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button onClick={() => { setErrorInfo(null); setPhase('searching'); cmd('retry'); }}
                className="rounded-full bg-acc px-5 py-2.5 text-[clamp(12px,0.95vw,14px)] font-semibold text-acc-ink hover:brightness-110">{t('retry')}</button>
              <button onClick={() => openDrawer('sources')}
                className="rounded-full bg-white/10 px-5 py-2.5 text-[clamp(12px,0.95vw,14px)] font-semibold hover:bg-white/20">{t('th_choose_source')}</button>
              <button onClick={() => cmd('close')}
                className="rounded-full bg-white/5 px-5 py-2.5 text-[clamp(12px,0.95vw,14px)] text-fg2 hover:bg-white/15 hover:text-fg">{t('th_close_player')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Transparent Video Click Surface */}
      {!miniOn ? (
        <div
          onClick={() => {
            if (controlsLocked) { wake(); showMiniToast(t('th_controls_locked_hint')); return; }
            if (drawer) setDrawer(null);
            else cmd('toggle');
          }}
          onDoubleClick={() => {
            if (controlsLocked) { wake(); showMiniToast(t('th_controls_locked_hint')); return; }
            cmd('fullscreen').then((fs) => { if (typeof fs === 'boolean') setIsFullscreen(fs); }).catch(() => {});
          }}
          className="absolute inset-0 z-10"
        />
      ) : null}

      {/* 3b. Subtle Pause Metadata Overlay */}
      {!miniOn && !focusMode && hasFirstFrame && props.pause && !drawer && !errorInfo && !waitingMidPlay && idle ? (
        <div className="pointer-events-none absolute inset-y-0 start-0 z-20 flex w-[min(420px,55vw)] flex-col justify-center bg-gradient-to-e from-black/75 via-black/35 to-transparent ps-10 pe-6">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-acc">{t('th_watching_now')}</div>
          {logoUrl ? <Img srcs={[logoUrl]} alt="" className="mb-3 max-h-16 max-w-[240px] object-contain object-start" />
            : <div dir="auto" className="mb-2 text-2xl font-bold text-fg">{displayTitle}</div>}
          {curChapterTitle ? <div className="text-xs text-fg2">{curChapterTitle}</div> : null}
        </div>
      ) : null}

      {/* 4. Floating Overlays & Toasts */}
      {!miniOn && waitingMidPlay ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="flex items-center gap-2.5 rounded-full bg-black/70 px-4 py-2 text-xs backdrop-blur-xl ring-1 ring-white/15">
            <span className="size-3.5 animate-spin rounded-full border-2 border-white/25 border-t-acc" />
            <span>{t('th_buffering')}</span>
          </div>
        </div>
      ) : null}
      {volBoostVal != null ? (
        <div className={`pointer-events-none fixed top-16 z-30 rounded-full bg-black/82 px-4 py-1.5 text-xs font-bold ring-1 shadow-xl backdrop-blur-xl fade-in ${
          playbackCfg.volumePopupPos === 'top-left'
            ? 'left-6'
            : playbackCfg.volumePopupPos === 'top-right'
              ? 'right-6'
              : 'start-1/2 -translate-x-1/2 rtl:translate-x-1/2'
        } ${volBoostVal > 100 ? 'text-acc ring-acc/50' : 'text-fg ring-white/25'}`}>
          🔊 {volBoostVal > 100 ? t('th_vol_boost', { v: volBoostVal }) : `${Math.round(volBoostVal)}%`}
        </div>
      ) : miniToast ? (
        <div className="pointer-events-none absolute start-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/80 px-4 py-1.5 text-xs font-semibold text-fg ring-1 ring-white/20 shadow-xl backdrop-blur-xl fade-in">
          {miniToast}
        </div>
      ) : null}
      {holdSpeed ? (
        <div className="pointer-events-none absolute start-1/2 top-14 z-20 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 font-mono text-[11px] font-bold text-acc ring-1 ring-acc/40 backdrop-blur-xl">2×</div>
      ) : null}
      {!miniOn && durWarning ? (
        <div className="pointer-events-auto absolute start-1/2 top-16 z-30 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-[#18120a]/92 px-3.5 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/45 shadow-xl backdrop-blur-xl fade-in">
          <span>
            {durWarning.reason === 'edition'
              ? t('th_mismatch_edition', { host: durWarning.hostEdition || '?', local: durWarning.localEdition || '?' })
              : t('th_mismatch_dur')}
          </span>
          {durWarning.reason === 'duration' && durWarning.diffSec ? (
            <span dir="ltr" className="rounded-full bg-amber-400/15 px-2 py-0.5 font-mono text-[10.5px] text-amber-100">
              {durWarning.hostDur ? `${fmtTime(durWarning.localDur || 0)} vs ${fmtTime(durWarning.hostDur)}` : `Δ ${fmtTime(durWarning.diffSec)}`}
            </span>
          ) : null}
          <button onClick={() => openDrawer('sources')} className="rounded-full bg-acc px-2.5 py-0.5 text-[10.5px] font-bold text-acc-ink hover:brightness-110">
            {t('th_mismatch_switch')}
          </button>
          <button onClick={() => setDurWarning(null)} aria-label={t('dismiss')} className="grid size-5 place-items-center rounded-full bg-white/10 text-amber-200 hover:bg-white/20">
            <X size={11} />
          </button>
        </div>
      ) : null}
      {!miniOn && failoverPrompt ? (
        <div className="pointer-events-auto absolute start-1/2 top-24 z-30 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-2xl bg-[#18120a]/95 px-4 py-2 text-xs font-semibold text-amber-100 ring-1 ring-acc/55 shadow-2xl backdrop-blur-xl fade-in">
          <span className="text-acc">{(failoverPrompt.reason === '0peers' || failoverPrompt.reason === 'zero-peers') ? t('failover_title_peers') : t('failover_title_stall')}</span>
          <span className="max-w-[220px] truncate text-fg2">
            {t('failover_next', { name: failoverPrompt.candidate.stream?.name || failoverPrompt.candidate.stream?.title || failoverPrompt.candidate.addon?.name || 'Source' })}
          </span>
          {failoverPrompt.autoSwitchSec > 0 ? (
            <span dir="ltr" className="rounded-full bg-acc/20 px-2 py-0.5 font-mono text-[11px] text-acc">
              {t('failover_auto_in', { s: failoverPrompt.autoSwitchSec })}
            </span>
          ) : null}
          <button
            onClick={() => {
              const cur = failoverPrompt;
              setFailoverPrompt(null);
              cmd('failover-switch', { candidate: cur.candidate, posMs: cur.posMs }).catch(() => {});
            }}
            className="rounded-full bg-acc px-3 py-1 text-[11px] font-bold text-acc-ink hover:brightness-110"
          >
            {t('failover_switch')}
          </button>
          <button
            onClick={() => { setFailoverPrompt(null); cmd('failover-dismiss').catch(() => {}); }}
            className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-fg2 hover:bg-white/20 hover:text-fg"
          >
            {t('failover_dismiss')}
          </button>
        </div>
      ) : null}
      {seekFlash ? (
        <div className="pointer-events-none absolute start-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/75 px-4 py-2 font-mono text-sm font-bold backdrop-blur-xl">{seekFlash}</div>
      ) : null}
      {saidText ? (
        <div className="pointer-events-none absolute inset-x-[14%] bottom-24 z-20 text-center">
          <span dir="auto" className="inline-block rounded-xl bg-black/80 px-4 py-2 text-lg font-semibold shadow-2xl backdrop-blur-xl">{saidText}</span>
        </div>
      ) : null}
      {!focusMode && floats.map((f) => (
        <div key={f.id} style={{ left: `${f.left}%` }} className="th-react-float pointer-events-none absolute bottom-20 z-20 text-3xl drop-shadow-lg">{f.emoji}</div>
      ))}

      {/* Smart Catch-Up 1.15x Pill */}
      {!miniOn && !focusMode && catchUp?.active ? (
        <div className="pointer-events-none absolute start-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-[#15120e]/92 px-3.5 py-1 font-mono text-xs font-bold text-acc ring-1 ring-acc/50 shadow-xl backdrop-blur-xl fade-in">
          ⚡ {t('party_catchup', { x: catchUp.speed.toFixed(2).replace(/\.?0+$/, '') })}
        </div>
      ) : null}

      {/* Cinematic 3-2-1 Countdown Overlay */}
      {!miniOn && countdownNum > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black/45 backdrop-blur-sm fade-in">
          <div className="grid size-32 place-items-center rounded-full bg-[#12100e]/90 font-mono text-6xl font-black text-acc ring-4 ring-acc/60 shadow-[0_0_50px_rgba(226,164,58,0.45)] animate-pulse">
            {countdownNum}
          </div>
        </div>
      ) : null}

      {/* Ready Check Banner */}
      {!miniOn && !focusMode && (readyState?.active || readyState?.prompt) ? (() => {
        const isHostRole = partyState?.role === 'host';
        const isMeReady = isHostRole ? !!readyState?.hostReady : myReadyLocal;
        return (
          <div data-testid="th-ready-banner" className="pointer-events-auto absolute start-1/2 top-20 z-[35] flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-2xl bg-[#0e0d0c]/94 px-4 py-2.5 text-xs ring-1 ring-acc/50 shadow-2xl backdrop-blur-xl fade-in">
            <span className="font-bold text-fg">{t('party_ready_prompt')}</span>
            {(readyState.peers || []).map((rp) => (
              <span key={rp.id} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${rp.ready ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40' : 'bg-white/10 text-fg3'}`}>
                {rp.name} {rp.ready ? '✓' : '…'}
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                const next = !isMeReady;
                if (!isHostRole) setMyReadyLocal(next);
                cmd('party-ready-ack', { on: next });
              }}
              className={`rounded-full px-3.5 py-1 text-[11px] font-bold transition ${
                isMeReady
                  ? 'bg-emerald-500 text-black ring-1 ring-emerald-300'
                  : 'bg-acc text-acc-ink hover:brightness-110'
              }`}
            >
              {isMeReady ? t('party_ready_toggle_on') : `${t('party_ready_yes')} ✓`}
            </button>
            {isHostRole ? (
              <button onClick={() => cmd('party-countdown', { ms: 3000 })} className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-fg hover:bg-white/25">
                3-2-1
              </button>
            ) : null}
          </div>
        );
      })() : null}

      {/* 4b. Persistent Watch Party Overlays (Who's Buffering, BRB Pause, Post-Credits 1–10 Rating) */}
      {!miniOn && partyState?.reason === 'buffering' && !brbState?.active && waitingNames ? (
        <div className="pointer-events-auto absolute start-1/2 top-20 z-30 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-2xl bg-[#0e0d0c]/92 px-4 py-2.5 text-xs ring-1 ring-amber-400/45 shadow-2xl backdrop-blur-xl fade-in">
          <span className="size-3.5 animate-spin rounded-full border-2 border-amber-300/30 border-t-acc" />
          <span className="font-semibold text-fg">{t('th_waiting_for', { names: waitingNames })}</span>
          {waitingPeers.filter((p) => (p.cacheSpeed || 0) > 0).map((p) => (
            <span key={p.id} dir="ltr" className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-fg2">
              {p.name || p.id}: {(p.cacheSpeed! / (1024 * 1024)).toFixed(1)} MB/s
            </span>
          ))}
          {waitLeftSec > 0 ? (
            <span dir="ltr" className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-200">{waitLeftSec}s</span>
          ) : null}
          {partyState.role === 'host' ? (
            <button onClick={handleResumeAnyway} className="rounded-full bg-acc px-3 py-1 text-[11px] font-bold text-acc-ink hover:brightness-110">
              {t('th_resume_anyway')}
            </button>
          ) : null}
        </div>
      ) : null}

      {!miniOn && brbState?.active ? (
        <div className="pointer-events-auto absolute start-1/2 top-20 z-30 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-2xl bg-[#0e0d0c]/94 px-4 py-2.5 text-xs ring-1 ring-acc/50 shadow-2xl backdrop-blur-xl fade-in">
          <span className="text-base leading-none">☕</span>
          <span className="font-bold text-fg">{t('th_brb_banner', { name: brbState.byName || 'Host', t: fmtClock(brbLeftSec) })}</span>
          <button onClick={handleBrbExtend} className="rounded-full bg-white/12 px-2.5 py-1 font-mono text-[11px] font-semibold text-fg hover:bg-white/20">
            {t('th_brb_plus2')}
          </button>
          <button onClick={() => handleBrb(0)} className="rounded-full bg-acc px-3 py-1 text-[11px] font-bold text-acc-ink hover:brightness-110">
            {t('th_brb_back')}
          </button>
        </div>
      ) : null}

      {!miniOn && ratingRound ? (
        <div className="pointer-events-auto absolute bottom-[clamp(96px,11vh,140px)] start-1/2 z-[35] w-[min(460px,92vw)] -translate-x-1/2 rounded-2xl bg-[#0e0d0c]/95 p-4 ring-1 ring-acc/40 shadow-2xl backdrop-blur-2xl fade-in">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-acc">{t('th_group_rating_title')}</div>
              <div dir="auto" className="truncate text-sm font-bold text-fg">{ratingRound.title || displayTitle}</div>
              {ratingRound.blind && !ratingRound.revealed ? (
                <div className="mt-0.5 text-[10.5px] text-fg3">{t('party_rating_blind')}</div>
              ) : null}
            </div>
            <button onClick={() => setRatingRound(null)} className="grid size-7 place-items-center rounded-full bg-white/10 text-fg2 hover:bg-white/20 hover:text-fg">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div dir="ltr" className="mb-3 grid grid-cols-10 gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} onClick={() => handleRate(n)}
                className={`rounded-lg py-1.5 font-mono text-xs font-bold transition ${myScore === n ? 'bg-acc text-acc-ink ring-2 ring-acc/60' : 'bg-white/8 text-fg hover:bg-white/20'}`}>
                {n}
              </button>
            ))}
          </div>
          {ratingVotes.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {ratingVotes.map((v) => (
                <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-white/8 px-2.5 py-0.5 text-fg">
                  <span className="size-1.5 rounded-full" style={{ background: v.accent || 'var(--c-acc)' }} />
                  <span>{v.name}:</span>
                  {ratingRound.blind && !ratingRound.revealed && v.score == null ? (
                    <span className="font-semibold text-emerald-300">✓ {t('party_rating_locked')}</span>
                  ) : (
                    <strong className="font-mono text-acc">{v.score}/10</strong>
                  )}
                </span>
              ))}
              {ratingRound.revealed && ratingRound.avg != null ? (
                <span className="ms-auto rounded-full bg-acc/20 px-2.5 py-0.5 font-bold text-acc">
                  {t('th_group_avg', { n: ratingRound.avg })}
                </span>
              ) : ratingRound.blind && !ratingRound.revealed ? (
                <button
                  onClick={() => api.invoke('social:rate', { action: 'reveal' }).then((r: any) => r?.round && setRatingRound(r.round)).catch(() => {})}
                  className="ms-auto rounded-full bg-acc px-2.5 py-0.5 text-[11px] font-bold text-acc-ink hover:brightness-110"
                >
                  {t('party_rating_reveal')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 5. Stats for Nerds ('Ctrl+Shift+D' or 'I') */}
      {statsOpen && !miniOn ? (
        <div dir="ltr" className="absolute start-4 top-16 z-30 w-66 rounded-xl bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-fg ring-1 ring-white/15 backdrop-blur-xl shadow-2xl">
          <div className="mb-1.5 flex items-center justify-between font-bold text-acc">
            <span>Majlis Stats for Nerds</span>
            <button onClick={() => setStatsOpen(false)}><X size={12} strokeWidth={2} /></button>
          </div>
          <div>Video: {vp?.w || '?'}×{vp?.h || '?'} {props['video-codec'] ? `· ${props['video-codec']}` : ''}</div>
          <div>Decode: {hwTag ? `HW (${hwTag})` : 'SW'} {vsr ? '· RTX VSR' : ''}</div>
          <div>FPS: {props['estimated-vf-fps'] ? props['estimated-vf-fps'].toFixed(2) : '—'} · Dropped: {props['frame-drop-count'] || 0}</div>
          <div>Audio: {props['audio-params']?.codec || '?'} · {props['audio-params']?.['channel-count'] || '?'}ch</div>
          <div>Bitrate: {props['video-bitrate'] ? `${Math.round(props['video-bitrate'] / 1000)} kbps` : '—'}</div>
          <div>Cache: {(props['demuxer-cache-duration'] || 0).toFixed(1)}s {props['cache-speed'] ? `· ${(props['cache-speed'] / (1024 * 1024)).toFixed(2)} MB/s` : ''}</div>
          <div>A/V Sync: {typeof props.avsync === 'number' ? `${Math.round(props.avsync * 1000)} ms` : '0 ms'}</div>
        </div>
      ) : null}

      {/* 6. Proportional Decluttered Top Glass Bar */}
      {!miniOn && !focusMode ? (
        <header
          onMouseDown={startWinDrag}
          onDoubleClick={(e) => { if (e.target === e.currentTarget && !isFullscreen) api.invoke('win:maximize').catch(() => {}); }}
          className={`shade-t absolute inset-x-0 top-0 z-20 flex items-center gap-[clamp(10px,1vw,18px)] px-[clamp(18px,2.2vw,36px)] pb-[clamp(24px,3vh,44px)] pt-[clamp(14px,1.8vh,28px)] transition-opacity duration-300 ${idle && !drawer ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <button onClick={() => cmd('close')} data-tip={t('th_close_player')} className="app-no-drag grid size-[clamp(36px,2.7vw,46px)] flex-none place-items-center rounded-full bg-black/50 text-[#f5efe6] ring-1 ring-white/20 backdrop-blur-xl hover:bg-white/20 hover:text-acc">
            <X size={19} strokeWidth={2} />
          </button>
          <div className="min-w-0">
            {apCfg.useTitleArtworkPlayer && logoUrl ? (
              <div className="flex items-center gap-2.5">
                <Img srcs={[logoUrl]} alt={displayTitle} className="max-h-[clamp(28px,3.2vh,44px)] max-w-[clamp(120px,16vw,220px)] object-contain drop-shadow" />
                <span dir="auto" className="truncate font-semibold text-fg2" style={{ fontSize: `calc(clamp(13px,1vw,16px) * ${(apCfg.playerTitleSizePct || 100) / 100})` }}>{displayTitle}</span>
              </div>
            ) : (
              <div dir="auto" className="truncate font-bold leading-snug drop-shadow" style={{ fontSize: `calc(clamp(15px,1.3vw,22px) * ${(apCfg.playerTitleSizePct || 100) / 100})` }}>{displayTitle}</div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[clamp(11px,0.85vw,13px)] text-fg2">
              {resTag ? <span dir="ltr" className="rounded bg-white/15 px-1.5 py-0.5 font-mono font-semibold">{resTag}</span> : null}
              {html5State.active ? <span dir="ltr" className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono font-semibold text-emerald-300 ring-1 ring-emerald-400/35">HLSv2</span> : null}
              {hwTag ? <span dir="ltr" className="rounded bg-white/15 px-1.5 py-0.5 font-mono">{hwTag}</span> : null}
              {vsr ? <span className="rounded bg-acc/20 px-1.5 py-0.5 font-mono font-semibold text-acc">RTX VSR</span> : null}
              {incognito ? <span className="inline-flex items-center gap-1 rounded bg-purple-500/25 px-1.5 py-0.5 text-[11px] font-bold text-purple-200 ring-1 ring-purple-400/40"><EyeOff size={11} />{t('th_incognito_badge')}</span> : null}
              {multiEp?.isMulti ? <span className="rounded bg-acc/20 px-1.5 py-0.5 text-[11px] font-bold text-acc">{multiEp.rangeLabel} · {t('th_multi_ep')}</span> : null}
              {curChapterTitle ? <span className="truncate text-fg3">· {curChapterTitle}</span> : null}
              {statusMsg && hasFirstFrame ? <span className="text-acc">{statusMsg}</span> : null}
            </div>
          </div>
          <span className="flex-1" />
          {isFullscreen && pl.fullscreenClock ? (
            <span dir="ltr" data-testid="th-fs-clock" className="rounded-full bg-black/50 px-3 py-1 font-mono text-[clamp(11.5px,0.88vw,13.5px)] font-semibold text-fg ring-1 ring-white/15 backdrop-blur-xl">
              {fmtLocaleTime(nowMs, lang, { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          {!compactW && partyState?.peers?.length ? (
            <div className="app-no-drag flex flex-wrap items-center gap-1.5">
              {(partyState.peers || []).map((p) => (
                <span key={p.id} dir="ltr" className={`flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[clamp(11px,0.85vw,13px)] ring-1 backdrop-blur-xl ${p.stalled ? 'ring-red-400/50 text-red-200' : 'ring-white/15 text-fg'}`}>
                  <span className={`size-2 rounded-full ${p.stalled ? 'bg-red-400' : (p.cache || 0) < 3 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  {p.name || p.id} · {p.stalled ? '⏳' : `${Math.round(p.cache || 0)}s`}
                </span>
              ))}
            </div>
          ) : null}
          {(partyInfo.canStart || (partyInfo.on && partyInfo.role === 'host')) ? (
            <button onClick={async () => { if (partyInfo.on && partyInfo.role === 'host') await api.invoke('party:end'); else if (!partyInfo.on) await api.invoke('party:start'); refreshPartyButton(); }}
              className={`app-no-drag flex items-center gap-1.5 rounded-full px-[clamp(12px,1vw,18px)] py-[clamp(7px,0.65vh,11px)] text-[clamp(12px,0.9vw,15px)] font-semibold backdrop-blur-xl ring-1 ${partyInfo.on ? 'bg-acc text-acc-ink ring-acc' : 'bg-black/50 text-[#f5efe6] ring-white/20 hover:bg-white/20'}`}>
              <Users size={16} strokeWidth={2} />{compactW ? '' : t(partyInfo.on ? 'th_end_together' : 'th_together')}
            </button>
          ) : null}
          {partyState || partyInfo.on ? (
            <button onClick={() => handleBrb(brbState?.active ? 0 : 120)} data-tip={t('th_brb_btn')}
              className={`app-no-drag flex items-center gap-1.5 rounded-full px-[clamp(10px,0.9vw,16px)] py-[clamp(7px,0.65vh,11px)] text-[clamp(12px,0.88vw,14px)] font-semibold backdrop-blur-xl ring-1 ${brbState?.active ? 'bg-acc text-acc-ink ring-acc' : 'bg-black/50 text-[#f5efe6] ring-white/20 hover:bg-white/20'}`}>
              <Coffee size={15} strokeWidth={2} />{compactW ? '' : t('th_brb_btn')}
            </button>
          ) : null}
          {(partyState || partyInfo.on || (voiceState.talkers?.length || 0) > 0) && voiceState.mode !== 'off' ? (
            <button
              onMouseDown={() => voiceState.mode === 'ptt' && handleVoicePtt(true)}
              onMouseUp={() => voiceState.mode === 'ptt' && handleVoicePtt(false)}
              onMouseLeave={() => voiceState.mode === 'ptt' && handleVoicePtt(false)}
              onTouchStart={() => voiceState.mode === 'ptt' && handleVoicePtt(true)}
              onTouchEnd={() => voiceState.mode === 'ptt' && handleVoicePtt(false)}
              onClick={() => voiceState.mode === 'open' && handleVoiceMode('off')}
              data-tip={voiceState.mode === 'ptt' ? t('th_voice_ptt', { k: voiceState.pttKey || 'CapsLock' }) : t('th_voice_open')}
              className={`app-no-drag flex items-center gap-1.5 rounded-full px-[clamp(10px,0.9vw,15px)] py-[clamp(7px,0.65vh,11px)] text-[clamp(11.5px,0.85vw,13.5px)] font-semibold backdrop-blur-xl ring-1 ${voiceState.micOpen || (voiceState.talkers?.length || 0) > 0 ? 'bg-emerald-500/90 text-black ring-emerald-300' : 'bg-black/50 text-fg ring-white/20 hover:bg-white/20'}`}>
              {voiceState.micOpen ? <Mic size={15} strokeWidth={2} /> : <MicOff size={15} strokeWidth={2} />}
              {voiceState.talkers?.length ? voiceState.talkers.map((x) => x.name).join(', ')
                : voiceState.micOpen ? t('th_talking')
                : (compactW ? '' : (voiceState.mode === 'ptt' ? (voiceState.pttKey || 'PTT') : t('th_voice_open')))}
            </button>
          ) : null}
          {partyState || partyInfo.on ? (
            <button onClick={() => openDrawer('party')} data-tip={t('party_chat')} className={`app-no-drag grid size-[clamp(36px,2.7vw,46px)] flex-none place-items-center rounded-full backdrop-blur-xl ring-1 ${drawer === 'party' ? 'bg-acc text-acc-ink ring-acc' : 'bg-black/50 text-[#f5efe6] ring-white/20 hover:bg-white/20 hover:text-acc'}`}>
              <MessageSquare size={17} strokeWidth={2} />
            </button>
          ) : null}
          {winControlsEl}
        </header>
      ) : null}

      {/* 7. Skip Intro Pill + Final 20s Next Episode Countdown Card (clear of footer gradient) */}
      {!miniOn && !focusMode ? (
        <div className="pointer-events-none absolute bottom-[clamp(112px,12vh,148px)] end-[clamp(18px,2vw,32px)] z-[25] flex flex-col items-end gap-2.5">
          {showNextCountdown ? (
            <div className="pointer-events-auto w-[min(320px,84vw)] overflow-hidden rounded-2xl bg-[#0e0d0c]/95 p-3 ring-1 ring-white/20 shadow-2xl backdrop-blur-2xl fade-in">
              <div className="flex items-center gap-3">
                {nextMeta.thumb ? <Img srcs={[nextMeta.thumb]} className="h-14 w-24 flex-none rounded-lg bg-black/50 object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-acc">{t('th_up_next_in', { n: nextLeftSec })}</div>
                  <div dir="auto" className="truncate text-xs font-semibold text-fg">{nextMeta.title || t('th_next_ep')}</div>
                </div>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => api.invoke('player:next')} className="flex-1 rounded-full bg-acc py-1.5 text-xs font-bold text-acc-ink hover:brightness-110">
                  {t('th_play_now')}
                </button>
                <button onClick={() => { setNextCancelled(true); cmd('cancel-next-ep', { on: true }).catch(() => {}); }}
                  className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-fg2 hover:bg-white/20 hover:text-fg">
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : null}
          {postCredits && (postCredits.after || postCredits.during) && (activeSkip?.kind === 'ed' || (dur > 180 && dur - pos <= 240)) ? (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#161310]/95 px-3.5 py-1.5 text-xs font-semibold text-acc ring-1 ring-acc/50 shadow-xl backdrop-blur-xl">
              <span>★ {t('th_post_credits_alert')}</span>
              {postCredits.resumeAt && postCredits.resumeAt > pos + 2 ? (
                <button onClick={() => cmd('seek', { to: postCredits.resumeAt, abs: true })}
                  className="rounded-full bg-acc px-2.5 py-0.5 text-[11px] font-bold text-acc-ink hover:brightness-110">
                  {t('th_post_credits_jump')}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2.5">
            {activeSkip != null && playbackCfg.showSkipButton && !skipHidden ? (
              <button
                data-testid="th-skip-btn"
                onClick={() => {
                  cmd('seek', { to: activeSkip.to, abs: true });
                  setSkipHidden(true);
                  showMiniToast(t('th_skip_done', { s: t(activeSkip.labelKey) }));
                }}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/95 px-[clamp(14px,1.1vw,20px)] py-[clamp(8px,0.75vh,12px)] text-[clamp(13px,0.95vw,16px)] font-bold text-black shadow-xl transition hover:scale-105 hover:bg-acc hover:text-acc-ink"
              >
                <span>{t(activeSkip.labelKey)}</span>
                <kbd dir="ltr" className="rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-black/75">Enter</kbd>
              </button>
            ) : null}
            {showNextEpPill ? (
              <button onClick={() => api.invoke('player:next')}
                className="pointer-events-auto rounded-full bg-acc px-[clamp(14px,1.1vw,20px)] py-[clamp(8px,0.75vh,12px)] text-[clamp(13px,0.95vw,16px)] font-bold text-acc-ink shadow-xl transition hover:brightness-110">
                {t('th_next_ep')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 8. Control Lock Pill OR Proportional Bottom Control Dock */}
      {!miniOn && !focusMode && controlsLocked ? (
        <div className={`fixed bottom-6 start-1/2 z-40 -translate-x-1/2 transition-opacity duration-200 ${idle ? 'opacity-30' : 'opacity-100'}`}>
          <button
            data-testid="th-unlock-btn"
            onClick={() => setControlsLocked(false)}
            className="inline-flex items-center gap-2 rounded-full bg-black/82 px-4 py-2 text-xs font-bold text-acc ring-1 ring-acc/50 shadow-2xl backdrop-blur-xl hover:bg-acc hover:text-acc-ink"
          >
            <Lock size={14} strokeWidth={2} />
            <span>{t('th_unlock_controls')}</span>
          </button>
        </div>
      ) : !miniOn && !focusMode ? (() => {
        const hudScale = pl.hudScale || 'default';
        const visibleSet = new Set(pl.visibleControls?.length ? pl.visibleControls : ['play', 'time', 'volume', 'subtitles', 'audio', 'more', 'pip', 'fullscreen']);
        const hasCtrl = (id: string) => visibleSet.has(id);
        const dockPad = hudScale === 'compact'
          ? 'px-[clamp(14px,1.8vw,28px)] pb-[clamp(10px,1.4vh,20px)] pt-[clamp(24px,3.2vh,40px)]'
          : hudScale === 'spacious'
            ? 'px-[clamp(22px,2.8vw,46px)] pb-[clamp(20px,2.8vh,38px)] pt-[clamp(42px,5.8vh,72px)]'
            : 'px-[clamp(18px,2.4vw,40px)] pb-[clamp(16px,2.2vh,32px)] pt-[clamp(36px,5vh,64px)]';
        const rowGap = hudScale === 'compact' ? 'gap-[clamp(2px,0.3vw,5px)]' : hudScale === 'spacious' ? 'gap-[clamp(5px,0.65vw,11px)]' : 'gap-[clamp(3px,0.45vw,8px)]';
        const seekBaseH = Math.max(2, Math.min(12, pl.seekStyle === 'pinstripe' ? Math.min(4, pl.seekHeightPx || 2) : (pl.seekHeightPx || 4)));
        const seekColor = pl.seekColor || '#E5A93C';
        const dotSize = Math.max(8, Math.min(22, pl.seekDotSizePx || 14));
        const dotCls = pl.seekDotShape === 'square' ? 'rounded-[3px]' : pl.seekDotShape === 'custom' ? 'rounded-[3px] rotate-45' : 'rounded-full';
        const backSec = ctrlCfg.seekBackSec || 10;
        const fwdSec = ctrlCfg.seekFwdSec || 10;
        const timeText = pl.timeFormat === 'elapsed-only'
          ? fmtTime(pos)
          : pl.timeFormat === 'elapsed-remaining' && dur > 0
            ? `${fmtTime(pos)} / -${fmtTime(Math.max(0, dur - pos))}`
            : `${showRemaining && dur > 0 ? `-${fmtTime(Math.max(0, dur - pos))}` : fmtTime(pos)} / ${fmtTime(dur)}`;
        return (
          <footer
            data-hud-scale={hudScale}
            className={`shade-b pointer-events-none absolute inset-x-0 bottom-0 z-[35] transition-opacity duration-300 ${dockPad} ${idle && !drawer ? 'opacity-0' : 'opacity-100'}`}
          >
            <div ref={seekRef} onMouseMove={onSeekMove} onMouseLeave={() => { setHoverSec(null); setHoverThumb(null); }}
              onClick={(e) => dur && cmd('seek', { to: seekAt(e.clientX), abs: true })}
              data-testid="th-seek-bar"
              className={`group/seek relative mb-[clamp(8px,1vh,14px)] flex h-[clamp(22px,2vh,30px)] cursor-pointer items-center ${idle && !drawer ? 'pointer-events-none' : 'pointer-events-auto'}`}>
              <div
                className="relative w-full overflow-hidden rounded-full bg-white/25 transition-all"
                style={{ height: `${seekBaseH}px` }}
              >
                {pl.bufferFill !== false ? (
                  <div className="absolute inset-y-0 start-0 bg-white" style={{ width: `${cacheEnd}%`, opacity: (pl.bufferBrightnessPct ?? 35) / 100 }} />
                ) : null}
                {dur > 0 && skips.map((s, idx) => {
                  const startPct = Math.max(0, Math.min(100, (s.start / dur) * 100));
                  const endPct = Math.max(startPct, Math.min(100, (s.end / dur) * 100));
                  const cls = s.kind === 'recap' ? 'bg-sky-400/60' : s.kind === 'ed' ? 'bg-purple-400/60' : 'bg-amber-300/75';
                  return <span key={`seg-${idx}`} className={`pointer-events-none absolute inset-y-0 ${cls}`} style={{ insetInlineStart: `${startPct}%`, width: `${Math.max(0.4, endPct - startPct)}%` }} />;
                })}
                <div className="absolute inset-y-0 start-0" style={{ width: `${pct}%`, background: seekColor }} />
                {chapters.map((c, idx) => dur ? (
                  <span key={`ch-${idx}`} className="absolute inset-y-0 w-[2px] bg-black/75" style={{ insetInlineStart: `${(c.time / dur) * 100}%` }} />
                ) : null)}
                {dur > 0 && postCredits?.resumeAt ? (
                  <span className="pointer-events-none absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-emerald-400 ring-1 ring-black/80" style={{ insetInlineStart: `${Math.min(99.5, (postCredits.resumeAt / dur) * 100)}%` }} />
                ) : null}
              </div>
              {bookmarks.map((bm) => dur ? (
                <button
                  key={bm.id}
                  onClick={(e) => { e.stopPropagation(); cmd('seek', { to: bm.t, abs: true }); }}
                  data-tip={`${bm.label || t('th_bookmarks')} · ${fmtTime(bm.t)}`}
                  style={{ insetInlineStart: `${Math.max(0.5, Math.min(99.5, (bm.t / dur) * 100))}%` }}
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rotate-45 bg-acc ring-2 ring-black/70 transition hover:scale-150"
                />
              ) : null)}
              {partyNotes.map((pn) => dur ? (
                <button
                  key={pn.id}
                  onClick={(e) => { e.stopPropagation(); cmd('seek', { to: pn.t, abs: true }); }}
                  data-tip={`${pn.authorName}: ${pn.text} · ${fmtTime(pn.t)}`}
                  style={{ insetInlineStart: `${Math.max(0.5, Math.min(99.5, (pn.t / dur) * 100))}%`, background: pn.accent || '#38bdf8' }}
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black/75 transition hover:scale-150"
                />
              ) : null)}
              <div
                data-testid="th-seek-dot"
                className={`pointer-events-none absolute -translate-x-1/2 rtl:translate-x-1/2 shadow ring-4 ring-white/20 transition ${dotCls} ${pl.revealDotHover !== false ? 'opacity-0 group-hover/seek:opacity-100' : 'opacity-100'}`}
                style={{ insetInlineStart: `${pct}%`, width: `${dotSize}px`, height: `${dotSize}px`, background: seekColor }}
              />
              {hoverSec != null ? (() => {
                const skHit = skips.find((s) => hoverSec >= s.start && hoverSec <= s.end);
                let chHit = '';
                for (let i = chapters.length - 1; i >= 0; i--) {
                  if (hoverSec >= (chapters[i]?.time || 0)) { chHit = chapters[i]?.title || ''; break; }
                }
                const segLabel = skHit
                  ? t(skHit.kind === 'recap' ? 'th_seg_recap' : skHit.kind === 'ed' ? 'th_seg_credits' : 'th_seg_intro')
                  : chHit;
                return (
                  <div style={{ left: hoverX }} className="pointer-events-none absolute bottom-8 -translate-x-1/2 overflow-hidden rounded-xl bg-black/92 p-1.5 text-center ring-1 ring-white/20 shadow-2xl">
                    {pl.hoverThumbPreview !== false && hoverThumb ? <img src={hoverThumb} alt="" className="mb-1.5 h-24 w-44 rounded-lg object-cover" /> : null}
                    <div dir="ltr" className="font-mono text-[clamp(12px,0.9vw,14px)] font-semibold text-fg">{fmtTime(hoverSec)}</div>
                    {segLabel ? <div dir="auto" className="mt-0.5 max-w-[176px] truncate text-[10.5px] font-medium text-acc">{segLabel}</div> : null}
                  </div>
                );
              })() : null}
            </div>

            <div data-testid="th-dock-row" className={`flex flex-nowrap items-center ${rowGap} ${idle && !drawer ? 'pointer-events-none' : 'pointer-events-auto'}`}>
              {hasCtrl('play') ? (
                <DockBtn
                  icon={props.pause ? <Play size={20} strokeWidth={2} className="fill-current" /> : <Pause size={20} strokeWidth={2} className="fill-current" />}
                  onClick={() => cmd('toggle')}
                  label={t(props.pause ? 'play' : 'pause')}
                  scale={hudScale}
                  big
                />
              ) : null}
              {hasCtrl('seek') ? (
                <>
                  <DockBtn icon={<RotateCcw size={18} strokeWidth={2} />} onClick={() => { flashSeek(`−${backSec}s`); cmd('seek', { to: -backSec }); }} label={t('th_seek_back')} scale={hudScale} />
                  <DockBtn icon={<RotateCw size={18} strokeWidth={2} />} onClick={() => { flashSeek(`+${fwdSec}s`); cmd('seek', { to: fwdSec }); }} label={t('th_seek_fwd')} scale={hudScale} />
                </>
              ) : null}
              {hasCtrl('time') ? (
                <button onClick={() => setShowRemaining((r) => !r)} dir="ltr" className="ms-1.5 flex-none whitespace-nowrap font-mono text-[clamp(12px,0.92vw,15px)] font-medium text-fg2 hover:text-fg">
                  {timeText}{!compactW && endsAt ? ` · ${t('th_ends_at', { t: endsAt })}` : ''}
                </button>
              ) : null}
              <span className="min-w-2 flex-1" />
              {hasCtrl('volume') ? (
                <TheaterVolumeControl
                  mode={pl.volumeControl || 'slider'}
                  value={volUi}
                  maxVol={maxVol}
                  muted={!!props.mute}
                  compact={compactW}
                  popOpen={volMenuOpen}
                  onTogglePop={() => setVolMenuOpen((v) => !v)}
                  onToggleMute={toggleMute}
                  onChange={(v, isDrag) => {
                    draggingVolRef.current = !!isDrag;
                    setVolume(v, !isDrag);
                  }}
                  onDragEnd={() => { draggingVolRef.current = false; }}
                  scale={hudScale}
                  label={t(props.mute ? 'th_unmute' : 'th_mute')}
                  volTip={t('th_volume', { v: Math.round(volUi) })}
                />
              ) : null}
              {!compactW && hasCtrl('said') ? (
                <DockBtn icon={<MessageSquareQuote size={18} strokeWidth={2} />} onClick={triggerWhatSaid} label={t('th_said')} scale={hudScale} />
              ) : null}
              {chapters.length && hasCtrl('chapters') ? <DockBtn icon={<ListVideo size={18} strokeWidth={2} />} active={drawer === 'chapters'} onClick={() => openDrawer('chapters')} label={t('th_chapters')} scale={hudScale} /> : null}
              {card.type === 'series' && hasCtrl('episodes') ? <DockBtn icon={<Tv size={18} strokeWidth={2} />} active={drawer === 'episodes'} onClick={() => openDrawer('episodes')} label={t('th_episodes')} scale={hudScale} /> : null}
              {hasCtrl('sources') ? <DockBtn icon={<Layers size={18} strokeWidth={2} />} active={drawer === 'sources'} onClick={() => openDrawer('sources')} label={t('th_sources')} scale={hudScale} /> : null}
              {hasCtrl('subtitles') ? <DockBtn icon={<Subtitles size={18} strokeWidth={2} />} active={drawer === 'subs'} onClick={() => openDrawer('subs')} label={t('th_subs')} scale={hudScale} /> : null}
              {hasCtrl('audio') ? <DockBtn icon={<AudioLines size={18} strokeWidth={2} />} active={drawer === 'audio'} onClick={() => openDrawer('audio')} label={t('th_audio')} scale={hudScale} /> : null}
              {hasCtrl('speed') ? <DockBtn icon={<Gauge size={18} strokeWidth={2} />} active={drawer === 'speed'} onClick={() => openDrawer('speed')} label={t('th_speed_sleep')} scale={hudScale} /> : null}
              {hasCtrl('video') ? <DockBtn icon={<SlidersHorizontal size={18} strokeWidth={2} />} active={drawer === 'video'} onClick={() => openDrawer('video')} label={t('th_video_color')} scale={hudScale} /> : null}
              {hasCtrl('tools') ? <DockBtn icon={<Camera size={18} strokeWidth={2} />} active={drawer === 'tools'} onClick={() => openDrawer('tools')} label={t('th_tools')} scale={hudScale} /> : null}
              {hasCtrl('more') ? <DockBtn icon={<MoreHorizontal size={18} strokeWidth={2} />} active={drawer === 'more'} onClick={() => openDrawer('more')} label={t('th_more_tools')} scale={hudScale} /> : null}
              {pl.showControlLock !== false && hasCtrl('lock') ? <DockBtn icon={<Unlock size={18} strokeWidth={2} />} onClick={() => setControlsLocked(true)} label={t('th_control_lock')} scale={hudScale} /> : null}
              {hasCtrl('pip') ? <DockBtn icon={<PictureInPicture2 size={18} strokeWidth={2} />} onClick={() => api.invoke('mini').catch(() => {})} label={t('th_pip')} scale={hudScale} /> : null}
              {hasCtrl('fullscreen') ? (
                <DockBtn
                  icon={isFullscreen ? <Minimize size={18} strokeWidth={2} /> : <Maximize size={18} strokeWidth={2} />}
                  onClick={() => cmd('fullscreen').then((fs) => { if (typeof fs === 'boolean') setIsFullscreen(fs); }).catch(() => {})}
                  label={t(isFullscreen ? 'th_exit_fullscreen' : 'th_fullscreen')}
                  scale={hudScale}
                />
              ) : null}
            </div>
          </footer>
        );
      })() : null}

      {tip && tip.text && !miniOn ? <TheaterTip text={tip.text} r={tip.r} /> : null}

      {/* 9. Harbor-Style Compact Floating Popovers (<= 50vh, anchored above dock) */}
      <TheaterPopovers
        drawer={drawer}
        lang={lang}
        t={t}
        props={props}
        addonSubs={addonSubs}
        loadedSubMap={loadedSubMap}
        subColor={subColor}
        onColor={setSubColor}
        subFont={subFont}
        onSubFont={setSubFont}
        subBold={subBold}
        onSubBold={setSubBold}
        subOutline={subOutline}
        onSubOutline={setSubOutline}
        subBgAlpha={subBgAlpha}
        onSubBgAlpha={setSubBgAlpha}
        subFpsMode={subFpsMode}
        sdhFilter={sdhFilter}
        hwAccel={hwAccel}
        autoDuck={autoDuck}
        spdif={spdif}
        vsr={vsr}
        night={night}
        aspect={aspect}
        tone={tone}
        ambientGlow={ambientGlow}
        voiceClarity={voiceClarity}
        displayProfile={displayProfile}
        detectedDisplayProfile={detectedDisplayProfile}
        warmTint={warmTint}
        dimmerPct={dimmerPct}
        secondaryDisplays={secondaryDisplays}
        displays={displays}
        compareActive={compareActive}
        onCompareToggle={() => { setCompareActive((v) => !v); setDrawer(null); }}
        shotWithSubs={shotWithSubs}
        onShotWithSubs={setShotWithSubs}
        loopA={loopA}
        loopB={loopB}
        sleepSetting={sleepSetting}
        onSleep={applySleep}
        bookmarks={bookmarks}
        sources={sources}
        episodes={episodes}
        chatMsgs={chatMsgs}
        partyVotes={partyVotes}
        partyState={partyState}
        partyNotes={partyNotes}
        partyQueue={partyQueue}
        readyState={readyState}
        voiceState={voiceState}
        onResumeAnyway={handleResumeAnyway}
        onBrb={handleBrb}
        onVoiceMode={handleVoiceMode}
        onVoicePtt={handleVoicePtt}
        onClose={() => { setDrawer(null); setDrawerFromMore(false); }}
        onCmd={handlePopoverCmd}
        onNight={async () => { const r = await cmd('night'); setNight(!!r); }}
        onPickSource={(r) => { setDrawer(null); setDrawerFromMore(false); setErrorInfo(null); setHasFirstFrame(false); setPhase('opening'); cmd('switch-source', { stream: r.stream, addon: r.addon.url }); }}
        onPickEpisode={(id) => { setDrawer(null); setDrawerFromMore(false); setHasFirstFrame(false); setPhase('opening'); cmd('play-episode', { videoId: id }); }}
        onPickEpStream={(videoId, r) => { setDrawer(null); setDrawerFromMore(false); setErrorInfo(null); setHasFirstFrame(false); setPhase('opening'); cmd('play-episode-stream', { videoId, stream: r.stream, addon: r.addon.url }); }}
        onSyncAction={(ok) => !ok && showMiniToast(t('error_load'))}
        onSwitchDrawer={(d) => openDrawer(d, drawer === 'more')}
        drawerBack={drawerFromMore ? 'more' : null}
        onBackDrawer={() => openDrawer('more', false)}
        statsOpen={statsOpen}
        onToggleStats={() => setStatsOpen((s) => !s)}
        onToggleFocus={() => { setFocusMode(true); setDrawer(null); setIdle(true); showMiniToast(t('th_focus_hint')); }}
        onWhatSaid={triggerWhatSaid}
        controlsLocked={controlsLocked}
        onToggleLock={() => setControlsLocked((l) => !l)}
        showControlLock={pl.showControlLock !== false}
        isSeries={card.type === 'series'}
        hasChapters={chapters.length > 0}
      />
    </div>
  );
}

// Majlis dark/gold tooltip replacing the native OS `title` box; fixed + clamped so the dock's overflow never clips it.
function TheaterTip({ text, r }: { text: string; r: DOMRect }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const above = r.top - h - 10 >= 8;
    el.style.left = `${left}px`;
    el.style.top = `${above ? r.top - h - 10 : Math.min(window.innerHeight - h - 8, r.bottom + 10)}px`;
    el.style.opacity = '1';
  }, [text, r]);
  return (
    <div ref={ref} dir="auto" style={{ position: 'fixed', left: 0, top: 0, opacity: 0, maxWidth: 'min(320px, calc(100vw - 16px))' }}
      className="pointer-events-none z-[60] rounded-lg bg-[#12100e]/95 px-2.5 py-1.5 text-[clamp(11px,0.85vw,13px)] font-semibold text-[#f4efe6] shadow-xl ring-1 ring-acc/45 backdrop-blur-xl transition-opacity duration-150">
      {text}
    </div>
  );
}

function TheaterVolumeControl({
  mode, value, maxVol, muted, compact, popOpen, onTogglePop, onToggleMute, onChange, onDragEnd, scale, label, volTip,
}: {
  mode: 'slider' | 'vertical' | 'stepper' | 'icon';
  value: number;
  maxVol: number;
  muted: boolean;
  compact: boolean;
  popOpen: boolean;
  onTogglePop: () => void;
  onToggleMute: () => void;
  onChange: (v: number, dragging?: boolean) => void;
  onDragEnd: () => void;
  scale: 'compact' | 'default' | 'spacious';
  label: string;
  volTip: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const shownVal = muted ? 0 : Math.max(0, Math.min(maxVol, Math.round(value)));
  const iconEl = muted || shownVal <= 0 ? <VolumeX size={18} strokeWidth={2} /> : shownVal < 50 ? <Volume1 size={18} strokeWidth={2} /> : <Volume2 size={18} strokeWidth={2} />;
  const capPct = (val: number) => Math.max(0, Math.min(100, (val / Math.max(100, maxVol)) * 100));
  const normalEnd = Math.min(shownVal, 100);
  const boostAmt = Math.max(0, shownVal - 100);
  const unityMark = maxVol > 100 ? (100 / maxVol) * 100 : null;

  const pickX = (clientX: number, dragging: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(Math.round(f * maxVol), dragging);
  };

  const onTrackWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    onChange(shownVal + (e.deltaY < 0 ? 5 : -5), false);
  };

  if (mode === 'icon' || compact) {
    return (
      <div className="flex flex-none items-center gap-1" onWheel={onTrackWheel}>
        <DockBtn icon={iconEl} onClick={onToggleMute} label={`${label} · ${volTip}`} scale={scale} />
      </div>
    );
  }

  if (mode === 'stepper') {
    return (
      <div dir="ltr" className="flex flex-none items-center gap-1 rounded-full bg-white/8 px-1.5 py-0.5 ring-1 ring-white/10" onWheel={onTrackWheel}>
        <button onClick={onToggleMute} data-tip={label} aria-label={label} className="grid size-7 place-items-center rounded-full text-fg2 hover:bg-white/12 hover:text-acc">{iconEl}</button>
        <button onClick={() => onChange(shownVal - 5, false)} aria-label="Volume down" className="grid size-6 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/20 hover:text-fg"><Minus size={12} /></button>
        <span data-testid="th-volume-pct" className={`min-w-[36px] text-center font-mono text-[11px] font-bold ${shownVal > 100 ? 'text-amber-300' : 'text-fg2'}`}>{shownVal}%</span>
        <button onClick={() => onChange(shownVal + 5, false)} aria-label="Volume up" className="grid size-6 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/20 hover:text-fg"><Plus size={12} /></button>
      </div>
    );
  }

  if (mode === 'vertical') {
    return (
      <div className="relative flex flex-none items-center" onWheel={onTrackWheel}>
        <DockBtn icon={iconEl} onClick={onTogglePop} onContextMenu={(e) => { e.preventDefault(); onToggleMute(); }} label={volTip} active={popOpen} scale={scale} />
        {popOpen ? (
          <div dir="ltr" className="absolute bottom-14 start-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 rounded-2xl bg-[#0d0c0b]/95 px-3 py-3 ring-1 ring-white/15 shadow-2xl backdrop-blur-xl">
            <span data-testid="th-volume-pct" className={`font-mono text-[11px] font-bold ${shownVal > 100 ? 'text-amber-300' : 'text-fg'}`}>{shownVal}%</span>
            <input
              type="range"
              aria-label={volTip}
              min={0}
              max={maxVol}
              value={shownVal}
              onChange={(e) => onChange(+e.target.value, false)}
              className="h-24 w-2 cursor-pointer accent-acc [writing-mode:vertical-lr] rotate-180"
            />
            <button onClick={onToggleMute} className="rounded-full bg-white/10 p-1.5 text-fg2 hover:bg-white/20 hover:text-fg">{iconEl}</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div dir="ltr" data-testid="th-volume-control" className="flex flex-none items-center gap-1.5" onWheel={onTrackWheel}>
      <DockBtn icon={iconEl} onClick={onToggleMute} label={label} scale={scale} />
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={volTip}
        aria-valuemin={0}
        aria-valuemax={maxVol}
        aria-valuenow={shownVal}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pickX(e.clientX, true);
        }}
        onPointerMove={(e) => { if (e.buttons === 1 || e.currentTarget.hasPointerCapture(e.pointerId)) pickX(e.clientX, true); }}
        onPointerUp={(e) => { pickX(e.clientX, false); onDragEnd(); }}
        onPointerCancel={() => onDragEnd()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); onChange(shownVal + 5, false); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onChange(shownVal - 5, false); }
        }}
        className="group/vol relative flex h-6 w-[clamp(76px,6.4vw,116px)] cursor-pointer select-none items-center"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/vol:h-2">
          <div className="absolute inset-y-0 left-0 bg-acc" style={{ width: `${capPct(normalEnd)}%` }} />
          {boostAmt > 0 ? (
            <div className="absolute inset-y-0 bg-amber-400" style={{ left: `${capPct(100)}%`, width: `${capPct(shownVal) - capPct(100)}%` }} />
          ) : null}
          {unityMark != null ? (
            <span className="pointer-events-none absolute inset-y-0 w-[1.5px] bg-black/75" style={{ left: `${unityMark}%` }} />
          ) : null}
        </div>
        <div
          className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-acc/70 transition-transform group-hover/vol:scale-110"
          style={{ left: `${capPct(shownVal)}%` }}
        />
      </div>
      <span data-testid="th-volume-pct" className={`min-w-[34px] font-mono text-[11px] font-semibold ${shownVal > 100 ? 'text-amber-300' : 'text-fg2'}`}>
        {shownVal}%
      </span>
    </div>
  );
}

function DockBtn({
  icon, label, onClick, onContextMenu, active, big, scale = 'default',
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  big?: boolean;
  scale?: 'compact' | 'default' | 'spacious';
}) {
  const sz = scale === 'compact'
    ? (big ? 'size-[clamp(36px,2.5vw,44px)] ' : 'size-[clamp(30px,2.1vw,36px)] ')
    : scale === 'spacious'
      ? (big ? 'size-[clamp(48px,3.5vw,58px)] ' : 'size-[clamp(40px,2.9vw,50px)] ')
      : (big ? 'size-[clamp(42px,3vw,52px)] ' : 'size-[clamp(35px,2.5vw,44px)] ');
  return (
    <button onClick={onClick} onContextMenu={onContextMenu} data-tip={label} aria-label={label}
      className={`grid flex-none place-items-center rounded-full transition ${sz}${
        active
          ? 'bg-acc text-acc-ink shadow-[0_0_16px_rgba(226,164,58,0.35)]'
          : big
            ? 'bg-white/15 text-[#f5efe6] ring-1 ring-white/15 hover:bg-acc hover:text-acc-ink'
            : 'text-[#f1eadf]/90 hover:bg-white/15 hover:text-acc'
      }`}>
      {icon}
    </button>
  );
}
