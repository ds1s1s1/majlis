import { Check } from 'lucide-react';
import { FlagIcon } from '../components/icons/FlagIcons';
import { INSTALLER_DICT, INSTALLER_LANGUAGES } from '../config/i18n';

export function LanguageStep({
  lang,
  selectedCode,
  onSelect,
  onBack,
  onNext,
}: {
  lang: 'ar' | 'en';
  selectedCode: string;
  onSelect: (code: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const d = INSTALLER_DICT[lang];
  const selectedMeta = INSTALLER_LANGUAGES.find((l) => l.code === selectedCode) || INSTALLER_LANGUAGES[0];

  return {
    footerStart: (
      <div className="text-[#7D776D]">
        {d.willOpenIn}
        <strong className="text-[#F2EFE9]">{selectedMeta.native}.</strong>
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
          onClick={onNext}
          className="h-[44px] min-w-[156px] rounded-[10px] bg-[#E5A93C] px-[26px] text-[14px] font-bold text-[#12100E] transition hover:bg-[#F0B952] hover:shadow-[0_0_20px_rgba(229,169,60,0.22)] active:scale-[0.98]"
        >
          {d.continue}
        </button>
      </>
    ),
    body: (
      <div className="grid max-h-[350px] grid-cols-2 gap-[12px] overflow-y-auto pe-1">
        {INSTALLER_LANGUAGES.map((l) => {
          const sel = l.code === selectedCode;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => onSelect(l.code)}
              className={`flex h-[64px] items-center justify-between rounded-[10px] px-[18px] text-start transition ${
                sel
                  ? 'border border-[#E5A93C] bg-[#241D11]'
                  : 'border border-[#26231F] bg-[#181613] hover:border-[#38322A] hover:bg-[#1F1C18]'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <FlagIcon code={l.code} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-[#F2EFE9]">{l.native}</div>
                  <div className="truncate text-[11px] text-[#7D776D]">{l.english}</div>
                </div>
              </div>

              <span
                className={`grid size-[20px] shrink-0 place-items-center rounded-full transition ${
                  sel ? 'bg-[#E5A93C] text-[#12100E]' : 'border border-[#3A342C] bg-[#24211D]'
                }`}
              >
                {sel ? <Check size={12} strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    ),
  };
}
