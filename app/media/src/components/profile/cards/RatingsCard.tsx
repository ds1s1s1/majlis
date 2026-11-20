import { ChevronRight, Star, Upload } from 'lucide-react';
import { useHost, useNav } from '../../../host';
import type { ProfileRating } from '../../../data/profileMockSeed';
import { Img } from '../../../ui/Img';
import { ProfileCardShell } from './ProfileCardShell';

export function RatingsCard({
  ratings,
  isMe,
  hideTitle,
  transparent,
  onImportRatings,
  onViewAll,
}: {
  ratings: ProfileRating[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onImportRatings: () => void;
  onViewAll: () => void;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';

  const avg = ratings.length ? (ratings.reduce((a, b) => a + b.score, 0) / ratings.length).toFixed(1) : '0.0';
  const buckets = Array.from({ length: 10 }, (_, i) => ratings.filter((r) => Math.round(r.score) === i + 1).length);
  const maxBucket = Math.max(1, ...buckets);

  return (
    <ProfileCardShell
      icon={<Star size={14} />}
      title={ar ? 'التقييمات' : 'RATINGS'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        <>
          {isMe ? (
            <button type="button" onClick={onImportRatings} className="inline-flex items-center gap-1 text-xs text-[var(--pf-accent)] hover:underline">
              <Upload size={12} />
              <span>{ar ? 'استيراد' : 'Import'}</span>
            </button>
          ) : null}
          <button type="button" onClick={onViewAll} className="inline-flex items-center gap-0.5 text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">
            <span>{ar ? 'عرض الكل' : 'View all'}</span>
            <ChevronRight size={13} className="flip" />
          </button>
        </>
      }
    >
      {/* Summary strip + 10-bar rating distribution histogram */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-black/25 p-3 ring-1 ring-white/6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-[var(--pf-accent)]/15 text-[var(--pf-accent)]">
            <Star size={20} fill="currentColor" />
          </div>
          <div>
            <div dir="ltr" className="font-mono text-xl font-bold leading-none text-[var(--pf-text)]">{avg}</div>
            <div className="mt-1 text-[11px] text-[var(--pf-text-muted)]">
              {ar ? `${ratings.length} تقييم` : `${ratings.length} ratings`}
            </div>
          </div>
        </div>

        <div className="flex h-11 items-end gap-1" aria-label="Rating histogram">
          {buckets.map((count, i) => {
            const pct = Math.max(12, Math.round((count / maxBucket) * 100));
            return (
              <div
                key={i}
                title={`${i + 1}/10: ${count}`}
                className="group flex w-3 flex-col items-center justify-end h-full"
              >
                <div
                  className="w-full rounded-t transition-all group-hover:brightness-125"
                  style={{
                    height: `${count === 0 ? 10 : pct}%`,
                    background: count === 0 ? 'rgba(255,255,255,0.1)' : 'var(--pf-accent)',
                    opacity: count === 0 ? 0.5 : 0.45 + (i / 18),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 5-column rated poster row */}
      {ratings.length ? (
        <div className="grid grid-cols-5 gap-2.5">
          {ratings.slice(0, 5).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { if (!r.id.startsWith('demo-') && !r.id.startsWith('imp-')) nav.open({ kind: 'title', type: r.type, id: r.id }); }}
              className="group relative text-start"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/10 transition group-hover:scale-[1.03] group-hover:ring-[var(--pf-accent)]">
                <Img srcs={[r.poster]} className="h-full w-full object-cover" />
                <span
                  dir="ltr"
                  className="absolute end-1.5 top-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold shadow"
                  style={{ background: 'rgba(18,16,14,0.88)', color: 'var(--pf-accent)' }}
                >
                  ★ {r.score}
                </span>
              </div>
              <div dir="auto" className="mt-1 truncate text-[11px] text-[var(--pf-text-muted)] group-hover:text-[var(--pf-text)]">
                {r.title}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--pf-text-muted)]">{ar ? 'لا توجد تقييمات بعد.' : 'No ratings yet.'}</p>
      )}
    </ProfileCardShell>
  );
}
