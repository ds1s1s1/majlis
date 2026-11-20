import { BookOpen, Gamepad2, Plus } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileFavoriteWork } from '../../../data/profileMockSeed';
import { ProfileCardShell } from './ProfileCardShell';

export function FavoritesCard({
  variant,
  items,
  isMe,
  hideTitle,
  transparent,
  onEdit,
}: {
  variant: 'games' | 'books';
  items: ProfileFavoriteWork[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onEdit: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const isGames = variant === 'games';
  const title = isGames ? (ar ? 'الألعاب' : 'GAMES') : (ar ? 'الكتب' : 'BOOKS');

  return (
    <ProfileCardShell
      icon={isGames ? <Gamepad2 size={14} /> : <BookOpen size={14} />}
      title={title}
      hideTitle={hideTitle}
      transparent={transparent}
      action={
        isMe ? (
          <button type="button" onClick={onEdit} className="text-xs text-[var(--pf-text-muted)] hover:text-[var(--pf-accent)]">
            {ar ? 'تعديل' : 'Edit'}
          </button>
        ) : null
      }
    >
      {items.length ? (
        <div className="grid grid-cols-5 gap-2.5">
          {items.slice(0, 5).map((item) => (
            <div key={item.id} className="text-start">
              <div
                className={`${isGames ? 'aspect-[3/4]' : 'aspect-[2/3]'} w-full overflow-hidden rounded-lg bg-black/30 ring-1 ring-white/10`}
              >
                <img src={item.cover} alt={item.title} className="h-full w-full object-cover" />
              </div>
              <div dir="auto" className="mt-1 truncate text-[11px] text-[var(--pf-text-muted)]">{item.title}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          {isMe ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-white/5 px-4 py-2 text-xs font-medium text-[var(--pf-text-muted)] transition hover:border-[var(--pf-accent)]/60 hover:text-[var(--pf-text)]"
            >
              <Plus size={14} />
              <span>{isGames ? (ar ? 'أضف ألعابك المفضلة' : 'Add favourite games') : (ar ? 'أضف كتبك المفضلة' : 'Add favourite books')}</span>
            </button>
          ) : (
            <p className="text-xs text-[var(--pf-text-muted)]">{ar ? 'لا توجد عناصر مفضلة.' : 'Nothing showcased yet.'}</p>
          )}
        </div>
      )}
    </ProfileCardShell>
  );
}
