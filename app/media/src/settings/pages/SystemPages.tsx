import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Copy, Plus, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { cin, invoke, type DiagnosticsReport } from '../../api';
import { APP_BRAND, APP_BUILD, APP_NAME, APP_VERSION } from '../../config/appBrand';
import { useHost, useT } from '../../host';
import {
  ActionRow, DropdownRow, InfoBanner, InputRow, SegmentedRow, SettingSection, ToggleRow,
} from '../primitives';
import { useSettingsStore, type AutomationRule, type SettingsPageId } from '../useSettingsStore';

interface CacheStats {
  totalBytes: number;
  diskBytes: number;
  chromiumBytes: number;
  limitGb: number;
  limitBytes: number;
  streamDir: string;
  categories: Record<string, { bytes: number; files: number }>;
}

const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB`
    : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB`
    : `${Math.max(0, Math.round(b / 1024))} KB`;

export function SystemPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update } = useSettingsStore();
  const sys = data.system;

  const stateQ = useQuery({
    queryKey: ['app-state'],
    queryFn: () => invoke<{
      encoders?: string[];
      routerLock?: string | null;
      settings?: {
        discordClientId?: string;
        shareStatus?: boolean;
        shareActivity?: boolean;
        spatialVoice?: boolean;
        acceptCodes?: boolean;
        ffmpeg?: string;
        isp?: string;
        preferredRelay?: string;
      };
    }>('state').catch(() => null),
    staleTime: 5000,
  });

  const [dlFolder, setDlFolder] = useState('');
  const [autoModal, setAutoModal] = useState(false);
  const [newAuto, setNewAuto] = useState<Omit<AutomationRule, 'id'>>({ event: 'new-episode', destination: 'desktop', enabled: true });
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [diagText, setDiagText] = useState('');
  const [discordClientIdDraft, setDiscordClientIdDraft] = useState('');
  const [ffmpegDraft, setFfmpegDraft] = useState('');
  const [stateHydrated, setStateHydrated] = useState(false);

  useEffect(() => {
    const st = stateQ.data?.settings;
    if (!st || stateHydrated) return;
    setStateHydrated(true);
    if (typeof st.discordClientId === 'string') setDiscordClientIdDraft(st.discordClientId);
    if (typeof st.ffmpeg === 'string') setFfmpegDraft(st.ffmpeg);
  }, [stateQ.data, stateHydrated]);

  const setAppSetting = async (patch: Record<string, unknown>) => {
    await invoke('settings', patch).catch(() => {});
    qc.invalidateQueries({ queryKey: ['app-state'] });
  };

  const refreshCache = () => {
    cin<CacheStats>('cache-stats').then((r) => r && setCacheStats(r)).catch(() => {});
  };

  useEffect(() => {
    if (pageId === 'storage-overview' || pageId === 'stream-cache' || pageId === 'caches') refreshCache();
  }, [pageId]);

  const storageRows = useMemo(() => {
    const keys = ['majlis:settings-v2', 'majlis:user-profile-v1'];
    return keys.map((k) => {
      const len = (localStorage.getItem(k) || '').length * 2;
      return { key: k, kb: Math.max(1, +(len / 1024).toFixed(1)) };
    });
  }, []);

  if (pageId === 'storage-overview') {
    const totalBytes = cacheStats?.totalBytes || 0;
    const limitBytes = cacheStats?.limitBytes || (5 * 1024 ** 3);
    const pct = limitBytes > 0 ? Math.min(100, Math.max(totalBytes > 0 ? 2 : 0, Math.round((totalBytes / limitBytes) * 100))) : 0;
    const catList = [
      { id: 'stream', label: ar ? 'بث التورنت المؤقت' : 'Torrent Stream Cache' },
      { id: 'http', label: ar ? 'ذاكرة الإضافات والبيانات' : 'Addon & Metadata Cache' },
      { id: 'shaders', label: ar ? 'مظللات الفيديو (GPU Shaders)' : 'GPU Shader Cache' },
      { id: 'subs', label: ar ? 'ملفات الترجمة المؤقتة' : 'Subtitle Temp Cache' },
      { id: 'songs', label: ar ? 'مقاطع صوت الأصدقاء' : 'Friend Profile Songs' },
      { id: 'artwork', label: ar ? 'كاش الصور والواجهة' : 'Artwork & UI Cache' },
    ];
    return (
      <SettingSection title={ar ? 'نظرة عامة على التخزين' : 'Storage overview'}>
        <div className="py-2 space-y-2">
          <div className="flex justify-between text-xs">
            <span>{ar ? 'إجمالي الكاش المحلي' : 'Managed Local Cache'}</span>
            <span dir="ltr" className="font-mono text-[var(--accent)]">
              {fmtBytes(totalBytes)} {limitBytes > 0 ? `/ ${fmtBytes(limitBytes)}` : ''}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="pt-3 space-y-1.5 text-xs">
          {catList.map((c) => {
            const st = cacheStats?.categories?.[c.id] || { bytes: 0, files: 0 };
            return (
              <div key={c.id} className="flex justify-between rounded-lg bg-black/30 px-3 py-2">
                <span className="text-white/80">{c.label} <span className="font-mono text-[10px] text-white/40">({st.files})</span></span>
                <span dir="ltr" className="font-mono text-[var(--accent)]">{fmtBytes(st.bytes)}</span>
              </div>
            );
          })}
          {storageRows.map((r) => (
            <div key={r.key} className="flex justify-between rounded-lg bg-black/20 px-3 py-2">
              <span dir="ltr" className="font-mono text-white/60">{r.key}</span>
              <span dir="ltr" className="font-mono text-white/75">{r.kb} KB</span>
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'stream-cache') {
    const streamBytes = cacheStats?.categories?.stream?.bytes || 0;
    return (
      <SettingSection title={ar ? 'ذاكرة البث المؤقتة' : 'Stream cache'}>
        <DropdownRow label={ar ? 'الاحتفاظ بالملفات المؤقتة لمدة' : 'Keep cached files for'} value={sys.keepCachedDays} options={[{ value: 1, label: '1 day' }, { value: 3, label: '3 days' }, { value: 7, label: '7 days' }, { value: 0, label: 'Forever' }]} onChange={(v) => update((s) => { s.system.keepCachedDays = v; })} />
        <DropdownRow label={ar ? 'الحد الأقصى للمساحة (LRU)' : 'Keep at most (LRU cap)'} value={sys.maxCacheGb} options={[{ value: 5, label: '5 GB' }, { value: 10, label: '10 GB' }, { value: 25, label: '25 GB' }, { value: 0, label: 'Unlimited' }]} onChange={(v) => update((s) => { s.system.maxCacheGb = v; })} />
        <ToggleRow label={ar ? 'حذف الكاش فور الانتهاء من المشاهدة' : 'Delete after I finish watching'} checked={sys.deleteCacheAfterWatch} onChange={(v) => update((s) => { s.system.deleteCacheAfterWatch = v; })} />
        <InputRow label={ar ? 'مسار مجلد الكاش' : 'Cache location'} value={sys.cachePath} placeholder={cacheStats?.streamDir || '%TEMP%\\majlis-stremio-cache'} onChange={(v) => update((s) => { s.system.cachePath = v; })} />
        <ActionRow
          label={ar ? 'الملفات المؤقتة' : 'Temporary stream files'}
          description={`${fmtBytes(streamBytes)}${cacheStats?.streamDir ? ` · ${cacheStats.streamDir}` : ''}`}
          buttonLabel={ar ? 'تنظيف الكاش' : 'Clear cache'}
          variant="danger"
          onClick={async () => {
            const res = await cin<{ stats?: CacheStats }>('cache-clear', { category: 'stream' }).catch(() => null);
            if (res?.stats) setCacheStats(res.stats);
            else refreshCache();
            toast(ar ? 'تم تنظيف ذاكرة البث بنجاح' : 'Stream cache cleared');
          }}
        />
      </SettingSection>
    );
  }

  if (pageId === 'caches') {
    const ITEMS: { category: string; catKey: string; label: string }[] = [
      { category: 'metadata', catKey: 'http', label: ar ? 'بيانات الحلقات والمواسم (Metadata)' : 'Episode and season metadata' },
      { category: 'http', catKey: 'http', label: ar ? 'ذاكرة اختيار المصادر (HTTP)' : 'Stream picker cache' },
      { category: 'artwork', catKey: 'artwork', label: ar ? 'ذاكرة البوسترات والرسوميات' : 'Artwork & poster cache' },
      { category: 'stream', catKey: 'stream', label: ar ? 'ذاكرة البث المؤقتة' : 'Live & torrent stream cache' },
      { category: 'subs', catKey: 'subs', label: ar ? 'ملفات الترجمة المؤقتة' : 'Subtitle & frame temp cache' },
      { category: 'shaders', catKey: 'shaders', label: ar ? 'كاش مظللات الفيديو (Shaders)' : 'GPU shader pipeline cache' },
    ];
    return (
      <SettingSection
        title={ar ? 'إدارة الذاكرة المخبأة' : 'Caches breakdown'}
        rightAction={
          <button
            type="button"
            onClick={async () => {
              const res = await cin<{ stats?: CacheStats }>('cache-clear', { category: 'all' }).catch(() => null);
              if (res?.stats) setCacheStats(res.stats);
              toast(ar ? 'تم مسح جميع الملفات المؤقتة غير النشطة' : 'All inactive caches cleared');
            }}
            className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/30"
          >
            {ar ? 'مسح الكل' : 'Clear all'}
          </button>
        }
      >
        {ITEMS.map((item) => {
          const st = cacheStats?.categories?.[item.catKey] || { bytes: 0, files: 0 };
          return (
            <ActionRow
              key={item.label}
              label={item.label}
              description={`${fmtBytes(st.bytes)} · ${st.files} ${ar ? 'ملف' : 'files'}`}
              buttonLabel={ar ? 'مسح' : 'Clear'}
              onClick={async () => {
                const res = await cin<{ stats?: CacheStats }>('cache-clear', { category: item.category }).catch(() => null);
                if (res?.stats) setCacheStats(res.stats);
                else refreshCache();
                toast(ar ? `تم مسح: ${item.label}` : `${item.label} cleared`);
              }}
            />
          );
        })}
      </SettingSection>
    );
  }

  if (pageId === 'notification-destinations') {
    return (
      <SettingSection title={ar ? 'وجهات الإشعارات' : 'Notification destinations'}>
        <ToggleRow label={ar ? 'إشعارات سطح المكتب (Windows Toast)' : 'Desktop notifications (Windows Toast)'} checked={sys.desktopNotifications} onChange={(v) => update((s) => { s.system.desktopNotifications = v; })} />
        <ActionRow
          label={ar ? 'اختبار إشعارات ويندوز الفورية' : 'Test Notifications & Webhooks'}
          description={ar ? 'يرسل إشعاراً محلياً بالإضافة إلى Discord و Telegram المفعّلين' : "Dispatches a test alert to Desktop, Discord Webhook & Telegram Bot"}
          buttonLabel={ar ? 'إرسال إشعار تجريبي' : 'Send test'}
          onClick={async () => {
            const res = await cin<{
              ok?: boolean;
              desktop?: boolean;
              discord?: { attempted?: boolean; ok?: boolean };
              telegram?: { attempted?: boolean; ok?: boolean };
            }>('notif-test').catch(() => null);
            const sent: string[] = [];
            if (res?.desktop) sent.push(ar ? 'النظام' : 'Desktop');
            if (res?.discord?.attempted) sent.push(res.discord.ok ? 'Discord ✓' : 'Discord ✕');
            if (res?.telegram?.attempted) sent.push(res.telegram.ok ? 'Telegram ✓' : 'Telegram ✕');
            toast(sent.length
              ? (ar ? `نتيجة الإرسال: ${sent.join(' · ')}` : `Dispatched: ${sent.join(' · ')}`)
              : (ar ? 'تم إرسال الإشعار التجريبي' : 'Test notification dispatched'));
          }}
        />
        <InputRow label="Discord Webhook URL" value={sys.discordWebhookUrl} secret savedBadge placeholder="https://discord.com/api/webhooks/..." onChange={(v) => update((s) => { s.system.discordWebhookUrl = v; })} onSave={async () => { await invoke('settings', { discordWebhookUrl: sys.discordWebhookUrl }).catch(() => {}); toast(ar ? 'تم حفظ Webhook بأمان' : 'Discord webhook saved'); }} />
        <InputRow label="Telegram Bot Token" value={sys.telegramBotToken} secret savedBadge onChange={(v) => update((s) => { s.system.telegramBotToken = v; })} />
        <InputRow label="Telegram Chat ID" value={sys.telegramChatId} savedBadge onChange={(v) => update((s) => { s.system.telegramChatId = v; })} onSave={async () => { await invoke('settings', { telegramBotToken: sys.telegramBotToken, telegramChatId: sys.telegramChatId }).catch(() => {}); toast(ar ? 'تم حفظ إعدادات تيليجرام بأمان' : 'Telegram settings saved'); }} />
      </SettingSection>
    );
  }

  if (pageId === 'notification-sources') {
    return (
      <>
        <SettingSection title={ar ? 'قواعد الإشعارات والأتمتة' : 'Notification sources & automations'} rightAction={<button type="button" onClick={() => setAutoModal(true)} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}><Plus size={12} />Add automation</button>}>
          {sys.automations.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2.5 text-xs">
              <div className="flex items-center gap-2"><Bell size={14} className="text-[var(--accent)]" /><span className="font-semibold">{a.event}</span><span>→</span><span className="uppercase">{a.destination}</span></div>
              <button type="button" onClick={() => update((s) => { s.system.automations = s.system.automations.filter((x) => x.id !== a.id); })} className="text-red-300"><Trash2 size={13} /></button>
            </div>
          ))}
        </SettingSection>
        {autoModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setAutoModal(false); }}>
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#161310] p-5 space-y-3">
              <h3 className="text-sm font-bold">{ar ? 'إضافة أتمتة' : 'Add notification automation'}</h3>
              <select value={newAuto.event} onChange={(e) => setNewAuto({ ...newAuto, event: e.target.value as AutomationRule['event'] })} className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10"><option value="new-episode">New episode</option><option value="upcoming">Upcoming release</option><option value="watchlist">Watchlist update</option></select>
              <select value={newAuto.destination} onChange={(e) => setNewAuto({ ...newAuto, destination: e.target.value as AutomationRule['destination'] })} className="w-full rounded-xl bg-black/40 px-3 py-2 text-xs ring-1 ring-white/10"><option value="desktop">Desktop</option><option value="discord">Discord</option><option value="telegram">Telegram</option></select>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setAutoModal(false)} className="rounded-full bg-white/10 px-4 py-1.5 text-xs">Cancel</button><button type="button" onClick={() => { update((s) => { s.system.automations.push({ id: `au-${Date.now()}`, ...newAuto }); }); setAutoModal(false); }} className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Add</button></div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (pageId === 'downloads-folders') {
    return (
      <SettingSection title={ar ? 'التنزيلات والمجلدات' : 'Downloads & folders'}>
        <ActionRow label={ar ? 'مجلد تنزيل الأفلام والمسلسلات' : 'Movies & TV Download folder'} description={dlFolder || 'Default Majlis downloads folder'} buttonLabel={ar ? 'اختيار مجلد' : 'Choose folder'} onClick={async () => { const p = await cin<string | null>('dl-folder-pick').catch(() => null); if (p) setDlFolder(p); }} />
        <ToggleRow label={ar ? 'تنظيم مجلدات الأفلام والمسلسلات تلقائياً' : 'Organize movies and shows'} checked={sys.organizeDownloads} onChange={(v) => update((s) => { s.system.organizeDownloads = v; })} />
        <InputRow label={ar ? 'مجلد الإضافات / الوسائط المحلية' : 'Extras / Media folder'} value={sys.extrasFolderPath} placeholder="C:\Media\Local" onChange={(v) => update((s) => { s.system.extrasFolderPath = v; })} />
        <ToggleRow label={ar ? 'إنشاء مجلدات فرعية' : 'Create subfolders'} checked={sys.extrasSubfolders} onChange={(v) => update((s) => { s.system.extrasSubfolders = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'startup-system') {
    return (
      <SettingSection title={ar ? 'سلوك النافذة والبدء وصينية النظام' : 'Startup, Tray & System'}>
        <ToggleRow label={ar ? 'الإغلاق إلى صينية النظام بدلاً من الإنهاء' : 'Close to the system tray'} checked={sys.closeToTray} onChange={(v) => update((s) => { s.system.closeToTray = v; })} />
        <ToggleRow label={ar ? 'التصغير إلى صينية النظام' : 'Minimize to system tray'} checked={sys.minimizeToTray} onChange={(v) => update((s) => { s.system.minimizeToTray = v; })} />
        <ToggleRow label={ar ? 'البدء مصغراً في صينية النظام' : 'Start minimized in tray'} checked={sys.startMinimized} onChange={(v) => update((s) => { s.system.startMinimized = v; })} />
        <ToggleRow label={ar ? 'التشغيل تلقائياً مع بدء ويندوز' : 'Launch on Windows startup'} checked={sys.launchOnStartup} onChange={(v) => update((s) => { s.system.launchOnStartup = v; })} />
        <ToggleRow label={ar ? 'إبقاء النافذة في المقدمة دائماً' : 'Always on top'} checked={sys.alwaysOnTop} onChange={(v) => update((s) => { s.system.alwaysOnTop = v; })} />
        <ToggleRow label={ar ? 'إيقاف التشغيل مؤقتاً عند التصغير' : 'Pause on minimize'} checked={sys.pauseOnMinimize} onChange={(v) => update((s) => { s.system.pauseOnMinimize = v; })} />
        <ToggleRow label={ar ? 'إيقاف مؤقت عند فقدان التركيز' : 'Pause on focus lost'} checked={sys.pauseOnFocusLost} onChange={(v) => update((s) => { s.system.pauseOnFocusLost = v; })} />
        <SegmentedRow label={ar ? 'محرك الرسوميات' : 'Graphics backend'} value={sys.graphicsBackend} options={[{ value: 'auto', label: 'Automatic' }, { value: 'd3d', label: 'Direct3D' }, { value: 'opengl', label: 'OpenGL' }, { value: 'vulkan', label: 'Vulkan' }, { value: 'software', label: 'Software' }]} onChange={(v) => update((s) => { s.system.graphicsBackend = v; })} />
      </SettingSection>
    );
  }

  if (pageId === 'privacy-discord') {
    const d = sys.discordRpc;
    const appSt = stateQ.data?.settings;
    return (
      <>
        <SettingSection title={ar ? 'الخصوصية واللعب الجماعي' : 'Privacy & Co-op Room'}>
          <ToggleRow label={ar ? 'حظر الإعلانات والمتتبعات الخارجية' : 'Block ads & trackers'} checked={sys.blockAdsTrackers} onChange={(v) => update((s) => { s.system.blockAdsTrackers = v; })} />
          <ToggleRow label={ar ? 'مشاركة حالة الاتصال مع الأصدقاء' : 'Share online status'} checked={appSt?.shareStatus !== false} onChange={(v) => setAppSetting({ shareStatus: v })} />
          <ToggleRow label={ar ? 'مشاركة سجل المشاهدة والتقييمات مع الأصدقاء' : 'Share watch activity with friends'} checked={appSt?.shareActivity !== false} onChange={(v) => setAppSetting({ shareActivity: v })} />
          <ToggleRow label={ar ? 'صوت مكاني لأعضاء السهرة (Spatial Voice)' : 'Spatial voice audio'} checked={appSt?.spatialVoice !== false} onChange={(v) => setAppSetting({ spatialVoice: v })} />
          <ToggleRow label={ar ? 'قبول رموز الغرف المؤقتة السريعة' : 'Accept temporary room codes'} checked={appSt?.acceptCodes !== false} onChange={(v) => setAppSetting({ acceptCodes: v })} />
        </SettingSection>
        <SettingSection title="Discord Rich Presence">
          <InputRow
            label={ar ? 'معرّف تطبيق ديسكورد (Discord Client ID)' : 'Discord Application Client ID'}
            description={ar ? 'اختياري: معرّف عام لعرض حالة مجلس في ديسكورد' : 'Optional public application ID for custom Discord RPC'}
            value={discordClientIdDraft}
            placeholder="123456789012345678"
            savedBadge
            onChange={setDiscordClientIdDraft}
            onSave={async () => {
              await setAppSetting({ discordClientId: discordClientIdDraft.trim() });
              toast(ar ? 'تم حفظ معرّف ديسكورد' : 'Discord Client ID saved');
            }}
          />
          <ToggleRow label={ar ? 'تفعيل حالة ديسكورد (Discord RPC)' : 'Enable Discord RPC'} checked={d.enabled} onChange={(v) => update((s) => { s.system.discordRpc.enabled = v; })} />
          <ToggleRow label={ar ? 'إخفاء اسم العمل' : 'Hide the title'} checked={d.hideTitle} onChange={(v) => update((s) => { s.system.discordRpc.hideTitle = v; })} />
          <ToggleRow label={ar ? 'إظهار الحالة أثناء الإيقاف المؤقت' : 'Show while paused'} checked={d.showPaused} onChange={(v) => update((s) => { s.system.discordRpc.showPaused = v; })} />
          <ToggleRow label={ar ? 'إظهار حالة التصفح' : 'Show while browsing'} checked={d.showBrowsing} onChange={(v) => update((s) => { s.system.discordRpc.showBrowsing = v; })} />
          <ToggleRow label={ar ? 'إظهار البوستر' : 'Show poster'} checked={d.showPoster} onChange={(v) => update((s) => { s.system.discordRpc.showPoster = v; })} />
          <ToggleRow label={ar ? 'إظهار الوقت المنقضي' : 'Show elapsed time'} checked={d.showElapsed} onChange={(v) => update((s) => { s.system.discordRpc.showElapsed = v; })} />
          <ToggleRow label={ar ? 'إظهار سهرة المشاهدة المشتركة' : 'Watch party presence'} checked={d.watchPartyPresence} onChange={(v) => update((s) => { s.system.discordRpc.watchPartyPresence = v; })} />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'repair-diagnostics') {
    const encoders = stateQ.data?.encoders || [];
    const rlPath = stateQ.data?.routerLock || '';
    return (
      <>
        <DiagnosticsCenterSection ar={ar} toast={toast} qc={qc} />
        <SettingSection title={ar ? 'الإصلاح وفحص الأخطاء' : 'Repair & diagnostics'}>
          <ActionRow
            label={ar ? 'إصلاح فهرس المكتبة' : 'Repair library index'}
            description={diagText || (ar ? 'يعيد بناء فهارس المتابعة والمشاهدات وتنظيف القوائم بدون فقدان البيانات' : 'Rebuilds watched bitfields and deduplicates lists without losing data')}
            buttonLabel={ar ? 'إصلاح المكتبة' : 'Repair library'}
            onClick={async () => {
              const res = await cin<{ itemCount: number; repairedCount: number; corruptedRemoved: number }>('library-repair').catch(() => null);
              if (res) {
                const msg = ar
                  ? `تم الفحص: ${res.itemCount} عمل · تم إصلاح ${res.repairedCount} · إزالة ${res.corruptedRemoved} تالفة`
                  : `Verified ${res.itemCount} items · ${res.repairedCount} repaired · ${res.corruptedRemoved} removed`;
                setDiagText(msg);
                toast(msg);
              }
            }}
          />
          <ActionRow
            label={ar ? 'فحص الإدخالات التالفة' : 'Fix corrupted entries'}
            description={ar ? 'يفحص سلامة قاعدة المكتبة ويمسح أي حقول تالفة' : 'Scans library store for malformed entries and repairs indexes'}
            buttonLabel={ar ? 'فحص وإصلاح' : 'Scan for corruption'}
            onClick={async () => {
              const res = await cin<{ itemCount: number; repairedCount: number; corruptedRemoved: number }>('library-audit').catch(() => null);
              if (res) {
                const msg = ar
                  ? `النتيجة: ${res.corruptedRemoved} إدخال تالف · ${res.repairedCount} تم إصلاحه`
                  : `Scan complete: ${res.corruptedRemoved} corrupted · ${res.repairedCount} repaired`;
                setDiagText(msg);
                toast(msg);
              }
            }}
          />
        </SettingSection>

        <SettingSection title={ar ? 'تشخيص العتاد والأدوات واللعب الجماعي' : 'Hardware & Co-op Diagnostics'}>
          <ActionRow
            label={ar ? 'ترميز الفيديو بالعتاد (Encoders)' : 'Detected Video Encoders'}
            description={encoders.length ? encoders.join(', ') : (ar ? 'لم يتم اكتشاف مسرّع عتاد' : 'None detected')}
            buttonLabel={ar ? 'تحديث الفحص' : 'Refresh'}
            onClick={() => qc.invalidateQueries({ queryKey: ['app-state'] })}
          />
          <InputRow
            label={ar ? 'مسار أداة FFmpeg' : 'FFmpeg Executable Path'}
            description={ar ? 'اتركه فارغاً للاستخدام التلقائي المدمج أو حدد مساراً مخصصاً' : 'Leave empty for automatic built-in binary or choose a custom ffmpeg.exe'}
            value={ffmpegDraft}
            placeholder="ffmpeg"
            onChange={setFfmpegDraft}
            onSave={async () => {
              await setAppSetting({ ffmpeg: ffmpegDraft.trim() });
              toast(ar ? 'تم حفظ مسار FFmpeg' : 'FFmpeg path saved');
            }}
          />
          <ActionRow
            label={ar ? 'استعراض ملف FFmpeg من الجهاز' : 'Browse FFmpeg Binary'}
            description={ffmpegDraft || (ar ? 'افتراضي تلقائي' : 'Auto-detected')}
            buttonLabel={ar ? 'استعراض' : 'Browse'}
            onClick={async () => {
              const picked = await invoke<string | null>('pick:file', [{ name: 'ffmpeg', extensions: ['exe'] }]).catch(() => null);
              if (picked) {
                setFfmpegDraft(picked);
                await setAppSetting({ ffmpeg: picked });
                toast(ar ? 'تم تحديث مسار FFmpeg' : 'FFmpeg binary updated');
              }
            }}
          />
          <ActionRow
            label={ar ? 'تكامل RouterLock' : 'RouterLock Integration'}
            description={rlPath || (ar ? 'غير مثبت — اضغط لفتح صفحة التنزيل' : 'Not detected — click to open release page')}
            buttonLabel={rlPath ? (ar ? 'تشغيل RouterLock' : 'Launch') : (ar ? 'تنزيل RouterLock' : 'Get RouterLock')}
            extra={
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${rlPath ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/60'}`}>
                {rlPath ? (ar ? 'متوفر' : 'Found') : (ar ? 'مفقود' : 'Missing')}
              </span>
            }
            onClick={() => invoke('routerlock').catch(() => {})}
          />
          <ActionRow
            label={ar ? 'مجلد سجلات التشخيص (Diagnostics Logs)' : 'Diagnostics Logs Folder'}
            description={ar ? 'افتح مجلد السجلات لمراجعة أعطال البث أو المزامنة' : 'Open local application logs folder'}
            buttonLabel={ar ? 'فتح المجلد' : 'Open folder'}
            onClick={() => invoke('logs').catch(() => {})}
          />
        </SettingSection>
        <SaudiIspSection
          ar={ar}
          isp={stateQ.data?.settings?.isp}
          preferredRelay={stateQ.data?.settings?.preferredRelay}
          setAppSetting={setAppSetting}
          toast={toast}
        />
      </>
    );
  }

  if (pageId === 'custom-code') {
    return (
      <SettingSection title={ar ? 'أكواد التخصيص (Custom CSS)' : 'Custom CSS override'}>
        <ToggleRow label={ar ? 'إظهار محرر CSS المخصص' : 'Show custom CSS editor'} checked={sys.customCodeRevealed} onChange={(v) => update((s) => { s.system.customCodeRevealed = v; })} />
        {sys.customCodeRevealed ? (
          <div className="pt-4 space-y-3">
            <div><div className="mb-1 font-mono text-[11px] text-[var(--accent)]">Custom CSS</div><textarea dir="ltr" rows={6} value={sys.customCss} onChange={(e) => update((s) => { s.system.customCss = e.target.value; })} className="w-full rounded-xl bg-black/45 p-2.5 font-mono text-xs ring-1 ring-white/10 outline-none" /></div>
          </div>
        ) : null}
      </SettingSection>
    );
  }

  // about
  return (
    <SettingSection title={ar ? `حول ${APP_BRAND.nameAr}` : `About ${APP_NAME}`}>
      <InfoBanner title={`${APP_NAME} v${APP_VERSION}`} body={`Build ${APP_BUILD} · Local-first P2P Co-op & Cinema desktop platform.`} />
      <ActionRow label={ar ? 'إعادة تشغيل معالج البداية والإعداد' : 'Replay walkthrough wizard'} buttonLabel={ar ? 'تشغيل المعالج' : 'Replay'} onClick={() => cin('prefs-set', { cinemaOnboarded: false }).catch(() => {})} />
      <ActionRow
        label={ar ? 'استعادة التلميحات المخفية' : 'Restore dismissed hints'}
        buttonLabel={ar ? 'استعادة' : 'Restore'}
        onClick={() => {
          try {
            localStorage.removeItem('majlis:dismissed-hints');
            localStorage.removeItem('majlis:cw-dismissed');
          } catch {}
          update((s) => { s.account.sportsConsentAccepted = false; });
          toast(ar ? 'تمت استعادة التلميحات' : 'Dismissed hints restored');
        }}
      />
    </SettingSection>
  );
}

const DIAG_CHECK_LABELS: Record<string, { ar: string; en: string }> = {
  player: { ar: 'مشغل الفيديو (MPV)', en: 'Video Player (MPV)' },
  p2p: { ar: 'محرك P2P والتورنت', en: 'P2P & Torrent Engine' },
  addons: { ar: 'الإضافات والمزودون', en: 'Addons & Providers' },
  network: { ar: 'الشبكة وسهرات المشاهدة', en: 'Network & Watch Party' },
  cache: { ar: 'ذاكرة الكاش المؤقتة', en: 'Stream & HTTP Cache' },
  library: { ar: 'قاعدة بيانات المكتبة', en: 'Library Index' },
  encoders: { ar: 'مسرّعات العتاد و FFmpeg', en: 'Hardware Encoders & FFmpeg' },
};

function DiagnosticsCenterSection({
  ar,
  toast,
  qc,
}: {
  ar: boolean;
  toast: (msg: string) => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const t = useT();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runDiag = async () => {
    setBusy('run');
    try {
      const r = await cin<DiagnosticsReport>('diagnostics-run');
      setReport(r);
      return r;
    } catch {
      return null;
    } finally {
      setBusy(null);
    }
  };

  const healFix = async (fixId: string) => {
    setBusy(fixId);
    try {
      const res = await cin<{ ok?: boolean; report?: DiagnosticsReport }>('diagnostics-heal', { fixId });
      if (res?.report) setReport(res.report);
      else await runDiag();
      qc.invalidateQueries();
      toast(ar ? 'تم تطبيق الإصلاح' : 'Recovery action completed');
    } finally {
      setBusy(null);
    }
  };

  const copyReport = async () => {
    const r = report || (await runDiag());
    if (!r) return;
    await navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).catch(() => {});
    toast(t('diag_copied'));
  };

  return (
    <SettingSection title={t('diag_center_title')}>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={runDiag}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-[#12100E] hover:brightness-110 disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy === 'run' ? 'animate-spin' : ''} />
          {t('diag_run_btn')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => healFix('heal_all')}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
        >
          <Wrench size={13} />
          {ar ? 'إصلاح تلقائي شامل' : 'Auto-Heal All'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => healFix('reset_player')}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
        >
          <Wrench size={13} />
          {t('diag_clear_reset_btn')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={copyReport}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
        >
          <Copy size={13} />
          {t('diag_copy_btn')}
        </button>
      </div>

      {report ? (
        <div className="mt-2 space-y-2">
          {report.checks.map((ch) => {
            const label = DIAG_CHECK_LABELS[ch.id] ? (ar ? DIAG_CHECK_LABELS[ch.id].ar : DIAG_CHECK_LABELS[ch.id].en) : ch.id;
            const tone =
              ch.status === 'ok'
                ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
                : ch.status === 'warn'
                  ? 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
                  : 'bg-red-500/15 text-red-300 ring-red-400/30';
            return (
              <div key={ch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/25 p-3 ring-1 ring-white/10">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ring-1 ${tone}`}>
                      <ShieldCheck size={10} />
                      {ch.status}
                    </span>
                    <span className="text-xs font-semibold text-white">{label}</span>
                  </div>
                  {ch.summary ? <div dir="ltr" className="mt-1 truncate text-start font-mono text-[11px] text-white/60">{ch.summary}</div> : null}
                </div>
                {ch.fixId && ch.status !== 'ok' ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => healFix(ch.fixId!)}
                    className="rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-bold text-[#12100E] hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === ch.fixId ? '...' : t('diag_heal_btn')}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </SettingSection>
  );
}

interface RelayBenchRow {
  name: string;
  label?: string;
  fam?: string;
  best?: number | null;
  avg?: number | null;
  jitter?: number;
  loss?: number;
  score?: number;
}

function SaudiIspSection({ ar, isp, preferredRelay, setAppSetting, toast }: {
  ar: boolean;
  isp?: string;
  preferredRelay?: string;
  setAppSetting: (patch: Record<string, unknown>) => Promise<void>;
  toast: (msg: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [bench, setBench] = useState<{ isp?: string; relays?: RelayBenchRow[] } | null>(null);

  const runBench = async () => {
    setTesting(true);
    try {
      const res = await invoke<{ isp?: string; relays?: RelayBenchRow[] }>('net:isp-bench').catch(() => null);
      if (res) {
        setBench(res);
        toast(ar ? 'اكتمل فحص مسارات الشبكة' : 'ISP jitter benchmark complete');
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingSection title={ar ? 'مُحسّن مسار الشبكة (السعودية والخليج)' : 'Saudi ISP Path Optimizer'}>
      <DropdownRow
        label={ar ? 'مزود خدمة الإنترنت (ISP)' : 'Internet provider (ISP)'}
        value={isp || 'auto'}
        options={[
          { value: 'auto', label: ar ? 'اكتشاف تلقائي' : 'Auto-detect' },
          { value: 'stc', label: 'STC (stc Fiber / 5G)' },
          { value: 'mobily', label: 'Mobily' },
          { value: 'zain', label: 'Zain KSA' },
          { value: 'salam', label: 'Salam / ITC' },
          { value: 'other', label: ar ? 'مزود آخر' : 'Other ISP' },
        ]}
        onChange={async (v) => {
          await setAppSetting({ isp: v });
          toast(ar ? 'تم حفظ مزود الخدمة' : 'ISP profile saved');
        }}
      />
      <ActionRow
        label={ar ? 'فحص أقل تذبذب (Jitter) للمسارات' : 'Lowest-jitter relay benchmark'}
        description={bench?.isp
          ? (ar ? `المزود المكتشف: ${bench.isp.toUpperCase()}${preferredRelay ? ` · المثبت: ${preferredRelay}` : ''}` : `Detected: ${bench.isp.toUpperCase()}${preferredRelay ? ` · Pinned: ${preferredRelay}` : ''}`)
          : (preferredRelay ? (ar ? `الخادم المثبت: ${preferredRelay}` : `Pinned relay: ${preferredRelay}`) : (ar ? 'يقيس الاستجابة والتذبذب وفقد الحزم لاختيار أفضل خادم' : 'Measures RTT, jitter & packet loss across relays'))}
        buttonLabel={testing ? (ar ? 'جاري الفحص...' : 'Testing...') : (ar ? 'فحص المسارات' : 'Run ISP Benchmark')}
        busy={testing}
        onClick={runBench}
      />
      {bench?.relays?.length ? (
        <div className="space-y-1.5 pt-2">
          {bench.relays.map((r, i) => {
            const pinned = preferredRelay === r.name;
            const lossPct = Math.round((r.loss || 0) * 100);
            return (
              <div key={`${r.name}-${r.fam || i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/30 px-3 py-2 text-xs ring-1 ring-white/10">
                <div className="min-w-0">
                  <span className="font-semibold text-[var(--text-primary)]">{r.label || r.name}</span>
                  {r.fam ? <span dir="ltr" className="ms-1.5 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">{r.fam}</span> : null}
                  {i === 0 ? <span className="ms-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">{ar ? 'الأفضل' : 'Best'}</span> : null}
                </div>
                <div dir="ltr" className="flex items-center gap-3 font-mono text-[11px] text-[var(--text-muted)]">
                  <span>{r.best != null ? `${Math.round(r.best)}ms` : '—'}</span>
                  <span>jitter {Math.round(r.jitter || 0)}ms</span>
                  <span>loss {lossPct}%</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = pinned ? 'auto' : r.name;
                      await setAppSetting({ preferredRelay: next });
                      toast(next ? (ar ? `تم تثبيت ${r.label || r.name}` : `Pinned ${r.label || r.name}`) : (ar ? 'تم إلغاء تثبيت الخادم' : 'Relay unpinned'));
                    }}
                    className={`rounded-full px-2.5 py-0.5 font-sans text-[11px] font-semibold ${pinned ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    {pinned ? (ar ? 'مثبت ✓' : 'Pinned ✓') : (ar ? 'تثبيت' : 'Pin')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </SettingSection>
  );
}
