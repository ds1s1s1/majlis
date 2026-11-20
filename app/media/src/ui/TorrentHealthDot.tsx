import type { Ranked, TorrentHealthEntry } from '../api';
import { useT } from '../host';
import type { Key } from '../i18n';

// Purely visual, 0ms non-blocking pre-flight indicator (optimistic at frame 0 -> updates from async tracker scrape).
export function TorrentHealthDot({ r, health, translateFn }: { r: Ranked; health?: TorrentHealthEntry; translateFn?: (k: Key, vars?: Record<string, string | number>) => string }) {
  const hookT = useT();
  const t = translateFn || hookT;
  const f = r.facts;

  let level: 'green' | 'yellow' | 'red';
  let tip: string;

  if (f.instant || f.cached) {
    level = 'green';
    tip = t('health_instant');
  } else if (health) {
    level = health.level;
    tip = health.verified && health.seeders != null
      ? t('health_live_tip', { n: health.seeders, l: health.leechers })
      : t(level === 'green' ? 'health_green' : level === 'red' ? 'health_red' : 'health_yellow');
  } else {
    // Immediate optimistic estimate from addon metadata before async scrape completes
    const hasMeta = !!(r.stream.behaviorHints?.filename || f.height || f.sizeGb);
    if ((f.seeders ?? 0) >= 15 && hasMeta) {
      level = 'green';
      tip = t('health_green');
    } else if (f.seeders === 0) {
      level = 'red';
      tip = t('health_red');
    } else {
      level = 'yellow';
      tip = t('health_yellow');
    }
  }

  const cls =
    level === 'green' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
      : level === 'red' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
      : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.55)]';

  return (
    <span
      title={tip}
      aria-label={tip}
      className={`inline-block size-2.5 flex-none rounded-full transition-colors duration-300 ${cls}`}
    />
  );
}
