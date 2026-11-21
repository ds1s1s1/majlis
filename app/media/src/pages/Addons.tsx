import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, invoke, STREAMING_BRANDS, useInstalled, useStore, useStoreCategories, type AddonHealthSnapshot, type Installed, type Manifest, type StoreAddon } from '../api';
import { bus, useHost, useT } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { ServiceLogo } from '../ui/ServiceLogos';
import { Chips } from '../ui/Grid';

const configureUrl = (url: string) => url.replace(/\/manifest\.json$/, '/configure');
const STREAMING_CATALOGS_URL = 'https://catalog.ers.pw/manifest.json';
const UI_ADULT_RE = /(?:^|[^a-z0-9])(nsfw|porn|porno|pornhub|xvideos|xnxx|xhamster|redtube|youporn|spankbang|eporner|brazzers|chaturbate|onlyfans|xxx|hentai|hanime|nhentai|erotica|erotic|jav|18\+|21\+)(?:$|[^a-z0-9])/i;
const isSafeStoreAddon = (a: StoreAddon) => {
  const raw = a as StoreAddon & { nsfw?: boolean; adult?: boolean };
  if (raw.nsfw || raw.adult || a.manifest?.behaviorHints?.adult) return false;
  if ((a.categories || []).some((c) => /nsfw|adult|18\+|xxx|porn|hentai/i.test(c))) return false;
  const hay = [a.slug, a.manifestUrl, a.manifest?.id, a.manifest?.name, a.manifest?.description].filter(Boolean).join(' ');
  return !UI_ADULT_RE.test(hay);
};

export function DeepLinkAddonModal() {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const [pending, setPending] = useState<{ url: string; manifest?: Manifest | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onMsg = (m: any) => {
      if ((m?.type === 'cin:deeplink-addon' || m?.type === 'deeplink-addon') && m.url) {
        setPending({ url: String(m.url), manifest: m.manifest || null });
      }
    };
    const off = window.majlis?.on?.(onMsg);
    const onBus = (e: Event) => {
      const d = (e as CustomEvent<{ url: string; manifest?: Manifest | null }>).detail;
      if (d?.url) setPending(d);
    };
    bus.addEventListener('deeplink-addon', onBus);
    return () => { off?.(); bus.removeEventListener('deeplink-addon', onBus); };
  }, []);

  if (!pending) return null;
  const confirmInstall = async () => {
    setBusy(true);
    try {
      const m = await cin<{ name: string }>('addon-install', { url: pending.url });
      toast(t('addon_added', { name: m.name }));
      qc.invalidateQueries({ queryKey: ['addons'] });
      qc.invalidateQueries({ queryKey: ['rows'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
      setPending(null);
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={() => !busy && setPending(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-6 backdrop-blur-md fade-in">
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-bg1 p-6 ring-1 ring-white/15 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-2xl bg-acc/15 text-acc">
            {pending.manifest?.logo ? <Img srcs={[pending.manifest.logo]} className="h-full w-full object-contain p-1.5" /> : <Icon n="puzzle" s={24} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{t('deeplink_install_title')}</h2>
            <p className="text-xs text-fg2">{t('deeplink_install_sub')}</p>
          </div>
        </div>
        {pending.manifest?.name ? <div className="mb-1 font-semibold">{pending.manifest.name}</div> : null}
        {pending.manifest?.description ? <p dir="auto" className="clamp-2 mb-3 text-xs text-fg2">{pending.manifest.description}</p> : null}
        <div dir="ltr" className="mb-6 break-all rounded-xl bg-black/40 p-3 font-mono text-xs text-fg2 ring-1 ring-line">{pending.url}</div>
        <div className="flex justify-end gap-3">
          <button onClick={() => setPending(null)} disabled={busy} className="rounded-full bg-white/8 px-5 py-2 text-sm font-semibold text-fg2 hover:bg-white/15 hover:text-fg">{t('cancel')}</button>
          <button onClick={confirmInstall} disabled={busy} className="rounded-full bg-acc px-6 py-2 text-sm font-semibold text-acc-ink hover:brightness-110 disabled:opacity-50">
            {busy ? '…' : t('install')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Addons() {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const installed = useInstalled();
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ url: string; manifest?: Manifest | null; installed?: boolean; configureUrl?: string | null; dead?: boolean; error?: string; enabled?: boolean; latencyMs?: number | null; health?: AddonHealthSnapshot } | null>(null);
  const [pinging, setPinging] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSearch(text.trim()), 350); return () => clearTimeout(id); }, [text]);
  const store = useStore({ search: search || undefined, category: category || undefined });
  const cats = useStoreCategories();
  const have = new Set((installed.data || []).map((x) => x.url));
  const changed = () => { qc.invalidateQueries({ queryKey: ['addons'] }); qc.invalidateQueries({ queryKey: ['rows'] }); qc.invalidateQueries({ queryKey: ['catalog'] }); };

  const install = async (url: string) => {
    try { const m = await cin<{ name: string }>('addon-install', { url }); toast(t('addon_added', { name: m.name })); changed(); }
    catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const remove = async (a: Installed) => { await cin('addon-remove', { url: a.url }); changed(); };
  const move = async (a: Installed, to: number) => { await cin('addon-move', { url: a.url, to }); changed(); };
  const toggleAddon = async (a: Installed) => { await cin('addon-toggle', { url: a.url, enabled: a.enabled === false }); changed(); };
  const refreshAddon = async (a: Installed) => {
    try { await cin('addon-refresh', { url: a.url }); toast(t('addon_refresh')); changed(); }
    catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const pingAll = async () => {
    setPinging(true);
    try {
      const r = await cin<{ checked?: number }>('addons-ping');
      changed();
      toast(t('addon_ping_done', { n: r?.checked ?? (installed.data?.length || 0) }));
    } catch {} finally { setPinging(false); }
  };
  const installedList = installed.data || [];
  const healthCounts = installedList.reduce((acc, a) => {
    const st = a.health?.status || (a.dead || a.error ? 'down' : (a.latencyMs != null && a.latencyMs > 1200 ? 'slow' : 'up'));
    acc[st]++;
    return acc;
  }, { up: 0, slow: 0, down: 0 });

  const safeStoreAddons = useMemo(() => (store.data?.addons || []).filter(isSafeStoreAddon), [store.data?.addons]);
  const safeCategories = useMemo(() => (cats.data || []).filter((c) => !/nsfw|adult|18\+|xxx|porn|hentai/i.test(`${c.slug} ${c.name}`)), [cats.data]);

  const heroAddon = useMemo(() => {
    return safeStoreAddons.find((a) => !have.has(a.manifestUrl) && a.manifest?.background) || safeStoreAddons.find((a) => !have.has(a.manifestUrl)) || safeStoreAddons[0] || null;
  }, [safeStoreAddons, have]);

  const streamingInstalled = have.has(STREAMING_CATALOGS_URL) || (installed.data || []).some((x) => /streaming-catalogs|catalog\.ers\.pw|cyberflix/i.test(x.url) || /streaming.?catalogs/i.test(x.manifest?.id || ''));

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <h1 className="mb-6 text-3xl font-bold">{t('addons')}</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (link.trim()) { install(link.trim()); setLink(''); } }}
        className="mb-8 flex max-w-3xl items-center gap-3 rounded-full bg-white/6 py-1.5 pe-1.5 ps-5 ring-1 ring-line focus-within:ring-2 focus-within:ring-acc">
        <Icon n="link" s={18} className="text-fg3" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('addon_link_ph')} dir="ltr" className="flex-1 text-sm placeholder:text-fg3" />
        <button className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('install')}</button>
      </form>

      {/* Featured Streaming Catalogs section */}
      <section className="mb-10 flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-gradient-to-r from-bg2 via-bg1 to-bg2 p-6 ring-1 ring-white/10">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-acc/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-acc">streaming-catalogs</span>
            <h2 className="text-lg font-bold">{t('streaming_catalogs')}</h2>
          </div>
          <p className="mb-4 text-sm text-fg2">{t('streaming_catalogs_sub')}</p>
          <div className="flex flex-wrap gap-2">
            {STREAMING_BRANDS.map((p) => (
              <span key={p.id} className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-[#12100e] px-2.5 text-[#ebe3d5]">
                <ServiceLogo service={p.key} name={p.name} compact />
              </span>
            ))}
          </div>
        </div>
        <div className="flex-none">
          {streamingInstalled ? (
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-fg2">
              <Icon n="check" s={16} />{t('installed')}
            </span>
          ) : (
            <button onClick={() => install(STREAMING_CATALOGS_URL)} className="rounded-full bg-acc px-6 py-2.5 text-sm font-semibold text-acc-ink transition hover:brightness-110">
              {t('install')}
            </button>
          )}
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('installed')}</h2>
        {installedList.length ? (
          <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-fg2">
            {t('addon_health_summary', healthCounts)}
          </span>
        ) : null}
        <span className="flex-1" />
        {installedList.length ? (
          <button
            type="button"
            disabled={pinging}
            onClick={pingAll}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-acc hover:text-acc-ink disabled:opacity-50"
          >
            <Icon n="refresh" s={14} className={pinging ? 'animate-spin' : ''} />
            {pinging ? t('addon_pinging') : t('addon_ping_all')}
          </button>
        ) : null}
      </div>
      <div className="mb-12 grid grid-cols-1 gap-2">
        {(installed.data || []).map((a, i, all) => {
          const st = a.health?.status || (a.dead || a.error ? 'down' : (a.latencyMs != null && a.latencyMs > 1200 ? 'slow' : 'up'));
          const healthy = !a.dead && !a.error && a.enabled !== false && st !== 'down';
          const msVal = a.health?.avgMs ?? a.latencyMs;
          const dotCls = st === 'down' ? 'bg-red-400' : a.enabled === false || st === 'slow' ? 'bg-amber-400' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]';
          const pillCls = st === 'down' ? 'bg-red-500/15 text-red-300' : st === 'slow' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/12 text-emerald-300';
          return (
          <div key={a.url} className="flex items-center gap-4 rounded-xl bg-bg1 p-3 ring-1 ring-line">
            <span className="w-6 text-center font-mono text-sm text-fg3">{i + 1}</span>
            <span className="grid size-11 flex-none place-items-center overflow-hidden rounded-lg bg-bg3">
              <Img srcs={[a.manifest?.logo]} className="h-full w-full object-contain p-1" fallback={<Icon n="puzzle" s={20} className="text-fg3" />} />
            </span>
            <button
              type="button"
              onClick={() => setDetailTarget({ url: a.url, manifest: a.manifest, installed: true, dead: a.dead, error: a.error, enabled: a.enabled, latencyMs: a.latencyMs, health: a.health })}
              className="min-w-0 flex-1 text-start group"
            >
              <span className="flex items-center gap-2">
                <span className={`size-2 flex-none rounded-full ${dotCls}`} title={healthy ? t('addon_online') : t('addon_offline')} />
                <span className="truncate font-semibold group-hover:text-acc">{a.manifest?.name || a.url}</span>
                {a.manifest?.version ? <span className="font-mono text-[11px] text-fg3">v{a.manifest.version}</span> : null}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pillCls}`}>
                  {t(`addon_status_${st}` as 'addon_status_up')}{msVal != null ? ` · ${msVal}ms` : ''}
                </span>
              </span>
              <span dir="auto" className="block truncate text-xs text-fg2">{a.error ? `⚠ ${a.error}` : a.manifest?.description}</span>
            </button>
            <span className="hidden md:flex gap-1">{(a.manifest?.types || []).slice(0, 4).map((x) => <span key={x} className="rounded-md bg-white/6 px-1.5 py-0.5 text-[11px] text-fg2">{x}</span>)}</span>
            <button onClick={() => toggleAddon(a)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${a.enabled === false ? 'bg-white/6 text-fg3' : 'bg-emerald-500/15 text-emerald-300'}`}>
              {a.enabled === false ? t('addon_disabled') : t('addon_enabled')}
            </button>
            <IconBtn label={t('addon_details')} icon="info" onClick={() => setDetailTarget({ url: a.url, manifest: a.manifest, installed: true, dead: a.dead, error: a.error, enabled: a.enabled, latencyMs: a.latencyMs, health: a.health })} />
            <IconBtn label={t('addon_refresh')} icon="refresh" onClick={() => refreshAddon(a)} />
            <IconBtn label={t('move_up')} icon="chevl" rot onClick={() => move(a, i - 1)} disabled={i === 0} />
            <IconBtn label={t('move_down')} icon="chevr" rot onClick={() => move(a, i + 1)} disabled={i === all.length - 1} />
            {a.manifest?.behaviorHints?.configurable ? <IconBtn label={t('configure')} icon="sliders" onClick={() => setDetailTarget({ url: a.url, manifest: a.manifest, installed: true, dead: a.dead, error: a.error, enabled: a.enabled, latencyMs: a.latencyMs, health: a.health })} /> : null}
            <IconBtn label={t('remove')} icon="x" onClick={() => remove(a)} />
          </div>
          );
        })}
      </div>

      {/* Addon Store Trending Hero */}
      {heroAddon && !search && !category ? (
        <StoreHero
          a={heroAddon}
          installed={have.has(heroAddon.manifestUrl)}
          onInstall={() => install(heroAddon.manifestUrl)}
          onDetails={() => setDetailTarget({ url: heroAddon.manifestUrl, manifest: heroAddon.manifest, installed: have.has(heroAddon.manifestUrl), configureUrl: heroAddon.configureUrl })}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('addon_store')}</h2>
        <span className="text-xs text-fg3">stremio-addons.net</span>
        <span className="flex-1" />
        <label className="flex w-72 items-center gap-2 rounded-full bg-white/6 px-4 py-2 ring-1 ring-line focus-within:ring-acc">
          <Icon n="search" s={16} className="text-fg3" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search')} className="flex-1 text-sm" />
        </label>
      </div>
      <div className="mb-5"><Chips value={category} onChange={setCategory} options={[{ id: null, label: t('all') }, ...safeCategories.map((c) => ({ id: c.slug, label: c.name }))]} /></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {store.isLoading ? Array.from({ length: 9 }, (_, i) => <div key={i} className="skel h-44 rounded-2xl" />) : null}
        {safeStoreAddons.map((a) => (
          <StoreCard
            key={a.slug}
            a={a}
            installed={have.has(a.manifestUrl)}
            onInstall={() => install(a.manifestUrl)}
            onDetails={() => setDetailTarget({ url: a.manifestUrl, manifest: a.manifest, installed: have.has(a.manifestUrl), configureUrl: a.configureUrl })}
          />
        ))}
      </div>

      {detailTarget ? (
        <AddonDetailsModal
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          onInstallUrl={async (newUrl, replaceOld) => {
            await install(newUrl);
            if (replaceOld && replaceOld !== newUrl && have.has(replaceOld)) {
              await cin('addon-remove', { url: replaceOld }).catch(() => {});
              changed();
            }
            setDetailTarget(null);
          }}
          onRefresh={async (u) => {
            const m = await cin<Manifest>('addon-refresh', { url: u });
            changed();
            return m;
          }}
        />
      ) : null}
    </div>
  );
}

function StoreHero({ a, installed, onInstall, onDetails }: { a: StoreAddon; installed: boolean; onInstall: () => void; onDetails: () => void }) {
  const t = useT();
  const m = a.manifest;
  const needsSetup = !!m?.behaviorHints?.configurationRequired;
  return (
    <section className="relative mb-10 overflow-hidden rounded-3xl bg-bg2 p-8 ring-1 ring-white/12">
      {m?.background ? <Img srcs={[m.background]} className="absolute inset-0 h-full w-full object-cover opacity-35" /> : null}
      <div className="shade-s absolute inset-0" />
      <div className="shade-b absolute inset-0" />
      <div className="relative z-10 flex flex-col gap-4 max-w-2xl">
        <span className="flex w-fit items-center gap-1.5 rounded-full bg-acc/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-acc">
          <Icon n="trending" s={14} />{t('trending_addon')}
        </span>
        <div className="flex items-center gap-4">
          <span className="grid size-16 flex-none place-items-center overflow-hidden rounded-2xl bg-bg3 ring-1 ring-white/10">
            <Img srcs={[m?.logo]} className="h-full w-full object-contain p-1.5" fallback={<Icon n="puzzle" s={28} className="text-fg3" />} />
          </span>
          <div>
            <h3 className="text-2xl font-bold">{m?.name || a.slug}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg2">
              <span className="font-mono font-semibold text-[#f5c518]">★ {a.stars}</span>
              {a.categories.map((c) => <span key={c} className="rounded bg-white/10 px-2 py-0.5">{c}</span>)}
            </div>
          </div>
        </div>
        {m?.description ? <p dir="auto" className="clamp-2 text-sm leading-relaxed text-fg2">{m.description}</p> : null}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {installed ? (
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-fg2"><Icon n="check" s={16} />{t('installed')}</span>
          ) : needsSetup ? (
            <button onClick={onDetails} className="rounded-full bg-white/15 px-6 py-2.5 text-sm font-semibold hover:bg-white/25">{t('configure_first')}</button>
          ) : (
            <button onClick={onInstall} className="rounded-full bg-fg px-7 py-2.5 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">{t('install')}</button>
          )}
          {!needsSetup && a.configurable ? (
            <button onClick={onDetails} className="rounded-full bg-white/10 px-5 py-2.5 text-sm text-fg2 hover:bg-white/20 hover:text-fg">{t('configure')}</button>
          ) : null}
          <button onClick={onDetails} className="rounded-full bg-white/8 px-4 py-2.5 text-sm text-fg2 hover:bg-white/15 hover:text-fg">{t('addon_details')}</button>
        </div>
      </div>
    </section>
  );
}

function StoreCard({ a, installed, onInstall, onDetails }: { a: StoreAddon; installed: boolean; onInstall: () => void; onDetails: () => void }) {
  const t = useT();
  const m = a.manifest;
  const needsSetup = !!m?.behaviorHints?.configurationRequired;
  return (
    <div className="flex flex-col rounded-2xl bg-bg1 p-4 ring-1 ring-line">
      <button type="button" onClick={onDetails} className="mb-3 flex items-center gap-3 text-start group">
        <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-xl bg-bg3">
          <Img srcs={[m?.logo]} className="h-full w-full object-contain p-1" fallback={<Icon n="puzzle" s={22} className="text-fg3" />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold group-hover:text-acc">{m?.name || a.slug}</span>
          <span className="block text-xs text-fg3"><span className="text-[#f5c518]">★</span> {a.stars} · {a.categories.slice(0, 2).join(' · ')}</span>
        </span>
      </button>
      <p dir="auto" className="clamp-3 mb-4 flex-1 text-[13px] leading-relaxed text-fg2">{m?.description}</p>
      <div className="flex gap-2">
        {installed ? <span className="flex items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-sm text-fg2"><Icon n="check" s={16} />{t('installed')}</span>
          : needsSetup ? <button onClick={onDetails} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">{t('configure_first')}</button>
          : <button onClick={onInstall} className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('install')}</button>}
        <button onClick={onDetails} className="ms-auto rounded-full px-3 py-2 text-xs text-fg2 hover:bg-white/10 hover:text-fg">{t('addon_details')}</button>
      </div>
    </div>
  );
}

function AddonDetailsModal({ target, onClose, onInstallUrl, onRefresh }: {
  target: { url: string; manifest?: Manifest | null; installed?: boolean; configureUrl?: string | null; dead?: boolean; error?: string; enabled?: boolean; latencyMs?: number | null; health?: AddonHealthSnapshot };
  onClose: () => void;
  onInstallUrl: (url: string, replaceOld?: string) => Promise<void>;
  onRefresh: (url: string) => Promise<Manifest>;
}) {
  const t = useT(), { toast } = useHost();
  const [manifest, setManifest] = useState<Manifest | null | undefined>(target.manifest);
  const [cfgInput, setCfgInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  const m = manifest;
  const resources = (m?.resources || []).map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean);
  const needsSetup = !!m?.behaviorHints?.configurationRequired;
  const configurable = needsSetup || !!m?.behaviorHints?.configurable || !!target.configureUrl;
  const openCfgUrl = target.configureUrl || configureUrl(target.url);
  const healthy = target.installed && !target.dead && !target.error && target.enabled !== false;

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-md fade-in">
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-3xl bg-bg1 p-6 ring-1 ring-white/15 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-14 flex-none place-items-center overflow-hidden rounded-2xl bg-bg3 ring-1 ring-white/10">
            <Img srcs={[m?.logo]} className="h-full w-full object-contain p-1.5" fallback={<Icon n="puzzle" s={26} className="text-fg3" />} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{m?.name || target.url}</h2>
              {m?.version ? <span dir="ltr" className="rounded-md bg-white/8 px-2 py-0.5 font-mono text-xs text-fg2">v{m.version}</span> : null}
              {target.installed ? (
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${healthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                  {healthy ? (target.latencyMs != null ? t('addon_healthy', { ms: target.latencyMs }) : t('addon_online')) : t('addon_offline')}
                </span>
              ) : null}
              {target.health?.avgMs != null ? (
                <span dir="ltr" className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-[11px] text-fg2">
                  {t('addon_avg_ms', { ms: target.health.avgMs })}
                </span>
              ) : null}
              {target.health?.p90Ms != null ? (
                <span dir="ltr" className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-[11px] text-fg2">
                  {t('addon_p90_ms', { ms: target.health.p90Ms })}
                </span>
              ) : null}
            </div>
            {(target.health?.lastError || target.error) ? (
              <p dir="auto" className="mt-1 rounded-lg bg-red-500/10 px-2.5 py-1 text-xs text-red-300">
                {target.health?.lastError || target.error}
              </p>
            ) : null}
            {m?.description ? <p dir="auto" className="mt-1 text-xs leading-relaxed text-fg2">{m.description}</p> : null}
          </div>
          <button onClick={onClose} className="grid size-8 flex-none place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg">
            <Icon n="x" s={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-black/35 px-3 py-2 ring-1 ring-line">
          <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg2">{target.url}</span>
          <button
            type="button"
            onClick={() => { invoke('copy', target.url).catch(() => {}); toast(t('ctx_copied')); }}
            className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/20"
          >
            <Icon n="copy" s={12} />
          </button>
        </div>

        {resources.length ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-fg2">{t('addon_resources')}</div>
            <div className="flex flex-wrap gap-1.5">
              {resources.map((r) => <span key={r} className="rounded-md bg-acc/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-acc">{r}</span>)}
              {(m?.types || []).map((tp) => <span key={tp} className="rounded-md bg-white/8 px-2 py-0.5 text-[11px] text-fg2">{tp}</span>)}
            </div>
          </div>
        ) : null}

        {m?.idPrefixes?.length ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-fg2">{t('addon_prefixes')}</div>
            <div dir="ltr" className="flex flex-wrap gap-1.5">
              {m.idPrefixes.slice(0, 12).map((p) => <span key={p} className="rounded bg-white/6 px-2 py-0.5 font-mono text-[11px] text-fg3">{p}</span>)}
            </div>
          </div>
        ) : null}

        {m?.catalogs?.length ? (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-fg2">{t('addon_catalogs', { n: m.catalogs.length })}</div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {m.catalogs.slice(0, 30).map((c, idx) => (
                <span key={`${c.type}-${c.id}-${idx}`} className="rounded-lg bg-white/6 px-2.5 py-1 text-[11px] text-fg2">
                  {c.name || c.id} · <span className="font-mono text-fg3">{c.type}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {configurable ? (
          <div className="space-y-2.5 rounded-2xl border border-acc/30 bg-acc/5 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-acc">{needsSetup ? t('configure_first') : t('configure')}</span>
              <button
                type="button"
                onClick={() => invoke('open', openCfgUrl)}
                className="rounded-full bg-acc px-4 py-1.5 text-xs font-bold text-acc-ink hover:brightness-110"
              >
                {t('open_page')}
              </button>
            </div>
            <p className="text-[11px] text-fg2">{t('addon_config_paste_hint')}</p>
            <div className="flex gap-2">
              <input
                dir="ltr"
                value={cfgInput}
                onChange={(e) => setCfgInput(e.target.value)}
                placeholder={t('addon_config_url_ph')}
                className="min-w-0 flex-1 rounded-xl bg-black/45 px-3 py-1.5 font-mono text-xs ring-1 ring-white/15 outline-none focus:ring-acc"
              />
              <button
                type="button"
                disabled={busy || !cfgInput.trim()}
                onClick={async () => { setBusy(true); try { await onInstallUrl(cfgInput.trim(), target.installed ? target.url : undefined); } finally { setBusy(false); } }}
                className="rounded-xl bg-fg px-4 py-1.5 text-xs font-semibold text-bg hover:bg-acc hover:text-acc-ink disabled:opacity-40"
              >
                {t('addon_install_configured')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {updateMsg ? <span className="text-xs text-emerald-300 font-medium">{updateMsg}</span> : <span />}
          <div className="flex gap-2">
            {target.installed ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const nextM = await onRefresh(target.url);
                    setManifest(nextM);
                    setUpdateMsg(t('addon_updated_to', { v: nextM.version || '1.0' }));
                  } finally { setBusy(false); }
                }}
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
              >
                {t('addon_check_update')}
              </button>
            ) : !needsSetup ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => { setBusy(true); try { await onInstallUrl(target.url); } finally { setBusy(false); } }}
                className="rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110 disabled:opacity-40"
              >
                {t('install')}
              </button>
            ) : null}
            <button onClick={onClose} className="rounded-full bg-white/8 px-4 py-2 text-xs text-fg2 hover:bg-white/15 hover:text-fg">
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, icon, onClick, disabled, rot }: { label: string; icon: string; onClick: () => void; disabled?: boolean; rot?: boolean }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} disabled={disabled} className="grid size-9 place-items-center rounded-full text-fg2 transition hover:bg-white/10 hover:text-fg disabled:opacity-30">
      <Icon n={icon} s={18} className={rot ? 'rotate-90' : ''} />
    </button>
  );
}
