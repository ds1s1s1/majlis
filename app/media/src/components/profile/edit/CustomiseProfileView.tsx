import { useState } from 'react';
import { ArrowLeft, Eye, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useHost } from '../../../host';
import type { ProfileDraft } from '../../../store/useProfileStore';
import { SandboxedCanvas } from '../SandboxedCanvas';

const FONTS = [
  'Default',
  'Inter',
  'Poppins',
  'Space Grotesk',
  'Playfair Display',
  'JetBrains Mono',
  'IBM Plex Sans Arabic',
];

export function CustomiseProfileView({
  draft,
  onChange,
  onBack,
}: {
  draft: ProfileDraft;
  onChange: (updater: (d: ProfileDraft) => void) => void;
  onBack: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const c = draft.customCanvas;
  const [livePreview, setLivePreview] = useState(false);

  const toggle = (label: string, val: boolean, fn: () => void) => (
    <div className="flex items-center justify-between rounded-xl border border-[var(--pf-card-border)] bg-black/20 px-4 py-2.5">
      <span className="text-xs font-medium text-[var(--pf-text)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={val}
        onClick={fn}
        className={`relative h-6 w-11 rounded-full transition ${val ? 'bg-[var(--pf-accent)]' : 'bg-white/15'}`}
      >
        <span className={`absolute top-1 size-4 rounded-full bg-white transition-all ${val ? 'start-6' : 'start-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--pf-card-border)] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--pf-text)] hover:text-[var(--pf-accent)]"
        >
          <ArrowLeft size={16} className="flip" />
          <span>{ar ? 'تخصيص الملف (HTML & CSS)' : 'Customise profile'}</span>
        </button>
        <button
          type="button"
          onClick={() => setLivePreview((p) => !p)}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-white/20"
        >
          <Eye size={13} />
          <span>{livePreview ? (ar ? 'المحرر' : 'Editor') : (ar ? 'معاينة حية' : 'Preview')}</span>
        </button>
      </div>

      {livePreview ? (
        <SandboxedCanvas
          html={c.customHtml}
          css={c.customCss}
          font={c.font}
          bgColor={c.pageBgColor}
          accentColor={draft.look.customColors.accent}
          textColor={draft.look.customColors.text}
          height={c.canvasHeight}
          dir={ar ? 'rtl' : 'ltr'}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {toggle(ar ? 'تفعيل اللوحة المخصّصة' : 'Enable custom canvas', c.enabled, () => onChange((d) => { d.customCanvas.enabled = !d.customCanvas.enabled; }))}
            {toggle(ar ? 'إظهار التخصيص للزوار' : 'Show customisation to visitors', c.showToVisitors, () => onChange((d) => { d.customCanvas.showToVisitors = !d.customCanvas.showToVisitors; }))}
            {toggle(ar ? 'إخفاء البانر العلوي' : 'Hide top banner', c.hideTopBanner, () => onChange((d) => { d.customCanvas.hideTopBanner = !d.customCanvas.hideTopBanner; }))}
            {toggle(ar ? 'إخفاء عناوين البطاقات' : 'Hide card titles', c.hideCardTitles, () => onChange((d) => { d.customCanvas.hideCardTitles = !d.customCanvas.hideCardTitles; }))}
          </div>

          {/* Font bar */}
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--pf-text)]">{ar ? 'خط الملف' : 'Profile font'}</div>
            <div className="flex flex-wrap gap-1.5">
              {FONTS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onChange((d) => { d.customCanvas.font = f; })}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    c.font === f ? 'bg-[var(--pf-accent)] font-semibold text-[var(--pf-accent-fg)]' : 'bg-white/8 text-[var(--pf-text-muted)] hover:text-[var(--pf-text)]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--pf-text)]">{ar ? 'لون خلفية الصفحة' : 'Page background color'}</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3 py-1.5">
                <input
                  type="color"
                  value={c.pageBgColor}
                  onChange={(e) => onChange((d) => { d.customCanvas.pageBgColor = e.target.value; })}
                  className="size-6 bg-transparent p-0"
                />
                <input
                  dir="ltr"
                  value={c.pageBgColor}
                  maxLength={7}
                  onChange={(e) => onChange((d) => { d.customCanvas.pageBgColor = e.target.value; })}
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-[var(--pf-text)]"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--pf-text)]">{ar ? 'ارتفاع اللوحة (px)' : 'Canvas height (px)'}</label>
              <input
                type="number"
                dir="ltr"
                min={120}
                max={1200}
                value={c.canvasHeight}
                onChange={(e) => onChange((d) => { d.customCanvas.canvasHeight = Math.max(120, Math.min(1200, Number(e.target.value) || 220)); })}
                className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3 py-2 font-mono text-xs text-[var(--pf-text)]"
              />
            </div>
          </div>

          {/* Custom HTML */}
          <div>
            <div className="mb-1.5 flex justify-between text-xs">
              <label className="font-medium text-[var(--pf-text)]">Custom HTML</label>
              <span className="font-mono text-[var(--pf-text-muted)]">{c.customHtml.length} / 5,000</span>
            </div>
            <textarea
              rows={5}
              dir="ltr"
              maxLength={5000}
              value={c.customHtml}
              onChange={(e) => onChange((d) => { d.customCanvas.customHtml = e.target.value; })}
              placeholder='<div class="box">...</div>'
              className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/35 p-3 font-mono text-xs text-[var(--pf-text)]"
            />
          </div>

          {/* Custom CSS */}
          <div>
            <div className="mb-1.5 flex justify-between text-xs">
              <label className="font-medium text-[var(--pf-text)]">Custom CSS</label>
              <span className="font-mono text-[var(--pf-text-muted)]">{c.customCss.length} / 5,000</span>
            </div>
            <textarea
              rows={5}
              dir="ltr"
              maxLength={5000}
              value={c.customCss}
              onChange={(e) => onChange((d) => { d.customCanvas.customCss = e.target.value; })}
              placeholder=".box { color: var(--pf-accent); }"
              className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/35 p-3 font-mono text-xs text-[var(--pf-text)]"
            />
          </div>

          {/* Canvas Sandbox Documentation Card */}
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                <ShieldCheck size={14} /><span>ALLOWED</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--pf-text-muted)]">
                Semantic HTML layouts, CSS grids, badges, typography, gradients, keyframes, inline SVGs, CSS variables.
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-400">
                <ShieldAlert size={14} /><span>BLOCKED (Sandboxed)</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--pf-text-muted)]">
                &lt;script&gt;, inline JS handlers (onclick/onload), &lt;iframe&gt;/&lt;embed&gt;, @import, javascript: URLs.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
