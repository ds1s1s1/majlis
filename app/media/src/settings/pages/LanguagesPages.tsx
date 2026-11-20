import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { cin, type Installed } from '../../api';
import { useHost } from '../../host';
import {
  ActionRow, ColorSwatchPicker, DropdownRow, InputRow,
  LivePreviewCard, RadioCardGroup, SegmentedRow, SettingSection, SliderRow, TagPriorityList, ToggleRow,
} from '../primitives';
import { useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const ALL_LANGS = ['Arabic', 'English', 'Japanese', 'French', 'Spanish', 'German', 'Turkish', 'Korean', 'Italian', 'Portuguese', 'Russian', 'Chinese'];

const DISPLAY_LANGS: { code: string; name: string; native: string; c1: string; c2: string; c3?: string }[] = [
  { code: 'ar', name: 'Arabic', native: 'العربية', c1: '#006C35', c2: '#FFFFFF' },
  { code: 'en', name: 'English', native: 'English', c1: '#012169', c2: '#C8102E', c3: '#FFFFFF' },
];

function FlagSvg({ c1, c2, c3 }: { c1: string; c2: string; c3?: string }) {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 rounded-[3px] ring-1 ring-white/15 shrink-0">
      <rect width="24" height="16" fill={c1} />
      <rect y={c3 ? 5.33 : 8} width="24" height={c3 ? 5.33 : 8} fill={c2} />
      {c3 ? <rect y="10.66" width="24" height="5.34" fill={c3} /> : null}
    </svg>
  );
}

export function LanguagesPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast, setLang } = useHost();
  const ar = lang === 'ar';
  const { data, update } = useSettingsStore();
  const l = data.languages;

  const qc = useQueryClient();
  const [kwInput, setKwInput] = useState('');
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  const addonsQ = useQuery({
    queryKey: ['addons'],
    queryFn: () => cin<Installed[]>('addons').catch(() => [] as Installed[]),
  });
  const keysQ = useQuery({
    queryKey: ['keys'],
    queryFn: () => cin<{ user: Record<string, string>; builtIn: Record<string, boolean> }>('keys').catch(() => ({
      user: {} as Record<string, string>,
      builtIn: {} as Record<string, boolean>,
    })),
  });
  const probesQ = useQuery({
    queryKey: ['player-probes'],
    queryFn: () => cin<{ ffmpeg: string | null }>('player-probes').catch(() => ({ ffmpeg: null as string | null })),
    staleTime: 60000,
  });

  const saveSubKey = async (id: string, val: string, label: string) => {
    try {
      await cin('keys-set', { [id]: val });
      qc.invalidateQueries({ queryKey: ['keys'] });
      toast(ar ? `تم حفظ مفتاح ${label}` : `${label} key saved`);
    } catch {
      toast(ar ? 'تعذّر حفظ المفتاح' : 'Could not save key');
    }
  };

  if (pageId === 'app-language') {
    return (
      <>
        <SettingSection title={ar ? 'المنطقة ولغة العرض' : 'Region & Display Language'}>
          <DropdownRow
            label={ar ? 'المنطقة والكتالوج الإقليمي' : 'Region'}
            value={l.region}
            options={[
              { value: 'SA', label: 'Saudi Arabia (SA)' },
              { value: 'AE', label: 'UAE (AE)' },
              { value: 'US', label: 'United States (US)' },
              { value: 'GB', label: 'United Kingdom (GB)' },
              { value: 'JP', label: 'Japan (JP)' },
            ]}
            onChange={(v) => update((s) => { s.languages.region = v; })}
          />
          <div className="py-3">
            <div className="mb-2.5 text-[13.5px] font-medium">{ar ? 'لغة الواجهة' : 'Display language'}</div>
            <div className="grid grid-cols-2 gap-2.5">
              {DISPLAY_LANGS.map((dl) => {
                const active = l.displayLanguage === dl.code;
                return (
                  <button
                    key={dl.code}
                    type="button"
                    onClick={() => {
                      update((s) => { s.languages.displayLanguage = dl.code; });
                      if (dl.code === 'ar' || dl.code === 'en') setLang?.(dl.code);
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-start transition ${
                      active ? 'border-[var(--accent)] bg-[var(--surface-active)]' : 'border-[var(--border-subtle)] bg-black/25 hover:bg-white/5'
                    }`}
                  >
                    <FlagSvg c1={dl.c1} c2={dl.c2} c3={dl.c3} />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">{dl.native}</div>
                      <div className="truncate text-[10px] text-[var(--text-muted)]">{dl.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </SettingSection>

        <SettingSection title={ar ? 'العناوين والأوصاف والملصقات' : 'Titles and Descriptions'}>
          <DropdownRow label={ar ? 'لغة البيانات الوصفية' : 'Metadata language'} value={l.metadataLang} options={[{ value: 'ar', label: 'العربية (ar)' }, { value: 'en', label: 'English (en)' }, { value: 'ja', label: '日本語 (ja)' }]} onChange={(v) => update((s) => { s.languages.metadataLang = v; })} />
          <ToggleRow label={ar ? 'ترجمة أسماء الأعمال' : 'Translate titles'} checked={l.translateTitles} onChange={(v) => update((s) => { s.languages.translateTitles = v; })} />
          <ToggleRow label={ar ? 'ترجمة نبذة القصة' : 'Translate overviews'} checked={l.translateOverviews} onChange={(v) => update((s) => { s.languages.translateOverviews = v; })} />
          <DropdownRow label={ar ? 'لغة عناوين الأنمي' : 'Anime Title Language'} value={l.animeTitleLang} options={[{ value: 'english', label: 'English' }, { value: 'romaji', label: 'Romaji' }, { value: 'native', label: 'Native (日本語)' }]} onChange={(v) => update((s) => { s.languages.animeTitleLang = v; })} />
          <TagPriorityList label={ar ? 'لغات أغلفة وبوسترات الأعمال' : 'Artwork languages'} tags={l.artworkLanguages} availableOptions={['English', 'Arabic', 'Original', 'Japanese', 'Neutral']} onChange={(next) => update((s) => { s.languages.artworkLanguages = next; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'audio-languages') {
    const addKw = () => {
      const k = kwInput.trim().toLowerCase();
      if (!k || l.skipTrackKeywords.includes(k)) return;
      update((s) => { s.languages.skipTrackKeywords.push(k); });
      setKwInput('');
    };
    return (
      <>
        <SettingSection title={ar ? 'أولوية لغات الصوت' : 'Audio languages'}>
          <TagPriorityList label={ar ? 'ترتيب تفضيل المسار الصوتي' : 'Audio track priority'} tags={l.audioPriority} availableOptions={ALL_LANGS} onChange={(next) => update((s) => { s.languages.audioPriority = next; })} />
        </SettingSection>
        <SettingSection title={ar ? 'تجاهل هذه المسارات' : 'Skip these tracks'}>
          <ToggleRow label={ar ? 'لا تختر تلقائياً المسارات التي تحتوي على:' : 'Never auto-select tracks containing'} checked={l.skipTrackKeywordsEnabled} onChange={(v) => update((s) => { s.languages.skipTrackKeywordsEnabled = v; })} />
          <div className="pt-3 space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {l.skipTrackKeywords.map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs">
                  <span>{kw}</span>
                  <button type="button" onClick={() => update((s) => { s.languages.skipTrackKeywords = s.languages.skipTrackKeywords.filter((x) => x !== kw); })}><X size={11} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }} placeholder={ar ? 'أضف كلمة مثل director...' : 'Add keyword e.g. directors...'} className="flex-1 rounded-lg bg-black/35 px-3 py-1.5 text-xs ring-1 ring-white/10 outline-none" />
              <button type="button" onClick={addKw} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"><Plus size={14} /></button>
            </div>
          </div>
        </SettingSection>
      </>
    );
  }

  if (pageId === 'discovery-languages') {
    const toggleCatLang = (langName: string) => {
      const exists = l.discoveryHomeCatalogs.includes(langName);
      update((s) => {
        s.languages.discoveryHomeCatalogs = exists
          ? s.languages.discoveryHomeCatalogs.filter((x) => x !== langName)
          : [...s.languages.discoveryHomeCatalogs, langName];
      });
    };
    return (
      <SettingSection title={ar ? 'لغات الكتالوج والبحث' : 'Discovery languages'}>
        <div className="py-3 space-y-2">
          <div className="text-[13.5px] font-medium">{ar ? 'لغات كتالوجات الرئيسية (فارغ = الكل)' : 'Home catalogs (empty = all languages)'}</div>
          <div className="flex flex-wrap gap-2">
            {ALL_LANGS.slice(0, 8).map((ln) => {
              const on = l.discoveryHomeCatalogs.includes(ln);
              return (
                <button key={ln} type="button" onClick={() => toggleCatLang(ln)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${on ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/8 text-[var(--text-secondary)] hover:bg-white/15'}`}>
                  {ln}
                </button>
              );
            })}
          </div>
        </div>
        <ToggleRow label={ar ? 'تقليل العناوين المحلية من منطقتك' : 'Fewer titles from where you are'} checked={l.fewerLocalTitles} onChange={(v) => update((s) => { s.languages.fewerLocalTitles = v; })} />
        <TagPriorityList label={ar ? 'تعزيز لغات المصادر في الترتيب' : 'Stream ranking boost'} tags={l.streamRankingLangs} availableOptions={ALL_LANGS} onChange={(next) => update((s) => { s.languages.streamRankingLangs = next; })} />
        <ToggleRow label={ar ? 'إظهار الروابط بلغاتي فقط' : 'Only show streams in my languages'} checked={l.onlyShowMyLangStreams} onChange={(v) => update((s) => { s.languages.onlyShowMyLangStreams = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'subtitle-languages') {
    return (
      <>
        <SettingSection title={ar ? 'لغات الترجمة' : 'Subtitle languages'}>
          <TagPriorityList label={ar ? 'أولوية لغات الترجمة' : 'Subtitle languages'} tags={l.subtitlePriority} availableOptions={ALL_LANGS} onChange={(next) => update((s) => { s.languages.subtitlePriority = next; })} />
          <DropdownRow label={ar ? 'لغة الترجمة الثانية (ترجمة مزدوجة)' : 'Dual subtitles: Second language'} value={l.secondSubtitleLang} options={[{ value: 'off', label: ar ? 'معطلة' : 'Off' }, ...ALL_LANGS.map((x) => ({ value: x, label: x }))]} onChange={(v) => update((s) => { s.languages.secondSubtitleLang = v; })} />
        </SettingSection>
        <SettingSection title={ar ? 'اختيار وتفعيل الترجمة' : 'Choosing & Turning them on'}>
          <ToggleRow label={ar ? 'تفضيل الترجمة المدمجة داخل الملف' : 'Prefer embedded subtitles'} checked={l.preferEmbeddedSubs} onChange={(v) => update((s) => { s.languages.preferEmbeddedSubs = v; })} />
          <ToggleRow label={ar ? 'ترجمات إجبارية (Forced) مع الصوت الأصلي' : 'Forced subs with native audio'} checked={l.forcedSubsWithNative} onChange={(v) => update((s) => { s.languages.forcedSubsWithNative = v; })} />
          <ToggleRow label={ar ? 'ترقية الترجمة تلقائياً عند وجود نسخة أدق' : 'Upgrade subtitles when better ones load'} checked={l.upgradeBetterSubs} onChange={(v) => update((s) => { s.languages.upgradeBetterSubs = v; })} />
          <ToggleRow label={ar ? 'تشغيل الترجمة افتراضياً عند بدء الفيديو' : 'Start with subtitles on'} checked={l.startWithSubsOn} onChange={(v) => update((s) => { s.languages.startWithSubsOn = v; })} />
          <ToggleRow label={ar ? 'اختيار الترجمة قبل التشغيل' : 'Choose subtitles before playback'} checked={l.chooseSubsBeforePlay} onChange={(v) => update((s) => { s.languages.chooseSubsBeforePlay = v; })} />
          <ToggleRow label={ar ? 'نقطة مؤشر الترجمة المتوفرة' : 'Subtitle indicator dot'} checked={l.subIndicatorDot} onChange={(v) => update((s) => { s.languages.subIndicatorDot = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'subtitle-sources') {
    const subAddons = (addonsQ.data || []).filter((a) => {
      const hasSubRes = (a.manifest?.resources || []).some((r) => (typeof r === 'string' ? r : r?.name) === 'subtitles');
      return hasSubRes || (a.manifest?.types || []).includes('subtitles') || /sub/i.test(a.manifest?.name || '');
    });
    const keyVal = (id: string) => keyDrafts[id] ?? keysQ.data?.user?.[id] ?? '';
    const hasKey = (id: string) => !!(keyDrafts[id] ?? keysQ.data?.user?.[id] ?? keysQ.data?.builtIn?.[id]);
    return (
      <SettingSection title={ar ? 'مصادر الترجمة' : 'Subtitle sources'}>
        <ToggleRow label="OpenSubtitles v3" checked={l.subSources.opensubtitles} onChange={(v) => update((s) => { s.languages.subSources.opensubtitles = v; })} />
        <InputRow label="OpenSubtitles API Key" value={keyVal('opensubtitles')} secret savedBadge={hasKey('opensubtitles')} onChange={(v) => setKeyDrafts((p) => ({ ...p, opensubtitles: v }))} onSave={() => saveSubKey('opensubtitles', keyVal('opensubtitles'), 'OpenSubtitles')} />
        <ToggleRow label="SubDL" checked={l.subSources.subdl} onChange={(v) => update((s) => { s.languages.subSources.subdl = v; })} />
        <InputRow label="SubDL API Key" value={keyVal('subdl')} secret savedBadge={hasKey('subdl')} onChange={(v) => setKeyDrafts((p) => ({ ...p, subdl: v }))} onSave={() => saveSubKey('subdl', keyVal('subdl'), 'SubDL')} />
        <ToggleRow label={ar ? 'إضافات الترجمة المثبتة' : 'Subtitle addons'} description={subAddons.map((a) => a.manifest?.name || a.url).join(' · ') || (ar ? 'لا توجد إضافات ترجمة مخصصة' : 'OpenSubtitles built-in active')} checked={l.subSources.addons} onChange={(v) => update((s) => { s.languages.subSources.addons = v; })} />
        <ToggleRow label="Subsource" checked={l.subSources.subsource} onChange={(v) => update((s) => { s.languages.subSources.subsource = v; })} />
        <InputRow label="Subsource API Key" value={keyVal('subsource')} secret savedBadge={hasKey('subsource')} onChange={(v) => setKeyDrafts((p) => ({ ...p, subsource: v }))} onSave={() => saveSubKey('subsource', keyVal('subsource'), 'Subsource')} />
        <DropdownRow label={ar ? 'ترتيب لغات نتائج الترجمة' : 'Subtitle language order'} value={l.subLanguageOrder} options={[{ value: 'priority', label: ar ? 'حسب أولوية اللغات' : 'Follow subtitle priority' }, { value: 'rating', label: ar ? 'الأعلى تقييماً' : 'Highest rated' }]} onChange={(v) => update((s) => { s.languages.subLanguageOrder = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'subtitle-sync') {
    const ffReady = !!probesQ.data?.ffmpeg;
    return (
      <SettingSection title={ar ? 'مزامنة الترجمة وتصفية الوصف' : 'Subtitle sync & filtering'}>
        <ToggleRow label={ar ? 'مزامنة الترجمة تلقائياً بالصوت' : 'Auto-sync subtitles'} checked={l.subAutoSync} onChange={(v) => update((s) => { s.languages.subAutoSync = v; })} />
        <ToggleRow label={ar ? 'تصفية وسوم الوصف السمعي (SDH: [music] / (SIGHS))' : 'Filter SDH / hearing-impaired cues ([music], (SIGHS))'} checked={l.subFilterSdh} onChange={(v) => update((s) => { s.languages.subFilterSdh = v; })} />
        <ActionRow
          label={ar ? 'نموذج المزامنة الصوتية المحلي (FFmpeg VAD)' : 'Local voice alignment engine'}
          description={probesQ.isLoading ? '...' : ffReady ? (ar ? `جاهز محلياً (${probesQ.data?.ffmpeg})` : `Ready locally (${probesQ.data?.ffmpeg})`) : (ar ? 'FFmpeg غير مكتشف على الجهاز' : 'FFmpeg binary not detected on system')}
          buttonLabel={ar ? 'إعادة الفحص' : 'Verify ready'}
          onClick={async () => {
            const res = await probesQ.refetch();
            const ok = !!res.data?.ffmpeg;
            update((s) => { s.languages.subSyncModelDownloaded = ok; });
            toast(ok ? (ar ? 'محرك المزامنة المحلي جاهز' : 'Local auto-sync ready') : (ar ? 'لم يتم العثور على FFmpeg' : 'FFmpeg unavailable'));
          }}
        />
        <ToggleRow label={ar ? 'الوضع الخاص (عدم مشاركة البصمة)' : 'Private mode'} checked={l.subPrivateMode} onChange={(v) => update((s) => { s.languages.subPrivateMode = v; })} />
      </SettingSection>
    );
  }

  // subtitle-style (sticky right LivePreviewCard)
  const st = l.subStyle;
  const subShadow =
    st.background === 'outline'
      ? `0 0 ${st.outlinePx}px #000, 1px 1px ${st.outlinePx}px #000, -1px -1px ${st.outlinePx}px #000`
      : st.background === 'shadow'
        ? `0 ${Math.max(2, st.outlinePx)}px ${Math.max(4, st.outlinePx * 2)}px rgba(0,0,0,0.9)`
        : 'none';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <SettingSection title={ar ? 'مظهر الترجمة' : 'Subtitle style'}>
        <DropdownRow
          label={ar ? 'خط الترجمة' : 'Subtitle font'}
          value={st.font || 'Segoe UI'}
          options={[
            { value: 'Segoe UI', label: 'Segoe UI' },
            { value: 'Cairo', label: 'Cairo (عربي)' },
            { value: 'Tajawal', label: 'Tajawal (عربي)' },
            { value: 'Arial', label: 'Arial' },
            { value: 'Consolas', label: 'Consolas (Mono)' },
          ]}
          onChange={(v) => update((s) => { s.languages.subStyle.font = v; })}
        />
        <RadioCardGroup
          columns={3}
          value={st.background}
          onChange={(v) => update((s) => { s.languages.subStyle.background = v; })}
          options={[
            { value: 'outline', title: ar ? 'تحديد خارجي' : 'Outline', description: 'Crisp border stroke' },
            { value: 'shadow', title: ar ? 'ظل ناعم' : 'Drop shadow', description: 'Soft lifted blur shadow' },
            { value: 'bar', title: ar ? 'شريط أسود' : 'Black bar', description: 'Classic opaque caption box' },
          ]}
        />
        <SliderRow label={ar ? 'سماكة التحديد / الظل' : 'Outline thickness'} value={st.outlinePx} min={0} max={6} unit="px" defaultValue={3} onChange={(v) => update((s) => { s.languages.subStyle.outlinePx = v; })} />
        <SliderRow label={ar ? 'الحجم' : 'Size'} value={st.sizePct} min={50} max={200} unit="%" defaultValue={100} onChange={(v) => update((s) => { s.languages.subStyle.sizePct = v; })} />
        <ToggleRow label={ar ? 'خط عريض' : 'Bold text'} checked={st.bold} onChange={(v) => update((s) => { s.languages.subStyle.bold = v; })} />
        <ToggleRow label={ar ? 'إخفاء وسوم SDH ([music], (SIGHS))' : 'Filter SDH tags ([music], (SIGHS))'} checked={l.subFilterSdh} onChange={(v) => update((s) => { s.languages.subFilterSdh = v; })} />
        <SliderRow label={ar ? 'الشفافية' : 'Opacity'} value={st.opacityPct} min={10} max={100} unit="%" defaultValue={95} onChange={(v) => update((s) => { s.languages.subStyle.opacityPct = v; })} />
        <SliderRow label={ar ? 'المسافة من الأسفل' : 'Distance from bottom'} value={st.bottomPct} min={0} max={30} unit="%" defaultValue={8} onChange={(v) => update((s) => { s.languages.subStyle.bottomPct = v; })} />
        <SegmentedRow label={ar ? 'المحاذاة' : 'Alignment'} value={st.align} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} onChange={(v) => update((s) => { s.languages.subStyle.align = v; })} />
        <ColorSwatchPicker label={ar ? 'لون النص' : 'Text color'} value={st.color} defaultColor="#FFFFFF" swatches={['#FFFFFF', '#FACC15', '#E5A93C', '#38BDF8', '#34D399', '#F472B6']} onChange={(c) => update((s) => { s.languages.subStyle.color = c; })} />
        <ActionRow label={ar ? 'إعادة ضبط التنسيق' : 'Reset subtitle style'} buttonLabel={ar ? 'إعادة ضبط' : 'Reset'} onClick={() => update((s) => { s.languages.subStyle = { font: 'Segoe UI', background: 'outline', outlinePx: 3, sizePct: 100, bold: false, opacityPct: 95, bottomPct: 8, align: 'center', color: '#FFFFFF' }; })} />
      </SettingSection>

      <div className="lg:sticky lg:top-6 self-start">
        <LivePreviewCard>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#1f2937] via-[#111827] to-[#09090b] p-3 ring-1 ring-white/10">
            <div
              className="absolute inset-x-4 px-2 py-1 leading-snug transition-all"
              style={{
                bottom: `${st.bottomPct}%`,
                textAlign: st.align,
                fontFamily: st.font || 'Segoe UI',
                color: st.color,
                opacity: st.opacityPct / 100,
                fontSize: `${Math.round(13 * (st.sizePct / 100))}px`,
                fontWeight: st.bold ? 700 : 500,
                textShadow: subShadow,
                background: st.background === 'bar' ? 'rgba(0,0,0,0.78)' : 'transparent',
                borderRadius: st.background === 'bar' ? '6px' : undefined,
              }}
            >
              {ar ? 'هكذا ستظهر الترجمة أثناء المشاهدة.' : 'Here is how your subtitles will look.'}
            </div>
          </div>
        </LivePreviewCard>
      </div>
    </div>
  );
}
