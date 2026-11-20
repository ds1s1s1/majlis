import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { INSTALLER_DICT } from '../config/i18n';

export interface InstallProgressState {
  percent: number;
  stage: string;
  filesDone: number;
  filesTotal: number;
  speedMb: number;
  etaSec: number;
  completedIds: string[];
  activeId: string;
  error?: string;
}

export const INSTALL_STAGES = ['core', 'engine', 'media', 'network', 'shortcuts'] as const;

export function InstallingStep({
  lang,
  progress,
  onCancel,
}: {
  lang: 'ar' | 'en';
  progress: InstallProgressState;
  onCancel: () => void;
}) {
  const d = INSTALLER_DICT[lang];
  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const hasError = !!progress.error;

  return {
    footerStart: (
      <div className="flex items-center gap-3 text-[#7D776D]">
        <span>{hasError ? (lang === 'ar' ? 'تعذّر إكمال التثبيت' : 'Installation failed') : d.installingFooterWait}</span>
        {!hasError ? (
          <button type="button" onClick={onCancel} className="text-[#C4BEB4] underline hover:text-red-300">
            {d.cancelInstall}
          </button>
        ) : null}
      </div>
    ),
    footerEnd: hasError ? (
      <button
        type="button"
        onClick={onCancel}
        className="h-[44px] min-w-[156px] rounded-[10px] border border-[#2E2A24] bg-[#1F1C18] px-[26px] text-[14px] font-bold text-[#F2EFE9] transition hover:border-[#E5A93C]"
      >
        {d.back}
      </button>
    ) : (
      <button
        type="button"
        disabled
        className="h-[44px] min-w-[156px] cursor-not-allowed rounded-[10px] bg-[#24211D] px-[26px] text-[14px] font-bold text-[#5E5850]"
      >
        {d.installingBtn}
      </button>
    ),
    body: (
      <div className="mx-auto flex h-full max-w-[660px] flex-col justify-center space-y-5">
        {hasError ? (
          <div className="rounded-[12px] border border-red-400/35 bg-red-950/35 px-4 py-3 text-xs leading-relaxed text-red-200">
            <div className="font-semibold text-red-100">
              {lang === 'ar' ? 'حدث خطأ أثناء استخراج أو كتابة ملفات التثبيت:' : 'An error occurred during installation:'}
            </div>
            <div dir="ltr" className="mt-1 font-mono-tech text-[11px] text-red-300/90 break-all">
              {progress.error}
            </div>
          </div>
        ) : null}

        {/* Progress Header */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-4">
            <span className="truncate text-sm font-medium text-[#F2EFE9]">{progress.stage || d.stageExtract}</span>
            <span dir="ltr" className="font-mono-tech text-base font-bold text-[#E5A93C]">{pct}%</span>
          </div>

          <div className="h-[7px] w-full overflow-hidden rounded-full bg-[#24211D]">
            <motion.div
              className={`h-full rounded-full ${hasError ? 'bg-red-400' : 'bg-[#E5A93C]'}`}
              initial={{ width: '0%' }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.25 }}
              style={{ boxShadow: hasError ? '0 0 14px rgba(248,113,113,0.35)' : '0 0 14px rgba(229,169,60,0.35)' }}
            />
          </div>

          <div dir="ltr" className="flex justify-between font-mono-tech text-[11px] text-[#7D776D]">
            <span>{progress.filesTotal > 0 ? `${progress.filesDone} / ${progress.filesTotal} files` : 'Preparing payload...'}</span>
            <span>
              {progress.speedMb > 0 ? `${progress.speedMb.toFixed(1)} MB/s` : ''}
              {progress.etaSec > 0 ? ` · ~${progress.etaSec}s` : ''}
            </span>
          </div>
        </div>

        {/* Component Telemetry Checklist Card */}
        <div className="rounded-[12px] border border-[#26231F] bg-[#181613] px-[22px] py-[18px] space-y-3">
          {INSTALL_STAGES.map((id) => {
            const done = progress.completedIds.includes(id);
            const active = !done && progress.activeId === id;
            const [name] = d.coreCompLabels[id] || [id];
            return (
              <div key={id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  {done ? (
                    <span className="grid size-4 place-items-center rounded-full bg-[#6BA876]/20 text-[#6BA876]">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  ) : active ? (
                    <motion.span
                      animate={{ rotate: [0, 180, 360], scale: [1, 1.15, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                      className="inline-block text-sm leading-none text-[#E5A93C]"
                    >
                      ◆
                    </motion.span>
                  ) : (
                    <span className="text-sm leading-none text-[#544F47]">◇</span>
                  )}
                  <span className={done ? 'text-[#F2EFE9] font-medium' : active ? 'text-[#E5A93C] font-semibold' : 'text-[#544F47]'}>
                    {name}
                  </span>
                </div>
                <span className="font-mono-tech text-[10.5px] text-[#7D776D]">
                  {done ? 'OK' : active ? '...' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ),
  };
}
