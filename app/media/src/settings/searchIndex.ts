import type { SettingsCategoryId, SettingsPageId } from './useSettingsStore';

export interface SettingsNavItem {
  id: SettingsPageId;
  category: SettingsCategoryId | 'updates-backup';
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  keywords: string[];
}

export interface SettingsCategoryDef {
  id: SettingsCategoryId;
  titleEn: string;
  titleAr: string;
}

export const SETTINGS_CATEGORIES: SettingsCategoryDef[] = [
  { id: 'account-setup', titleEn: 'Account & setup', titleAr: 'الحساب والإعداد' },
  { id: 'playback', titleEn: 'Playback', titleAr: 'التشغيل' },
  { id: 'languages', titleEn: 'Languages', titleAr: 'اللغات والترجمة' },
  { id: 'sources-library', titleEn: 'Sources & library', titleAr: 'المصادر والمكتبة' },
  { id: 'plugins', titleEn: 'Plugins', titleAr: 'الإضافات' },
  { id: 'appearance', titleEn: 'Appearance', titleAr: 'المظهر' },
  { id: 'controls-devices', titleEn: 'Controls & devices', titleAr: 'التحكم والأجهزة' },
  { id: 'system', titleEn: 'System', titleAr: 'النظام' },
  { id: 'help-about', titleEn: 'Help & about', titleAr: 'المساعدة وحول' },
];

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  // 1. Account & setup
  { id: 'get-started', category: 'account-setup', titleEn: 'Get started', titleAr: 'البداية السريعة', descEn: 'Essentials, Instant Play vs Pick Source, Sports notice', descAr: 'الأساسيات والتشغيل الفوري والرياضة', keywords: ['essentials', 'instant play', 'pick a source', 'sports', 'engine'] },
  { id: 'your-profile', category: 'account-setup', titleEn: 'Your profile', titleAr: 'ملفك الشخصي', descEn: 'Display name, avatar presets, color, profile songs, P2P ID', descAr: 'الاسم، الصورة، اللون الشخصي، أغنية الملف، الهوية المباشرة', keywords: ['avatar', 'name', 'color', 'song', 'profile', 'identity', 'p2p', 'id'] },
  { id: 'profiles', category: 'account-setup', titleEn: 'Profiles', titleAr: 'الملفات المتعددة', descEn: 'Household profiles switcher & secondary privileges', descAr: 'تبديل الملفات وصلاحيات الملفات الثانوية', keywords: ['profiles', 'household', 'privileges', 'shared', 'independent'] },
  { id: 'addon-sync', category: 'account-setup', titleEn: 'Stremio & Addon Sync', titleAr: 'مزامنة ستريميو والإضافات', descEn: 'Install links, synced addons, re-authenticate', descAr: 'روابط التثبيت ومزامنة الإضافات', keywords: ['stremio', 'addon sync', 'install links', 'protocol'] },
  { id: 'tracker-trakt', category: 'account-setup', titleEn: 'Trakt', titleAr: 'تراكت Trakt', descEn: 'Watchlist sync, scrobble, comments toggle', descAr: 'مزامنة السجل والقوائم والتعليقات', keywords: ['trakt', 'scrobble', 'watchlist', 'comments'] },
  { id: 'tracker-simkl', category: 'account-setup', titleEn: 'Simkl', titleAr: 'سيمكل Simkl', descEn: 'TV, anime & movies tracking sync', descAr: 'تتبع المسلسلات والأنمي والأفلام', keywords: ['simkl', 'scrobble', 'sync'] },
  { id: 'tracker-anilist', category: 'account-setup', titleEn: 'AniList', titleAr: 'أني ليست AniList', descEn: 'Anime library sync & scrobbling', descAr: 'مزامنة قائمة الأنمي والتقدم', keywords: ['anilist', 'anime', 'scrobble'] },
  { id: 'tracker-mal', category: 'account-setup', titleEn: 'MyAnimeList', titleAr: 'ماي أنمي ليست MAL', descEn: 'MyAnimeList OAuth & import', descAr: 'ربط واستيراد قائمة MAL', keywords: ['mal', 'myanimelist', 'anime'] },
  { id: 'tracker-letterboxd', category: 'account-setup', titleEn: 'Letterboxd', titleAr: 'ليتربوكسد Letterboxd', descEn: 'ZIP import, public/full mode, logging', descAr: 'استيراد البيانات والسجل اليومي', keywords: ['letterboxd', 'csv', 'zip', 'films'] },
  { id: 'tracker-publicmetadb', category: 'account-setup', titleEn: 'PublicMetaDB', titleAr: 'PublicMetaDB', descEn: 'Community metadata & scrobble sync', descAr: 'قاعدة البيانات المجتمعية ومزامنتها', keywords: ['publicmetadb', 'metadata', 'scrobble'] },
  { id: 'relay', category: 'account-setup', titleEn: 'Watch Together Relay', titleAr: 'سيرفر السهرة المشتركة', descEn: 'Relay URL, Signaling WS, Invite Base, latency test', descAr: 'حالة سيرفر المزامنة وإشارات WebSocket واختبار الاتصال', keywords: ['relay', 'server', 'serverWs', 'inviteBase', 'latency', 'turn', 'credentials', 'access key', 'signaling'] },
  { id: 'manage-accounts', category: 'account-setup', titleEn: 'Manage accounts', titleAr: 'إدارة الحسابات', descEn: 'Overview of all linked trackers & services', descAr: 'جدول موحد لجميع الحسابات المرتبطة', keywords: ['manage', 'accounts', 'disconnect', 'sync all'] },

  // 2. Playback
  { id: 'when-you-press-play', category: 'playback', titleEn: 'When you press Play', titleAr: 'عند الضغط على تشغيل', descEn: 'Instant vs Pick, PiP style, resume, stalled skip', descAr: 'التشغيل الفوري، الاستئناف، وتجاوز المصادر المعطلة', keywords: ['play', 'pip', 'resume', 'stalled', 'stream'] },
  { id: 'video-player', category: 'playback', titleEn: 'Video player', titleAr: 'مشغل الفيديو', descEn: 'Auto/HTML5/mpv engine, HDR, OLED/LCD, RTX VSR, Speed test', descAr: 'محرك libmpv، HDR، RTX VSR، واختبار السرعة', keywords: ['mpv', 'html5', 'hdr', 'rtx', 'vsr', 'oled', 'speed test', 'line-free'] },
  { id: 'aspect-ratio', category: 'playback', titleEn: 'Aspect ratio', titleAr: 'نسبة العرض', descEn: 'Fit, Fill, Stretch, 16:9, 21:9, 2.39:1 live preview', descAr: 'معاينة حية لنسب الشاشة والأبعاد', keywords: ['aspect', 'ratio', '21:9', '16:9', 'crop', 'fit', 'stretch'] },
  { id: 'audio', category: 'playback', titleEn: 'Audio', titleAr: 'الصوت', descEn: 'Loudness normalize, downmix, Equalizer, 400% boost', descAr: 'معادلة الصوت، المعادل، ورفع مستوى الصوت', keywords: ['audio', 'equalizer', 'loudness', 'volume boost', 'surround', 'device'] },
  { id: 'on-screen-controls', category: 'playback', titleEn: 'On-screen controls', titleAr: 'أزرار الشاشة', descEn: 'Fullscreen mode, sleep timer, volume pop-up position', descAr: 'ملء الشاشة، مؤقت النوم، وموقع منبثق الصوت', keywords: ['controls', 'fullscreen', 'borderless', 'sleep timer', 'volume popup'] },
  { id: 'xray', category: 'playback', titleEn: 'X-Ray', titleAr: 'أشعة الممثلين X-Ray', descEn: 'Cast cards & actor info when paused', descAr: 'إظهار طاقم التمثيل عند الإيقاف المؤقت', keywords: ['xray', 'cast', 'actors', 'pause'] },
  { id: 'ad-skipping', category: 'playback', titleEn: 'Ad skipping', titleAr: 'تخطي الإعلانات', descEn: 'Injected segment detection & skip timeline', descAr: 'تخطي المقاطع المدمجة تلقائياً', keywords: ['ads', 'skip', 'timeline'] },
  { id: 'intros', category: 'playback', titleEn: 'Intros & recaps', titleAr: 'المقدمات والشارات', descEn: 'Skip button, auto-skip intro/recap/credits, API key', descAr: 'تخطي المقدمات والملخصات والنهايات', keywords: ['intro', 'aniskip', 'recap', 'credits', 'outro'] },
  { id: 'up-next', category: 'playback', titleEn: 'Up next', titleAr: 'الحلقة التالية', descEn: 'Next episode countdown, still watching, recommendations', descAr: 'تشغيل الحلقة التالية تلقائياً والعد التنازلي', keywords: ['up next', 'auto play', 'countdown', 'still watching'] },
  { id: 'trailers', category: 'playback', titleEn: 'Trailers', titleAr: 'الإعلانات الترويجية', descEn: 'Trailer quality & auto-play on detail pages', descAr: 'جودة العرض الترويجي والتشغيل التلقائي', keywords: ['trailers', '2160p', '1080p', 'autoplay'] },
  { id: 'video-quality', category: 'playback', titleEn: 'Video quality', titleAr: 'جودة الفيديو والعتاد', descEn: 'Quality presets, hardware decoding, GPU-next renderer', descAr: 'فك التشفير بالعتاد وجودة الصورة', keywords: ['hardware acceleration', 'gpu-next', 'quality', 'weak pcs'] },
  { id: 'picture-adjustments', category: 'playback', titleEn: 'Picture adjustments', titleAr: 'تعديل الألوان والصورة', descEn: 'Brightness, contrast, saturation, sharpen, tone-mapping curves', descAr: 'السطوع والتباين ومنحنيات معالجة HDR', keywords: ['brightness', 'contrast', 'saturation', 'gamma', 'sharpen', 'tone mapping', 'bt.2390'] },
  { id: 'playback-buffering', category: 'playback', titleEn: 'Playback buffering', titleAr: 'التخزين المؤقت', descEn: 'Read-ahead buffer size & memory cap readouts', descAr: 'حجم الذاكرة المسبقة وسرعة بدء التشغيل', keywords: ['buffer', 'cache', 'memory', 'read-ahead'] },
  { id: 'mpv-conf', category: 'playback', titleEn: 'Advanced mpv.conf', titleAr: 'إعدادات mpv.conf المتقدمة', descEn: 'Raw mpv.conf editor & live generated options viewer', descAr: 'محرر أوامر libmpv ومعاينة الخيارات المولدة', keywords: ['mpv.conf', 'vo', 'hwdec', 'raw config'] },
  { id: 'anime-shaders', category: 'playback', titleEn: 'Anime Shaders', titleAr: 'مظللات الأنمي Anime4K', descEn: 'Anime4K Modes A/B/C/A+A, FSRCNNX, RAVU, NNEDI3', descAr: 'تحسين رسم الأنمي بدقة عالية عبر GPU', keywords: ['anime4k', 'fsrcnnx', 'ravu', 'nnedi3', 'shaders'] },
  { id: 'manga-shaders', category: 'playback', titleEn: 'Manga Shaders', titleAr: 'تحسين المانجا', descEn: 'Fast 2x upscaling model & footprint controls', descAr: 'نموذج مضاعفة دقة الصفحات السريع', keywords: ['manga', 'upscale', 'fast 2x'] },
  { id: 'image-shaders', category: 'playback', titleEn: 'Image Shaders', titleAr: 'مظللات الصورة العامة', descEn: 'AMD FSR, NVIDIA NIS, SGSR, SSimSuperRes, CAS, hdr-toys', descAr: 'مظللات الترقية والحدة ومعالجة الألوان', keywords: ['fsr', 'nis', 'sgsr', 'cas', 'krigbilateral', 'ssim', 'hdr-toys'] },
  { id: 'motion-smoothing', category: 'playback', titleEn: 'Motion smoothing', titleAr: 'تنعيم الحركة', descEn: '24fps vs 60fps side-by-side live motion comparison', descAr: 'مقارنة حية لتنعيم حركة الإطارات', keywords: ['interpolation', '60fps', '24fps', 'motion', 'smoothing'] },
  { id: 'svp-interpolation', category: 'playback', titleEn: 'SVP interpolation', titleAr: 'دمج SVP', descEn: 'SVP engine detection, target content & framerate', descAr: 'اكتشاف محرك SVP وإعداد الإطارات', keywords: ['svp', '120 fps', 'interpolation'] },

  // 3. Languages
  { id: 'app-language', category: 'languages', titleEn: 'App language', titleAr: 'لغة التطبيق والمنطقة', descEn: 'Region selector, 16-language grid, live RTL/LTR switch', descAr: 'المنطقة وشبكة اللغات وتغيير الاتجاه فوراً', keywords: ['language', 'arabic', 'english', 'rtl', 'ltr', 'region', 'anime titles'] },
  { id: 'audio-languages', category: 'languages', titleEn: 'Audio languages', titleAr: 'لغات الصوت', descEn: 'Preferred audio track priority & skip keyword chips', descAr: 'أولوية المسارات الصوتية واستبعاد التعليق', keywords: ['audio', 'track', 'commentary', 'priority'] },
  { id: 'discovery-languages', category: 'languages', titleEn: 'Discovery languages', titleAr: 'لغات الاستكشاف', descEn: 'Home catalog language filter & stream boost', descAr: 'لغات الكتالوجات وتعزيز نتائج البحث', keywords: ['discovery', 'catalogs', 'ranking', 'filter'] },
  { id: 'subtitle-languages', category: 'languages', titleEn: 'Subtitle languages', titleAr: 'لغات الترجمة', descEn: 'Primary priority, dual subs, forced/embedded preferences', descAr: 'ترتيب لغات الترجمة والترجمة المزدوجة', keywords: ['subtitles', 'dual subs', 'forced', 'embedded'] },
  { id: 'subtitle-sources', category: 'languages', titleEn: 'Subtitle sources', titleAr: 'مصادر الترجمة', descEn: 'OpenSubtitles, SubDL, Subsource keys & addons', descAr: 'مزودو ملفات الترجمة ومفاتيح API', keywords: ['opensubtitles', 'subdl', 'subsource', 'addons'] },
  { id: 'subtitle-sync', category: 'languages', titleEn: 'Subtitle sync', titleAr: 'مزامنة الترجمة', descEn: 'Audio-based auto-sync & private local mode', descAr: 'المزامنة التلقائية بالصوت والوضع الخاص', keywords: ['sync', 'timing', 'model'] },
  { id: 'subtitle-style', category: 'languages', titleEn: 'Subtitle style', titleAr: 'تنسيق ومظهر الترجمة', descEn: 'Live cinema preview with outline, font size, opacity, color', descAr: 'معاينة فورية لحجم ولون وظل الترجمة', keywords: ['font', 'size', 'outline', 'shadow', 'color', 'opacity', 'subtitle style'] },

  // 4. Sources & library
  { id: 'streaming-services', category: 'sources-library', titleEn: 'Streaming services', titleAr: 'خدمات البث والديبريد', descEn: 'Debrid tokens (RD/TorBox/Premiumize), Usenet, catalogs grid', descAr: 'مفاتيح Real-Debrid و TorBox وكتالوجات المنصات', keywords: ['real-debrid', 'torbox', 'alldebrid', 'premiumize', 'usenet', 'netflix', 'catalogs'] },
  { id: 'home-servers', category: 'sources-library', titleEn: 'Home servers', titleAr: 'السيرفرات المنزلية', descEn: 'Connect Jellyfin, Emby, or Plex servers', descAr: 'ربط خوادم Jellyfin و Emby و Plex', keywords: ['jellyfin', 'emby', 'plex', 'nas', 'local server'] },
  { id: 'source-preferences', category: 'sources-library', titleEn: 'Source preferences', titleAr: 'تفضيلات المصادر', descEn: 'Stream safety filter (Strict/Balanced/Off), fansub, wait time', descAr: 'فلتر الأمان، أنمي فانسب، ومهلة الانتظار', keywords: ['safety', 'trustgate', 'strict', 'timeout', 'fansub'] },
  { id: 'source-order', category: 'sources-library', titleEn: 'Source order', titleAr: 'ترتيب المصادر', descEn: 'Smart ranking vs addon order, priority list', descAr: 'الترتيب الذكي وتحديد أولوية المزودين', keywords: ['ranking', 'priority', 'aggregate'] },
  { id: 'source-picker', category: 'sources-library', titleEn: 'Source picker', titleAr: 'قائمة اختيار المصادر', descEn: 'Condensed vs Cards layout, P2P/Debrid filter', descAr: 'عرض البطاقات أو القائمة المضغوطة', keywords: ['picker', 'condensed', 'cards', 'debrid', 'p2p'] },
  { id: 'stream-filters', category: 'sources-library', titleEn: 'Stream filters', titleAr: 'فلاتر الروابط', descEn: 'Custom saved quality & codec filters', descAr: 'حفظ فلاتر الدقة والكوديك والحجم', keywords: ['filter', 'hdr', 'dv', 'size', 'exclude'] },
  { id: 'p2p-engine', category: 'sources-library', titleEn: 'P2P & Network engine', titleAr: 'محرك P2P والشبكة', descEn: 'Telemetry, SVG network topology, connection self-test', descAr: 'فحص الشبكة ومخطط الاتصال وإدارة P2P', keywords: ['p2p', 'torrent', 'dht', 'turn', 'diagnostics', 'netcheck'] },
  { id: 'streaming-server', category: 'sources-library', titleEn: 'Streaming server', titleAr: 'خادم البث المحلي', descEn: 'Localhost/LAN endpoints & remote server URL', descAr: 'روابط البث على الشبكة المحلية والبعيدة', keywords: ['11470', 'lan', 'server', 'remote'] },
  { id: 'home', category: 'sources-library', titleEn: 'Home', titleAr: 'الصفحة الرئيسية', descEn: 'Hero banner, Zen mode, Continue Watching', descAr: 'الهيرو، وضع التركيز الهادئ Zen، وصف متابعة المشاهدة', keywords: ['hero', 'zen', 'zen mode', 'continue watching', 'screenshots', 'home style'] },
  { id: 'cards', category: 'sources-library', titleEn: 'Cards & scores', titleAr: 'البطاقات والتقييمات', descEn: 'Live interactive poster mockup & 10-provider score matrix', descAr: 'معاينة البوستر ومصفوفة التقييمات العشرية', keywords: ['cards', 'poster', 'imdb', 'tmdb', 'mal', 'anilist', 'top 10', 'dub'] },
  { id: 'detail-pages', category: 'sources-library', titleEn: 'Detail pages', titleAr: 'صفحات التفاصيل', descEn: 'Spoilers blur, episode card size live preview, filler filter', descAr: 'إخفاء الحرق، حجم بطاقات الحلقات، والفلر', keywords: ['spoilers', 'episode cards', 'filler', 'backdrop'] },
  { id: 'metadata-providers', category: 'sources-library', titleEn: 'Metadata providers', titleAr: 'مزودو البيانات الوصفية', descEn: 'TMDB/OMDb/RPDB/Fanart keys & TVDB vs TMDB episode order', descAr: 'مفاتيح TMDB و RPDB ومقارنة ترتيب المواسم', keywords: ['tmdb', 'omdb', 'tvdb', 'fanart', 'rpdb', 'mdblist', 'episode order'] },
  { id: 'search', category: 'sources-library', titleEn: 'Search & AI', titleAr: 'البحث والذكاء الاصطناعي', descEn: 'Quick shortcut, AI search providers, Jina/Tavily', descAr: 'اختصار البحث والبحث الذكي والمصادر الحية', keywords: ['search', 'ai', 'openai', 'deepseek', 'gemini', 'openrouter', 'ollama'] },
  { id: 'library', category: 'sources-library', titleEn: 'Library', titleAr: 'المكتبة', descEn: 'Anime/adult filters, local folder sync & artwork export', descAr: 'تصفية المكتبة والمجلدات المحلية وتصدير الأغلفة', keywords: ['library', 'local folders', 'artwork', 'min file size'] },

  // 5. Plugins
  { id: 'installed-plugins', category: 'plugins', titleEn: 'Installed plugins', titleAr: 'الإضافات المثبتة', descEn: 'Manage installed addons, enable/disable, refresh', descAr: 'إدارة الإضافات المثبتة وتحديثها وتعطيلها', keywords: ['addons', 'plugins', 'stremio', 'installed'] },
  { id: 'plugin-repositories', category: 'plugins', titleEn: 'Plugin repositories', titleAr: 'مستودعات الإضافات', descEn: 'Custom addon manifest URLs & daily checks', descAr: 'إضافة مستودعات manifest مخصصة', keywords: ['repository', 'manifest', 'url', 'install addon'] },

  // 6. Appearance
  { id: 'theme-background', category: 'appearance', titleEn: 'Theme & background', titleAr: 'الثيم والخلفية', descEn: '8 live presets, custom accent, background dim live preview', descAr: '8 ثيمات جاهزة ولون الخلفية وتعتيمها', keywords: ['theme', 'noir', 'nord', 'obsidian', 'roast', 'dracula', 'forest', 'background'] },
  { id: 'your-themes', category: 'appearance', titleEn: 'Your themes', titleAr: 'ثيماتك المخصصة', descEn: 'Active palette editor, export/import theme JSON', descAr: 'تعديل الألوان النشطة واستيراد/تصدير ثيم', keywords: ['studio', 'export theme', 'import theme', 'colors'] },
  { id: 'theme-library', category: 'appearance', titleEn: 'Theme library', titleAr: 'مكتبة الثيمات', descEn: 'Built-in & community preset gallery with 1-click apply', descAr: 'معرض الثيمات الجاهزة والتطبيق المباشر', keywords: ['gallery', 'presets', 'community themes'] },
  { id: 'logo-icon', category: 'appearance', titleEn: 'Logo & icon', titleAr: 'الشعار والأيقونة', descEn: 'Custom app logo/wordmark, preset icon, album art mode', descAr: 'تخصيص شعار التطبيق والأيقونة', keywords: ['logo', 'icon', 'wordmark', 'album art'] },
  { id: 'typography', category: 'appearance', titleEn: 'Typography', titleAr: 'الخطوط', descEn: 'Live font specimen grid & local font upload', descAr: 'شبكة معاينة الخطوط العربية واللاتينية', keywords: ['font', 'ibm plex', 'inter', 'outfit', 'typography'] },
  { id: 'interface', category: 'appearance', titleEn: 'Interface', titleAr: 'الواجهة والبطاقات', descEn: 'Poster radius/size/title scale, UI scale, Liquid Glass', descAr: 'حجم واستدارة البوسترات ومقياس الواجهة والزجاج السائل', keywords: ['scale', 'liquid glass', 'radius', 'poster style', 'focused card'] },
  { id: 'motion-sound', category: 'appearance', titleEn: 'Motion & sound', titleAr: 'الحركة والأصوات', descEn: 'Sidebar animations, screensaver timer & UI SFX style', descAr: 'حركة القائمة الشاشات المؤقتة والأصوات', keywords: ['screensaver', 'sound effects', 'animation'] },
  { id: 'window', category: 'appearance', titleEn: 'Window & chrome', titleAr: 'النافذة والشريط العلوي', descEn: 'Titlebar mode, translucent/solid top bar, drag anywhere', descAr: 'شريط العنوان العلوي والشفافية والسحب', keywords: ['window', 'titlebar', 'top bar', 'translucent'] },
  { id: 'player-layout', category: 'appearance', titleEn: 'Player layout', titleAr: 'تخطيط المشغل وشريط التمرير', descEn: 'Live seek bar dot/height/color preview & HUD editor', descAr: 'تخصيص شريط التقديم وأزرار المشغل مباشرة', keywords: ['seek bar', 'pinstripe', 'boldline', 'dot', 'hud', 'clock'] },
  { id: 'stream-badges', category: 'appearance', titleEn: 'Stream badges', titleAr: 'شارات جودة المصادر', descEn: '4K/REMUX/DV/HDR/Atmos/AV1 toggle chips & preview', descAr: 'شارات الدقة والملفات الصوتية ومعاينتها', keywords: ['badges', 'remux', 'atmos', 'av1', 'hevc', 'dv'] },
  { id: 'badge-rules', category: 'appearance', titleEn: 'Badge rules', titleAr: 'قواعد الشارات (Regex)', descEn: 'Live regex badge matcher & release title tester', descAr: 'اختبار قواعد Regex الحية على عناوين الملفات', keywords: ['regex', 'badge rules', 'tester', 'pattern'] },
  { id: 'badge-packs', category: 'appearance', titleEn: 'Badge packs', titleAr: 'حزم الشارات', descEn: 'Import & manage JSON badge packs', descAr: 'استيراد حزم الشارات بصيغة JSON', keywords: ['badge pack', 'json', 'import'] },
  { id: 'award-icons', category: 'appearance', titleEn: 'Award icons', titleAr: 'أيقونات الجوائز', descEn: 'Custom icons for film, TV & anime awards', descAr: 'تخصيص أيقونات الجوائز السينمائية', keywords: ['awards', 'oscar', 'cannes', 'anime awards'] },

  // 7. Controls & devices
  { id: 'keyboard-shortcuts', category: 'controls-devices', titleEn: 'Keyboard shortcuts', titleAr: 'اختصارات لوحة المفاتيح', descEn: 'Click-to-record keybinds, PTT voice hotkey, panic & replay shortcuts', descAr: 'تسجيل اختصارات المفاتيح والصوت والـ Push-to-Talk والطوارئ', keywords: ['hotkeys', 'keybind', 'shortcuts', 'keyboard', 'ptt', 'panic', 'replay', 'voice', 'overlay'] },
  { id: 'keyboard-behavior', category: 'controls-devices', titleEn: 'Keyboard behavior', titleAr: 'سلوك لوحة المفاتيح', descEn: 'TV nav, Esc exits fullscreen first, seek steps', descAr: 'طول القفز عند التقديم وسلوك زر Esc', keywords: ['seek step', 'escape', 'tv nav'] },
  { id: 'controller', category: 'controls-devices', titleEn: 'Controller', titleAr: 'يد التحكم (Gamepad)', descEn: 'Live Web Gamepad tester, ViGEmBus driver, co-op roles & VSync', descAr: 'فحص يد التحكم وتعريف ViGEmBus وصلاحيات الضيوف و VSync', keywords: ['gamepad', 'xbox', 'playstation', 'controller', 'cursor', 'vigem', 'vsync', 'novsync', 'role'] },
  { id: 'buttons-sticks', category: 'controls-devices', titleEn: 'Buttons & sticks', titleAr: 'الأزرار والعصي', descEn: 'Dual Xbox/PS button glyph map & deadzone/repeat sliders', descAr: 'خريطة أزرار اليد ونطاق الأمان للعصي', keywords: ['deadzone', 'repeat speed', 'sticks', 'glyphs'] },
  { id: 'remotes', category: 'controls-devices', titleEn: 'Remotes', titleAr: 'التحكم عن بعد من الهاتف', descEn: 'LAN phone remote toggle & inline SVG QR code', descAr: 'تفعيل ريموت الهاتف ورمز QR على الشبكة المحلية', keywords: ['remote', 'qr', 'phone', 'lan'] },
  { id: 'tv-devices', category: 'controls-devices', titleEn: 'TV devices', titleAr: 'أجهزة التلفاز', descEn: 'LAN TV device list & settings sync banner', descAr: 'اكتشاف شاشات التلفاز ومزامنتها', keywords: ['tv', 'android tv', 'sync'] },
  { id: 'tv-appearance', category: 'controls-devices', titleEn: 'TV appearance', titleAr: 'مظهر التلفاز', descEn: 'TV themes, subtitle look presets & live TV preview', descAr: 'مظهر التلفاز وحجم الترجمة على الشاشات الكبيرة', keywords: ['tv theme', 'tv subtitle', 'edge margin'] },
  { id: 'tv-playback', category: 'controls-devices', titleEn: 'TV playback', titleAr: 'التشغيل على التلفاز', descEn: 'TV home layout, spoiler guards, auto-next limits', descAr: 'خيارات التشغيل وحماية الحرق للتلفاز', keywords: ['tv playback', 'still watching', 'classic', 'modern'] },
  { id: 'tv-content', category: 'controls-devices', titleEn: 'TV content', titleAr: 'محتوى التلفاز', descEn: 'TV audio/subtitle language order & catalogs', descAr: 'لغات التلفاز وكتالوجاته المفعلة', keywords: ['tv catalogs', 'tv audio', 'tv subtitles'] },
  { id: 'big-picture', category: 'controls-devices', titleEn: 'Big Picture mode', titleAr: 'وضع الشاشة الكبيرة', descEn: 'Start in Big Picture, edge margins, SFX & backdrops', descAr: 'بدء التشغيل بوضع التلفاز والخلفيات المتحركة', keywords: ['big picture', '10-foot', 'couch mode'] },

  // 8. System
  { id: 'storage-overview', category: 'system', titleEn: 'Storage overview', titleAr: 'نظرة عامة على التخزين', descEn: 'Quota bar & itemized localStorage/cache breakdown', descAr: 'مساحة الكاش وتفصيل حجم المخازن المحلية', keywords: ['storage', 'disk', 'quota', 'breakdown'] },
  { id: 'stream-cache', category: 'system', titleEn: 'Stream cache', titleAr: 'ذاكرة بث الفيديو', descEn: 'Retention days, max GB limit, clear temporary cache', descAr: 'حد التخزين المؤقت للبث وتنظيفه', keywords: ['stream cache', 'temp files', 'clear cache', 'gb'] },
  { id: 'caches', category: 'system', titleEn: 'Caches', titleAr: 'الذاكرة المخبأة', descEn: 'Clear metadata, posters, stream picker & dead links caches', descAr: 'تنظيف كاش الصور والبيانات الوصفية والمصادر', keywords: ['clear cache', 'metadata cache', 'posters', 'artwork'] },
  { id: 'notification-destinations', category: 'system', titleEn: 'Notification destinations', titleAr: 'وجهات الإشعارات', descEn: 'Desktop alerts, Discord webhook, Telegram bot test', descAr: 'إشعارات النظام وويبهوك ديسكورد وتيليجرام', keywords: ['webhook', 'discord', 'telegram', 'notifications'] },
  { id: 'notification-sources', category: 'system', titleEn: 'Notification sources', titleAr: 'قواعد وأتمتة الإشعارات', descEn: 'Episode/release automations & rule builder', descAr: 'تنبيهات الحلقات الجديدة وإضافتها للأتمتة', keywords: ['automations', 'episodes', 'watchlist alerts'] },
  { id: 'downloads-folders', category: 'system', titleEn: 'Downloads & folders', titleAr: 'التنزيلات والمجلدات', descEn: 'Choose download folders & organize subfolders', descAr: 'تحديد مجلدات التنزيل وتنظيم الملفات', keywords: ['download', 'folder', 'organize'] },
  { id: 'startup-system', category: 'system', titleEn: 'Startup & system', titleAr: 'بدء التشغيل وصينية النظام', descEn: 'Close to tray, minimize to tray, launch on login, graphics backend', descAr: 'التصغير لصينية النظام وبدء التشغيل مع ويندوز', keywords: ['tray', 'startup', 'always on top', 'minimize', 'pause on focus', 'graphics'] },
  { id: 'privacy-discord', category: 'system', titleEn: 'Privacy & Discord RPC', titleAr: 'الخصوصية وديسكورد RPC', descEn: 'Incognito mode, tracker blocker, Co-op privacy & Discord RPC', descAr: 'وضع التصفح الخاص، حظر المتتبعات وديسكورد وحالته', keywords: ['discord', 'discordClientId', 'rpc', 'rich presence', 'privacy', 'incognito', 'block ads', 'spatial voice', 'status'] },
  { id: 'repair-diagnostics', category: 'system', titleEn: 'Repair & diagnostics', titleAr: 'الإصلاح والتشخيص', descEn: 'Self-heal diagnostics center, library repair, encoders, FFmpeg & logs', descAr: 'مركز التشخيص والإصلاح الذاتي وفحص قاعدة البيانات والـ FFmpeg والسجلات', keywords: ['repair', 'diagnostics', 'self-heal', 'corrupted', 'fix', 'encoders', 'ffmpeg', 'routerlock', 'logs', 'reset'] },
  { id: 'custom-code', category: 'system', titleEn: 'Custom code', titleAr: 'أكواد التخصيص المتقدمة', descEn: 'Revealed Custom CSS, JS, and HTML overlay editors', descAr: 'محرر CSS و JS المتقدم للواجهة', keywords: ['custom css', 'custom js', 'html overlay', 'code'] },
  { id: 'about', category: 'system', titleEn: 'About & onboarding', titleAr: 'حول التطبيق ومعالج الترحيب', descEn: 'Replay walkthrough wizard, version, build info', descAr: 'إعادة تشغيل معالج البداية ومعلومات الإصدار', keywords: ['about', 'onboarding', 'version', 'walkthrough'] },

  // 9. Help & about
  { id: 'report-bug', category: 'help-about', titleEn: 'Report a bug', titleAr: 'الإبلاغ عن مشكلة', descEn: 'Structured bug report & diagnostics bundle exporter', descAr: 'تصدير تقرير خطأ منظم مع السجلات', keywords: ['bug', 'report', 'logs', 'diagnostics'] },
  { id: 'licenses-attribution', category: 'help-about', titleEn: 'Licenses & attribution', titleAr: 'التراخيص والمصادر المفتوحة', descEn: 'Open-source stack licenses (React, mpv, Tauri, Lucide)', descAr: 'تراخيص المكتبات مفتوحة المصدر المستخدمة', keywords: ['licenses', 'mit', 'gpl', 'attribution'] },
  { id: 'icons-animation', category: 'help-about', titleEn: 'Icons & animation', titleAr: 'الأيقونات والحركات', descEn: 'Click-to-copy icon showcase & motion strip', descAr: 'معرض أيقونات التطبيق ونسخها', keywords: ['icons', 'svg', 'animation', 'design system'] },

  // 10. Standalone
  { id: 'updates-backup', category: 'updates-backup', titleEn: 'Updates & backup', titleAr: 'التحديثات والنسخ الاحتياطي', descEn: 'Check updates, beta toggle, export & restore JSON backup', descAr: 'البحث عن تحديثات وتصدير واستعادة نسخة JSON', keywords: ['update', 'backup', 'export', 'restore', 'json', 'rollback', 'beta'] },
];
