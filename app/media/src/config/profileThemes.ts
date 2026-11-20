export type ProfileThemeId =
  | 'automatic'
  | 'ash'
  | 'midnight'
  | 'ember'
  | 'forest'
  | 'amethyst'
  | 'majlis'
  | 'custom';

export interface ProfileThemeColors {
  bg: string;
  card: string;
  accent: string;
  text: string;
}

export interface ProfileThemePreset {
  id: ProfileThemeId;
  name: string;
  nameAr: string;
  tagline: string;
  taglineAr: string;
  colors: ProfileThemeColors;
}

export const PROFILE_THEMES: ProfileThemePreset[] = [
  {
    id: 'automatic',
    name: 'Automatic',
    nameAr: 'تلقائي',
    tagline: 'Adapts to banner & app obsidian',
    taglineAr: 'يتكيّف مع لون الغلاف والثيم',
    colors: { bg: '#12100E', card: '#181613', accent: '#E5A93C', text: '#F2EFE9' },
  },
  {
    id: 'ash',
    name: 'Ash',
    nameAr: 'رمادي دخاني',
    tagline: 'Monochrome slate & silver',
    taglineAr: 'درجات الرمادي والفضة',
    colors: { bg: '#121214', card: '#1A1A1E', accent: '#A1A1AA', text: '#F4F4F5' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    nameAr: 'منتصف الليل',
    tagline: 'Deep ocean sapphire & ice',
    taglineAr: 'أزرق عميق ولمسة سماوية',
    colors: { bg: '#0B101B', card: '#12192A', accent: '#3B82F6', text: '#F1F5F9' },
  },
  {
    id: 'ember',
    name: 'Ember',
    nameAr: 'جمر',
    tagline: 'Smoked volcanic charcoal & crimson',
    taglineAr: 'فحم دافئ وأحمر متوهج',
    colors: { bg: '#170E0C', card: '#221512', accent: '#EF5350', text: '#FAF2F0' },
  },
  {
    id: 'forest',
    name: 'Forest',
    nameAr: 'غابة',
    tagline: 'Pine canopy & emerald glint',
    taglineAr: 'أخضر داكن ولمعة زمردية',
    colors: { bg: '#0C1410', card: '#132019', accent: '#34D399', text: '#ECFDF5' },
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    nameAr: 'جمشت',
    tagline: 'Velvet plum & electric violet',
    taglineAr: 'بنفسجي عميق وإشراقة ناعمة',
    colors: { bg: '#130F1D', card: '#1C162B', accent: '#A855F7', text: '#F5F3FF' },
  },
  {
    id: 'majlis',
    name: 'Majlis Gold',
    nameAr: 'ذهب مجلس',
    tagline: 'Signature warm obsidian & amber gold',
    taglineAr: 'هوية مجلس الدافئة بالذهب والأوبسيديان',
    colors: { bg: '#12100E', card: '#181613', accent: '#E5A93C', text: '#F2EFE9' },
  },
  {
    id: 'custom',
    name: 'Custom',
    nameAr: 'مخصّص',
    tagline: 'Pick your own exact 4 colors',
    taglineAr: 'اختر الألوان الأربعة بدقة',
    colors: { bg: '#12100E', card: '#181613', accent: '#E5A93C', text: '#F2EFE9' },
  },
];

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [24, 22, 19];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function contrastOnAccent(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? '#12100E' : '#F8F6F2';
}

export function resolveProfileCssVars(opts: {
  themeId: ProfileThemeId;
  customColors: ProfileThemeColors;
  accentOverride?: string | null;
  transparentCards: boolean;
  gradientMode: boolean;
  customPageBg?: string | null;
}): Record<string, string> {
  const preset = PROFILE_THEMES.find((p) => p.id === opts.themeId) || PROFILE_THEMES[6];
  const base = opts.themeId === 'custom' ? opts.customColors : preset.colors;
  const bg = opts.customPageBg && /^#[0-9a-f]{6}$/i.test(opts.customPageBg) ? opts.customPageBg : base.bg;
  const accent = opts.themeId === 'automatic' && opts.accentOverride && /^#[0-9a-f]{6}$/i.test(opts.accentOverride)
    ? opts.accentOverride
    : base.accent;
  const [cr, cg, cb] = hexToRgb(base.card);
  const card = opts.transparentCards ? `rgba(${cr}, ${cg}, ${cb}, 0.62)` : base.card;
  const [tr, tg, tb] = hexToRgb(base.text);
  const gradient = opts.gradientMode
    ? `radial-gradient(ellipse 90% 55% at 50% 0%, color-mix(in srgb, ${accent} 22%, transparent), transparent 68%), linear-gradient(180deg, color-mix(in srgb, ${accent} 8%, ${bg}) 0%, ${bg} 55%)`
    : bg;

  return {
    '--pf-bg': bg,
    '--pf-card': card,
    '--pf-card-border': 'rgba(255, 255, 255, 0.08)',
    '--pf-accent': accent,
    '--pf-accent-fg': contrastOnAccent(accent),
    '--pf-text': base.text,
    '--pf-text-muted': `rgba(${tr}, ${tg}, ${tb}, 0.58)`,
    '--pf-gradient': gradient,
  };
}
