import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, invoke, social, STREAMING_BRANDS, useInstalled, useSocialMe } from '../api';
import { useHost, useT } from '../host';
import { useProfileStore } from '../store/useProfileStore';
import { Icon } from '../ui/Icon';
import { ServiceLogo } from '../ui/ServiceLogos';
import { AccountsSection, KeysSection, LookSection, ProfilesSection, PlaybackSection, usePrefs } from './Profile';

const STREAMING_CATALOGS_URL = 'https://catalog.ers.pw/manifest.json';

// 6-step responsive visual onboarding wizard: Language -> Theme & Accent -> Community Profile -> Sync Accounts -> Addons -> Keys & Quality
export function Onboarding() {
  const t = useT(), host = useHost(), qc = useQueryClient();
  const prefs = usePrefs().data;
  const meQ = useSocialMe();
  const installed = useInstalled().data || [];
  const [[step, dir], setStepDir] = useState<[number, 1 | -1]>([0, 1]);
  const [addingCatalogs, setAddingCatalogs] = useState(false);
  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    const cur = meQ.data?.displayName;
    if (cur && !displayName) setDisplayName(cur);
  }, [meQ.data?.displayName]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveDisplayName = async (next: string) => {
    const clean = next.trim();
    if (!clean) return;
    useProfileStore.getState().updateSaved((s) => { s.general.alias = clean; s.general.handle = ''; s.general.customUrl = ''; });
    await Promise.all([
      social('me-set', { displayName: clean, handle: '' }).catch(() => {}),
      invoke('settings', { nick: clean }).catch(() => {}),
    ]);
    qc.invalidateQueries({ queryKey: ['social-me'] });
  };
  const goStep = (next: number) => setStepDir(([cur]) => [next, next >= cur ? 1 : -1]);

  const hasCatalogs = installed.some((x) => x.url === STREAMING_CATALOGS_URL);
  const installCatalogs = async () => {
    setAddingCatalogs(true);
    try {
      const m = await cin<{ name: string }>('addon-install', { url: STREAMING_CATALOGS_URL });
      toastOk(t('addon_added', { name: m.name }));
      qc.invalidateQueries({ queryKey: ['addons'] });
      qc.invalidateQueries({ queryKey: ['rows'] });
    } catch (e) {
      host.toast((e as Error).message);
    } finally {
      setAddingCatalogs(false);
    }
  };
  const toastOk = (s: string) => host.toast(s);

  const langBody = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {([
          { id: 'ar', title: 'العربية', sub: 'واجهة عربية كاملة من اليمين لليسار' },
          { id: 'en', title: 'English', sub: 'Full left-to-right English interface' },
        ] as const).map((l) => (
          <button key={l.id} onClick={() => host.setLang?.(l.id)}
            className={`flex flex-col items-start gap-2 rounded-2xl bg-bg1 p-6 text-start ring-1 transition ${host.lang === l.id ? 'bg-acc/12 ring-2 ring-acc' : 'ring-line hover:bg-white/5'}`}>
            <span className="text-2xl font-bold">{l.title}</span>
            <span className="text-sm text-fg2">{l.sub}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: 'play', text: 'libmpv HDR / VSR' },
          { icon: 'users', text: t('party_hub') },
          { icon: 'puzzle', text: t('addons') },
        ].map((f) => (
          <div key={f.icon} className="flex items-center gap-3 rounded-2xl bg-bg1/70 px-4 py-3 text-sm text-fg2 ring-1 ring-line">
            <span className="grid size-8 place-items-center rounded-full bg-acc/15 text-acc"><Icon n={f.icon} s={16} /></span>
            <span>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const themeBody = (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-bg1 p-5 ring-1 ring-line">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg3">
          <div className="flex items-center gap-2">
            <span>{t('theme_majlis_default')} · {prefs?.look?.theme || 'majlis'}</span>
            {(prefs?.look?.theme || 'majlis') === 'majlis' ? (
              <span className="rounded-full bg-acc/20 px-2.5 py-0.5 text-[11px] font-semibold text-acc ring-1 ring-acc/35">
                {t('ob_default_badge')}
              </span>
            ) : null}
          </div>
          <span className="rounded-full bg-acc px-3 py-0.5 font-semibold text-acc-ink">{t('play')}</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {STREAMING_BRANDS.slice(0, 4).map((b) => (
            <div key={b.id} className="flex flex-1 min-w-[110px] items-center justify-center rounded-xl border border-acc/30 bg-[#12100e] p-3 text-acc">
              <ServiceLogo service={b.key} name={b.name} compact />
            </div>
          ))}
        </div>
      </div>
      <LookSection mode="theme" />
    </div>
  );

  const addonsBody = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-bg1 p-5 ring-1 ring-line">
        <div className="space-y-1">
          <div className="text-base font-bold">{t('streaming_catalogs')}</div>
          <div className="text-xs text-fg2">{t('streaming_catalogs_sub')}</div>
        </div>
        <button onClick={installCatalogs} disabled={hasCatalogs || addingCatalogs}
          className={`rounded-full px-5 py-2 text-sm font-semibold transition ${hasCatalogs ? 'bg-white/10 text-acc' : 'bg-acc text-acc-ink hover:brightness-110 disabled:opacity-50'}`}>
          {hasCatalogs ? `✓ ${t('installed')}` : addingCatalogs ? '…' : t('install')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {STREAMING_BRANDS.map((b) => (
          <span key={b.id} className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-[#12100e] px-3 text-[#ebe3d5]">
            <ServiceLogo service={b.key} name={b.name} compact />
          </span>
        ))}
      </div>
      <div className="text-xs text-fg3">{t('installed')}: <b className="text-fg">{installed.length}</b></div>
    </div>
  );

  const steps = [
    { title: t('ob_lang'), sub: t('ob_lang_sub'), body: langBody },
    { title: t('ob_theme'), sub: t('ob_theme_sub'), body: themeBody },
    {
      title: t('ob_welcome'),
      sub: t('ob_welcome_sub'),
      body: (
        <div className="space-y-5">
          <div className="rounded-2xl bg-bg1 p-4 ring-1 ring-line">
            <label className="mb-2 block text-xs font-semibold text-fg2">{t('ob_display_name')}</label>
            <div className="flex flex-wrap gap-2">
              <input
                dir="auto"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => saveDisplayName(displayName)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveDisplayName(displayName); }}
                placeholder={t('display_name_ph')}
                maxLength={40}
                className="min-w-52 flex-1 rounded-xl border border-line bg-bg2 px-3.5 py-2 text-sm text-fg outline-none focus:border-acc"
              />
              <button
                type="button"
                onClick={async () => { await saveDisplayName(displayName); toastOk(t('profile_saved')); }}
                className="rounded-xl bg-acc px-4 py-2 text-xs font-semibold text-acc-ink hover:brightness-110"
              >
                {t('save_profile')}
              </button>
            </div>
          </div>
          <ProfilesSection />
          <LookSection mode="profile" />
        </div>
      ),
    },
    { title: t('ob_bring'), sub: t('ob_bring_sub'), body: <AccountsSection /> },
    { title: t('addons'), sub: t('streaming_catalogs_sub'), body: addonsBody },
    { title: t('ob_watch'), sub: t('ob_watch_sub'), body: <><div className="mb-5 rounded-xl bg-acc/10 px-4 py-3 text-xs text-acc ring-1 ring-acc/30">{t('keys_skip_note')}</div><KeysSection /><PlaybackSection /></> },
  ];

  const done = async () => { await cin('prefs-set', { cinemaOnboarded: true }); qc.invalidateQueries({ queryKey: ['prefs'] }); };
  const s = steps[step];
  const slideOffset = (host.lang === 'ar' ? -dir : dir) * 24;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg/97 backdrop-blur-xl fade-in">
      <div
        onDoubleClick={(e) => { if (e.target === e.currentTarget) invoke('win:maximize').catch(() => {}); }}
        className="app-drag flex items-center gap-2.5 px-6 pb-4 pt-7 pe-[148px] sm:px-10 sm:pe-[156px]"
      >
        {steps.map((st, i) => (
          <button key={i} aria-label={st.title} onClick={() => goStep(i)}
            className={`app-no-drag h-2 rounded-full transition-all duration-300 ${i === step ? 'w-10 bg-acc' : i < step ? 'w-5 bg-acc/50 hover:bg-acc/80' : 'w-5 bg-white/15 hover:bg-white/30'}`} />
        ))}
        <span className="ms-3 text-xs font-medium text-fg3">{t('ob_step_of', { a: step + 1, b: steps.length })}</span>
        <span className="flex-1" />
        <button onClick={done} className="app-no-drag rounded-full px-3 py-1 text-sm text-fg3 transition hover:bg-white/8 hover:text-fg">{t('ob_skip_all')}</button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 sm:px-10">
        <div key={step}
          ref={(el) => {
            if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
            el.animate([{ opacity: 0, transform: `translate3d(${slideOffset}px, 0, 0)` }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
          }}
          className="mx-auto max-w-4xl py-6">
          <h1 className="mb-2 text-3xl font-bold sm:text-4xl">{s.title}</h1>
          <p className="mb-8 text-[15px] text-fg2">{s.sub}</p>
          {s.body}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-6 py-4 sm:px-10 sm:py-5">
        {step > 0 ? <button onClick={() => goStep(step - 1)} className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-fg2 hover:bg-white/8 hover:text-fg"><Icon n="chevl" s={18} className="flip" />{t('back')}</button> : null}
        <span className="flex-1" />
        {step < steps.length - 1
          ? <button onClick={() => goStep(step + 1)} className="flex items-center gap-1.5 rounded-full bg-fg px-7 py-2.5 font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('next')}<Icon n="chevr" s={18} className="flip" /></button>
          : <button onClick={done} className="rounded-full bg-acc px-7 py-2.5 font-semibold text-acc-ink hover:brightness-110">{t('ob_finish')}</button>}
      </div>
    </div>
  );
}
