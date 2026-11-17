import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, invoke, useInstalled, useStore, useStoreCategories, type Installed, type StoreAddon } from '../api';
import { useHost, useT } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Chips } from '../ui/Grid';

const configureUrl = (url: string) => url.replace(/\/manifest\.json$/, '/configure');

export function Addons() {
  const t = useT(), { toast } = useHost(), qc = useQueryClient();
  const installed = useInstalled();
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
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

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <h1 className="mb-6 text-3xl font-bold">{t('addons')}</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (link.trim()) { install(link.trim()); setLink(''); } }}
        className="mb-8 flex max-w-3xl items-center gap-3 rounded-full bg-white/6 py-1.5 pe-1.5 ps-5 ring-1 ring-line focus-within:ring-2 focus-within:ring-acc">
        <Icon n="link" s={18} className="text-fg3" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('addon_link_ph')} dir="ltr" className="flex-1 text-sm placeholder:text-fg3" />
        <button className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('install')}</button>
      </form>

      <h2 className="mb-3 text-lg font-semibold">{t('installed')}</h2>
      <div className="mb-12 grid grid-cols-1 gap-2">
        {(installed.data || []).map((a, i, all) => (
          <div key={a.url} className="flex items-center gap-4 rounded-xl bg-bg1 p-3 ring-1 ring-line">
            <span className="w-6 text-center font-mono text-sm text-fg3">{i + 1}</span>
            <span className="grid size-11 flex-none place-items-center overflow-hidden rounded-lg bg-bg3">
              <Img srcs={[a.manifest?.logo]} className="h-full w-full object-contain p-1" fallback={<Icon n="puzzle" s={20} className="text-fg3" />} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2"><span className="truncate font-semibold">{a.manifest?.name || a.url}</span><span className="font-mono text-[11px] text-fg3">{a.manifest?.version}</span></span>
              <span dir="auto" className="block truncate text-xs text-fg2">{a.error ? `⚠ ${a.error}` : a.manifest?.description}</span>
            </span>
            <span className="flex gap-1">{(a.manifest?.types || []).slice(0, 4).map((x) => <span key={x} className="rounded-md bg-white/6 px-1.5 py-0.5 text-[11px] text-fg2">{x}</span>)}</span>
            <IconBtn label={t('move_up')} icon="chevl" rot onClick={() => move(a, i - 1)} disabled={i === 0} />
            <IconBtn label={t('move_down')} icon="chevr" rot onClick={() => move(a, i + 1)} disabled={i === all.length - 1} />
            {a.manifest?.behaviorHints?.configurable ? <IconBtn label={t('configure')} icon="sliders" onClick={() => invoke('open', configureUrl(a.url))} /> : null}
            <IconBtn label={t('remove')} icon="x" onClick={() => remove(a)} />
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('addon_store')}</h2>
        <span className="text-xs text-fg3">stremio-addons.net</span>
        <span className="flex-1" />
        <label className="flex w-72 items-center gap-2 rounded-full bg-white/6 px-4 py-2 ring-1 ring-line focus-within:ring-acc">
          <Icon n="search" s={16} className="text-fg3" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search')} className="flex-1 text-sm" />
        </label>
      </div>
      <div className="mb-5"><Chips value={category} onChange={setCategory} options={[{ id: null, label: t('all') }, ...(cats.data || []).map((c) => ({ id: c.slug, label: c.name }))]} /></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {store.isLoading ? Array.from({ length: 9 }, (_, i) => <div key={i} className="skel h-44 rounded-2xl" />) : null}
        {(store.data?.addons || []).map((a) => <StoreCard key={a.slug} a={a} installed={have.has(a.manifestUrl)} onInstall={() => install(a.manifestUrl)} />)}
      </div>
    </div>
  );
}

function StoreCard({ a, installed, onInstall }: { a: StoreAddon; installed: boolean; onInstall: () => void }) {
  const t = useT();
  const m = a.manifest;
  const needsSetup = !!m?.behaviorHints?.configurationRequired;
  return (
    <div className="flex flex-col rounded-2xl bg-bg1 p-4 ring-1 ring-line">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid size-12 flex-none place-items-center overflow-hidden rounded-xl bg-bg3">
          <Img srcs={[m?.logo]} className="h-full w-full object-contain p-1" fallback={<Icon n="puzzle" s={22} className="text-fg3" />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{m?.name || a.slug}</span>
          <span className="block text-xs text-fg3"><span className="text-[#f5c518]">★</span> {a.stars} · {a.categories.slice(0, 2).join(' · ')}</span>
        </span>
      </div>
      <p dir="auto" className="clamp-3 mb-4 flex-1 text-[13px] leading-relaxed text-fg2">{m?.description}</p>
      <div className="flex gap-2">
        {installed ? <span className="flex items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-sm text-fg2"><Icon n="check" s={16} />{t('installed')}</span>
          : needsSetup ? <button onClick={() => invoke('open', a.configureUrl || configureUrl(a.manifestUrl))} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">{t('configure_first')}</button>
          : <button onClick={onInstall} className="rounded-full bg-fg px-5 py-2 text-sm font-semibold text-bg hover:bg-acc hover:text-acc-ink">{t('install')}</button>}
        {!needsSetup && a.configurable ? <button onClick={() => invoke('open', a.configureUrl || configureUrl(a.manifestUrl))} className="rounded-full px-3 py-2 text-sm text-fg2 hover:text-fg">{t('configure')}</button> : null}
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
