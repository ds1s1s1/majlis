// The house icon set (src/renderer/icons.js), so Cinema draws the same strokes as the rest of Majlis.
import { icon } from '../../../src/renderer/icons.js';

export function Icon({ n, s = 18, className = '' }: { n: string; s?: number; className?: string }) {
  return <span aria-hidden className={`inline-flex ${className}`} dangerouslySetInnerHTML={{ __html: icon(n, s) }} />;
}
