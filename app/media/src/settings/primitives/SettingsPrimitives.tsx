import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Eye, EyeOff, Plus, RotateCcw, X } from 'lucide-react';
import { useHost } from '../../host';

export function SettingSection({
  title,
  subtitle,
  badge,
  rightAction,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: 'NEW' | 'EXPERIMENTAL' | 'RECOMMENDED' | string;
  rightAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">{title}</h3>
            {badge ? (
              <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                {badge}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{subtitle}</p> : null}
        </div>
        {rightAction ? <div className="shrink-0">{rightAction}</div> : null}
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </section>
  );
}

export function ToggleRow({
  label,
  description,
  badge,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  badge?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</span>
          {badge ? (
            <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        disabled={disabled}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[40px] flex-none rounded-full transition disabled:opacity-40 ${
          checked ? 'bg-[var(--accent)]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-[3px] size-4 rounded-full bg-white shadow transition-all ${
            checked ? 'start-[21px]' : 'start-[3px]'
          }`}
        />
      </button>
    </div>
  );
}

export function SegmentedRow<T extends string | number>({
  label,
  description,
  value,
  options,
  onChange,
  caption,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  caption?: string;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</div>
          {description ? <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-black/35 p-1 ring-1 ring-[var(--border-subtle)]">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onChange(o.value)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  on
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {caption ? <p className="mt-2 text-xs text-[var(--accent)]/90">{caption}</p> : null}
    </div>
  );
}

export function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  unit = '',
  defaultValue,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue?: number;
  onChange: (v: number) => void;
}) {
  const { lang } = useHost();
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</div>
          {description ? <p className="text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span dir="ltr" className="rounded-md bg-black/40 px-2 py-0.5 font-mono text-xs font-semibold text-[var(--accent)] ring-1 ring-[var(--border-subtle)]">
            {value}{unit}
          </span>
          {defaultValue !== undefined && value !== defaultValue ? (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              title={lang === 'ar' ? 'إعادة ضبط' : 'Reset'}
              className="rounded p-1 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <RotateCcw size={12} />
            </button>
          ) : null}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}

export function DropdownRow<T extends string | number>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      <select
        value={String(value)}
        onChange={(e) => {
          const match = options.find((o) => String(o.value) === e.target.value);
          if (match) onChange(match.value);
        }}
        className="min-w-[160px] rounded-xl border border-[var(--border-strong)] bg-[#100E0C] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-[#161310] text-[#F2EFE9]">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
export const SelectRow = DropdownRow;

export function RadioCardGroup<T extends string>({
  value,
  options,
  onChange,
  columns = 2,
}: {
  value: T;
  options: { value: T; title: string; description: string; badge?: string; preview?: ReactNode }[];
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const { lang } = useHost();
  const colsCls = columns === 3 ? 'sm:grid-cols-3' : columns === 1 ? 'grid-cols-1' : 'sm:grid-cols-2';
  return (
    <div className={`grid grid-cols-1 gap-3 py-2 ${colsCls}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex flex-col justify-between rounded-xl border p-4 text-start transition ${
              on
                ? 'border-[var(--accent)] bg-[var(--surface-active)] ring-1 ring-[var(--accent)]/40'
                : 'border-[var(--border-subtle)] bg-black/25 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            <div>
              {o.preview ? <div className="mb-3">{o.preview}</div> : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-bold text-[var(--text-primary)]">{o.title}</span>
                {o.badge ? (
                  <span className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">
                    {o.badge}
                  </span>
                ) : on ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-fg)]">
                    <Check size={10} strokeWidth={3} />{lang === 'ar' ? 'مختار' : 'Picked'}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{o.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ActionRow({
  label,
  description,
  buttonLabel,
  variant = 'default',
  busy,
  onClick,
  extra,
}: {
  label: string;
  description?: string;
  buttonLabel: string;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  busy?: boolean;
  onClick: () => void;
  extra?: ReactNode;
}) {
  const btnCls =
    variant === 'primary'
      ? 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
      : variant === 'danger'
        ? 'bg-[var(--danger)]/18 text-red-300 ring-1 ring-[var(--danger)]/40 hover:bg-[var(--danger)]/30'
        : variant === 'ghost'
          ? 'text-[var(--text-secondary)] hover:bg-white/10'
          : 'bg-white/10 text-[var(--text-primary)] hover:bg-white/18';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <button
          type="button"
          disabled={busy}
          onClick={onClick}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-45 ${btnCls}`}
        >
          {busy ? '…' : buttonLabel}
        </button>
      </div>
    </div>
  );
}

export function InputRow({
  label,
  description,
  value,
  placeholder,
  secret,
  savedBadge,
  dir = 'ltr',
  onChange,
  onSave,
  onClear,
  saveLabel,
  copyable,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  secret?: boolean;
  savedBadge?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
  onChange: (v: string) => void;
  onSave?: () => void;
  onClear?: () => void;
  saveLabel?: string;
  copyable?: boolean;
}) {
  const { lang } = useHost();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const ar = lang === 'ar';

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-medium text-[var(--text-primary)]">{label}</span>
          {savedBadge && value.trim() ? (
            <span className="rounded-full bg-[var(--success)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
              {ar ? 'محفوظ' : 'Saved'}
            </span>
          ) : null}
        </div>
      </div>
      {description ? <p className="mb-2 text-[13px] text-[var(--text-secondary)]">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center rounded-xl border border-[var(--border-strong)] bg-black/35 px-3">
          <input
            dir={dir}
            type={secret && !reveal ? 'password' : 'text'}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-white/30"
          />
          {secret ? (
            <button type="button" onClick={() => setReveal((r) => !r)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          ) : null}
        </div>
        {copyable && value ? (
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        ) : null}
        {onSave ? (
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl px-4 py-2 text-xs font-semibold transition hover:brightness-110"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {saveLabel || (ar ? 'حفظ' : 'Save')}
          </button>
        ) : null}
        {onClear && value ? (
          <button type="button" onClick={onClear} className="rounded-xl bg-white/8 px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-white/15">
            {ar ? 'مسح' : 'Clear'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TagPriorityList({
  label,
  description,
  tags,
  availableOptions,
  onChange,
}: {
  label: string;
  description?: string;
  tags: string[];
  availableOptions: string[];
  onChange: (next: string[]) => void;
}) {
  const { lang } = useHost();
  const [adding, setAdding] = useState(false);
  const ar = lang === 'ar';
  const remaining = availableOptions.filter((x) => !tags.includes(x));

  const move = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= tags.length) return;
    const next = [...tags];
    [next[idx], next[t]] = [next[t], next[idx]];
    onChange(next);
  };

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 text-[13.5px] font-medium text-[var(--text-primary)]">{label}</div>
      {description ? <p className="mb-2.5 text-xs text-[var(--text-muted)]">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag, i) => (
          <div key={tag} className="flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-black/35 ps-3 pe-1.5 py-1 text-xs font-medium">
            <span className="font-mono text-[10px] text-[var(--accent)]">#{i + 1}</span>
            <span>{tag}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-white/45 hover:text-white disabled:opacity-20"><ArrowUp size={11} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === tags.length - 1} className="p-0.5 text-white/45 hover:text-white disabled:opacity-20"><ArrowDown size={11} /></button>
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== tag))} className="rounded-full p-0.5 text-white/45 hover:bg-red-500/20 hover:text-red-300"><X size={11} /></button>
          </div>
        ))}
        {remaining.length ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Plus size={12} />{ar ? 'إضافة' : 'Add'}
            </button>
            {adding ? (
              <div className="absolute start-0 top-9 z-30 max-h-52 w-44 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[#141210] p-1.5 shadow-2xl">
                {remaining.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { onChange([...tags, opt]); setAdding(false); }}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-start text-xs hover:bg-white/10"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const DEFAULT_SWATCHES = ['#E5A93C', '#FFFFFF', '#F87171', '#FB923C', '#34D399', '#38BDF8', '#3B82F6', '#A855F7', '#F472B6', '#FACC15'];

export function ColorSwatchPicker({
  label,
  value,
  defaultColor = '#E5A93C',
  swatches = DEFAULT_SWATCHES,
  onChange,
}: {
  label: string;
  value: string;
  defaultColor?: string;
  swatches?: string[];
  onChange: (hex: string) => void;
}) {
  const { lang } = useHost();
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13.5px] font-medium text-[var(--text-primary)]">{label}</span>
        {value.toLowerCase() !== defaultColor.toLowerCase() ? (
          <button type="button" onClick={() => onChange(defaultColor)} className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">
            {lang === 'ar' ? 'الافتراضي' : 'Default'}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={c}
            className={`size-7 rounded-full border border-white/20 transition ${
              value.toLowerCase() === c.toLowerCase() ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#181613]' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ background: c }}
          />
        ))}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-black/35 px-2.5 py-1 text-xs">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : defaultColor} onChange={(e) => onChange(e.target.value)} className="size-4 cursor-pointer border-0 bg-transparent p-0" />
          <span className="font-mono text-[11px]">{value}</span>
        </label>
      </div>
    </div>
  );
}
export const ColorSwatches = ColorSwatchPicker;

export function KeybindRecorder({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (combo: string) => void;
}) {
  const { lang } = useHost();
  const [recording, setRecording] = useState(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setRecording(false); return; }
    if (e.key === 'Backspace') { onChange(''); setRecording(false); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(k);
    onChange(parts.join('+'));
    setRecording(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{label}</div>
        {description ? <p className="text-[11px] text-[var(--text-muted)]">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        className={`min-w-[116px] rounded-lg px-3 py-1.5 text-center font-mono text-xs font-semibold ring-1 transition ${
          recording
            ? 'animate-pulse bg-[var(--accent)]/20 text-[var(--accent)] ring-[var(--accent)]'
            : 'bg-black/40 text-[var(--text-primary)] ring-[var(--border-strong)] hover:ring-white/30'
        }`}
      >
        {recording ? (lang === 'ar' ? 'اضغط مفتاحًا...' : 'Press keys...') : (value || (lang === 'ar' ? 'غير معين' : 'Unbound'))}
      </button>
    </div>
  );
}

export function BadgePreview({ label, active, color = '#E5A93C', onClick }: { label: string; active?: boolean; color?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-bold transition ring-1 ${
        active ? 'text-[#12100E]' : 'bg-black/35 text-white/60 ring-white/10 hover:text-white'
      }`}
      style={active ? { background: color, borderColor: color } : undefined}
    >
      {label}
    </button>
  );
}

export function InfoBanner({ title, body, tone = 'info', action }: { title?: string; body: string; tone?: 'info' | 'warn'; action?: ReactNode }) {
  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-[var(--border-strong)] bg-[var(--surface-active)] text-[var(--text-secondary)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        {title ? <div className="mb-0.5 font-bold text-[var(--text-primary)]">{title}</div> : null}
        <p className="leading-relaxed">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function LivePreviewCard({ title, children }: { title?: string; children: ReactNode }) {
  const { lang } = useHost();
  return (
    <div className="rounded-2xl border border-[var(--border-strong)] bg-[#100E0C] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">
          {title || (lang === 'ar' ? 'معاينة حية' : 'LIVE PREVIEW')}
        </span>
      </div>
      {children}
    </div>
  );
}
export const LivePreviewBox = LivePreviewCard;

export function StickySaveBar({
  dirty,
  onReset,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  onReset: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  return (
    <div className="sticky bottom-3 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-strong)] bg-[#141210]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
      <button type="button" onClick={onReset} className="rounded-full bg-white/8 px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/15">
        {ar ? 'الافتراضي' : 'Reset to default'}
      </button>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!dirty} onClick={onDiscard} className="rounded-full bg-white/8 px-3.5 py-1.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40">
          {ar ? 'تجاهل التغييرات' : 'Discard changes'}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full px-5 py-1.5 text-xs font-semibold transition hover:brightness-110"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {ar ? 'حفظ التغييرات' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
