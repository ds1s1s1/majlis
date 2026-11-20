import { Link2 } from 'lucide-react';
import { invoke } from '../../../api';
import { useHost } from '../../../host';
import type { ProfileSocialLink } from '../../../data/profileMockSeed';
import { SOCIAL_PLATFORMS, SocialPlatformIcon } from '../icons/SocialIcons';
import { ProfileCardShell } from './ProfileCardShell';

export function SocialsCard({
  links,
  isMe,
  hideTitle,
  transparent,
  onEdit,
}: {
  links: ProfileSocialLink[];
  isMe: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onEdit: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';

  return (
    <ProfileCardShell
      icon={<Link2 size={14} />}
      title={ar ? 'الروابط الاجتماعية' : 'SOCIALS'}
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
      {links.length ? (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => {
            const meta = SOCIAL_PLATFORMS.find((p) => p.id === l.platform) || SOCIAL_PLATFORMS[0];
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => invoke('open', meta.buildUrl(l.handle)).catch(() => {})}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--pf-card-border)] px-3 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]"
                style={{ background: 'var(--pf-bg)' }}
              >
                <span style={{ color: meta.color }}>
                  <SocialPlatformIcon id={meta.id} size={14} />
                </span>
                <span dir="ltr" className="truncate max-w-[140px]">{l.handle}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="py-3 text-center text-xs text-[var(--pf-text-muted)]">
          {ar ? 'لا توجد حسابات مضافة بعد.' : 'No social accounts linked yet.'}
        </p>
      )}
    </ProfileCardShell>
  );
}
