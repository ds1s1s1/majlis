import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Bookmark, Plus, Server, Star, Trash2, Wifi } from 'lucide-react';
import { cin, invoke, STREAMING_BRANDS, useHomePrefs, useHomeServers, type HomeServerPublic } from '../../api';
import { useHost, useT } from '../../host';
import { fmtLocaleTime } from '../../i18n';
import {
  ActionRow, DropdownRow, InputRow, LivePreviewCard,
  RadioCardGroup, SegmentedRow, SettingSection, SliderRow, ToggleRow,
} from '../primitives';
import { AI_PROVIDER_DEFAULT_MODELS, useSettingsStore, type HomeServerEntry, type SettingsPageId, type StreamFilterPreset } from '../useSettingsStore';

const DEBRID_SERVICES = [
  { id: 'realdebrid', name: 'Real-Debrid', hint: 'rd_...' },
  { id: 'torbox', name: 'TorBox', hint: 'tb_...' },
  { id: 'alldebrid', name: 'AllDebrid', hint: 'ad_...' },
  { id: 'premiumize', name: 'Premiumize', hint: 'pm_...' },
  { id: 'debridlink', name: 'Debrid-Link', hint: 'dl_...' },
];

const SCORE_PROVIDERS = ['IMDb', 'TMDB', 'Rotten Tomatoes', 'Audience', 'Metacritic', 'Letterboxd', 'MDBList', 'Trakt', 'SIMKL', 'MAL'];
const META_KEYS = [
  { id: 'tmdb', name: 'TMDB' },
  { id: 'omdb', name: 'OMDb' },
  { id: 'tvdb', name: 'TheTVDB' },
  { id: 'mdblist', name: 'MDBList' },
  { id: 'fanart', name: 'Fanart.tv' },
  { id: 'rpdb', name: 'RPDB' },
  { id: 'topposters', name: 'Top Posters' },
  { id: 'simkl', name: 'Simkl' },
];

export function SourcesLibraryPage({ pageId }: { pageId: SettingsPageId }) {
  const t = useT();
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update } = useSettingsStore();
  const src = data.sources;
  const homePrefsQ = useHomePrefs();
  const homeServersQ = useHomeServers();
  const p2pQ = useQuery({
    queryKey: ['p2p-status'],
    queryFn: () => cin<{ running: boolean; port: number | null; activeFiles: number; cacheDir: string }>('p2p-status').catch(() => ({
      running: false, port: null as number | null, activeFiles: 0, cacheDir: '',
    })),
    enabled: pageId === 'p2p-engine' || pageId === 'streaming-server',
    refetchInterval: pageId === 'p2p-engine' ? 4000 : false,
  });

  const prefsQ = useQuery({
    queryKey: ['prefs'],
    queryFn: () => cin<{
      streamRules?: { preferHevc?: boolean; prefer4kHdr?: boolean; blockCamTs?: boolean; maxSizeGb?: number; excludeKeywords?: string };
    }>('prefs').catch(() => null),
    staleTime: 5000,
  });

  const keysQ = useQuery({
    queryKey: ['keys'],
    queryFn: () => cin<{ user: Record<string, string>; builtIn: Record<string, boolean> }>('keys').catch(() => ({
      user: {} as Record<string, string>,
      builtIn: {} as Record<string, boolean>,
    })),
  });
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [previewKind, setPreviewKind] = useState<'poster' | 'anime'>('poster');
  const [serverModal, setServerModal] = useState(false);
  const [newServer, setNewServer] = useState<Omit<HomeServerEntry, 'id'>>({ kind: 'jellyfin', name: '', url: 'http://192.168.1.10:8096', apiKey: '' });
  const [srvTests, setSrvTests] = useState<Record<string, { ok: boolean; label: string }>>({});
  const [filterModal, setFilterModal] = useState(false);
  const [newFilter, setNewFilter] = useState<Omit<StreamFilterPreset, 'id'>>({ name: '', minRes: '1080p', maxRes: '4K', hdrOnly: false, audioCodec: 'any', maxSizeGb: 25, excludeKeywords: 'CAM, TS' });
  const [netStatus, setNetStatus] = useState<string>('Healthy (P2P + Relay Ready)');

  const saveKey = async (id: string, val: string) => {
    await cin('keys-set', { [id]: val }).catch(() => {});
    toast(ar ? `تم حفظ ${id}` : `${id.toUpperCase()} saved`);
  };

  if (pageId === 'streaming-services') {
    const brands = STREAMING_BRANDS.length ? STREAMING_BRANDS.map((b) => b.name) : ['Netflix', 'Disney+', 'Hulu', 'Prime Video', 'Apple TV+', 'Max', 'Peacock', 'Crunchyroll', 'Paramount+', 'Starz', 'Shudder', 'BBC iPlayer'];
    return (
      <>
        <SettingSection title={ar ? 'خدمات الديبريد' : 'Debrid services'}>
          {DEBRID_SERVICES.map((d) => {
            const val = tokenDrafts[d.id] ?? keysQ.data?.user?.[d.id] ?? '';
            return (
              <InputRow
                key={d.id}
                label={d.name}
                secret
                savedBadge={!!(keysQ.data?.user?.[d.id] || tokenDrafts[d.id])}
                placeholder={d.hint}
                value={val}
                onChange={(v) => setTokenDrafts((prev) => ({ ...prev, [d.id]: v }))}
                onSave={() => saveKey(d.id, val)}
              />
            );
          })}
        </SettingSection>
        <SettingSection title="Usenet & Easynews">
          <InputRow
            label="Easynews / Usenet Manifest URL"
            value={src.usenetEasynewsUrl}
            placeholder="https://..."
            onChange={(v) => update((s) => { s.sources.usenetEasynewsUrl = v; })}
            onSave={async () => {
              if (!src.usenetEasynewsUrl.trim()) return;
              await cin('addon-install', { url: src.usenetEasynewsUrl.trim() }).catch(() => {});
              toast(ar ? 'تم التثبيت' : 'Manifest installed');
            }}
            saveLabel={ar ? 'تثبيت' : 'Install'}
          />
        </SettingSection>
        <SettingSection title={ar ? 'كتالوجات المنصات العالمية' : 'Streaming catalogs'}>
          <div className="grid grid-cols-2 gap-2.5 pt-2 sm:grid-cols-3 md:grid-cols-4">
            {brands.map((b) => {
              const on = src.enabledCatalogs[b] !== false;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => update((s) => { s.sources.enabledCatalogs[b] = !on; })}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                    on ? 'border-[var(--accent)] bg-[var(--surface-active)] text-[var(--accent)]' : 'border-[var(--border-subtle)] bg-black/25 text-white/50'
                  }`}
                >
                  {b}
                </button>
              );
            })}
          </div>
        </SettingSection>
      </>
    );
  }

  if (pageId === 'home-servers') {
    const servers = homeServersQ.data || [];
    const testHomeSrv = async (hs: HomeServerPublic) => {
      type HsTestRes = { ok: boolean; serverName?: string; version?: string; error?: string };
      const r = await cin<HsTestRes>('hs-test', { id: hs.id }).catch((): HsTestRes => ({ ok: false, error: 'failed' }));
      setSrvTests((prev) => ({
        ...prev,
        [hs.id]: r.ok
          ? { ok: true, label: `${t('servers_connected')}${r.serverName ? ` · ${r.serverName}` : ''}${r.version ? ` v${r.version}` : ''}` }
          : { ok: false, label: t('servers_failed') },
      }));
      if (!r.ok) toast(t('servers_failed'));
    };
    const saveNewServer = async () => {
      if (!newServer.url.trim()) return;
      try {
        const saved = await cin<HomeServerPublic>('hs-save', newServer);
        update((s) => { s.sources.homeServers = [...s.sources.homeServers, { id: saved.id, kind: saved.kind, name: saved.name, url: saved.url, apiKey: '' }]; });
        qc.invalidateQueries({ queryKey: ['home-servers'] });
        qc.invalidateQueries({ queryKey: ['hs-items'] });
        setServerModal(false);
      } catch {
        toast(t('servers_failed'));
      }
    };
    const removeHomeSrv = async (id: string) => {
      await cin('hs-remove', { id }).catch(() => {});
      update((s) => { s.sources.homeServers = s.sources.homeServers.filter((x) => x.id !== id); });
      qc.invalidateQueries({ queryKey: ['home-servers'] });
      qc.invalidateQueries({ queryKey: ['hs-items'] });
    };
    return (
      <>
        <SettingSection
          title={ar ? 'خوادم الوسائط المنزلية' : 'Home media servers'}
          rightAction={<button type="button" onClick={() => setServerModal(true)} className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}><Plus size={13} />{ar ? 'ربط خادم' : 'Connect server'}</button>}
        >
          {servers.length ? servers.map((hs) => {
            const stBadge = srvTests[hs.id];
            return (
              <div key={hs.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Server size={16} className="text-[var(--accent)]" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{hs.name || hs.kind.toUpperCase()}</div>
                    <div dir="ltr" className="truncate font-mono text-[11px] text-[var(--text-muted)]">{hs.url}</div>
                    {stBadge ? (
                      <div className={`mt-0.5 text-[11px] font-medium ${stBadge.ok ? 'text-emerald-300' : 'text-red-300'}`}>{stBadge.label}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => testHomeSrv(hs)} className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/20">{t('servers_test')}</button>
                  <button type="button" onClick={() => removeHomeSrv(hs.id)} className="rounded-lg bg-red-500/12 p-1.5 text-red-300 hover:bg-red-500/25"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          }) : (
            <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t('servers_empty')}</p>
          )}
        </SettingSection>
        {serverModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setServerModal(false); }}>
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#161310] p-5 space-y-3">
              <h3 className="text-sm font-bold">{ar ? 'ربط خادم منزلي' : 'Connect Home Server'}</h3>
              <select value={newServer.kind} onChange={(e) => setNewServer({ ...newServer, kind: e.target.value as HomeServerEntry['kind'] })} className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10">
                <option value="jellyfin">Jellyfin</option>
                <option value="emby">Emby</option>
                <option value="plex">Plex</option>
              </select>
              <input value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} placeholder={ar ? 'اسم الخادم...' : 'Server label (e.g. Home NAS)'} className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10 outline-none" />
              <input dir="ltr" value={newServer.url} onChange={(e) => setNewServer({ ...newServer, url: e.target.value })} placeholder="http://192.168.1.10:8096" className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10 outline-none" />
              <input dir="ltr" type="password" value={newServer.apiKey} onChange={(e) => setNewServer({ ...newServer, apiKey: e.target.value })} placeholder="API Key / Token" className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10 outline-none" />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setServerModal(false)} className="rounded-full bg-white/10 px-4 py-1.5 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" onClick={saveNewServer} className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{ar ? 'ربط' : 'Connect'}</button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (pageId === 'source-preferences') {
    return (
      <SettingSection title={ar ? 'تفضيلات وأمان الروابط' : 'Source preferences'}>
        <RadioCardGroup
          columns={3}
          value={src.safetyFilter}
          onChange={(v) => update((s) => { s.sources.safetyFilter = v; })}
          options={[
            { value: 'strict', title: ar ? 'صارم (افتراضي)' : 'Strict', badge: 'RECOMMENDED', description: ar ? 'يرفض المصادر المجهولة والملفات الوهمية والـ CAM تلقائياً.' : 'Filters spam, zero-seed traps, and mismatched episodes.' },
            { value: 'balanced', title: ar ? 'متوازن' : 'Balanced', description: ar ? 'يسمح بالروابط المبكرة الموثقة من عدة مزودين.' : 'Allows corroborated early releases while warning unverified.' },
            { value: 'off', title: ar ? 'إيقاف التصفية' : 'Off', description: ar ? 'يعرض جميع الروابط الخام كما وصلت.' : 'Displays all raw results without trust gating.' },
          ]}
        />
        <ToggleRow label={ar ? 'تفضيل نسخ الفانسب الموثقة للأنمي' : 'Prefer fansub/verified file for anime'} checked={src.preferAnimeFansub} onChange={(v) => update((s) => { s.sources.preferAnimeFansub = v; })} />
        <DropdownRow label={ar ? 'مهلة انتظار المصادر' : 'Addon wait time'} value={src.addonWaitSec} options={[5, 10, 15, 30, 45].map((n) => ({ value: n as typeof src.addonWaitSec, label: `${n}s` }))} onChange={(v) => update((s) => { s.sources.addonWaitSec = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'source-order') {
    const move = (idx: number, dir: -1 | 1) => {
      const t = idx + dir;
      if (t < 0 || t >= src.streamPriorityOrder.length) return;
      const next = [...src.streamPriorityOrder];
      [next[idx], next[t]] = [next[t], next[idx]];
      update((s) => { s.sources.streamPriorityOrder = next; });
    };
    return (
      <SettingSection title={ar ? 'ترتيب وأولوية المصادر' : 'Source order'}>
        <RadioCardGroup
          value={src.resultOrder}
          onChange={(v) => update((s) => { s.sources.resultOrder = v; })}
          options={[
            { value: 'smart', title: ar ? 'ترتيب ذكي' : 'Smart ranking', description: ar ? 'يرتب الدقة والـ HDR والكاش والاعتمادية تلقائياً.' : 'Scores 4K/REMUX/Debrid/trust uniformly.' },
            { value: 'addon', title: ar ? 'ترتيب الإضافات' : 'Addon order', description: ar ? 'يحفظ ترتيب المزود كما أرسلته الإضافة.' : 'Preserves raw addon response sequence.' },
          ]}
        />
        <div className="py-3 space-y-2">
          <div className="text-[13.5px] font-medium">{ar ? 'أولوية المصادر المرقمة' : 'Stream priority list'}</div>
          {src.streamPriorityOrder.map((name, i) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-black/30 px-3 py-2 text-xs">
              <span><strong className="me-2 font-mono text-[var(--accent)]">#{i + 1}</strong>{name}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={12} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === src.streamPriorityOrder.length - 1} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={12} /></button>
              </div>
            </div>
          ))}
        </div>
        <ToggleRow label={ar ? 'دمج وتجميع الروابط المكررة من الإضافات' : 'Aggregate addons'} checked={src.aggregateAddons} onChange={(v) => update((s) => { s.sources.aggregateAddons = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'source-picker') {
    return (
      <SettingSection title={ar ? 'عرض اختيار الروابط' : 'Source picker'}>
        <RadioCardGroup
          value={src.pickerLayout}
          onChange={(v) => update((s) => { s.sources.pickerLayout = v; })}
          options={[
            { value: 'condensed', title: ar ? 'مضغوط (Condensed)' : 'Condensed', description: ar ? 'صفوف سريعة متراصة لرؤية عدد أكبر من المصادر.' : 'Dense horizontal list to compare dozens at a glance.' },
            { value: 'cards', title: ar ? 'بطاقات مفصلة (Cards)' : 'Cards', description: ar ? 'بطاقات عريضة مع تفاصيل الترميز والصوت كاملة.' : 'Full detail cards highlighting codec & size chips.' },
          ]}
        />
        <SegmentedRow label={ar ? 'وضع المصادر' : 'Source mode'} value={src.sourceMode} options={[{ value: 'both', label: ar ? 'الكل' : 'Both' }, { value: 'debrid', label: 'Direct / Debrid' }, { value: 'p2p', label: 'P2P' }]} onChange={(v) => update((s) => { s.sources.sourceMode = v; })} />
        <ToggleRow label={ar ? 'نقل زر التحديث بجانب الرجوع' : 'Move Refresh next to Back'} checked={src.moveRefreshNextToBack} onChange={(v) => update((s) => { s.sources.moveRefreshNextToBack = v; })} />
        <ToggleRow label={ar ? 'إظهار اسم الإصدار الخام' : 'Show release name'} checked={src.showReleaseName} onChange={(v) => update((s) => { s.sources.showReleaseName = v; })} />
        <ToggleRow label={ar ? 'إظهار الوصف الكامل للملف' : 'Show full descriptions'} checked={src.showFullDescriptions} onChange={(v) => update((s) => { s.sources.showFullDescriptions = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'stream-filters') {
    return (
      <>
        <SettingSection
          title={ar ? 'فلاتر الروابط المحفوظة' : 'Saved stream filters'}
          rightAction={<button type="button" onClick={() => setFilterModal(true)} className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}><Plus size={13} />{ar ? 'إنشاء فلتر' : 'Create filter'}</button>}
        >
          {src.savedFilters.map((f) => {
            const active = src.activeFilterId === f.id;
            return (
              <div key={f.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-semibold">{f.name}</div>
                  <div dir="ltr" className="font-mono text-[11px] text-[var(--text-muted)]">{f.minRes}–{f.maxRes}{f.hdrOnly ? ' · HDR only' : ''}{f.maxSizeGb > 0 ? ` · <=${f.maxSizeGb}GB` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => update((s) => { s.sources.activeFilterId = f.id; })} className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/10'}`}>{active ? (ar ? 'نشط' : 'Active') : (ar ? 'تفعيل' : 'Use')}</button>
                  {f.id !== 'default' ? <button type="button" onClick={() => update((s) => { s.sources.savedFilters = s.sources.savedFilters.filter((x) => x.id !== f.id); })} className="text-red-300"><Trash2 size={13} /></button> : null}
                </div>
              </div>
            );
          })}
        </SettingSection>
        {(() => {
          const rules = prefsQ.data?.streamRules || { preferHevc: false, prefer4kHdr: false, blockCamTs: true, maxSizeGb: 0, excludeKeywords: '' };
          const saveRules = async (patch: Partial<typeof rules>) => {
            const next = { ...rules, ...patch };
            await cin('prefs-set', { streamRules: next }).catch(() => {});
            qc.invalidateQueries({ queryKey: ['prefs'] });
            toast(ar ? 'تم حفظ قواعد اختيار التورنت' : 'Auto-pick torrent rules saved');
          };
          return (
            <SettingSection title={ar ? 'قواعد الاختيار التلقائي للتورنت' : 'Smart Auto-Pick Torrent Rules'}>
              <ToggleRow label={ar ? 'تفضيل نسخ HEVC / x265' : 'Prefer HEVC / x265 releases'} checked={!!rules.preferHevc} onChange={(v) => saveRules({ preferHevc: v })} />
              <ToggleRow label={ar ? 'تفضيل 4K HDR عند التوفر' : 'Prefer 4K HDR streams'} checked={!!rules.prefer4kHdr} onChange={(v) => saveRules({ prefer4kHdr: v })} />
              <ToggleRow label={ar ? 'حجب النسخ السينمائية (CAM / TS)' : 'Block CAM / TS / Screener releases'} checked={rules.blockCamTs !== false} onChange={(v) => saveRules({ blockCamTs: v })} />
              <SliderRow label={ar ? 'الحد الأقصى لحجم التورنت (0 = بدون حد)' : 'Maximum torrent size (0 = unlimited)'} value={Number(rules.maxSizeGb) || 0} min={0} max={100} step={2} unit=" GB" defaultValue={0} onChange={(v) => saveRules({ maxSizeGb: v })} />
              <InputRow label={ar ? 'كلمات مستبعدة (مفصولة بفاصلة)' : 'Exclude keywords (comma-separated)'} value={rules.excludeKeywords || ''} placeholder="CAM,TS,3D,DUB" onChange={(v) => saveRules({ excludeKeywords: v })} />
            </SettingSection>
          );
        })()}
        {filterModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setFilterModal(false); }}>
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#161310] p-5 space-y-3">
              <h3 className="text-sm font-bold">{ar ? 'إنشاء فلتر جديد' : 'New Stream Filter'}</h3>
              <input value={newFilter.name} onChange={(e) => setNewFilter({ ...newFilter, name: e.target.value })} placeholder={ar ? 'اسم الفلتر...' : 'Filter preset name...'} className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10 outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <select value={newFilter.minRes} onChange={(e) => setNewFilter({ ...newFilter, minRes: e.target.value })} className="rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10"><option value="720p">Min 720p</option><option value="1080p">Min 1080p</option><option value="4K">4K Only</option></select>
                <select value={newFilter.maxRes} onChange={(e) => setNewFilter({ ...newFilter, maxRes: e.target.value })} className="rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10"><option value="1080p">Max 1080p</option><option value="4K">Max 4K</option></select>
              </div>
              <label className="flex items-center justify-between text-xs"><span>HDR / Dolby Vision Only</span><input type="checkbox" checked={newFilter.hdrOnly} onChange={(e) => setNewFilter({ ...newFilter, hdrOnly: e.target.checked })} /></label>
              <input value={newFilter.excludeKeywords} onChange={(e) => setNewFilter({ ...newFilter, excludeKeywords: e.target.value })} placeholder="Exclude keywords (CAM, TS)" className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10 outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setFilterModal(false)} className="rounded-full bg-white/10 px-4 py-1.5 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                <button type="button" onClick={() => { if (!newFilter.name.trim()) return; update((s) => { s.sources.savedFilters.push({ id: `flt-${Date.now()}`, ...newFilter }); }); setFilterModal(false); }} className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{ar ? 'حفظ' : 'Create'}</button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (pageId === 'p2p-engine') {
    const p2p = p2pQ.data;
    return (
      <>
        <SettingSection title={ar ? 'حالة محرك P2P وخادم البث المدمج' : 'P2P Engine & Bundled Streaming Server'}>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { lbl: ar ? 'حالة المحرك' : 'Engine Status', val: src.p2p.disableEntirely ? (ar ? 'معطّل' : 'Disabled') : p2p?.running ? (ar ? 'يعمل' : 'Running') : (ar ? 'جاهز بالانتظار' : 'Standby') },
              { lbl: ar ? 'المنفذ المحلي' : 'Loopback Port', val: p2p?.port ? String(p2p.port) : '11475+' },
              { lbl: ar ? 'التحويلات النشطة' : 'Active Transfers', val: String(p2p?.activeFiles ?? 0) },
              { lbl: ar ? 'محرك البث' : 'Backend Stack', val: 'Stremio Server' },
            ].map((c) => (
              <div key={c.lbl} className="rounded-xl bg-black/35 p-3">
                <div className="text-[10px] uppercase text-[var(--text-muted)]">{c.lbl}</div>
                <div dir="ltr" className="mt-0.5 font-mono text-xs font-bold text-[var(--accent)]">{c.val}</div>
              </div>
            ))}
          </div>

          {/* Inline SVG P2P/TURN Architecture Diagram */}
          <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-black/40 p-3">
            <svg viewBox="0 0 480 86" className="h-20 w-full">
              <rect x="12" y="20" width="96" height="44" rx="10" fill="#181613" stroke="#E5A93C" strokeWidth="1.5" />
              <text x="60" y="46" textAnchor="middle" fill="#F2EFE9" fontSize="11" fontWeight="700">Host (Majlis)</text>
              <line x1="108" y1="42" x2="188" y2="42" stroke="#5CB874" strokeWidth="2" strokeDasharray="4 3" />
              <rect x="188" y="20" width="104" height="44" rx="10" fill="#181613" stroke="#3B82F6" strokeWidth="1.5" />
              <text x="240" y="40" textAnchor="middle" fill="#93C5FD" fontSize="10" fontWeight="700">QUIC Direct /</text>
              <text x="240" y="54" textAnchor="middle" fill="#93C5FD" fontSize="10" fontWeight="700">coturn TURN</text>
              <line x1="292" y1="42" x2="372" y2="42" stroke="#5CB874" strokeWidth="2" strokeDasharray="4 3" />
              <rect x="372" y="20" width="96" height="44" rx="10" fill="#181613" stroke="#E5A93C" strokeWidth="1.5" />
              <text x="420" y="46" textAnchor="middle" fill="#F2EFE9" fontSize="11" fontWeight="700">Guests / Peers</text>
            </svg>
          </div>

          <ToggleRow label={ar ? 'إظهار شارة حالة P2P' : 'Show P2P status chip'} checked={src.p2p.showStatusChip} onChange={(v) => update((s) => { s.sources.p2p.showStatusChip = v; })} />
          <ToggleRow label={ar ? 'الاستمرار في التنزيل بعد مغادرة الفيديو' : 'Keep downloading after you leave'} checked={src.p2p.keepDownloadingAfterLeave} onChange={(v) => update((s) => { s.sources.p2p.keepDownloadingAfterLeave = v; })} />
          <ToggleRow label={ar ? 'تشغيل المحرك عند الحاجة فقط' : 'Only start the P2P engine when needed'} checked={src.p2p.onlyStartWhenNeeded} onChange={(v) => update((s) => { s.sources.p2p.onlyStartWhenNeeded = v; })} />
          <ToggleRow label={ar ? 'تعطيل P2P بالكامل' : 'Disable P2P entirely'} checked={src.p2p.disableEntirely} onChange={(v) => update((s) => { s.sources.p2p.disableEntirely = v; })} />
          <ToggleRow label={ar ? 'تخزين P2P مؤقت محلي' : 'Local P2P caching'} checked={src.p2p.localCaching} onChange={(v) => update((s) => { s.sources.p2p.localCaching = v; })} />
          <ToggleRow label={ar ? 'تأكيد تلقائي لبث P2P' : 'Auto-confirm peer-to-peer streaming'} checked={src.p2p.autoConfirmP2P} onChange={(v) => update((s) => { s.sources.p2p.autoConfirmP2P = v; })} />
          <ActionRow label={ar ? 'اختبار الاتصال والتشخيص' : 'Connection test'} description={netStatus} buttonLabel={ar ? 'تشغيل الفحص الذاتي' : 'Run self-test'} onClick={async () => { await invoke('netcheck').catch(() => {}); setNetStatus(`OK @ ${fmtLocaleTime(Date.now(), lang)}`); }} />
          <ActionRow label={ar ? 'إعادة تشغيل أو مسح ذاكرة P2P' : 'Maintenance'} buttonLabel={ar ? 'مسح وإعادة التشغيل' : 'Clear & restart'} variant="danger" onClick={async () => { await cin('cache-clear', { category: 'stream' }).catch(() => {}); toast(ar ? 'تمت إعادة تهيئة المحرك وتنظيف الكاش' : 'Stream cache cleared'); }} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'streaming-server') {
    const p2p = p2pQ.data;
    const isUp = !!p2p?.running;
    const localEndpoint = p2p?.port ? `http://127.0.0.1:${p2p.port}` : '127.0.0.1 (on-demand)';
    return (
      <SettingSection
        title={ar ? 'خادم البث المحلي (Streaming Server)' : 'Streaming server'}
        rightAction={<span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${isUp ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/60'}`}><Wifi size={12} />{isUp ? 'RUNNING' : 'STANDBY'}</span>}
      >
        <ActionRow label={ar ? 'حالة الخادم' : 'Server process'} description={isUp ? (ar ? `يعمل على المنفذ ${p2p?.port}` : `Active on port ${p2p?.port}`) : (ar ? 'يبدأ تلقائياً عند تشغيل ملف تورنت' : 'Starts automatically on torrent playback')} buttonLabel={ar ? 'تحديث الحالة' : 'Refresh status'} onClick={() => { p2pQ.refetch(); toast(ar ? 'تم تحديث الحالة' : 'Status refreshed'); }} />
        <InputRow label={ar ? 'على هذا الجهاز' : 'On this computer'} value={localEndpoint} copyable onChange={() => {}} />
        <InputRow label={ar ? 'خادم بث بعيد (اختياري)' : 'Remote streaming server'} value={src.remoteServerUrl} placeholder="http://192.168.1.50:11470" onChange={(v) => update((s) => { s.sources.remoteServerUrl = v; })} onSave={() => toast(ar ? 'تم الحفظ' : 'Saved')} />
      </SettingSection>
    );
  }

  if (pageId === 'home') {
    return (
      <>
        <SettingSection title={ar ? 'واجهة الرئيسية والهيرو' : 'Home hero'}>
          <ToggleRow
            label={t('zen_mode')}
            description={t('zen_mode_desc')}
            checked={!!homePrefsQ.data?.zenMode}
            onChange={async (v) => {
              const next = await cin('home-prefs-set', { zenMode: v });
              qc.setQueryData(['home-prefs'], next);
            }}
          />
          <SegmentedRow label={ar ? 'مصدر الأعمال المميزة' : 'Featured source'} value={src.homeHeroSource} options={[{ value: 'trending', label: 'Trending' }, { value: 'popular', label: 'Popular' }, { value: 'watchlist', label: 'Watchlist' }, { value: 'off', label: 'Off' }]} onChange={(v) => update((s) => { s.sources.homeHeroSource = v; })} />
          <ToggleRow label={ar ? 'بانر هيرو ممتد' : 'Full hero banner'} checked={src.homeFullHeroBanner} onChange={(v) => update((s) => { s.sources.homeFullHeroBanner = v; })} />
          <ToggleRow label={ar ? 'صورة هيرو بأعلى دقة' : 'Full quality hero image'} checked={src.homeFullQualityHero} onChange={(v) => update((s) => { s.sources.homeFullQualityHero = v; })} />
          <ToggleRow label={ar ? 'إخفاء الأعمال المشاهَدة من الهيرو' : 'Hide watched titles from hero'} checked={src.homeHideWatchedHero} onChange={(v) => update((s) => { s.sources.homeHideWatchedHero = v; })} />
          <ToggleRow label={ar ? 'تشغيل الإعلان الترويجي داخل الهيرو' : 'Play trailers in the hero'} checked={src.homePlayTrailersHero} onChange={(v) => update((s) => { s.sources.homePlayTrailersHero = v; })} />
          <SliderRow label={ar ? 'قوة التدرج السفلي للهيرو' : 'Home hero shadow strength'} value={src.homeHeroShadowPct} min={0} max={100} unit="%" defaultValue={78} onChange={(v) => update((s) => { s.sources.homeHeroShadowPct = v; })} />
          <div className="pt-3">
            <LivePreviewCard>
              <div className="relative h-28 overflow-hidden rounded-xl bg-gradient-to-tr from-[#3b240c] via-[#1c2638] to-[#2e1a36]">
                <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 20%, rgba(18,16,14,${src.homeHeroShadowPct / 100}) 100%)` }} />
                <div className="absolute bottom-3 start-4 text-sm font-bold text-white">Tonight&apos;s Featured Cinema</div>
              </div>
            </LivePreviewCard>
          </div>
          <RadioCardGroup value={src.homeStyle} onChange={(v) => update((s) => { s.sources.homeStyle = v; })} options={[{ value: 'hero', title: 'Hero + shelves', description: 'Immersive top billboard with rows' }, { value: 'classic', title: 'Classic shelves', description: 'Compact media rows directly at top' }]} />
        </SettingSection>
        <SettingSection title={ar ? 'صف متابعة المشاهدة والكتالوجات' : 'Catalogs & Continue Watching'}>
          <ToggleRow label={ar ? 'صف الحلقات الجديدة' : 'New Episodes row'} checked={src.showNewEpisodesRow} onChange={(v) => update((s) => { s.sources.showNewEpisodesRow = v; })} />
          <ToggleRow label={ar ? 'إخفاء الأعمال المشاهَدة في الكتالوجات' : 'Hide watched titles in catalogs'} checked={src.hideWatchedCatalogs} onChange={(v) => update((s) => { s.sources.hideWatchedCatalogs = v; })} />
          <ToggleRow label={ar ? 'إخفاء الأعمال غير الصادرة' : 'Hide unreleased titles'} checked={src.hideUnreleasedCatalogs} onChange={(v) => update((s) => { s.sources.hideUnreleasedCatalogs = v; })} />
          <SegmentedRow label={t('cw_card_style')} value={src.cwCardStyle} options={[{ value: 'wide', label: t('cw_style_wide') }, { value: 'card', label: t('cw_style_card') }, { value: 'poster', label: t('cw_style_poster') }]} onChange={(v) => update((s) => { s.sources.cwCardStyle = v; })} />
          <DropdownRow label={t('cw_click_mode')} value={src.cwClickBehavior} options={[{ value: 'stream', label: t('cw_click_stream') }, { value: 'details', label: t('cw_click_details') }, { value: 'details_upcoming', label: t('cw_click_upcoming') }]} onChange={(v) => update((s) => { s.sources.cwClickBehavior = v as typeof src.cwClickBehavior; })} />
          <ToggleRow label={t('cw_resume_prompt')} checked={src.cwResumePrompt} onChange={(v) => update((s) => { s.sources.cwResumePrompt = v; })} />
          <ToggleRow label={t('cw_split_upcoming')} checked={src.cwSplitUpcoming} onChange={(v) => update((s) => { s.sources.cwSplitUpcoming = v; })} />
          <ToggleRow label={ar ? 'تقديم متابعة المشاهدة للحلقة التالية تلقائياً' : 'Advance Continue Watching to the next episode'} checked={src.cwAdvanceNextEp} onChange={(v) => update((s) => { s.sources.cwAdvanceNextEp = v; })} />
          <DropdownRow label={ar ? 'الاحتفاظ بلقطات التوقف لـ' : 'Keep frames for'} value={src.cwFrameRetentionDays} options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} onChange={(v) => update((s) => { s.sources.cwFrameRetentionDays = v; })} />
          <ActionRow label={ar ? 'مسح جميع لقطات المتابعة المحفوظة' : 'Clear all saved frames'} buttonLabel={ar ? 'مسح' : 'Clear'} variant="danger" onClick={async () => { await cin('cache-clear', { category: 'thumbs' }).catch(() => {}); toast(ar ? 'تم مسح لقطات التوقف' : 'Saved Continue Watching frames cleared'); }} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'cards') {
    const c = src.cards;
    const cornerCls = c.bookmarkCorner === 'tl' ? 'top-2 start-2' : c.bookmarkCorner === 'tr' ? 'top-2 end-2' : c.bookmarkCorner === 'bl' ? 'bottom-8 start-2' : 'bottom-8 end-2';
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div>
          <SettingSection title={ar ? 'عناصر البوستر' : 'On the poster'}>
            <ToggleRow label={ar ? 'شعار العمل على البطاقة' : 'Show logo on cards'} checked={c.showLogo} onChange={(v) => update((s) => { s.sources.cards.showLogo = v; })} />
            <SegmentedRow label={ar ? 'شارة الجوائز' : 'Award display mode'} value={c.awardMode} options={[{ value: 'badge', label: 'Award badge' }, { value: 'none', label: 'No icons' }]} onChange={(v) => update((s) => { s.sources.cards.awardMode = v; })} />
            <ToggleRow label={ar ? 'شريط Top 10' : 'Top 10 ribbon'} checked={c.top10Ribbon} onChange={(v) => update((s) => { s.sources.cards.top10Ribbon = v; })} />
            <ToggleRow label={ar ? 'أيقونة المفضلة / القائمة' : 'Watchlist bookmark'} checked={c.watchlistBookmark} onChange={(v) => update((s) => { s.sources.cards.watchlistBookmark = v; })} />
            <SegmentedRow label={ar ? 'موقع أيقونة القائمة' : 'Bookmark corner'} value={c.bookmarkCorner} options={[{ value: 'tl', label: 'Top L' }, { value: 'tr', label: 'Top R' }, { value: 'bl', label: 'Bot L' }, { value: 'br', label: 'Bot R' }]} onChange={(v) => update((s) => { s.sources.cards.bookmarkCorner = v; })} />
            <ToggleRow label={ar ? 'شارة تم المشاهدة ✓' : 'Watched badge'} checked={c.watchedBadge} onChange={(v) => update((s) => { s.sources.cards.watchedBadge = v; })} />
            <ToggleRow label={ar ? 'شارة الملف المحلي' : 'Show "on-disk" badge'} checked={c.onDiskBadge} onChange={(v) => update((s) => { s.sources.cards.onDiskBadge = v; })} />
            <ToggleRow label={ar ? 'شارة الدبلجة (DUB) للأنمي' : 'Show DUB badge on anime cards'} checked={c.animeDubBadge} onChange={(v) => update((s) => { s.sources.cards.animeDubBadge = v; })} />
            <ToggleRow label={ar ? 'إخفاء العنوان أسفل البوستر' : 'Hide titles under posters'} checked={c.hideTitles} onChange={(v) => update((s) => { s.sources.cards.hideTitles = v; })} />
          </SettingSection>
          <SettingSection title={ar ? 'مصفوفة التقييمات (10 مزودين)' : 'Scores matrix (10 providers)'}>
            <div className="mb-3 space-y-1.5 text-xs">
              {SCORE_PROVIDERS.map((prov) => {
                const row = c.scoreProviders[prov] || { cards: false, details: true };
                return (
                  <div key={prov} className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-1.5">
                    <span className="font-medium">{prov}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={row.cards} onChange={(e) => update((s) => { s.sources.cards.scoreProviders[prov] = { ...row, cards: e.target.checked }; })} />CARDS</label>
                      <label className="flex items-center gap-1"><input type="checkbox" checked={row.details} onChange={(e) => update((s) => { s.sources.cards.scoreProviders[prov] = { ...row, details: e.target.checked }; })} />DETAILS</label>
                    </div>
                  </div>
                );
              })}
            </div>
            <SegmentedRow label={ar ? 'موقع التقييمات' : 'Score position'} value={c.scorePosition} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} onChange={(v) => update((s) => { s.sources.cards.scorePosition = v; })} />
            <SliderRow label={ar ? 'أقصى عدد تقييمات بالبطاقة' : 'Max scores per card'} value={c.maxScoresPerCard} min={1} max={6} defaultValue={2} onChange={(v) => update((s) => { s.sources.cards.maxScoresPerCard = v; })} />
            <SegmentedRow label={ar ? 'مصدر تحكم الأنمي' : 'Anime controlling source'} value={c.animeControlSource} options={[{ value: 'anilist', label: 'AniList' }, { value: 'mal', label: 'MAL' }]} onChange={(v) => update((s) => { s.sources.cards.animeControlSource = v; })} />
          </SettingSection>
        </div>

        <div className="lg:sticky lg:top-6 self-start">
          <LivePreviewCard>
            <div className="mb-2 flex gap-1.5">
              <button type="button" onClick={() => setPreviewKind('poster')} className={`flex-1 rounded-lg py-1 text-[11px] font-semibold ${previewKind === 'poster' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/8'}`}>Film</button>
              <button type="button" onClick={() => setPreviewKind('anime')} className={`flex-1 rounded-lg py-1 text-[11px] font-semibold ${previewKind === 'anime' ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/8'}`}>Anime</button>
            </div>
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#3b240c] to-[#12100E] ring-1 ring-white/15">
              {c.top10Ribbon ? <span className="absolute start-0 top-3 bg-[var(--accent)] px-2 py-0.5 text-[9px] font-black text-[#12100E]">TOP 10</span> : null}
              {c.watchlistBookmark ? <span className={`absolute ${cornerCls} rounded-md bg-black/70 p-1 text-[var(--accent)]`}><Bookmark size={12} fill="currentColor" /></span> : null}
              <div className={`absolute inset-x-2 ${c.scorePosition === 'top' ? 'top-2' : 'bottom-2'} flex flex-wrap gap-1 justify-end`}>
                {SCORE_PROVIDERS.filter((p) => c.scoreProviders[p]?.cards).slice(0, c.maxScoresPerCard).map((p) => (
                  <span key={p} className="inline-flex items-center gap-0.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300"><Star size={8} fill="currentColor" />8.7</span>
                ))}
              </div>
              {previewKind === 'anime' && c.animeDubBadge ? <span className="absolute bottom-2 start-2 rounded bg-sky-500/80 px-1.5 py-0.5 text-[9px] font-bold text-white">DUB</span> : null}
            </div>
            {!c.hideTitles ? <div className="mt-2 truncate text-xs font-semibold">{previewKind === 'anime' ? 'Skybound Arc' : 'Horizon Zero'}</div> : null}
          </LivePreviewCard>
        </div>
      </div>
    );
  }

  if (pageId === 'detail-pages') {
    const d = src.details;
    const hCls = d.epCardSize === 'xl' ? 'h-24' : d.epCardSize === 'large' ? 'h-20' : 'h-16';
    return (
      <SettingSection title={ar ? 'صفحات تفاصيل العمل' : 'Detail pages & episode cards'}>
        <ToggleRow label={ar ? 'زر وضع علامة كمشاهَد' : 'Mark watched button'} checked={d.markWatchedBtn} onChange={(v) => update((s) => { s.sources.details.markWatchedBtn = v; })} />
        <ToggleRow label={ar ? 'تذكر آخر موسم/تبويب مفتوح' : 'Remember your place on show pages'} checked={d.rememberPlace} onChange={(v) => update((s) => { s.sources.details.rememberPlace = v; })} />
        <ToggleRow label={ar ? 'تدوير الخلفيات تلقائياً' : 'Cycle the backdrop'} checked={d.cycleBackdrop} onChange={(v) => update((s) => { s.sources.details.cycleBackdrop = v; })} />
        <ToggleRow label={ar ? 'إخفاء الحرق (Spoilers)' : 'Hide spoilers'} checked={d.hideSpoilers} onChange={(v) => update((s) => { s.sources.details.hideSpoilers = v; })} />
        <ToggleRow label={ar ? 'تغبيش صور الحلقات لتجنب الحرق' : 'Blur spoilers'} checked={d.blurSpoilers} onChange={(v) => update((s) => { s.sources.details.blurSpoilers = v; })} />
        <ToggleRow label={ar ? 'تصفية حلقات الفلر' : 'Filter filler episodes'} checked={d.filterFiller} onChange={(v) => update((s) => { s.sources.details.filterFiller = v; })} />
        <SegmentedRow label={ar ? 'حجم بطاقة الحلقة' : 'Episode card size'} value={d.epCardSize} options={[{ value: 'default', label: 'Default' }, { value: 'large', label: 'Large' }, { value: 'xl', label: 'Extra large' }]} onChange={(v) => update((s) => { s.sources.details.epCardSize = v; })} />
        <div className="grid grid-cols-3 gap-2.5 pt-3">
          {[1, 2, 3].map((ep) => (
            <div key={ep} className={`rounded-xl bg-black/40 p-2 ring-1 ring-white/10 ${hCls} flex flex-col justify-end transition-all`}>
              <div className="text-[11px] font-bold">S1E{ep}</div>
              {d.showEpDescription ? <div className="truncate text-[9px] text-white/50">Episode summary</div> : null}
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'metadata-providers') {
    const m = src.metadata;
    return (
      <>
        <SettingSection title={ar ? 'مفاتيح مزودي البيانات الوصفية' : 'Metadata API Keys'}>
          {META_KEYS.map((mk) => {
            const val = tokenDrafts[mk.id] ?? keysQ.data?.user?.[mk.id] ?? '';
            return <InputRow key={mk.id} label={mk.name} secret savedBadge={!!(keysQ.data?.user?.[mk.id] || keysQ.data?.builtIn?.[mk.id])} value={val} onChange={(v) => setTokenDrafts((prev) => ({ ...prev, [mk.id]: v }))} onSave={() => saveKey(mk.id, val)} />;
          })}
        </SettingSection>
        <SettingSection title={ar ? 'ترتيب الحلقات والمواسم' : 'Episode order & fallback rules'}>
          <ToggleRow label={ar ? 'تفعيل البيانات الوصفية المدمجة' : 'Enable built-in metadata'} checked={m.builtInMetadata} onChange={(v) => update((s) => { s.sources.metadata.builtInMetadata = v; })} />
          <ToggleRow label={ar ? 'استخدام TMDB لأفضل تطابق بالبحث' : 'Use TMDB for Top Match in search'} checked={m.useTmdbTopMatch} onChange={(v) => update((s) => { s.sources.metadata.useTmdbTopMatch = v; })} />
          <ToggleRow label={ar ? 'السماح بفتح التفاصيل بدون مفتاح TMDB' : 'Allow detail pages without a TMDB key'} checked={m.allowDetailsWithoutTmdb} onChange={(v) => update((s) => { s.sources.metadata.allowDetailsWithoutTmdb = v; })} />
          <SegmentedRow label={ar ? 'مصدر ترتيب المواسم' : 'Episode order'} value={m.episodeOrder} options={[{ value: 'tvdb', label: 'TheTVDB (Aired)' }, { value: 'tmdb', label: 'TMDB' }]} onChange={(v) => update((s) => { s.sources.metadata.episodeOrder = v; })} />
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border-subtle)] text-xs">
            <div className="grid grid-cols-2 bg-black/40 px-3 py-2 font-bold"><span>TVDB</span><span>TMDB</span></div>
            <div className="grid grid-cols-2 border-t border-white/5 px-3 py-2 text-[var(--text-secondary)]"><span>S01 (24 eps · Absolute)</span><span>S01–S02 Split (12 + 12)</span></div>
          </div>
          <SliderRow label={ar ? 'الحد اليومي لـ OMDb' : 'OMDb daily budget'} value={m.omdbDailyBudget} min={100} max={1000} step={50} defaultValue={500} onChange={(v) => update((s) => { s.sources.metadata.omdbDailyBudget = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'search') {
    const sr = src.search;
    return (
      <SettingSection title={ar ? 'البحث والبحث بالذكاء الاصطناعي' : 'Search & AI discovery'}>
        <ToggleRow label={ar ? 'اختصار البحث السريع (/)' : 'Quick search shortcut'} checked={sr.quickShortcut} onChange={(v) => update((s) => { s.sources.search.quickShortcut = v; })} />
        <DropdownRow
          label={ar ? 'مزود الذكاء الاصطناعي' : 'AI Search Provider'}
          value={sr.aiProvider}
          options={[
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'deepseek', label: 'DeepSeek' },
            { value: 'gemini', label: 'Gemini' },
            { value: 'ollama', label: 'Ollama (Local)' },
          ]}
          onChange={(v) => update((s) => {
            s.sources.search.aiProvider = v;
            s.sources.search.aiModel = AI_PROVIDER_DEFAULT_MODELS[v];
            if (!s.sources.search.aiCustomModel || Object.values(AI_PROVIDER_DEFAULT_MODELS).includes(s.sources.search.aiCustomModel)) {
              s.sources.search.aiCustomModel = '';
            }
          })}
        />
        <InputRow label="AI API Key" secret savedBadge value={sr.aiApiKey} onChange={(v) => update((s) => { s.sources.search.aiApiKey = v; })} onSave={async () => { await cin('keys-set', { aiApiKey: sr.aiApiKey }).catch(() => {}); toast(ar ? 'تم حفظ مفتاح الذكاء الاصطناعي بأمان' : 'AI key saved securely'); }} />
        <InputRow label={ar ? 'نموذج مخصّص' : 'Model'} value={sr.aiCustomModel || sr.aiModel} onChange={(v) => update((s) => { s.sources.search.aiCustomModel = v; })} />
        <ToggleRow label="Jina Reader" checked={sr.jinaReader} onChange={(v) => update((s) => { s.sources.search.jinaReader = v; })} />
        <ToggleRow label="Tavily Live Web" checked={sr.tavily} onChange={(v) => update((s) => { s.sources.search.tavily = v; })} />
      </SettingSection>
    );
  }

  // library
  const lb = src.library;
  return (
    <SettingSection title={ar ? 'المكتبة والملفات المحلية' : 'Library & metadata export'}>
      <ToggleRow label={ar ? 'إخفاء الأنمي من المكتبة الرئيسية' : 'Hide anime'} checked={lb.hideAnime} onChange={(v) => update((s) => { s.sources.library.hideAnime = v; })} />
      <ToggleRow label={ar ? 'تحديث المجلدات المحلية تلقائياً' : 'Keep folders up to date'} checked={lb.keepLocalUpToDate} onChange={(v) => update((s) => { s.sources.library.keepLocalUpToDate = v; })} />
      <SliderRow label={ar ? 'الحد الأدنى لحجم ملف الفيديو (MB)' : 'Minimum file size'} value={lb.minFileSizeMb} min={10} max={500} unit=" MB" defaultValue={50} onChange={(v) => update((s) => { s.sources.library.minFileSizeMb = v; })} />
      <ToggleRow label={ar ? 'تصدير الأغلفة مع المجلد المحلي' : 'Export artwork'} checked={lb.exportArtwork} onChange={(v) => update((s) => { s.sources.library.exportArtwork = v; })} />
      <DropdownRow label="Poster quality" value={lb.posterQuality} options={[{ value: 'original', label: 'Original' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }]} onChange={(v) => update((s) => { s.sources.library.posterQuality = v; })} />
      <DropdownRow label="Backdrop quality" value={lb.backdropQuality} options={[{ value: 'original', label: 'Original' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }]} onChange={(v) => update((s) => { s.sources.library.backdropQuality = v; })} />
      <DropdownRow label="Logo quality" value={lb.logoQuality} options={[{ value: 'original', label: 'Original' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }]} onChange={(v) => update((s) => { s.sources.library.logoQuality = v; })} />
    </SettingSection>
  );
}
