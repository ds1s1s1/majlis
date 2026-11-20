export interface GenreDef {
  id: string;
  ar: string;
  en: string;
}

export const CANONICAL_GENRES: GenreDef[] = [
  { id: 'Action', ar: 'أكشن', en: 'Action' },
  { id: 'Adventure', ar: 'مغامرة', en: 'Adventure' },
  { id: 'Comedy', ar: 'كوميديا', en: 'Comedy' },
  { id: 'Drama', ar: 'دراما', en: 'Drama' },
  { id: 'Fantasy', ar: 'فانتازيا', en: 'Fantasy' },
  { id: 'Sci-Fi', ar: 'خيال علمي', en: 'Sci-Fi' },
  { id: 'Thriller', ar: 'إثارة', en: 'Thriller' },
  { id: 'Horror', ar: 'رعب', en: 'Horror' },
  { id: 'Mystery', ar: 'غموض', en: 'Mystery' },
  { id: 'Crime', ar: 'جريمة', en: 'Crime' },
  { id: 'Animation', ar: 'أنميشن', en: 'Animation' },
  { id: 'Romance', ar: 'رومانسي', en: 'Romance' },
  { id: 'Family', ar: 'عائلي', en: 'Family' },
  { id: 'History', ar: 'تاريخي', en: 'History' },
  { id: 'War', ar: 'حرب', en: 'War' },
  { id: 'Documentary', ar: 'وثائقي', en: 'Documentary' },
];

export const LABEL_MAP: Record<string, { ar: string; en: string }> = {
  ...Object.fromEntries(CANONICAL_GENRES.map((g) => [g.id.toLowerCase(), g])),
  'science fiction': { ar: 'خيال علمي', en: 'Sci-Fi' },
  'action & adventure': { ar: 'أكشن ومغامرة', en: 'Action & Adventure' },
  'sci-fi & fantasy': { ar: 'خيال علمي وفانتازيا', en: 'Sci-Fi & Fantasy' },
  suspense: { ar: 'إثارة', en: 'Thriller' },
  supernatural: { ar: 'فانتازيا', en: 'Fantasy' },
  western: { ar: 'أكشن ومغامرة', en: 'Western' },
  musical: { ar: 'موسيقي', en: 'Musical' },
  music: { ar: 'موسيقي', en: 'Music' },
  biography: { ar: 'سيرة ذاتية', en: 'Biography' },
};

export function genreLabel(raw: string, lang: 'ar' | 'en'): string {
  const k = String(raw || '').trim().toLowerCase();
  const hit = LABEL_MAP[k];
  return hit ? (lang === 'ar' ? hit.ar : hit.en) : raw;
}
