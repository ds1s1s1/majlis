import { useEffect, useRef, useState } from 'react';

// true once the element comes near the viewport (rows load their catalog only then), and stays true
export function useInView<T extends Element>(margin = '600px') {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}
