import { Lock, Plus, Users, UserMinus } from 'lucide-react';
import { useHost, useNav } from '../../../host';
import type { ProfileFriend } from '../../../data/profileMockSeed';
import { ProfileCardShell } from './ProfileCardShell';

export function FriendsCard({
  friends,
  isMe,
  visibility,
  hideTitle,
  transparent,
  onAddFriend,
  onRemoveFriend,
}: {
  friends: ProfileFriend[];
  isMe: boolean;
  visibility: 'everyone' | 'friends' | 'only_me';
  hideTitle?: boolean;
  transparent?: boolean;
  onAddFriend: () => void;
  onRemoveFriend?: (id: string) => void;
}) {
  const { lang } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';
  const canSee = isMe || visibility !== 'only_me';

  return (
    <ProfileCardShell
      icon={<Users size={14} />}
      title={ar ? 'الأصدقاء' : 'FRIENDS'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        <div className="flex items-center gap-2">
          <span dir="ltr" className="font-mono text-[11px] text-[var(--pf-text-muted)]">{friends.length} / 50</span>
          {isMe ? (
            <button
              type="button"
              onClick={onAddFriend}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]"
            >
              <Plus size={12} />{ar ? 'إضافة' : 'Add'}
            </button>
          ) : null}
        </div>
      }
    >
      {!canSee ? (
        <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-[var(--pf-text-muted)]">
          <Lock size={13} />
          <span>{ar ? 'قائمة الأصدقاء خاصة.' : 'Friends list is private.'}</span>
        </div>
      ) : friends.length ? (
        <div className="space-y-2">
          {friends.slice(0, 8).map((f) => (
            <div key={f.id} className="group flex items-center gap-2.5 rounded-xl bg-black/20 p-2 ring-1 ring-white/5 hover:ring-white/15">
              <button
                type="button"
                onClick={() => !f.id.startsWith('demo-') && nav.open({ kind: 'friend', id: f.id })}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
              >
                <div className="relative size-8 flex-none">
                  <div
                    className="grid size-8 place-items-center overflow-hidden rounded-full text-xs font-bold"
                    style={{ background: f.avatar?.startsWith('data:') ? undefined : f.accent, color: '#12100E' }}
                  >
                    {f.avatar?.startsWith('data:') ? <img src={f.avatar} alt="" className="h-full w-full object-cover" /> : f.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full ring-2 ring-[#181613]"
                    style={{ background: f.online ? '#5CB874' : '#6B7280' }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-xs font-semibold text-[var(--pf-text)]">{f.name}</div>
                  <div dir="auto" className="truncate text-[11px] text-[var(--pf-text-muted)]">{f.statusText}</div>
                </div>
              </button>
              {isMe && onRemoveFriend ? (
                <button
                  type="button"
                  onClick={() => onRemoveFriend(f.id)}
                  title={ar ? 'إزالة' : 'Remove'}
                  className="opacity-0 text-[var(--pf-text-muted)] hover:text-red-400 group-hover:opacity-100"
                >
                  <UserMinus size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--pf-text-muted)]">
          {ar ? 'أضف أصدقاء ليظهروا هنا.' : 'Add friends to see them here.'}
        </p>
      )}
    </ProfileCardShell>
  );
}
