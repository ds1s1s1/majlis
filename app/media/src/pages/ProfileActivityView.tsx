import { useState } from 'react';
import { ArrowLeft, Activity, Star } from 'lucide-react';
import { useHost, useNav } from '../host';
import { fmtLocaleDate } from '../i18n';
import type { ProfileActivityItem } from '../data/profileMockSeed';
import { Img } from '../ui/Img';

type Filter = 'all' | 'watched' | 'rated' | 'lists' | 'social';

export function ProfileActivityView({
  activity,
  alias,
  onBack,
}: {
  activity: ProfileActivityItem[];
  alias: string;
  onBack: () => void;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';
  const [filter, setFilter] = useState<Filter>('all');

  const items = filter === 'all' ? activity : activity.filter((x) => x.kind === filter);
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: ar ? 'الكل' : 'All' },
    { id: 'watched', label: ar ? 'مشاهَد' : 'Watched' },
    { id: 'rated', label: ar ? 'تقييمات' : 'Rated' },
    { id: 'lists', label: ar ? 'القوائم' : 'Lists' },
    { id: 'social', label: ar ? 'المجتمع' : 'Social' },
  ];

  return (
    <div className="mx-auto max-w-[920px] px-6 pb-20 pt-28">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--pf-card-border)] pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)] px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:border-[var(--pf-accent)]"
          >
            <ArrowLeft size={14} className="flip" />
            <span>{ar ? 'رجوع للملف' : 'Back to profile'}</span>
          </button>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--pf-text)]">
            <Activity size={18} className="text-[var(--pf-accent)]" />
            <span>{ar ? `نشاط ${alias}` : `${alias}'s Activity`}</span>
          </h1>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                filter === f.id ? 'bg-[var(--pf-accent)] text-[var(--pf-accent-fg)]' : 'bg-white/8 text-[var(--pf-text-muted)] hover:text-[var(--pf-text)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {items.length ? (
        <div className="space-y-2.5">
          {items.map((a) => (
            <div key={a.id} className="flex items-center gap-3.5 rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)] p-3">
              <button
                type="button"
                onClick={() => {
                  if (a.mediaId && !a.mediaId.startsWith('demo-')) nav.open({ kind: 'title', type: a.mediaType || 'movie', id: a.mediaId });
                }}
                className="h-16 w-11 flex-none overflow-hidden rounded-lg bg-black/30"
              >
                <Img srcs={[a.poster]} className="h-full w-full object-cover" />
              </button>
              <div className="min-w-0 flex-1">
                <div dir="auto" className="truncate text-sm font-semibold text-[var(--pf-text)]">{a.title}</div>
                <div className="mt-0.5 text-xs text-[var(--pf-text-muted)]">{a.detail}</div>
              </div>
              {a.score ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pf-accent)]/15 px-2.5 py-1 font-mono text-xs font-bold text-[var(--pf-accent)]">
                  <Star size={12} fill="currentColor" />{a.score}
                </span>
              ) : null}
              <span className="text-[11px] text-[var(--pf-text-muted)]">{fmtLocaleDate(a.at, lang)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)] py-16 text-center text-sm text-[var(--pf-text-muted)]">
          {ar ? 'لا يوجد نشاط في هذا القسم بعد.' : 'No activity matching this filter yet.'}
        </div>
      )}
    </div>
  );
}
