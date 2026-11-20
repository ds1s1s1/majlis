import { useMemo, useState } from 'react';
import { useCalendar, useCaps, type CalEntry } from '../api';
import { useHost, useNav, useT } from '../host';
import { fmtLocaleDate, fmtLocaleTime } from '../i18n';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
type Src = 'library' | 'tv' | 'anime' | 'movies' | 'trakt';
const CAL_SRC_KEY = 'majlis:cal-sources-v1';
const VALID_SRCS = new Set<Src>(['library', 'tv', 'anime', 'movies', 'trakt']);
const readCalSources = (): Src[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAL_SRC_KEY) || 'null');
    if (Array.isArray(parsed)) {
      const clean = parsed.filter((x): x is Src => VALID_SRCS.has(x));
      if (clean.length) return clean;
    }
  } catch {}
  return ['library', 'anime'];
};

// A month of releases: episodes of the shows in the library, plus whatever sources are switched on
export function Calendar() {
  const t = useT(), nav = useNav(), { lang } = useHost();
  const caps = useCaps().data;
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [src, setSrc] = useState<Src[]>(readCalSources);
  const [day, setDay] = useState<string | null>(ymd(new Date()));
  const from = month.getTime(), to = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
  const q = useCalendar(from, to, src);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEntry[]>();
    for (const e of q.data || []) m.set(e.day, [...(m.get(e.day) || []), e]);
    return m;
  }, [q.data]);
  // weeks start on Saturday in Arabic, Monday otherwise
  const first = lang === 'ar' ? 6 : 1;
  const lead = (month.getDay() - first + 7) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { month: 'long', year: 'numeric' });
  const wk = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { weekday: 'short' });
  const weekdays = Array.from({ length: 7 }, (_, i) => wk.format(new Date(2024, 0, 7 + ((first + i) % 7)))); // 2024-01-07 is a Sunday (getDay 0)
  const today = ymd(new Date());
  const sources: { id: Src; label: string; on: boolean }[] = [
    { id: 'library', label: t('cal_library'), on: true }, { id: 'tv', label: t('cal_tv'), on: true }, { id: 'anime', label: t('anime'), on: true },
    { id: 'movies', label: t('cal_movies'), on: !!caps?.tmdb }, { id: 'trakt', label: 'Trakt', on: !!caps?.trakt },
  ];
  const toggle = (s: Src) => setSrc((l) => {
    const next = l.includes(s) ? l.filter((x) => x !== s) : [...l, s];
    try { localStorage.setItem(CAL_SRC_KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  const openE = (e: CalEntry) => { if (/^(tt|kitsu:|anilist:|tmdb:)/.test(e.id)) nav.open({ kind: 'title', type: e.type, id: e.id }); };
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const list = day ? byDay.get(day) || [] : [];

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="me-2 text-3xl font-bold">{fmt.format(month)}</h1>
        <button aria-label="previous" onClick={() => shift(-1)} className="grid size-9 place-items-center rounded-full bg-white/8 hover:bg-white/15"><Icon n="chevl" s={18} className="flip" /></button>
        <button aria-label="next" onClick={() => shift(1)} className="grid size-9 place-items-center rounded-full bg-white/8 hover:bg-white/15"><Icon n="chevr" s={18} className="flip" /></button>
        <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setDay(today); }} className="rounded-full bg-white/8 px-4 py-1.5 text-sm hover:bg-white/15">{t('today')}</button>
        <span className="flex-1" />
        {sources.filter((s) => s.on).map((s) => (
          <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={src.includes(s.id)}
            className={`rounded-full px-4 py-1.5 text-[13px] transition ${src.includes(s.id) ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}>{s.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {weekdays.map((w) => <div key={w} className="px-2 pb-1 text-xs text-fg3">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const k = ymd(d), es = byDay.get(k) || [];
          return (
            <button key={k} onClick={() => setDay(k)}
              className={`flex min-h-[118px] flex-col gap-1 rounded-xl p-2 text-start ring-1 transition ${day === k ? 'bg-white/8 ring-acc' : 'bg-bg1 ring-line hover:bg-white/5'}`}>
              <span className={`grid size-7 place-items-center rounded-full font-mono text-sm ${k === today ? 'bg-acc text-acc-ink' : 'text-fg2'}`}>{d.getDate()}</span>
              {es.slice(0, 3).map((e, j) => (
                <span key={j} className="flex items-center gap-1.5 truncate text-[11px] text-fg2">
                  <span className="size-1.5 flex-none rounded-full" style={{ background: DOT[e.source] }} />
                  <span dir="auto" className="truncate">{e.name}</span>
                </span>
              ))}
              {es.length > 3 ? <span className="text-[11px] text-fg3">+{es.length - 3}</span> : null}
            </button>
          );
        })}
      </div>
      {q.isFetching ? <div className="skel mt-6 h-24 rounded-xl" /> : null}
      {day && list.length ? (
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold">{fmtLocaleDate(day + 'T12:00', lang, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {list.map((e, i) => (
              <button key={i} onClick={() => openE(e)} className="flex items-center gap-3 rounded-xl bg-bg1 p-2.5 text-start ring-1 ring-line transition hover:bg-white/5">
                <span className="h-[72px] w-12 flex-none overflow-hidden rounded-md bg-bg3"><Img srcs={[e.poster]} className="h-full w-full object-cover" /></span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-semibold">{e.name}</span>
                  <span className="block truncate text-xs text-fg2">
                    {e.season != null ? <span className="font-mono">S{e.season}E{e.episode} </span> : e.episode != null ? <span className="font-mono">{t('episode_n', { n: e.episode })} </span> : null}
                    <span dir="auto">{e.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg3">{fmtLocaleTime(e.at, lang, { hour: 'numeric', minute: '2-digit' })}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const DOT: Record<string, string> = { library: 'var(--c-acc)', tv: '#7aa2f7', anime: '#f7768e', movies: '#9ece6a', trakt: '#ed1c24' };
