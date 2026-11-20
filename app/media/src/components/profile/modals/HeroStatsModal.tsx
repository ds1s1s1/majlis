import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { HeroStatKey, UserProfileState } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

const ALL_METRICS: { key: HeroStatKey; en: string; ar: string }[] = [
  { key: 'timeWatched', en: 'TIME WATCHED', ar: 'وقت المشاهدة' },
  { key: 'episodes', en: 'EPISODES', ar: 'الحلقات' },
  { key: 'movies', en: 'MOVIES', ar: 'الأفلام' },
  { key: 'reviews', en: 'REVIEWS', ar: 'المراجعات' },
  { key: 'ratings', en: 'RATINGS', ar: 'التقييمات' },
  { key: 'lists', en: 'LISTS', ar: 'القوائم' },
  { key: 'games', en: 'GAMES', ar: 'الألعاب' },
  { key: 'books', en: 'BOOKS', ar: 'الكتب' },
  { key: 'friends', en: 'FRIENDS', ar: 'الأصدقاء' },
  { key: 'groups', en: 'GROUPS', ar: 'المجموعات' },
];

function metricPreview(k: HeroStatKey, p: UserProfileState): string {
  switch (k) {
    case 'timeWatched': return `${Math.floor((p.stats.timeWatchedMinutes || 0) / 1440)}d+`;
    case 'episodes': return String(p.stats.episodesCount || 0);
    case 'movies': return String(p.stats.moviesCount || 0);
    case 'reviews': return String(p.stats.reviewsCount || 0);
    case 'ratings': return String(p.ratings.length);
    case 'lists': return String(p.lists.length);
    case 'games': return String(p.favorites.games.length);
    case 'books': return String(p.favorites.books.length);
    case 'friends': return String(p.friends.length);
    case 'groups': return String(p.groups.length);
  }
}

export function HeroStatsModal({
  open,
  profile,
  onSave,
  onClose,
}: {
  open: boolean;
  profile: UserProfileState;
  onSave: (stats: [HeroStatKey, HeroStatKey, HeroStatKey, HeroStatKey]) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [picked, setPicked] = useState<HeroStatKey[]>(profile.showcase.heroStats);

  useEffect(() => {
    if (open) setPicked([...profile.showcase.heroStats]);
  }, [open, profile.showcase.heroStats]);

  const toggle = (k: HeroStatKey) => {
    if (picked.includes(k)) setPicked(picked.filter((x) => x !== k));
    else if (picked.length < 4) setPicked([...picked, k]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= picked.length) return;
    const next = [...picked];
    [next[idx], next[target]] = [next[target], next[idx]];
    setPicked(next);
  };

  const valid = picked.length === 4;

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'إحصائيات الشريط العلوي' : 'Hero statistics'}
      subtitle={ar ? `اختر 4 إحصائيات بالضبط (${picked.length}/4)` : `Choose exactly 4 stats (${picked.length}/4)`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (valid) {
                onSave(picked as [HeroStatKey, HeroStatKey, HeroStatKey, HeroStatKey]);
                onClose();
              }
            }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {picked.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {picked.map((k, i) => {
              const meta = ALL_METRICS.find((m) => m.key === k)!;
              return (
                <div key={k} className="flex items-center gap-1.5 rounded-full bg-[var(--pf-accent)]/15 px-3 py-1 text-xs font-semibold text-[var(--pf-accent)]">
                  <span>{ar ? meta.ar : meta.en}</span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30"><ArrowUp size={11} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1} className="disabled:opacity-30"><ArrowDown size={11} /></button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          {ALL_METRICS.map((m) => {
            const on = picked.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                className={`flex items-center justify-between rounded-xl border p-3 text-start transition ${
                  on ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                <div>
                  <div className="text-[11px] font-bold tracking-wider text-white/65">{ar ? m.ar : m.en}</div>
                  <div className="mt-0.5 font-mono text-base font-bold text-white">{metricPreview(m.key, profile)}</div>
                </div>
                <span className={`grid size-5 place-items-center rounded-full ${on ? 'bg-[var(--pf-accent)] text-[#12100E]' : 'bg-white/10 text-transparent'}`}>
                  <Check size={12} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </ModalFrame>
  );
}
