// Real vector brand marks from Harbor's public/services/*.svg (see serviceMarks.ts), painted as a CSS mask:
// one currentColor (cream, gold on hover/active), immune to dir="rtl" and to <text> font fallback.
import type { STREAMING_BRANDS } from '../api';
import { SERVICE_MARKS } from './serviceMarks';

export type BrandKey = (typeof STREAMING_BRANDS)[number]['key'];

// Optical balance: tall marks (Disney arc, Paramount mountain) get more height; wide wordmarks (Crunchyroll, Shudder) stay uncramped.
const SCALE: Record<string, number> = {
  disney: 1.75,
  paramount: 1.55,
  apple: 1.15,
  prime: 1.25,
  crunchyroll: 0.92,
  shudder: 0.85,
};

export function ServiceLogo({ service, name, compact = false }: { service: string; name?: string; compact?: boolean }) {
  const m = SERVICE_MARKS[service];
  if (!m) return <span dir="ltr" className="text-xs font-bold">{name || service}</span>;
  const h = (compact ? 16 : 22) * (SCALE[service] || 1);
  const url = `url("${m.uri}")`;
  return (
    <span dir="ltr" role="img" aria-label={name || service} className="inline-block flex-none select-none"
      style={{ height: h, width: h * m.aspect, maxWidth: '100%', background: 'currentColor', WebkitMaskImage: url, maskImage: url,
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: 'contain', maskSize: 'contain' }} />
  );
}
