import { User } from 'lucide-react';
import { useHost } from '../../../host';
import { renderSafeMarkdown } from '../../../utils/renderMarkdown';
import { ProfileCardShell } from './ProfileCardShell';

export function AboutCard({
  about,
  hideTitle,
  transparent,
}: {
  about: string;
  hideTitle?: boolean;
  transparent?: boolean;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  return (
    <ProfileCardShell icon={<User size={14} />} title={ar ? 'نبذة' : 'ABOUT'} hideTitle={hideTitle} transparent={transparent}>
      {about.trim() ? (
        <div dir="auto" className="space-y-2 text-[13.5px] leading-relaxed text-[var(--pf-text)]/90">
          {renderSafeMarkdown(about)}
        </div>
      ) : (
        <p className="text-xs text-[var(--pf-text-muted)]">{ar ? 'لم تتم إضافة نبذة بعد.' : 'No bio written yet.'}</p>
      )}
    </ProfileCardShell>
  );
}
