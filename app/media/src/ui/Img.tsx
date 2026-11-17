import { useState } from 'react';

// an image that tries each source in turn, fades in when it's there, and shows `fallback` when none load
export function Img({ srcs, alt = '', className = '', fallback = null, eager = false }: { srcs: (string | null | undefined)[]; alt?: string; className?: string; fallback?: React.ReactNode; eager?: boolean }) {
  const list = srcs.filter(Boolean) as string[];
  const [i, setI] = useState(0);
  const [ok, setOk] = useState(false);
  if (i >= list.length) return <>{fallback}</>;
  return (
    <img key={list[i]} src={list[i]} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false}
      onLoad={() => setOk(true)} onError={() => { setOk(false); setI(i + 1); }}
      className={`${className} transition-opacity duration-300 ${ok ? 'opacity-100' : 'opacity-0'}`} />
  );
}
