import type { Lang } from '../i18n';
import type { AddonSub } from './TheaterDrawers';

export interface LangInfo {
  code: string;
  flag: string;
  name: string;
  native: string;
  priority: number;
}

export interface SubTrackItem {
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
  'external-filename'?: string;
}

export interface AudioTrackItem {
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  'demux-channel-count'?: number;
}

const LANG_DEFS: Record<string, { flag: string; name: string; native: string; priority?: number }> = {
  ar: { flag: '🇸🇦', name: 'Arabic', native: 'العربية', priority: 0 },
  en: { flag: '🇺🇸', name: 'English', native: 'English', priority: 1 },
  ja: { flag: '🇯🇵', name: 'Japanese', native: '日本語', priority: 2 },
  fr: { flag: '🇫🇷', name: 'French', native: 'Français', priority: 3 },
  es: { flag: '🇪🇸', name: 'Spanish', native: 'Español', priority: 4 },
  de: { flag: '🇩🇪', name: 'German', native: 'Deutsch', priority: 5 },
  it: { flag: '🇮🇹', name: 'Italian', native: 'Italiano', priority: 6 },
  pt: { flag: '🇵🇹', name: 'Portuguese', native: 'Português', priority: 7 },
  'pt-br': { flag: '🇧🇷', name: 'Portuguese (BR)', native: 'Português (BR)', priority: 7 },
  ko: { flag: '🇰🇷', name: 'Korean', native: '한국어', priority: 8 },
  tr: { flag: '🇹🇷', name: 'Turkish', native: 'Türkçe', priority: 9 },
  ru: { flag: '🇷🇺', name: 'Russian', native: 'Русский', priority: 10 },
  zh: { flag: '🇨🇳', name: 'Chinese', native: '中文', priority: 11 },
  hi: { flag: '🇮🇳', name: 'Hindi', native: 'हिन्दी' },
  id: { flag: '🇮🇩', name: 'Indonesian', native: 'Bahasa Indonesia' },
  pl: { flag: '🇵🇱', name: 'Polish', native: 'Polski' },
  nl: { flag: '🇳🇱', name: 'Dutch', native: 'Nederlands' },
  fa: { flag: '🇮🇷', name: 'Persian', native: 'فارسی' },
  sv: { flag: '🇸🇪', name: 'Swedish', native: 'Svenska' },
  no: { flag: '🇳🇴', name: 'Norwegian', native: 'Norsk' },
  da: { flag: '🇩🇰', name: 'Danish', native: 'Dansk' },
  fi: { flag: '🇫🇮', name: 'Finnish', native: 'Suomi' },
  el: { flag: '🇬🇷', name: 'Greek', native: 'Ελληνικά' },
  cs: { flag: '🇨🇿', name: 'Czech', native: 'Čeština' },
  ro: { flag: '🇷🇴', name: 'Romanian', native: 'Română' },
  hu: { flag: '🇭🇺', name: 'Hungarian', native: 'Magyar' },
  uk: { flag: '🇺🇦', name: 'Ukrainian', native: 'Українська' },
  vi: { flag: '🇻🇳', name: 'Vietnamese', native: 'Tiếng Việt' },
  th: { flag: '🇹🇭', name: 'Thai', native: 'ไทย' },
  ms: { flag: '🇲🇾', name: 'Malay', native: 'Bahasa Melayu' },
  und: { flag: '🌐', name: 'Unknown', native: 'غير محددة', priority: 99 },
};

const ALIASES: Record<string, string> = {
  ar: 'ar', ara: 'ar', arb: 'ar', arabic: 'ar',
  en: 'en', eng: 'en', english: 'en',
  ja: 'ja', jpn: 'ja', jap: 'ja', japanese: 'ja',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  es: 'es', spa: 'es', spanish: 'es', lat: 'es',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  it: 'it', ita: 'it', italian: 'it',
  pt: 'pt', por: 'pt', pob: 'pt-br', 'pt-br': 'pt-br', portuguese: 'pt',
  ko: 'ko', kor: 'ko', korean: 'ko',
  tr: 'tr', tur: 'tr', turkish: 'tr',
  ru: 'ru', rus: 'ru', russian: 'ru',
  zh: 'zh', zho: 'zh', chi: 'zh', cmn: 'zh', chinese: 'zh',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  id: 'id', ind: 'id', indonesian: 'id',
  pl: 'pl', pol: 'pl', polish: 'pl',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl',
  fa: 'fa', fas: 'fa', per: 'fa', persian: 'fa',
  sv: 'sv', swe: 'sv', swedish: 'sv',
  no: 'no', nor: 'no', nob: 'no', nno: 'no',
  da: 'da', dan: 'da',
  fi: 'fi', fin: 'fi',
  el: 'el', gre: 'el', ell: 'el',
  cs: 'cs', cze: 'cs', ces: 'cs',
  ro: 'ro', rum: 'ro', ron: 'ro',
  hu: 'hu', hun: 'hu',
  uk: 'uk', ukr: 'uk',
  vi: 'vi', vie: 'vi',
  th: 'th', tha: 'th',
  ms: 'ms', may: 'ms', msa: 'ms',
  und: 'und',
};

const RAW_CODE_RE = /^(ar|ara|arb|en|eng|fr|fre|fra|de|ger|deu|es|spa|it|ita|pt|por|pob|ru|rus|ja|jpn|ko|kor|tr|tur|zh|zho|chi|hi|hin|id|ind|pl|pol|nl|dut|nld|fa|fas|per|sv|swe|no|nor|da|dan|fi|fin|el|gre|ell|cs|cze|ces|ro|rum|ron|hu|hun|uk|ukr|vi|vie|th|tha|und|sub|subtitles?|\d+)$/i;

export function resolveLang(raw?: string | null): LangInfo {
  const s = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return { code: 'und', flag: '🌐', name: 'Unknown', native: 'غير محددة', priority: 99 };
  const exact = ALIASES[s];
  const base = !exact ? ALIASES[s.split('-')[0]] : exact;
  const key = base || s;
  const def = LANG_DEFS[key];
  if (def) return { code: key, flag: def.flag, name: def.name, native: def.native, priority: def.priority ?? 50 };
  return { code: key, flag: '🌐', name: key.toUpperCase(), native: key.toUpperCase(), priority: 80 };
}

export function langLabelForUi(info: LangInfo, uiLang: Lang): string {
  if (info.code === 'und') return uiLang === 'ar' ? info.native : info.name;
  return uiLang === 'ar' && info.code === 'ar' ? info.native : info.native !== info.name ? `${info.native} · ${info.name}` : info.name;
}

export function formatAudioTrack(x: AudioTrackItem, uiLang: Lang) {
  const langInfo = resolveLang(x.lang || inferLangFromTitle(x.title));
  const chCount = x['demux-channel-count'];
  const chLabel = chCount === 8 ? '7.1' : chCount === 6 ? '5.1' : chCount === 2 ? 'Stereo' : chCount === 1 ? 'Mono' : chCount ? `${chCount}ch` : '';
  const codecRaw = String(x.codec || '').toUpperCase().replace(/^TRUEHD$/, 'TrueHD').replace(/^EAC3$/, 'DD+');
  const titleClean = x.title && !RAW_CODE_RE.test(x.title.trim()) ? x.title.trim() : '';
  const atmos = /atmos/i.test(titleClean) ? 'Atmos' : '';
  const langName = langInfo.code === 'ar' ? langInfo.native : langInfo.name;
  const primary = titleClean && !/^(stereo|surround|5\.1|7\.1)$/i.test(titleClean) ? `${langName} — ${titleClean}` : langName;
  const metaLabel = [chLabel, atmos || codecRaw].filter(Boolean).join(' · ');
  return { langInfo, primary, metaLabel };
}

function inferLangFromTitle(t?: string | null): string {
  const s = String(t || '');
  if (/[\u0600-\u06FF]|\barabic\b/i.test(s)) return 'ar';
  if (/\benglish\b/i.test(s)) return 'en';
  if (/\bjapanese\b/i.test(s)) return 'ja';
  if (/\bfrench\b|français/i.test(s)) return 'fr';
  if (/\bspanish\b|español/i.test(s)) return 'es';
  if (/\bgerman\b|deutsch/i.test(s)) return 'de';
  return '';
}

function extractBadges(text: string, extra?: { sdh?: boolean; forced?: boolean; codec?: string }): string[] {
  const badges: string[] = [];
  if (extra?.sdh || /\b(sdh|hi|cc)\b/i.test(text)) badges.push('SDH');
  if (extra?.forced || /\bforced\b/i.test(text)) badges.push('Forced');
  const codec = String(extra?.codec || '').toUpperCase();
  if (codec === 'ASS' || codec === 'SSA') badges.push('ASS');
  else if (codec === 'HDMV_PGS_SUBTITLE' || codec === 'PGS') badges.push('PGS');
  return badges;
}

export function formatSubTrack(x: SubTrackItem, uiLang: Lang) {
  const langInfo = resolveLang(x.lang || inferLangFromTitle(x.title));
  const rawTitle = String(x.title || '').trim();
  const isDummy = !rawTitle || RAW_CODE_RE.test(rawTitle) || /^ar-[0-9a-f]{8,}\.(srt|vtt)$/i.test(rawTitle);
  const extPath = x['external-filename'] || '';
  let label = !isDummy ? rawTitle : '';
  if (!label && x.external && extPath && !/^https?:/i.test(extPath)) {
    const file = extPath.split(/[/\\]/).pop() || '';
    if (file && !/^ar-[0-9a-f]{8,}\.(srt|vtt)$/i.test(file)) label = file.replace(/\.(srt|ass|ssa|vtt|sub)$/i, '');
  }
  const codecUp = String(x.codec || '').toUpperCase();
  const isAss = codecUp === 'ASS' || codecUp === 'SSA';
  if (!label) {
    const langBase = langInfo.code === 'und' ? (uiLang === 'ar' ? `مسار #${x.id}` : `Track #${x.id}`) : langInfo.native;
    if (!x.external) {
      label = uiLang === 'ar'
        ? `${langBase} — مدمجة${isAss ? ' (ASS)' : ''}`
        : `${langBase} — Built-in${isAss ? ' (ASS)' : ''}`;
    } else {
      label = `${langBase} #${x.id}`;
    }
  }
  const badges = extractBadges(label, { codec: x.codec });
  const cleanTitle = label.replace(/\s*\[(SDH|Forced|SDH·Forced)\]\s*/gi, ' ').trim();
  const provider = x.external
    ? (uiLang === 'ar' ? 'خارجية' : 'External')
    : (uiLang === 'ar' ? 'مدمجة' : 'Built-in');
  return { langInfo, title: cleanTitle, provider, badges, isBuiltin: !x.external };
}

export function formatAddonSub(s: AddonSub & { filename?: string; release?: string; title?: string; name?: string; SubFileName?: string; sdh?: boolean; hi?: boolean; hearing_impaired?: boolean; forced?: boolean }, uiLang: Lang, idx: number) {
  const langInfo = resolveLang(s.lang);
  const candidates = [s.filename, s.SubFileName, s.release, s.title, s.name]
    .map((v) => String(v || '').trim())
    .filter((v) => {
      if (!v || RAW_CODE_RE.test(v)) return false;
      // Reject raw "ara · OpenSubtitles v3" repetition generated by old formatters
      if (/^[a-z]{2,3}\s*[·•-]\s*\S+/i.test(v) && s.addon && v.toLowerCase().includes(s.addon.toLowerCase())) return false;
      return true;
    });
  let clean = candidates[0] ? candidates[0].replace(/\.(srt|vtt|ass|ssa|sub)$/i, '').replace(/\s+/g, ' ').trim() : '';
  if (!clean && s.url) {
    try {
      const seg = decodeURIComponent(new URL(s.url).pathname.split('/').pop() || '');
      const base = seg.replace(/\.(srt|vtt|ass|ssa|sub)$/i, '').trim();
      if (base && !/^\d+$/.test(base) && !RAW_CODE_RE.test(base) && base.length > 4) clean = base;
    } catch {}
  }
  if (!clean) {
    clean = uiLang === 'ar' ? `${langInfo.native} #${idx + 1}` : `${langInfo.name} #${idx + 1}`;
  }
  const badges = extractBadges(clean, { sdh: !!(s.hi || s.sdh || s.hearing_impaired), forced: !!s.forced });
  clean = clean.replace(/\s*\[(SDH|Forced|SDH·Forced)\]\s*/gi, ' ').trim();
  return {
    langInfo,
    title: clean,
    provider: s.addon ? String(s.addon).trim() : (uiLang === 'ar' ? 'إضافة' : 'Addon'),
    badges,
  };
}
