import { CANONICAL_GENRES, LABEL_MAP } from '../config/genres';

export interface SmartFilterChip {
  id: string;
  kind: 'genre' | 'year' | 'rating' | 'runtime' | 'watch' | 'type' | 'text';
  label: string;
  rawToken: string;
}

export interface ParsedSmartQuery {
  raw: string;
  genres: string[];
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  watch?: 'unwatched' | 'watched' | 'in-progress';
  mediaType?: 'movie' | 'series' | 'anime';
  textTerms: string[];
  chips: SmartFilterChip[];
}

export interface SmartFilterCandidate {
  name?: string;
  type?: string;
  year?: number | null;
  genres?: string[];
  runtimeMin?: number | null;
  imdbRating?: number | null;
  rating?: number | null;
  watched?: boolean;
  inProgress?: boolean;
  directors?: string[];
  cast?: string[];
}

const AR_GENRE_ALIASES: Record<string, string> = {
  'اكشن': 'Action',
  'أكشن': 'Action',
  'حركة': 'Action',
  'مغامرة': 'Adventure',
  'مغامرات': 'Adventure',
  'كوميديا': 'Comedy',
  'كوميدي': 'Comedy',
  'دراما': 'Drama',
  'فانتازيا': 'Fantasy',
  'خيال': 'Fantasy',
  'خيال علمي': 'Sci-Fi',
  'اثارة': 'Thriller',
  'إثارة': 'Thriller',
  'تشويق': 'Thriller',
  'رعب': 'Horror',
  'غموض': 'Mystery',
  'جريمة': 'Crime',
  'انيميشن': 'Animation',
  'أنيميشن': 'Animation',
  'كرتون': 'Animation',
  'رسوم': 'Animation',
  'رومانسي': 'Romance',
  'رومانسية': 'Romance',
  'عائلي': 'Family',
  'عائلة': 'Family',
  'تاريخي': 'History',
  'تاريخ': 'History',
  'حرب': 'War',
  'حربي': 'War',
  'وثائقي': 'Documentary',
  'وثائقية': 'Documentary',
};

const CANONICAL_BY_LOWER = (() => {
  const map = new Map<string, string>();
  for (const g of CANONICAL_GENRES) {
    map.set(g.id.toLowerCase(), g.id);
    map.set(g.en.toLowerCase(), g.id);
    map.set(g.ar.toLowerCase(), g.id);
  }
  map.set('scifi', 'Sci-Fi');
  map.set('sci fi', 'Sci-Fi');
  for (const [alias, def] of Object.entries(LABEL_MAP)) {
    map.set(alias.toLowerCase(), def.en.split('&')[0].trim());
  }
  for (const [alias, canonical] of Object.entries(AR_GENRE_ALIASES)) map.set(alias.toLowerCase(), canonical);
  return map;
})();

const DECADE_WORDS: Record<string, [number, number]> = {
  '50s': [1950, 1959],
  '1950s': [1950, 1959],
  'الخمسينات': [1950, 1959],
  'خمسينات': [1950, 1959],
  '60s': [1960, 1969],
  '1960s': [1960, 1969],
  'الستينات': [1960, 1969],
  'ستينات': [1960, 1969],
  '70s': [1970, 1979],
  '1970s': [1970, 1979],
  'السبعينات': [1970, 1979],
  'سبعينات': [1970, 1979],
  '80s': [1980, 1989],
  '1980s': [1980, 1989],
  'الثمانينات': [1980, 1989],
  'ثمانينات': [1980, 1989],
  '90s': [1990, 1999],
  '1990s': [1990, 1999],
  'التسعينات': [1990, 1999],
  'تسعينات': [1990, 1999],
  '00s': [2000, 2009],
  '2000s': [2000, 2009],
  'الألفينات': [2000, 2009],
  'الالفينات': [2000, 2009],
  'الفينات': [2000, 2009],
  '10s': [2010, 2019],
  '2010s': [2010, 2019],
  '20s': [2020, 2029],
  '2020s': [2020, 2029],
  'العشرينات': [2020, 2029],
  'عشرينات': [2020, 2029],
};

function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function normalizeToken(tok: string): string {
  return normalizeDigits(tok.trim()).toLowerCase();
}

function canonicalGenreFor(tok: string): string | null {
  const clean = normalizeToken(tok).replace(/^[#]/, '');
  if (!clean) return null;
  if (CANONICAL_BY_LOWER.has(clean)) return CANONICAL_BY_LOWER.get(clean)!;
  return null;
}

function tokenizeCompound(raw: string): string[] {
  const s = normalizeDigits(raw).trim();
  if (!s) return [];
  // Normalize multi-word Arabic/English phrases into atomic tokens first while keeping raw substrings
  const out: string[] = [];
  const words = s.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    const next = words[i + 1]?.toLowerCase() || '';
    const pair = `${w} ${next}`;
    if (next && (pair === 'خيال علمي' || pair === 'sci fi' || pair === 'غير مشاهد' || pair === 'لم اشاهد' || pair === 'لم أشاهد' || pair === 'لم اشاهده' || pair === 'لم أشاهده')) {
      out.push(`${words[i]} ${words[i + 1]}`);
      i++;
      continue;
    }
    if (next && (w === 'بعد' || w === 'قبل' || w === 'فوق' || w === 'تحت' || w === 'after' || w === 'before') && /^\d{4}$|^\d+(?:\.\d+)?$/.test(next)) {
      out.push(`${words[i]} ${words[i + 1]}`);
      i++;
      continue;
    }
    if ((w === 'اقصر' || w === 'أقصر' || w === 'اقل' || w === 'أقل' || w === 'اطول' || w === 'أطول' || w === 'اكثر' || w === 'أكثر' || w === 'اعلى' || w === 'أعلى') && next === 'من' && words[i + 2]) {
      out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      i += 2;
      continue;
    }
    out.push(words[i]);
  }
  return out;
}

export function parseSmartQuery(raw: string): ParsedSmartQuery {
  const res: ParsedSmartQuery = {
    raw,
    genres: [],
    textTerms: [],
    chips: [],
  };
  const tokens = tokenizeCompound(raw);

  const pushChip = (kind: SmartFilterChip['kind'], label: string, rawToken: string) => {
    res.chips.push({ id: `${kind}:${rawToken}:${res.chips.length}`, kind, label, rawToken });
  };

  for (const rawToken of tokens) {
    const t = normalizeToken(rawToken);
    if (!t) continue;

    // 1. Canonical genres
    const g = canonicalGenreFor(t);
    if (g) {
      if (!res.genres.includes(g)) res.genres.push(g);
      pushChip('genre', g, rawToken);
      continue;
    }

    // 2. Watch status
    if (t === 'unwatched' || t === 'غير مشاهد' || t === 'ماشفته' || t === 'لم اشاهد' || t === 'لم أشاهد' || t === 'لم اشاهده' || t === 'لم أشاهده') {
      res.watch = 'unwatched';
      pushChip('watch', 'Unwatched', rawToken);
      continue;
    }
    if (t === 'watched' || t === 'مشاهد' || t === 'شفته' || t === 'مكتمل' || t === 'completed') {
      res.watch = 'watched';
      pushChip('watch', 'Watched', rawToken);
      continue;
    }
    if (t === 'in-progress' || t === 'inprogress' || t === 'watching' || t === 'مستمر' || t === 'جاري') {
      res.watch = 'in-progress';
      pushChip('watch', 'In Progress', rawToken);
      continue;
    }

    // 3. Media type
    if (t === 'movie' || t === 'movies' || t === 'فيلم' || t === 'افلام' || t === 'أفلام') {
      res.mediaType = 'movie';
      pushChip('type', 'Movie', rawToken);
      continue;
    }
    if (t === 'series' || t === 'show' || t === 'shows' || t === 'tv' || t === 'مسلسل' || t === 'مسلسلات') {
      res.mediaType = 'series';
      pushChip('type', 'Series', rawToken);
      continue;
    }
    if (t === 'anime' || t === 'انمي' || t === 'أنمي') {
      res.mediaType = 'anime';
      pushChip('type', 'Anime', rawToken);
      continue;
    }

    // 4. Decade presets
    if (DECADE_WORDS[t]) {
      const [lo, hi] = DECADE_WORDS[t];
      res.yearMin = lo;
      res.yearMax = hi;
      pushChip('year', `${lo}–${hi}`, rawToken);
      continue;
    }

    // 5. Year expressions: 2020, 2015-2020, year:2022, after:2018, before:2010, >2015, <2005, بعد 2015, قبل 2010
    const yearRange = t.match(/^(19\d{2}|20\d{2})-(19\d{2}|20\d{2})$/);
    if (yearRange) {
      res.yearMin = Number(yearRange[1]);
      res.yearMax = Number(yearRange[2]);
      pushChip('year', `${res.yearMin}–${res.yearMax}`, rawToken);
      continue;
    }
    const yearExact = t.match(/^(?:year:)?(19\d{2}|20\d{2})$/);
    if (yearExact) {
      const y = Number(yearExact[1]);
      res.yearMin = y;
      res.yearMax = y;
      pushChip('year', `${y}`, rawToken);
      continue;
    }
    const yearCmp = t.match(/^(?:after:|بعد\s+|>=?|year>=?)(19\d{2}|20\d{2})$/);
    if (yearCmp) {
      const y = Number(yearCmp[1]);
      const strict = t.startsWith('>') && !t.startsWith('>=');
      res.yearMin = strict ? y + 1 : y;
      pushChip('year', `≥ ${res.yearMin}`, rawToken);
      continue;
    }
    const yearBefore = t.match(/^(?:before:|قبل\s+|<=?|year<=?)(19\d{2}|20\d{2})$/);
    if (yearBefore) {
      const y = Number(yearBefore[1]);
      const strict = t.startsWith('<') && !t.startsWith('<=');
      res.yearMax = strict ? y - 1 : y;
      pushChip('year', `≤ ${res.yearMax}`, rawToken);
      continue;
    }

    // 6. Runtime expressions: <90m, <=120m, >150m, <2h, >2h, short/قصير, long/طويل, أقصر من 90, أطول من 120
    if (t === 'short' || t === 'قصير' || t === 'قصيرة') {
      res.runtimeMax = 95;
      pushChip('runtime', '≤ 95m', rawToken);
      continue;
    }
    if (t === 'long' || t === 'طويل' || t === 'طويلة') {
      res.runtimeMin = 135;
      pushChip('runtime', '≥ 135m', rawToken);
      continue;
    }
    const rtLt = t.match(/^(?:runtime|طول|مدة)?\s*(<=?|<|اقصر من|أقصر من|اقل من|أقل من)\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|m|min|ساعة|ساعات|دقيقة|دقائق)?$/);
    if (rtLt && (rtLt[3] || t.includes('runtime') || t.includes('طول') || t.includes('مدة') || t.includes('اقصر') || t.includes('أقصر') || Number(rtLt[2]) >= 30)) {
      const num = Number(rtLt[2]);
      const isHours = rtLt[3] === 'h' || rtLt[3] === 'hr' || rtLt[3] === 'hrs' || rtLt[3] === 'ساعة' || rtLt[3] === 'ساعات';
      const mins = Math.round(isHours ? num * 60 : num);
      res.runtimeMax = rtLt[1] === '<' ? mins - 1 : mins;
      pushChip('runtime', `≤ ${res.runtimeMax}m`, rawToken);
      continue;
    }
    const rtGt = t.match(/^(?:runtime|طول|مدة)?\s*(>=?|>|اطول من|أطول من|اكثر من|أكثر من)\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|m|min|ساعة|ساعات|دقيقة|دقائق)?$/);
    if (rtGt && (rtGt[3] || t.includes('runtime') || t.includes('طول') || t.includes('مدة') || t.includes('اطول') || t.includes('أطول') || Number(rtGt[2]) >= 30)) {
      const num = Number(rtGt[2]);
      const isHours = rtGt[3] === 'h' || rtGt[3] === 'hr' || rtGt[3] === 'hrs' || rtGt[3] === 'ساعة' || rtGt[3] === 'ساعات';
      const mins = Math.round(isHours ? num * 60 : num);
      res.runtimeMin = rtGt[1] === '>' ? mins + 1 : mins;
      pushChip('runtime', `≥ ${res.runtimeMin}m`, rawToken);
      continue;
    }

    // 7. Rating expressions: 7+, 7.5+, >7, >=8, rating:7.5, imdb:8, تقييم>=7, أعلى من 7, فوق 7
    const ratePlus = t.match(/^(\d(?:\.\d)?)\+$/);
    if (ratePlus) {
      res.ratingMin = Number(ratePlus[1]);
      pushChip('rating', `★ ≥ ${res.ratingMin}`, rawToken);
      continue;
    }
    const rateMin = t.match(/^(?:rating:|imdb:|تقييم)?\s*(>=?|>|:|فوق |اعلى من |أعلى من )(\d(?:\.\d)?)$/);
    if (rateMin && Number(rateMin[2]) <= 10) {
      res.ratingMin = Number(rateMin[2]);
      pushChip('rating', `★ ≥ ${res.ratingMin}`, rawToken);
      continue;
    }
    const rateMax = t.match(/^(?:rating:|imdb:|تقييم)?\s*(<=?|<|تحت |اقل من |أقل من )(\d(?:\.\d)?)$/);
    if (rateMax && Number(rateMax[2]) <= 10) {
      res.ratingMax = Number(rateMax[2]);
      pushChip('rating', `★ ≤ ${res.ratingMax}`, rawToken);
      continue;
    }

    // 8. Fallback text term
    res.textTerms.push(t);
    pushChip('text', rawToken, rawToken);
  }

  return res;
}

export function matchesSmartQuery(entry: SmartFilterCandidate, queryOrParsed: string | ParsedSmartQuery): boolean {
  const q = typeof queryOrParsed === 'string' ? parseSmartQuery(queryOrParsed) : queryOrParsed;

  if (q.mediaType) {
    if (q.mediaType === 'anime') {
      const gList = (entry.genres || []).map((x) => canonicalGenreFor(x) || x.toLowerCase());
      const isAnime = entry.type === 'anime' || gList.includes('Animation') || gList.includes('anime');
      if (!isAnime) return false;
    } else if (entry.type !== q.mediaType) {
      return false;
    }
  }

  if (q.watch === 'watched' && !entry.watched) return false;
  if (q.watch === 'unwatched' && entry.watched) return false;
  if (q.watch === 'in-progress' && !entry.inProgress) return false;

  if (q.genres.length) {
    const entryGenres = new Set(
      (entry.genres || []).map((g) => canonicalGenreFor(g) || g.trim().toLowerCase()),
    );
    for (const wanted of q.genres) {
      if (!entryGenres.has(wanted) && !entryGenres.has(wanted.toLowerCase())) return false;
    }
  }

  if (q.yearMin != null || q.yearMax != null) {
    const y = typeof entry.year === 'number' && entry.year > 0 ? entry.year : null;
    if (y == null) return false;
    if (q.yearMin != null && y < q.yearMin) return false;
    if (q.yearMax != null && y > q.yearMax) return false;
  }

  if (q.ratingMin != null || q.ratingMax != null) {
    const rRaw = entry.imdbRating ?? entry.rating;
    const r = typeof rRaw === 'number' && rRaw > 0 ? rRaw : null;
    if (r == null) return false;
    if (q.ratingMin != null && r < q.ratingMin) return false;
    if (q.ratingMax != null && r > q.ratingMax) return false;
  }

  if (q.runtimeMin != null || q.runtimeMax != null) {
    const rt = typeof entry.runtimeMin === 'number' && entry.runtimeMin > 0 ? entry.runtimeMin : null;
    if (rt == null) return false;
    if (q.runtimeMin != null && rt < q.runtimeMin) return false;
    if (q.runtimeMax != null && rt > q.runtimeMax) return false;
  }

  if (q.textTerms.length) {
    const haystack = [
      entry.name || '',
      ...(entry.genres || []),
      ...(entry.directors || []),
      ...(entry.cast || []),
    ].join(' ').toLowerCase();
    for (const term of q.textTerms) {
      if (!haystack.includes(term)) return false;
    }
  }

  return true;
}

export function removeSmartToken(raw: string, rawToken: string): string {
  const escaped = rawToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw
    .replace(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
