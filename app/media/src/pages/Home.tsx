import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Billboard } from '../ui/Billboard';
import { ContinueRow } from '../ui/ContinueRow';
import { SocialAvatar, VoteRow } from '../ui/Social';
import { Top10 } from '../ui/Top10';
import { CatalogRow, isUnreleased, useWatched } from '../ui/CatalogRow';
import { Row } from '../ui/Row';
import { Poster, PosterSkeleton } from '../ui/Poster';
import { Icon } from '../ui/Icon';
import { ServiceLogo } from '../ui/ServiceLogos';
import { useSettingsStore } from '../settings/useSettingsStore';
import {
  cin, invoke, STREAMING_BRANDS, useBrandCatalog, useContinue, useHomePrefs, useHomeServerItems,
  useHomeServers, useLists, useRows, useSocialFriends, useTrending, type HomeServerItem, type HomeServerPublic, type Row as RowT,
} from '../api';
import { useHost, useNav, useT } from '../host';

const rowKey = (r: { addon: string; type: string; id: string }) => `${r.addon}|${r.type}|${r.id}`;

export function Home() {
  const t = useT(), nav = useNav(), qc = useQueryClient();
  const rows = useRows(), tm = useTrending('movie'), ts = useTrending('series'), watched = useWatched();
  const cont = useContinue(), lists = useLists();
  const prefs = useHomePrefs().data;
  const friends = useSocialFriends().data?.friends || [];
  const enabledCatalogs = useSettingsStore((s) => s.data.sources.enabledCatalogs);
  const hideWatched = useSettingsStore((s) => s.data.sources.hideWatchedCatalogs);
  const hideUnreleased = useSettingsStore((s) => s.data.sources.hideUnreleasedCatalogs);
  const updateSettings = useSettingsStore((s) => s.update);
  const [brand, setBrand] = useState<(typeof STREAMING_BRANDS)[number] | null>(null);
  const [brandType, setBrandType] = useState<'movie' | 'series'>('movie');
  const [custOpen, setCustOpen] = useState(false);
  const custRef = useRef<HTMLDivElement | null>(null);
  const visibleBrands = useMemo(
    () => STREAMING_BRANDS.filter((b) => enabledCatalogs[b.name] !== false),
    [enabledCatalogs],
  );
  const brandCatalog = useBrandCatalog(brand?.id || 0, brand?.key || '', brandType, !!brand);

  useEffect(() => {
    if (!custOpen) return;
    const onDown = (e: MouseEvent) => {
      if (custRef.current && !custRef.current.contains(e.target as Node)) setCustOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setCustOpen(false); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [custOpen]);

  // the hero alternates today's films and shows
  const hero = useMemo(() => {
    const a = tm.data || [], b = ts.data || [], out = [];
    for (let i = 0; i < 4; i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
    return out;
  }, [tm.data, ts.data]);

  const hidden = useMemo(() => new Set(prefs?.hiddenRows || []), [prefs?.hiddenRows]);
  const showBrands = prefs?.showBrands !== false;
  const showFriends = prefs?.showFriends !== false;
  const zenMode = !!prefs?.zenMode;
  const activeFriends = useMemo(
    () => friends.filter((f) => f.friendStatus === 'accepted').sort((a, b) => Number(!!b.watching || !!b.inParty) - Number(!!a.watching || !!a.inParty) || Number(b.online) - Number(a.online)).slice(0, 12),
    [friends],
  );

  const orderedRows = useMemo<RowT[]>(() => {
    const list = rows.data || [];
    const order = prefs?.rowOrder || [];
    if (!order.length) return list;
    const rank = new Map(order.map((k, idx) => [k, idx]));
    return [...list].sort((a, b) => {
      const ra = rank.get(rowKey(a));
      const rb = rank.get(rowKey(b));
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return 0;
    });
  }, [rows.data, prefs?.rowOrder]);

  const filteredBrandItems = useMemo(() => {
    const raw = brandCatalog.data || [];
    if (!hideWatched && !hideUnreleased) return raw;
    return raw.filter((it) => (!hideWatched || !watched.has(it.id)) && (!hideUnreleased || !isUnreleased(it)));
  }, [brandCatalog.data, hideWatched, hideUnreleased, watched]);

  const savePrefs = async (patch: Partial<{ hiddenRows: string[]; rowOrder: string[]; showBrands: boolean; showFriends: boolean; zenMode: boolean }>) => {
    const next = await cin('home-prefs-set', patch);
    qc.setQueryData(['home-prefs'], next);
  };
  const toggleRow = (k: string) => {
    const next = hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k];
    savePrefs({ hiddenRows: next });
  };
  const moveRow = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= orderedRows.length) return;
    const keys = orderedRows.map(rowKey);
    const [picked] = keys.splice(idx, 1);
    keys.splice(target, 0, picked);
    savePrefs({ rowOrder: keys });
  };

  const names = new Map<string, number>();
  for (const r of orderedRows) names.set(r.name, (names.get(r.name) || 0) + 1);

  const watchlistItems = useMemo(
    () => (lists.data?.watchlist || []).map((x) => ({ id: x.id, type: x.type, name: x.name, poster: x.poster })),
    [lists.data?.watchlist],
  );
  const zenEmpty = zenMode && !(cont.data?.length) && !watchlistItems.length;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pb-20">
      {!zenMode ? <Billboard items={hero} /> : null}
      <div className={`relative z-10 ${zenMode ? 'pt-24' : '-mt-20'}`}>
        <div className="mb-2 flex items-center justify-end gap-2 px-12">
          <button
            onClick={() => savePrefs({ zenMode: !zenMode })}
            aria-pressed={zenMode}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 backdrop-blur transition ${
              zenMode ? 'bg-acc text-acc-ink ring-acc font-bold' : 'bg-bg1/80 text-fg2 ring-line hover:text-fg'
            }`}
          >
            <EyeOff size={14} />{t('zen_mode')}
          </button>
          <div ref={custRef} className="relative">
            <button onClick={() => setCustOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full bg-bg1/80 px-3.5 py-1.5 text-xs font-medium text-fg2 ring-1 ring-line backdrop-blur transition hover:text-fg">
              <Icon n="sliders" s={14} />{t('customize_home')}
            </button>
            {custOpen ? (
              <div className="absolute end-0 top-10 z-30 w-80 rounded-2xl bg-bg1/95 p-3.5 text-xs shadow-2xl ring-1 ring-white/15 backdrop-blur-xl">
                <div className="mb-2 font-semibold text-fg">{t('customize_home')}</div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  <PrefToggle label={t('zen_mode')} on={zenMode} onClick={() => savePrefs({ zenMode: !zenMode })} />
                  <div className="my-1 border-t border-line" />
                  <PrefToggle label={t('hide_watched')} on={hideWatched} onClick={() => updateSettings((s) => { s.sources.hideWatchedCatalogs = !hideWatched; })} />
                  <PrefToggle label={t('hide_unreleased')} on={hideUnreleased} onClick={() => updateSettings((s) => { s.sources.hideUnreleasedCatalogs = !hideUnreleased; })} />
                  <div className="my-1 border-t border-line" />
                  <PrefToggle label={t('show_brands')} on={showBrands} onClick={() => savePrefs({ showBrands: !showBrands })} />
                  <PrefToggle label={t('show_friends_shelf')} on={showFriends} onClick={() => savePrefs({ showFriends: !showFriends })} />
                  <div className="mt-2 pt-1 text-[11px] font-semibold text-fg3">{t('row_order')}</div>
                  {orderedRows.map((r, idx) => {
                    const k = rowKey(r);
                    return (
                      <div key={k} className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <PrefToggle label={`${r.name} (${r.type === 'movie' ? t('type_movie') : r.type === 'series' ? t('type_series') : r.type})`} on={!hidden.has(k)} onClick={() => toggleRow(k)} />
                        </div>
                        <button onClick={() => moveRow(idx, -1)} disabled={idx === 0} aria-label={t('move_up')} title={t('move_up')} className="grid size-6 flex-none place-items-center rounded bg-white/6 text-fg2 hover:bg-white/15 disabled:opacity-25">
                          <ChevronUp size={12} />
                        </button>
                        <button onClick={() => moveRow(idx, 1)} disabled={idx === orderedRows.length - 1} aria-label={t('move_down')} title={t('move_down')} className="grid size-6 flex-none place-items-center rounded bg-white/6 text-fg2 hover:bg-white/15 disabled:opacity-25">
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <ContinueRow />
        {zenMode ? (
          <>
            {watchlistItems.length ? (
              <Row title={t('watchlist')} items={watchlistItems} width={168} height={262} render={(it) => <Poster item={it} watched={watched.has(it.id)} />} />
            ) : null}
            {zenEmpty ? (
              <section className="mx-auto mt-10 max-w-lg px-6">
                <div className="rounded-2xl border border-white/10 bg-bg1/85 p-8 text-center shadow-xl">
                  <EyeOff size={28} className="mx-auto mb-3 text-acc" />
                  <h2 className="text-lg font-bold text-fg">{t('zen_empty_title')}</h2>
                  <p className="mt-1.5 text-xs text-fg2">{t('zen_empty_sub')}</p>
                  <div className="mt-5 flex justify-center gap-2.5">
                    <button onClick={() => nav.go('search')} className="rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110">
                      {t('search')}
                    </button>
                    <button onClick={() => nav.go('library')} className="rounded-full bg-white/10 px-5 py-2 text-xs font-semibold text-fg hover:bg-white/15">
                      {t('library')}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <>
        <VoteRow />

        {showFriends && activeFriends.length ? (
          <section className="mt-8 px-12 fade-in">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[19px] font-semibold text-fg">{t('friends_activity')}</h2>
            </div>
            <div className="hscroll flex gap-3 pb-1">
              {activeFriends.map((f) => (
                <button key={f.id} onClick={() => nav.open({ kind: 'friend', id: f.id })}
                  className="flex w-56 flex-none items-center gap-3 rounded-2xl bg-bg1/85 p-3 text-start ring-1 ring-line transition hover:bg-bg2 hover:ring-acc/60">
                  <SocialAvatar avatar={f.avatar} name={f.name} accent={f.accent} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: f.accent || undefined }}>{f.name}</div>
                    <div className="truncate text-[11px] text-fg2">
                      {f.watching ? t('watching_now', { name: f.watching.name }) : f.inParty ? t('in_party_now', { n: f.inParty.count }) : f.online ? t('online_now') : t('offline_status')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {showBrands && visibleBrands.length ? (
          <section className="mt-8 fade-in">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-12">
              <h2 className="text-[19px] font-semibold text-fg">{t('streaming_platforms')}</h2>
              {brand ? (
                <div className="flex rounded-full bg-bg1 p-0.5 text-xs ring-1 ring-line">
                  {([['movie', t('type_movie')], ['series', t('type_series')]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setBrandType(id)}
                      className={`rounded-full px-3 py-1 font-semibold transition ${brandType === id ? 'bg-acc text-acc-ink' : 'text-fg2 hover:text-fg'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="hscroll flex gap-3 px-12 pb-2">
              {visibleBrands.map((b) => {
                const active = brand?.id === b.id;
                return (
                  <button key={b.id} onClick={() => setBrand(active ? null : b)} aria-label={b.name} aria-pressed={active}
                    className={`flex h-14 min-w-[144px] flex-none items-center justify-center rounded-xl border px-4 transition duration-200 hover:-translate-y-0.5 [&>span]:transition-all hover:[&>span]:drop-shadow-[0_0_10px_rgba(226,164,58,0.4)] ${
                      active
                        ? 'border-acc bg-[#1a1610] text-acc shadow-[0_0_24px_rgba(226,164,58,0.24)] ring-1 ring-acc/50'
                        : 'border-white/10 bg-[#12100e] text-[#ebe3d5] hover:border-acc/60 hover:bg-[#191510] hover:text-acc hover:shadow-[0_0_20px_rgba(226,164,58,0.18)]'
                    }`}>
                    <ServiceLogo service={b.key} name={b.name} />
                  </button>
                );
              })}
            </div>
            {brand ? (
              <Row title={`${brand.name} · ${brandType === 'movie' ? t('type_movie') : t('type_series')}`} items={filteredBrandItems} width={168} height={262} loading={brandCatalog.isLoading} skeleton={<PosterSkeleton />}
                render={(it) => <Poster item={it} watched={watched.has(it.id)} />} />
            ) : null}
          </section>
        ) : null}

        <Top10 title={t('top10_movies')} items={tm.data || []} />
        {orderedRows.filter((r) => !hidden.has(rowKey(r))).map((r) => (
          <CatalogRow key={rowKey(r)} row={r} watched={watched}
            title={(names.get(r.name) || 0) > 1 ? `${r.name} · ${r.type === 'movie' ? t('type_movie') : r.type === 'series' ? t('type_series') : r.type}` : r.name} />
        ))}
        <Top10 title={t('top10_shows')} items={ts.data || []} />
        <HomeServerShelves />
          </>
        )}
      </div>
    </div>
  );
}

function HomeServerShelves() {
  const servers = useHomeServers().data || [];
  if (!servers.length) return null;
  return (
    <>
      {servers.map((srv) => <HomeServerRow key={srv.id} server={srv} />)}
    </>
  );
}

function HomeServerRow({ server }: { server: HomeServerPublic }) {
  const t = useT(), nav = useNav(), { toast } = useHost();
  const q = useHomeServerItems(server.id, '', true);
  const items = q.data || [];
  if (!items.length) return null;
  const playServerItem = async (it: HomeServerItem) => {
    try {
      toast(t('playing'));
      const r = await cin<{ url: string; headers?: Record<string, string>; name?: string }>('hs-stream', { serverId: server.id, itemId: it.homeServer.itemId });
      await invoke('media:play', {
        type: it.type,
        id: it.id,
        stream: { url: r.url, ...(r.headers ? { behaviorHints: { proxyHeaders: { request: r.headers } } } : {}) },
        card: { name: r.name || it.name, poster: it.poster || null, type: it.type, metaId: it.id },
      });
    } catch {
      toast(t('servers_failed'));
    }
  };
  return (
    <Row
      title={server.name || server.serverName || server.kind.toUpperCase()}
      sub={server.kind.toUpperCase()}
      items={items}
      width={168}
      height={262}
      loading={q.isLoading}
      skeleton={<PosterSkeleton />}
      render={(it) => (
        <button
          onClick={() => (/^tt\d+/.test(it.id) ? nav.open({ kind: 'title', type: it.type, id: it.id }) : playServerItem(it))}
          className="group relative w-[168px] flex-none text-start"
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition group-hover:-translate-y-1 group-hover:ring-2 group-hover:ring-acc">
            {it.poster ? <img src={it.poster} alt="" className="h-full w-full object-cover" /> : (
              <div className="grid h-full place-items-center p-3 text-center text-xs font-semibold text-fg2">{it.name}</div>
            )}
            <span
              onClick={(e) => { e.stopPropagation(); playServerItem(it); }}
              className="absolute bottom-2.5 start-2.5 grid size-8 place-items-center rounded-full bg-acc text-acc-ink opacity-0 shadow-lg transition group-hover:opacity-100"
            >
              <Icon n="play" s={14} />
            </span>
          </div>
          <div dir="auto" className="mt-2 truncate text-xs font-medium text-fg2 group-hover:text-fg">{it.name}</div>
        </button>
      )}
    />
  );
}

function PrefToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start hover:bg-white/8">
      <span className="truncate pe-2 text-fg2">{label}</span>
      <span className={`inline-block size-3.5 rounded border ${on ? 'border-acc bg-acc' : 'border-fg3'}`} />
    </button>
  );
}
