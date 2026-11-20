import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, invoke, social, toPlayableAudioUrl, useCaps, useSearch, useSocialMe, type CustomList, type Preview, type SocialTitle } from '../api';
import { useHost, useNav, useT } from '../host';
import type { Key } from '../i18n';
import { Icon } from '../ui/Icon';
import { Img } from '../ui/Img';

export interface Look { avatar: string | null; accent: string | null; theme: string; song?: string | null }
export interface Prefs {
  profile: string; look: Look; profiles: ({ name: string } & Look)[];
  downloadDir?: string; perf?: boolean; incognito?: boolean;
  mediaMaxHeight: number | null; mediaVsr: boolean | null; debridService: string | null; debridOnly: boolean | null; autoNext: boolean | null; subLang2: string | null; cinemaOnboarded: boolean | null;
}
export const usePrefs = () => useQuery({ queryKey: ['prefs'], queryFn: () => cin<Prefs>('prefs'), staleTime: Infinity });

export const THEMES: { id: string; label: Key; bg: string; fg: string }[] = [
  { id: 'majlis', label: 'theme_majlis', bg: '#070605', fg: '#e2a43a' }, { id: 'oled', label: 'theme_oled', bg: '#050507', fg: '#f2f2f5' },
  { id: 'nord', label: 'theme_nord', bg: '#1b1f27', fg: '#88c0d0' }, { id: 'dracula', label: 'theme_dracula', bg: '#191a21', fg: '#bd93f9' }, { id: 'noir', label: 'theme_noir', bg: '#000', fg: '#fff' },
];
export const ACCENTS = ['#e2a43a', '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#f2eee8'];
const EMOJI = ['🦅', '🐪', '🌙', '⭐', '🎬', '🍿', '🦁', '🐺', '🦊', '🐉', '👑', '🎧', '🌴', '☕', '🏜️', '🛸'];

function useSetPrefs() {
  const qc = useQueryClient();
  return async (patch: Partial<Omit<Prefs, 'look'>> & { look?: Partial<Look> }) => {
    await cin('prefs-set', patch);
    await qc.invalidateQueries({ queryKey: ['prefs'] });
    await qc.invalidateQueries({ queryKey: ['social-me'] });
  };
}

export function Avatar({ look, name, size = 48 }: { look: Partial<Look>; name: string; size?: number }) {
  const a = look.avatar, bg = look.accent || '#e2a43a';
  return (
    <span className="grid flex-none place-items-center overflow-hidden rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.48, background: a?.startsWith('data:') ? undefined : `linear-gradient(135deg, ${bg}, color-mix(in srgb, ${bg} 45%, #000))` }}>
      {a?.startsWith('data:') ? <img src={a} alt="" className="h-full w-full object-cover" /> : a || (name === 'default' ? '🏠' : name.slice(0, 1).toUpperCase())}
    </span>
  );
}

// a picture from disk, shrunk to 256 px so it fits in the settings file
async function shrink(file: File) {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height), c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  return c.toDataURL('image/webp', 0.85);
}

export function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-xl font-semibold">{title}</h2>
      {sub ? <p className="mb-4 text-sm text-fg2">{sub}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

// who's watching: pick, add, remove
export function ProfilesSection() {
  const t = useT(), qc = useQueryClient();
  const p = usePrefs().data;
  const [name, setName] = useState('');
  if (!p) return null;
  const use = async (n: string) => { await cin('profile-use', { name: n }); await qc.invalidateQueries(); };
  return (
    <Section title={t('who_watching')} sub={t('who_watching_sub')}>
      <div className="flex flex-wrap gap-5">
        {p.profiles.map((x) => (
          <div key={x.name} className="group relative">
            <button onClick={() => use(x.name)} className={`flex w-24 flex-col items-center gap-2 rounded-2xl p-2 transition ${x.name === p.profile ? 'bg-white/8 ring-2 ring-acc' : 'hover:bg-white/5'}`}>
              <Avatar look={x} name={x.name} size={64} />
              <span className="w-full truncate text-center text-sm">{x.name === 'default' ? t('profile_main') : x.name}</span>
            </button>
            {x.name !== 'default' && x.name !== p.profile ? (
              <button aria-label={t('remove')} onClick={async () => { await cin('profile-remove', { name: x.name }); qc.invalidateQueries({ queryKey: ['prefs'] }); }}
                className="absolute -end-1 -top-1 grid size-6 place-items-center rounded-full bg-bg3 text-fg2 opacity-0 ring-1 ring-line transition hover:text-fg group-hover:opacity-100"><Icon n="x" s={12} /></button>
            ) : null}
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { use(name.trim()); setName(''); } }} className="flex w-56 flex-col justify-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={t('profile_new_ph')} className="rounded-full bg-white/6 px-4 py-2 text-sm ring-1 ring-line focus:ring-acc" />
          <button className="flex items-center justify-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-sm hover:bg-white/15"><Icon n="plus" s={16} />{t('profile_add')}</button>
        </form>
      </div>
    </Section>
  );
}

// this profile's picture, colour, song and theme (applied live)
export function LookSection({ mode = 'all', active = true }: { mode?: 'all' | 'profile' | 'theme'; active?: boolean }) {
  const t = useT(), { toast } = useHost(), set = useSetPrefs(), qc = useQueryClient();
  const p = usePrefs().data;
  const socialMe = useSocialMe().data;
  const [songUrl, setSongUrl] = useState('');
  const [songStart, setSongStart] = useState('0');
  const [songBusy, setSongBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<{ a: HTMLAudioElement; revoke: () => void } | null>(null);
  const songQuery = useQuery({
    queryKey: ['song', p?.profile],
    queryFn: () => cin<string | { url?: string; dataUrl?: string; song?: string } | null>('song-get', {}).catch(() => null),
    enabled: !!p && mode !== 'theme',
  });
  const songSrc = typeof songQuery.data === 'string' ? songQuery.data : (songQuery.data?.dataUrl || songQuery.data?.url || songQuery.data?.song || null);

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.a.pause();
      audioRef.current.a.src = '';
      audioRef.current.revoke();
      audioRef.current = null;
    }
    setPlaying(false);
  };

  useEffect(() => { if (!active) stopPreview(); }, [active]);
  useEffect(() => () => stopPreview(), []);

  if (!p) return null;
  const pick = async (f?: File | null) => { if (f) set({ look: { avatar: await shrink(f) } }); };
  const saveSong = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!songUrl.trim() || songBusy) return;
    setSongBusy(true);
    try {
      await cin('song-set', { url: songUrl.trim(), start: Math.max(0, Number(songStart) || 0) });
      toast(t('song_saved'));
      setSongUrl('');
      await qc.invalidateQueries({ queryKey: ['song'] });
      await qc.invalidateQueries({ queryKey: ['prefs'] });
    } catch (err) {
      toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setSongBusy(false);
    }
  };
  const clearSong = async () => {
    stopPreview();
    await cin('song-clear').catch(() => {});
    await qc.invalidateQueries({ queryKey: ['song'] });
    await qc.invalidateQueries({ queryKey: ['prefs'] });
  };
  const togglePreview = async () => {
    if (playing && audioRef.current) {
      stopPreview();
      return;
    }
    const raw = songSrc || (await cin<string | { url?: string; dataUrl?: string } | null>('song-get', {}).catch(() => null));
    const src = typeof raw === 'string' ? raw : (raw?.dataUrl || raw?.url || null);
    if (!src) return;
    stopPreview();
    const { url, revoke } = toPlayableAudioUrl(src);
    if (!url) return;
    const a = new Audio(url);
    a.onended = () => stopPreview();
    audioRef.current = { a, revoke };
    a.currentTime = 0;
    a.play().then(() => setPlaying(true)).catch(() => stopPreview());
  };

  const curAccent = p.look.accent || ACCENTS[0];

  return (
    <Section title={mode === 'theme' ? t('ob_theme') : t('look')} sub={mode === 'theme' ? t('ob_theme_sub') : t('look_sub')}>
      {mode !== 'theme' ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Avatar look={p.look} name={p.profile} size={64} />
          <div className="ms-3 flex max-w-xl flex-wrap gap-1.5">
            {EMOJI.map((e) => <button key={e} onClick={() => set({ look: { avatar: e } })} className={`grid size-10 place-items-center rounded-full text-xl transition ${p.look.avatar === e ? 'bg-acc/25 ring-2 ring-acc' : 'bg-white/6 hover:bg-white/12'}`}>{e}</button>)}
            <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-white/6 px-4 text-sm hover:bg-white/12">
              <Icon n="camera" s={16} />{t('upload_pic')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
          </div>
          {socialMe?.catalogAvatars?.length ? (
            <div className="mt-3 flex w-full flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-fg3">{t('catalog_avatars')}:</span>
              {socialMe.catalogAvatars.map((av) => (
                <button key={av.id} title={av.name} onClick={() => set({ look: { avatar: av.url } })}
                  className={`size-10 overflow-hidden rounded-full transition ${p.look.avatar === av.url ? 'ring-2 ring-acc scale-105' : 'ring-1 ring-line hover:ring-white/40'}`}>
                  <img src={av.url} alt={av.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        {ACCENTS.map((c) => (
          <button key={c} aria-label={c} onClick={() => set({ look: { accent: c } })} className={`size-9 rounded-full ring-offset-2 ring-offset-bg transition ${curAccent.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-fg' : 'hover:scale-110'}`} style={{ background: c }} />
        ))}
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-white/8 px-3.5 text-xs font-medium text-fg2 ring-1 ring-line transition hover:bg-white/15 hover:text-fg">
          <span className="size-4 rounded-full ring-1 ring-white/30" style={{ background: curAccent }} />
          <span>{t('custom_accent')}</span>
          <input type="color" value={curAccent} onChange={(e) => set({ look: { accent: e.target.value } })} className="sr-only" />
        </label>
      </div>

      {mode !== 'profile' ? (
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {THEMES.map((x) => (
            <button key={x.id} onClick={() => set({ look: { theme: x.id } })} className={`overflow-hidden rounded-xl text-start ring-1 transition ${p.look.theme === x.id ? 'ring-2 ring-acc' : 'ring-line hover:ring-fg3'}`}>
              <span className="flex h-20 items-end gap-1.5 p-3" style={{ background: x.bg }}>
                <span className="h-10 w-7 rounded" style={{ background: `color-mix(in srgb, ${x.fg} 25%, ${x.bg})` }} />
                <span className="h-10 w-7 rounded" style={{ background: `color-mix(in srgb, ${x.fg} 40%, ${x.bg})` }} />
                <span className="ms-auto size-4 rounded-full" style={{ background: x.fg }} />
              </span>
              <span className="block bg-bg1 px-3 py-2 text-sm">{t(x.label)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {mode !== 'theme' ? (
        <form onSubmit={saveSong} className="mt-4 rounded-2xl bg-bg1 p-4 ring-1 ring-line">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Icon n="vol" s={16} className="text-acc" />
            <span>{t('profile_song')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <input value={songUrl} onChange={(e) => setSongUrl(e.target.value)} dir="ltr" placeholder={t('profile_song_ph')}
              className="min-w-[220px] flex-1 rounded-full bg-white/6 px-4 py-2 text-sm ring-1 ring-line focus:ring-acc" />
            <label className="flex items-center gap-1.5 rounded-full bg-white/6 px-3 py-2 text-xs text-fg2 ring-1 ring-line">
              <span>{t('song_start')}</span>
              <input type="number" min={0} max={3600} value={songStart} onChange={(e) => setSongStart(e.target.value)} dir="ltr" className="w-12 text-center font-mono text-sm text-fg" />
            </label>
            <button type="submit" disabled={songBusy || !songUrl.trim()} className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink disabled:opacity-50">
              {songBusy ? '…' : t('song_save')}
            </button>
            {songSrc || p.look.song ? (
              <>
                <button type="button" onClick={togglePreview} className="flex items-center gap-1.5 rounded-full bg-acc/20 px-4 py-2 text-sm font-semibold text-acc hover:bg-acc/30">
                  <Icon n={playing ? 'pause' : 'play'} s={15} />{t('song_preview')}
                </button>
                <button type="button" onClick={clearSong} className="rounded-full bg-white/8 px-3.5 py-2 text-sm text-fg2 hover:bg-white/15 hover:text-fg">
                  {t('song_clear')}
                </button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
    </Section>
  );
}

const TRACKER_META: { id: 'trakt' | 'simkl' | 'anilist' | 'mal'; title: string; logo: string; color: string }[] = [
  { id: 'trakt', title: 'Trakt', logo: 'T', color: '#ed1c24' },
  { id: 'simkl', title: 'Simkl', logo: 'S', color: '#0b0f10' },
  { id: 'anilist', title: 'AniList', logo: 'A', color: '#02a9ff' },
  { id: 'mal', title: 'MyAnimeList', logo: 'M', color: '#2e51a2' },
];

// Stremio account, Letterboxd export, Trakt, Simkl, AniList and MyAnimeList
export function AccountsSection() {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const caps = useCaps().data;
  type TS = Record<string, 'on' | { code?: string; url: string } | null>;
  const trk = useQuery({ queryKey: ['trackers'], queryFn: () => cin<TS>('trackers'), refetchInterval: (q) => (Object.values(q.state.data || {}).some((x) => x && x !== 'on') ? 3000 : false) }).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<Record<string, boolean>>({});
  const run = async (what: string, fn: () => Promise<string | void>, svc?: string) => {
    setBusy(what);
    try { const m = await fn(); if (m) toast(m); }
    catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (svc) setNeedsSetup((prev) => ({ ...prev, [svc]: true }));
      toast(svc ? `${t('needs_setup_msg')} (${msg})` : msg);
    }
    finally { setBusy(null); qc.invalidateQueries(); }
  };
  return (
    <Section title={t('accounts')} sub={t('accounts_sub')}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card logo="S" color="#8a5aab" title="Stremio" sub={caps?.stremio ? t('connected') : t('stremio_sub')}>
          {caps?.stremio ? (<>
            <Pill busy={busy === 'sync'} onClick={() => run('sync', async () => { const r = await cin<{ pulled: number; pushed: number; addons?: number }>('stremio-sync', { addons: true }); return t('synced', { a: r.pulled, b: r.pushed }); })}>{t('sync_now')}</Pill>
            <Pill ghost onClick={() => run('out', async () => { await cin('stremio-logout'); })}>{t('sign_out')}</Pill>
          </>) : <Pill busy={busy === 'in'} onClick={() => run('in', async () => { await cin('stremio-login', {}); const r = await cin<{ pulled: number }>('stremio-sync', { addons: true }); return t('synced', { a: r.pulled, b: 0 }); })}>{t('sign_in_browser')}</Pill>}
        </Card>
        {TRACKER_META.map(({ id: svc, title, logo, color }) => {
          const s = trk?.[svc];
          const setupErr = needsSetup[svc];
          const subText = s === 'on' ? t('connected') : s && s.code ? t('enter_code', { code: s.code }) : setupErr ? t('needs_setup_msg') : t('tracker_sub');
          return (
            <Card key={svc} logo={logo} color={color} title={title} sub={subText}>
              {s === 'on' ? (<>
                <Pill busy={busy === `${svc}i`} onClick={() => run(`${svc}i`, async () => t('imported_n', { n: await cin<number>('tracker-import', { svc, service: svc }) }))}>{t('import_history')}</Pill>
                <Pill ghost onClick={() => run(`${svc}o`, async () => { await cin('tracker-out', { svc, service: svc }); })}>{t('sign_out')}</Pill>
              </>) : s && s.url ? <Pill ghost onClick={() => invoke('open', s.url)}>{t('open_page')}</Pill>
                : <Pill busy={busy === svc} ghost={setupErr} onClick={() => run(svc, async () => {
                  const r = await cin<{ error?: string } | void>('tracker-start', { svc, service: svc });
                  if (r && typeof r === 'object' && r.error) throw new Error(r.error);
                  setNeedsSetup((prev) => ({ ...prev, [svc]: false }));
                }, svc)}>{setupErr ? t('configure_first') : t('connect')}</Pill>}
            </Card>
          );
        })}
        <Card logo="L" color="#00c030" title="Letterboxd" sub={t('letterboxd_sub')}>
          <Pill busy={busy === 'lb'} onClick={() => run('lb', async () => { const r = await invoke<{ films: number } | null>('media:letterboxd-import'); return r ? t('imported_n', { n: r.films }) : undefined; })}>{t('import_zip')}</Pill>
        </Card>
      </div>
    </Section>
  );
}

// quality, debrid, next episode, upscaling
export function PlaybackSection() {
  const t = useT(), set = useSetPrefs();
  const p = usePrefs().data, caps = useCaps().data;
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => cin<{ user: Record<string, string>; builtIn: Record<string, boolean> }>('keys') }).data;
  if (!p) return null;
  const services = ['realdebrid', 'torbox', 'premiumize'].filter((s) => keys?.user[s]);
  return (
    <Section title={t('playback')}>
      <Field label={t('max_quality')}>
        <Seg value={p.mediaMaxHeight || 1080} options={[[720, '720p'], [1080, '1080p'], [2160, '4K']]} onChange={(v) => set({ mediaMaxHeight: v })} />
      </Field>
      <Field label={t('auto_next')} hint={t('auto_next_hint')}><Toggle on={p.autoNext !== false} onChange={(v) => set({ autoNext: v })} /></Field>
      <Field label={t('vsr')} hint={t('vsr_hint')}><Toggle on={!!p.mediaVsr} onChange={(v) => set({ mediaVsr: v })} /></Field>
      {services.length ? (<>
        <Field label={t('debrid_service')}><Seg value={p.debridService || caps?.debrid || services[0]} options={services.map((s) => [s, DEBRID[s]] as [string, string])} onChange={(v) => set({ debridService: v })} /></Field>
        <Field label={t('debrid_only')} hint={t('debrid_only_hint')}><Toggle on={!!p.debridOnly} onChange={(v) => set({ debridOnly: v })} /></Field>
      </>) : null}
    </Section>
  );
}
const DEBRID: Record<string, string> = { realdebrid: 'Real-Debrid', torbox: 'TorBox', premiumize: 'Premiumize' };

// optional keys: each makes something better; without them the built-in ones (or keyless sources) are used
const KEYS: { id: string; name: string; hint: Key; url: string }[] = [
  { id: 'tmdb', name: 'TMDB', hint: 'key_tmdb', url: 'https://www.themoviedb.org/settings/api' },
  { id: 'rpdb', name: 'RPDB', hint: 'key_rpdb', url: 'https://ratingposterdb.com' },
  { id: 'fanart', name: 'Fanart.tv', hint: 'key_fanart', url: 'https://fanart.tv/get-an-api-key' },
  { id: 'mdblist', name: 'MDBList', hint: 'key_mdblist', url: 'https://mdblist.com/preferences' },
  { id: 'opensubtitles', name: 'OpenSubtitles', hint: 'key_opensubtitles', url: 'https://www.opensubtitles.com/en/consumers' },
  { id: 'trakt', name: 'Trakt (client id)', hint: 'key_trakt', url: 'https://trakt.tv/oauth/applications' },
  { id: 'realdebrid', name: 'Real-Debrid', hint: 'key_debrid', url: 'https://real-debrid.com/apitoken' },
  { id: 'torbox', name: 'TorBox', hint: 'key_debrid', url: 'https://torbox.app/settings' },
  { id: 'premiumize', name: 'Premiumize', hint: 'key_debrid', url: 'https://www.premiumize.me/account' },
];
export function KeysSection() {
  const t = useT(), qc = useQueryClient();
  const q = useQuery({ queryKey: ['keys'], queryFn: () => cin<{ user: Record<string, string>; builtIn: Record<string, boolean> }>('keys') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setDraft(q.data.user); }, [q.data]);
  const save = async (id: string) => { await cin('keys-set', { [id]: draft[id] || '' }); qc.invalidateQueries(); };
  return (
    <Section title={t('keys')} sub={t('keys_sub')}>
      <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-acc/12 px-4 py-3 text-xs font-medium text-acc ring-1 ring-acc/30">
        <Icon n="sparkle" s={16} />
        <span>{t('keys_skip_note')}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {KEYS.map((k) => (
          <div key={k.id} className="rounded-xl bg-bg1 p-3.5 ring-1 ring-line">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-semibold">{k.name}</span>
              {q.data?.builtIn[k.id] ? <span className="rounded bg-acc/15 px-1.5 text-[11px] text-acc">{t('built_in')}</span> : null}
              <span className="flex-1" />
              <button onClick={() => invoke('open', k.url)} className="text-xs text-fg3 hover:text-acc">{t('get_key')}</button>
            </div>
            <p className="mb-2 text-xs text-fg2">{t(k.hint)}</p>
            <input type="password" dir="ltr" value={draft[k.id] || ''} onChange={(e) => setDraft({ ...draft, [k.id]: e.target.value })} onBlur={() => save(k.id)}
              placeholder={q.data?.builtIn[k.id] ? t('using_built_in') : '••••••••'} className="w-full rounded-lg bg-white/6 px-3 py-2 font-mono text-sm ring-1 ring-line focus:ring-acc" />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function CommunitySection() {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const me = useSocialMe().data;
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [shareHistory, setShareHistory] = useState<'friends' | 'none'>('friends');
  const [newListName, setNewListName] = useState('');
  const [addTarget, setAddTarget] = useState<'favorites' | string>('favorites');
  const [pickQ, setPickQ] = useState('');
  const searchQ = useSearch(pickQ);
  const searchHits = (searchQ.data || []).flatMap((g) => g.metas).slice(0, 6);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName || '');
    setHandle(me.handle || '');
    setBio(me.bio || '');
    setShareHistory(me.shareHistory || 'friends');
  }, [me?.id, me?.displayName, me?.handle, me?.bio, me?.shareHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;

  const savePatch = async (patch: Record<string, unknown>, quiet = false) => {
    try {
      await social('me-set', patch);
      await qc.invalidateQueries({ queryKey: ['social-me'] });
      await qc.invalidateQueries({ queryKey: ['social-profile'] });
      if (!quiet) toast(t('profile_saved'));
    } catch (err) {
      toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    savePatch({ displayName, handle, bio, shareHistory });
  };

  const toSocialTitle = (p: Preview): SocialTitle => ({ id: p.id, type: p.type || 'movie', name: p.name, poster: p.poster || null, year: p.year || null });

  const addItemTo = (p: Preview) => {
    const item = toSocialTitle(p);
    if (addTarget === 'favorites') {
      const next = [item, ...me.favorites.filter((x) => x.id !== item.id)].slice(0, 24);
      savePatch({ favorites: next });
    } else {
      const nextLists = me.lists.map((l) => (l.id === addTarget ? { ...l, items: [item, ...l.items.filter((x) => x.id !== item.id)].slice(0, 40) } : l));
      savePatch({ lists: nextLists });
    }
    setPickQ('');
  };

  const removeFav = (id: string) => savePatch({ favorites: me.favorites.filter((x) => x.id !== id) }, true);
  const createList = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newListName.trim().slice(0, 48);
    if (!clean) return;
    const list: CustomList = { id: `list-${Date.now()}`, name: clean, items: [] };
    savePatch({ lists: [...me.lists, list] });
    setNewListName('');
    setAddTarget(list.id);
  };
  const deleteList = (id: string) => savePatch({ lists: me.lists.filter((l) => l.id !== id) }, true);
  const moveList = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= me.lists.length) return;
    const next = [...me.lists];
    const [picked] = next.splice(idx, 1);
    next.splice(to, 0, picked);
    savePatch({ lists: next }, true);
  };
  const removeFromList = (listId: string, itemId: string) => {
    savePatch({ lists: me.lists.map((l) => (l.id === listId ? { ...l, items: l.items.filter((x) => x.id !== itemId) } : l)) }, true);
  };

  return (
    <Section title={t('community_profile')} sub={t('community_profile_sub')}>
      <form onSubmit={saveProfile} className="mb-6 space-y-4 rounded-2xl bg-bg1 p-5 ring-1 ring-line">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-fg2">{t('display_name')}</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} placeholder={t('display_name_ph')}
              className="w-full rounded-xl bg-white/6 px-3.5 py-2 ring-1 ring-line focus:ring-acc" />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-fg2">{t('handle_label')}</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} dir="ltr" maxLength={24} placeholder={t('handle_ph')}
              className="w-full rounded-xl bg-white/6 px-3.5 py-2 font-mono ring-1 ring-line focus:ring-acc" />
          </label>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-fg2">{t('bio_label')}</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} rows={2} placeholder={t('bio_ph')}
            className="w-full rounded-xl bg-white/6 px-3.5 py-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-acc" />
        </label>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-sm text-fg2">{t('share_history_label')}:</span>
          <Seg value={shareHistory} options={[['friends', t('share_friends')], ['none', t('share_none')]]} onChange={(v) => setShareHistory(v)} />
          <span className="flex-1" />
          <button type="button" onClick={() => nav.open({ kind: 'friend', id: me.id })} className="rounded-full bg-white/8 px-4 py-2 text-sm hover:bg-white/15">
            {t('view_profile')}
          </button>
          <button type="submit" className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg hover:bg-acc hover:text-acc-ink">
            {t('save_profile')}
          </button>
        </div>
      </form>

      {/* Showcased favorites & Custom Lists picker */}
      <div className="space-y-5 rounded-2xl bg-bg1 p-5 ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-2">
          <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder={t('add_title_ph')}
            className="min-w-[200px] flex-1 rounded-full bg-white/6 px-4 py-2 text-sm ring-1 ring-line focus:ring-acc" />
          <select value={addTarget} onChange={(e) => setAddTarget(e.target.value)}
            className="rounded-full bg-bg2 px-3.5 py-2 text-xs text-fg ring-1 ring-line">
            <option value="favorites">{t('showcased_favs')}</option>
            {me.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {searchHits.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {searchHits.map((it) => (
              <button key={`${it.type}-${it.id}`} type="button" onClick={() => addItemTo(it)}
                className="flex items-center gap-2.5 rounded-xl bg-bg2 p-2 text-start ring-1 ring-line hover:ring-acc">
                <Img srcs={[it.poster]} className="h-12 w-8 flex-none rounded object-cover" fallback={<div className="h-12 w-8 rounded bg-bg3" />} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{it.name}</span>
                <Icon n="plus" s={14} className="text-acc" />
              </button>
            ))}
          </div>
        ) : null}

        <div>
          <h3 className="mb-2.5 text-sm font-semibold text-fg2">{t('showcased_favs')} ({me.favorites.length})</h3>
          {me.favorites.length ? (
            <div className="flex flex-wrap gap-2.5">
              {me.favorites.map((f) => (
                <div key={f.id} className="group relative w-24">
                  <Img srcs={[f.poster]} className="aspect-[2/3] w-full rounded-lg bg-bg2 object-cover ring-1 ring-line" />
                  <button type="button" aria-label={t('remove')} onClick={() => removeFav(f.id)}
                    className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-bg3 text-fg ring-1 ring-line opacity-0 group-hover:opacity-100"><Icon n="x" s={11} /></button>
                  <div className="mt-1 truncate text-[11px] text-fg2">{f.name}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-fg3">{t('empty_favs')}</p>}
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg2">{t('custom_lists')} ({me.lists.length})</h3>
            <form onSubmit={createList} className="flex items-center gap-2">
              <input value={newListName} onChange={(e) => setNewListName(e.target.value)} maxLength={48} placeholder={t('new_list_ph')}
                className="rounded-full bg-white/6 px-3.5 py-1.5 text-xs ring-1 ring-line focus:ring-acc" />
              <button type="submit" className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink">{t('create_list')}</button>
            </form>
          </div>
          <div className="space-y-3">
            {me.lists.map((l, idx) => (
              <div key={l.id} className="rounded-xl bg-bg2 p-3 ring-1 ring-line">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold text-sm">{l.name}</span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-fg3">{l.items.length}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => moveList(idx, -1)} className="rounded px-2 py-0.5 text-xs text-fg3 hover:bg-white/8">{t('move_up')}</button>
                  <button type="button" onClick={() => moveList(idx, 1)} className="rounded px-2 py-0.5 text-xs text-fg3 hover:bg-white/8">{t('move_down')}</button>
                  <button type="button" onClick={() => deleteList(l.id)} className="rounded px-2 py-0.5 text-xs text-fg3 hover:text-red-300">{t('remove')}</button>
                </div>
                {l.items.length ? (
                  <div className="flex flex-wrap gap-2">
                    {l.items.map((it) => (
                      <div key={it.id} className="group relative w-20">
                        <Img srcs={[it.poster]} className="aspect-[2/3] w-full rounded bg-bg3 object-cover" />
                        <button type="button" onClick={() => removeFromList(l.id, it.id)}
                          className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-bg3 text-fg ring-1 ring-line opacity-0 group-hover:opacity-100"><Icon n="x" s={10} /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function Profile({ active = true }: { active?: boolean }) {
  const t = useT();
  const set = useSetPrefs();
  return (
    <div className="h-full overflow-y-auto px-12 pb-24 pt-28">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <h1 className="text-3xl font-bold">{t('profile')}</h1>
          <span className="flex-1" />
          <button onClick={() => set({ cinemaOnboarded: false })} className="rounded-full bg-white/8 px-4 py-2 text-sm hover:bg-white/15">{t('run_setup')}</button>
        </div>
        <ProfilesSection />
        <CommunitySection />
        <LookSection active={active} />
        <AccountsSection />
        <PlaybackSection />
        <KeysSection />
      </div>
    </div>
  );
}

// ---- small controls
function Card({ logo, color, title, sub, children }: { logo: string; color: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-bg1 p-4 ring-1 ring-line">
      <span className="grid size-12 flex-none place-items-center rounded-xl text-xl font-bold text-white" style={{ background: color }}>{logo}</span>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="block text-xs text-fg2">{sub}</span></span>
      <span className="flex flex-none gap-2">{children}</span>
    </div>
  );
}
function Pill({ children, onClick, ghost, busy }: { children: ReactNode; onClick: () => void; ghost?: boolean; busy?: boolean }) {
  return <button onClick={onClick} disabled={busy} className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${ghost ? 'text-fg2 hover:bg-white/8 hover:text-fg' : 'bg-fg text-bg hover:bg-acc hover:text-acc-ink'}`}>{busy ? '…' : children}</button>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-3.5">
      <span className="min-w-0 flex-1"><span className="block">{label}</span>{hint ? <span className="block text-xs text-fg3">{hint}</span> : null}</span>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-7 w-12 flex-none rounded-full transition ${on ? 'bg-acc' : 'bg-white/15'}`}>
      <span className={`absolute top-1 size-5 rounded-full bg-white transition-all ${on ? 'start-6' : 'start-1'}`} />
    </button>
  );
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="flex flex-none rounded-full bg-white/6 p-1">
      {options.map(([v, l]) => <button key={String(v)} onClick={() => onChange(v)} className={`rounded-full px-3.5 py-1 text-sm transition ${value === v ? 'bg-fg text-bg' : 'text-fg2 hover:text-fg'}`}>{l}</button>)}
    </span>
  );
}
