import { useQuery } from '@tanstack/react-query';
import { cin, type Item } from '../api';
import { Img } from '../ui/Img';
import { Poster } from '../ui/Poster';

// A film series (TMDB collection) in release order
export function Collection({ id, name }: { id: number; name: string }) {
  const q = useQuery({ queryKey: ['collection', id], queryFn: () => cin<{ name: string; background: string | null; parts: Item[] }>('collection', { id }), staleTime: 86400000 });
  return (
    <div className="h-full overflow-y-auto pb-20">
      <section className="relative h-[46vh] min-h-[320px]">
        <Img eager srcs={[q.data?.background]} className="absolute inset-0 h-full w-full object-cover" />
        <div className="shade-b absolute inset-0" />
        <h1 className="absolute bottom-8 start-12 text-4xl font-bold">{q.data?.name || name}</h1>
      </section>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-4 gap-y-6 px-12">
        {(q.data?.parts || []).map((p) => <Poster key={p.id} item={p} w={170} />)}
      </div>
    </div>
  );
}
