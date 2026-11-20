import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, social, toPlayableAudioUrl, useSocialFriends, useSocialProfile, type Preview } from '../api';
import { useHost, useNav, useT } from '../host';
import { Icon } from '../ui/Icon';
import { Poster } from '../ui/Poster';
import { SocialAvatar } from '../ui/Social';

const fmtId = (id: string) => (id.length === 9 ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : id);

export function FriendProfile({ id, active = true }: { id: string; active?: boolean }) {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const pq = useSocialProfile(id);
  const fq = useSocialFriends();
  const prof = pq.data;
  const friendEntry = fq.data?.friends.find((f) => f.id === id) || null;

  // Profile song query (inline payload or locally cached friend Opus clip)
  const songQ = useQuery({
    queryKey: ['song', id],
    queryFn: () => cin<{ dataUrl?: string } | null>('song-get', { id: prof?.isMe ? undefined : id }).catch(() => null),
    enabled: !!prof && !prof.songDataUrl,
  });
  const songSrc = prof?.songDataUrl || songQ.data?.dataUrl || null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  // Soft fade-in profile song on active profile visit; stop & revoke immediately on leave/inactive/theater/hide
  useEffect(() => {
    if (!songSrc || !active) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
      setPlaying(false);
      return;
    }
    const { url, revoke } = toPlayableAudioUrl(songSrc);
    if (!url) return;
    let cancelled = false;
    const a = new Audio(url);
    a.loop = true;
    a.volume = 0;
    a.muted = muted;
    audioRef.current = a;
    let timer: ReturnType<typeof setInterval> | null = null;
    a.play().then(() => {
      if (cancelled) { a.pause(); a.src = ''; return; }
      setPlaying(true);
      let v = 0;
      timer = setInterval(() => {
        if (cancelled) { if (timer) { clearInterval(timer); timer = null; } return; }
        v = Math.min(0.25, v + 0.025);
        a.volume = v;
        if (v >= 0.25 && timer) { clearInterval(timer); timer = null; }
      }, 80);
    }).catch(() => { if (!cancelled) setPlaying(false); });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      a.pause();
      a.src = '';
      if (audioRef.current === a) audioRef.current = null;
      setPlaying(false);
      revoke();
    };
  }, [songSrc, active]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.volume = 0.25; a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  if (!prof) return <div className="h-full p-12 pt-28"><div className="skel h-64 w-full rounded-3xl" /></div>;

  const accent = prof.accent || '#e2a43a';
  const addOrRemove = async () => {
    if (friendEntry) await social('remove', { id: prof.id });
    else await social('add', { idOrHandle: prof.id });
    qc.invalidateQueries({ queryKey: ['social-friends'] });
    qc.invalidateQueries({ queryKey: ['social-profile', id] });
    toast(friendEntry ? t('remove') : t('friend_req_sent'));
  };

  const toPreview = (x: { id: string; type?: string; name: string; poster?: string | null; year?: number | null }): Preview =>
    ({ id: x.id, type: x.type || 'movie', name: x.name, poster: x.poster || null, year: x.year || null });

  return (
    <div className="h-full overflow-y-auto px-6 pb-24 pt-28 sm:px-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <div
          className="relative overflow-hidden rounded-3xl bg-bg1 p-7 ring-1 ring-line sm:p-9"
          style={{ background: `radial-gradient(circle at top right, color-mix(in srgb, ${accent} 24%, transparent), transparent 62%), var(--c-bg1)` }}
        >
          <div className="flex flex-wrap items-center gap-6">
            <SocialAvatar avatar={prof.avatar} name={prof.displayName || prof.id} accent={accent} size={92} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold sm:text-4xl" style={{ color: accent }}>{prof.displayName || prof.id}</h1>
                {prof.online ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    {prof.inParty ? t('in_party_now', { n: prof.inParty.count }) : prof.watching ? t('watching_now', { name: prof.watching.name }) : t('online_now')}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-fg3">{t('offline_status')}</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg3">
                <span dir="ltr" className="font-mono">{fmtId(prof.id)}</span>
                {!prof.isMe && prof.compatibility?.pct != null ? (
                  <>
                    <span className="rounded-full bg-acc/20 px-2.5 py-0.5 font-mono text-xs font-semibold text-acc ring-1 ring-acc/35">
                      {t('taste_compat_pct', { n: prof.compatibility.pct })}
                    </span>
                    {prof.compatibility.commonWatched > 0 ? (
                      <span className="text-xs text-fg3">
                        {t('taste_shared_watched', { n: prof.compatibility.commonWatched })}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              {prof.bio ? <p dir="auto" className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg2">{prof.bio}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {songSrc ? (
                <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 ring-1 ring-white/15 backdrop-blur-md">
                  <button onClick={togglePlay} className="grid size-7 place-items-center rounded-full bg-white/10 hover:bg-white/20">
                    <Icon n={playing ? 'pause' : 'play'} s={14} />
                  </button>
                  <span className="text-xs text-fg2">{t('song_playing')}</span>
                  <button onClick={() => setMuted((m) => !m)} className="rounded-full px-2.5 py-1 text-xs font-medium text-acc hover:bg-white/10">
                    {muted ? t('unmute_song') : t('mute_song')}
                  </button>
                </div>
              ) : null}
              {!prof.isMe ? (
                <button onClick={addOrRemove} className="rounded-full bg-fg px-5 py-2.5 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
                  {friendEntry ? t('remove') : t('add_friend_btn')}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {!prof.isMe && prof.compatibility && (prof.compatibility.sharedGenres?.length || prof.compatibility.sharedTopRated?.length) ? (
          <section className="rounded-2xl bg-bg1 p-5 ring-1 ring-line">
            {prof.compatibility.sharedGenres?.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {prof.compatibility.sharedGenres.map((g) => (
                  <span key={g} className="rounded-full bg-white/8 px-3 py-1 text-xs text-fg2 ring-1 ring-white/10">
                    {g}
                  </span>
                ))}
              </div>
            ) : null}
            {prof.compatibility.sharedTopRated?.length ? (
              <div className={prof.compatibility.sharedGenres?.length ? 'mt-4' : ''}>
                <h2 className="mb-3 text-base font-semibold">{t('taste_shared_top')}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3.5">
                  {prof.compatibility.sharedTopRated.map((item) => (
                    <Poster key={item.id} item={toPreview(item)} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {prof.favorites.length ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">{t('showcased_favs')}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-4">
              {prof.favorites.map((item) => <Poster key={item.id} item={toPreview(item)} />)}
            </div>
          </section>
        ) : null}

        {prof.lists.length ? (
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">{t('custom_lists')}</h2>
            {prof.lists.map((list) => (
              <div key={list.id} className="rounded-2xl bg-bg1 p-5 ring-1 ring-line">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{list.name}</h3>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-fg3">{list.items.length}</span>
                </div>
                {list.description ? <p dir="auto" className="mb-4 text-xs text-fg2">{list.description}</p> : null}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(135px,1fr))] gap-3.5">
                  {list.items.map((item) => <Poster key={item.id} item={toPreview(item)} />)}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {prof.historyHidden ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-bg1 p-6 text-sm text-fg2 ring-1 ring-line">
            <Icon n="lock" s={18} className="text-fg3" />
            <span>{t('history_private')}</span>
          </div>
        ) : (
          <>
            {prof.history.length ? (
              <section>
                <h2 className="mb-4 text-xl font-semibold">{t('history')}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-4">
                  {prof.history.slice(0, 18).map((h) => <Poster key={`${h.id}-${h.at}`} item={toPreview(h)} />)}
                </div>
              </section>
            ) : null}

            {prof.ratings.length ? (
              <section>
                <h2 className="mb-4 text-xl font-semibold">{t('ratings_reviews')}</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {prof.ratings.slice(0, 16).map((r, i) => {
                    const key = r.id || `${r.name}-${i}`;
                    return (
                      <div key={key} className="rounded-2xl bg-bg1 p-4 ring-1 ring-line">
                        <div className="flex items-center gap-2">
                          {r.id ? (
                            <button onClick={() => nav.open({ kind: 'title', type: 'movie', id: r.id! })} className="truncate font-semibold hover:text-acc hover:underline">
                              {r.name}
                            </button>
                          ) : <span className="truncate font-semibold">{r.name}</span>}
                          {r.year ? <span className="text-xs text-fg3">{r.year}</span> : null}
                          <span className="flex-1" />
                          {r.rating ? <span className="font-mono text-sm text-acc">{'★'.repeat(Math.round(r.rating))}</span> : null}
                        </div>
                        {r.review ? (
                          revealed.has(key)
                            ? <p dir="auto" className="mt-2 text-sm leading-relaxed text-fg2">{r.review}</p>
                            : <button onClick={() => setRevealed((s) => new Set(s).add(key))} className="mt-2 text-xs font-medium text-acc hover:underline">{t('what_said')}</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
