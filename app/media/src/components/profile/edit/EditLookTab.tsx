import { Check, ImagePlus, Paintbrush, Sparkles, Trash2 } from 'lucide-react';
import { PROFILE_THEMES } from '../../../config/profileThemes';
import { useHost } from '../../../host';
import type { ProfileDraft } from '../../../store/useProfileStore';

async function fileToDataUrl(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      if (file.type === 'image/gif' || maxDim <= 0) return resolve(res);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/webp', 0.88));
      };
      img.onerror = () => resolve(res);
      img.src = res;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EditLookTab({
  draft,
  onChange,
  onOpenCustomise,
}: {
  draft: ProfileDraft;
  onChange: (updater: (d: ProfileDraft) => void) => void;
  onOpenCustomise: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const g = draft.general;
  const look = draft.look;

  const pickAvatar = async (f?: File | null) => {
    if (!f) return;
    const url = await fileToDataUrl(f, 256);
    onChange((d) => { d.general.avatar = url; });
  };
  const pickBanner = async (f?: File | null) => {
    if (!f) return;
    const url = await fileToDataUrl(f, 1440);
    onChange((d) => { d.general.banner = url; });
  };

  const colors = look.customColors;

  return (
    <div className="space-y-6">
      {/* Avatar upload */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div
          className="grid size-[72px] flex-none place-items-center overflow-hidden rounded-full text-2xl font-bold ring-2 ring-[var(--pf-card-border)]"
          style={{ background: g.avatar?.startsWith('data:') ? undefined : colors.accent, color: '#12100E' }}
        >
          {g.avatar?.startsWith('data:') ? <img src={g.avatar} alt="" className="h-full w-full object-cover" /> : (g.avatar || g.alias.slice(0, 1).toUpperCase())}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--pf-text)]">{ar ? 'الصورة الشخصية' : 'Avatar'}</div>
          <div className="text-xs text-[var(--pf-text-muted)]">JPEG, PNG, WebP, GIF</div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-white/8 px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-white/15">
          <ImagePlus size={14} />
          <span>{ar ? 'تغيير الصورة' : 'Change photo'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pickAvatar(e.target.files?.[0])} />
        </label>
        {g.avatar ? (
          <button
            type="button"
            onClick={() => onChange((d) => { d.general.avatar = null; })}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/15"
          >
            <Trash2 size={13} />{ar ? 'إزالة' : 'Remove'}
          </button>
        ) : null}
      </div>

      {/* Banner upload */}
      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--pf-text)]">{ar ? 'خلفية الملف (الغلاف)' : 'Profile background'}</div>
            <div className="text-xs text-[var(--pf-text-muted)]">{ar ? 'صورة عريضة أعلى الملف' : 'Wide hero cover artwork'}</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-white/8 px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] hover:bg-white/15">
              <ImagePlus size={14} />
              <span>{ar ? 'تغيير الغلاف' : 'Change banner'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => pickBanner(e.target.files?.[0])} />
            </label>
            {g.banner ? (
              <button
                type="button"
                onClick={() => onChange((d) => { d.general.banner = null; })}
                className="rounded-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/15"
              >
                {ar ? 'إزالة' : 'Remove'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="h-[160px] w-full overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10">
          {g.banner ? <img src={g.banner} alt="" className="h-full w-full object-cover" /> : (
            <div className="grid h-full place-items-center text-xs text-[var(--pf-text-muted)]">{ar ? 'لا يوجد غلاف' : 'No banner selected'}</div>
          )}
        </div>
      </div>

      {/* Profile Theme Presets */}
      <div>
        <div className="mb-3 text-sm font-semibold text-[var(--pf-text)]">{ar ? 'ثيم الملف' : 'Profile theme'}</div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {PROFILE_THEMES.map((preset) => {
            const on = look.themeId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange((d) => {
                  d.look.themeId = preset.id;
                  if (preset.id !== 'custom') d.look.customColors = { ...preset.colors };
                })}
                className={`flex items-center gap-3 rounded-xl border p-3 text-start transition ${
                  on ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/10' : 'border-[var(--pf-card-border)] bg-black/20 hover:bg-white/5'
                }`}
              >
                <span className="flex h-9 w-9 flex-none overflow-hidden rounded-lg ring-1 ring-white/15">
                  <span className="h-full w-1/2" style={{ background: preset.colors.bg }} />
                  <span className="h-full w-1/2" style={{ background: preset.colors.accent }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--pf-text)]">{ar ? preset.nameAr : preset.name}</span>
                  <span className="block truncate text-[11px] text-[var(--pf-text-muted)]">{ar ? preset.taglineAr : preset.tagline}</span>
                </span>
                {on ? <Check size={16} className="text-[var(--pf-accent)]" /> : null}
              </button>
            );
          })}
        </div>

        {/* 2x2 Custom hex color pickers */}
        {look.themeId === 'custom' ? (
          <div className="mt-4 rounded-xl border border-[var(--pf-card-border)] bg-black/25 p-4">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['bg', ar ? 'الخلفية' : 'Background'],
                ['card', ar ? 'البطاقات' : 'Cards'],
                ['accent', ar ? 'اللون المميز' : 'Accent'],
                ['text', ar ? 'النص' : 'Text'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2 rounded-lg border border-[var(--pf-card-border)] bg-black/30 px-2.5 py-1.5">
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => onChange((d) => { d.look.customColors[key] = e.target.value; })}
                    className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-[var(--pf-text-muted)]">{label}</div>
                    <input
                      dir="ltr"
                      value={colors[key]}
                      maxLength={7}
                      onChange={(e) => onChange((d) => { d.look.customColors[key] = e.target.value; })}
                      className="w-full bg-transparent font-mono text-xs text-[var(--pf-text)]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Transparent cards + Gradient mode */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChange((d) => { d.look.transparentCards = !d.look.transparentCards; })}
            className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-medium transition ${
              look.transparentCards ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12 text-[var(--pf-text)]' : 'border-[var(--pf-card-border)] bg-black/20 text-[var(--pf-text-muted)]'
            }`}
          >
            <span>{ar ? 'بطاقات شفافة' : 'Transparent cards'}</span>
            <span className={`size-3 rounded-full ${look.transparentCards ? 'bg-[var(--pf-accent)]' : 'bg-white/20'}`} />
          </button>
          <button
            type="button"
            onClick={() => onChange((d) => { d.look.gradientMode = !d.look.gradientMode; })}
            className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-medium transition ${
              look.gradientMode ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12 text-[var(--pf-text)]' : 'border-[var(--pf-card-border)] bg-black/20 text-[var(--pf-text-muted)]'
            }`}
          >
            <span>{ar ? 'تدرّج الخلفية' : 'Gradient mode'}</span>
            <span className={`size-3 rounded-full ${look.gradientMode ? 'bg-[var(--pf-accent)]' : 'bg-white/20'}`} />
          </button>
        </div>
      </div>

      {/* Customise profile card */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--pf-card-border)] bg-black/25 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--pf-accent)]/15 text-[var(--pf-accent)]">
            <Sparkles size={18} />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--pf-text)]">{ar ? 'تخصيص تخطيط الملف' : 'Customise profile'}</div>
            <div className="text-xs text-[var(--pf-text-muted)]">
              {ar ? 'ابنِ تصميمك الخاص باستخدام لوحة HTML و CSS آمنة.' : 'Build your own profile layout using HTML & CSS canvas.'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenCustomise}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pf-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--pf-accent-fg)] hover:brightness-110"
        >
          <Paintbrush size={13} />
          <span>{ar ? 'تخصيص' : 'Customise'}</span>
        </button>
      </div>
    </div>
  );
}
