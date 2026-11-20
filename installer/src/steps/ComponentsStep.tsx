import { Check, FolderOpen } from 'lucide-react';
import { INSTALLER_CONFIG } from '../config/installerConfig';
import { INSTALLER_DICT } from '../config/i18n';

export function ComponentsStep({
  lang,
  isRepairMode,
  cleanInstall,
  setCleanInstall,
  destDir,
  onChangeDir,
  freeMb,
  onPickDir,
  selectedOpt,
  toggleOpt,
  desktopShortcut,
  setDesktopShortcut,
  startMenuShortcut,
  setStartMenuShortcut,
  launchStartup,
  setLaunchStartup,
  registerProtocol,
  setRegisterProtocol,
  onBack,
  onInstall,
}: {
  lang: 'ar' | 'en';
  isRepairMode: boolean;
  cleanInstall: boolean;
  setCleanInstall: (v: boolean) => void;
  destDir: string;
  onChangeDir: (v: string) => void;
  freeMb: number | null;
  onPickDir: () => void;
  selectedOpt: Record<string, boolean>;
  toggleOpt: (id: string) => void;
  desktopShortcut: boolean;
  setDesktopShortcut: (v: boolean) => void;
  startMenuShortcut: boolean;
  setStartMenuShortcut: (v: boolean) => void;
  launchStartup: boolean;
  setLaunchStartup: (v: boolean) => void;
  registerProtocol: boolean;
  setRegisterProtocol: (v: boolean) => void;
  onBack: () => void;
  onInstall: () => void;
}) {
  const d = INSTALLER_DICT[lang];
  const ar = lang === 'ar';

  const coreTotal = INSTALLER_CONFIG.coreComponents.reduce((a, c) => a + c.sizeMb, 0);
  const optTotal = INSTALLER_CONFIG.optionalComponents.reduce((a, c) => a + (selectedOpt[c.id] ? c.sizeMb : 0), 0);
  const totalMb = coreTotal + optTotal;

  const toggleBox = (on: boolean) => (
    <span
      className={`grid size-[18px] shrink-0 place-items-center rounded-[4px] border transition ${
        on ? 'border-[#E5A93C] bg-[#E5A93C] text-[#12100E]' : 'border-[#3A342C] bg-[#24211D]'
      }`}
    >
      {on ? <Check size={12} strokeWidth={3} /> : null}
    </span>
  );

  return {
    footerStart: (
      <div className="text-[#C4BEB4]">
        {isRepairMode && !cleanInstall
          ? ar
            ? `يصلح الإصدار ${INSTALLER_CONFIG.version} · استبدال الملفات التالفة فقط مع حفظ بياناتك`
            : `Repairs v${INSTALLER_CONFIG.version} · restores missing files while preserving user data`
          : ar
            ? `يثبّت الإصدار ${INSTALLER_CONFIG.version} · يتطلب ${totalMb} MB · تثبيت لحسابك فقط`
            : `Installs v${INSTALLER_CONFIG.version} · requires ${totalMb} MB · per-user setup`}
      </div>
    ),
    footerEnd: (
      <>
        <button
          type="button"
          onClick={onBack}
          className="h-[44px] min-w-[96px] rounded-[10px] border border-[#2E2A24] px-[22px] text-[13px] font-medium text-[#D6D0C6] transition hover:border-[#453E35] hover:bg-[#1D1A16]"
        >
          {d.back}
        </button>
        <button
          type="button"
          onClick={onInstall}
          className="h-[44px] min-w-[156px] rounded-[10px] bg-[#E5A93C] px-[26px] text-[14px] font-bold text-[#12100E] transition hover:bg-[#F0B952] hover:shadow-[0_0_20px_rgba(229,169,60,0.22)] active:scale-[0.98]"
        >
          {isRepairMode && !cleanInstall ? d.repairCta : d.installCta}
        </button>
      </>
    ),
    body: (
      <div className="max-h-[355px] overflow-y-auto pe-2 space-y-4">
        {/* Clean install when existing installation found */}
        {isRepairMode ? (
          <button
            type="button"
            onClick={() => setCleanInstall(!cleanInstall)}
            className={`flex w-full items-start gap-3 rounded-[10px] border px-[18px] py-[14px] text-start transition ${
              cleanInstall ? 'border-[#E5A93C] bg-[#241D11]' : 'border-[#26231F] bg-[#181613] hover:border-[#38322A]'
            }`}
          >
            <div className="mt-0.5">{toggleBox(cleanInstall)}</div>
            <div>
              <div className="text-xs font-semibold text-[#F2EFE9]">{d.cleanInstallTitle}</div>
              <div className="mt-0.5 text-[11px] text-[#7D776D]">{d.cleanInstallDesc}</div>
            </div>
          </button>
        ) : null}

        {/* Destination & Free Space Card */}
        <div className="rounded-[10px] border border-[#26231F] bg-[#181613] px-[18px] py-3">
          <div className="mb-2 flex items-center justify-between text-[11.5px]">
            <span className="font-semibold text-[#89662B]">{d.destLabel}</span>
            {freeMb !== null ? (
              <span dir="ltr" className="font-mono-tech text-[#6BA876]">
                {d.diskFree}: {(freeMb / 1024).toFixed(1)} GB
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              dir="ltr"
              aria-label="Install directory"
              value={destDir}
              onChange={(e) => onChangeDir(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#26231F] bg-[#12100E] px-3 py-1.5 font-mono-tech text-xs text-[#C4BEB4] outline-none transition focus:border-[#695023] focus:text-[#F2EFE9]"
            />
            <button
              type="button"
              onClick={onPickDir}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2E2A24] bg-[#1F1C18] px-3 py-1.5 text-xs font-medium text-[#F2EFE9] hover:border-[#695023]"
            >
              <FolderOpen size={13} className="text-[#E5A93C]" />
              <span>{d.changeFolder}</span>
            </button>
          </div>
        </div>

        {/* Core Components 2-Col List Grid */}
        <div className="grid grid-cols-2 gap-x-6 rounded-[10px] border border-[#26231F] bg-[#181613] px-4 py-1">
          {INSTALLER_CONFIG.coreComponents.map((c) => {
            const [name, desc] = d.coreCompLabels[c.id] || [c.id, ''];
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 border-b border-[#211E1A] py-[10px] last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-[#F2EFE9]">{name}</div>
                  <div className="truncate text-[10.5px] text-[#7D776D]">{desc}</div>
                </div>
                {c.skipped ? (
                  <span className="shrink-0 rounded-full bg-[#6BA876]/15 px-2 py-0.5 text-[10px] font-semibold text-[#6BA876]">
                    {d.skippedBadge}
                  </span>
                ) : (
                  <span dir="ltr" className="font-mono-tech shrink-0 text-[11px] text-[#89662B]">
                    {c.sizeMb > 0 ? `${c.sizeMb} MB` : d.noExtraSpace}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Optional Components */}
        <div>
          <div className={`mb-2 text-[11.5px] font-semibold text-[#89662B] ${ar ? '' : 'uppercase tracking-[0.1em]'}`}>
            {d.optionalHeader}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {INSTALLER_CONFIG.optionalComponents.map((c) => {
              const on = !!selectedOpt[c.id];
              const [name, desc] = d.optCompLabels[c.id] || [c.id, ''];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleOpt(c.id)}
                  className={`flex items-start gap-2.5 rounded-[10px] border p-3 text-start transition ${
                    on ? 'border-[#695023] bg-[#241D11]' : 'border-[#26231F] bg-[#181613] hover:border-[#38322A]'
                  }`}
                >
                  <div className="mt-0.5">{toggleBox(on)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[#F2EFE9]">{name}</span>
                      <span dir="ltr" className="font-mono-tech shrink-0 text-[10.5px] text-[#89662B]">{c.sizeMb} MB</span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-[#7D776D]">{desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Windows Shortcuts & Integration Toggles */}
        <div className="grid grid-cols-2 gap-2 rounded-[10px] border border-[#26231F] bg-[#181613] px-4 py-3 text-xs">
          {[
            { label: d.shortcutDesktop, on: desktopShortcut, set: setDesktopShortcut },
            { label: d.shortcutStart, on: startMenuShortcut, set: setStartMenuShortcut },
            { label: d.launchOnStartup, on: launchStartup, set: setLaunchStartup },
            { label: d.registerProtocol, on: registerProtocol, set: setRegisterProtocol },
          ].map((opt) => (
            <button key={opt.label} type="button" onClick={() => opt.set(!opt.on)} className="flex items-center gap-2.5 text-start text-[#C4BEB4] hover:text-[#F2EFE9]">
              {toggleBox(opt.on)}
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    ),
  };
}
