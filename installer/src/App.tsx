import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SplashMajlisReveal } from './components/SplashMajlisReveal';
import { WizardShell } from './components/WizardShell';
import { INSTALLER_CONFIG } from './config/installerConfig';
import { INSTALLER_DICT, INSTALLER_LANGUAGES } from './config/i18n';
import { ComponentsStep } from './steps/ComponentsStep';
import { CompleteStep } from './steps/CompleteStep';
import { INSTALL_STAGES, InstallingStep, type InstallProgressState } from './steps/InstallingStep';
import { LanguageStep } from './steps/LanguageStep';
import { TermsStep } from './steps/TermsStep';
import { WelcomeStep } from './steps/WelcomeStep';

type Step = 'SPLASH' | 'WELCOME' | 'LANGUAGE' | 'TERMS' | 'COMPONENTS' | 'INSTALLING' | 'COMPLETE';

interface EnvInfo {
  defaultDir: string;
  isRepairMode: boolean;
  freeMb: number;
  webview2Installed: boolean;
}

export function App() {
  const [step, setStep] = useState<Step>('SPLASH');
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  const [selectedLangCode, setSelectedLangCode] = useState<string>('ar');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isRepairMode, setIsRepairMode] = useState(false);
  const [cleanInstall, setCleanInstall] = useState(false);
  const [destDir, setDestDir] = useState<string>('%LOCALAPPDATA%\\Majlis');
  const [freeMb, setFreeMb] = useState<number | null>(null);
  const [selectedOpt, setSelectedOpt] = useState<Record<string, boolean>>({
    opt_gamepad: true,
    opt_metadata: true,
    opt_discord: false,
  });
  const [desktopShortcut, setDesktopShortcut] = useState(true);
  const [startMenuShortcut, setStartMenuShortcut] = useState(true);
  const [launchStartup, setLaunchStartup] = useState(false);
  const [registerProtocol, setRegisterProtocol] = useState(true);
  const [launchOnFinish, setLaunchOnFinish] = useState(true);
  const [progress, setProgress] = useState<InstallProgressState>({
    percent: 0, stage: '', filesDone: 0, filesTotal: 0, speedMb: 0, etaSec: 0, completedIds: [], activeId: 'core',
  });
  const cancelFallbackRef = useRef(false);

  const uiLang: 'ar' | 'en' = selectedLangCode === 'ar' ? 'ar' : 'en';
  const rtl = INSTALLER_LANGUAGES.find((l) => l.code === selectedLangCode)?.rtl ?? (uiLang === 'ar');
  const dir: 'rtl' | 'ltr' = rtl ? 'rtl' : 'ltr';
  const d = INSTALLER_DICT[uiLang];

  // Zero-white-flash first-paint window reveal + environment detection (never gate on rAF while hidden)
  useEffect(() => {
    const reveal = () => {
      try { void getCurrentWindow().show(); } catch {}
    };
    reveal();
    const t = setTimeout(reveal, 60);
    invoke<EnvInfo>('detect_environment')
      .then((info) => {
        if (info?.defaultDir) setDestDir(info.defaultDir);
        setIsRepairMode(!!info?.isRepairMode);
        if (typeof info?.freeMb === 'number') setFreeMb(info.freeMb);
      })
      .catch(() => {});
    return () => clearTimeout(t);
  }, []);

  // Listen to real Rust SFX progress events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{
      percent: number; stepKey?: string; componentId?: string; status?: string;
      filesDone?: number; filesTotal?: number; speedMb?: number; etaSec?: number;
    }>('install-progress', (ev) => {
      const p = ev.payload;
      if (p.status === 'error') {
        setProgress((prev) => ({
          ...prev,
          error: p.stepKey || 'Installation failed',
          stage: p.stepKey || prev.stage,
        }));
        return;
      }
      setProgress((prev) => {
        const compId = p.componentId || prev.activeId;
        const stageIdx = INSTALL_STAGES.indexOf(compId as (typeof INSTALL_STAGES)[number]);
        const priorDone = stageIdx > 0 ? INSTALL_STAGES.slice(0, stageIdx) : [];
        const completedSet = new Set<string>([...prev.completedIds, ...priorDone]);
        if (p.status === 'done' || p.status === 'complete') completedSet.add(compId);
        if (p.status === 'complete') INSTALL_STAGES.forEach((s) => completedSet.add(s));
        return {
          percent: p.percent ?? prev.percent,
          stage: p.stepKey || prev.stage,
          filesDone: p.filesDone ?? prev.filesDone,
          filesTotal: p.filesTotal ?? prev.filesTotal,
          speedMb: p.speedMb ?? prev.speedMb,
          etaSec: p.etaSec ?? prev.etaSec,
          completedIds: Array.from(completedSet),
          activeId: p.status === 'done' || p.status === 'complete' ? compId : (p.componentId || prev.activeId),
          error: undefined,
        };
      });
      if (p.percent >= 100 && p.status === 'complete') {
        setTimeout(() => { setStepDir(1); setStep('COMPLETE'); }, 350);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  const go = useCallback((next: Step, direction: 1 | -1 = 1) => {
    setStepDir(direction);
    setStep(next);
  }, []);

  const onSplashComplete = useCallback(() => {
    setStepDir(1);
    setStep('WELCOME');
  }, []);

  const pickDir = async () => {
    try {
      const picked = await invoke<string | null>('pick_install_dir', { initial: destDir });
      if (picked) {
        setDestDir(picked);
        const free = await invoke<number>('check_disk_space', { path: picked }).catch(() => null);
        if (typeof free === 'number') setFreeMb(free);
      }
    } catch {}
  };

  const startInstall = async () => {
    cancelFallbackRef.current = false;
    setProgress({ percent: 2, stage: d.stageExtract, filesDone: 0, filesTotal: 0, speedMb: 0, etaSec: 0, completedIds: [], activeId: 'core', error: undefined });
    go('INSTALLING', 1);
    try {
      await invoke('start_install', {
        options: {
          destDir,
          language: selectedLangCode,
          cleanInstall,
          optionalComponents: Object.keys(selectedOpt).filter((k) => selectedOpt[k]),
          desktopShortcut,
          startMenuShortcut,
          launchStartup,
          registerProtocol,
        },
      });
    } catch {
      // Browser/Vite-only preview simulation when not inside compiled Tauri exe
      const stages = ['core', 'engine', 'media', 'network', 'shortcuts'];
      for (let i = 0; i < stages.length; i++) {
        if (cancelFallbackRef.current) return;
        await new Promise((r) => setTimeout(r, 320));
        setProgress((prev) => ({
          ...prev,
          percent: Math.round(((i + 1) / stages.length) * 100),
          stage: i < 4 ? d.stageExtract : d.stageShortcuts,
          filesDone: (i + 1) * 14,
          filesTotal: stages.length * 14,
          completedIds: stages.slice(0, i + 1),
          activeId: stages[Math.min(i + 1, stages.length - 1)],
        }));
      }
      if (!cancelFallbackRef.current) go('COMPLETE', 1);
    }
  };

  const cancelInstall = async () => {
    cancelFallbackRef.current = true;
    await invoke('cancel_install').catch(() => {});
    go('COMPONENTS', -1);
  };

  const openExternal = (url: string) => {
    invoke('open_external_url', { url }).catch(() => { window.open(url, '_blank'); });
  };

  const finishSetup = async () => {
    if (launchOnFinish) {
      await invoke('launch_installed_app', { path: destDir }).catch(() => {});
    }
    try { await getCurrentWindow().close(); } catch {}
  };

  const renderWizard = () => {
    const eyebrow = `${d.eyebrowBrand} · ${INSTALLER_CONFIG.version}`;
    if (step === 'WELCOME') {
      const w = WelcomeStep({ lang: uiLang, onOpenExternal: openExternal, onNext: () => go('LANGUAGE', 1) });
      return (
        <WizardShell eyebrow={eyebrow} title={d.welcomeTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={w.footerStart} footerEnd={w.footerEnd}>
          {w.body}
        </WizardShell>
      );
    }
    if (step === 'LANGUAGE') {
      const l = LanguageStep({
        lang: uiLang,
        selectedCode: selectedLangCode,
        onSelect: (code) => {
          setSelectedLangCode(code);
          const isRtl = INSTALLER_LANGUAGES.find((l) => l.code === code)?.rtl ?? false;
          document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
        },
        onBack: () => go('WELCOME', -1),
        onNext: () => go('TERMS', 1),
      });
      return (
        <WizardShell eyebrow={eyebrow} title={d.languageTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={l.footerStart} footerEnd={l.footerEnd}>
          {l.body}
        </WizardShell>
      );
    }
    if (step === 'TERMS') {
      const t = TermsStep({
        lang: uiLang,
        accepted: termsAccepted,
        onToggle: setTermsAccepted,
        onBack: () => go('LANGUAGE', -1),
        onNext: () => go('COMPONENTS', 1),
      });
      return (
        <WizardShell eyebrow={eyebrow} title={d.termsTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={t.footerStart} footerEnd={t.footerEnd}>
          {t.body}
        </WizardShell>
      );
    }
    if (step === 'COMPONENTS') {
      const c = ComponentsStep({
        lang: uiLang,
        isRepairMode,
        cleanInstall,
        setCleanInstall,
        destDir,
        onChangeDir: setDestDir,
        freeMb,
        onPickDir: pickDir,
        selectedOpt,
        toggleOpt: (id) => setSelectedOpt((prev) => ({ ...prev, [id]: !prev[id] })),
        desktopShortcut,
        setDesktopShortcut,
        startMenuShortcut,
        setStartMenuShortcut,
        launchStartup,
        setLaunchStartup,
        registerProtocol,
        setRegisterProtocol,
        onBack: () => go('TERMS', -1),
        onInstall: startInstall,
      });
      return (
        <WizardShell eyebrow={eyebrow} title={d.componentsTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={c.footerStart} footerEnd={c.footerEnd}>
          {c.body}
        </WizardShell>
      );
    }
    if (step === 'INSTALLING') {
      const inst = InstallingStep({ lang: uiLang, progress, onCancel: cancelInstall });
      return (
        <WizardShell eyebrow={eyebrow} title={d.installingTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={inst.footerStart} footerEnd={inst.footerEnd}>
          {inst.body}
        </WizardShell>
      );
    }
    const comp = CompleteStep({
      lang: uiLang,
      selectedLangCode,
      destDir,
      launchOnFinish,
      setLaunchOnFinish,
      onOpenFolder: () => invoke('open_external_url', { url: destDir }).catch(() => {}),
      onFinish: finishSetup,
    });
    return (
      <WizardShell eyebrow={eyebrow} title={d.completeTitle} dir={dir} stepKey={step} stepDir={stepDir} footerStart={comp.footerStart} footerEnd={comp.footerEnd}>
        {comp.body}
      </WizardShell>
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {step !== 'SPLASH' ? renderWizard() : null}
      <AnimatePresence>
        {step === 'SPLASH' ? (
          <SplashMajlisReveal key="splash" onComplete={onSplashComplete} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
