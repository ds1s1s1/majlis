import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Check, Download, Layout, Plus, Sparkles, Trash2 } from 'lucide-react';
import { cin, useHomePrefs } from '../../api';
import { APP_BRAND } from '../../config/appBrand';
import { useHost, useT } from '../../host';
import { fmtLocaleTime } from '../../i18n';
import {
  ActionRow, BadgePreview, ColorSwatchPicker, DropdownRow, InfoBanner,
  LivePreviewCard, SegmentedRow, SettingSection, SliderRow, ToggleRow,
} from '../primitives';
import { createDefaultSettings, useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const THEME_CARDS: { id: 'default' | 'nord' | 'obsidian' | 'roast' | 'dracula' | 'forest' | 'noir' | 'custom'; name: string; bg: string; card: string; acc: string }[] = [
  { id: 'default', name: 'Majlis Default', bg: '#12100E', card: '#181613', acc: '#E5A93C' },
  { id: 'nord', name: 'Nord', bg: '#151922', card: '#1C222E', acc: '#88C0D0' },
  { id: 'obsidian', name: 'Obsidian', bg: '#09090B', card: '#111114', acc: '#E5A93C' },
  { id: 'roast', name: 'Roast', bg: '#16110D', card: '#201812', acc: '#D9823B' },
  { id: 'dracula', name: 'Dracula', bg: '#191A24', card: '#212230', acc: '#BD93F9' },
  { id: 'forest', name: 'Forest', bg: '#0C1410', card: '#132019', acc: '#34D399' },
  { id: 'noir', name: 'Noir', bg: '#0A0A0B', card: '#121215', acc: '#FFFFFF' },
  { id: 'custom', name: '+ Custom', bg: '#12100E', card: '#181613', acc: '#E5A93C' },
];

const FONTS: { id: 'IBM Plex Sans Arabic' | 'Inter' | 'Outfit' | 'Plus Jakarta Sans' | 'Geist' | 'System UI'; sample: string }[] = [
  { id: 'IBM Plex Sans Arabic', sample: 'سينما مجلس · Clear Cinema Type' },
  { id: 'Inter', sample: 'Crisp Neutral UI & Subtitles' },
  { id: 'Outfit', sample: 'Geometric Modern Headlines' },
  { id: 'Plus Jakarta Sans', sample: 'Warm Studio Typography' },
  { id: 'Geist', sample: 'Technical Clean Monospaced Feel' },
  { id: 'System UI', sample: 'Native Windows Segoe / Tahoma' },
];

const BADGE_GROUPS = [
  { group: 'RESOLUTION', items: ['8K', '4K', '1080p', '720p', 'SD'] },
  { group: 'SOURCE', items: ['REMUX', 'Bluray', 'WEB-DL', 'HDTV', 'SCR'] },
  { group: 'HDR', items: ['DV', 'HDR10+', 'HDR10', 'HDR', 'HLG', 'SDR'] },
  { group: 'CODEC', items: ['HEVC', 'H.264', 'AV1'] },
  { group: 'AUDIO', items: ['Atmos', 'TrueHD', 'DTS-HD', 'EAC3', '7.1'] },
  { group: 'EXTRAS', items: ['Extended', 'Remastered', 'Repack', 'Open Matte'] },
];

export function AppearancePage({ pageId }: { pageId: SettingsPageId }) {
  const t = useT();
  const qc = useQueryClient();
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const homePrefsQ = useHomePrefs();
  const { data, update, setActivePage } = useSettingsStore();
  const ap = data.appearance;

  const [libTab, setLibTab] = useState<'my' | 'community' | 'mine'>('community');
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleImg, setRuleImg] = useState('');
  const [rulePrioritize, setRulePrioritize] = useState(true);
  const [sampleRelease, setSampleRelease] = useState('Movie.2026.2160p.HDR.DV.REMUX.Atmos.x265-GROUP');
  const [hudModalOpen, setHudModalOpen] = useState(false);

  const readImage = (e: React.ChangeEvent<HTMLInputElement>, onDone: (u: string) => void) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { if (typeof r.result === 'string') onDone(r.result); };
    r.readAsDataURL(f);
  };

  if (pageId === 'theme-background') {
    return (
      <>
        <InfoBanner
          title={ar ? 'معرض الثيمات الجاهزة' : 'Built-in theme presets'}
          body={ar ? 'استعرض وطبق ثيمات مجلس الجاهزة بضغطة زر أو اصنع ألوانك الخاصة محلياً.' : 'Explore curated offline color presets or customize your own palette.'}
          action={<button type="button" onClick={() => setActivePage('theme-library')} className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-bold text-[var(--accent-fg)]">{ar ? 'فتح المكتبة' : 'Browse presets'}</button>}
        />
        <SettingSection title={ar ? 'ألوان الثيم (8 خيارات)' : 'Color theme (8 presets)'}>
          <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-4">
            {THEME_CARDS.map((t) => {
              const active = ap.themePreset === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update((s) => { s.appearance.themePreset = t.id; s.appearance.customAccent = t.acc; })}
                  className={`rounded-xl border p-2.5 text-start transition ${active ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border-subtle)] hover:border-white/25'}`}
                  style={{ background: t.bg }}
                >
                  <div className="mb-2 flex items-center justify-between rounded-lg p-2" style={{ background: t.card }}>
                    <span className="h-2 w-8 rounded-full" style={{ background: t.acc }} />
                    {active ? <Check size={12} style={{ color: t.acc }} /> : null}
                  </div>
                  <div className="text-xs font-bold text-white">{t.name}</div>
                </button>
              );
            })}
          </div>
          {ap.themePreset === 'custom' ? (
            <ColorSwatchPicker label={ar ? 'لون التمييز المخصص' : 'Custom accent'} value={ap.customAccent} onChange={(hex) => update((s) => { s.appearance.customAccent = hex; })} />
          ) : null}
        </SettingSection>

        <SettingSection title={ar ? 'صورة الخلفية والتعتيم' : 'Background image & Dim overlay'}>
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex gap-2">
                <label className="cursor-pointer rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-white/20">
                  {ar ? 'اختيار صورة' : 'Choose image'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => readImage(e, (u) => update((s) => { s.appearance.backgroundImageDataUrl = u; }))} />
                </label>
                {ap.backgroundImageDataUrl ? (
                  <button type="button" onClick={() => update((s) => { s.appearance.backgroundImageDataUrl = ''; })} className="rounded-full bg-red-500/15 px-3 py-1.5 text-xs text-red-300">
                    {ar ? 'إزالة' : 'Remove'}
                  </button>
                ) : null}
              </div>
              <SliderRow label={ar ? 'تعتيم الخلفية' : 'Dim overlay'} value={ap.backgroundDimPct} min={0} max={100} unit="%" defaultValue={65} onChange={(v) => update((s) => { s.appearance.backgroundDimPct = v; })} />
            </div>
            <LivePreviewCard>
              <div className="relative h-28 overflow-hidden rounded-xl bg-gradient-to-br from-[#3b240c] via-[#1c2638] to-[#12100E]">
                {ap.backgroundImageDataUrl ? <img src={ap.backgroundImageDataUrl} alt="" className="h-full w-full object-cover" /> : null}
                <div className="absolute inset-0 bg-black" style={{ opacity: ap.backgroundDimPct / 100 }} />
                <div className="relative z-10 flex h-full items-end p-3 text-sm font-bold text-white">Tonight&apos;s picks</div>
              </div>
            </LivePreviewCard>
          </div>
        </SettingSection>
      </>
    );
  }

  if (pageId === 'your-themes') {
    const copyThemeJson = () => {
      navigator.clipboard?.writeText(JSON.stringify({ preset: ap.themePreset, accent: ap.customAccent, font: ap.fontFamily }, null, 2)).catch(() => {});
      toast(ar ? 'تم نسخ JSON الثيم' : 'Theme JSON copied');
    };
    return (
      <SettingSection title={ar ? 'استوديو ثيماتك' : 'Your themes'}>
        <ColorSwatchPicker label={ar ? 'اللون الرئيسي النشط' : 'Active Accent Color'} value={ap.customAccent} onChange={(c) => update((s) => { s.appearance.themePreset = 'custom'; s.appearance.customAccent = c; })} />
        <ActionRow label={ar ? 'نسخ إعدادات الثيم الحالي' : 'Copy theme JSON'} buttonLabel={ar ? 'نسخ' : 'Copy theme'} onClick={copyThemeJson} />
        <ActionRow label={ar ? 'استكشاف مكتبة الثيمات' : 'Theme Library'} buttonLabel={ar ? 'فتح المكتبة' : 'Open library'} onClick={() => setActivePage('theme-library')} />
      </SettingSection>
    );
  }

  if (pageId === 'theme-library') {
    return (
      <SettingSection title={ar ? 'مكتبة الثيمات' : 'Theme library'}>
        <div className="mb-4 flex gap-2">
          {([
            { id: 'my', label: ar ? 'مكتبتي' : 'My library' },
            { id: 'community', label: ar ? 'الجاهزة' : 'Presets' },
            { id: 'mine', label: ar ? 'ثيماتي' : 'My themes' },
          ] as const).map((t) => (
            <button key={t.id} type="button" onClick={() => setLibTab(t.id)} className={`rounded-full px-3.5 py-1 text-xs font-semibold ${libTab === t.id ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/8 text-white/70'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_CARDS.slice(0, 6).map((t) => (
            <div key={t.id} className="rounded-xl border border-[var(--border-subtle)] bg-black/30 p-3">
              <div className="mb-2.5 h-16 rounded-lg p-2" style={{ background: t.bg, border: `1px solid ${t.acc}40` }}>
                <span className="inline-block h-2 w-10 rounded-full" style={{ background: t.acc }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">{t.name}</span>
                <button type="button" onClick={() => { update((s) => { s.appearance.themePreset = t.id; s.appearance.customAccent = t.acc; }); toast(`${t.name} applied`); }} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]">
                  {ar ? 'تطبيق' : 'Apply'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'logo-icon') {
    return (
      <SettingSection title={ar ? 'الشعار والأيقونة' : 'Logo & application icons'}>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
          <div className="flex items-center gap-3">
            {ap.customLogoDataUrl ? (
              <img src={ap.customLogoDataUrl} alt="" className="size-10 rounded-xl bg-black/40 object-contain p-1 ring-1 ring-white/15" />
            ) : null}
            <div>
              <div className="text-[13.5px] font-medium text-[var(--text-primary)]">{`${APP_BRAND.nameEn} Custom Logo`}</div>
              <p className="text-xs text-[var(--text-muted)]">
                {ap.customLogoDataUrl ? (ar ? 'تم تعيين شعار مخصص' : 'Custom logo asset saved locally') : (ar ? 'اختر ملف PNG أو SVG لاستبدال الشعار' : 'Choose a local PNG/SVG image')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-white/20">
              {ar ? 'رفع شعار' : 'Upload'}
              <input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={(e) => readImage(e, (u) => { update((s) => { s.appearance.customLogoDataUrl = u; }); toast(ar ? 'تم حفظ الشعار' : 'Custom logo saved'); })} />
            </label>
            {ap.customLogoDataUrl ? (
              <button type="button" onClick={() => update((s) => { s.appearance.customLogoDataUrl = ''; })} className="rounded-full bg-red-500/15 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/25">
                {ar ? 'إعادة ضبط' : 'Reset'}
              </button>
            ) : null}
          </div>
        </div>
        <SegmentedRow label={ar ? 'أيقونة التطبيق الجاهزة' : 'Icon preset'} value={ap.appIconPreset} options={[{ value: 'majlis-gold', label: 'Majlis Gold' }, { value: 'minimal-dark', label: 'Minimal Dark' }, { value: 'classic-ruby', label: 'Ruby' }, { value: 'emerald', label: 'Emerald' }]} onChange={(v) => update((s) => { s.appearance.appIconPreset = v; })} />
        <ToggleRow label={ar ? 'استخدام غلاف الموسيقى كأيقونة أثناء التشغيل' : 'Use album art as app icon while music plays'} checked={ap.albumArtAsIcon} onChange={(v) => update((s) => { s.appearance.albumArtAsIcon = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'typography') {
    return (
      <SettingSection title={ar ? 'الخطوط والطباعة' : 'Typography'}>
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-3">
          {FONTS.map((f) => {
            const active = ap.fontFamily === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => update((s) => { s.appearance.fontFamily = f.id; })}
                className={`rounded-xl border p-3.5 text-start transition ${active ? 'border-[var(--accent)] bg-[var(--surface-active)]' : 'border-[var(--border-subtle)] bg-black/25 hover:bg-white/5'}`}
                style={{ fontFamily: f.id }}
              >
                <div className="text-xs font-bold text-[var(--accent)]">{f.id}</div>
                <div className="mt-1.5 text-sm font-medium">{f.sample}</div>
              </button>
            );
          })}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'interface') {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <SettingSection title={ar ? 'تخطيط الواجهة والبوسترات' : 'Interface & poster styling'}>
          <ToggleRow
            label={t('zen_mode')}
            description={t('zen_mode_desc')}
            checked={!!homePrefsQ.data?.zenMode}
            onChange={async (v) => {
              const next = await cin('home-prefs-set', { zenMode: v });
              qc.setQueryData(['home-prefs'], next);
            }}
          />
          <ToggleRow label={ar ? 'المكتبة السريعة' : 'Quick library'} checked={ap.quickLibrary} onChange={(v) => update((s) => { s.appearance.quickLibrary = v; })} />
          <ToggleRow label={ar ? 'فتح الألعاب داخل مكتبتك' : 'Open Games in your library'} checked={ap.openGamesInLib} onChange={(v) => update((s) => { s.appearance.openGamesInLib = v; })} />
          <SegmentedRow label={ar ? 'نمط البطاقة' : 'Poster card style'} value={ap.posterStyle} options={[{ value: 'poster', label: 'Poster (2:3)' }, { value: 'tv', label: 'TV (16:9)' }]} onChange={(v) => update((s) => { s.appearance.posterStyle = v; })} />
          <SliderRow label={ar ? 'حجم البوستر' : 'Poster size'} value={ap.posterSizePct} min={80} max={130} unit="%" defaultValue={100} onChange={(v) => update((s) => { s.appearance.posterSizePct = v; })} />
          <SliderRow label={ar ? 'استدارة الزوايا' : 'Corner radius'} value={ap.posterRadiusPx} min={0} max={24} unit="px" defaultValue={14} onChange={(v) => update((s) => { s.appearance.posterRadiusPx = v; })} />
          <SliderRow label={ar ? 'حجم عنوان البطاقة' : 'Card title size'} value={ap.cardTitleSizePct} min={75} max={150} unit="%" defaultValue={100} onChange={(v) => update((s) => { s.appearance.cardTitleSizePct = v; })} />
          <SliderRow label={ar ? 'مقياس الواجهة الكلي' : 'Interface scale'} value={ap.uiScalePct} min={80} max={150} unit="%" defaultValue={100} onChange={(v) => update((s) => { s.appearance.uiScalePct = v; })} />
          <ToggleRow label="Liquid Glass" description={ar ? 'تأثير الزجاج الضبابي الشفاف للأسطح العائمة' : 'Backdrop blur glass translucency across overlays'} checked={ap.liquidGlass} onChange={(v) => update((s) => { s.appearance.liquidGlass = v; })} />
        </SettingSection>
        <div className="lg:sticky lg:top-6 self-start">
          <LivePreviewCard>
            <div
              className="mx-auto overflow-hidden bg-gradient-to-br from-[#3b240c] to-[#12100E] ring-1 ring-white/15 transition-all"
              style={{
                width: `${Math.round(140 * (ap.posterSizePct / 100))}px`,
                aspectRatio: ap.posterStyle === 'tv' ? '16 / 9' : '2 / 3',
                borderRadius: `${ap.posterRadiusPx}px`,
              }}
            />
            <div className="mt-2 text-center font-semibold" style={{ fontSize: `${Math.round(12 * (ap.cardTitleSizePct / 100))}px` }}>
              Featured Preview
            </div>
          </LivePreviewCard>
        </div>
      </div>
    );
  }

  if (pageId === 'motion-sound') {
    return (
      <SettingSection title={ar ? 'الحركة وشاشة التوقف والأصوات' : 'Motion, Screensaver & SFX'}>
        <ToggleRow label={ar ? 'تحريك أيقونات الشريط الجانبي' : 'Animated sidebar icons'} checked={ap.animatedSidebarIcons} onChange={(v) => update((s) => { s.appearance.animatedSidebarIcons = v; })} />
        <ToggleRow label={ar ? 'شاشة التوقف السينمائية' : 'Ambient screensaver'} checked={ap.ambientScreensaver} onChange={(v) => update((s) => { s.appearance.ambientScreensaver = v; })} />
        <DropdownRow label={ar ? 'تشغيل شاشة التوقف بعد' : 'Start after'} value={ap.screensaverAfterMin} options={[2, 5, 10, 15].map((n) => ({ value: n as typeof ap.screensaverAfterMin, label: `${n} min` }))} onChange={(v) => update((s) => { s.appearance.screensaverAfterMin = v; })} />
        <SegmentedRow label={ar ? 'المؤثرات الصوتية للواجهة' : 'Sound effects'} value={ap.soundEffects} options={[{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'cinematic', label: 'Cinematic' }, { value: 'retro', label: 'Retro' }]} onChange={(v) => update((s) => { s.appearance.soundEffects = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'window') {
    return (
      <SettingSection title={ar ? 'النافذة والشريط العلوي' : 'Window & top bar chrome'}>
        <ToggleRow label={ar ? 'استخدام شريط عنوان ويندوز الأصلي' : 'Use the native window title bar'} checked={ap.nativeTitleBar} onChange={(v) => update((s) => { s.appearance.nativeTitleBar = v; })} />
        <ToggleRow label={ar ? 'شريط علوي بنمط أصلي' : 'Native-style top/title bar'} checked={ap.nativeStyleTopBar} onChange={(v) => update((s) => { s.appearance.nativeStyleTopBar = v; })} />
        <SegmentedRow label={ar ? 'شفافية الشريط العلوي' : 'Top bar style'} value={ap.topBarStyle} options={[{ value: 'translucent', label: 'Translucent' }, { value: 'glass', label: 'Liquid glass' }, { value: 'solid', label: 'Solid' }]} onChange={(v) => update((s) => { s.appearance.topBarStyle = v; })} />
        <ToggleRow label={ar ? 'تعويم الشريط العلوي عند التمرير' : 'Float the top bar on scroll'} checked={ap.floatTopBarScroll} onChange={(v) => update((s) => { s.appearance.floatTopBarScroll = v; })} />
        <ToggleRow label={ar ? 'سحب النافذة من أي مساحة فارغة' : 'Drag the window from anywhere'} checked={ap.dragAnywhere} onChange={(v) => update((s) => { s.appearance.dragAnywhere = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'player-layout') {
    const pl = ap.playerLayout;
    const HUD_OPTIONS: { id: string; label: string }[] = [
      { id: 'play', label: t('th_hud_btn_play') },
      { id: 'time', label: t('th_hud_btn_time') },
      { id: 'volume', label: t('th_hud_btn_volume') },
      { id: 'subtitles', label: t('th_hud_btn_subtitles') },
      { id: 'audio', label: t('th_hud_btn_audio') },
      { id: 'more', label: t('th_hud_btn_more') },
      { id: 'pip', label: t('th_hud_btn_pip') },
      { id: 'fullscreen', label: t('th_hud_btn_fullscreen') },
      { id: 'seek', label: t('th_hud_btn_seek') },
      { id: 'sources', label: t('th_hud_btn_sources') },
      { id: 'episodes', label: t('th_hud_btn_episodes') },
      { id: 'chapters', label: t('th_hud_btn_chapters') },
      { id: 'speed', label: t('th_hud_btn_speed') },
      { id: 'video', label: t('th_hud_btn_video') },
      { id: 'tools', label: t('th_hud_btn_tools') },
      { id: 'said', label: t('th_hud_btn_said') },
      { id: 'lock', label: t('th_hud_btn_lock') },
    ];
    return (
      <>
        <SettingSection
          title={ar ? 'معاينة شريط التقديم الحية' : 'Live Seek Bar & Control Bar'}
          rightAction={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  update((s) => { s.appearance.playerLayout = createDefaultSettings().appearance.playerLayout; });
                  toast(ar ? 'تمت استعادة تخطيط المشغل الافتراضي' : 'Player layout reset to defaults');
                }}
                className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/15"
              >
                {ar ? 'إعادة ضبط' : 'Reset'}
              </button>
              <button type="button" onClick={() => setHudModalOpen(true)} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"><Layout size={13} />{ar ? 'تعديل الأزرار' : 'Edit player layout'}</button>
            </div>
          }
        >
          <div className="mb-4 rounded-xl bg-black/75 p-4 ring-1 ring-white/10">
            <div className="mb-2 flex justify-between font-mono text-[10px] text-white/60">
              <span>{pl.fullscreenClock ? fmtLocaleTime(Date.now(), lang, { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <span>{pl.timeFormat === 'elapsed-only' ? '42:15' : pl.timeFormat === 'elapsed-remaining' ? '42:15 / -1:04:10' : '42:15 / 1:46:25'}</span>
            </div>
            <div className="relative flex items-center" style={{ height: `${Math.max(pl.seekHeightPx + 10, pl.seekDotSizePx + 4)}px` }}>
              <div className="relative w-full overflow-hidden rounded-full bg-white/15" style={{ height: `${pl.seekHeightPx}px` }}>
                {pl.bufferFill ? <div className="absolute inset-y-0 start-0 bg-white" style={{ width: '68%', opacity: pl.bufferBrightnessPct / 100 }} /> : null}
                <div className="absolute inset-y-0 start-0" style={{ width: '42%', background: pl.seekColor }} />
              </div>
              <div
                className={`absolute -translate-x-1/2 shadow ${pl.seekDotShape === 'custom' ? 'rotate-45' : ''}`}
                style={{
                  left: '42%',
                  width: `${pl.seekDotSizePx}px`,
                  height: `${pl.seekDotSizePx}px`,
                  background: pl.seekColor,
                  borderRadius: pl.seekDotShape === 'circle' ? '9999px' : pl.seekDotShape === 'square' ? '2px' : '4px',
                }}
              />
            </div>
          </div>

          <SegmentedRow
            label={ar ? 'حجم أزرار الشريط' : 'HUD scale'}
            value={pl.hudScale || 'default'}
            options={[
              { value: 'compact', label: ar ? 'مضغوط' : 'Compact' },
              { value: 'default', label: ar ? 'قياسي' : 'Default' },
              { value: 'spacious', label: ar ? 'واسع' : 'Spacious' },
            ]}
            onChange={(v) => update((s) => { s.appearance.playerLayout.hudScale = v; })}
          />
          <SegmentedRow
            label={ar ? 'مدة إخفاء الشريط تلقائياً' : 'Auto-hide HUD delay'}
            value={String(pl.autoHideDelaySec || 3)}
            options={[
              { value: '2', label: ar ? '2 ث' : '2s' },
              { value: '3', label: ar ? '3 ث' : '3s' },
              { value: '5', label: ar ? '5 ث' : '5s' },
              { value: '8', label: ar ? '8 ث' : '8s' },
            ]}
            onChange={(v) => update((s) => { s.appearance.playerLayout.autoHideDelaySec = Number(v) as 2 | 3 | 5 | 8; })}
          />
          <SegmentedRow
            label={ar ? 'شكل شريط الصوت' : 'Volume control style'}
            value={pl.volumeControl}
            options={[
              { value: 'slider', label: ar ? 'شريط أفقي' : 'Slider' },
              { value: 'vertical', label: ar ? 'عمودي' : 'Vertical' },
              { value: 'stepper', label: ar ? 'أزرار −/+' : 'Stepper' },
              { value: 'icon', label: ar ? 'أيقونة فقط' : 'Icon only' },
            ]}
            onChange={(v) => update((s) => { s.appearance.playerLayout.volumeControl = v; })}
          />
          <SegmentedRow label={ar ? 'شكل شريط التقديم' : 'Seek bar style'} value={pl.seekStyle} options={[{ value: 'pinstripe', label: ar ? 'خط رفيع' : 'Pinstripe' }, { value: 'boldline', label: ar ? 'عريض' : 'Boldline' }]} onChange={(v) => update((s) => { s.appearance.playerLayout.seekStyle = v; s.appearance.playerLayout.seekHeightPx = v === 'pinstripe' ? 2 : 5; })} />
          <SliderRow label={ar ? 'ارتفاع الشريط' : 'Bar height'} value={pl.seekHeightPx} min={2} max={12} unit="px" defaultValue={4} onChange={(v) => update((s) => { s.appearance.playerLayout.seekHeightPx = v; })} />
          <ColorSwatchPicker label={ar ? 'لون شريط التقديم' : 'Bar color'} value={pl.seekColor} onChange={(c) => update((s) => { s.appearance.playerLayout.seekColor = c; })} />
          <ToggleRow label={ar ? 'إظهار النقطة عند التمرير فقط' : 'Reveal the dot on hover'} checked={pl.revealDotHover} onChange={(v) => update((s) => { s.appearance.playerLayout.revealDotHover = v; })} />
          <ToggleRow label={ar ? 'شريط التخزين المؤقت (Buffer)' : 'Buffer fill'} checked={pl.bufferFill} onChange={(v) => update((s) => { s.appearance.playerLayout.bufferFill = v; })} />
          {pl.bufferFill ? (
            <SliderRow label={ar ? 'سطوع شريط التخزين المؤقت' : 'Buffer brightness'} value={pl.bufferBrightnessPct} min={10} max={85} unit="%" defaultValue={35} onChange={(v) => update((s) => { s.appearance.playerLayout.bufferBrightnessPct = v; })} />
          ) : null}
          <SegmentedRow label={ar ? 'شكل مقبض التقديم' : 'Seek dot shape'} value={pl.seekDotShape} options={[{ value: 'circle', label: ar ? 'دائري' : 'Circle' }, { value: 'square', label: ar ? 'مربع' : 'Square' }, { value: 'custom', label: ar ? 'معين' : 'Diamond' }]} onChange={(v) => update((s) => { s.appearance.playerLayout.seekDotShape = v; })} />
          <SliderRow label={ar ? 'حجم المقبض' : 'Dot size'} value={pl.seekDotSizePx} min={8} max={22} unit="px" defaultValue={14} onChange={(v) => update((s) => { s.appearance.playerLayout.seekDotSizePx = v; })} />
          <SegmentedRow label={ar ? 'صيغة الوقت' : 'Time format'} value={pl.timeFormat} options={[{ value: 'elapsed-total', label: ar ? 'المنقضي / الكلي' : 'Elapsed / Total' }, { value: 'elapsed-remaining', label: ar ? 'المنقضي / المتبقي' : 'Elapsed / -Rem' }, { value: 'elapsed-only', label: ar ? 'المنقضي فقط' : 'Elapsed' }]} onChange={(v) => update((s) => { s.appearance.playerLayout.timeFormat = v; })} />
          <ToggleRow label={ar ? 'الساعة في ملء الشاشة' : 'Fullscreen clock'} checked={pl.fullscreenClock} onChange={(v) => update((s) => { s.appearance.playerLayout.fullscreenClock = v; })} />
          <ToggleRow label={ar ? 'معاينة الإطار عند التمرير على الشريط' : 'Hover thumbnail preview'} checked={pl.hoverThumbPreview} onChange={(v) => update((s) => { s.appearance.playerLayout.hoverThumbPreview = v; })} />
          <ToggleRow label={ar ? 'دعم قفل عناصر التحكم' : 'Enable control lock toggle'} checked={pl.showControlLock} onChange={(v) => update((s) => { s.appearance.playerLayout.showControlLock = v; })} />
        </SettingSection>
        {hudModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setHudModalOpen(false); }}>
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#161310] p-5 space-y-3">
              <h3 className="text-sm font-bold">{ar ? 'عناصر شريط المشغل' : 'Customize HUD Controls'}</h3>
              <div className="flex flex-wrap gap-2">
                {HUD_OPTIONS.map((ctrl) => {
                  const on = pl.visibleControls.includes(ctrl.id);
                  return (
                    <button key={ctrl.id} type="button" onClick={() => update((s) => {
                      s.appearance.playerLayout.visibleControls = on ? pl.visibleControls.filter((x) => x !== ctrl.id) : [...pl.visibleControls, ctrl.id];
                    })} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${on ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/8 text-white/75 hover:bg-white/15'}`}>
                      {ctrl.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end"><button type="button" onClick={() => setHudModalOpen(false)} className="rounded-full bg-white/12 px-4 py-1.5 text-xs font-semibold">{ar ? 'تم' : 'Done'}</button></div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (pageId === 'stream-badges') {
    return (
      <SettingSection title={ar ? 'شارات تنسيق الروابط' : 'Stream badges'}>
        <ToggleRow label={ar ? 'إظهار شارات الصيغة والدقة' : 'Show format chips on stream rows'} checked={ap.showStreamFormatChips} onChange={(v) => update((s) => { s.appearance.showStreamFormatChips = v; })} />
        <div className="space-y-4 pt-3">
          {BADGE_GROUPS.map((bg) => (
            <div key={bg.group}>
              <div className="mb-1.5 text-[10px] font-bold tracking-widest text-[var(--text-muted)]">{bg.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {bg.items.map((item) => (
                  <BadgePreview
                    key={item}
                    label={item}
                    active={ap.enabledBadges[item] !== false}
                    onClick={() => update((s) => { s.appearance.enabledBadges[item] = !(ap.enabledBadges[item] !== false); })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'badge-rules') {
    const matchedBadges = useMemo(() => {
      return ap.badgeRules.filter((r) => {
        try { return new RegExp(r.pattern, 'i').test(sampleRelease); } catch { return false; }
      });
    }, [ap.badgeRules, sampleRelease]);

    return (
      <>
        <SettingSection title={ar ? 'اختبار حي على عنوان رابط' : 'TEST AGAINST A TITLE'}>
          <input dir="ltr" value={sampleRelease} onChange={(e) => setSampleRelease(e.target.value)} className="w-full rounded-xl bg-black/40 px-3 py-2 font-mono text-xs ring-1 ring-white/10 outline-none" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase text-[var(--accent)]">LIVE PREVIEW:</span>
            {matchedBadges.length ? matchedBadges.map((b) => <BadgePreview key={b.id} label={b.name} active />) : <span className="text-xs text-white/45">No custom rules matched</span>}
          </div>
        </SettingSection>

        <SettingSection title={ar ? 'قواعد الشارات (Regex)' : 'Custom Badge Rules'}>
          <input value={ruleSearch} onChange={(e) => setRuleSearch(e.target.value)} placeholder={ar ? 'تصفية القواعد...' : 'Search rules...'} className="mb-3 w-full rounded-xl bg-black/35 px-3 py-1.5 text-xs ring-1 ring-white/10 outline-none" />
          <div className="space-y-2 mb-4">
            {ap.badgeRules.filter((r) => !ruleSearch.trim() || r.name.toLowerCase().includes(ruleSearch.toLowerCase())).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-black/25 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold">{r.name} {r.prioritize ? <span className="text-[10px] text-[var(--accent)]">★</span> : null}</div>
                  <div dir="ltr" className="truncate font-mono text-[11px] text-white/50">{r.pattern}</div>
                </div>
                <button type="button" onClick={() => update((s) => { s.appearance.badgeRules = s.appearance.badgeRules.filter((x) => x.id !== r.id); })} className="text-red-300"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-2">
            <div className="text-[11px] font-bold uppercase text-white/60">ADD A RULE</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Rule name" className="rounded-lg bg-black/40 px-3 py-1.5 text-xs ring-1 ring-white/10 outline-none" />
              <input dir="ltr" value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} placeholder="Regex e.g. \bIMAX\b" className="rounded-lg bg-black/40 px-3 py-1.5 font-mono text-xs ring-1 ring-white/10 outline-none" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rulePrioritize} onChange={(e) => setRulePrioritize(e.target.checked)} />Prioritize match</label>
              <button
                type="button"
                disabled={!ruleName.trim() || !rulePattern.trim()}
                onClick={() => {
                  update((s) => { s.appearance.badgeRules.push({ id: `rule-${Date.now()}`, name: ruleName.trim(), pattern: rulePattern.trim(), imageUrl: ruleImg, prioritize: rulePrioritize }); });
                  setRuleName(''); setRulePattern(''); setRuleImg('');
                }}
                className="inline-flex items-center gap-1 rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                <Plus size={12} />Add rule
              </button>
            </div>
          </div>
        </SettingSection>
      </>
    );
  }

  if (pageId === 'badge-packs') {
    const UHD_PACK: { id: string; name: string; pattern: string; imageUrl: string; prioritize: boolean }[] = [
      { id: 'rule-dv', name: 'Dolby Vision', pattern: '\\b(DoVi|DV|Dolby\\.?Vision)\\b', imageUrl: '', prioritize: true },
      { id: 'rule-hdr10p', name: 'HDR10+', pattern: '\\bHDR10\\+\\b', imageUrl: '', prioritize: true },
      { id: 'rule-remux', name: 'Bluray Remux', pattern: '\\bREMUX\\b', imageUrl: '', prioritize: true },
      { id: 'rule-atmos', name: 'TrueHD Atmos', pattern: '\\b(TrueHD|Atmos)\\b', imageUrl: '', prioritize: true },
      { id: 'rule-dtshd', name: 'DTS-HD MA', pattern: '\\bDTS-?HD(?:\\.?MA)?\\b', imageUrl: '', prioritize: true },
      { id: 'rule-flac', name: 'FLAC Lossless', pattern: '\\bFLAC\\b', imageUrl: '', prioritize: false },
    ];
    const onPackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        if (Array.isArray(parsed)) {
          update((s) => {
            const seen = new Set(s.appearance.badgeRules.map((r) => r.id));
            const next = parsed.filter((r) => r && r.id && !seen.has(r.id));
            s.appearance.badgeRules = [...next, ...s.appearance.badgeRules];
          });
          toast(ar ? `تم استيراد ${parsed.length} قاعدة` : `Imported ${parsed.length} badge rules`);
        }
      } catch {
        toast('Invalid JSON');
      }
    };
    const loadCuratedPack = () => {
      const existing = new Set(ap.badgeRules.map((r) => r.id));
      const toAdd = UHD_PACK.filter((r) => !existing.has(r.id));
      if (toAdd.length) {
        update((s) => { s.appearance.badgeRules = [...s.appearance.badgeRules, ...toAdd]; });
      }
      toast(toAdd.length
        ? (ar ? `تمت إضافة ${toAdd.length} شارات UHD` : `Added ${toAdd.length} UHD badge rules`)
        : (ar ? 'جميع قواعد حزمة UHD مفعّلة بالفعل' : 'All curated UHD badge rules are already loaded'));
    };
    return (
      <SettingSection title={ar ? 'حزم الشارات' : 'Badge packs'}>
        <ActionRow label={ar ? 'حزمة UHD / Remux القياسية' : 'Load curated UHD Badge Pack'} description="Dolby Vision, HDR10+, TrueHD Atmos, DTS-HD MA & FLAC badges" buttonLabel={ar ? 'تحميل الحزمة' : 'Load pack'} extra={<Sparkles size={14} className="text-[var(--accent)]" />} onClick={loadCuratedPack} />
        <div className="pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20">
            <Download size={13} />{ar ? 'استيراد حزمة (.json)' : 'Import badge pack (.json)'}
            <input type="file" accept=".json,application/json" className="hidden" onChange={onPackFile} />
          </label>
        </div>
      </SettingSection>
    );
  }

  // award-icons
  const AWARDS = ['Academy Awards (Oscar)', 'Cannes Film Festival', 'Golden Globes', 'Emmy Awards', 'Crunchyroll Anime Awards'];
  return (
    <SettingSection title={ar ? 'أيقونات الجوائز السينمائية' : 'Award icons'}>
      {AWARDS.map((aw) => (
        <div key={aw} className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center overflow-hidden rounded-xl bg-amber-500/15 text-[var(--accent)]">
              {ap.awardsCustomIcons[aw] ? <img src={ap.awardsCustomIcons[aw]} alt="" className="h-full w-full object-cover" /> : <Award size={18} />}
            </span>
            <span className="text-sm font-medium">{aw}</span>
          </div>
          <label className="cursor-pointer rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-white/20">
            {ar ? 'استبدال الأيقونة' : 'Replace icon'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => readImage(e, (u) => update((s) => { s.appearance.awardsCustomIcons[aw] = u; }))} />
          </label>
        </div>
      ))}
    </SettingSection>
  );
}
