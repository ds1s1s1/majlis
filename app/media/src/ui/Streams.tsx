import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, useStreams, useTorrentHealth, play, type Item, type Ranked, type TorrentHealthEntry, type Type } from '../api';
import { useHost, useT } from '../host';
import { useSettingsStore } from '../settings/useSettingsStore';
import { Icon } from './Icon';
import { TorrentHealthDot } from './TorrentHealthDot';

const res = (h: number) => (h >= 2160 ? '4K' : h ? `${h}p` : null);
const parseResBound = (lbl: string) => (/4k|2160/i.test(lbl) ? 2160 : /1080/i.test(lbl) ? 1080 : /720/i.test(lbl) ? 720 : 0);

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'acc' | 'ok' | 'bad' }) {
  const c = { plain: 'bg-white/8 text-fg2', acc: 'bg-acc/15 text-acc', ok: 'bg-emerald-400/12 text-emerald-300', bad: 'bg-red-500/15 text-red-300' }[tone];
  return <span dir="ltr" className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${c}`}>{children}</span>;
}

// One ranked copy: what it is (resolution, HDR, audio, codec, bitrate, swarm) and where it comes from
function StreamRow({ r, best, health, layout, showReleaseName, showFullDesc, onPlay, onParty, onDownload }: {
  r: Ranked; best: boolean; health?: TorrentHealthEntry; layout: 'condensed' | 'cards'; showReleaseName: boolean; showFullDesc: boolean;
  onPlay: () => void; onParty: () => void; onDownload: () => void;
}) {
  const t = useT(), f = r.facts, s = r.stream;
  const textLines = [s.title, s.description, s.name].filter(Boolean).join('\n').split('\n').filter((l) => l.trim());
  const rel = s.behaviorHints?.filename || textLines[0] || '';
  const body = showFullDesc ? textLines.join('\n') : (showReleaseName ? rel : (textLines[1] || textLines[0] || ''));
  const audioLabel = [f.audio ? f.audio.toUpperCase() : '', f.channels || ''].filter(Boolean).join(' ');
  const isCards = layout === 'cards';
  return (
    <div className={`group/s flex items-start rounded-xl transition hover:bg-white/6 ${isCards ? 'border border-white/8 bg-white/[0.03]' : ''} ${best ? 'bg-acc/8 ring-1 ring-acc/40' : ''}`}>
    <button onClick={onPlay} title={t('watch_solo')} className={`group flex min-w-0 flex-1 items-start gap-3.5 text-start ${isCards ? 'p-3.5' : 'px-3 py-2.5'}`}>
      <span className={`mt-0.5 grid flex-none place-items-center rounded-full transition ${isCards ? 'size-9' : 'size-8'} ${best ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 group-hover:bg-fg group-hover:text-bg'}`}><Icon n="play" s={isCards ? 16 : 14} /></span>
      <span className="min-w-0 flex-1">
        <span className="mb-1 flex flex-wrap items-center gap-1.5">
          <TorrentHealthDot r={r} health={health} />
          {best ? <Badge tone="acc">{t('best_source')}</Badge> : null}
          {res(f.height) ? <Badge>{res(f.height)}</Badge> : null}
          {f.dv ? <Badge>DV</Badge> : f.hdr ? <Badge>HDR</Badge> : null}
          {f.remux ? <Badge>REMUX</Badge> : null}
          {audioLabel ? <Badge>{audioLabel}</Badge> : null}
          {f.codec ? <Badge>{f.codec.toUpperCase()}</Badge> : null}
          {f.bitrateMbps ? <Badge>{`${f.bitrateMbps.toFixed(1)} Mbps`}</Badge> : null}
          {f.instant ? <Badge tone="ok">⚡ {t('instant')}</Badge> : f.cached ? <Badge tone="ok">⚡ {t('cached')}</Badge> : null}
          {f.torrent && !f.instant && f.seeders != null ? <Badge tone={f.seeders > 0 ? 'plain' : 'bad'}>{f.seeders > 0 ? `👤 ${f.seeders}` : t('dead')}</Badge> : null}
          {f.sizeGb ? <Badge>{f.sizeGb >= 1 ? `${f.sizeGb.toFixed(1)} GB` : `${Math.round(f.sizeGb * 1024)} MB`}</Badge> : null}
          {f.rough ? <Badge tone="bad">{t('rough')}</Badge> : null}
          {f.arabicDub ? <Badge tone="acc">{t('arabic_dub')}</Badge> : f.arabic ? <Badge tone="acc">{t('arabic_sub')}</Badge> : null}
          <span className="ms-auto truncate text-[11px] text-fg3">{r.addon.name}</span>
        </span>
        <span className={`${showFullDesc ? 'whitespace-pre-line' : isCards ? 'clamp-2' : 'truncate'} block break-all text-[12.5px] leading-snug text-fg2`} dir="ltr">{body}</span>
        {isCards && showReleaseName && showFullDesc && rel && !body.includes(rel) ? (
          <span dir="ltr" className="mt-1 block truncate font-mono text-[11px] text-fg3">{rel}</span>
        ) : null}
      </span>
    </button>
    <div className="my-auto flex flex-none items-center gap-1 pe-2">
      <button onClick={onParty} title={t('start_party')} aria-label={t('start_party')} className="grid size-9 place-items-center rounded-full text-fg3 opacity-0 transition hover:bg-acc/20 hover:text-acc group-hover/s:opacity-100 focus-visible:opacity-100">
        <Icon n="users" s={17} />
      </button>
      {r.stream.url || r.stream.infoHash ? (
        <button onClick={onDownload} title={t('download')} aria-label={t('download')} className="grid size-9 place-items-center rounded-full text-fg3 opacity-0 transition hover:bg-white/10 hover:text-fg group-hover/s:opacity-100 focus-visible:opacity-100">
          <Icon n="download" s={18} />
        </button>
      ) : null}
    </div>
    </div>
  );
}

type Filter = 'all' | 'instant' | '4k' | '1080p' | 'hdr' | 'arabic';
type Sort = 'best' | 'res' | 'size' | 'seeds';

// Every addon's copies of one video, best first. `auto`: play the best as soon as they're in.
export function StreamList({ type, meta, videoId, label, auto, party, pos, onStarted }: {
  type: Type; meta: Item; videoId: string; label?: string; auto?: boolean; party?: boolean; pos?: number; onStarted?: () => void;
}) {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const srcSettings = useSettingsStore((s) => s.data.sources);
  const q = useStreams(type, videoId, undefined, auto ? 3000 : 0);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('best');
  const [presetId, setPresetId] = useState<string>(srcSettings.activeFilterId || 'default');
  useEffect(() => { setPresetId(srcSettings.activeFilterId || 'default'); }, [srcSettings.activeFilterId]);
  const [showUntrusted, setShowUntrusted] = useState(false);
  const eligible = (q.data?.streams || []).filter((r) => r.score > -1e5);
  const trustedList = eligible.filter((r) => r.trusted !== false);
  const hiddenList = eligible.filter((r) => r.trusted === false);
  const list = showUntrusted ? [...trustedList, ...hiddenList] : (trustedList.length ? trustedList : eligible);
  const activePreset = useMemo(() => srcSettings.savedFilters.find((f) => f.id === presetId) || null, [srcSettings.savedFilters, presetId]);
  const visible = useMemo(() => {
    const minH = activePreset && activePreset.id !== 'default' ? parseResBound(activePreset.minRes) : 0;
    const maxH = activePreset && activePreset.id !== 'default' ? parseResBound(activePreset.maxRes) : 0;
    const exKws = activePreset && activePreset.id !== 'default'
      ? activePreset.excludeKeywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
      : [];
    const f = list.filter((r) => {
      if (srcSettings.sourceMode === 'debrid' && !r.facts.instant && !r.facts.cached) return false;
      if (srcSettings.sourceMode === 'p2p' && (!r.facts.torrent || r.facts.instant || r.facts.cached)) return false;
      if (activePreset && activePreset.id !== 'default') {
        if (minH > 0 && r.facts.height < minH) return false;
        if (maxH > 0 && r.facts.height > maxH) return false;
        if (activePreset.hdrOnly && !r.facts.hdr && !r.facts.dv) return false;
        if (activePreset.audioCodec !== 'any' && !r.facts.audio.toLowerCase().includes(activePreset.audioCodec.toLowerCase())) return false;
        if (activePreset.maxSizeGb > 0 && r.facts.sizeGb && r.facts.sizeGb > activePreset.maxSizeGb) return false;
        if (exKws.length) {
          const hay = [r.stream.name, r.stream.title, r.stream.description, r.stream.behaviorHints?.filename].filter(Boolean).join(' ').toLowerCase();
          if (exKws.some((kw) => hay.includes(kw))) return false;
        }
      }
      if (filter === 'instant') return r.facts.instant || r.facts.cached;
      if (filter === '4k') return r.facts.height >= 2160;
      if (filter === '1080p') return r.facts.height === 1080;
      if (filter === 'hdr') return r.facts.hdr || r.facts.dv;
      if (filter === 'arabic') return r.facts.arabic || r.facts.arabicDub || !!r.facts.subLangs?.includes('ar');
      return true;
    });
    if (sort === 'best') return f;
    return [...f].sort((a, b) => sort === 'res'
      ? (b.facts.height - a.facts.height) || (b.score - a.score)
      : sort === 'size'
        ? ((b.facts.sizeGb || 0) - (a.facts.sizeGb || 0)) || (b.score - a.score)
        : ((b.facts.seeders || 0) - (a.facts.seeders || 0)) || (b.score - a.score));
  }, [list, filter, sort, activePreset, srcSettings.sourceMode]);
  const shown = useMemo(() => visible.slice(0, 60), [visible]);
  const healthMap = useTorrentHealth(shown).data || {};

  const fired = useRef<string | null>(null);
  const start = (r: Ranked, asParty = !!party) => {
    toast(asParty ? t('party_started') : t('playing'));
    play({ type, videoId, meta, stream: r.stream, label, pos, addon: r.addon.url, party: asParty }).catch((e: Error) => toast(e.message));
    onStarted?.();
  };
  const download = async (r: Ranked) => {
    await cin('dl-add', { meta: { id: meta.id, name: meta.name, poster: meta.poster }, type, videoId, label, stream: r.stream });
    qc.invalidateQueries({ queryKey: ['downloads'] });
    toast(t('dl_started'));
  };
  const autoKey = auto ? `${videoId}:${party ? 'party' : 'solo'}` : null;
  useEffect(() => {
    if (!autoKey || fired.current === autoKey || !list.length) return;
    fired.current = autoKey;
    start(list[0], !!party);
  }, [autoKey, list.length, party]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return (
    <div className="space-y-2.5">
      {auto ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-acc/30 bg-acc/10 px-3.5 py-2.5 text-xs font-semibold text-acc">
          <span className="size-2 animate-pulse rounded-full bg-acc" />
          <span>{t('th_comparing')}</span>
        </div>
      ) : null}
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="skel h-[68px] rounded-xl" />)}
    </div>
  );
  if (!list.length) return <p className="rounded-xl bg-white/4 p-5 text-sm text-fg2">{t('no_sources')}</p>;

  const filters: { id: Filter; text: string }[] = [
    { id: 'all', text: t('filter_all') },
    { id: 'instant', text: `⚡ ${t('instant')}` },
    { id: '4k', text: '4K' },
    { id: '1080p', text: '1080p' },
    { id: 'hdr', text: 'HDR' },
    { id: 'arabic', text: t('arabic_sub') },
  ];
  const sorts: { id: Sort; text: string }[] = [
    { id: 'best', text: t('sort_best') },
    { id: 'res', text: t('sort_res') },
    { id: 'size', text: t('sort_size') },
    { id: 'seeds', text: t('sort_seeds') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((x) => (
            <button key={x.id} onClick={() => setFilter(x.id)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${filter === x.id ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>
              {x.text}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 rounded-full bg-white/6 p-0.5">
          {sorts.map((x) => (
            <button key={x.id} onClick={() => setSort(x.id)} className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${sort === x.id ? 'bg-fg text-bg' : 'text-fg2 hover:text-fg'}`}>
              {x.text}
            </button>
          ))}
        </div>
      </div>
      {srcSettings.savedFilters.some((f) => f.id !== 'default') ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {srcSettings.savedFilters.map((sf) => (
            <button
              key={sf.id}
              onClick={() => setPresetId(sf.id)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${presetId === sf.id ? 'border-acc bg-acc/20 text-acc' : 'border-white/10 bg-white/5 text-fg2 hover:bg-white/10'}`}
            >
              {sf.id === 'default' ? t('filter_preset_none') : sf.name}
            </button>
          ))}
        </div>
      ) : null}
      {!visible.length ? <p className="rounded-xl bg-white/4 p-5 text-sm text-fg2">{t('empty_list')}</p> : (
        <div className={srcSettings.pickerLayout === 'cards' ? 'space-y-2' : 'space-y-1'}>
          {shown.map((r, i) => (
            <StreamRow
              key={i}
              r={r}
              best={r === list[0] && r.tier > 0}
              health={r.stream.infoHash ? healthMap[String(r.stream.infoHash).toLowerCase()] : undefined}
              layout={srcSettings.pickerLayout}
              showReleaseName={srcSettings.showReleaseName}
              showFullDesc={srcSettings.showFullDescriptions}
              onPlay={() => start(r, false)}
              onParty={() => start(r, true)}
              onDownload={() => download(r)}
            />
          ))}
        </div>
      )}
      {hiddenList.length > 0 && trustedList.length > 0 ? (
        <button onClick={() => setShowUntrusted((s) => !s)} className="text-xs text-fg3 hover:text-fg2">
          {t('show_untrusted', { n: hiddenList.length })}
        </button>
      ) : null}
    </div>
  );
}
