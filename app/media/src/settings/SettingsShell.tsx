import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronRight, Cpu, Gamepad2, Globe, HelpCircle,
  HardDrive, Palette, PlayCircle, Puzzle, RotateCcw, Search, Sparkles, UserCheck, X,
} from 'lucide-react';
import { useHost, useNav } from '../host';
import { useProfileStore } from '../store/useProfileStore';
import { AccountSetupPage } from './pages/AccountSetupPages';
import { AppearancePage } from './pages/AppearancePages';
import { ControlsDevicesPage } from './pages/ControlsDevicesPages';
import { HelpUpdatesPage } from './pages/HelpUpdatesPages';
import { LanguagesPage } from './pages/LanguagesPages';
import { PlaybackPage } from './pages/PlaybackPages';
import { PluginsPage } from './pages/PluginsPages';
import { SourcesLibraryPage } from './pages/SourcesLibraryPages';
import { SystemPage } from './pages/SystemPages';
import { SETTINGS_CATEGORIES, SETTINGS_NAV_ITEMS } from './searchIndex';
import './settingsTokens.css';
import { useSettingsStore, type SettingsCategoryId, type SettingsPageId, type SettingsState } from './useSettingsStore';

function catIcon(id: SettingsCategoryId) {
  switch (id) {
    case 'account-setup': return <UserCheck size={17} />;
    case 'playback': return <PlayCircle size={17} />;
    case 'languages': return <Globe size={17} />;
    case 'sources-library': return <HardDrive size={17} />;
    case 'plugins': return <Puzzle size={17} />;
    case 'appearance': return <Palette size={17} />;
    case 'controls-devices': return <Gamepad2 size={17} />;
    case 'system': return <Cpu size={17} />;
    case 'help-about': return <HelpCircle size={17} />;
  }
}

function pageResetSection(pageId: SettingsPageId, cat: SettingsCategoryId | 'updates-backup'): keyof SettingsState {
  if (cat === 'updates-backup') return 'updates';
  if (cat === 'account-setup') return 'account';
  if (cat === 'playback') return 'playback';
  if (cat === 'languages') return 'languages';
  if (cat === 'sources-library') return 'sources';
  if (cat === 'plugins') return 'plugins';
  if (cat === 'appearance') return 'appearance';
  if (cat === 'controls-devices') return 'controls';
  if (cat === 'system') return 'system';
  return pageId === 'updates-backup' ? 'updates' : 'system';
}

export function SettingsShell() {
  const { lang, toast } = useHost();
  const nav = useNav();
  const ar = lang === 'ar';
  const { data, activePage, searchQuery, setActivePage, setSearchQuery, hydrateFromBackend, resetPageSection } = useSettingsStore();
  const prof = useProfileStore().saved;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    'account-setup': true,
    playback: true,
    languages: false,
    'sources-library': false,
    plugins: false,
    appearance: false,
    'controls-devices': false,
    system: false,
    'help-about': false,
  });

  useEffect(() => {
    hydrateFromBackend();
    useProfileStore.getState().hydrateFromMajlis();
    if (!SETTINGS_NAV_ITEMS.some((x) => x.id === activePage)) setActivePage('get-started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentMeta = useMemo(
    () => SETTINGS_NAV_ITEMS.find((x) => x.id === activePage) || SETTINGS_NAV_ITEMS[0],
    [activePage],
  );

  const currentCategoryTitle = useMemo(() => {
    if (currentMeta.category === 'updates-backup') return ar ? 'التحديثات والنسخ الاحتياطي' : 'Updates & backup';
    const cat = SETTINGS_CATEGORIES.find((c) => c.id === currentMeta.category);
    return cat ? (ar ? cat.titleAr : cat.titleEn) : '';
  }, [currentMeta, ar]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_NAV_ITEMS.filter(
      (item) =>
        item.titleEn.toLowerCase().includes(q)
        || item.titleAr.toLowerCase().includes(q)
        || item.descEn.toLowerCase().includes(q)
        || item.descAr.toLowerCase().includes(q)
        || item.keywords.some((k) => k.toLowerCase().includes(q)),
    ).slice(0, 14);
  }, [searchQuery]);

  const selectPage = (item: typeof SETTINGS_NAV_ITEMS[number]) => {
    setActivePage(item.id);
    if (item.category !== 'updates-backup') {
      setOpenGroups((prev) => ({ ...prev, [item.category]: true }));
    }
    setSearchQuery('');
  };

  const renderPage = () => {
    switch (currentMeta.category) {
      case 'account-setup': return <AccountSetupPage pageId={activePage} />;
      case 'playback': return <PlaybackPage pageId={activePage} />;
      case 'languages': return <LanguagesPage pageId={activePage} />;
      case 'sources-library': return <SourcesLibraryPage pageId={activePage} />;
      case 'plugins': return <PluginsPage pageId={activePage} />;
      case 'appearance': return <AppearancePage pageId={activePage} />;
      case 'controls-devices': return <ControlsDevicesPage pageId={activePage} />;
      case 'system': return <SystemPage pageId={activePage} />;
      case 'help-about':
      case 'updates-backup':
        return <HelpUpdatesPage pageId={activePage} />;
    }
  };

  const customScopeStyle: React.CSSProperties = {
    fontFamily: data.appearance.fontFamily ? `${data.appearance.fontFamily}, inherit` : undefined,
    ...(data.appearance.themePreset === 'custom' && /^#[0-9a-f]{6}$/i.test(data.appearance.customAccent)
      ? ({ '--accent': data.appearance.customAccent } as React.CSSProperties)
      : {}),
  };

  return (
    <div
      dir={ar ? 'rtl' : 'ltr'}
      data-theme-preset={data.appearance.themePreset}
      style={customScopeStyle}
      className="settings-scope flex h-full w-full overflow-hidden pt-20"
    >
      {/* Left Navigation Sidebar */}
      <aside
        className="flex w-[288px] shrink-0 flex-col border-e border-[var(--border-subtle)]"
        style={{ background: 'var(--bg-sidebar)' }}
      >
        <div className="space-y-3 p-4 border-b border-[var(--border-subtle)]">
          {/* Back button */}
          <div className="app-drag flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav.go('home')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]"
            >
              <ArrowLeft size={15} className="flip" />
              <span>{ar ? 'رجوع' : 'Back'}</span>
            </button>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">{SETTINGS_NAV_ITEMS.length} {ar ? 'صفحة' : 'pages'}</span>
          </div>

          {/* Instant Search Input */}
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              dir="auto"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
              placeholder={ar ? 'ابحث في الإعدادات...' : 'Search settings...'}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-black/35 py-2 pe-8 ps-9 text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>

          {/* Active Profile Pill */}
          <button
            type="button"
            onClick={() => setActivePage('your-profile')}
            className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-start transition ${
              activePage === 'your-profile'
                ? 'border-[var(--accent)] bg-[var(--surface-active)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
            }`}
          >
            <div
              className="grid size-[36px] shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold ring-2"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }}
            >
              {prof.general.avatar ? <img src={prof.general.avatar} alt="" className="h-full w-full object-cover" /> : (prof.general.alias?.[0] || 'M').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div dir="auto" className="truncate text-[14px] font-semibold leading-tight text-[var(--text-primary)]">{prof.general.alias || (ar ? 'مستخدم مجلس' : 'Majlis User')}</div>
              <div className="text-[12px] text-[var(--text-secondary)]">{ar ? 'الملف النشط' : 'Active profile'}</div>
            </div>
          </button>
        </div>

        {/* Search Results OR Category Tree */}
        <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-1.5">
          {searchQuery.trim() ? (
            <div className="space-y-1">
              <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                {ar ? `النتائج (${searchResults.length})` : `Matches (${searchResults.length})`}
              </div>
              {searchResults.length ? searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectPage(item)}
                  className="w-full rounded-xl px-3 py-2 text-start transition hover:bg-[var(--surface-active)]"
                >
                  <div className="text-[13.5px] font-semibold text-[var(--text-primary)]">{ar ? item.titleAr : item.titleEn}</div>
                  <div className="truncate text-[12px] text-[var(--text-secondary)]">{ar ? item.descAr : item.descEn}</div>
                </button>
              )) : (
                <p className="px-3 py-4 text-[13px] text-[var(--text-muted)]">{ar ? 'لا توجد إعدادات مطابقة.' : 'No settings match your query.'}</p>
              )}
            </div>
          ) : (
            <>
              {SETTINGS_CATEGORIES.map((cat) => {
                const open = !!openGroups[cat.id];
                const items = SETTINGS_NAV_ITEMS.filter((it) => it.category === cat.id);
                return (
                  <div key={cat.id} className="mb-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenGroups((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[14.5px] font-bold text-[var(--text-primary)]/95 hover:bg-white/[0.07] hover:text-[var(--text-primary)]"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-[var(--accent)]">{catIcon(cat.id)}</span>
                        <span>{ar ? cat.titleAr : cat.titleEn}</span>
                      </span>
                      <ChevronRight size={14} className={`transition-transform flip text-[var(--text-secondary)] ${open ? 'rotate-90' : ''}`} />
                    </button>
                    {open ? (
                      <div className="mt-1 space-y-0.5 ps-4">
                        {items.map((item) => {
                          const on = item.id === activePage;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setActivePage(item.id)}
                              className={`block w-full truncate rounded-lg px-3.5 py-2 text-start text-[13.5px] leading-snug transition ${
                                on
                                  ? 'bg-[var(--surface-active)] font-semibold text-[var(--accent)]'
                                  : 'font-medium text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {ar ? item.titleAr : item.titleEn}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* Standalone Bottom Item */}
              <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  onClick={() => setActivePage('updates-backup')}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14.5px] font-bold transition ${
                    activePage === 'updates-backup'
                      ? 'bg-[var(--surface-active)] text-[var(--accent)]'
                      : 'text-[var(--text-primary)]/90 hover:bg-white/[0.07] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Sparkles size={16} className="text-[var(--accent)]" />
                  <span>{ar ? 'التحديثات والنسخ الاحتياطي' : 'Updates & backup'}</span>
                </button>
              </div>
            </>
          )}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-6 py-8 pb-24 sm:px-10">
        <div className="mx-auto max-w-[960px]">
          <div
            onDoubleClick={(e) => { if (e.target === e.currentTarget) window.majlis?.invoke?.('win:maximize')?.catch(() => {}); }}
            className="app-drag mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4"
          >
            <div>
              <div className="mb-1 text-[12px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                {currentCategoryTitle}
              </div>
              <h1 className="text-[26px] font-bold leading-tight text-[var(--text-primary)]">
                {ar ? currentMeta.titleAr : currentMeta.titleEn}
              </h1>
              <p className="mt-1 text-[13.5px] text-[var(--text-secondary)]">
                {ar ? currentMeta.descAr : currentMeta.descEn}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetPageSection(pageResetSection(activePage, currentMeta.category));
                toast(ar ? 'تمت استعادة افتراضيات القسم' : 'Section defaults restored');
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <RotateCcw size={12} />
              <span>{ar ? 'إعادة ضبط القسم' : 'Reset section'}</span>
            </button>
          </div>

          {renderPage()}
        </div>
      </main>
    </div>
  );
}
