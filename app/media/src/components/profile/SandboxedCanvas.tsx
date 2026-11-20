import { buildSandboxedCanvasDoc } from '../../utils/sanitizeCanvas';

export function SandboxedCanvas({
  html,
  css,
  font,
  bgColor,
  accentColor,
  textColor,
  height,
  dir,
}: {
  html: string;
  css: string;
  font: string;
  bgColor: string;
  accentColor: string;
  textColor: string;
  height: number;
  dir: 'rtl' | 'ltr';
}) {
  if (!html.trim() && !css.trim()) return null;
  const srcDoc = buildSandboxedCanvasDoc({ html, css, font, bgColor, accentColor, textColor, dir });
  const h = Math.max(120, Math.min(1200, Number(height) || 220));
  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)]">
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        title="Custom Profile Canvas"
        className="block w-full border-0"
        style={{ height: `${h}px` }}
      />
    </div>
  );
}
