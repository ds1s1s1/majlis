import { ChevronRight, Clock, Lock } from 'lucide-react';
import { useHost, useNav } from '../../../host';
import type { ProfileActivityItem } from '../../../data/profileMockSeed';
import { Img } from '../../../ui/Img';
import { ProfileCardShell } from './ProfileCardShell';

function relTime(ts: number, ar: boolean): string {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return ar ? 'الآن' : 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return ar ? `منذ ${min} د` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return ar ? `منذ ${hr} س` : `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return ar ? `منذ ${days} ي` : `${days}d ago`;
}

export function RecentActivityCard({
  activity,
  allowed,
  hideTitle,
  transparent,
  onViewAll,
}: {
  activity: ProfileActivityItem[];
  allowed: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onViewAll: () => void;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell
      icon={<Clock size={14} />}
      title={ar ? 'النشاط الأخير' : 'RECENT ACTIVITY'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        allowed ? (
          <button type="button" onClick={onViewAll} className="inline-flex items-center gap-0.5 text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">
            <span>{ar ? 'عرض الكل' : 'View all'}</span>
            <ChevronRight size={13} className="flip" />
          </button>
        ) : null
      }
    >
      {!allowed ? (
        <div className="flex items-center justify-center gap-2 py-5 text-xs text-[var(--pf-text-muted)]">
          <Lock size={14} />
          <span>{ar ? 'نشاط المشاهدة مخفي للخصوصية.' : 'Watch activity is kept private.'}</span>
        </div>
      ) : activity.length ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {activity.slice(0, 5).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                if (a.mediaId && !a.mediaId.startsWith('demo-')) {
                  nav.open({ kind: 'title', type: a.mediaType || 'movie', id: a.mediaId });
                }
              }}
              className="group text-start"
            >
              <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/10 transition group-hover:scale-[1.03] group-hover:ring-[var(--pf-accent)]">
                <Img srcs={[a.poster]} className="h-full w-full object-cover" />
              </div>
              <div dir="auto" className="mt-1 truncate text-[11px] font-medium text-[var(--pf-text)]">{a.title}</div>
              <div className="truncate text-[10px] text-[var(--pf-text-muted)]">{relTime(a.at, ar)}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-5 text-center text-xs text-[var(--pf-text-muted)]">{ar ? 'لا يوجد نشاط مسجّل بعد.' : 'No recent activity yet.'}</p>
      )}
    </ProfileCardShell>
  );
}
