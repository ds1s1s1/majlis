import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Clock, Film, Flame, Star, Tv } from 'lucide-react';
import { cin, type CinemaStats } from '../../api';
import { genreLabel } from '../../config/genres';
import { useHost, useNav, useT } from '../../host';
import { Img } from '../../ui/Img';

export function CinemaDashboard({ onBack }: { onBack: () => void }) {
  const t = useT();
  const nav = useNav();
  const { lang } = useHost();
  const ar = lang === 'ar';
  const BackIcon = ar ? ArrowRight : ArrowLeft;

  const q = useQuery({
    queryKey: ['cinema-stats'],
    queryFn: () => cin<CinemaStats>('cinema-stats'),
    staleTime: 30_000,
  });

  const stats = q.data;
  const maxMonthHrs = Math.max(1, ...(stats?.monthlyHours || []).map((m) => m.hours));
  const maxGenreCnt = Math.max(1, ...(stats?.topGenres || []).map((g) => g.count));
  const isEmpty = !stats || (stats.totalMinutes === 0 && stats.moviesWatched === 0 && stats.episodesWatched === 0);

  const openPerson = (id: number | null | undefined, name: string) => {
    if (!id) return;
    nav.open({ kind: 'person', id, name });
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-fg ring-1 ring-white/10 transition hover:bg-white/15"
        >
          <BackIcon size={14} />
          {t('back_to_profile')}
        </button>
        <h2 className="text-xl font-bold text-fg">{t('cinema_dashboard')}</h2>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg2 ring-1 ring-white/5" />
          ))}
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard icon={<Clock size={16} />} label={t('stat_hours_watched')} value={String(stats.totalHours)} sub={`${stats.totalMinutes}m`} />
            <KpiCard icon={<Film size={16} />} label={t('stat_movies_done')} value={String(stats.moviesWatched)} />
            <KpiCard icon={<Tv size={16} />} label={t('stat_episodes_done')} value={String(stats.episodesWatched)} />
            <KpiCard
              icon={<Flame size={16} />}
              label={t('stat_streak')}
              value={t('days_n', { n: stats.currentStreak })}
              sub={`${t('stat_best_streak')}: ${t('days_n', { n: stats.longestStreak })}`}
            />
            <KpiCard
              icon={<Star size={16} />}
              label={t('stat_avg_rating')}
              value={stats.avgRating != null ? `${stats.avgRating.toFixed(1)}/10` : '—'}
            />
          </div>

          {isEmpty ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-bg1/60 p-8 text-center text-sm text-fg3">
              {t('dashboard_empty')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-2xl bg-bg1/90 p-5 ring-1 ring-white/10 lg:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-fg">{t('monthly_activity')}</h3>
                    <span dir="ltr" className="font-mono text-xs text-acc">{stats.totalHours}h</span>
                  </div>
                  <div dir="ltr">
                  <svg viewBox="0 0 600 170" className="h-44 w-full overflow-visible">
                    {stats.monthlyHours.map((m, idx) => {
                      const colW = 600 / Math.max(1, stats.monthlyHours.length);
                      const barW = Math.min(28, colW * 0.56);
                      const x = idx * colW + (colW - barW) / 2;
                      const barH = Math.max(m.hours > 0 ? 6 : 2, (m.hours / maxMonthHrs) * 116);
                      const y = 136 - barH;
                      const label = m.ym.slice(5);
                      return (
                        <g key={m.ym}>
                          <title>{`${m.ym}: ${m.hours}h`}</title>
                          <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={barH}
                            rx={5}
                            fill={m.hours > 0 ? 'var(--c-acc, #E5A93C)' : 'rgba(255,255,255,0.12)'}
                            opacity={m.hours > 0 ? 0.92 : 0.6}
                          />
                          {m.hours > 0 ? (
                            <text x={x + barW / 2} y={Math.max(12, y - 5)} textAnchor="middle" fill="#f4efe6" fontSize="9.5" fontFamily="monospace">
                              {m.hours}
                            </text>
                          ) : null}
                          <text x={x + barW / 2} y={156} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10" fontFamily="monospace">
                            {label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  </div>
                </section>

                <section className="rounded-2xl bg-bg1/90 p-5 ring-1 ring-white/10">
                  <h3 className="mb-3 text-sm font-bold text-fg">{t('top_genres')}</h3>
                  {stats.topGenres.length ? (
                    <div className="space-y-2.5">
                      {stats.topGenres.map((g) => (
                        <div key={g.name} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-fg">{genreLabel(g.name, lang)}</span>
                            <span dir="ltr" className="font-mono text-fg3">{g.count}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-acc transition-all"
                              style={{ width: `${Math.max(8, Math.round((g.count / maxGenreCnt) * 100))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-fg3">—</p>
                  )}
                </section>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <PeopleRankSection title={t('top_directors')} items={stats.topDirectors} onOpen={openPerson} />
                <PeopleRankSection title={t('top_actors')} items={stats.topActors} onOpen={openPerson} />
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-bg1/90 p-4 ring-1 ring-white/10">
      <div className="mb-2 flex items-center gap-2 text-xs text-fg3">
        <span className="text-acc">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div dir="ltr" className="text-2xl font-bold text-fg">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-fg3">{sub}</div> : null}
    </div>
  );
}

function PeopleRankSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: { id?: number | null; name: string; count: number; photo?: string | null }[];
  onOpen: (id: number | null | undefined, name: string) => void;
}) {
  return (
    <section className="rounded-2xl bg-bg1/90 p-5 ring-1 ring-white/10">
      <h3 className="mb-3 text-sm font-bold text-fg">{title}</h3>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((p) => {
            const inner = (
              <>
                <div className="size-7 overflow-hidden rounded-full bg-bg3 ring-1 ring-white/10">
                  <Img
                    srcs={[p.photo]}
                    className="size-full object-cover"
                    fallback={<span className="grid size-full place-items-center text-[11px] font-bold text-fg3">{p.name.slice(0, 1)}</span>}
                  />
                </div>
                <span className="max-w-[140px] truncate text-xs font-medium text-fg">{p.name}</span>
                <span dir="ltr" className="rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-acc">{p.count}</span>
              </>
            );
            return p.id ? (
              <button
                key={`${p.id}-${p.name}`}
                onClick={() => onOpen(p.id, p.name)}
                className="flex items-center gap-2 rounded-full bg-white/8 pe-2.5 ps-1.5 py-1 ring-1 ring-white/10 transition hover:bg-acc/20 hover:ring-acc"
              >
                {inner}
              </button>
            ) : (
              <div key={p.name} className="flex items-center gap-2 rounded-full bg-white/6 pe-2.5 ps-1.5 py-1 ring-1 ring-white/10">
                {inner}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-fg3">—</p>
      )}
    </section>
  );
}
