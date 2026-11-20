import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { MajlisLogo } from './icons/MajlisLogo';
import { SaduDivider } from './SaduDivider';

export function WizardShell({
  eyebrow,
  title,
  dir,
  stepKey,
  stepDir,
  footerStart,
  footerEnd,
  children,
}: {
  eyebrow: string;
  title: string;
  dir: 'rtl' | 'ltr';
  stepKey: string;
  stepDir: 1 | -1;
  footerStart: ReactNode;
  footerEnd: ReactNode;
  children: ReactNode;
}) {
  const rtl = dir === 'rtl';
  const offset = (rtl ? -16 : 16) * stepDir;

  return (
    <motion.div
      dir={dir}
      initial={{ opacity: 0, scale: 0.988 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 flex-1 flex-col px-[36px] py-[26px]"
    >
      {/* Top Header */}
      <div className="flex items-center gap-4 pb-[18px]">
        <MajlisLogo size={46} withContainer />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[#C4BEB4]">{eyebrow}</div>
          <h1 className="text-[30px] font-semibold leading-[1.25] text-[#F2EFE9]">{title}</h1>
        </div>
      </div>

      {/* Signature Sadu Geometric Divider */}
      <SaduDivider animateIn />

      {/* Viewport */}
      <div className="min-h-0 flex-1 overflow-hidden py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepKey}
            initial={{ opacity: 0, x: offset }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -offset }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Persistent Footer Bar */}
      <footer className="flex h-[56px] shrink-0 items-center justify-between gap-4 border-t border-[#26231F]/70 pt-2">
        <div className="min-w-0 text-xs">{footerStart}</div>
        <div className="flex items-center gap-2.5">{footerEnd}</div>
      </footer>
    </motion.div>
  );
}
