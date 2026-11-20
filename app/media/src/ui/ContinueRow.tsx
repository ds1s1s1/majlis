import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Row } from './Row';
import { Img } from './Img';
import { Icon } from './Icon';
import { cin, quickplay, useContinue, useMeta, useUpcoming, metahub, episodeOf, type LibItem } from '../api';
import { rememberFlip, useHost, useNav, useT } from '../host';
import { fmtLocaleDate } from '../i18n';
import { useSettingsStore } from '../settings/useSettingsStore';

const fmtMmSs = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// Continue watching: configurable wide/card/poster cards + instant or prompted resume + Rewind + Split Upcoming row
export function ContinueRow() {
  const { data } = useContinue();
  const upcomingQ = useUpcoming();
  const t = useT();
  const cardStyle = useSettingsStore((s) => s.data.sources.cwCardStyle);
  const splitUpcoming = useSettingsStore((s) => s.data.sources.cwSplitUpcoming);
  const cardWidth = cardStyle === 'poster' ? 168 : cardStyle === 'card' ? 252 : 330;
  const cardHeight = cardStyle === 'poster' ? 280 : cardStyle === 'card' ? 176 : 212;
  const upcoming = splitUpcoming ? (upcomingQ.data || []) : [];
  if (!data?.length && !upcoming.length) return null;

  return (
    <>
      {data?.length ? (
        <Row
          title={t('continue_watching')}
          items={data}
          width={cardWidth}
          height={cardHeight}
          render={(it) => <Card it={it} style={cardStyle} />}
        />
      ) : null}
      {upcoming.length ? (
        <Row
          title={t('upcoming_row')}
          items={upcoming}
          width={cardWidth}
          height={cardHeight}
          render={(it) => <Card it={it} style={cardStyle} upcoming />}
        />
      ) : null}
    </>
  );
}

function Card({ it, style, upcoming = false }: { it: LibItem; style: 'wide' | 'card' | 'poster'; upcoming?: boolean }) {
  const nav = useNav(), t = useT(), { lang, toast } = useHost(), qc = useQueryClient();
  const clickBehavior = useSettingsStore((s) => s.data.sources.cwClickBehavior);
  const resumePrompt = useSettingsStore((s) => s.data.sources.cwResumePrompt);
  const [promptOpen, setPromptOpen] = useState(false);

  const s = it.state, ep = episodeOf(s.video_id);
  const { data: meta } = useMeta(it.type === 'series' ? 'series' : null, it.type === 'series' ? it._id : null);
  const pct = s.duration ? Math.min(100, (s.timeOffset / s.duration) * 100) : 0;
  const left = s.duration && s.timeOffset > 0 ? Math.max(1, Math.round((s.duration - s.timeOffset) / 60000)) : null;
  const extraCount = useMemo(() => {
    const hintCount = Number(it.behaviorHints?.newEpisodes || it.behaviorHints?.unwatched || 0);
    if (hintCount > 0) return hintCount;
    if (!meta?.videos?.length) return 0;
    const now = Date.now(), watched = new Set(s.majlisWatched || []);
    const aired = meta.videos.filter((v) => (v.season ?? 0) > 0 && (!v.released || Date.parse(v.released) <= now));
    const unwatched = aired.filter((v) => !watched.has(v.id) && (ep ? v.season! > ep.season || (v.season === ep.season && (v.episode ?? 0) > ep.episode) : true));
    return unwatched.length;
  }, [meta?.videos, s.majlisWatched, ep, it.behaviorHints]);

  const launchPlay = async (posOverride?: number) => {
    toast(t('playing'));
    const r = await quickplay({
      type: it.type, id: it._id, videoId: s.video_id || it._id,
      pos: posOverride !== undefined ? posOverride : (s.timeOffset > 1 ? s.timeOffset : undefined),
      card: { name: it.name, seriesName: it.name, poster: it.poster || null, background: meta?.background || null, logo: meta?.logo || null },
    });
    if (!r.ok && !r.cancelled && r.error) toast(r.error);
  };

  const openDetails = (el?: HTMLElement | null) => {
    rememberFlip(el || undefined, it.poster);
    nav.open({ kind: 'title', type: it.type, id: it._id });
  };

  const handlePrimaryClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (clickBehavior === 'details' || (clickBehavior === 'details_upcoming' && upcoming) || upcoming) {
      openDetails(e.currentTarget);
      return;
    }
    if (resumePrompt && s.timeOffset > 15000) {
      setPromptOpen(true);
      return;
    }
    launchPlay();
  };

  const rewind = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await cin('lib-rewind', { id: it._id });
    qc.invalidateQueries({ queryKey: ['continue'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };

  const dismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await cin('continue-dismiss', { id: it._id });
    qc.invalidateQueries({ queryKey: ['continue'] });
  };

  const relDate = s.videoReleased ? fmtLocaleDate(s.videoReleased, lang) : '';
  const widthCls = style === 'poster' ? 'w-[168px]' : style === 'card' ? 'w-[252px]' : 'w-[330px]';
  const aspectCls = style === 'poster' ? 'aspect-[2/3]' : 'aspect-video';

  return (
    <div className={`group relative ${widthCls}`}>
      <div className={`relative ${aspectCls} w-full overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition duration-300 ease-out-soft group-hover:ring-2 group-hover:ring-acc/70`}>
        <button onClick={handlePrimaryClick} className="block h-full w-full text-start">
          {style === 'poster' ? (
            <Img srcs={[it.poster, metahub('poster', it._id), meta?.background]} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          ) : (
            <Img srcs={[metahub('background', it._id), meta?.background, it.poster]} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          )}
          <div className="shade-b absolute inset-0" />
          {style !== 'poster' ? (
            <Img srcs={[metahub('logo', it._id), meta?.logo]} className="absolute bottom-8 start-4 max-h-14 max-w-[58%] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,.8)]"
              fallback={<div className="absolute bottom-8 start-4 max-w-[70%] truncate text-lg font-bold">{it.name}</div>} />
          ) : null}
          <div className="absolute inset-x-3 bottom-2.5 flex items-center gap-1.5 text-[11px] text-fg2">
            {upcoming && relDate ? (
              <span className="rounded bg-acc/90 px-1.5 py-0.5 font-semibold text-acc-ink">{relDate}</span>
            ) : ep ? (
              <span dir="ltr" className="rounded bg-black/55 px-1.5 py-0.5 font-mono font-semibold text-fg backdrop-blur">
                ▶ S{ep.season}E{ep.episode}{style === 'wide' ? ` · ${t('up_next')}` : ''}
              </span>
            ) : (
              <span className="rounded bg-black/55 px-1.5 py-0.5 font-semibold text-fg backdrop-blur">▶ {t('resume')}</span>
            )}
            {!upcoming && left && style !== 'poster' ? <span className="ms-auto">{t('left', { n: left })}</span> : null}
          </div>
          {!upcoming ? (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15"><div className="h-full bg-acc" style={{ width: `${Math.max(pct, 4)}%` }} /></div>
          ) : null}
          <span className="absolute inset-0 m-auto grid size-12 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
            <Icon n={upcoming ? 'calendar' : 'play'} s={22} />
          </span>
        </button>
        {extraCount > 0 ? (
          <span dir="ltr" className="pointer-events-none absolute end-3 top-2.5 rounded-full bg-acc px-2 py-0.5 font-mono text-[11px] font-bold text-acc-ink shadow">
            +{extraCount}
          </span>
        ) : null}
        {!upcoming ? (
          <div className="absolute start-2.5 top-2.5 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button onClick={dismiss} title={t('dismiss')} aria-label={t('dismiss')}
              className="grid size-7 place-items-center rounded-full bg-black/70 text-fg2 backdrop-blur transition hover:bg-red-500/90 hover:text-white">
              <Icon n="x" s={14} />
            </button>
            <button onClick={rewind} title={t('cw_rewind')} aria-label={t('cw_rewind')}
              className="grid size-7 place-items-center rounded-full bg-black/70 text-fg2 backdrop-blur transition hover:bg-acc hover:text-acc-ink">
              <RotateCcw size={13} />
            </button>
          </div>
        ) : null}
      </div>
      <button onClick={(e) => openDetails(e.currentTarget.previousElementSibling as HTMLElement)}
        className="mt-2 block w-full truncate text-start text-[13px] text-fg2 hover:text-fg">{it.name}</button>

      {promptOpen ? (
        <div onClick={() => setPromptOpen(false)} className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm fade-in">
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-acc/35 bg-bg1/96 p-5 shadow-2xl">
            <h3 className="text-base font-bold text-fg">{t('cw_resume_title')}</h3>
            <p dir="auto" className="mt-1 truncate text-xs text-fg2">{it.name}{ep ? ` · S${ep.season}E${ep.episode}` : ''}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => { setPromptOpen(false); launchPlay(s.timeOffset); }}
                className="flex items-center justify-center gap-2 rounded-full bg-acc px-4 py-2.5 text-xs font-bold text-acc-ink hover:brightness-110"
              >
                <Icon n="play" s={14} />{t('cw_resume_at', { t: fmtMmSs(s.timeOffset) })}
              </button>
              <button
                onClick={() => { setPromptOpen(false); launchPlay(0); }}
                className="flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-xs font-semibold text-fg hover:bg-white/15"
              >
                <RotateCcw size={13} />{t('cw_start_over')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
