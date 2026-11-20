import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DisplayTarget, PartyNoteItem, Ranked, ReadyStateView, Stream } from '../api';
import type { PlayQueueItem } from '../store/usePlayQueueStore';
import type { Lang } from '../i18n';
import { Icon } from '../ui/Icon';
import {
  ChaptersDrawer, EpisodesDrawer, PartyDrawer, SourcesDrawer, ToggleRow,
  type AddonSub, type BookmarkItem, type ChatMsg, type DrawerKind, type EpItem,
  type PartyView, type TheaterPropsMap, type TranslateFn, type VoiceStateView, type VoteItem,
} from './TheaterDrawers';
import { formatAddonSub, formatAudioTrack, formatSubTrack, resolveLang, type LangInfo } from './trackFormat';

export type SleepSetting = number | 'eof';

interface TheaterPopoversProps {
  drawer: DrawerKind;
  lang: Lang;
  t: TranslateFn;
  props: TheaterPropsMap;
  addonSubs: AddonSub[];
  loadedSubMap: Record<string, string>;
  subColor: string;
  onColor: (c: string) => void;
  subFont: string;
  onSubFont: (f: string) => void;
  subBold: boolean;
  onSubBold: (v: boolean) => void;
  subOutline: number;
  onSubOutline: (v: number) => void;
  subBgAlpha: number;
  onSubBgAlpha: (v: number) => void;
  subFpsMode: string;
  sdhFilter: boolean;
  hwAccel: boolean;
  autoDuck: boolean;
  spdif: boolean;
  vsr: boolean;
  night: boolean;
  aspect: string;
  tone: string;
  ambientGlow: boolean;
  voiceClarity: boolean;
  displayProfile: string;
  detectedDisplayProfile: string;
  warmTint: number;
  dimmerPct: number;
  secondaryDisplays: number;
  displays?: DisplayTarget[];
  compareActive: boolean;
  onCompareToggle: () => void;
  shotWithSubs: boolean;
  onShotWithSubs: (v: boolean) => void;
  loopA: number | null;
  loopB: number | null;
  sleepSetting: SleepSetting;
  onSleep: (s: SleepSetting) => void;
  bookmarks: BookmarkItem[];
  sources: { streams: Ranked[]; current: Stream | null; loading: boolean };
  episodes: { list: EpItem[]; current: string; seriesName: string; loading: boolean };
  chatMsgs: ChatMsg[];
  partyVotes: VoteItem[];
  partyState?: PartyView | null;
  partyNotes?: PartyNoteItem[];
  partyQueue?: PlayQueueItem[];
  readyState?: ReadyStateView | null;
  voiceState?: VoiceStateView | null;
  onResumeAnyway?: () => void;
  onBrb?: (durationSec: number) => void;
  onVoiceMode?: (mode: 'off' | 'ptt' | 'open') => void;
  onVoicePtt?: (down: boolean) => void;
  onClose: () => void;
  onCmd: (cmd: string, a?: Record<string, unknown>) => Promise<any>;
  onNight: () => void;
  onPickSource: (r: Ranked) => void;
  onPickEpisode: (id: string) => void;
  onPickEpStream: (videoId: string, r: Ranked) => void;
  onSyncAction: (ok?: boolean) => void;
  onSwitchDrawer?: (d: DrawerKind) => void;
  drawerBack?: DrawerKind;
  onBackDrawer?: () => void;
  statsOpen?: boolean;
  onToggleStats?: () => void;
  onToggleFocus?: () => void;
  onWhatSaid?: () => void;
  controlsLocked?: boolean;
  onToggleLock?: () => void;
  showControlLock?: boolean;
  isSeries?: boolean;
  hasChapters?: boolean;
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function TheaterPopovers(p: TheaterPopoversProps) {
  if (!p.drawer) return null;

  const sizeClass =
    p.drawer === 'subs' ? 'w-[min(410px,92vw)] max-h-[min(360px,50vh)]'
      : p.drawer === 'audio' ? 'w-[min(276px,90vw)] max-h-[min(336px,50vh)]'
      : p.drawer === 'speed' ? 'w-[min(290px,90vw)] max-h-[min(248px,50vh)]'
      : p.drawer === 'video' ? 'w-[min(352px,92vw)] max-h-[min(380px,50vh)]'
      : p.drawer === 'tools' ? 'w-[min(356px,92vw)] max-h-[min(380px,50vh)]'
      : p.drawer === 'more' ? 'w-[min(372px,92vw)] max-h-[min(416px,54vh)]'
      : p.drawer === 'chapters' ? 'w-[min(320px,90vw)] max-h-[min(360px,50vh)]'
      : p.drawer === 'party' ? 'w-[min(360px,92vw)] max-h-[min(380px,50vh)]'
      : 'w-[min(420px,94vw)] max-h-[min(390px,50vh)]';

  const titleMap: Record<Exclude<DrawerKind, null>, string> = {
    subs: p.t('th_subs'),
    audio: p.t('th_audio'),
    speed: p.t('th_speed_sleep'),
    video: p.t('th_video_color'),
    tools: p.t('th_tools'),
    more: p.t('th_more_tools'),
    sources: p.t('th_sources'),
    episodes: p.t('th_episodes'),
    chapters: p.t('th_chapters'),
    party: p.t('party_chat'),
  };

  return (
    <>
      <div onClick={p.onClose} className="fixed inset-0 z-30" aria-hidden="true" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className={`fixed bottom-[clamp(84px,8.8vh,120px)] end-[clamp(16px,2vw,32px)] z-40 flex flex-col overflow-hidden rounded-2xl bg-[#0d0c0b]/95 text-[clamp(12px,0.88vw,13.5px)] shadow-2xl ring-1 ring-white/15 backdrop-blur-2xl fade-in ${sizeClass}`}
      >
        <div className="flex flex-none items-center justify-between border-b border-white/10 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {p.drawerBack && p.onBackDrawer ? (
              <button onClick={p.onBackDrawer} aria-label={p.t('back')} className="grid size-6 flex-none place-items-center rounded-full bg-white/10 text-fg2 hover:bg-white/20 hover:text-fg">
                {p.lang === 'ar' ? <ChevronRight size={14} strokeWidth={2.2} /> : <ChevronLeft size={14} strokeWidth={2.2} />}
              </button>
            ) : null}
            <h2 className="truncate text-[clamp(13px,0.95vw,15px)] font-bold text-fg">{titleMap[p.drawer]}</h2>
          </div>
          <button onClick={p.onClose} className="grid size-7 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg">
            <Icon n="x" s={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {p.drawer === 'more' ? <MoreToolsPopoverBody p={p} /> : null}
          {p.drawer === 'subs' ? <SubtitlesPopoverBody p={p} /> : null}
          {p.drawer === 'audio' ? <AudioPopoverBody p={p} /> : null}
          {p.drawer === 'speed' ? <SpeedSleepPopoverBody p={p} /> : null}
          {p.drawer === 'video' ? <VideoColorPopoverBody p={p} /> : null}
          {p.drawer === 'tools' ? <ToolsBookmarksPopoverBody p={p} /> : null}
          {p.drawer === 'sources' ? (
            <div className="p-3">
              <SourcesDrawer t={p.t} list={p.sources.streams} current={p.sources.current} loading={p.sources.loading} onPick={p.onPickSource} />
            </div>
          ) : null}
          {p.drawer === 'episodes' ? (
            <div className="p-3">
              <EpisodesDrawer
                t={p.t}
                seriesName={p.episodes.seriesName}
                episodes={p.episodes.list}
                currentId={p.episodes.current}
                loading={p.episodes.loading}
                onPick={p.onPickEpisode}
                onFetchEpStreams={(videoId) => p.onCmd('episode-streams', { videoId })}
                onPickEpStream={p.onPickEpStream}
              />
            </div>
          ) : null}
          {p.drawer === 'chapters' ? (
            <div className="p-3">
              <ChaptersDrawer
                t={p.t}
                chapters={p.props['chapter-list'] || []}
                curIdx={p.props.chapter ?? -1}
                pos={p.props['time-pos'] || 0}
                onSeek={(sec) => p.onCmd('seek', { to: sec, abs: true })}
              />
            </div>
          ) : null}
          {p.drawer === 'party' ? (
            <div className="h-[min(365px,48vh)] p-3">
              <PartyDrawer
                t={p.t}
                messages={p.chatMsgs}
                votes={p.partyVotes}
                partyState={p.partyState}
                voiceState={p.voiceState}
                notes={p.partyNotes || []}
                queue={p.partyQueue || []}
                readyState={p.readyState || null}
                curPos={p.props['time-pos'] || 0}
                onSendChat={(text) => p.onCmd('party-chat', { text })}
                onReact={(emoji) => p.onCmd('party-react', { emoji })}
                onVote={(castId) => p.onCmd('party-vote', { castId })}
                onResumeAnyway={p.onResumeAnyway}
                onBrb={p.onBrb}
                onVoiceMode={p.onVoiceMode}
                onVoicePtt={p.onVoicePtt}
                onOpenSources={() => p.onSwitchDrawer?.('sources')}
                onReadyCheck={() => p.onCmd('party-ready-check')}
                onCountdown={() => p.onCmd('party-countdown', { ms: 3000 })}
                onRemoteControl={(mode, holderId) => p.onCmd('party-remote', { mode, holderId })}
                onAddNote={async (text) => { const list = await p.onCmd('party-note-add', { text }); return list; }}
                onDelNote={(id) => p.onCmd('party-note-del', { id })}
                onSeekTo={(sec) => p.onCmd('seek', { to: sec, abs: true })}
                onQueueCmd={(op, a) => p.onCmd(`queue-${op}`, a || {})}
              />
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function SubtitlesPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const [tab, setTab] = useState<'tracks' | 'style'>('tracks');
  const [selectedLang, setSelectedLang] = useState<string>('ar');
  const [otherOpen, setOtherOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [subQuery, setSubQuery] = useState('');
  const [searchingSubs, setSearchingSubs] = useState(false);
  const [remoteSubs, setRemoteSubs] = useState<AddonSub[] | null>(null);

  const subTracks = (p.props['track-list'] || []).filter((x) => x.type === 'sub');
  const secondarySid = p.props['secondary-sid'];
  const loadedUrls = useMemo(() => {
    const s = new Set<string>();
    for (const tr of subTracks) {
      const ext = tr['external-filename'];
      if (ext) {
        s.add(ext);
        if (p.loadedSubMap[ext]) s.add(p.loadedSubMap[ext]);
      }
    }
    return s;
  }, [subTracks, p.loadedSubMap]);

  const mergedSourceSubs = remoteSubs ?? p.addonSubs;
  const parsedLoaded = useMemo(
    () => subTracks.map((tr) => ({ kind: 'loaded' as const, track: tr, fmt: formatSubTrack(tr, p.lang) })),
    [subTracks, p.lang]
  );
  const parsedAddons = useMemo(
    () => mergedSourceSubs.filter((s) => s.url && !loadedUrls.has(s.url)).map((sub, i) => ({ kind: 'addon' as const, sub, fmt: formatAddonSub(sub, p.lang, i) })),
    [mergedSourceSubs, loadedUrls, p.lang]
  );

  const runSubSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSearchingSubs(true);
    try {
      const res = await p.onCmd('sub-search', { query: subQuery.trim(), lang: selectedLang || 'ar' });
      if (Array.isArray(res)) setRemoteSubs(res);
    } finally {
      setSearchingSubs(false);
    }
  };

  const languages = useMemo(() => {
    const map = new Map<string, { info: LangInfo; count: number; hasSelected: boolean }>();
    const add = (info: LangInfo, selected: boolean) => {
      const cur = map.get(info.code);
      if (cur) { cur.count++; if (selected) cur.hasSelected = true; }
      else map.set(info.code, { info, count: 1, hasSelected: selected });
    };
    for (const x of parsedLoaded) add(x.fmt.langInfo, !!x.track.selected || secondarySid === x.track.id);
    for (const x of parsedAddons) add(x.fmt.langInfo, false);
    if (!map.has('ar')) map.set('ar', { info: resolveLang('ar'), count: 0, hasSelected: false });
    if (!map.has('en')) map.set('en', { info: resolveLang('en'), count: 0, hasSelected: false });
    return [...map.values()].sort((a, b) => a.info.priority - b.info.priority || a.info.name.localeCompare(b.info.name));
  }, [parsedLoaded, parsedAddons, secondarySid]);

  useEffect(() => {
    const active = parsedLoaded.find((x) => x.track.selected);
    if (active) setSelectedLang(active.fmt.langInfo.code);
    else if (!languages.some((l) => l.info.code === selectedLang && l.count > 0)) {
      const firstPopulated = languages.find((l) => l.count > 0);
      if (firstPopulated) setSelectedLang(firstPopulated.info.code);
    }
  }, [parsedLoaded.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryLangs = languages.filter((l) => l.info.code === 'ar' || l.info.code === 'en');
  const otherLangs = languages.filter((l) => l.info.code !== 'ar' && l.info.code !== 'en' && l.count > 0);
  const shownLoaded = parsedLoaded.filter((x) => x.fmt.langInfo.code === selectedLang);
  const shownAddons = parsedAddons.filter((x) => x.fmt.langInfo.code === selectedLang).slice(0, 30);
  const hasAnySubOn = subTracks.some((x) => x.selected);
  const colors = ['#FFFFFF', '#FDE047', '#E2A43A', '#67E8F9'];

  const runAutoSync = async () => {
    setSyncing(true);
    try {
      const res = await p.onCmd('sub-autosync');
      p.onSyncAction(!!res?.ok);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-white/8 px-3 py-1.5">
        <div className="flex gap-1 rounded-lg bg-white/6 p-0.5">
          <button onClick={() => setTab('tracks')} className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${tab === 'tracks' ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
            {p.t('th_tracks')}
          </button>
          <button onClick={() => setTab('style')} className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${tab === 'style' ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
            {p.t('th_appearance')}
          </button>
        </div>
        <button onClick={() => p.onCmd('sub-open-file')} className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-medium text-fg2 hover:bg-white/15 hover:text-fg">
          {p.t('th_sub_file')}
        </button>
      </div>

      {tab === 'tracks' ? (
        <div className="flex flex-col">
          <form onSubmit={runSubSearch} className="flex items-center gap-1.5 border-b border-white/8 px-2.5 py-2">
            <input
              dir="auto"
              value={subQuery}
              onChange={(e) => setSubQuery(e.target.value)}
              placeholder={p.t('th_sub_search_ph')}
              className="min-w-0 flex-1 rounded-lg bg-white/8 px-2.5 py-1 text-[11.5px] text-fg placeholder:text-fg3 ring-1 ring-white/10 outline-none focus:ring-acc"
            />
            <button
              type="submit"
              disabled={searchingSubs}
              className="flex-none rounded-lg bg-acc px-2.5 py-1 text-[11px] font-bold text-acc-ink hover:brightness-110 disabled:opacity-60"
            >
              {searchingSubs ? p.t('th_sub_searching') : p.t('th_sub_search_btn')}
            </button>
          </form>
          <div className="flex h-[min(220px,34vh)] min-h-[165px]">
          <div className="w-[128px] flex-none space-y-1 overflow-y-auto border-e border-white/10 p-2">
            <button onClick={() => { p.onCmd('sid', { id: 'no' }); p.onCmd('secondary-sid', { id: 'no' }); }}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-[11.5px] font-medium transition ${!hasAnySubOn ? 'bg-acc/20 text-acc ring-1 ring-acc/60' : 'text-fg2 hover:bg-white/8'}`}>
              <span>{p.t('th_off')}</span>
            </button>
            {primaryLangs.map((l) => (
              <button key={l.info.code} onClick={() => setSelectedLang(l.info.code)}
                className={`flex w-full items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-start text-[11.5px] transition ${selectedLang === l.info.code ? 'bg-white/14 font-bold text-fg' : 'text-fg2 hover:bg-white/8'}`}>
                <span className="truncate">{l.info.flag} {l.info.native}</span>
                {l.hasSelected ? <span className="size-1.5 flex-none rounded-full bg-acc" /> : l.count > 0 ? <span className="text-[10px] text-fg3">{l.count}</span> : null}
              </button>
            ))}
            {otherLangs.length ? (
              <div>
                <button onClick={() => setOtherOpen((o) => !o)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-[10.5px] font-semibold text-fg3 hover:bg-white/6 hover:text-fg2">
                  <span className="truncate">{p.t('th_more_langs')} ({otherLangs.length})</span>
                  <span>{otherOpen ? '−' : '+'}</span>
                </button>
                {otherOpen ? (
                  <div className="mt-1 space-y-0.5">
                    {otherLangs.map((l) => (
                      <button key={l.info.code} onClick={() => setSelectedLang(l.info.code)}
                        className={`flex w-full items-center justify-between gap-1 rounded-lg px-2 py-1 text-start text-[11px] transition ${selectedLang === l.info.code ? 'bg-white/14 font-bold text-fg' : 'text-fg2 hover:bg-white/8'}`}>
                        <span className="truncate">{l.info.flag} {l.info.native}</span>
                        <span className="text-[10px] text-fg3">{l.count}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {!shownLoaded.length && !shownAddons.length ? (
              <div className="py-8 text-center text-[11.5px] text-fg3">{p.t('empty_list')}</div>
            ) : null}
            {shownLoaded.map(({ track, fmt }) => {
              const isSecond = secondarySid === track.id;
              return (
                <div key={`tr-${track.id}`} className={`flex items-center gap-1.5 rounded-xl p-1.5 ring-1 transition ${track.selected ? 'bg-acc/15 ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/8'}`}>
                  <button onClick={() => p.onCmd('sid', { id: track.id })} className="min-w-0 flex-1 text-start">
                    <div dir="auto" className={`truncate text-[11.5px] font-semibold ${track.selected ? 'text-acc' : 'text-fg'}`}>{fmt.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-fg3">
                      <span className="rounded bg-white/8 px-1.5 py-0.2">{fmt.provider}</span>
                      {fmt.badges.map((b) => <span key={b} className="rounded bg-acc/15 px-1.5 py-0.2 font-semibold text-acc">{b}</span>)}
                    </div>
                  </button>
                  <button
                    onClick={() => p.onCmd('secondary-sid', { id: isSecond ? 'no' : track.id })}
                    data-tip={p.t('th_dual_sub')}
                    className={`rounded-md px-1.5 py-1 text-[10px] font-bold ring-1 transition ${isSecond ? 'bg-acc text-acc-ink ring-acc' : 'bg-white/8 text-fg3 ring-white/10 hover:text-fg'}`}
                  >
                    {p.t('th_dual_sub')}
                  </button>
                </div>
              );
            })}
            {shownAddons.map(({ sub, fmt }, idx) => (
              <div key={`ad-${idx}-${sub.url}`} className="flex items-center gap-1.5 rounded-xl bg-white/5 p-1.5 ring-1 ring-white/10 hover:bg-white/10">
                <button onClick={() => p.onCmd('addon-sub-add', { url: sub.url, label: fmt.title, lang: sub.lang || '' })} className="min-w-0 flex-1 text-start">
                  <div dir="auto" className="truncate text-[11.5px] font-medium text-fg">{fmt.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-fg3">
                    <span className="rounded bg-white/8 px-1.5 py-0.2">{fmt.provider}</span>
                    {fmt.badges.map((b) => <span key={b} className="rounded bg-acc/15 px-1.5 py-0.2 font-semibold text-acc">{b}</span>)}
                  </div>
                </button>
                <button
                  onClick={() => p.onCmd('addon-sub-add', { url: sub.url, label: fmt.title, lang: sub.lang || '', secondary: true })}
                  data-tip={p.t('th_dual_sub')}
                  className="rounded-md bg-white/8 px-1.5 py-1 text-[10px] font-bold text-fg3 ring-1 ring-white/10 hover:bg-acc hover:text-acc-ink"
                >
                  {p.t('th_dual_sub')}
                </button>
              </div>
            ))}
          </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg2">{p.t('th_sub_delay')}</span>
            <div className="flex items-center gap-2">
              <button onClick={runAutoSync} disabled={syncing}
                className="rounded-full bg-acc/18 px-2.5 py-0.5 text-[11px] font-semibold text-acc ring-1 ring-acc/40 hover:bg-acc hover:text-acc-ink disabled:opacity-50">
                {syncing ? '...' : p.t('th_auto_sync')}
              </button>
              <span dir="ltr" className="font-mono font-semibold text-fg">{(p.props['sub-delay'] || 0).toFixed(1)}s</span>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[-0.5, -0.1, 0, 0.1, 0.5].map((d) => (
              <button key={d} onClick={() => d === 0 ? p.onCmd('sub-delay', { abs: true, d: 0 }) : p.onCmd('sub-delay', { d })}
                className="rounded-lg bg-white/8 py-1 font-mono text-[11px] hover:bg-white/15">{d === 0 ? '0' : (d > 0 ? `+${d}` : d)}</button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg2">{p.t('th_sub_fps')}</span>
            <div dir="ltr" className="flex gap-1 font-mono">
              {([['reset', '1×'], ['23976_25', '23.9→25'], ['25_23976', '25→23.9']] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => p.onCmd('sub-fps-shift', { mode: m })}
                  className={`rounded-lg px-2 py-0.5 text-[10.5px] ${p.subFpsMode === m ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <ToggleRow label={p.t('th_sdh_filter')} on={p.sdhFilter} onClick={() => p.onCmd('sdh-toggle', { on: !p.sdhFilter })} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg2">{p.t('th_sub_font')}</span>
            <select
              value={p.subFont}
              onChange={(e) => { const f = e.target.value; p.onSubFont(f); p.onCmd('sub-style', { 'sub-font': f }); }}
              className="rounded-lg bg-white/8 px-2 py-1 text-[11px] text-fg ring-1 ring-white/10 outline-none"
            >
              {['Segoe UI', 'Cairo', 'Tajawal', 'Arial', 'Consolas'].map((f) => (
                <option key={f} value={f} className="bg-[#12100e]">{f}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">{p.t('th_sub_size')}</span>
            <div className="flex gap-1">
              {[['A−', 0.85], ['A', 1], ['A+', 1.25], ['A++', 1.5]].map(([lbl, v]) => (
                <button key={lbl as string} onClick={() => p.onCmd('sub-scale', { v })}
                  className={`rounded-lg px-2 py-1 text-[11px] ${(p.props['sub-scale'] || 1) === v ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">{p.t('th_sub_pos')}</span>
            <div className="flex gap-1">
              {[['↓', 96], ['•', 92], ['↑', 82]].map(([lbl, v]) => (
                <button key={lbl as string} onClick={() => p.onCmd('sub-pos', { v })}
                  className={`rounded-lg px-2.5 py-1 text-[11px] ${(p.props['sub-pos'] ?? 94) === v ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg2">{p.t('th_sub_outline')}</span>
            <div dir="ltr" className="flex items-center gap-1 font-mono">
              <button onClick={() => { const b = !p.subBold; p.onSubBold(b); p.onCmd('sub-style', { 'sub-bold': b ? 'yes' : 'no' }); }}
                className={`rounded-lg px-2 py-0.5 text-[10.5px] font-bold ${p.subBold ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2'}`}>
                B
              </button>
              {[0, 1.5, 2.5, 4].map((o) => (
                <button key={o} onClick={() => { p.onSubOutline(o); p.onCmd('sub-style', { 'sub-border-size': o }); }}
                  className={`rounded-lg px-2 py-0.5 text-[10.5px] ${Math.abs(p.subOutline - o) < 0.3 ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg2">{p.t('th_sub_bg')}</span>
            <div dir="ltr" className="flex gap-1 font-mono">
              {([[0, 'Off'], [0.4, '40%'], [0.75, '75%']] as const).map(([a, lbl]) => {
                const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();
                return (
                  <button key={a} onClick={() => {
                    p.onSubBgAlpha(a);
                    p.onCmd('sub-style', {
                      'sub-border-style': a > 0 ? 'opaque-box' : 'outline-and-shadow',
                      'sub-back-color': a > 0 ? `#${alphaHex}000000` : '#00000000',
                      backAlpha: a,
                    });
                  }}
                    className={`rounded-lg px-2 py-0.5 text-[10.5px] ${Math.abs(p.subBgAlpha - a) < 0.05 ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg2">{p.t('th_sub_color')}</span>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button key={c} aria-label={c} onClick={() => { p.onColor(c); p.onCmd('sub-style', { 'sub-color': c }); }}
                  className={`size-5 rounded-full ring-2 ${p.subColor === c ? 'scale-110 ring-acc' : 'ring-white/25'}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AudioPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const audios = (p.props['track-list'] || []).filter((x) => x.type === 'audio');
  const delayMs = Math.round((p.props['audio-delay'] || 0) * 1000);
  return (
    <div className="flex flex-col justify-between">
      <div className="space-y-2 p-2.5">
        <div className="space-y-1">
          {audios.map((x) => {
            const fmt = formatAudioTrack(x, p.lang);
            return (
              <button key={x.id} onClick={() => p.onCmd('aid', { id: x.id })}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-start ring-1 transition ${x.selected ? 'bg-acc/15 text-acc ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
                <span className="truncate font-medium">{fmt.langInfo.flag} {fmt.primary}</span>
                {fmt.metaLabel ? <span dir="ltr" className="flex-none rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-fg3">{fmt.metaLabel}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
          <ToggleRow label={p.t('th_voice_clarity')} on={p.voiceClarity} onClick={() => p.onCmd('voice-clarity', { on: !p.voiceClarity })} />
          <ToggleRow label={p.t('th_night')} on={p.night} onClick={p.onNight} />
          <ToggleRow label={p.t('th_auto_duck')} on={p.autoDuck} onClick={() => p.onCmd('duck', { on: !p.autoDuck })} />
          <ToggleRow label={p.t('th_spdif')} on={p.spdif} onClick={() => p.onCmd('spdif', { on: !p.spdif })} />
        </div>
      </div>
      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-white/10 bg-[#0d0c0b]/95 px-3 py-2">
        <span className="text-[11px] font-semibold text-fg2">{p.t('th_audio_sync')}</span>
        <div dir="ltr" className="flex items-center gap-1 font-mono text-[11px]">
          <button onClick={() => p.onCmd('audio-delay', { d: -0.05 })} className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">-50</button>
          <button onClick={() => p.onCmd('audio-delay', { abs: true, d: 0 })} className={`min-w-[54px] rounded-md px-1.5 py-0.5 text-center ${delayMs !== 0 ? 'bg-acc/20 font-bold text-acc' : 'bg-white/5 text-fg2'}`}>
            {delayMs > 0 ? `+${delayMs}` : delayMs} ms
          </button>
          <button onClick={() => p.onCmd('audio-delay', { d: 0.05 })} className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">+50</button>
        </div>
      </div>
    </div>
  );
}

function SpeedSleepPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const speed = p.props.speed || 1;
  const sleeps: { id: SleepSetting; label: string }[] = [
    { id: 0, label: p.t('th_off') },
    { id: 15, label: p.t('th_sleep_15m') },
    { id: 30, label: p.t('th_sleep_30m') },
    { id: 45, label: p.t('th_sleep_45m') },
    { id: 'eof', label: p.t('th_sleep_eof') },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 p-2.5">
      <div className="space-y-1.5 border-e border-white/10 pe-3">
        <div className="text-[11px] font-semibold text-fg2">{p.t('th_speed')}</div>
        <div className="grid grid-cols-2 gap-1">
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5].map((v) => (
            <button key={v} onClick={() => p.onCmd('speed', { v })}
              className={`rounded-lg py-1 font-mono text-[11px] transition ${Math.abs(speed - v) < 0.01 ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'}`}>
              {v}×
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5 ps-2">
        <div className="text-[11px] font-semibold text-fg2">{p.t('th_sleep_timer')}</div>
        <div className="space-y-1">
          {sleeps.map((s) => (
            <button key={String(s.id)} onClick={() => p.onSleep(s.id)}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-start text-[11px] transition ${p.sleepSetting === s.id ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'}`}>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function VideoColorPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const [subTab, setSubTab] = useState<'pic' | 'color' | 'filter'>('pic');
  const cropOn = (p.props.panscan || 0) >= 0.5;
  return (
    <div className="space-y-2.5 p-3">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/6 p-0.5">
        {([
          ['pic', p.t('th_tab_picture')],
          ['color', p.t('th_tab_colors')],
          ['filter', p.t('th_tab_filters')],
        ] as const).map(([id, lbl]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`rounded-lg py-1 text-[11.5px] font-semibold transition ${subTab === id ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {subTab === 'pic' ? (
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-fg2">{p.t('th_aspect')}</div>
            <div className="flex flex-wrap gap-1">
              {([
                ['fit', p.t('th_aspect_fit')],
                ['fill', p.t('th_aspect_fill')],
                ['zoom', p.t('th_zoom')],
                ['stretch', p.t('th_aspect_stretch')],
                ['16:9', '16:9'],
                ['4:3', '4:3'],
                ['21:9', '21:9'],
              ] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => p.onCmd('aspect', { mode: m })}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${p.aspect === m ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-fg2">{p.t('th_display_profile')}</span>
              <span dir="ltr" className="rounded bg-acc/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-acc uppercase">
                {p.displayProfile === 'auto' ? `${p.t('th_profile_auto')} (${p.detectedDisplayProfile})` : p.displayProfile}
              </span>
            </div>
            <div dir="ltr" className="grid grid-cols-5 gap-1 font-mono">
              {(['auto', 'oled', 'ips', 'hdr', 'standard'] as const).map((m) => (
                <button key={m} onClick={() => p.onCmd('display-profile', { mode: m })}
                  className={`rounded-lg py-1 text-[10.5px] uppercase transition ${p.displayProfile === m ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
                  {m === 'standard' ? 'STD' : m}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <ToggleRow label={p.t('th_hw_decode')} on={p.hwAccel} onClick={() => p.onCmd('hwdec-toggle', { on: !p.hwAccel })} />
            <ToggleRow label={p.t('th_ultrawide_crop')} on={cropOn} onClick={() => p.onCmd('ultrawide-crop', { on: !cropOn })} />
            <ToggleRow label="RTX VSR" on={p.vsr} onClick={() => p.onCmd('vsr-toggle', { on: !p.vsr })} />
          </div>
          {p.displays && p.displays.length > 1 ? (
            <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
              <div className="text-[11px] font-semibold text-fg2">{p.t('th_move_display')}</div>
              <div className="flex flex-wrap gap-1">
                {p.displays.map((d, idx) => (
                  <button
                    key={d.id}
                    onClick={() => p.onCmd('move-display', { displayId: d.id })}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                      d.current ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'
                    }`}
                  >
                    {p.t('th_display_n', { n: idx + 1 })}{d.primary ? ` (${p.t('th_primary_display')})` : ''}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {subTab === 'color' ? (
        <div className="space-y-2.5">
          <div className="space-y-2 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-fg2">{p.t('th_tab_colors')}</span>
              <button onClick={() => p.onCmd('eq-reset')} className="text-[11px] font-semibold text-acc hover:underline">{p.t('th_reset')}</button>
            </div>
            {(['brightness', 'contrast', 'saturation', 'gamma'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="w-18 truncate text-[11px] text-fg2">{k === 'gamma' ? p.t('th_gamma') : p.t(`th_${k}` as const)}</span>
                <input type="range" min={-30} max={30} value={p.props[k] || 0} onChange={(e) => p.onCmd('eq', { [k]: +e.target.value })} className="flex-1 accent-acc" />
                <span dir="ltr" className="w-7 text-end font-mono text-[11px]">{p.props[k] || 0}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-fg2">{p.t('th_warm_tint')}</span>
              <span dir="ltr" className="font-mono text-[11px] font-bold text-acc">{p.warmTint}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={p.warmTint}
              onChange={(e) => p.onCmd('warm-tint', { pct: +e.target.value })}
              className="w-full accent-acc"
            />
            <div dir="ltr" className="grid grid-cols-3 gap-1 font-mono text-[10.5px]">
              {[0, 35, 70].map((v) => (
                <button key={v} onClick={() => p.onCmd('warm-tint', { pct: v })}
                  className={`rounded-lg py-0.5 ${Math.abs(p.warmTint - v) <= 2 ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
                  {v}%
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {subTab === 'filter' ? (
        <div className="space-y-2.5">
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <div className="text-[11px] font-semibold text-fg2">{p.t('th_tone_map')}</div>
            <div className="grid grid-cols-3 gap-1">
              {['bt.2446a', 'spline', 'bt.2390', 'hable', 'mobius', 'reinhard', 'clip'].map((m) => (
                <button key={m} onClick={() => p.onCmd('tone-mapping', { mode: m })}
                  className={`rounded-lg py-1 font-mono text-[11px] ${p.tone === m ? 'bg-acc font-bold text-acc-ink' : 'bg-white/8 hover:bg-white/15'}`}>{m}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <ToggleRow label={p.t('th_ab_compare')} on={p.compareActive} onClick={p.onCompareToggle} />
            <ToggleRow label={p.t('th_ambient_glow')} on={p.ambientGlow} onClick={() => p.onCmd('ambient-glow', { on: !p.ambientGlow })} />
          </div>
          <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-fg2">{p.t('th_dimmer')}</span>
              <span dir="ltr" className="font-mono text-[11px] font-bold text-acc">
                {p.dimmerPct}%{p.secondaryDisplays > 0 ? ` · ${p.secondaryDisplays}M` : ''}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={p.dimmerPct}
              onChange={(e) => p.onCmd('dimmer', { pct: +e.target.value })}
              className="w-full accent-acc"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolsBookmarksPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const [note, setNote] = useState('');
  const [clipping, setClipping] = useState<number | null>(null);
  const loopA = p.loopA, loopB = p.loopB;

  const saveClip = async (sec: 15 | 30) => {
    setClipping(sec);
    try { await p.onCmd('save-clip', { seconds: sec }); }
    finally { setClipping(null); }
  };

  const addBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    await p.onCmd('bookmark-add', { label: note.trim() });
    setNote('');
  };

  return (
    <div className="space-y-2.5 p-3">
      <div className="space-y-2 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => p.onCmd('screenshot', { withSubs: p.shotWithSubs })}
            className="flex items-center gap-1.5 rounded-lg bg-acc px-3 py-1.5 text-[11.5px] font-bold text-acc-ink hover:brightness-110">
            <Icon n="camera" s={14} />{p.t('th_screenshot')}
          </button>
          <button onClick={() => p.onShotWithSubs(!p.shotWithSubs)}
            className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium ring-1 ${p.shotWithSubs ? 'bg-acc/20 text-acc ring-acc' : 'bg-white/8 text-fg3 ring-white/10'}`}>
            {p.t('th_with_subs')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="truncate text-[11px] text-fg2">{p.t('th_save_clip')}</span>
          <div className="flex gap-1.5">
            {([15, 30] as const).map((sec) => (
              <button key={sec} disabled={clipping !== null} onClick={() => saveClip(sec)}
                className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-[11px] font-semibold hover:bg-acc hover:text-acc-ink disabled:opacity-50">
                {clipping === sec ? '...' : `${sec}s`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="text-[11px] font-semibold text-fg2">{p.t('th_ab_loop')}</div>
        <div className="grid grid-cols-3 gap-1">
          <button onClick={() => p.onCmd('ab-loop', { step: 'a' })} className="rounded-lg bg-white/8 py-1 hover:bg-white/15">
            A {loopA != null ? `(${fmtClock(loopA)})` : ''}
          </button>
          <button onClick={() => p.onCmd('ab-loop', { step: 'b' })} className="rounded-lg bg-white/8 py-1 hover:bg-white/15">
            B {loopB != null ? `(${fmtClock(loopB)})` : ''}
          </button>
          <button onClick={() => p.onCmd('ab-loop', { step: 'clear' })} className="rounded-lg bg-white/8 py-1 text-red-300 hover:bg-red-500/20">
            {p.t('th_reset')}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="text-[11px] font-semibold text-fg2">{p.t('th_ext_launch')}</div>
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
          <button onClick={() => p.onCmd('external-launch', { player: 'mpv' })} className="rounded-lg bg-white/8 py-1.5 font-semibold hover:bg-acc hover:text-acc-ink">mpv</button>
          <button onClick={() => p.onCmd('external-launch', { player: 'vlc' })} className="rounded-lg bg-white/8 py-1.5 font-semibold hover:bg-acc hover:text-acc-ink">VLC</button>
          <button onClick={() => p.onCmd('export-m3u')} className="rounded-lg bg-white/8 py-1.5 font-sans font-semibold hover:bg-acc hover:text-acc-ink">{p.t('th_export_m3u')}</button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="text-[11px] font-semibold text-fg2">{p.t('th_bookmarks')}</div>
        <form onSubmit={addBookmark} className="flex gap-1.5">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={p.t('th_bookmark_ph')}
            className="min-w-0 flex-1 rounded-lg bg-black/35 px-2.5 py-1 text-[11.5px] ring-1 ring-white/12 focus:ring-acc" />
          <button type="submit" className="rounded-lg bg-white/12 px-2.5 py-1 text-[11px] font-semibold hover:bg-acc hover:text-acc-ink">
            {p.t('th_add_bookmark')}
          </button>
        </form>
        {p.bookmarks.length ? (
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {p.bookmarks.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/30 px-2 py-1">
                <button onClick={() => p.onCmd('seek', { to: b.t, abs: true })} className="flex min-w-0 flex-1 items-center gap-2 text-start hover:text-acc">
                  <span dir="ltr" className="font-mono text-[11px] font-bold text-acc">{fmtClock(b.t)}</span>
                  <span dir="auto" className="truncate text-[11px]">{b.label || fmtClock(b.t)}</span>
                </button>
                <button onClick={() => p.onCmd('bookmark-del', { id: b.id })} className="text-fg3 hover:text-red-400">
                  <Icon n="x" s={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MoreToolsPopoverBody({ p }: { p: TheaterPopoversProps }) {
  const [tab, setTab] = useState<'playback' | 'picture' | 'tools'>('playback');
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0d0c0b]/95 px-3 py-2">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/6 p-0.5">
          {([
            ['playback', p.t('th_tab_playback')],
            ['picture', p.t('th_tab_picture')],
            ['tools', p.t('th_tab_tools')],
          ] as const).map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-lg py-1 text-[11.5px] font-semibold transition ${tab === id ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {tab === 'playback' ? (
        <div className="space-y-2.5 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => p.onSwitchDrawer?.('sources')} className="rounded-xl bg-white/8 px-3 py-2 text-start text-[11.5px] font-semibold text-fg hover:bg-white/15">
              {p.t('th_sources')}
            </button>
            {p.isSeries ? (
              <button onClick={() => p.onSwitchDrawer?.('episodes')} className="rounded-xl bg-white/8 px-3 py-2 text-start text-[11.5px] font-semibold text-fg hover:bg-white/15">
                {p.t('th_episodes')}
              </button>
            ) : null}
            {p.hasChapters ? (
              <button onClick={() => p.onSwitchDrawer?.('chapters')} className="rounded-xl bg-white/8 px-3 py-2 text-start text-[11.5px] font-semibold text-fg hover:bg-white/15">
                {p.t('th_chapters')}
              </button>
            ) : null}
            {p.onWhatSaid ? (
              <button onClick={() => { p.onWhatSaid?.(); p.onClose(); }} className="rounded-xl bg-white/8 px-3 py-2 text-start text-[11.5px] font-semibold text-fg hover:bg-white/15">
                {p.t('th_said')}
              </button>
            ) : null}
          </div>
          {p.showControlLock !== false && p.onToggleLock ? (
            <div className="rounded-xl bg-white/5 px-2.5 py-2 ring-1 ring-white/10">
              <ToggleRow label={p.t('th_control_lock')} on={!!p.controlsLocked} onClick={() => { p.onToggleLock?.(); p.onClose(); }} />
            </div>
          ) : null}
          <div className="rounded-xl bg-white/5 ring-1 ring-white/10">
            <SpeedSleepPopoverBody p={p} />
          </div>
        </div>
      ) : null}

      {tab === 'picture' ? <VideoColorPopoverBody p={p} /> : null}

      {tab === 'tools' ? (
        <div>
          {(p.onToggleStats || p.onToggleFocus) ? (
            <div className="space-y-1.5 border-b border-white/10 px-3 py-2.5">
              {p.onToggleStats ? <ToggleRow label={p.t('th_stats_shortcut')} on={!!p.statsOpen} onClick={() => p.onToggleStats?.()} /> : null}
              {p.onToggleFocus ? <ToggleRow label={p.t('th_focus_mode')} on={false} onClick={() => { p.onToggleFocus?.(); p.onClose(); }} /> : null}
            </div>
          ) : null}
          <ToolsBookmarksPopoverBody p={p} />
        </div>
      ) : null}
    </div>
  );
}
