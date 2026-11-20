import type { ReactNode } from 'react';

export function ProfileCardShell({
  icon,
  title,
  hideTitle,
  transparent,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  hideTitle?: boolean;
  transparent?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--pf-card-border)] p-4 ${transparent ? 'backdrop-blur-md' : ''}`}
      style={{ background: 'var(--pf-card)' }}
    >
      {!hideTitle ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--pf-text-muted)]">
            <span className="text-[var(--pf-accent)]">{icon}</span>
            <span>{title}</span>
          </div>
          {action ? <div className="flex items-center gap-2 text-xs">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
