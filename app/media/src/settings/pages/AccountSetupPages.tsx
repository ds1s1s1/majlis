import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Plus, RefreshCw, ShieldAlert, Trash2, Wifi } from 'lucide-react';
import { cin, invoke, social, useCaps } from '../../api';
import { DOCS_URL } from '../../config/appBrand';
import { inlinePoster } from '../../data/profileMockSeed';
import { useHost } from '../../host';
import { useProfileStore } from '../../store/useProfileStore';
import {
  ActionRow, ColorSwatchPicker, DropdownRow, InfoBanner, InputRow,
  RadioCardGroup, SegmentedRow, SettingSection, ToggleRow,
} from '../primitives';
import { useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const AVATAR_PRESETS = [
  { id: 'av-gold', label: 'Falcon', url: inlinePoster('F', '#3b240c', '#12100E') },
  { id: 'av-ocean', label: 'Midnight', url: inlinePoster('M', '#132a3e', '#0B101B') },
  { id: 'av-emerald', label: 'Forest', url: inlinePoster('S', '#143326', '#0C1410') },
  { id: 'av-amethyst', label: 'Plum', url: inlinePoster('A', '#29173b', '#130F1D') },
  { id: 'av-ember', label: 'Ember', url: inlinePoster('E', '#3f1e18', '#170E0C') },
  { id: 'av-slate', label: 'Obsidian', url: inlinePoster('O', '#27272A', '#121214') },
];

type TrackerKey = 'trakt' | 'simkl' | 'anilist' | 'mal';

export function AccountSetupPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update, setActivePage } = useSettingsStore();
  const prof = useProfileStore();
  const caps = useCaps().data;
  const prefsQ = useQuery({ queryKey: ['prefs'], queryFn: () => cin<{ profile: string; profiles: { name: string; avatar?: string; accent?: string }[] }>('prefs').catch(() => null) });
  const trkQ = useQuery({
    queryKey: ['trackers'],
    queryFn: () => cin<Record<string, 'on' | { code?: string; url: string } | null>>('trackers').catch(() => ({} as Record<string, 'on' | { code?: string; url: string } | null>)),
  });
  const addonsQ = useQuery({
    queryKey: ['addons'],
    queryFn: () => cin<{ name: string; manifestUrl?: string }[]>('addons').catch(() => []),
  });

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(prof.saved.general.alias);
  const [newProfileName, setNewProfileName] = useState('');
  const [sportsModal, setSportsModal] = useState(false);
  const [relayLatency, setRelayLatency] = useState<number | null>(null);
  const [relayUrlDraft, setRelayUrlDraft] = useState(data.account.relayServerUrl);
  const [relayKeyDraft, setRelayKeyDraft] = useState(data.account.relayAccessKey);
  const [serverWsDraft, setServerWsDraft] = useState('');
  const [inviteBaseDraft, setInviteBaseDraft] = useState('');
  const [relayHydrated, setRelayHydrated] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const stateQ = useQuery({
    queryKey: ['app-state'],
    queryFn: () => invoke<{
      id?: string;
      settings?: {
        server?: string; accessKey?: string; serverWs?: string; inviteBase?: string;
        builtInServer?: boolean;
      };
    }>('state').catch(() => null),
    staleTime: 5000,
  });

  useEffect(() => {
    const st = stateQ.data?.settings;
    if (!st || relayHydrated) return;
    setRelayHydrated(true);
    if (typeof st.server === 'string') setRelayUrlDraft(st.server);
    if (typeof st.accessKey === 'string') setRelayKeyDraft(st.accessKey);
    if (typeof st.serverWs === 'string') setServerWsDraft(st.serverWs);
    if (typeof st.inviteBase === 'string') setInviteBaseDraft(st.inviteBase);
  }, [stateQ.data, relayHydrated]);

  const runTracker = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id);
    try {
      const m = await fn();
      if (m) toast(m);
      qc.invalidateQueries({ queryKey: ['trackers'] });
      qc.invalidateQueries({ queryKey: ['caps'] });
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(null);
    }
  };

  if (pageId === 'get-started') {
    const activeMetaCount = [data.sources.metadata.builtInMetadata, data.sources.metadata.useTmdbTopMatch, !!caps?.tmdb, data.sources.metadata.useFallbackMeta, data.sources.metadata.allowDetailsWithoutTmdb].filter(Boolean).length;
    return (
      <>
        <SettingSection title={ar ? 'الأساسيات' : 'Essentials'}>
          <ActionRow
            label={ar ? 'مزامنة الحسابات والإضافات الخارجية' : 'External account sync'}
            description={ar ? 'ربط حساب Stremio ومزامنة الإضافات والمكتبة' : 'Connect your Stremio account & addons'}
            buttonLabel={ar ? 'فتح' : 'Open'}
            onClick={() => setActivePage('addon-sync')}
          />
          <ActionRow
            label={ar ? 'مزودو البيانات الوصفية' : 'Metadata providers'}
            description={ar ? `${activeMetaCount} من 5 مصادر نشطة` : `${activeMetaCount} of 5 sources active`}
            buttonLabel={`${activeMetaCount}/5`}
            onClick={() => setActivePage('metadata-providers')}
          />
          <DropdownRow
            label={ar ? 'محرك التشغيل' : 'Player engine'}
            value={data.playback.engine}
            options={[
              { value: 'auto', label: ar ? 'تلقائي' : 'Auto' },
              { value: 'html5', label: 'HTML5' },
              { value: 'mpv', label: 'mpv (libmpv)' },
            ]}
            onChange={(v) => update((s) => { s.playback.engine = v; })}
          />
          <ActionRow
            label={ar ? 'اللغات المفضلة' : 'Preferred languages'}
            description={`${data.languages.displayLanguage.toUpperCase()} · ${data.languages.subtitlePriority.join(', ')}`}
            buttonLabel={ar ? 'تعديل' : 'Configure'}
            onClick={() => setActivePage('app-language')}
          />
        </SettingSection>

        <SettingSection title={ar ? 'عند الضغط على تشغيل' : 'When you press Play'}>
          <RadioCardGroup
            value={data.playback.pressPlayMode}
            onChange={(v) => update((s) => { s.playback.pressPlayMode = v; })}
            options={[
              {
                value: 'instant',
                title: ar ? 'تشغيل فوري' : 'Instant play',
                description: ar ? 'يختار أفضل مصدر متاح ويبدأ التشغيل فوراً دون قائمة.' : 'Picks the best stream it can find and starts playing straight away.',
              },
              {
                value: 'pick',
                title: ar ? 'اختيار المصدر يدوياً' : 'Pick a source',
                description: ar ? 'يعرض القائمة الكاملة للروابط والجودات لتختار منها بنفسك.' : 'Shows the full list of streams every time so you choose one yourself.',
              },
            ]}
          />
        </SettingSection>

        <SettingSection title={ar ? 'الرياضة' : 'Sports'}>
          <ToggleRow
            label={ar ? 'البث الرياضي المباشر' : 'Live Sports'}
            checked={data.account.sportsLive}
            onChange={(v) => update((s) => { s.account.sportsLive = v; })}
          />
          <ToggleRow
            label={ar ? 'جداول المباريات والترتيب' : 'Match Schedules & Standings'}
            checked={data.account.sportsSchedules}
            onChange={(v) => update((s) => { s.account.sportsSchedules = v; })}
          />
          <div className="pt-3">
            <InfoBanner
              title={ar ? 'إشعار استخدام البث الرياضي' : 'Sports & Live Metadata Notice'}
              body={ar ? 'تعتمد الجداول الحية على مزودات إضافات الطرف الثالث ويمكن تعطيلها في أي وقت.' : 'Live sports schedules rely on enabled metadata & catalog addons and can be toggled off anytime.'}
              action={
                <button type="button" onClick={() => setSportsModal(true)} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
                  {ar ? 'مراجعة الإشعار' : 'Review Sports Notice'}
                </button>
              }
            />
          </div>
          {sportsModal ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSportsModal(false); }}>
              <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#161310] p-5 space-y-4">
                <div className="flex items-center gap-2 text-base font-bold"><ShieldAlert size={18} className="text-[var(--accent)]" />{ar ? 'إشعار المحتوى الرياضي' : 'Sports Feature Notice'}</div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  {ar ? 'يعمل قسم الرياضة فقط مع مزودات الجداول والمصادر التي تضيفها بنفسك. لا يستضيف التطبيق أي بث مركزي.' : 'Sports schedules and streams operate strictly via user-configured addons and metadata providers.'}
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setSportsModal(false)} className="rounded-full bg-white/10 px-4 py-1.5 text-xs">{ar ? 'إغلاق' : 'Close'}</button>
                  <button
                    type="button"
                    onClick={() => { update((s) => { s.account.sportsConsentAccepted = true; }); setSportsModal(false); }}
                    className="rounded-full px-4 py-1.5 text-xs font-semibold"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    {ar ? 'فهمت' : 'Acknowledge'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </SettingSection>

        <SettingSection title={ar ? 'اجعله يناسب ذوقك' : 'Make it yours'}>
          <ActionRow
            label={ar ? 'الثيم والمظهر' : 'Theme and appearance'}
            description={ar ? 'تخصيص الألوان والخلفيات والشعار' : 'Customize palette, background & card design'}
            buttonLabel={ar ? 'تخصيص' : 'Customize'}
            extra={
              <div className="flex items-center gap-1">
                {['#E5A93C', '#3B82F6', '#34D399', '#A855F7'].map((c) => <span key={c} className="size-3 rounded-full" style={{ background: c }} />)}
              </div>
            }
            onClick={() => setActivePage('theme-background')}
          />
        </SettingSection>
      </>
    );
  }

  if (pageId === 'your-profile') {
    const g = prof.saved.general;
    const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { if (typeof r.result === 'string') prof.updateSaved((s) => { s.general.avatar = r.result as string; }); };
      r.readAsDataURL(f);
    };
    return (
      <>
        <SettingSection title={ar ? 'الهوية' : 'Identity'}>
          <div className="flex items-center justify-between gap-3 py-2">
            <div>
              <div className="text-xs text-[var(--text-muted)]">{ar ? 'الاسم المعروض' : 'Display name'}</div>
              {editingName ? (
                <div className="mt-1 flex items-center gap-2">
                  <input dir="auto" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="rounded-lg bg-black/40 px-3 py-1 text-sm ring-1 ring-[var(--accent)] outline-none" />
                  <button
                    type="button"
                    onClick={async () => {
                      const clean = nameDraft.trim() || g.alias;
                      prof.updateSaved((s) => { s.general.alias = clean; s.general.handle = ''; s.general.customUrl = ''; });
                      if (clean) {
                        await Promise.all([
                          social('me-set', { displayName: clean, handle: '' }).catch(() => {}),
                          invoke('settings', { nick: clean }).catch(() => {}),
                        ]);
                        qc.invalidateQueries({ queryKey: ['social-me'] });
                      }
                      setEditingName(false);
                    }}
                    className="rounded-lg px-3 py-1 text-xs font-semibold"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >{ar ? 'حفظ' : 'Save'}</button>
                  <button type="button" onClick={() => setEditingName(false)} className="rounded-lg bg-white/10 px-3 py-1 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                </div>
              ) : (
                <div dir="auto" className="text-base font-bold">{g.alias || (ar ? 'مستخدم مجلس' : 'Majlis User')}</div>
              )}
            </div>
            {!editingName ? (
              <button type="button" onClick={() => { setNameDraft(g.alias); setEditingName(true); }} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-white/20">
                {ar ? 'تعديل' : 'Edit'}
              </button>
            ) : null}
          </div>

          <div className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-medium">{ar ? 'الصورة الشخصية' : 'Avatar'}</span>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-white/20">
                  {ar ? 'رفع صورة' : 'Upload your own'}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
                </label>
                <button type="button" onClick={() => prof.updateSaved((s) => { s.general.avatar = null; })} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-white">
                  {ar ? 'إعادة ضبط' : 'Reset to default'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {AVATAR_PRESETS.map((av) => (
                <button
                  key={av.id}
                  type="button"
                  onClick={() => prof.updateSaved((s) => { s.general.avatar = av.url; })}
                  className={`size-12 overflow-hidden rounded-full ring-2 transition ${g.avatar === av.url ? 'ring-[var(--accent)] scale-105' : 'ring-white/10 hover:ring-white/35'}`}
                >
                  <img src={av.url} alt={av.label} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <ColorSwatchPicker
            label={ar ? 'لونك الشخصي' : 'Your color'}
            value={prof.saved.look.customColors.accent}
            onChange={(hex) => prof.updateSaved((s) => { s.look.customColors.accent = hex; })}
          />

          <SegmentedRow
            label={ar ? 'أغاني الملف الشخصي' : 'Profile songs'}
            value={data.account.profileSongsMode}
            options={[
              { value: 'auto', label: ar ? 'تشغيل تلقائي' : 'Play automatically' },
              { value: 'manual', label: ar ? 'عند الضغط فقط' : 'Only when I press play' },
              { value: 'never', label: ar ? 'إيقاف دائم' : 'Never' },
            ]}
            onChange={(v) => update((s) => { s.account.profileSongsMode = v; })}
          />
        </SettingSection>

        <SettingSection
          title={ar ? 'هوية مجلس المباشرة (P2P Identity)' : 'Majlis P2P Identity'}
          subtitle={ar ? 'رقمك المشفّر بالمفتاح العام للأصدقاء والغرف المباشرة' : 'Your local Ed25519 identity ID used for P2P friends & rooms'}
        >
          {(() => {
            const rawId = String(stateQ.data?.id || prof.saved.id || '');
            const prettyId = /^\d{9}$/.test(rawId) ? `${rawId.slice(0, 3)} ${rawId.slice(3, 6)} ${rawId.slice(6)}` : (rawId || '—');
            return (
              <>
                <ActionRow
                  label={prettyId}
                  description={ar ? 'رقم الهوية المحلي (لا يُرفع لأي خادم مركزي)' : 'Derived locally from your Ed25519 keypair'}
                  buttonLabel={idCopied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ الرقم' : 'Copy ID')}
                  extra={idCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-[var(--text-muted)]" />}
                  onClick={() => {
                    if (rawId) {
                      navigator.clipboard?.writeText(rawId).catch(() => {});
                      setIdCopied(true);
                      setTimeout(() => setIdCopied(false), 1600);
                    }
                  }}
                />
                {!confirmResetId ? (
                  <ActionRow
                    label={ar ? 'إنشاء هوية جديدة' : 'Reset P2P identity'}
                    description={ar ? 'يولد مفتاحاً جديداً ويغيّر رقمك ويعيد تشغيل التطبيق' : 'Generates a new keypair & 9-digit ID, then restarts Majlis'}
                    buttonLabel={ar ? 'إعادة تعيين الهوية' : 'Reset ID'}
                    variant="danger"
                    onClick={() => setConfirmResetId(true)}
                  />
                ) : (
                  <InfoBanner
                    tone="warn"
                    title={ar ? 'تأكيد تغيير الهوية النهائي' : 'Confirm P2P Identity Reset'}
                    body={ar ? 'سيتغير رقمك الحالي ولن يتمكن الأصدقاء من التعرف على الهوية القديمة إلا بإعادة الإضافة.' : 'Your current 9-digit ID will change permanently and Majlis will relaunch.'}
                    action={
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirmResetId(false)} className="rounded-full bg-white/10 px-3 py-1 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                        <button type="button" onClick={() => invoke('identity:new').catch(() => {})} className="rounded-full bg-red-500/80 px-3.5 py-1 text-xs font-bold text-white hover:bg-red-500">
                          {ar ? 'تأكيد وإعادة التشغيل' : 'Confirm Reset'}
                        </button>
                      </div>
                    }
                  />
                )}
              </>
            );
          })()}
        </SettingSection>
      </>
    );
  }

  if (pageId === 'profiles') {
    const profiles = prefsQ.data?.profiles || [{ name: 'default', accent: '#E5A93C' }];
    const activeName = prefsQ.data?.profile || 'default';
    return (
      <>
        <SettingSection title={ar ? 'تبديل الملفات' : 'Household profiles'}>
          <div className="flex flex-wrap items-center gap-4 py-3">
            {profiles.map((p) => {
              const active = p.name === activeName;
              return (
                <div
                  key={p.name}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl p-3 transition ${active ? 'bg-[var(--surface-active)] ring-2 ring-[var(--accent)]' : 'bg-black/25 hover:bg-white/5'}`}
                >
                  {p.name !== 'default' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await cin('profile-remove', { name: p.name }).catch(() => {});
                        if (active) await useProfileStore.getState().switchProfile('default');
                        qc.invalidateQueries();
                      }}
                      title={ar ? 'حذف' : 'Delete'}
                      aria-label={ar ? `حذف ${p.name}` : `Delete ${p.name}`}
                      className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-red-500/90 text-white shadow hover:bg-red-400"
                    >
                      <Trash2 size={11} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      await useProfileStore.getState().switchProfile(p.name);
                      qc.invalidateQueries();
                    }}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="grid size-12 place-items-center rounded-full text-base font-bold text-[#12100E]" style={{ background: p.accent || '#E5A93C' }}>
                      {(p.name === 'default' ? 'M' : p.name[0]).toUpperCase()}
                    </div>
                    <div className="text-xs font-semibold">{p.name === 'default' ? (ar ? 'الرئيسي' : 'Main') : p.name}</div>
                    {active ? <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[9px] font-bold text-[#12100E]">ACTIVE</span> : null}
                  </button>
                  {active ? (
                    <div className="flex items-center gap-1 pt-0.5">
                      {['#E5A93C', '#3E63DD', '#12A594', '#E5484D', '#8E4EC6'].map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={hex}
                          onClick={async () => {
                            await cin('prefs-set', { look: { accent: hex } }).catch(() => {});
                            await useProfileStore.getState().hydrateFromMajlis();
                            qc.invalidateQueries();
                          }}
                          className={`size-3.5 rounded-full ring-1 transition ${String(p.accent || '#E5A93C').toLowerCase() === hex.toLowerCase() ? 'ring-white scale-110' : 'ring-white/25 hover:scale-110'}`}
                          style={{ background: hex }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newProfileName.trim()) return;
                await useProfileStore.getState().switchProfile(newProfileName.trim());
                setNewProfileName('');
                qc.invalidateQueries();
              }}
              className="flex flex-col gap-1.5"
            >
              <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder={ar ? 'اسم جديد...' : 'New profile...'} className="w-32 rounded-lg bg-black/35 px-2.5 py-1.5 text-xs ring-1 ring-white/10 outline-none" />
              <button type="submit" className="inline-flex items-center justify-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
                <Plus size={13} />{ar ? 'إضافة' : 'Add'}
              </button>
            </form>
          </div>
          <SegmentedRow
            label={ar ? 'إعدادات هذا الملف' : 'Settings for this profile'}
            value={data.account.profileMode}
            options={[
              { value: 'shared', label: ar ? 'مشتركة' : 'Shared' },
              { value: 'independent', label: ar ? 'مستقلة' : 'Independent' },
            ]}
            onChange={(v) => update((s) => { s.account.profileMode = v; })}
          />
        </SettingSection>

        <SettingSection title={ar ? 'صلاحيات الملفات الثانوية' : 'PRIVILEGES FOR SECONDARY PROFILES'}>
          {([
            ['editOwnProfile', ar ? 'السماح بتعديل ملفهم الشخصي' : 'Allow editing own profile'],
            ['startupDefaults', ar ? 'السماح بضبط خيارات بدء التشغيل' : 'Allow configuring startup defaults & background'],
            ['manageExternalProviders', ar ? 'السماح بإدارة حسابات التتبع الخارجية' : 'Allow managing external provider accounts'],
            ['signOutFromMenu', ar ? 'السماح بتسجيل الخروج من القائمة' : 'Allow signing out of external providers from menu'],
          ] as const).map(([key, label]) => (
            <ToggleRow
              key={key}
              label={label}
              checked={data.account.secondaryPrivileges[key]}
              onChange={(v) => update((s) => { s.account.secondaryPrivileges[key] = v; })}
            />
          ))}
        </SettingSection>
      </>
    );
  }

  if (pageId === 'addon-sync') {
    const addons = addonsQ.data || [];
    return (
      <>
        <SettingSection title={ar ? 'مزامنة ستريميو والإضافات' : 'External Addon Sync'}>
          <ToggleRow
            label={ar ? 'اعتراض روابط التثبيت (stremio://)' : 'Install Links'}
            description={ar ? 'التقاط روابط الإضافات تلقائياً داخل التطبيق وتثبيتها مباشرة' : 'Intercept external addon manifest/stremio protocol links inside Majlis'}
            checked={data.account.addonInstallLinks}
            onChange={(v) => update((s) => { s.account.addonInstallLinks = v; })}
          />
          <ActionRow
            label="Stremio Account"
            description={caps?.stremio ? (ar ? 'مسجل الدخول وجاهز للمزامنة' : 'Signed in & connected') : (ar ? 'غير متصل حالياً' : 'Not connected')}
            buttonLabel={caps?.stremio ? (ar ? 'تسجيل الخروج' : 'Sign out') : (ar ? 'تسجيل الدخول عبر المتصفح' : 'Sign in')}
            busy={busy === 'stremio'}
            onClick={() => runTracker('stremio', async () => {
              if (caps?.stremio) { await cin('stremio-logout'); return ar ? 'تم تسجيل الخروج' : 'Signed out'; }
              await cin('stremio-login', {});
              const r = await cin<{ pulled: number }>('stremio-sync', { addons: true });
              return ar ? `تمت مزامنة ${r.pulled} عنصر` : `Synced ${r.pulled} items`;
            })}
          />
          <ActionRow
            label={ar ? `الإضافات المزامنة (${addons.length})` : `Synced addons (${addons.length})`}
            description={addons.slice(0, 6).map((a) => a.name).join(' · ') || (ar ? 'لا توجد إضافات حالياً' : 'No addons installed yet')}
            buttonLabel={ar ? 'مزامنة الآن' : 'Sync now'}
            busy={busy === 'stremio-sync'}
            extra={<button type="button" onClick={() => setActivePage('installed-plugins')} className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">{ar ? 'إدارة' : 'Manage'}</button>}
            onClick={() => runTracker('stremio-sync', async () => {
              const r = await cin<{ pulled: number; pushed: number }>('stremio-sync', { addons: true });
              return ar ? `سحب ${r.pulled} · رفع ${r.pushed}` : `Pulled ${r.pulled} · Pushed ${r.pushed}`;
            })}
          />
        </SettingSection>
      </>
    );
  }

  if (pageId.startsWith('tracker-')) {
    const connectedCount = ['trakt', 'simkl', 'anilist', 'mal'].filter((k) => trkQ.data?.[k] === 'on').length + (data.account.letterboxdUsername ? 1 : 0);
    const id = pageId.replace('tracker-', '');
    const trackerStatus = (k: TrackerKey) => trkQ.data?.[k];

    return (
      <>
        <InfoBanner body={ar ? `الحسابات المتصلة: ${connectedCount} من 6 خدمات` : `Connected trackers badge: ${connectedCount} of 6 active`} />
        {(['trakt', 'simkl', 'anilist', 'mal'] as TrackerKey[]).includes(id as TrackerKey) ? (() => {
          const svc = id as TrackerKey;
          const st = trackerStatus(svc);
          const connected = st === 'on';
          return (
            <SettingSection title={svc.toUpperCase()} rightAction={<span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/60'}`}>{connected ? (ar ? 'متصل' : 'Connected') : (ar ? 'غير متصل' : 'Disconnected')}</span>}>
              {st && typeof st === 'object' && st.code ? (
                <InfoBanner title={ar ? 'أدخل الرمز في المتصفح' : 'Device Code Ready'} body={`${st.code}`} action={<button type="button" onClick={() => invoke('open', st.url)} className="rounded-full bg-white/15 px-3 py-1 text-xs">{ar ? 'فتح الصفحة' : 'Open page'}</button>} />
              ) : null}
              <ActionRow
                label={`${svc.toUpperCase()} Account`}
                description={connected ? (ar ? 'حسابك مربوط ويعمل تلقائياً' : 'Connected for watchlist & scrobble sync') : (ar ? 'اربط حسابك للمزامنة التلقائية' : 'Connect account to sync history & watchlist')}
                buttonLabel={connected ? (ar ? 'فصل الحساب' : 'Disconnect') : (ar ? `ربط ${svc}` : `Connect ${svc}`)}
                busy={busy === svc}
                onClick={() => runTracker(svc, async () => {
                  if (connected) { await cin('tracker-out', { svc, service: svc }); return ar ? 'تم الفصل' : 'Disconnected'; }
                  await cin('tracker-start', { svc, service: svc });
                  return ar ? 'بدأ الربط' : 'Connection started';
                })}
              />
              <ActionRow
                label={ar ? 'استيراد السجل والقائمة' : 'Import watchlist & history'}
                buttonLabel={ar ? 'استيراد' : 'Import'}
                busy={busy === `${svc}-imp`}
                onClick={() => runTracker(`${svc}-imp`, async () => {
                  const n = await cin<number>('tracker-import', { svc, service: svc });
                  return ar ? `تم استيراد ${n} عمل` : `Imported ${n} items`;
                })}
              />
              {svc === 'trakt' ? (
                <>
                  <ToggleRow label={ar ? 'إظهار تعليقات Trakt في صفحة العمل' : 'Show comments on detail pages'} checked={data.account.traktShowComments} onChange={(v) => update((s) => { s.account.traktShowComments = v; })} />
                  <ToggleRow label={ar ? 'إخفاء التعليقات والمراجعات افتراضياً' : 'Hide comments and reviews by default'} checked={data.account.traktHideCommentsDefault} onChange={(v) => update((s) => { s.account.traktHideCommentsDefault = v; })} />
                </>
              ) : null}
            </SettingSection>
          );
        })() : id === 'letterboxd' ? (
          <SettingSection title="Letterboxd">
            <ActionRow
              label={ar ? 'استيراد أرشيف Letterboxd ZIP' : 'Import Letterboxd ZIP archive'}
              description={ar ? 'يستورد جميع أفلامك وتقييماتك وقوائمك محلياً' : 'Imports ratings, diary, and watchlist from an export .zip'}
              buttonLabel={ar ? 'اختيار ZIP' : 'Import ZIP'}
              busy={busy === 'lb'}
              onClick={() => runTracker('lb', async () => {
                const r = await invoke<{ films: number } | null>('media:letterboxd-import');
                return r ? (ar ? `تم استيراد ${r.films} فيلم` : `Imported ${r.films} films`) : undefined;
              })}
            />
            <SegmentedRow
              label={ar ? 'وضع الربط' : 'Mode'}
              value={data.account.letterboxdMode}
              options={[{ value: 'public', label: 'Public RSS' }, { value: 'full', label: 'Full API' }]}
              onChange={(v) => update((s) => { s.account.letterboxdMode = v; })}
            />
            <InputRow
              label={ar ? 'اسم المستخدم على Letterboxd' : 'Letterboxd username'}
              value={data.account.letterboxdUsername}
              savedBadge
              onChange={(v) => update((s) => { s.account.letterboxdUsername = v; })}
              onSave={() => toast(ar ? 'تم حفظ معرف Letterboxd' : 'Letterboxd handle saved')}
            />
            <ToggleRow label="Scrobble" checked={data.account.letterboxdScrobble} onChange={(v) => update((s) => { s.account.letterboxdScrobble = v; })} />
            <ToggleRow label="Log watches" checked={data.account.letterboxdLogWatches} onChange={(v) => update((s) => { s.account.letterboxdLogWatches = v; })} />
            <ToggleRow label="List sync" checked={data.account.letterboxdListSync} onChange={(v) => update((s) => { s.account.letterboxdListSync = v; })} />
          </SettingSection>
        ) : (
          <SettingSection title="PublicMetaDB">
            <InfoBanner body={ar ? 'قاعدة بيانات مجتمعية مفتوحة لمزامنة التقييمات والبيانات الوصفية.' : 'Open community database for crowd metadata enrichment & scrobbling.'} />
            <ToggleRow label={ar ? 'تفعيل PublicMetaDB في متابعة المشاهدة' : 'Include in Continue Watching'} checked={data.sources.cwSources.publicmetadb} onChange={(v) => update((s) => { s.sources.cwSources.publicmetadb = v; })} />
          </SettingSection>
        )}
      </>
    );
  }

  if (pageId === 'relay') {
    const builtInSrv = !!stateQ.data?.settings?.builtInServer;
    const runLatencyTest = async () => {
      const t0 = performance.now();
      await invoke('netcheck').catch(() => {});
      setRelayLatency(Math.max(1, Math.round(performance.now() - t0)));
    };
    return (
      <>
        <SettingSection
          title={ar ? 'سيرفر السهرة المشتركة' : 'Watch Together Relay'}
          subtitle={ar ? 'يُعاد تشغيل التطبيق فقط عند الضغط على حفظ لتغيير السيرفر أو مفتاح الوصول.' : 'Server URL and Access Key apply on explicit Save & Restart.'}
          rightAction={
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${relayUrlDraft || builtInSrv ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/60'}`}>
              <Wifi size={12} />{builtInSrv ? (ar ? 'سيرفر مدمج' : 'Built-in relay') : relayUrlDraft ? (ar ? 'مهيأ' : 'Relay is live') : (ar ? 'افتراضي / غير محدد' : 'Default / Not set')}
            </span>
          }
        >
          <InputRow
            label={ar ? 'رابط سيرفر الريلاي (Cloudflare Worker / Self-Hosted)' : 'Relay URL (Cloudflare Worker / Self-Hosted)'}
            value={relayUrlDraft}
            placeholder={builtInSrv ? (ar ? 'يستخدم السيرفر المدمج افتراضياً' : 'Using built-in server') : 'https://your-worker.workers.dev'}
            copyable
            onChange={setRelayUrlDraft}
          />
          {!builtInSrv ? (
            <InputRow
              label={ar ? 'مفتاح الوصول (Access Key)' : 'Access Key'}
              value={relayKeyDraft}
              secret
              placeholder="••••••••"
              onChange={setRelayKeyDraft}
            />
          ) : null}
          <InputRow
            label={ar ? 'رابط WebSocket للإشارات (Signaling WS)' : 'Signaling WebSocket URL (serverWs)'}
            value={serverWsDraft}
            placeholder="wss://your-worker.workers.dev/signal"
            copyable
            onChange={setServerWsDraft}
          />
          <InputRow
            label={ar ? 'الرابط الأساسي للدعوات (Invite Base)' : 'Invite Base URL (inviteBase)'}
            value={inviteBaseDraft}
            placeholder="https://your-worker.workers.dev"
            copyable
            onChange={setInviteBaseDraft}
          />
          <ActionRow
            label={ar ? 'اختبار سرعة الاتصال' : 'Test connection'}
            description={relayLatency !== null ? `${relayLatency} ms` : (ar ? 'قياس زمن الاستجابة الفعلي' : 'Run ping/diagnostics check')}
            buttonLabel={ar ? 'تشغيل الاختبار' : 'Run test'}
            onClick={runLatencyTest}
          />
          <ActionRow
            label={ar ? 'حفظ السيرفر وتطبيق التغيير' : 'Save relay configuration'}
            description={ar ? 'يحفظ العنوان والمفتاح ويعيد تشغيل مجلس لتحديث الاتصال' : 'Saves server, signaling WS & invite base safely'}
            buttonLabel={ar ? 'حفظ وإعادة التشغيل' : 'Save & Restart'}
            variant="primary"
            onClick={() => {
              update((s) => { s.account.relayServerUrl = relayUrlDraft; s.account.relayAccessKey = relayKeyDraft; });
              invoke('settings', {
                server: relayUrlDraft,
                serverWs: serverWsDraft,
                inviteBase: inviteBaseDraft,
                ...(builtInSrv ? {} : { accessKey: relayKeyDraft }),
              }).catch(() => {});
            }}
          />
          <ActionRow
            label={ar ? 'نسخ احتياطي ووثائق الاستضافة الذاتية' : 'Credentials backup & docs'}
            buttonLabel={ar ? 'فتح الدليل' : 'Run your own relay'}
            variant="ghost"
            extra={
              <button type="button" onClick={() => { navigator.clipboard?.writeText(JSON.stringify({ server: relayUrlDraft })); toast(ar ? 'تم النسخ' : 'Exported'); }} className="rounded-full bg-white/10 px-3 py-1.5 text-xs">
                {ar ? 'تصدير' : 'Export'}
              </button>
            }
            onClick={() => invoke('open', DOCS_URL).catch(() => {})}
          />
        </SettingSection>
      </>
    );
  }

  // manage-accounts
  const rows = [
    { name: 'Stremio Sync', connected: !!caps?.stremio, page: 'addon-sync' as SettingsPageId },
    { name: 'Trakt', connected: trkQ.data?.trakt === 'on', page: 'tracker-trakt' as SettingsPageId },
    { name: 'Simkl', connected: trkQ.data?.simkl === 'on', page: 'tracker-simkl' as SettingsPageId },
    { name: 'AniList', connected: trkQ.data?.anilist === 'on', page: 'tracker-anilist' as SettingsPageId },
    { name: 'MyAnimeList', connected: trkQ.data?.mal === 'on', page: 'tracker-mal' as SettingsPageId },
    { name: 'Letterboxd', connected: !!data.account.letterboxdUsername, page: 'tracker-letterboxd' as SettingsPageId },
  ];
  return (
    <SettingSection
      title={ar ? 'جميع الحسابات المتصلة' : 'Manage connected accounts'}
      rightAction={
        <button type="button" onClick={() => runTracker('all', async () => { await cin('stremio-sync', { addons: true }).catch(() => {}); return ar ? 'تمت مزامنة الحسابات' : 'Sync completed'; })} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">
          <RefreshCw size={12} />{ar ? 'مزامنة الكل' : 'Sync all'}
        </button>
      }
    >
      <div className="divide-y divide-[var(--border-subtle)]">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2.5">
              <span className={`size-2.5 rounded-full ${r.connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
              <span className="text-sm font-semibold">{r.name}</span>
              {r.connected ? <Check size={13} className="text-emerald-400" /> : null}
            </div>
            <button type="button" onClick={() => setActivePage(r.page)} className="inline-flex items-center gap-1 rounded-full bg-white/8 px-3 py-1 text-xs hover:bg-white/18">
              <span>{r.connected ? (ar ? 'إدارة' : 'Manage') : (ar ? 'ربط' : 'Connect')}</span>
              <ExternalLink size={11} />
            </button>
          </div>
        ))}
      </div>
    </SettingSection>
  );
}
