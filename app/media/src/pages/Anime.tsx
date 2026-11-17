import { Billboard } from '../ui/Billboard';
import { Row } from '../ui/Row';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { CatalogRow, useWatched } from '../ui/CatalogRow';
import { useAnimeTrending, useRows } from '../api';
import { useT } from '../host';

// Anime: AniList's trending (keyless) up top, then every anime catalog the addons have
export function Anime() {
  const t = useT();
  const a = useAnimeTrending(1), b = useAnimeTrending(2), rows = useRows(), watched = useWatched();
  const list = [...(a.data || []), ...(b.data || [])];
  const mine = (rows.data || []).filter((r) => r.type === 'anime' || /kitsu|anime/i.test(r.addon + r.id));
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      <Billboard items={list.filter((x) => x.background).slice(0, 6)} />
      <div className="relative z-10 -mt-20">
        <Row title={t('trending_now')} sub="AniList" items={list} width={168} height={262} loading={a.isLoading} skeleton={<PosterSkeleton />} render={(it) => <Poster item={it} />} />
        {mine.map((r) => <CatalogRow key={`${r.addon}|${r.type}|${r.id}`} row={r} title={r.name} watched={watched} />)}
      </div>
    </div>
  );
}
