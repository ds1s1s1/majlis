import { useState } from 'react';
import { Check, Copy, FolderOpen } from 'lucide-react';
import { MajlisLogo } from '../components/icons/MajlisLogo';
import { INSTALLER_CONFIG } from '../config/installerConfig';
import { INSTALLER_DICT, INSTALLER_LANGUAGES } from '../config/i18n';

function InstallPathPill({ destDir, onOpenFolder }: { destDir: string; onOpenFolder: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyPath = () => {
    navigator.clipboard?.writeText(destDir).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div dir="ltr" className="mt-3 mb-5 flex items-center gap-2 rounded-xl border border-[#26231F] bg-[#181613] px-3.5 py-2 font-mono-tech text-xs text-[#B8B2A7]">
      <span className="max-w-[360px] truncate">{destDir}</span>
      <button type="button" onClick={copyPath} title="Copy path" className="rounded p-1 hover:bg-white/10 hover:text-[#E5A93C]">
        {copied ? <Check size={13} className="text-[#6BA876]" /> : <Copy size={13} />}
      </button>
      <button type="button" onClick={onOpenFolder} title="Open folder" className="rounded p-1 hover:bg-white/10 hover:text-[#E5A93C]">
        <FolderOpen size={13} />
      </button>
    </div>
  );
}

export function CompleteStep({
  lang,
  selectedLangCode,
  destDir,
  launchOnFinish,
  setLaunchOnFinish,
  onOpenFolder,
  onFinish,
}: {
  lang: 'ar' | 'en';
  selectedLangCode: string;
  destDir: string;
  launchOnFinish: boolean;
  setLaunchOnFinish: (v: boolean) => void;
  onOpenFolder: () => void;
  onFinish: () => void;
}) {
  const d = INSTALLER_DICT[lang];
  const ar = lang === 'ar';
  const langLabel = INSTALLER_LANGUAGES.find((l) => l.code === selectedLangCode)?.native || selectedLangCode;

  return {
    footerStart: (
      <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-[#C4BEB4]">
        <button
          type="button"
          role="checkbox"
          aria-checked={launchOnFinish}
          onClick={() => setLaunchOnFinish(!launchOnFinish)}
          className={`grid size-[18px] shrink-0 place-items-center rounded-[4px] border transition ${
            launchOnFinish ? 'border-[#E5A93C] bg-[#E5A93C] text-[#12100E]' : 'border-[#3A342C] bg-[#24211D]'
          }`}
        >
          {launchOnFinish ? <Check size={12} strokeWidth={3} /> : null}
        </button>
        <span>{d.launchAfterClose}</span>
      </label>
    ),
    footerEnd: (
      <button
        type="button"
        onClick={onFinish}
        className="h-[44px] min-w-[168px] rounded-[10px] bg-[#E5A93C] px-[26px] text-[14px] font-bold text-[#12100E] transition hover:bg-[#F0B952] hover:shadow-[0_0_20px_rgba(229,169,60,0.22)] active:scale-[0.98]"
      >
        {launchOnFinish ? d.launchCta : d.finishCta}
      </button>
    ),
    body: (
      <div className="mx-auto flex h-full max-w-[540px] flex-col items-center justify-center text-center">
        <div className="relative mb-4 flex items-center justify-center">
          <div className="pointer-events-none absolute size-28 rounded-full" style={{ background: 'radial-gradient(circle, rgba(229,169,60,0.2) 0%, transparent 70%)' }} />
          <MajlisLogo size={64} withContainer />
          <span className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full border-2 border-[#12100E] bg-[#6BA876] text-[#12100E]">
            <Check size={13} strokeWidth={3} />
          </span>
        </div>

        <h2 className="text-[22px] font-semibold text-[#F2EFE9]">
          {ar ? `مجلس ${INSTALLER_CONFIG.version} جاهز للانطلاق` : `Majlis ${INSTALLER_CONFIG.version} is ready`}
        </h2>

        {/* Install Path Pill */}
        <InstallPathPill destDir={destDir} onOpenFolder={onOpenFolder} />

        <ul className="space-y-2 text-start text-[13px] text-[#C4BEB4]">
          <li className="flex items-center gap-2.5">
            <span className="text-[#E5A93C] text-[11px]">{ar ? '◂' : '▸'}</span>
            <span>{d.completeBullets[0]}</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="text-[#E5A93C] text-[11px]">{ar ? '◂' : '▸'}</span>
            <span>{d.completeBullets[1]}<strong className="text-[#F2EFE9]">{langLabel}</strong></span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="text-[#E5A93C] text-[11px]">{ar ? '◂' : '▸'}</span>
            <span>{d.completeBullets[2]}</span>
          </li>
        </ul>
      </div>
    ),
  };
}
