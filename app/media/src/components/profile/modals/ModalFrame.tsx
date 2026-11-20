import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useHost } from '../../../host';

export function ModalFrame({
  open,
  title,
  subtitle,
  onClose,
  maxWidth = 'max-w-xl',
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { lang } = useHost();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`flex max-h-[88vh] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-[var(--pf-card-border,rgba(255,255,255,0.1))] bg-[#161310] text-[var(--pf-text,#F2EFE9)] shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-white/55">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-white/8 text-white/75 transition hover:bg-white/15 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2.5 border-t border-white/10 bg-black/25 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
