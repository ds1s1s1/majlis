import type { ReactNode } from 'react';
import { Activity, BarChart3, CheckCircle2, MapPin, Pencil, Share2, UserPlus, UserMinus } from 'lucide-react';
import { useHost } from '../../host';
import type { HeroStatKey, UserProfileState } from '../../data/profileMockSeed';

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const renderDuration = (mins: number, ar: boolean): ReactNode => {
  const total = Math.max(0, Math.floor(mins || 0));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (!ar) return <span dir="ltr" className="whitespace-nowrap">{`${d}d · ${h}h · ${m}m`}</span>;
  return (
    <span dir="rtl" className="inline-flex items-baseline justify-center gap-1.5 whitespace-nowrap" style={{ unicodeBidi: 'isolate' }}>
      <span><bdi dir="ltr">{d}</bdi> يوم</span>
      <span aria-hidden="true" className="opacity-60">·</span>
      <span><bdi dir="ltr">{h}</bdi> س</span>
      <span aria-hidden="true" className="opacity-60">·</span>
      <span><bdi dir="ltr">{m}</bdi> د</span>
    </span>
  );
};

const STAT_LABELS: Record<HeroStatKey, { en: string; ar: string }> = {
  timeWatched: { en: 'TIME WATCHED', ar: 'وقت المشاهدة' },
  episodes: { en: 'EPISODES', ar: 'الحلقات' },
  movies: { en: 'MOVIES', ar: 'الأفلام' },
  reviews: { en: 'REVIEWS', ar: 'المراجعات' },
  ratings: { en: 'RATINGS', ar: 'التقييمات' },
  lists: { en: 'LISTS', ar: 'القوائم' },
  games: { en: 'GAMES', ar: 'الألعاب' },
  books: { en: 'BOOKS', ar: 'الكتب' },
  friends: { en: 'FRIENDS', ar: 'الأصدقاء' },
  groups: { en: 'GROUPS', ar: 'المجموعات' },
};

function renderStatValue(key: HeroStatKey, p: UserProfileState, ar: boolean): ReactNode {
  switch (key) {
    case 'timeWatched': return renderDuration(p.stats.timeWatchedMinutes || 0, ar);
    case 'episodes': return <bdi dir="ltr">{fmtCount(p.stats.episodesCount || 0)}</bdi>;
    case 'movies': return <bdi dir="ltr">{fmtCount(p.stats.moviesCount || 0)}</bdi>;
    case 'reviews': return <bdi dir="ltr">{fmtCount(p.stats.reviewsCount || p.ratings.filter((r) => !!r.review).length)}</bdi>;
    case 'ratings': return <bdi dir="ltr">{fmtCount(p.ratings.length)}</bdi>;
    case 'lists': return <bdi dir="ltr">{fmtCount(p.lists.length)}</bdi>;
    case 'games': return <bdi dir="ltr">{fmtCount(p.favorites.games.length)}</bdi>;
    case 'books': return <bdi dir="ltr">{fmtCount(p.favorites.books.length)}</bdi>;
    case 'friends': return <bdi dir="ltr">{fmtCount(p.friends.length)}</bdi>;
    case 'groups': return <bdi dir="ltr">{fmtCount(p.groups.length)}</bdi>;
  }
}

export function ProfileHero({
  profile,
  isMe,
  isFriend,
  onOpenActivity,
  onOpenDashboard,
  onOpenShare,
  onStartEdit,
  onToggleFriend,
}: {
  profile: UserProfileState;
  isMe: boolean;
  isFriend?: boolean;
  onOpenActivity: () => void;
  onOpenDashboard?: () => void;
  onOpenShare: () => void;
  onStartEdit: () => void;
  onToggleFriend?: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const g = profile.general;
  const presenceColor = g.presence === 'online' ? '#5CB874' : g.presence === 'session' ? '#E5A93C' : null;
  const stats = (profile.showcase.heroStats || ['timeWatched', 'episodes', 'movies', 'reviews']).slice(0, 4);

  return (
    <div>
      {/* A. Hero Top Banner */}
      {!profile.customCanvas.hideTopBanner ? (
        <div className="relative h-[240px] w-full overflow-hidden rounded-b-2xl bg-[#1A1612]">
          {g.banner ? (
            <img src={g.banner} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background: 'radial-gradient(ellipse 80% 70% at 70% 20%, color-mix(in srgb, var(--pf-accent) 28%, transparent), transparent 65%), linear-gradient(135deg, #241c13 0%, #12100E 100%)',
              }}
            />
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(18,16,14,0.12) 0%, rgba(18,16,14,0.45) 55%, var(--pf-bg) 100%)' }}
          />
        </div>
      ) : (
        <div className="h-24" />
      )}

      {/* B + C. Identity Header Bar */}
      <div className={`relative z-10 mx-auto max-w-[1120px] px-6 sm:px-10 ${profile.customCanvas.hideTopBanner ? '' : '-mt-14'}`}>
        {/* Floating Status Thought Bubble */}
        {g.status.trim() && (isMe || profile.privacy.shareLiveStatus) ? (
          <div className="mb-2 flex flex-col items-start ps-2">
            <div
              dir="auto"
              className="max-w-xs rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-card)]/95 px-3.5 py-1.5 text-xs text-[var(--pf-text)] shadow-lg backdrop-blur-md"
            >
              {g.status}
            </div>
            <div className="ms-5 mt-1 size-2 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)]/95" />
            <div className="ms-3.5 mt-0.5 size-1.5 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)]/95" />
          </div>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* Start Side: Avatar + Identity Meta */}
          <div className="flex min-w-0 items-end gap-4">
            <div className="relative size-[88px] flex-none">
              <div
                className="grid size-[88px] place-items-center overflow-hidden rounded-full text-3xl font-bold ring-4 ring-[var(--pf-bg)] shadow-xl"
                style={{
                  background: g.avatar?.startsWith('data:') || g.avatar?.startsWith('http')
                    ? 'var(--pf-card)'
                    : 'linear-gradient(135deg, var(--pf-accent), color-mix(in srgb, var(--pf-accent) 40%, #000))',
                  color: 'var(--pf-accent-fg)',
                }}
              >
                {g.avatar && (g.avatar.startsWith('data:') || g.avatar.startsWith('http')) ? (
                  <img src={g.avatar} alt={g.alias} className="h-full w-full object-cover" />
                ) : (
                  <span>{g.avatar || (g.alias || 'M').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              {presenceColor && profile.privacy.shareLiveStatus ? (
                <span
                  title={g.presence}
                  className="absolute bottom-1 end-1 size-4 rounded-full ring-2 ring-[var(--pf-bg)]"
                  style={{ background: presenceColor }}
                />
              ) : null}
            </div>

            <div className="min-w-0 pb-1">
              <div className="flex items-center gap-2">
                <h1 dir="auto" className="truncate text-[24px] font-bold leading-tight text-[var(--pf-text)]">
                  {g.alias || (ar ? 'مستخدم مجلس' : 'Majlis User')}
                </h1>
                {g.verified ? <CheckCircle2 size={17} className="flex-none text-[var(--pf-accent)]" /> : null}
              </div>
              {g.pronouns || g.location ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--pf-text-muted)]">
                  {g.pronouns ? (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px]">{g.pronouns}</span>
                  ) : null}
                  {g.pronouns && g.location ? <span>·</span> : null}
                  {g.location ? (
                    <span className="inline-flex items-center gap-1"><MapPin size={12} />{g.location}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* End Side: Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <button
              type="button"
              onClick={onOpenActivity}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)] px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]/60"
            >
              <Activity size={14} className="text-[var(--pf-accent)]" />
              <span>{ar ? 'النشاط' : 'Activity'}</span>
            </button>
            {isMe && onOpenDashboard ? (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)] px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]/60"
              >
                <BarChart3 size={14} className="text-[var(--pf-accent)]" />
                <span>{ar ? 'لوحة السينما' : 'Cinema Dashboard'}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pf-card-border)] bg-[var(--pf-card)] px-3.5 py-1.5 text-xs font-medium text-[var(--pf-text)] transition hover:border-[var(--pf-accent)]/60"
            >
              <Share2 size={14} />
              <span>{ar ? 'مشاركة' : 'Share'}</span>
            </button>
            {isMe ? (
              <button
                type="button"
                onClick={onStartEdit}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition hover:brightness-110"
                style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
              >
                <Pencil size={13} />
                <span>{ar ? 'تعديل الملف' : 'Edit profile'}</span>
              </button>
            ) : onToggleFriend ? (
              <button
                type="button"
                onClick={onToggleFriend}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition hover:brightness-110"
                style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
              >
                {isFriend ? <UserMinus size={14} /> : <UserPlus size={14} />}
                <span>{isFriend ? (ar ? 'إزالة صديق' : 'Remove friend') : (ar ? 'أضف صديق' : 'Add friend')}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* D. Hero Stats Ribbon */}
        <div
          className="my-5 grid grid-cols-2 gap-4 py-4 sm:grid-cols-4"
          style={{ borderTop: '1px solid var(--pf-card-border)', borderBottom: '1px solid var(--pf-card-border)' }}
        >
          {stats.map((k, idx) => (
            <div key={`${k}-${idx}`} className="flex flex-col items-center justify-center gap-1 text-center">
              <div className="font-mono text-[clamp(18px,1.5vw,22px)] font-bold leading-tight tabular-nums text-[var(--pf-text)]">
                {renderStatValue(k, profile, ar)}
              </div>
              <div className="text-[11px] font-semibold tracking-wide text-[var(--pf-text-muted)]">
                {ar ? STAT_LABELS[k].ar : STAT_LABELS[k].en}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
