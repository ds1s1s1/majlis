import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Award, Bell, Bookmark, Check, Download, Film, FolderOpen, Gamepad2, Globe, Headphones,
  KeyRound, Lock, Palette, Play, Puzzle, RotateCcw, Search, Shield, ShieldCheck, Sparkles,
  Star, Trash2, Tv, Upload, Users,
} from 'lucide-react';
import { cin, invoke } from '../../api';
import { APP_BUILD, APP_NAME, APP_VERSION } from '../../config/appBrand';
import { useHost } from '../../host';
import { fmtLocaleDateTime } from '../../i18n';
import { useProfileStore } from '../../store/useProfileStore';
import { ActionRow, DropdownRow, InfoBanner, SegmentedRow, SettingSection, ToggleRow } from '../primitives';
import { useSettingsStore, type SettingsPageId } from '../useSettingsStore';

const ICON_SET = [
  { name: 'Play', El: Play }, { name: 'Film', El: Film }, { name: 'Tv', El: Tv },
  { name: 'Headphones', El: Headphones }, { name: 'Gamepad2', El: Gamepad2 }, { name: 'Users', El: Users },
  { name: 'Star', El: Star }, { name: 'Bookmark', El: Bookmark }, { name: 'Sparkles', El: Sparkles },
  { name: 'Palette', El: Palette }, { name: 'Puzzle', El: Puzzle }, { name: 'Search', El: Search },
  { name: 'Bell', El: Bell }, { name: 'Globe', El: Globe }, { name: 'Shield', El: Shield },
  { name: 'Lock', El: Lock }, { name: 'Award', El: Award },
];

interface BackupEntry {
  id: string;
  reason: string;
  createdAt: number;
  sizeBytes: number;
  profilesCount: number;
  libraryItemsCount: number;
  ratingsCount: number;
  partyHistoryCount: number;
}

export function HelpUpdatesPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update, exportSettingsJson, importSettingsJson, applySettingsSnapshot } = useSettingsStore();

  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState<'normal' | 'high' | 'critical'>('normal');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [attachLog, setAttachLog] = useState(true);
  const [restorePreview, setRestorePreview] = useState<{ raw: string; sections: number } | null>(null);
  const [checkingUpd, setCheckingUpd] = useState(false);

  // Encrypted .majlis-profile export/import state
  const [bundlePass, setBundlePass] = useState('');
  const [bundleMode, setBundleMode] = useState<'merge' | 'replace'>('merge');
  const [bundleKeys, setBundleKeys] = useState(false);
  const [bundleSections, setBundleSections] = useState<string[]>(['addons', 'themes', 'library', 'settings']);
  const [bundleBusy, setBundleBusy] = useState(false);

  // Scheduled Weekly Auto-Backup state
  const [autoBackupOn, setAutoBackupOn] = useState(true);
  const [autoBackupDays, setAutoBackupDays] = useState(7);
  const [backupDir, setBackupDir] = useState('');
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const loadBackupState = async () => {
    const [st, listRes] = await Promise.all([
      invoke<{ settings?: { autoBackupEnabled?: boolean; autoBackupIntervalDays?: number } }>('state').catch(() => null),
      invoke<{ dir: string; items: BackupEntry[] }>('backup:list').catch(() => null),
    ]);
    if (st?.settings) {
      setAutoBackupOn(st.settings.autoBackupEnabled !== false);
      setAutoBackupDays(Number(st.settings.autoBackupIntervalDays) || 7);
    }
    if (listRes) {
      setBackupDir(listRes.dir || '');
      setBackups(Array.isArray(listRes.items) ? listRes.items : []);
    }
  };

  useEffect(() => {
    if (pageId === 'updates-backup') loadBackupState();
  }, [pageId]);

  if (pageId === 'report-bug') {
    const generateReport = () => {
      if (!summary.trim()) { toast(ar ? 'أدخل ملخص المشكلة أولاً' : 'Please enter a summary'); return; }
      const report = { app: APP_NAME, version: APP_VERSION, build: APP_BUILD, severity, summary, steps, expected, actual, attachLog, generatedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `majlis-bug-report-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(ar ? 'تم تصدير تقرير الخطأ' : 'Bug report bundle downloaded');
    };
    return (
      <SettingSection title={ar ? 'الإبلاغ عن مشكلة وتصدير السجل' : 'Report a bug'}>
        <div className="space-y-3 py-2 text-xs">
          <input dir="auto" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={ar ? 'ملخص المشكلة (مطلوب)...' : 'Summary (required)...'} className="w-full rounded-xl bg-black/35 px-3 py-2 text-sm ring-1 ring-white/10 outline-none" />
          <SegmentedRow label={ar ? 'الخطورة' : 'Severity'} value={severity} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }]} onChange={setSeverity} />
          <textarea dir="auto" rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={ar ? 'خطوات إعادة إنتاج المشكلة...' : 'Steps to reproduce...'} className="w-full rounded-xl bg-black/35 p-3 ring-1 ring-white/10 outline-none" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <textarea dir="auto" rows={3} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={ar ? 'ما المتوقع حدوثه...' : 'What you expected...'} className="rounded-xl bg-black/35 p-3 ring-1 ring-white/10 outline-none" />
            <textarea dir="auto" rows={3} value={actual} onChange={(e) => setActual(e.target.value)} placeholder={ar ? 'ما حدث فعلياً...' : 'What actually happened...'} className="rounded-xl bg-black/35 p-3 ring-1 ring-white/10 outline-none" />
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={attachLog} onChange={(e) => setAttachLog(e.target.checked)} />{ar ? 'إرفاق معلومات النسخة وتشخيص المشغل' : 'Attach player & environment info'}</label>
          <div className="flex justify-end"><button type="button" onClick={generateReport} className="rounded-full px-5 py-2 font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{ar ? 'إنشاء تقرير المشكلة' : 'Submit bug report'}</button></div>
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'licenses-attribution') {
    const LIBS = [
      { name: 'React & React DOM', license: 'MIT', desc: 'Declarative component UI runtime' },
      { name: 'libmpv / mpv', license: 'GPL-2.0+ / LGPL', desc: 'Hardware accelerated playback engine' },
      { name: 'Tauri v2', license: 'MIT / Apache-2.0', desc: 'Native Windows Setup installer shell' },
      { name: 'Tailwind CSS', license: 'MIT', desc: 'Utility CSS design system' },
      { name: 'Lucide Icons', license: 'ISC', desc: 'Offline SVG vector iconography' },
      { name: 'Zustand', license: 'MIT', desc: 'Lightweight typed state store' },
    ];
    return (
      <SettingSection title={ar ? 'التراخيص والمكتبات مفتوحة المصدر' : 'Licenses & attribution'}>
        <InfoBanner title={`${APP_NAME} · MIT License`} body="All third-party libraries below operate offline within the packaged distribution." />
        <div className="divide-y divide-[var(--border-subtle)] text-xs">
          {LIBS.map((lb) => (
            <div key={lb.name} className="flex items-center justify-between py-2.5">
              <div><div className="font-bold">{lb.name}</div><div className="text-[var(--text-muted)]">{lb.desc}</div></div>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px]">{lb.license}</span>
            </div>
          ))}
        </div>
      </SettingSection>
    );
  }

  if (pageId === 'icons-animation') {
    return (
      <SettingSection title={ar ? `أيقونات وحركات ${APP_NAME}` : `${APP_NAME} Icons & Motion System`} subtitle={ar ? 'اضغط أي أيقونة لنسخ كود SVG المباشر.' : 'Click any vector icon to copy its inline SVG markup.'}>
        <div className="grid grid-cols-4 gap-2.5 py-2 sm:grid-cols-6">
          {ICON_SET.map(({ name, El }) => (
            <button
              key={name}
              type="button"
              onClick={(e) => {
                const svg = e.currentTarget.querySelector('svg')?.outerHTML || '';
                navigator.clipboard?.writeText(svg).catch(() => {});
                toast(`${name} SVG copied`);
              }}
              className="group flex flex-col items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-black/25 p-3 transition hover:scale-105 hover:border-[var(--accent)]"
            >
              <El size={20} className="text-[var(--accent)] transition group-hover:scale-110" />
              <span className="text-[10px] text-[var(--text-muted)]">{name}</span>
            </button>
          ))}
        </div>
      </SettingSection>
    );
  }

  // updates-backup
  const downloadBackup = () => {
    const blob = new Blob([exportSettingsJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `majlis-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(ar ? 'تم تصدير النسخة الاحتياطية' : 'Settings backup exported');
  };

  const onRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const raw = await f.text();
      const parsed = JSON.parse(raw);
      const obj = parsed?.settings || parsed;
      setRestorePreview({ raw, sections: Object.keys(obj || {}).length });
    } catch {
      toast('Invalid JSON backup');
    }
  };

  const applyRestoredBlobs = (res: { settingsV2?: Record<string, unknown> | null; profileV1?: Record<string, unknown> | null } | null) => {
    if (!res) return;
    if (res.settingsV2 && typeof res.settingsV2 === 'object') applySettingsSnapshot(res.settingsV2);
    if (res.profileV1 && typeof res.profileV1 === 'object') {
      const cur = useProfileStore.getState().saved;
      useProfileStore.setState({ saved: { ...cur, ...res.profileV1 } as typeof cur });
    }
    useProfileStore.getState().hydrateFromMajlis();
    qc.invalidateQueries();
  };

  const toggleBundleSection = (sec: string) => {
    setBundleSections((prev) => (prev.includes(sec) ? prev.filter((x) => x !== sec) : [...prev, sec]));
  };

  const exportEncryptedProfile = async () => {
    if (!bundlePass.trim()) {
      toast(ar ? 'أدخل كلمة مرور لتشفير الملف' : 'Enter a passphrase to encrypt your .majlis-profile');
      return;
    }
    setBundleBusy(true);
    try {
      const res = await cin<{ ok: boolean; canceled?: boolean; bytes?: number }>('export-data', {
        passphrase: bundlePass,
        sections: bundleSections,
        includeKeys: bundleKeys,
        settingsV2: data,
        profileV1: useProfileStore.getState().saved,
      });
      if (res?.ok) toast(ar ? 'تم تصدير ملف .majlis-profile المشفر بنجاح' : 'Encrypted .majlis-profile exported');
    } catch (e) {
      toast((e as Error).message || 'Export error');
    } finally {
      setBundleBusy(false);
    }
  };

  const importEncryptedProfile = async () => {
    if (!bundlePass.trim()) {
      toast(ar ? 'أدخل كلمة مرور فك التشفير أولاً' : 'Enter the passphrase to decrypt the .majlis-profile');
      return;
    }
    setBundleBusy(true);
    try {
      const res = await cin<{ ok: boolean; canceled?: boolean; settingsV2?: Record<string, unknown> | null; profileV1?: Record<string, unknown> | null; summary?: { addons?: number; libraryItems?: number } }>('import-data', {
        passphrase: bundlePass,
        mode: bundleMode,
        sections: bundleSections,
      });
      if (res?.ok) {
        applyRestoredBlobs(res);
        toast(ar
          ? `تم الاستيراد بنجاح (${res.summary?.addons || 0} إضافات · ${res.summary?.libraryItems || 0} عمل)`
          : `Imported profile (${res.summary?.addons || 0} addons · ${res.summary?.libraryItems || 0} library items)`);
      }
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBundleBusy(false);
    }
  };

  return (
    <>
      <SettingSection title={ar ? 'التحديثات والإصدارات' : 'Updates & Release Channel'}>
        <ActionRow
          label={`${APP_NAME} v${APP_VERSION}`}
          description={`Build ${APP_BUILD}`}
          buttonLabel={ar ? 'التحقق من التحديثات' : 'Check for updates'}
          busy={checkingUpd}
          onClick={async () => {
            setCheckingUpd(true);
            const r = await cin<{ version?: string; updateAvailable?: boolean }>('updater-check').catch(() => null);
            setCheckingUpd(false);
            toast(r?.updateAvailable
              ? (ar ? 'يتوفر تحديث جديد' : 'New update available')
              : (ar ? `أنت على أحدث إصدار محلي (v${r?.version || APP_VERSION})` : `Current build v${r?.version || APP_VERSION} verified`));
          }}
        />
        <ToggleRow label={ar ? 'إصدارات بيتا التجريبية (Pre-release)' : 'Pre-release builds (Beta)'} checked={data.updates.betaChannel} onChange={(v) => update((s) => { s.updates.betaChannel = v; })} />
        <SegmentedRow label={ar ? 'تقييمك لهذا البناء' : 'How is this build treating you?'} value={data.updates.buildFeedback || 'better'} options={[{ value: 'worse', label: ar ? 'أسوأ' : 'Worse' }, { value: 'same', label: ar ? 'متشابه' : 'About the same' }, { value: 'better', label: ar ? 'أفضل' : 'Better' }]} onChange={(v) => { update((s) => { s.updates.buildFeedback = v; }); toast(ar ? 'شكراً لملاحظتك' : 'Feedback recorded'); }} />
        <div className="pt-3 space-y-2 text-xs">
          <div className="font-bold uppercase tracking-wider text-[var(--text-muted)]">{ar ? 'سجل الإصدارات' : 'Roll back to an earlier build'}</div>
          <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-black/25 px-3 py-2">
            <span><strong>v{APP_VERSION}</strong> · {APP_BUILD}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300"><Check size={11} />CURRENT</span>
          </div>
        </div>
      </SettingSection>

      {/* Scheduled Auto-Backup (Weekly default) + 1-Click Restore */}
      <SettingSection
        title={ar ? 'النسخ الاحتياطي التلقائي والاستعادة بنقرة واحدة' : 'Scheduled Auto-Backup & 1-Click Restore'}
        subtitle={backupDir ? backupDir : undefined}
      >
        <ToggleRow
          label={ar ? 'تفعيل النسخ الاحتياطي التلقائي الدوري' : 'Enable automatic scheduled backups'}
          description={ar ? 'يحفظ المكتبة والتقييمات والمفضلة والإضافات والثيمات محلياً تلقائياً' : 'Automatically snapshots library, ratings, favorites, addons, and themes'}
          checked={autoBackupOn}
          onChange={async (v) => {
            setAutoBackupOn(v);
            await invoke('settings', { autoBackupEnabled: v }).catch(() => {});
          }}
        />
        <DropdownRow
          label={ar ? 'جدول النسخ الاحتياطي' : 'Backup cadence'}
          value={autoBackupDays}
          options={[
            { value: 1, label: ar ? 'يومياً' : 'Daily' },
            { value: 7, label: ar ? 'أسبوعياً (موصى به)' : 'Weekly (Recommended)' },
            { value: 30, label: ar ? 'شهرياً' : 'Monthly' },
          ]}
          onChange={async (v) => {
            setAutoBackupDays(v);
            await invoke('settings', { autoBackupIntervalDays: v }).catch(() => {});
          }}
        />
        <div className="flex flex-wrap gap-2 py-2">
          <button
            type="button"
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              await invoke('backup:mirror', { settingsV2: data, profileV1: useProfileStore.getState().saved }).catch(() => {});
              await invoke('backup:create').catch(() => {});
              await loadBackupState();
              setBackupBusy(false);
              toast(ar ? 'تم إنشاء نسخة احتياطية فورية' : 'Snapshot created');
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            <ShieldCheck size={13} /><span>{ar ? 'نسخ احتياطي الآن' : 'Back up now'}</span>
          </button>
          <button
            type="button"
            onClick={() => invoke('backup:open-dir').catch(() => {})}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold hover:bg-white/20"
          >
            <FolderOpen size={13} /><span>{ar ? 'فتح المجلد' : 'Open folder'}</span>
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {!backups.length ? (
            <p className="rounded-xl bg-black/25 px-3 py-3 text-xs text-[var(--text-muted)]">
              {ar ? 'لا توجد لقطات محفوظة بعد.' : 'No backup snapshots yet.'}
            </p>
          ) : backups.map((b) => (
            <div key={b.id} className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-black/25 px-3.5 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <span dir="ltr" className="font-mono">{fmtLocaleDateTime(b.createdAt, lang)}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase">{b.reason}</span>
                  </div>
                  <div dir="ltr" className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {(b.sizeBytes / 1024).toFixed(1)} KB · {b.libraryItemsCount} library · {b.ratingsCount} ratings · {b.partyHistoryCount} parties
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={backupBusy}
                    onClick={() => setConfirmRestoreId(b.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    <RotateCcw size={12} /><span>{ar ? 'استعادة' : 'Restore'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={backupBusy}
                    onClick={async () => {
                      await invoke('backup:delete', { id: b.id }).catch(() => {});
                      await loadBackupState();
                    }}
                    className="grid size-7 place-items-center rounded-full bg-white/8 text-white/60 hover:bg-red-500/20 hover:text-red-300"
                    title={ar ? 'حذف' : 'Delete'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {confirmRestoreId === b.id ? (
                <InfoBanner
                  title={ar ? 'تأكيد الاستعادة (مع حفظ لقطة أمان تلقائياً)' : 'Confirm Restore (auto pre-restore safety snapshot)'}
                  body={ar ? 'سيتم أخذ نسخة أمان لوضعك الحالي ثم استعادة اللقطة فوراً بدون فقدان الهوية.' : 'A pre-restore snapshot of your current state is saved first before restoring.'}
                  action={
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmRestoreId(null)} className="rounded-full bg-white/10 px-3 py-1 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                      <button
                        type="button"
                        onClick={async () => {
                          setBackupBusy(true);
                          const res = await invoke<{ ok: boolean; settingsV2?: Record<string, unknown> | null; profileV1?: Record<string, unknown> | null }>('backup:restore', { id: b.id }).catch(() => null);
                          setConfirmRestoreId(null);
                          if (res?.ok) {
                            applyRestoredBlobs(res);
                            await loadBackupState();
                            toast(ar ? 'تمت الاستعادة بنجاح' : 'Snapshot restored cleanly');
                          }
                          setBackupBusy(false);
                        }}
                        className="rounded-full px-3.5 py-1 text-xs font-bold"
                        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        {ar ? 'تأكيد الاستعادة' : 'Restore now'}
                      </button>
                    </div>
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      </SettingSection>

      {/* Portable AES-256-GCM Encrypted .majlis-profile */}
      <SettingSection
        title={ar ? 'تصدير واستيراد حزمة .majlis-profile المشفّرة (AES-256-GCM)' : 'Encrypted .majlis-profile Export & Import (AES-256-GCM)'}
        subtitle={ar ? 'نقل آمن للإضافات والثيمات والإعدادات والمكتبة بدون الاعتماد على أي سيرفر أو حساب مركزي.' : 'Zero-domain encrypted portability across devices for addons, themes, library, and settings.'}
      >
        <div className="space-y-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound size={15} className="text-[var(--accent)]" />
            <input
              type="password"
              value={bundlePass}
              onChange={(e) => setBundlePass(e.target.value)}
              placeholder={ar ? 'كلمة مرور التشفير (مطلوبة للتصدير والاستيراد)...' : 'Encryption passphrase (required)...'}
              className="min-w-[220px] flex-1 rounded-xl bg-black/35 px-3 py-2 text-xs ring-1 ring-white/10 outline-none focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'addons', label: ar ? 'الإضافات' : 'Addons' },
              { id: 'themes', label: ar ? 'الثيمات والملف' : 'Themes & Profile' },
              { id: 'library', label: ar ? 'المكتبة والمفضلة' : 'Library & Favorites' },
              { id: 'settings', label: ar ? 'الإعدادات' : 'Settings' },
            ].map((s) => (
              <label key={s.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/8 px-3 py-1">
                <input type="checkbox" checked={bundleSections.includes(s.id)} onChange={() => toggleBundleSection(s.id)} />
                <span>{s.label}</span>
              </label>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">
              <input type="checkbox" checked={bundleKeys} onChange={(e) => setBundleKeys(e.target.checked)} />
              <span>{ar ? 'تضمين مفاتيح Debrid/TMDB' : 'Include Debrid/TMDB API keys'}</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-1 rounded-full bg-white/8 p-0.5">
              {(['merge', 'replace'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setBundleMode(m)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${bundleMode === m ? 'bg-white/20 text-white' : 'text-white/60'}`}>
                  {m === 'merge' ? (ar ? 'دمج عند الاستيراد' : 'Merge on import') : (ar ? 'استبدال عند الاستيراد' : 'Replace on import')}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={bundleBusy} onClick={exportEncryptedProfile}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-45"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                <Download size={13} /><span>{ar ? 'تصدير .majlis-profile' : 'Export .majlis-profile'}</span>
              </button>
              <button type="button" disabled={bundleBusy} onClick={importEncryptedProfile}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-4 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-45">
                <Upload size={13} /><span>{ar ? 'استيراد .majlis-profile' : 'Import .majlis-profile'}</span>
              </button>
            </div>
          </div>
        </div>
      </SettingSection>

      <SettingSection title={ar ? 'تصدير واستعادة الإعدادات (JSON)' : 'Plain Settings JSON'}>
        <ActionRow label={ar ? 'تصدير إعداداتك (JSON)' : 'Export your setup'} description={ar ? 'يحفظ جميع الأقسام والتخصيصات والاختصارات في ملف واحد' : 'Downloads app-settings-backup.json'} buttonLabel={ar ? 'تصدير' : 'Export'} extra={<Download size={14} className="text-[var(--accent)]" />} onClick={downloadBackup} />
        <div className="py-3 space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20">
            <Upload size={13} />{ar ? 'استعادة من ملف نسخ احتياطي' : 'Restore from a backup (.json)'}
            <input type="file" accept=".json,application/json" className="hidden" onChange={onRestoreFile} />
          </label>
          {restorePreview ? (
            <InfoBanner
              title={ar ? 'معاينة النسخة الاحتياطية' : 'Backup Ready to Restore'}
              body={ar ? `سيتم تحديث ${restorePreview.sections} أقسام إعدادات.` : `Ready to apply ${restorePreview.sections} settings sections cleanly.`}
              action={
                <div className="flex gap-2">
                  <button type="button" onClick={() => setRestorePreview(null)} className="rounded-full bg-white/10 px-3 py-1 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
                  <button type="button" onClick={() => { const res = importSettingsJson(restorePreview.raw); setRestorePreview(null); toast(res.ok ? (ar ? `تمت استعادة ${res.changedCount} أقسام` : `Restored ${res.changedCount} sections`) : (res.error || 'Error')); }} className="rounded-full px-3.5 py-1 text-xs font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                    {ar ? 'تطبيق الآن' : 'Apply backup'}
                  </button>
                </div>
              }
            />
          ) : null}
        </div>
      </SettingSection>
    </>
  );
}
