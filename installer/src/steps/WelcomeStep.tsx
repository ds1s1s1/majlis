import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, GitBranch, Globe } from 'lucide-react';
import { INSTALLER_CONFIG } from '../config/installerConfig';
import { INSTALLER_DICT } from '../config/i18n';

function CyclingContinueButton({ onNext }: { onNext: () => void }) {
  const [ctaIdx, setCtaIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setCtaIdx((i) => (i + 1) % INSTALLER_CONFIG.multilingualContinue.length);
    }, 2200);
    return () => clearInterval(iv);
  }, []);

  return (
    <button
      type="button"
      onClick={onNext}
      className="relative h-[44px] min-w-[168px] overflow-hidden rounded-[10px] bg-[#E5A93C] px-[26px] text-[14px] font-bold text-[#12100E] transition hover:bg-[#F0B952] hover:shadow-[0_0_20px_rgba(229,169,60,0.22)] active:scale-[0.98]"
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={INSTALLER_CONFIG.multilingualContinue[ctaIdx]}
          initial={{ y: 7, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -7, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="block whitespace-nowrap"
        >
          {INSTALLER_CONFIG.multilingualContinue[ctaIdx]}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function WhatsNewPanel({ lang }: { lang: 'ar' | 'en' }) {
  const d = INSTALLER_DICT[lang];
  const ar = lang === 'ar';
  const [channel, setChannel] = useState<'beta' | 'stable'>('beta');
  const log = INSTALLER_CONFIG.changelog[channel];

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[#26231F] bg-[#181613] p-4">
      <div className="mb-3 flex items-center justify-between border-b border-[#26231F] pb-2">
        <span className={`text-[11.5px] font-semibold text-[#89662B] ${ar ? '' : 'uppercase tracking-[0.1em]'}`}>
          {d.whatsNew}
        </span>
        <div className="flex gap-4 text-xs">
          {(['beta', 'stable'] as const).map((ch) => {
            const active = channel === ch;
            return (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={`pb-1 transition ${
                  active ? 'border-b-2 border-[#E5A93C] font-semibold text-[#F2EFE9]' : 'text-[#7D776D] hover:text-[#B8B2A7]'
                }`}
              >
                {ch === 'beta' ? d.channelBeta : d.channelStable}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[290px] flex-1 overflow-y-auto pe-2 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#F2EFE9]">
            {ar ? `مجلس v${log.version} ${channel === 'beta' ? 'تجريبي' : 'مستقر'}` : `Majlis v${log.version} ${channel === 'beta' ? 'Beta' : 'Stable'}`}
          </span>
          <span dir="ltr" className="font-mono-tech text-xs text-[#89662B]">{log.version}</span>
        </div>

        {log.sections.map((sec) => (
          <div key={sec.titleEn} className="space-y-1.5">
            <div className="text-xs font-semibold text-[#E5A93C]">{ar ? sec.titleAr : sec.titleEn}</div>
            <ul className="space-y-1.5">
              {(ar ? sec.bulletsAr : sec.bulletsEn).map((b) => (
                <li key={b} className="flex items-start gap-2 text-xs leading-relaxed text-[#C4BEB4]">
                  <span className="mt-1 text-[9px] text-[#E5A93C]">{ar ? '◂' : '▸'}</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WelcomeStep({
  lang,
  onOpenExternal,
  onNext,
}: {
  lang: 'ar' | 'en';
  onOpenExternal: (url: string) => void;
  onNext: () => void;
}) {
  const d = INSTALLER_DICT[lang];
  const ar = lang === 'ar';

  const linksMeta = [
    { key: 'source', label: d.links.source, url: INSTALLER_CONFIG.links[0].url, icon: <GitBranch size={14} /> },
    { key: 'bugs', label: d.links.bugs, url: INSTALLER_CONFIG.links[1].url, icon: <Bug size={14} /> },
    { key: 'releases', label: d.links.releases, url: INSTALLER_CONFIG.links[2].url, icon: <Globe size={14} /> },
  ];

  return {
    footerStart: (
      <div className="flex items-center gap-2 text-[#7D776D]">
        <span className="size-2 rounded-full bg-[#6BA876]" />
        <span>{d.mitFooter}</span>
      </div>
    ),
    footerEnd: <CyclingContinueButton onNext={onNext} />,
    body: (
      <div className="grid h-full grid-cols-[1fr_1.08fr] gap-[42px]">
        {/* Column 1 — Intro, Steps & Links */}
        <div className="flex flex-col justify-between">
          <div>
            <p className="text-[13.5px] leading-[1.7] text-[#C4BEB4]">{d.welcomeIntro}</p>

            <div className={`mt-5 mb-2.5 text-[11.5px] font-semibold text-[#89662B] ${ar ? '' : 'uppercase tracking-[0.1em]'}`}>
              {d.whatHappensNext}
            </div>
            <ul className="space-y-2.5">
              {d.nextSteps.map((step) => (
                <li key={step} className="flex items-center gap-2.5 text-[13px] text-[#C4BEB4]">
                  <span className="text-[#E5A93C] text-[11px]">{ar ? '◂' : '▸'}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#26231F] pt-3">
            {linksMeta.map((lk) => (
              <button
                key={lk.key}
                type="button"
                onClick={() => onOpenExternal(lk.url)}
                className="flex items-center gap-2 text-start text-xs text-[#7D776D] transition hover:text-[#F0B952]"
              >
                <span>{lk.icon}</span>
                <span className="text-[#E5A93C] hover:underline">{lk.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Column 2 — What's New */}
        <WhatsNewPanel lang={lang} />
      </div>
    ),
  };
}
