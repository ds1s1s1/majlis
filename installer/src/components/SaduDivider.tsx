import { useId } from 'react';
import { motion } from 'framer-motion';

export function SaduDivider({
  widthClass = 'w-full',
  animateIn = false,
  delay = 0,
  shimmer = false,
}: {
  widthClass?: string;
  animateIn?: boolean;
  delay?: number;
  shimmer?: boolean;
}) {
  const pid = useId();
  return (
    <motion.div
      initial={animateIn ? { scaleX: 0, opacity: 0 } : undefined}
      animate={animateIn ? { scaleX: 1, opacity: 1 } : undefined}
      transition={animateIn ? { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] } : undefined}
      className={`relative ${widthClass} h-[10px] shrink-0 overflow-hidden`}
      style={{
        transformOrigin: 'center',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)',
        maskImage: 'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)',
      }}
    >
      <svg width="100%" height="10" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={pid} width="14" height="10" patternUnits="userSpaceOnUse">
            <polygon points="0,4 3.5,0 7,4" fill="#E5A93C" fillOpacity="0.72" />
            <polygon points="7,4 10.5,0 14,4" fill="#89662B" fillOpacity="0.48" />
            <polygon points="0,6 3.5,10 7,6" fill="#89662B" fillOpacity="0.48" />
            <polygon points="7,6 10.5,10 14,6" fill="#E5A93C" fillOpacity="0.72" />
          </pattern>
        </defs>
        <rect width="100%" height="10" fill={`url(#${pid})`} />
      </svg>
      {shimmer ? (
        <motion.div
          initial={{ x: '-110%', opacity: 0 }}
          animate={{ x: '210%', opacity: [0, 0.9, 0] }}
          transition={{ duration: 0.72, delay: delay + 0.4, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-y-0 w-1/2"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(240,185,82,0.75), transparent)' }}
        />
      ) : null}
    </motion.div>
  );
}
