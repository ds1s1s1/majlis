import { motion } from 'framer-motion';

export function MajlisLogo({
  size = 46,
  withContainer = false,
  animated = false,
}: {
  size?: number;
  withContainer?: boolean;
  animated?: boolean;
}) {
  const ease = [0.16, 1, 0.3, 1] as const;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="majlisGlint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id="majlisDiamondsClip">
          <polygon points="50,14 68,32 50,50 32,32" />
          <polygon points="50,50 68,68 50,86 32,68" />
          <polygon points="27,39 38,50 27,61 16,50" />
          <polygon points="73,39 84,50 73,61 62,50" />
        </clipPath>
      </defs>

      {withContainer ? (
        <motion.rect
          x="4"
          y="4"
          width="92"
          height="92"
          rx="22"
          fill="#13110E"
          stroke="#26221C"
          strokeWidth="1.5"
          initial={animated ? { opacity: 0, scale: 0.94 } : undefined}
          animate={animated ? { opacity: 1, scale: 1 } : undefined}
          transition={animated ? { duration: 0.52, delay: 0.92, ease } : undefined}
        />
      ) : null}

      {/* Top Large Diamond (#E5A93C) */}
      <motion.polygon
        points="50,14 68,32 50,50 32,32"
        fill="#E5A93C"
        initial={animated ? { y: 18, scale: 0.35, opacity: 0 } : undefined}
        animate={animated ? { y: 0, scale: 1, opacity: 1 } : undefined}
        transition={animated ? { duration: 0.62, delay: 0.35, ease } : undefined}
        style={{ transformOrigin: '50px 50px' }}
      />

      {/* Bottom Large Diamond (#89662B) */}
      <motion.polygon
        points="50,50 68,68 50,86 32,68"
        fill="#89662B"
        initial={animated ? { y: -18, scale: 0.35, opacity: 0 } : undefined}
        animate={animated ? { y: 0, scale: 1, opacity: 1 } : undefined}
        transition={animated ? { duration: 0.62, delay: 0.42, ease } : undefined}
        style={{ transformOrigin: '50px 50px' }}
      />

      {/* Left Small Diamond (#BD8B33) */}
      <motion.polygon
        points="27,39 38,50 27,61 16,50"
        fill="#BD8B33"
        initial={animated ? { x: 23, scale: 0.2, opacity: 0 } : undefined}
        animate={animated ? { x: 0, scale: 1, opacity: 1 } : undefined}
        transition={animated ? { duration: 0.56, delay: 0.56, ease } : undefined}
        style={{ transformOrigin: '50px 50px' }}
      />

      {/* Right Small Diamond (#BD8B33) */}
      <motion.polygon
        points="73,39 84,50 73,61 62,50"
        fill="#BD8B33"
        initial={animated ? { x: -23, scale: 0.2, opacity: 0 } : undefined}
        animate={animated ? { x: 0, scale: 1, opacity: 1 } : undefined}
        transition={animated ? { duration: 0.56, delay: 0.56, ease } : undefined}
        style={{ transformOrigin: '50px 50px' }}
      />

      {/* Specular diagonal metallic sweep */}
      {animated ? (
        <g clipPath="url(#majlisDiamondsClip)">
          <motion.rect
            x="-60"
            y="-60"
            width="60"
            height="220"
            fill="url(#majlisGlint)"
            transform="rotate(28 50 50)"
            initial={{ x: -75, opacity: 0 }}
            animate={{ x: 145, opacity: [0, 1, 0] }}
            transition={{ duration: 0.62, delay: 1.15, ease: 'easeInOut' }}
          />
        </g>
      ) : null}
    </svg>
  );
}
