'use strict';
// Canonical genres across TMDB, Cinemeta, AniList, Streaming Catalogs, and built-in seed pool.

const CANONICAL_GENRES = [
  { id: 'Action', ar: 'أكشن', en: 'Action', tmdbId: 28 },
  { id: 'Adventure', ar: 'مغامرة', en: 'Adventure', tmdbId: 12 },
  { id: 'Comedy', ar: 'كوميديا', en: 'Comedy', tmdbId: 35 },
  { id: 'Drama', ar: 'دراما', en: 'Drama', tmdbId: 18 },
  { id: 'Fantasy', ar: 'فانتازيا', en: 'Fantasy', tmdbId: 14 },
  { id: 'Sci-Fi', ar: 'خيال علمي', en: 'Sci-Fi', tmdbId: 878 },
  { id: 'Thriller', ar: 'إثارة', en: 'Thriller', tmdbId: 53 },
  { id: 'Horror', ar: 'رعب', en: 'Horror', tmdbId: 27 },
  { id: 'Mystery', ar: 'غموض', en: 'Mystery', tmdbId: 9648 },
  { id: 'Crime', ar: 'جريمة', en: 'Crime', tmdbId: 80 },
  { id: 'Animation', ar: 'أنميشن', en: 'Animation', tmdbId: 16 },
  { id: 'Romance', ar: 'رومانسي', en: 'Romance', tmdbId: 10749 },
  { id: 'Family', ar: 'عائلي', en: 'Family', tmdbId: 10751 },
  { id: 'History', ar: 'تاريخي', en: 'History', tmdbId: 36 },
  { id: 'War', ar: 'حرب', en: 'War', tmdbId: 10752 },
  { id: 'Documentary', ar: 'وثائقي', en: 'Documentary', tmdbId: 99 },
];

const GENRE_BY_LOW = Object.fromEntries(CANONICAL_GENRES.map((g) => [g.id.toLowerCase(), g]));
const GENRE_TO_TMDB_ID = Object.fromEntries(CANONICAL_GENRES.map((g) => [g.id, g.tmdbId]));

// Both Movie and TV TMDB genre IDs -> canonical Majlis genres
const TMDB_ID_TO_GENRES = {
  28: ['Action'],
  12: ['Adventure'],
  16: ['Animation'],
  35: ['Comedy'],
  80: ['Crime'],
  99: ['Documentary'],
  18: ['Drama'],
  10751: ['Family'],
  14: ['Fantasy'],
  36: ['History'],
  27: ['Horror'],
  10402: ['Drama'],
  9648: ['Mystery'],
  10749: ['Romance'],
  878: ['Sci-Fi'],
  10770: ['Drama'],
  53: ['Thriller'],
  10752: ['War'],
  37: ['Action', 'Adventure'],
  10759: ['Action', 'Adventure'],
  10762: ['Family'],
  10763: ['Documentary'],
  10764: ['Comedy'],
  10765: ['Sci-Fi', 'Fantasy'],
  10766: ['Drama'],
  10767: ['Comedy'],
  10768: ['War', 'Drama'],
};

const ALIAS_MAP = {
  'action & adventure': ['Action', 'Adventure'],
  'action-adventure': ['Action', 'Adventure'],
  'sci-fi & fantasy': ['Sci-Fi', 'Fantasy'],
  'science fiction': ['Sci-Fi'],
  'sci fi': ['Sci-Fi'],
  'scifi': ['Sci-Fi'],
  'war & politics': ['War', 'Drama'],
  suspense: ['Thriller'],
  historical: ['History'],
  supernatural: ['Fantasy'],
  psychological: ['Thriller'],
  anime: ['Animation'],
  kids: ['Family'],
  biography: ['History', 'Drama'],
  western: ['Action', 'Adventure'],
  musical: ['Comedy'],
  music: ['Drama'],
  sport: ['Drama'],
  'أكشن': ['Action'],
  'اكشن': ['Action'],
  'مغامرة': ['Adventure'],
  'مغامرات': ['Adventure'],
  'كوميديا': ['Comedy'],
  'كوميدي': ['Comedy'],
  'دراما': ['Drama'],
  'فانتازيا': ['Fantasy'],
  'خيال': ['Fantasy'],
  'خيال علمي': ['Sci-Fi'],
  'إثارة': ['Thriller'],
  'اثارة': ['Thriller'],
  'تشويق': ['Thriller'],
  'رعب': ['Horror'],
  'غموض': ['Mystery'],
  'جريمة': ['Crime'],
  'أنميشن': ['Animation'],
  'انميشن': ['Animation'],
  'رسوم متحركة': ['Animation'],
  'أنمي': ['Animation'],
  'رومانسي': ['Romance'],
  'رومانسية': ['Romance'],
  'عائلي': ['Family'],
  'تاريخي': ['History'],
  'حرب': ['War'],
  'وثائقي': ['Documentary'],
};

function mapOneGenre(raw) {
  if (raw == null) return [];
  if (typeof raw === 'number') return TMDB_ID_TO_GENRES[raw] || [];
  if (typeof raw === 'object') {
    if (typeof raw.id === 'number' && TMDB_ID_TO_GENRES[raw.id]) return TMDB_ID_TO_GENRES[raw.id];
    raw = raw.name || raw.id || '';
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (/^\d+$/.test(s) && TMDB_ID_TO_GENRES[+s]) return TMDB_ID_TO_GENRES[+s];
  const low = s.toLowerCase();
  if (GENRE_BY_LOW[low]) return [GENRE_BY_LOW[low].id];
  if (ALIAS_MAP[low]) return ALIAS_MAP[low];
  // Handle compound strings separated by "/" or "&" or ","
  if (/[\/,&]/.test(s)) {
    const parts = s.split(/[\/,&]/).flatMap((p) => mapOneGenre(p));
    if (parts.length) return parts;
  }
  return [s];
}

function normalizeGenres(rawGenres, genreIds = null) {
  const seen = new Set();
  const out = [];
  const push = (g) => {
    const k = g.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(g);
  };
  const list = Array.isArray(rawGenres) ? rawGenres : (typeof rawGenres === 'string' ? [rawGenres] : []);
  for (const item of list) for (const g of mapOneGenre(item)) push(g);
  if (Array.isArray(genreIds)) {
    for (const id of genreIds) for (const g of (TMDB_ID_TO_GENRES[id] || [])) push(g);
  }
  return out;
}

module.exports = { CANONICAL_GENRES, GENRE_TO_TMDB_ID, TMDB_ID_TO_GENRES, normalizeGenres };
