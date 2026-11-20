import { Film } from 'lucide-react';
import { useHost, useNav } from '../../../host';
import { ProfileCardShell } from './ProfileCardShell';

export function TrackerProfileCard({
  name,
  handle,
  connected,
  filmsCount,
  ratingsCount,
  publicLists,
  hideTitle,
  transparent,
}: {
  name: string;
  handle: string;
  connected: boolean;
  filmsCount: number;
  ratingsCount: number;
  publicLists: number;
  hideTitle?: boolean;
  transparent?: boolean;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell
      icon={<Film size={14} />}
      title={name.toUpperCase()}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/8 text-[var(--pf-text-muted)]'}`}>
          {connected ? (ar ? 'متصل' : 'Connected') : (ar ? 'غير متصل' : 'Not linked')}
        </span>
      }
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-[#00E054]/20 font-mono text-sm font-bold text-[#00E054]">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {handle ? (
            <div dir="ltr" className="truncate text-sm font-semibold text-[var(--pf-text)]">@{handle}</div>
          ) : (
            <div className="truncate text-sm font-semibold text-[var(--pf-text-muted)]">{ar ? 'غير مربوط بعد' : 'Not linked yet'}</div>
          )}
          <div className="text-[11px] text-[var(--pf-text-muted)]">{name}</div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-black/25 p-2.5 text-center ring-1 ring-white/5">
          <div dir="ltr" className="font-mono text-sm font-bold text-[var(--pf-text)]">{filmsCount}</div>
          <div className="text-[10.5px] text-[var(--pf-text-muted)]">{ar ? 'أفلام' : 'Films'}</div>
        </div>
        <div className="rounded-xl bg-black/25 p-2.5 text-center ring-1 ring-white/5">
          <div dir="ltr" className="font-mono text-sm font-bold text-[var(--pf-text)]">{ratingsCount}</div>
          <div className="text-[10.5px] text-[var(--pf-text-muted)]">{ar ? 'تقييمات' : 'Ratings'}</div>
        </div>
      </div>

      <div className="mb-3 text-center text-[11px] text-[var(--pf-text-muted)]">
        {publicLists > 0 ? (ar ? `${publicLists} قوائم عامة` : `${publicLists} public lists shared`) : (ar ? 'لا توجد قوائم عامة مشاركة بعد.' : 'No public lists shared yet.')}
      </div>

      <button
        type="button"
        onClick={() => nav.go('settings')}
        className="w-full rounded-xl border border-[var(--pf-card-border)] bg-white/5 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]/60"
      >
        {ar ? 'إدارة الربط' : 'Manage connection'}
      </button>
    </ProfileCardShell>
  );
}
