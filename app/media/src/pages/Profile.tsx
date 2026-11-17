import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cin, invoke, useCaps } from '../api';
import { useHost, useT } from '../host';
import type { Key } from '../i18n';
import { Icon } from '../ui/Icon';

export interface Look { avatar: string | null; accent: string | null; theme: string }
export interface Prefs {
  profile: string; look: Look; profiles: ({ name: string } & Look)[];
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
  return async (patch: Partial<Omit<Prefs, 'look'>> & { look?: Partial<Look> }) => { await cin('prefs-set', patch); await qc.invalidateQueries({ queryKey: ['prefs'] }); };
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

// this profile's picture, colour and theme (applied live)
export function LookSection() {
  const t = useT(), set = useSetPrefs();
  const p = usePrefs().data;
  if (!p) return null;
  const pick = async (f?: File | null) => { if (f) set({ look: { avatar: await shrink(f) } }); };
  return (
    <Section title={t('look')} sub={t('look_sub')}>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Avatar look={p.look} name={p.profile} size={64} />
        <div className="ms-3 flex max-w-xl flex-wrap gap-1.5">
          {EMOJI.map((e) => <button key={e} onClick={() => set({ look: { avatar: e } })} className={`grid size-10 place-items-center rounded-full text-xl transition ${p.look.avatar === e ? 'bg-acc/25 ring-2 ring-acc' : 'bg-white/6 hover:bg-white/12'}`}>{e}</button>)}
          <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-white/6 px-4 text-sm hover:bg-white/12">
            <Icon n="camera" s={16} />{t('upload_pic')}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {ACCENTS.map((c) => (
          <button key={c} aria-label={c} onClick={() => set({ look: { accent: c } })} className={`size-9 rounded-full ring-offset-2 ring-offset-bg transition ${(p.look.accent || ACCENTS[0]) === c ? 'ring-2 ring-fg' : 'hover:scale-110'}`} style={{ background: c }} />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
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
    </Section>
  );
}

// Stremio account, Letterboxd export
export function AccountsSection() {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const caps = useCaps().data;
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    try { const m = await fn(); if (m) toast(m); } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
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
  { id: 'mdblist', name: 'MDBList', hint: 'key_mdblist', url: 'https://mdblist.com/preferences' },
  { id: 'fanart', name: 'Fanart.tv', hint: 'key_fanart', url: 'https://fanart.tv/get-an-api-key' },
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

export function Profile() {
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
        <LookSection />
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
