import { Row } from './Row';
import { Img } from './Img';
import { Icon } from './Icon';
import { useContinue, metahub, episodeOf, type LibItem } from '../api';
import { useNav, useT } from '../host';

// Continue watching: wide 16:9 cards with the title's logo, the episode and how much is left
export function ContinueRow() {
  const { data } = useContinue();
  const t = useT();
  if (!data?.length) return null;
  return <Row title={t('continue_watching')} items={data} width={330} height={212} render={(it) => <Card it={it} />} />;
}

function Card({ it }: { it: LibItem }) {
  const nav = useNav(), t = useT();
  const s = it.state, ep = episodeOf(s.video_id);
  const pct = s.duration ? Math.min(100, (s.timeOffset / s.duration) * 100) : 0;
  const left = s.duration ? Math.max(1, Math.round((s.duration - s.timeOffset) / 60000)) : null;
  const resume = () => nav.open({ kind: 'title', type: it.type, id: it._id, autoplay: s.video_id || it._id, pos: s.timeOffset > 1 ? s.timeOffset : undefined });
  return (
    <div className="group relative w-[330px]">
      <button onClick={resume} className="relative block aspect-video w-full overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition duration-300 ease-out-soft group-hover:ring-2 group-hover:ring-acc/70">
        <Img srcs={[metahub('background', it._id), it.poster]} className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        <div className="shade-b absolute inset-0" />
        <Img srcs={[metahub('logo', it._id)]} className="absolute bottom-7 start-4 max-h-14 max-w-[55%] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,.8)]"
          fallback={<div className="absolute bottom-7 start-4 max-w-[70%] truncate text-lg font-bold">{it.name}</div>} />
        <div className="absolute inset-x-4 bottom-3 flex items-center gap-2 text-[11px] text-fg2">
          {ep ? <span className="font-mono font-semibold text-fg">S{ep.season} E{ep.episode}</span> : null}
          {left ? <span>{t('left', { n: left })}</span> : null}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15"><div className="h-full bg-acc" style={{ width: `${pct}%` }} /></div>
        <span className="absolute inset-0 m-auto grid size-14 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition group-hover:opacity-100"><Icon n="play" s={26} /></span>
      </button>
      <button onClick={() => nav.open({ kind: 'title', type: it.type, id: it._id })} className="mt-2 block w-full truncate text-start text-[13px] text-fg2 hover:text-fg">{it.name}</button>
    </div>
  );
}
