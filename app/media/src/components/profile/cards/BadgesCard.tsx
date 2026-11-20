import { Award, Compass, Film, Flame, Sparkles, Star, Users } from 'lucide-react';
import { useHost } from '../../../host';
import { fmtLocaleDate } from '../../../i18n';
import type { ProfileBadge } from '../../../data/profileMockSeed';
import { ProfileCardShell } from './ProfileCardShell';

function badgeIcon(k: ProfileBadge['icon']) {
  switch (k) {
    case 'flame': return <Flame size={16} />;
    case 'film': return <Film size={16} />;
    case 'users': return <Users size={16} />;
    case 'star': return <Star size={16} />;
    case 'compass': return <Compass size={16} />;
    default: return <Sparkles size={16} />;
  }
}

export function BadgesCard({
  badges,
  hideTitle,
  transparent,
}: {
  badges: ProfileBadge[];
  hideTitle?: boolean;
  transparent?: boolean;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell icon={<Award size={14} />} title={ar ? 'الشارات' : 'BADGES'} hideTitle={hideTitle} transparent={transparent}>
      {badges.length ? (
        <div className="flex flex-wrap gap-2.5">
          {badges.map((b) => (
            <div
              key={b.id}
              title={`${ar ? b.nameAr : b.name} — ${ar ? b.descriptionAr : b.description} (${fmtLocaleDate(b.earnedAt, lang)})`}
              className="group flex items-center gap-2 rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3 py-2 transition hover:border-[var(--pf-accent)]/60"
            >
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--pf-accent)]/15 text-[var(--pf-accent)]">
                {badgeIcon(b.icon)}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--pf-text)]">{ar ? b.nameAr : b.name}</div>
                <div className="text-[10px] text-[var(--pf-text-muted)]">{ar ? b.descriptionAr : b.description}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-5 text-center text-xs text-[var(--pf-text-muted)]">{ar ? 'لم تحصل على شارات بعد.' : 'No badges earned yet.'}</p>
      )}
    </ProfileCardShell>
  );
}
