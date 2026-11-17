import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icon';
import { useHost } from '../host';

// A titled horizontal row. Only the cards on screen (plus a few) exist in the DOM.
export function Row<T>({ title, sub, items, width, gap = 14, height, render, loading, skeleton, action }: {
  title: ReactNode; sub?: ReactNode; items: T[]; width: number; gap?: number; height: number;
  render: (x: T, i: number) => ReactNode; loading?: boolean; skeleton?: ReactNode; action?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rtl = useHost().lang === 'ar';
  const v = useVirtualizer({ horizontal: true, count: items.length, getScrollElement: () => ref.current, estimateSize: () => width + gap, overscan: 4, isRtl: rtl, paddingStart: 48, paddingEnd: 48 });
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * (rtl ? -1 : 1) * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="group/row relative mt-9 fade-in">
      <div className="mb-3 flex items-baseline gap-3 px-12">
        <h2 className="text-[19px] font-semibold text-fg">{title}</h2>
        {sub ? <span className="text-xs text-fg3">{sub}</span> : null}
        <span className="flex-1" />
        {action}
      </div>
      {loading ? (
        <div className="flex gap-[14px] overflow-hidden px-12">{Array.from({ length: 9 }, (_, i) => <div key={i}>{skeleton}</div>)}</div>
      ) : (
        <div className="relative">
          <div ref={ref} className="hscroll" style={{ height }}>
            <div className="relative h-full" style={{ width: v.getTotalSize() }}>
              {v.getVirtualItems().map((c) => (
                <div key={c.key} className="absolute top-0" style={{ [rtl ? 'right' : 'left']: c.start, width }}>{render(items[c.index], c.index)}</div>
              ))}
            </div>
          </div>
          {items.length * (width + gap) > 900 ? (<>
            <button aria-label="previous" onClick={() => page(-1)} className="absolute inset-y-0 start-0 z-10 grid w-12 place-items-center bg-gradient-to-r from-bg/90 to-transparent text-fg opacity-0 transition group-hover/row:opacity-100 rtl:bg-gradient-to-l"><Icon n="chevl" s={28} className="flip" /></button>
            <button aria-label="next" onClick={() => page(1)} className="absolute inset-y-0 end-0 z-10 grid w-12 place-items-center bg-gradient-to-l from-bg/90 to-transparent text-fg opacity-0 transition group-hover/row:opacity-100 rtl:bg-gradient-to-r"><Icon n="chevr" s={28} className="flip" /></button>
          </>) : null}
        </div>
      )}
    </section>
  );
}
