import { Check } from 'lucide-react';
import { INSTALLER_DICT } from '../config/i18n';

export function TermsStep({
  lang,
  accepted,
  onToggle,
  onBack,
  onNext,
}: {
  lang: 'ar' | 'en';
  accepted: boolean;
  onToggle: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const d = INSTALLER_DICT[lang];

  return {
    footerStart: (
      <label className="flex cursor-pointer items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={accepted}
          onClick={() => onToggle(!accepted)}
          className={`grid size-[18px] shrink-0 place-items-center rounded-[4px] border transition ${
            accepted ? 'border-[#E5A93C] bg-[#E5A93C] text-[#12100E]' : 'border-[#3A342C] bg-[#24211D]'
          }`}
        >
          {accepted ? <Check size={12} strokeWidth={3} /> : null}
        </button>
        <div>
          <div className="text-xs font-semibold text-[#F2EFE9]">{d.agreeLabel}</div>
          <div className="text-[11px] text-[#7D776D]">{accepted ? d.agreeHintReady : d.agreeHintWait}</div>
        </div>
      </label>
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
          disabled={!accepted}
          onClick={onNext}
          className={`h-[44px] min-w-[156px] rounded-[10px] px-[26px] text-[14px] font-bold transition ${
            accepted
              ? 'bg-[#E5A93C] text-[#12100E] hover:bg-[#F0B952] hover:shadow-[0_0_20px_rgba(229,169,60,0.22)] active:scale-[0.98]'
              : 'cursor-not-allowed bg-[#24211D] text-[#5E5850]'
          }`}
        >
          {d.continue}
        </button>
      </>
    ),
    body: (
      <div className="h-[350px] overflow-y-auto rounded-[12px] border border-[#26231F] bg-[#181613] px-[28px] py-[24px] space-y-5">
        {d.termsItems.map((item) => (
          <div key={item.title} className="space-y-1">
            <h3 className="text-[13.5px] font-semibold text-[#E5A93C]">{item.title}</h3>
            <p className="text-[13px] leading-[1.7] text-[#C4BEB4]">{item.body}</p>
          </div>
        ))}
      </div>
    ),
  };
}
