import { BarChart3, Gamepad2, Heart, LayoutGrid, List } from 'lucide-react';
import { useHost } from '../../../host';

export function EditShowcaseTab({
  onOpenFeaturedLists,
  onOpenFavorites,
  onOpenHeroStats,
  onOpenCardsOrder,
  onOpenGaming,
}: {
  onOpenFeaturedLists: () => void;
  onOpenFavorites: (kind: 'games' | 'books' | 'music') => void;
  onOpenHeroStats: () => void;
  onOpenCardsOrder: () => void;
  onOpenGaming: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--pf-text)]">
          <List size={15} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'القوائم المميزة' : 'Featured lists'}</span>
        </div>
        <p className="mb-3 text-xs text-[var(--pf-text-muted)]">
          {ar ? 'اختر حتى 3 قوائم لتظهر أعلى ملفك.' : 'Pick up to 3 lists to show on your profile'}
        </p>
        <button type="button" onClick={onOpenFeaturedLists} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]">
          {ar ? 'إدارة' : 'Manage'}
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--pf-text)]">
          <Heart size={15} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'المفضلات الأخرى' : 'Favourites'}</span>
        </div>
        <p className="mb-3 text-xs text-[var(--pf-text-muted)]">
          {ar ? 'اعرض ألعابك وكتبك وموسيقاك المفضلة.' : 'Show your favourite games, books and music'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(['games', 'books', 'music'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onOpenFavorites(k)}
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]"
            >
              {k === 'games' ? (ar ? 'ألعاب' : 'Games') : k === 'books' ? (ar ? 'كتب' : 'Books') : (ar ? 'موسيقى' : 'Music')}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--pf-text)]">
          <BarChart3 size={15} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'إحصائيات الشريط العلوي' : 'Hero stats'}</span>
        </div>
        <p className="mb-3 text-xs text-[var(--pf-text-muted)]">
          {ar ? 'اختر 4 إحصائيات تظهر أسفل اسمك.' : 'Pick the 4 stats that sit at the top of your profile'}
        </p>
        <button type="button" onClick={onOpenHeroStats} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]">
          {ar ? 'اختر' : 'Choose'}
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--pf-text)]">
          <LayoutGrid size={15} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'بطاقات الملف وترتيبها' : 'Profile cards'}</span>
        </div>
        <p className="mb-3 text-xs text-[var(--pf-text-muted)]">
          {ar ? 'أظهر أو أخفِ البطاقات ورتّب ظهورها.' : 'Pick which cards appear and the order they show in'}
        </p>
        <button type="button" onClick={onOpenCardsOrder} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]">
          {ar ? 'ترتيب' : 'Choose'}
        </button>
      </div>

      <div className="sm:col-span-2 rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--pf-text)]">
          <Gamepad2 size={15} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'بطاقة الألعاب' : 'Gaming card'}</span>
        </div>
        <p className="mb-3 text-xs text-[var(--pf-text-muted)]">
          {ar ? 'اربط حساب ألعابك (Steam / Xbox / PSN / Minecraft).' : 'Link an optional gaming profile card with your gamertag'}
        </p>
        <button type="button" onClick={onOpenGaming} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]">
          {ar ? 'إعداد البطاقة' : 'Choose'}
        </button>
      </div>
    </div>
  );
}
