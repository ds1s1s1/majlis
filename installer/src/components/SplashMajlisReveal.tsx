import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { MajlisLogo } from './icons/MajlisLogo';
import { SaduDivider } from './SaduDivider';

export function SplashMajlisReveal({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const t = setTimeout(onComplete, 3400);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03, transition: { duration: 0.48, ease: [0.16, 1, 0.3, 1] } }}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#12100E]"
    >
      {/* Horizon Pulse (خيط السدو) 0.00s -> 0.55s */}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: [0, 1, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 0.55, times: [0, 0.48, 1], ease: 'easeInOut' }}
        className="pointer-events-none absolute h-[1.5px] w-[260px]"
        style={{ background: 'linear-gradient(90deg, transparent, #E5A93C, transparent)' }}
      />

      {/* Warm Lantern Ambient Glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: [0, 1, 0.88, 1], scale: [0.85, 1, 1.04, 1] }}
        transition={{ duration: 2.2, delay: 0.95, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute size-[280px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(229,169,60,0.18) 0%, transparent 70%)' }}
      />

      {/* 128px 4-Diamond Gather */}
      <div className="relative z-10">
        <MajlisLogo size={128} withContainer animated />
      </div>

      {/* Wordmark Reveal + Micro Sadu */}
      <motion.div
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, delay: 1.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mt-[18px] text-center"
      >
        <div className="text-[36px] font-bold leading-none text-[#F2EFE9]">مجلس</div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.94 }}
        transition={{ duration: 0.55, delay: 1.6 }}
        className="relative z-10 mt-2.5 flex flex-col items-center gap-2.5"
      >
        <div dir="ltr" className="text-[10.5px] font-semibold tracking-[0.34em] text-[#89662B]">
          M A J L I S
        </div>
        <SaduDivider widthClass="w-[110px]" animateIn delay={1.65} shimmer />
      </motion.div>
    </motion.div>
  );
}
