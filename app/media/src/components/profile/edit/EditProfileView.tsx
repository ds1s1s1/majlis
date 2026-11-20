import { useState } from 'react';
import { Palette, Shield, Sliders, User } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileDraft } from '../../../store/useProfileStore';
import { CustomiseProfileView } from './CustomiseProfileView';
import { EditGeneralTab } from './EditGeneralTab';
import { EditLookTab } from './EditLookTab';
import { EditPrivacyTab } from './EditPrivacyTab';
import { EditShowcaseTab } from './EditShowcaseTab';

type Tab = 'general' | 'look' | 'showcase' | 'privacy';

export function EditProfileView({
  draft,
  customiseView,
  dirty,
  onChange,
  onCancel,
  onSave,
  onOpenCustomise,
  onCloseCustomise,
  onOpenFeaturedLists,
  onOpenFavorites,
  onOpenHeroStats,
  onOpenCardsOrder,
  onOpenGaming,
}: {
  draft: ProfileDraft;
  customiseView: boolean;
  dirty: boolean;
  onChange: (updater: (d: ProfileDraft) => void) => void;
  onCancel: () => void;
  onSave: () => void;
  onOpenCustomise: () => void;
  onCloseCustomise: () => void;
  onOpenFeaturedLists: () => void;
  onOpenFavorites: (kind: 'games' | 'books' | 'music') => void;
  onOpenHeroStats: () => void;
  onOpenCardsOrder: () => void;
  onOpenGaming: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: ar ? 'عام' : 'General', icon: <User size={15} /> },
    { id: 'look', label: ar ? 'المظهر' : 'Look', icon: <Palette size={15} /> },
    { id: 'showcase', label: ar ? 'العرض والبطاقات' : 'Showcase', icon: <Sliders size={15} /> },
    { id: 'privacy', label: ar ? 'الخصوصية' : 'Privacy', icon: <Shield size={15} /> },
  ];

  return (
    <div className="mx-auto max-w-[1040px] px-6 pb-20 pt-28">
      {/* Persistent Top Bar */}
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-[var(--pf-card-border)] pb-4">
        <h1 className="text-2xl font-bold text-[var(--pf-text)]">{ar ? 'تعديل الملف' : 'Edit profile'}</h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-[var(--pf-card-border)] bg-white/5 px-4 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-white/10"
          >
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-full px-5 py-1.5 text-xs font-semibold transition hover:brightness-110"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)', opacity: dirty ? 1 : 0.72 }}
          >
            {ar ? 'حفظ التغييرات' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* 2-Column Editor Shell */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onCloseCustomise(); setTab(t.id); }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-start text-sm transition ${
                tab === t.id ? 'bg-[var(--pf-accent)]/15 font-semibold text-[var(--pf-accent)]' : 'text-[var(--pf-text-muted)] hover:bg-white/5 hover:text-[var(--pf-text)]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </aside>

        <div className="rounded-2xl border border-[var(--pf-card-border)] p-5" style={{ background: 'var(--pf-card)' }}>
          {tab === 'general' ? <EditGeneralTab draft={draft} onChange={onChange} /> : null}
          {tab === 'look' ? (
            customiseView
              ? <CustomiseProfileView draft={draft} onChange={onChange} onBack={onCloseCustomise} />
              : <EditLookTab draft={draft} onChange={onChange} onOpenCustomise={onOpenCustomise} />
          ) : null}
          {tab === 'showcase' ? (
            <EditShowcaseTab
              onOpenFeaturedLists={onOpenFeaturedLists}
              onOpenFavorites={onOpenFavorites}
              onOpenHeroStats={onOpenHeroStats}
              onOpenCardsOrder={onOpenCardsOrder}
              onOpenGaming={onOpenGaming}
            />
          ) : null}
          {tab === 'privacy' ? <EditPrivacyTab draft={draft} onChange={onChange} /> : null}
        </div>
      </div>
    </div>
  );
}
