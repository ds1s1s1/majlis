// Cinema strings. ar and en must have the same keys (test/media-i18n.test.js checks).
export const STR = {
  ar: {
    home: 'الرئيسية', discover: 'اكتشف', catalogs: 'الكتالوجات', movies: 'أفلام', shows: 'مسلسلات', anime: 'أنمي', calendar: 'التقويم',
    library: 'مكتبتي', collections: 'المجموعات', downloads: 'التنزيلات', addons: 'الإضافات', party: 'المجلس', search: 'بحث', notifications: 'التنبيهات', profile: 'الملف',
    back_majlis: 'رجوع لمجلس', back: 'رجوع',
    play: 'شغّل', resume: 'كمّل', more_info: 'تفاصيل', trailer: 'الإعلان', add_library: 'أضف لمكتبتي', in_library: 'في مكتبتي', watchlist: 'قائمة المشاهدة', favorite: 'المفضلة',
    continue_watching: 'كمّل المشاهدة', top10: 'أعلى ١٠ اليوم', top10_movies: 'أعلى ١٠ أفلام اليوم', top10_shows: 'أعلى ١٠ مسلسلات اليوم', up_next: 'التالي',
    season: 'الموسم {n}', seasons_n: 'مواسم: {n}', episode_short: 'ح{n}', specials: 'خاصة', episodes: 'الحلقات', cast: 'الممثلون', more_like: 'أعمال مشابهة', part_of: 'من مجموعة {name}',
    sources: 'المصادر', best_source: 'الأفضل', no_sources: 'ما فيه مصادر لهذا. ثبّت إضافة مصادر من صفحة الإضافات.', loading_sources: 'نجيب المصادر من {n} إضافة...',
    instant: 'فوري', cached: 'جاهز', seeders: '{n} ناشر', dead: 'ميت', rough: 'نسخة سينما', arabic_sub: 'عربي',
    search_ph: 'دوّر فلم، مسلسل، ممثل...', search_empty: 'اكتب اسم عشان نبحث', no_results: 'ما لقينا شي باسم "{q}"',
    watched: 'شفته', mark_watched: 'علّم كمشاهَد', mark_unwatched: 'شيل علامة المشاهدة', left: 'باقي {n} د', new: 'جديد', min: '{n} د',
    error_load: 'ما قدرنا نجيبها. جرّب بعد شوي.', retry: 'حاول مرة ثانية', see_all: 'عرض الكل', all: 'الكل', type_movie: 'أفلام', type_series: 'مسلسلات',
    playing: 'يشتغل...', episode_n: 'الحلقة {n}', released_on: 'يعرض {d}',
  },
  en: {
    home: 'Home', discover: 'Discover', catalogs: 'Catalogs', movies: 'Movies', shows: 'Shows', anime: 'Anime', calendar: 'Calendar',
    library: 'Library', collections: 'Collections', downloads: 'Downloads', addons: 'Addons', party: 'Majlis', search: 'Search', notifications: 'Notifications', profile: 'Profile',
    back_majlis: 'Back to Majlis', back: 'Back',
    play: 'Play', resume: 'Resume', more_info: 'More info', trailer: 'Trailer', add_library: 'Add to library', in_library: 'In library', watchlist: 'Watchlist', favorite: 'Favorite',
    continue_watching: 'Continue watching', top10: 'Top 10 today', top10_movies: 'Top 10 movies today', top10_shows: 'Top 10 shows today', up_next: 'Up next',
    season: 'Season {n}', seasons_n: 'Seasons: {n}', episode_short: 'E{n}', specials: 'Specials', episodes: 'Episodes', cast: 'Cast', more_like: 'More like this', part_of: 'Part of {name}',
    sources: 'Sources', best_source: 'Best', no_sources: 'No sources for this. Install a stream addon from the Addons page.', loading_sources: 'Asking {n} addons for sources...',
    instant: 'Instant', cached: 'Cached', seeders: '{n} seeders', dead: 'Dead', rough: 'Cam copy', arabic_sub: 'Arabic',
    search_ph: 'Search movies, shows, people...', search_empty: 'Type a name to search', no_results: 'Nothing found for "{q}"',
    watched: 'Watched', mark_watched: 'Mark as watched', mark_unwatched: 'Mark as unwatched', left: '{n} min left', new: 'New', min: '{n} min',
    error_load: "Couldn't load this. Try again in a moment.", retry: 'Try again', see_all: 'See all', all: 'All', type_movie: 'Movies', type_series: 'Shows',
    playing: 'Starting...', episode_n: 'Episode {n}', released_on: 'Airs {d}',
  },
} as const;

export type Key = keyof typeof STR.en;
export type Lang = 'ar' | 'en';

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>) {
  let s: string = STR[lang][key] ?? STR.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
