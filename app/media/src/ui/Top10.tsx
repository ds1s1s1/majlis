import { Row } from './Row';
import { Img } from './Img';
import type { Preview } from '../api';
import { useNav } from '../host';

// Top 10: the big outlined rank behind each poster
export function Top10({ title, items }: { title: string; items: Preview[] }) {
  const nav = useNav();
  if (items.length < 5) return null;
  return (
    <Row title={title} items={items.slice(0, 10)} width={250} gap={10} height={225} render={(it, i) => (
      <button onClick={() => nav.open({ kind: 'title', type: it.type, id: it.id })} title={it.name} className="group flex h-[225px] w-[250px] items-end">
        <span className="rank-num -me-5 translate-y-3 select-none transition group-hover:[-webkit-text-stroke-color:var(--c-acc)]">{i + 1}</span>
        <div className="relative z-10 h-[215px] w-[144px] flex-none overflow-hidden rounded-lg bg-bg2 ring-1 ring-line transition duration-300 group-hover:-translate-y-1 group-hover:ring-2 group-hover:ring-acc/70">
          <Img srcs={[it.poster]} className="h-full w-full object-cover" fallback={<div className="p-3 text-sm text-fg2">{it.name}</div>} />
        </div>
      </button>
    )} />
  );
}
