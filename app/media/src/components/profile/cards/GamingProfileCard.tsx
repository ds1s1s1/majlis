import { Gamepad2 } from 'lucide-react';
import { useHost } from '../../../host';
import { ProfileCardShell } from './ProfileCardShell';

export function GamingProfileCard({
  platform,
  gamertag,
  isMe,
  hideTitle,
  transparent,
  onEdit,
}: {
  platform: 'steam' | 'xbox' | 'playstation' | 'minecraft';
  gamertag: string;
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onEdit: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const label = { steam: 'Steam', xbox: 'Xbox', playstation: 'PlayStation', minecraft: 'Minecraft' }[platform];

  return (
    <ProfileCardShell
      icon={<Gamepad2 size={14} />}
      title={ar ? 'بطاقة الألعاب' : 'GAMING CARD'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={isMe ? <button type="button" onClick={onEdit} className="text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">{ar ? 'تعديل' : 'Edit'}</button> : null}
    >
      <div className="flex items-center gap-3 rounded-xl bg-black/25 p-3 ring-1 ring-white/6">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--pf-accent)]/15 text-[var(--pf-accent)]">
          <Gamepad2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[var(--pf-text-muted)]">{label}</div>
          <div dir="ltr" className="truncate font-mono text-sm font-semibold text-[var(--pf-text)]">{gamertag || 'PlayerOne'}</div>
        </div>
      </div>
    </ProfileCardShell>
  );
}
