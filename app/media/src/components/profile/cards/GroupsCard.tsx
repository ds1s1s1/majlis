import { Globe, Lock, Plus, UsersRound } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileGroup } from '../../../data/profileMockSeed';
import { ProfileCardShell } from './ProfileCardShell';

export function GroupsCard({
  groups,
  isMe,
  hideTitle,
  transparent,
  onCreateGroup,
}: {
  groups: ProfileGroup[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onCreateGroup: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell
      icon={<UsersRound size={14} />}
      title={ar ? 'المجموعات' : 'GROUPS'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        isMe ? (
          <button
            type="button"
            onClick={onCreateGroup}
            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]"
          >
            <Plus size={12} />{ar ? 'إنشاء' : 'Create'}
          </button>
        ) : null
      }
    >
      {groups.length ? (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-xl bg-black/20 p-2.5 ring-1 ring-white/6">
              <span
                className="grid size-9 flex-none place-items-center rounded-xl text-sm font-bold text-[#12100E]"
                style={{ background: g.color || 'var(--pf-accent)' }}
              >
                {g.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div dir="auto" className="truncate text-xs font-semibold text-[var(--pf-text)]">{g.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--pf-text-muted)]">
                  <span>{ar ? `${g.membersCount} أعضاء` : `${g.membersCount} members`}</span>
                  <span className="inline-flex items-center gap-1 rounded bg-white/8 px-1.5 py-0.2 text-[10px]">
                    {g.privacy === 'public' ? <Globe size={10} /> : <Lock size={10} />}
                    {g.privacy === 'public' ? (ar ? 'عامة' : 'Public') : (ar ? 'بدعوة' : 'Invite')}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 py-4 text-center">
          <p className="text-xs text-[var(--pf-text-muted)]">{ar ? 'أنشئ مجموعة للمشاهدة واللعب معاً.' : 'Create a group to watch and share together.'}</p>
          {isMe ? (
            <button
              type="button"
              onClick={onCreateGroup}
              className="rounded-full border border-[var(--pf-card-border)] bg-white/5 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:border-[var(--pf-accent)]/60"
            >
              {ar ? 'إنشاء مجموعة' : 'Find a group'}
            </button>
          ) : null}
        </div>
      )}
    </ProfileCardShell>
  );
}
