import { Globe, Lock, Users } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileDraft } from '../../../store/useProfileStore';

export function EditPrivacyTab({
  draft,
  onChange,
}: {
  draft: ProfileDraft;
  onChange: (updater: (d: ProfileDraft) => void) => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const p = draft.privacy;

  const row = (label: string, hint: string, on: boolean, fn: () => void) => (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--pf-card-border)] bg-black/20 p-4">
      <div>
        <div className="text-sm font-medium text-[var(--pf-text)]">{label}</div>
        <div className="text-xs text-[var(--pf-text-muted)]">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={fn}
        className={`relative h-6 w-11 flex-none rounded-full transition ${on ? 'bg-[var(--pf-accent)]' : 'bg-white/15'}`}
      >
        <span className={`absolute top-1 size-4 rounded-full bg-white transition-all ${on ? 'start-6' : 'start-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {row(
        ar ? 'ملف خاص' : 'Private profile',
        ar ? 'يخفي الملف والأصدقاء والنشاط عن غير الأصدقاء.' : 'Hides profile, friends, badges, and activity from non-friends.',
        p.privateProfile,
        () => onChange((d) => { d.privacy.privateProfile = !d.privacy.privateProfile; }),
      )}

      {/* Friends list 3-card visual selector */}
      <div className="rounded-xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-2.5 text-sm font-medium text-[var(--pf-text)]">{ar ? 'من يرى قائمة أصدقائك' : 'Friends list visibility'}</div>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['everyone', Globe, ar ? 'الجميع' : 'Everyone'],
            ['friends', Users, ar ? 'الأصدقاء' : 'Friends'],
            ['only_me', Lock, ar ? 'أنا فقط' : 'Only me'],
          ] as const).map(([id, Ic, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange((d) => { d.privacy.friendsListVisibility = id; })}
              className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition ${
                p.friendsListVisibility === id
                  ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/15 text-[var(--pf-text)]'
                  : 'border-[var(--pf-card-border)] bg-black/25 text-[var(--pf-text-muted)] hover:text-[var(--pf-text)]'
              }`}
            >
              <Ic size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {row(
        ar ? 'مشاركة سجل المشاهدة' : 'Share watch activity',
        ar ? 'السماح للأصدقاء برؤية آخر ما شاهدت.' : 'Let friends see your recent watches.',
        p.shareWatchActivity,
        () => onChange((d) => { d.privacy.shareWatchActivity = !d.privacy.shareWatchActivity; }),
      )}
      {row(
        ar ? 'مشاركة حالة الاتصال المباشر' : 'Share live watching status',
        ar ? 'عرض ما تشاهده الآن أو انضمامك لسهرة.' : 'Show online indicator and active party/movie status.',
        p.shareLiveStatus,
        () => onChange((d) => { d.privacy.shareLiveStatus = !d.privacy.shareLiveStatus; }),
      )}
      {row(
        ar ? 'إظهار بطاقة الألعاب' : 'Show your gaming card',
        ar ? 'عرض اسم حسابك في الألعاب بجانب الملف.' : 'Display your linked gamertag in the sidebar.',
        p.showGamingCard,
        () => onChange((d) => { d.privacy.showGamingCard = !d.privacy.showGamingCard; }),
      )}
      {row(
        ar ? 'إظهار بطاقة Letterboxd / Trakt' : 'Show external tracker card',
        ar ? 'عرض إحصائيات التتبع المربوطة في ملفك.' : 'Show connected external tracker card on your profile.',
        p.showExternalTrackerCard,
        () => onChange((d) => { d.privacy.showExternalTrackerCard = !d.privacy.showExternalTrackerCard; }),
      )}
    </div>
  );
}
