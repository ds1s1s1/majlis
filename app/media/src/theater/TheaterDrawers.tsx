import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { Img } from '../ui/Img';
import { TorrentHealthDot } from '../ui/TorrentHealthDot';
import { useSettingsStore } from '../settings/useSettingsStore';
import type { PartyNoteItem, Ranked, ReadyStateView, Stream, TorrentHealthEntry, WatchControlState } from '../api';
import type { PlayQueueItem } from '../store/usePlayQueueStore';
import type { Key, Lang } from '../i18n';

import { formatAddonSub, formatAudioTrack, formatSubTrack } from './trackFormat';

export type DrawerKind = 'sources' | 'episodes' | 'chapters' | 'subs' | 'audio' | 'speed' | 'video' | 'tools' | 'party' | 'more' | null;
export type TranslateFn = (k: Key, vars?: Record<string, string | number>) => string;

export interface TheaterPropsMap {
  duration?: number;
  'time-pos'?: number;
  'demuxer-cache-duration'?: number;
  'cache-speed'?: number;
  pause?: boolean;
  mute?: boolean;
  volume?: number;
  speed?: number;
  'paused-for-cache'?: boolean;
  'core-idle'?: boolean;
  'eof-reached'?: boolean;
  'hwdec-current'?: string;
  'video-codec'?: string;
  'estimated-vf-fps'?: number;
  avsync?: number;
  panscan?: number;
  'video-bitrate'?: number;
  'frame-drop-count'?: number;
  'sub-delay'?: number;
  'sub-scale'?: number;
  'sub-pos'?: number;
  'audio-delay'?: number;
  'secondary-sid'?: number | 'no';
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  'video-params'?: { w?: number; h?: number; 'sig-peak'?: number; colormatrix?: string };
  'audio-params'?: { codec?: string; 'channel-count'?: number; samplerate?: number };
  'track-list'?: { id: number; type: string; title?: string; lang?: string; codec?: string; selected?: boolean; external?: boolean; 'external-filename'?: string; 'demux-channel-count'?: number }[];
  'chapter-list'?: { title?: string; time: number }[];
  chapter?: number;
}

export interface EpItem { id: string; season: number; episode: number; name: string; thumbnail: string | null; overview: string; watched: boolean }
export interface AddonSub { url: string; lang?: string; addon?: string; filename?: string; release?: string; title?: string; name?: string; SubFileName?: string; sdh?: boolean; hi?: boolean; hearing_impaired?: boolean; forced?: boolean }
export interface BookmarkItem { id: string; t: number; label: string; at: number }
export interface ChatMsg { id?: string; from?: string; accent?: string | null; text: string; at?: number }
export interface VoteItem { id: string; type: string; name: string; poster: string | null; votes: number }
export interface PeerBuf { id: string; name?: string; stalled?: boolean; ready?: boolean; cache?: number; cacheSpeed?: number }
export interface BrbState { active: boolean; byId?: string; byName?: string; accent?: string | null; startedAt?: number; endsAt: number; durationSec?: number }
export interface SourceMismatchInfo { reason: 'duration' | 'edition'; diffSec?: number; hostDur?: number; localDur?: number; hostEdition?: string; localEdition?: string }
export interface PartyView { reason?: string; waitingFor?: string[]; waitEndsAt?: number; brb?: BrbState | null; playing?: boolean; role?: string; peers?: PeerBuf[]; control?: WatchControlState | null; canControl?: boolean; mismatch?: SourceMismatchInfo | null }
export interface VoiceStateView { mode: 'off' | 'ptt' | 'open'; pttKey: string; micOpen: boolean; autoDuck: boolean; talkers?: { idx: number; name: string; at: number }[] }
export interface RatingVoteView { id: string; name: string; accent?: string | null; score: number | null; submitted?: boolean }
export interface RatingRoundView { sessionId?: string; id: string; type: string; title: string; poster?: string | null; blind?: boolean; revealed?: boolean; expectedCount?: number; votes: RatingVoteView[] | Record<string, RatingVoteView>; avg: number | null }

const streamSame = (a?: Stream | null, b?: Stream | null) => {
  if (!a || !b) return false;
  if (a.url && b.url) return a.url === b.url;
  if (a.infoHash && b.infoHash) return a.infoHash === b.infoHash && (a.fileIdx ?? 0) === (b.fileIdx ?? 0);
  return false;
};

export function SourcesDrawer({ t, list, current, loading, onPick }: {
  t: TranslateFn; list: Ranked[]; current: Stream | null; loading: boolean;
  onPick: (r: Ranked) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'instant' | '4k' | '1080' | 'hdr' | 'ar'>('all');
  const [healthMap, setHealthMap] = useState<Record<string, TorrentHealthEntry>>({});
  useEffect(() => {
    let alive = true;
    const items = list.slice(0, 60)
      .filter((r) => !r.facts.instant && !r.facts.cached && r.stream.infoHash)
      .map((r) => ({
        infoHash: String(r.stream.infoHash).toLowerCase(),
        sources: r.stream.sources || [],
        fallbackSeeders: r.facts.seeders,
        hasMeta: !!(r.stream.behaviorHints?.filename || r.facts.height || r.facts.sizeGb),
        corroborated: r.tier >= 2,
        instant: r.facts.instant,
        cached: r.facts.cached,
      }));
    if (!items.length) return;
    (window as any).majlis?.invoke('cin:torrent-health', { items })
      .then((m: Record<string, TorrentHealthEntry>) => { if (alive && m && typeof m === 'object') setHealthMap(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, [list]);

  const shown = list.filter((x) => {
    const f = x.facts;
    if (filter === 'instant') return f.instant || f.cached;
    if (filter === '4k') return (f.height || 0) >= 2160;
    if (filter === '1080') return (f.height || 0) >= 1080 && (f.height || 0) < 2160;
    if (filter === 'hdr') return f.hdr || f.dv;
    if (filter === 'ar') return f.arabic;
    return true;
  });

  const filters: { id: typeof filter; label: string }[] = [
    { id: 'all', label: t('all') },
    { id: 'instant', label: `⚡ ${t('instant')}` },
    { id: '4k', label: '4K' },
    { id: '1080', label: '1080p' },
    { id: 'hdr', label: 'HDR' },
    { id: 'ar', label: t('arabic_sub') },
  ];

  return (
    <div className="space-y-2.5 text-[clamp(12.5px,0.9vw,14px)]">
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-[clamp(12px,0.85vw,13.5px)] font-medium transition ${filter === f.id ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {loading ? <div className="py-8 text-center text-xs text-fg3">{t('cin_finding')}</div> : null}
      {!loading && !shown.length ? <div className="py-8 text-center text-xs text-fg3">{t('no_sources')}</div> : null}
      <div className="space-y-1.5">
        {shown.map((x, i) => {
          const f = x.facts, s = x.stream, active = streamSame(s, current);
          const ih = s.infoHash ? String(s.infoHash).toLowerCase() : '';
          const line = (s.behaviorHints?.filename || s.title || s.name || `Source #${i + 1}`).split('\n')[0];
          return (
            <button key={i} onClick={() => onPick(x)}
              className={`w-full rounded-xl p-2.5 text-start ring-1 transition ${active ? 'bg-acc/15 ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <TorrentHealthDot r={x} health={ih ? healthMap[ih] : undefined} translateFn={t} />
                <span className="text-[clamp(12px,0.88vw,14px)] font-bold text-fg">{x.addon.name}</span>
                {i === 0 && x.tier > 0 ? <Badge tone="acc">{t('best_source')}</Badge> : null}
                {(f.instant || f.cached) ? <Badge tone="ok">⚡ {t('instant')}</Badge> : null}
                {f.height ? <Badge>{f.height >= 2160 ? '4K' : `${f.height}p`}</Badge> : null}
                {f.dv ? <Badge tone="acc">DV</Badge> : f.hdr ? <Badge tone="acc">HDR</Badge> : null}
                {f.audio ? <Badge>{f.audio.toUpperCase()}</Badge> : null}
                {f.codec ? <Badge>{f.codec.toUpperCase()}</Badge> : null}
                {f.arabic ? <Badge tone="ok">{t('arabic_sub')}</Badge> : null}
                {f.sizeGb ? <Badge>{f.sizeGb >= 1 ? `${f.sizeGb.toFixed(1)} GB` : `${Math.round(f.sizeGb * 1024)} MB`}</Badge> : null}
                {f.seeders != null && !f.instant ? <Badge>👤 {f.seeders}</Badge> : null}
              </div>
              <div dir="ltr" className="truncate text-[11px] text-fg2">{line}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function EpisodesDrawer({ t, seriesName, episodes, currentId, loading, onPick, onFetchEpStreams, onPickEpStream }: {
  t: TranslateFn; seriesName: string; episodes: EpItem[]; currentId: string; loading: boolean;
  onPick: (id: string) => void;
  onFetchEpStreams: (videoId: string) => Promise<Ranked[]>;
  onPickEpStream: (videoId: string, r: Ranked) => void;
}) {
  const seasons = [...new Set(episodes.map((e) => e.season))];
  const curSeason = episodes.find((e) => e.id === currentId)?.season ?? seasons[0] ?? 1;
  const [season, setSeason] = useState<number>(curSeason);
  const [subPick, setSubPick] = useState<{ ep: EpItem; streams: Ranked[] | null } | null>(null);
  const blurDefault = useSettingsStore((s) => s.data.sources.details.blurSpoilers || s.data.sources.details.hideSpoilers || s.data.controls.tvPlayback.hideEpThumbnails);
  const [spoilerBlur, setSpoilerBlur] = useState(blurDefault);

  if (loading) return <div className="py-8 text-center text-xs text-fg3">...</div>;
  if (!episodes.length) return <div className="py-8 text-center text-xs text-fg3">{t('empty_list')}</div>;
  const shownSeason = seasons.includes(season) ? season : curSeason;

  if (subPick) {
    return (
      <div className="space-y-2 text-[11.5px]">
        <button onClick={() => setSubPick(null)} className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1 text-xs font-medium hover:bg-white/15">
          <Icon n="chevl" s={13} className="flip" />{`E${subPick.ep.episode} · ${subPick.ep.name}`}
        </button>
        <SourcesDrawer t={t} list={subPick.streams || []} current={null} loading={subPick.streams === null}
          onPick={(r) => { setSubPick(null); onPickEpStream(subPick.ep.id, r); }} />
      </div>
    );
  }

  const openEpSources = async (e: React.MouseEvent, ep: EpItem) => {
    e.stopPropagation();
    setSubPick({ ep, streams: null });
    const list = await onFetchEpStreams(ep.id).catch(() => []);
    setSubPick((cur) => (cur?.ep.id === ep.id ? { ep, streams: list } : cur));
  };

  return (
    <div className="space-y-2.5 text-[clamp(12.5px,0.9vw,14px)]">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[clamp(11.5px,0.85vw,13px)] text-fg3">{seriesName}</div>
        <button onClick={() => setSpoilerBlur((b) => !b)} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${spoilerBlur ? 'bg-acc/20 text-acc' : 'bg-white/8 text-fg3'}`}>
          <Icon n={spoilerBlur ? 'eyeoff' : 'eye'} s={12} />{t('anti_spoiler')}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {seasons.map((s) => (
          <button key={s} onClick={() => setSeason(s)}
            className={`rounded-full px-3 py-1 text-[clamp(11.5px,0.85vw,13px)] font-medium transition ${s === shownSeason ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
            {s === 0 ? t('specials') : t('season', { n: s })}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {episodes.filter((e) => e.season === shownSeason).map((ep) => {
          const on = ep.id === currentId;
          const blurred = spoilerBlur && !ep.watched && !on;
          return (
            <div key={ep.id} className={`flex items-center gap-2 rounded-lg p-1.5 ring-1 transition ${on ? 'bg-acc/15 ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
              <button onClick={() => onPick(ep.id)} className="flex min-w-0 flex-1 gap-2 text-start">
                <div className="relative aspect-video w-22 flex-none overflow-hidden rounded bg-black/50">
                  <Img srcs={[ep.thumbnail]} className={`h-full w-full object-cover transition ${blurred ? 'scale-110 blur-md brightness-50' : ''}`} />
                  {ep.watched ? <span className="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-acc text-acc-ink"><Icon n="check" s={10} /></span> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-bold">E{ep.episode} · {ep.name}</div>
                  {ep.overview ? <div dir="auto" className={`clamp-2 mt-0.5 text-[10.5px] text-fg2 ${blurred ? 'blur-[4px] select-none' : ''}`}>{ep.overview}</div> : null}
                </div>
              </button>
              <button onClick={(e) => openEpSources(e, ep)} data-tip={t('th_sources')}
                className="grid size-7 flex-none place-items-center rounded-lg bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg">
                <Icon n="layers" s={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChaptersDrawer({ t, chapters, curIdx, pos, onSeek }: {
  t: TranslateFn; chapters: { title?: string; time: number }[]; curIdx: number; pos: number; onSeek: (sec: number) => void;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (!chapters.length) return <div className="py-8 text-center text-xs text-fg3">{t('empty_list')}</div>;
  return (
    <div className="space-y-1 text-xs">
      {chapters.map((c, idx) => {
        const active = idx === curIdx || (curIdx < 0 && pos >= c.time && (!chapters[idx + 1] || pos < chapters[idx + 1].time));
        return (
          <button key={idx} onClick={() => onSeek(c.time)}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start ring-1 transition ${active ? 'bg-acc/15 text-acc ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
            <span className="truncate font-medium">{c.title || `${t('th_chapters')} ${idx + 1}`}</span>
            <span dir="ltr" className="flex-none font-mono text-[11px] text-fg3">{fmt(c.time)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SubtitlesDrawer({ t, props, addonSubs, subColor, loadedSubMap, lang = 'ar', onCmd, onColor }: {
  t: TranslateFn; props: TheaterPropsMap; addonSubs: AddonSub[]; subColor: string; loadedSubMap?: Record<string, string>; lang?: Lang;
  onCmd: (cmd: string, a?: Record<string, unknown>) => Promise<any>; onColor: (c: string) => void;
}) {
  const list = (props['track-list'] || []).filter((x) => x.type === 'sub');
  const loadedUrls = new Set<string>();
  for (const x of list) {
    const ext = x['external-filename'];
    if (ext) {
      loadedUrls.add(ext);
      if (loadedSubMap?.[ext]) loadedUrls.add(loadedSubMap[ext]);
    }
  }
  const extra = addonSubs.filter((s) => s.url && !loadedUrls.has(s.url)).slice(0, 14);
  const colors = ['#FFFFFF', '#FDE047', '#E2A43A', '#67E8F9'];

  return (
    <div className="space-y-3 text-[clamp(12.5px,0.9vw,14px)]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-fg2">{t('th_tracks')}</span>
        <button onClick={() => onCmd('sub-open-file')} className="rounded-full bg-white/10 px-3 py-1 text-[clamp(11.5px,0.85vw,13px)] font-medium hover:bg-white/20">{t('th_sub_file')}</button>
      </div>
      <div className="space-y-1.5">
        <button onClick={() => onCmd('sid', { id: 'no' })}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-start ring-1 ${!list.some((x) => x.selected) ? 'bg-acc/15 text-acc ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
          <span>{t('th_off')}</span>
        </button>
        {list.map((x) => {
          const fmt = formatSubTrack(x, lang);
          return (
            <button key={x.id} onClick={() => onCmd('sid', { id: x.id })}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start ring-1 ${x.selected ? 'bg-acc/15 text-acc ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
              <span className="truncate">{fmt.langInfo.flag} {fmt.title}</span>
              {!x.external ? <span className="flex-none rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-fg3">{t('th_builtin')}</span> : null}
            </button>
          );
        })}
      </div>

      {extra.length ? (
        <div className="space-y-1.5">
          <div className="font-semibold text-fg2">{t('th_addon_subs')}</div>
          {extra.map((s, idx) => {
            const fmt = formatAddonSub(s, lang, idx);
            return (
              <button key={idx} onClick={() => onCmd('addon-sub-add', { url: s.url, label: fmt.title, lang: s.lang || '' })}
                className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-start ring-1 ring-white/10 hover:bg-white/10">
                <span className="min-w-0 flex-1 truncate">{fmt.langInfo.flag} {fmt.title}</span>
                <span className="flex-none rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-fg3">{fmt.provider}</span>
                <Icon n="plus" s={14} />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="text-fg2">{t('th_sub_delay')}</span>
          <span dir="ltr" className="font-mono">{(props['sub-delay'] || 0).toFixed(1)}s</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[-0.5, -0.1, 0, 0.1, 0.5].map((d) => (
            <button key={d} onClick={() => d === 0 ? onCmd('sub-delay', { d: -(props['sub-delay'] || 0) }) : onCmd('sub-delay', { d })}
              className="rounded-lg bg-white/8 py-1.5 font-mono hover:bg-white/15">{d === 0 ? '0' : (d > 0 ? `+${d}` : d)}</button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-fg2">{t('th_sub_size')}</span>
          <div className="flex gap-1.5">
            {[['A−', 0.85], ['A', 1], ['A+', 1.25], ['A++', 1.5]].map(([lbl, v]) => (
              <button key={lbl as string} onClick={() => onCmd('sub-scale', { v })}
                className={`rounded-lg px-2.5 py-1 ${(props['sub-scale'] || 1) === v ? 'bg-acc text-acc-ink' : 'bg-white/8 hover:bg-white/15'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-fg2">{t('th_sub_pos')}</span>
          <div className="flex gap-1.5">
            {[['↓', 96], ['•', 92], ['↑', 82]].map(([lbl, v]) => (
              <button key={lbl as string} onClick={() => onCmd('sub-pos', { v })}
                className={`rounded-lg px-3 py-1 ${(props['sub-pos'] ?? 94) === v ? 'bg-acc text-acc-ink' : 'bg-white/8 hover:bg-white/15'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-fg2">{t('th_sub_color')}</span>
          <div className="flex gap-2">
            {colors.map((c) => (
              <button key={c} aria-label={c} onClick={() => { onColor(c); onCmd('sub-style', { 'sub-color': c }); }}
                className={`size-6 rounded-full ring-2 ${subColor === c ? 'ring-acc scale-110' : 'ring-white/25'}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AudioPictureDrawer({ t, props, autoDuck, spdif, vsr, night, aspect, tone, onCmd, onNight }: {
  t: TranslateFn; props: TheaterPropsMap; autoDuck: boolean; spdif: boolean; vsr: boolean; night: boolean; aspect: string; tone: string;
  onCmd: (cmd: string, a?: Record<string, unknown>) => Promise<any>; onNight: () => void;
}) {
  const audios = (props['track-list'] || []).filter((x) => x.type === 'audio');
  return (
    <div className="space-y-3 text-[clamp(12.5px,0.9vw,14px)]">
      <div className="space-y-1.5">
        <div className="font-semibold text-fg2">{t('th_audio_tracks')}</div>
        {audios.map((x) => {
          const fmt = formatAudioTrack(x, 'en');
          return (
            <button key={x.id} onClick={() => onCmd('aid', { id: x.id })}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-start ring-1 ${x.selected ? 'bg-acc/15 text-acc ring-acc' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}>
              <span className="truncate">{fmt.langInfo.flag} {fmt.primary}</span>
              <span className="flex-none font-mono text-[10px] text-fg3">{fmt.metaLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <ToggleRow label={t('th_night')} on={night} onClick={onNight} />
        <ToggleRow label={t('th_auto_duck')} on={autoDuck} onClick={() => onCmd('duck', { on: !autoDuck })} />
        <ToggleRow label={t('th_spdif')} on={spdif} onClick={() => onCmd('spdif', { on: !spdif })} />
        <ToggleRow label="RTX VSR" on={vsr} onClick={() => onCmd('vsr-toggle', { on: !vsr })} />
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="font-semibold text-fg2">{t('th_aspect')}</div>
        <div className="flex flex-wrap gap-1">
          {([
            ['fit', t('th_aspect_fit')],
            ['fill', t('th_aspect_fill')],
            ['zoom', t('th_zoom')],
            ['stretch', t('th_aspect_stretch')],
            ['16:9', '16:9'],
            ['4:3', '4:3'],
            ['21:9', '21:9'],
          ] as const).map(([m, lbl]) => (
            <button key={m} onClick={() => onCmd('aspect', { mode: m })}
              className={`rounded px-2 py-1 text-[11px] font-medium ${aspect === m ? 'bg-acc text-acc-ink' : 'bg-white/8 hover:bg-white/15'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="pt-1 font-semibold text-fg2">{t('th_tone_map')}</div>
        <div className="grid grid-cols-3 gap-1">
          {['spline', 'bt.2390', 'hable', 'mobius', 'reinhard', 'clip'].map((m) => (
            <button key={m} onClick={() => onCmd('tone-mapping', { mode: m })}
              className={`rounded py-1 font-mono text-[11px] ${tone === m ? 'bg-acc text-acc-ink' : 'bg-white/8 hover:bg-white/15'}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-fg2">{t('th_picture_eq')}</span>
          <button onClick={() => onCmd('eq-reset')} className="text-acc hover:underline">{t('th_reset')}</button>
        </div>
        {(['brightness', 'contrast', 'saturation', 'gamma'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-16 truncate text-fg2">{k === 'gamma' ? 'Gamma' : t(`th_${k}` as Key)}</span>
            <input type="range" min={-30} max={30} value={props[k] || 0} onChange={(e) => onCmd('eq', { [k]: +e.target.value })} className="flex-1 accent-acc" />
            <span dir="ltr" className="w-7 text-end font-mono text-[10.5px]">{props[k] || 0}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ToolsDrawer({ t, speed, loopA, loopB, sleepMin, onCmd, onSleep, lang }: {
  t: TranslateFn; speed: number; loopA: number | null; loopB: number | null; sleepMin: number;
  onCmd: (cmd: string, a?: Record<string, unknown>) => Promise<any>; onSleep: (m: number) => void; lang: Lang;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="space-y-3 text-[clamp(12.5px,0.9vw,14px)]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="font-semibold text-fg2">{t('th_speed')}</div>
        <div className="grid grid-cols-4 gap-1">
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5].map((v) => (
            <button key={v} onClick={() => onCmd('speed', { v })}
              className={`rounded py-1 font-mono text-[11px] ${Math.abs(speed - v) < 0.01 ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>{v}×</button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="font-semibold text-fg2">{t('th_ab_loop')}</div>
        <div className="grid grid-cols-3 gap-1">
          <button onClick={() => onCmd('ab-loop', { step: 'a' })} className="rounded bg-white/8 py-1.5 hover:bg-white/15">
            A {loopA != null ? `(${fmt(loopA)})` : ''}
          </button>
          <button onClick={() => onCmd('ab-loop', { step: 'b' })} className="rounded bg-white/8 py-1.5 hover:bg-white/15">
            B {loopB != null ? `(${fmt(loopB)})` : ''}
          </button>
          <button onClick={() => onCmd('ab-loop', { step: 'clear' })} className="rounded bg-white/8 py-1.5 text-red-300 hover:bg-red-500/20">
            {t('th_reset')}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
        <div className="font-semibold text-fg2">{t('th_sleep_timer')}</div>
        <div className="grid grid-cols-5 gap-1">
          {[0, 15, 30, 45, 60].map((m) => (
            <button key={m} onClick={() => onSleep(m)}
              className={`rounded py-1 font-mono text-[11px] ${sleepMin === m ? 'bg-acc text-acc-ink font-bold' : 'bg-white/8 hover:bg-white/15'}`}>
              {m === 0 ? t('th_off') : `${m}m`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const fmtNoteClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rem = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}` : `${m}:${String(rem).padStart(2, '0')}`;
};

export function PartyDrawer({
  t, messages, votes, partyState, voiceState, notes = [], queue = [], readyState, curPos = 0,
  onSendChat, onReact, onVote, onResumeAnyway, onBrb, onVoiceMode, onVoicePtt, onOpenSources,
  onReadyCheck, onCountdown, onRemoteControl, onAddNote, onDelNote, onSeekTo, onQueueCmd,
}: {
  t: TranslateFn;
  messages: ChatMsg[];
  votes: VoteItem[];
  partyState?: PartyView | null;
  voiceState?: VoiceStateView | null;
  notes?: PartyNoteItem[];
  queue?: PlayQueueItem[];
  readyState?: ReadyStateView | null;
  curPos?: number;
  onSendChat: (text: string) => void;
  onReact: (emoji: string) => void;
  onVote: (id: string) => void;
  onResumeAnyway?: () => void;
  onBrb?: (durationSec: number) => void;
  onVoiceMode?: (mode: 'off' | 'ptt' | 'open') => void;
  onVoicePtt?: (down: boolean) => void;
  onOpenSources?: () => void;
  onReadyCheck?: () => void;
  onCountdown?: () => void;
  onRemoteControl?: (mode: 'host' | 'guest' | 'all', holderId?: string | null) => void;
  onAddNote?: (text: string) => void;
  onDelNote?: (id: string) => void;
  onSeekTo?: (sec: number) => void;
  onQueueCmd?: (op: 'play' | 'move' | 'remove' | 'clear', a?: Record<string, unknown>) => void;
}) {
  const [subTab, setSubTab] = useState<'chat' | 'notes' | 'queue'>('chat');
  const [text, setText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [simTargetId, setSimTargetId] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simList, setSimList] = useState<{ id: string; type: string; name: string; poster: string | null }[]>([]);
  const emojis = ['🔥', '😂', '🤯', '👏', '❤️', '🍿'];
  const isHost = partyState?.role === 'host';
  const guestPeers = (partyState?.peers || []).filter((p) => p.id !== 'host');
  const wc = partyState?.control;

  const loadSimilar = async (v: VoteItem) => {
    if (simTargetId === v.id) { setSimTargetId(null); return; }
    setSimTargetId(v.id);
    setSimLoading(true);
    try {
      const res = await (window as any).majlis?.invoke('social:similar', {
        id: v.id,
        type: v.type || 'movie',
        excludeIds: votes.map((x) => x.id),
      });
      setSimList(Array.isArray(res) ? res : []);
    } catch {
      setSimList([]);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/6 p-0.5">
        {([
          ['chat', t('party_chat')],
          ['notes', `${t('party_notes')} (${notes.length})`],
          ['queue', `${t('party_queue_tab')} (${queue.length})`],
        ] as const).map(([id, lbl]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`truncate rounded-lg px-2 py-1 text-[11px] font-semibold transition ${subTab === id ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {partyState?.mismatch ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] text-amber-200 ring-1 ring-amber-400/35">
          <span className="truncate font-semibold">
            {partyState.mismatch.reason === 'edition'
              ? t('th_mismatch_edition', { host: partyState.mismatch.hostEdition || '', local: partyState.mismatch.localEdition || '' })
              : t('th_mismatch_dur')}
          </span>
          {onOpenSources ? (
            <button onClick={onOpenSources} className="flex-none rounded-full bg-amber-400/25 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-100 hover:bg-amber-400/40">
              {t('th_mismatch_switch')}
            </button>
          ) : null}
        </div>
      ) : null}

      {subTab === 'chat' ? (
        <>
          {partyState?.peers?.length ? (
            <div className="space-y-1.5 rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
              <div className="flex flex-wrap items-center gap-1.5">
                {partyState.peers.map((p) => {
                  const sp = p.cacheSpeed && p.cacheSpeed > 0 ? `${(p.cacheSpeed / (1024 * 1024)).toFixed(1)} MB/s` : '';
                  const readyPeer = readyState?.peers?.find((rp) => rp.id === p.id || rp.name === p.name);
                  return (
                    <span key={p.id} dir="ltr" className={`inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[11px] ring-1 ${p.stalled ? 'ring-red-400/50 text-red-200' : 'ring-white/10 text-fg'}`}>
                      <span className={`size-1.5 rounded-full ${p.stalled ? 'bg-red-400' : (p.cache || 0) < 3 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      <span className="max-w-[90px] truncate">{p.name || p.id}</span>
                      <span className="font-mono text-[10px] text-fg2">{p.stalled ? '⏳' : `${Math.round(p.cache || 0)}s`}{sp ? ` · ${sp}` : ''}</span>
                      {readyPeer?.ready ? <span className="text-emerald-400 font-bold">✓</span> : null}
                    </span>
                  );
                })}
              </div>
              {partyState.waitingFor?.length && isHost && onResumeAnyway ? (
                <button onClick={onResumeAnyway} className="w-full rounded-full bg-acc py-1 text-[11px] font-bold text-acc-ink hover:brightness-110">
                  {t('th_resume_anyway')}
                </button>
              ) : null}
            </div>
          ) : null}

          {isHost && (onReadyCheck || onCountdown || onRemoteControl) ? (
            <div className="space-y-1.5 rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
              {(onReadyCheck || onCountdown) ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {onReadyCheck ? (
                    <button onClick={onReadyCheck} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-fg hover:bg-acc hover:text-acc-ink">
                      {t('party_ready_check')}
                    </button>
                  ) : null}
                  {onCountdown ? (
                    <button onClick={onCountdown} className="rounded-lg bg-acc/20 px-2 py-1 text-[11px] font-bold text-acc hover:bg-acc hover:text-acc-ink">
                      {t('party_countdown')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {onRemoteControl ? (
                <div className="space-y-1">
                  <div className="text-[10.5px] font-semibold text-fg2">{t('party_remote_label')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      ['host', t('party_remote_host')],
                      ['guest', t('party_remote_friend')],
                      ['all', t('party_remote_all')],
                    ] as const).map(([m, lbl]) => (
                      <button key={m} onClick={() => onRemoteControl(m, m === 'guest' ? (wc?.holderId || guestPeers[0]?.id || null) : null)}
                        className={`truncate rounded-lg px-1.5 py-1 text-[10.5px] font-semibold ${(wc?.mode || 'host') === m ? 'bg-acc text-acc-ink' : 'bg-white/10 text-fg2 hover:bg-white/15'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {wc?.mode === 'guest' && guestPeers.length ? (
                    <select value={wc.holderId || ''} onChange={(e) => onRemoteControl('guest', e.target.value)}
                      className="w-full rounded-lg bg-black/40 px-2 py-1 text-[11px] text-fg ring-1 ring-white/15">
                      {guestPeers.map((gp) => (
                        <option key={gp.id} value={gp.id}>{gp.name || gp.id}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : wc ? (
            <div className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-fg2 ring-1 ring-white/10">
              {t('party_remote_holder', { name: wc.mode === 'all' ? t('party_remote_all') : wc.mode === 'guest' ? (wc.holderName || t('party_remote_friend')) : t('party_remote_host') })}
            </div>
          ) : null}

          {onBrb ? (
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10">
              <span className="font-semibold text-fg2">{t('th_brb_btn')}</span>
              <div className="flex items-center gap-1">
                {[120, 300, 600].map((sec) => (
                  <button key={sec} onClick={() => onBrb(sec)} className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-fg hover:bg-acc hover:text-acc-ink">
                    {sec / 60}m
                  </button>
                ))}
                {partyState?.brb?.active ? (
                  <button onClick={() => onBrb(0)} className="rounded-full bg-acc px-2 py-0.5 text-[11px] font-bold text-acc-ink">
                    {t('th_brb_back')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {voiceState && onVoiceMode ? (
            <div className="space-y-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold text-fg2">{voiceState.micOpen ? `🎙 ${t('th_talking')}` : '🎙'}</span>
                <div className="flex gap-1">
                  {(['off', 'ptt', 'open'] as const).map((m) => (
                    <button key={m} onClick={() => onVoiceMode(m)}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${voiceState.mode === m ? 'bg-acc text-acc-ink' : 'bg-white/10 text-fg2 hover:bg-white/15'}`}>
                      {m === 'off' ? t('th_voice_off') : m === 'open' ? t('th_voice_open') : 'PTT'}
                    </button>
                  ))}
                </div>
              </div>
              {voiceState.mode === 'ptt' && onVoicePtt ? (
                <button
                  onMouseDown={() => onVoicePtt(true)}
                  onMouseUp={() => onVoicePtt(false)}
                  onMouseLeave={() => onVoicePtt(false)}
                  onTouchStart={() => onVoicePtt(true)}
                  onTouchEnd={() => onVoicePtt(false)}
                  className={`w-full select-none rounded-full py-1 text-[11px] font-bold transition ${voiceState.micOpen ? 'bg-emerald-400 text-black' : 'bg-white/10 text-fg hover:bg-white/20'}`}>
                  {t('th_voice_ptt', { k: voiceState.pttKey || 'CapsLock' })}
                </button>
              ) : null}
              <FriendVoiceMixer label={t('party_voice_mixer')} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {emojis.map((e) => (
              <button key={e} onClick={() => onReact(e)} className="rounded-full bg-white/8 px-2 py-1 text-sm transition hover:scale-110 hover:bg-white/15">{e}</button>
            ))}
          </div>
          {votes.length ? (
            <div className="space-y-1 rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
              <div className="font-semibold text-fg2">{t('vote_title')}</div>
              {votes.map((v) => (
                <div key={v.id} className="space-y-1 rounded bg-black/30 px-2 py-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate font-medium">{v.name}</span>
                    <div className="flex flex-none items-center gap-1">
                      <button onClick={() => loadSimilar(v)} className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-fg2 hover:bg-white/20">
                        {t('vote_similar')}
                      </button>
                      <button onClick={() => onVote(v.id)} className="rounded-full bg-acc/20 px-2 py-0.5 text-[11px] font-semibold text-acc hover:bg-acc hover:text-acc-ink">
                        {v.votes} · {t('vote_cast')}
                      </button>
                    </div>
                  </div>
                  {simTargetId === v.id ? (
                    <div className="space-y-1 border-t border-white/10 pt-1">
                      {simLoading ? <div className="text-[10.5px] text-fg3">{t('th_sub_searching')}</div> : !simList.length ? (
                        <div className="text-[10.5px] text-fg3">{t('vote_similar_empty')}</div>
                      ) : simList.slice(0, 4).map((alt) => (
                        <div key={alt.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span dir="auto" className="truncate text-fg2">{alt.name}</span>
                          <button
                            onClick={async () => {
                              await (window as any).majlis?.invoke('vote:nominate', { id: alt.id, type: alt.type || 'movie', name: alt.name, poster: alt.poster || null }).catch(() => {});
                              setSimList((cur) => cur.filter((x) => x.id !== alt.id));
                            }}
                            className="flex-none rounded-full bg-acc/20 px-2 py-0.5 text-[10px] font-bold text-acc hover:bg-acc hover:text-acc-ink"
                          >
                            + {t('vote_nominate')}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="min-h-[84px] flex-1 space-y-1.5 overflow-y-auto rounded-lg bg-black/30 p-2.5 ring-1 ring-white/10">
            {!messages.length ? <div className="py-4 text-center text-fg3">{t('party_chat_ph')}</div> : null}
            {messages.map((m, i) => (
              <div key={m.id || i} className="leading-relaxed">
                <span className="font-bold" style={{ color: m.accent || 'var(--c-acc)' }}>{m.from || 'Host'}: </span>
                <span dir="auto" className="text-fg">{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSendChat(text.trim()); setText(''); } }} className="flex gap-1.5">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('party_chat_ph')}
              className="flex-1 rounded-full bg-white/8 px-3 py-1.5 text-xs ring-1 ring-white/15 focus:ring-acc" />
            <button className="rounded-full bg-acc px-3 py-1.5 text-xs font-semibold text-acc-ink">{t('send_msg')}</button>
          </form>
        </>
      ) : null}

      {subTab === 'notes' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (noteText.trim() && onAddNote) { onAddNote(noteText.trim()); setNoteText(''); }
            }}
            className="flex gap-1.5"
          >
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t('party_note_ph')}
              className="min-w-0 flex-1 rounded-full bg-white/8 px-3 py-1.5 text-xs ring-1 ring-white/15 focus:ring-acc" />
            <button type="submit" className="rounded-full bg-acc px-3 py-1.5 text-xs font-semibold text-acc-ink">
              {t('party_note_add')} · {fmtNoteClock(curPos)}
            </button>
          </form>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-lg bg-black/30 p-2 ring-1 ring-white/10">
            {!notes.length ? (
              <div className="py-6 text-center text-fg3">{t('party_notes_empty')}</div>
            ) : notes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                <button onClick={() => onSeekTo?.(n.t)} className="min-w-0 flex-1 text-start hover:text-acc">
                  <div className="flex items-center gap-1.5 text-[10.5px]">
                    <span dir="ltr" className="rounded bg-acc/20 px-1.5 py-0.5 font-mono font-bold text-acc">{fmtNoteClock(n.t)}</span>
                    <span className="truncate font-bold" style={{ color: n.accent || 'var(--c-acc)' }}>{n.authorName}</span>
                  </div>
                  <div dir="auto" className="mt-0.5 break-words text-[11.5px] text-fg">{n.text}</div>
                </button>
                {onDelNote ? (
                  <button onClick={() => onDelNote(n.id)} className="mt-0.5 text-fg3 hover:text-red-400">
                    <Icon n="x" s={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {subTab === 'queue' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg2">{t('queue_n', { n: queue.length })}</span>
            {queue.length && onQueueCmd ? (
              <button onClick={() => onQueueCmd('clear')} className="rounded-full bg-white/8 px-2.5 py-0.5 text-[10.5px] text-fg2 hover:bg-red-500/20 hover:text-red-300">
                {t('queue_clear')}
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-lg bg-black/30 p-2 ring-1 ring-white/10">
            {!queue.length ? (
              <div className="py-6 text-center text-fg3">{t('queue_empty')}</div>
            ) : queue.map((q, idx) => (
              <div key={q.key} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                <span className="font-mono text-[10.5px] text-fg3">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate font-semibold text-fg">{q.name}</div>
                  {q.epLabel ? <div dir="ltr" className="font-mono text-[10px] text-acc">{q.epLabel}</div> : null}
                </div>
                {onQueueCmd ? (
                  <div className="flex flex-none items-center gap-1">
                    <button onClick={() => onQueueCmd('play', { key: q.key })} className="rounded-full bg-acc px-2 py-0.5 text-[10.5px] font-bold text-acc-ink">
                      ▶
                    </button>
                    <button disabled={idx === 0} onClick={() => onQueueCmd('move', { from: idx, to: idx - 1 })} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] disabled:opacity-30">↑</button>
                    <button disabled={idx === queue.length - 1} onClick={() => onQueueCmd('move', { from: idx, to: idx + 1 })} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] disabled:opacity-30">↓</button>
                    <button onClick={() => onQueueCmd('remove', { key: q.key })} className="text-fg3 hover:text-red-400">
                      <Icon n="x" s={12} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FriendVoiceMixer({ label }: { label: string }) {
  const [peers, setPeers] = useState<{ idx: number; id: string; name: string; gain: number }[]>(
    () => (window as any).__majlisVoice?.getPeers?.() || []
  );
  useEffect(() => {
    const refresh = () => setPeers((window as any).__majlisVoice?.getPeers?.() || []);
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, []);
  if (!peers.length) return null;
  return (
    <div className="space-y-1 border-t border-white/10 pt-1.5">
      <div className="text-[10.5px] font-semibold text-fg2">{label}</div>
      {peers.map((p) => (
        <label key={`${p.idx}-${p.id}`} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="max-w-[110px] truncate text-fg">{p.name}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={p.gain}
            onChange={(e) => {
              const g = Number(e.target.value);
              (window as any).__majlisVoice?.setPeerGain?.(p.idx, g, p.id);
              setPeers((cur) => cur.map((x) => (x.idx === p.idx ? { ...x, gain: g } : x)));
            }}
            className="w-24 accent-acc"
          />
          <span dir="ltr" className="w-9 text-end font-mono text-[10px] text-fg2">{Math.round(p.gain * 100)}%</span>
        </label>
      ))}
    </div>
  );
}

export function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between py-0.5 text-start">
      <span className="text-fg">{label}</span>
      <span className={`grid h-4 w-8 place-items-center rounded-full px-0.5 transition ${on ? 'bg-acc' : 'bg-white/15'}`}>
        <span className={`size-3 rounded-full bg-bg transition ${on ? 'translate-x-2 rtl:-translate-x-2' : '-translate-x-2 rtl:translate-x-2'}`} />
      </span>
    </button>
  );
}

export function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'acc' | 'ok' }) {
  const cls = tone === 'acc' ? 'bg-acc/20 text-acc' : tone === 'ok' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-fg2';
  return <span dir="ltr" className={`rounded px-1.5 py-0.5 font-mono text-[clamp(10.5px,0.75vw,12px)] font-semibold ${cls}`}>{children}</span>;
}
