import { Music, Plus } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileMusicArtist } from '../../../data/profileMockSeed';
import { ProfileCardShell } from './ProfileCardShell';

export function MusicFavoritesCard({
  items,
  isMe,
  hideTitle,
  transparent,
  onEdit,
}: {
  items: ProfileMusicArtist[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onEdit: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell
      icon={<Music size={14} />}
      title={ar ? 'الموسيقى' : 'MUSIC'}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        isMe && items.length ? (
          <button type="button" onClick={onEdit} className="text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">
            {ar ? 'تعديل' : 'Edit'}
          </button>
        ) : null
      }
    >
      {items.length ? (
        <div className="flex flex-wrap gap-4">
          {items.slice(0, 6).map((m) => (
            <div key={m.id} className="w-16 text-center">
              <div className="mx-auto size-14 overflow-hidden rounded-full bg-black/30 ring-1 ring-white/15">
                {m.avatar ? <img src={m.avatar} alt={m.name} className="h-full w-full object-cover" /> : (
                  <div className="grid h-full w-full place-items-center text-sm font-bold text-[var(--pf-accent)]">{m.name.slice(0, 2)}</div>
                )}
              </div>
              <div dir="auto" className="mt-1.5 truncate text-[11px] text-[var(--pf-text-muted)]">{m.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          {isMe ? (
            <button
              type="button"
              onClick={onEdit}
              className="group flex flex-col items-center gap-2 text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-text)]"
            >
              <span className="grid size-11 place-items-center rounded-full border border-dashed border-[var(--pf-card-border)] bg-white/5 transition group-hover:border-[var(--pf-accent)]">
                <Plus size={18} />
              </span>
              <span>{ar ? 'أضف الفنانين المفضلين' : 'Add favourite artists'}</span>
            </button>
          ) : (
            <p className="text-xs text-[var(--pf-text-muted)]">{ar ? 'لا توجد موسيقى مفضلة بعد.' : 'No favourite artists yet.'}</p>
          )}
        </div>
      )}
    </ProfileCardShell>
  );
}
