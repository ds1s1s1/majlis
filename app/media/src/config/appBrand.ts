// Brand configuration for Majlis (100% local-first & P2P, zero custom domains or hosted central accounts).
export const APP_BRAND = {
  nameAr: 'مجلس',
  nameEn: 'Majlis',
  repoUrl: 'https://github.com/ds1s1s1/majlis',
  version: '0.1beta',
  build: '2026.11-v0.1beta',
  docsUrl: 'https://github.com/ds1s1s1/majlis#readme',
  issuesUrl: 'https://github.com/ds1s1s1/majlis/issues',
  defaultLocale: 'ar' as 'ar' | 'en',
  colors: {
    obsidianBg: '#12100E',
    obsidianCard: '#181613',
    goldAccent: '#E5A93C',
    goldFg: '#12100E',
    textPrimary: '#F2EFE9',
    textMuted: '#8E887E',
  },
} as const;

export const APP_NAME = APP_BRAND.nameEn;
export const APP_VERSION = APP_BRAND.version;
export const APP_BUILD = APP_BRAND.build;
export const DOCS_URL = APP_BRAND.docsUrl;
export const DEFAULT_LOCALE = APP_BRAND.defaultLocale;

export function friendLinkFor(idOrHandle: string): string {
  const clean = String(idOrHandle || '').replace(/^@+/, '').trim();
  return clean ? `majlis://friend/${encodeURIComponent(clean)}` : 'majlis://friend';
}
