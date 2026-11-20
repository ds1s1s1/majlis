import { useMemo, useState } from 'react';
import { Bell, BellRing, Info } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, usePerson, useTrackedPeople, type PersonCredit } from '../api';
import { useT } from '../host';
import { Img } from '../ui/Img';
import { Poster } from '../ui/Poster';

type RoleTab = 'all' | 'acting' | 'directing' | 'writing';
type WatchTab = 'all' | 'watched' | 'unwatched';
type SortMode = 'pop' | 'new';

function creditMatchesRole(c: PersonCredit, role: RoleTab): boolean {
  if (role === 'all') return true;
  const roles = [...(c.roles || []), ...(c.jobs || []), c.department || ''].map((x) => String(x).toLowerCase());
  if (role === 'acting') return roles.some((r) => r.includes('act') || r.includes('cast')) || !!c.character;
  if (role === 'directing') return roles.some((r) => r.includes('direct'));
  if (role === 'writing') return roles.some((r) => r.includes('writ') || r.includes('screenplay') || r.includes('story'));
  return true;
}

export function Person({ id, name }: { id: number; name: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = usePerson(id);
  const trackedQ = useTrackedPeople();
  const [roleTab, setRoleTab] = useState<RoleTab>('all');
  const [watchFilter, setWatchFilter] = useState<WatchTab>('all');
  const [sort, setSort] = useState<SortMode>('pop');

  const credits = useMemo(() => data?.credits || [], [data?.credits]);
  const isTracked = !!(trackedQ.data || []).some((x) => Number(x.id) === Number(id));
  const toggleTrack = async () => {
    await cin('person-track-toggle', { id, name: data?.name || name, photo: data?.photo || null });
    qc.invalidateQueries({ queryKey: ['tracked-people'] });
  };

  const roleFiltered = useMemo(
    () => credits.filter((c) => creditMatchesRole(c, roleTab)),
    [credits, roleTab],
  );
  const watchedDone = useMemo(() => roleFiltered.filter((c) => !!c.watched).length, [roleFiltered]);
  const watchedTotal = roleFiltered.length;
  const pct = watchedTotal > 0 ? Math.round((watchedDone / watchedTotal) * 100) : 0;

  const visibleCredits = useMemo(() => {
    let list = roleFiltered;
    if (watchFilter === 'watched') list = list.filter((c) => !!c.watched);
    else if (watchFilter === 'unwatched') list = list.filter((c) => !c.watched);
    if (sort === 'new') return [...list].sort((a, b) => (b.year || 0) - (a.year || 0));
    return [...list].sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));
  }, [roleFiltered, watchFilter, sort]);

  return (
    <div className="h-full overflow-y-auto px-8 pb-20 pt-28 sm:px-12">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="h-48 w-36 flex-none overflow-hidden rounded-2xl bg-bg3 ring-1 ring-white/10">
          <Img eager srcs={[data?.photo]} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold">{data?.name || name}</h1>
            <button
              onClick={toggleTrack}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
                isTracked ? 'bg-acc text-acc-ink shadow' : 'bg-white/10 text-fg hover:bg-white/15'
              }`}
            >
              {isTracked ? <BellRing size={14} /> : <Bell size={14} />}
              <span>{isTracked ? t('tracking_person') : t('track_person')}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg2">
            {data?.knownFor ? <span className="rounded-full bg-acc/20 px-3 py-1 font-medium text-acc">{t('person_known_for')}: {data.knownFor}</span> : null}
            {data?.birthday ? <span>{data.birthday}{data.deathday ? ` — ${data.deathday}` : ''}</span> : null}
            {data?.place ? <span>· {data.place}</span> : null}
          </div>
          {data?.bio ? <p className="max-w-3xl text-sm leading-relaxed text-fg2">{data.bio}</p> : null}
          {!data && !isLoading ? (
            <div className="flex max-w-xl items-center gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 ring-1 ring-amber-400/25">
              <Info size={15} className="flex-none text-amber-300" />
              <span>{t('person_tmdb_hint')}</span>
            </div>
          ) : null}
        </div>
      </div>

      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t('person_credits')} {visibleCredits.length ? `(${visibleCredits.length})` : ''}</h2>
          {watchedTotal > 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-fg2">{t('person_watched_progress', { done: watchedDone, total: watchedTotal })}</span>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-acc transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {([
            ['all', t('person_role_all')],
            ['acting', t('person_role_acting')],
            ['directing', t('person_role_directing')],
            ['writing', t('person_role_writing')],
          ] as const).map(([idTab, lbl]) => (
            <button
              key={idTab}
              onClick={() => setRoleTab(idTab)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${roleTab === idTab ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg'}`}
            >
              {lbl}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {([
            ['all', t('person_filter_all')],
            ['watched', t('person_filter_watched')],
            ['unwatched', t('person_filter_unwatched')],
          ] as const).map(([wf, lbl]) => (
            <button
              key={wf}
              onClick={() => setWatchFilter(wf)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${watchFilter === wf ? 'bg-fg text-bg' : 'bg-white/8 text-fg2 hover:bg-white/15'}`}
            >
              {lbl}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="ms-auto rounded-full bg-bg1 px-3 py-1.5 text-xs text-fg ring-1 ring-line"
          >
            <option value="pop">{t('person_sort_pop')}</option>
            <option value="new">{t('person_sort_new')}</option>
          </select>
        </div>

        {isLoading && !credits.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-bg3" />)}
          </div>
        ) : visibleCredits.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
            {visibleCredits.map((c) => <Poster key={`${c.type}:${c.id}`} item={c} w={160} watched={!!c.watched} />)}
          </div>
        ) : (
          <p className="text-sm text-fg3">{t('person_no_credits')}</p>
        )}
      </section>
    </div>
  );
}
