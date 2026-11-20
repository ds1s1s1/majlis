import { ChevronRight, List } from 'lucide-react';
import { useHost, useNav } from '../../../host';
import type { ProfileList } from '../../../data/profileMockSeed';
import { Img } from '../../../ui/Img';
import { ProfileCardShell } from './ProfileCardShell';

export function ListsCard({
  lists,
  featuredIds,
  isMe,
  hideTitle,
  transparent,
  onChooseLists,
  onViewAll,
}: {
  lists: ProfileList[];
  featuredIds: string[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onChooseLists: () => void;
  onViewAll: () => void;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';

  const featured = featuredIds
    .map((id) => lists.find((l) => l.id === id))
    .filter((x): x is ProfileList => !!x);
  const shown = (featured.length ? featured : lists).slice(0, 3);

  return (
    <ProfileCardShell
      icon={<List size={14} />}
      title={ar ? 'قوائمي' : 'MY LISTS'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        <button type="button" onClick={onViewAll} className="inline-flex items-center gap-0.5 text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">
          <span>{ar ? 'عرض الكل' : 'View all'}</span>
          <ChevronRight size={13} className="flip" />
        </button>
      }
    >
      {shown.length ? (
        <div className="space-y-5">
          {shown.map((list) => (
            <div key={list.id}>
              <div className="mb-1 flex items-center gap-2">
                <h3 dir="auto" className="truncate text-sm font-semibold text-[var(--pf-text)]">{list.name}</h3>
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-[var(--pf-text-muted)]">
                  {list.items.length}
                </span>
              </div>
              {list.description ? <p dir="auto" className="mb-2.5 text-xs text-[var(--pf-text-muted)]">{list.description}</p> : null}
              <div className="grid grid-cols-5 gap-2.5">
                {list.items.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { if (!item.id.startsWith('demo-')) nav.open({ kind: 'title', type: item.type, id: item.id }); }}
                    className="group text-start"
                  >
                    <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/10 transition group-hover:scale-[1.03] group-hover:ring-[var(--pf-accent)]">
                      <Img srcs={[item.poster]} className="h-full w-full object-cover" />
                    </div>
                    <div dir="auto" className="mt-1 truncate text-[11px] text-[var(--pf-text-muted)] group-hover:text-[var(--pf-text)]">
                      {item.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--pf-text-muted)]">{ar ? 'لا توجد قوائم بعد.' : 'No lists created yet.'}</p>
      )}
      {isMe ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onChooseLists}
            className="rounded-full border border-[var(--pf-card-border)] bg-white/5 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]/60"
          >
            {ar ? 'اختيار القوائم' : 'Choose lists'}
          </button>
        </div>
      ) : null}
    </ProfileCardShell>
  );
}
