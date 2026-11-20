import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { cin, useInstalled } from '../../api';
import { useHost } from '../../host';
import { fmtLocaleDateTime } from '../../i18n';
import { DropdownRow, InputRow, SettingSection, ToggleRow } from '../primitives';
import { useSettingsStore, type SettingsPageId } from '../useSettingsStore';

export function PluginsPage({ pageId }: { pageId: SettingsPageId }) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const qc = useQueryClient();
  const { data, update, setActivePage } = useSettingsStore();
  const pl = data.plugins;
  const addonsQ = useInstalled();
  const addons = addonsQ.data || [];
  const [repoUrl, setRepoUrl] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<Record<string, { ok: boolean; label: string }>>({});

  if (pageId === 'installed-plugins') {
    return (
      <>
        <SettingSection title={ar ? 'إعدادات الإضافات العامة' : 'Plugin behavior'}>
          <ToggleRow label={ar ? 'تفعيل الإضافات' : 'Use plugins'} checked={pl.enabled} onChange={(v) => update((s) => { s.plugins.enabled = v; })} />
          <ToggleRow label={ar ? 'إظهار الإضافات في قوائم الكتالوج' : 'Show plugins in catalog lists'} checked={pl.showInCatalogs} onChange={(v) => update((s) => { s.plugins.showInCatalogs = v; })} />
          <ToggleRow label={ar ? 'تجميع حسب المستودع' : 'Group by repository'} checked={pl.groupByRepo} onChange={(v) => update((s) => { s.plugins.groupByRepo = v; })} />
          <ToggleRow label={ar ? 'إخفاء التفاصيل الخلفية للإضافة' : 'Hide plugin background details'} checked={pl.hideBackgroundDetails} onChange={(v) => update((s) => { s.plugins.hideBackgroundDetails = v; })} />
          <ToggleRow label={ar ? 'إظهار اللغة على البوستر' : 'Show language on plugin posters'} checked={pl.showLanguageOnPosters} onChange={(v) => update((s) => { s.plugins.showLanguageOnPosters = v; })} />
          <ToggleRow label={ar ? 'إظهار الجودة على البوستر' : 'Show quality on plugin posters'} checked={pl.showQualityOnPosters} onChange={(v) => update((s) => { s.plugins.showQualityOnPosters = v; })} />
          <DropdownRow label={ar ? 'مهلة انتظار الإضافة' : 'Plugin wait time'} value={pl.waitTimeSec} options={[5, 10, 15, 20, 30].map((n) => ({ value: n, label: `${n}s` }))} onChange={(v) => update((s) => { s.plugins.waitTimeSec = v; })} />
        </SettingSection>

        <SettingSection
          title={ar ? `الإضافات المثبتة (${addons.length})` : `Installed plugins (${addons.length})`}
          rightAction={
            <button type="button" onClick={() => setActivePage('plugin-repositories')} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">
              {ar ? 'إضافة مستودع' : 'Add a repository'}
            </button>
          }
        >
          {addons.length ? (
            addons.map((a) => (
              <div key={a.url} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-black/35 text-[var(--accent)]">
                    <Puzzle size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{a.manifest?.name || a.url}</div>
                    <div dir="ltr" className="truncate font-mono text-[11px] text-[var(--text-muted)]">v{a.manifest?.version || '1.0'} · {a.url}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === a.url}
                    onClick={async () => { setBusyId(a.url); await cin('addon-refresh', { url: a.url }).catch(() => {}); qc.invalidateQueries({ queryKey: ['addons'] }); setBusyId(null); }}
                    className="rounded-lg bg-white/8 p-1.5 hover:bg-white/15"
                    title={ar ? 'تحديث' : 'Refresh'}
                  >
                    <RefreshCw size={13} className={busyId === a.url ? 'animate-spin' : ''} />
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await cin('addon-toggle', { url: a.url, enabled: a.enabled === false }).catch(() => {}); qc.invalidateQueries({ queryKey: ['addons'] }); }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${a.enabled === false ? 'bg-white/8 text-white/50' : 'bg-emerald-500/20 text-emerald-300'}`}
                  >
                    {a.enabled === false ? (ar ? 'معطل' : 'Disabled') : (ar ? 'مفعل' : 'Enabled')}
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await cin('addon-remove', { url: a.url }).catch(() => {}); qc.invalidateQueries({ queryKey: ['addons'] }); }}
                    className="rounded-lg bg-red-500/12 p-1.5 text-red-300 hover:bg-red-500/25"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              <p className="mb-3">{ar ? 'لا توجد إضافات مثبتة حالياً.' : 'No addons installed yet.'}</p>
              <button type="button" onClick={() => setActivePage('plugin-repositories')} className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                {ar ? 'إضافة رابط إضافة أو مستودع' : 'Add repository / manifest URL'}
              </button>
            </div>
          )}
        </SettingSection>
      </>
    );
  }

  // plugin-repositories
  const refreshRepo = async (repo: { id: string; url: string }) => {
    setBusyId(repo.id);
    try {
      type CheckRes = { ok: boolean; kind?: string; name?: string; version?: string | null; addonCount?: number; error?: string };
      const r = await cin<CheckRes>('addon-check-url', { url: repo.url }).catch((): CheckRes => ({ ok: false, error: 'request_failed' }));
      update((s) => {
        const hit = s.plugins.repositories.find((x) => x.id === repo.id);
        if (hit) hit.lastChecked = Date.now();
      });
      if (r.ok) {
        if (/manifest\.json/i.test(repo.url)) {
          await cin('addon-refresh', { url: repo.url }).catch(() => {});
          qc.invalidateQueries({ queryKey: ['addons'] });
        }
        const label = r.kind === 'manifest'
          ? `${r.name || 'OK'}${r.version ? ` v${r.version}` : ''}`
          : `${r.name || 'Repo'} (${r.addonCount ?? 0})`;
        setRepoStatus((prev) => ({ ...prev, [repo.id]: { ok: true, label } }));
        toast(label);
      } else {
        setRepoStatus((prev) => ({ ...prev, [repo.id]: { ok: false, label: r.error || 'failed' } }));
        toast(ar ? 'فشل فحص المستودع' : `Repository check failed: ${r.error || 'error'}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const addRepo = async () => {
    const clean = repoUrl.trim();
    if (!clean) return;
    const id = `repo-${Date.now()}`;
    if (/manifest\.json/i.test(clean)) {
      try {
        const m = await cin<{ name: string; version?: string }>('addon-install', { url: clean });
        toast(ar ? `تم تثبيت ${m.name}` : `Installed ${m.name}`);
        setRepoStatus((prev) => ({ ...prev, [id]: { ok: true, label: `${m.name}${m.version ? ` v${m.version}` : ''}` } }));
        qc.invalidateQueries({ queryKey: ['addons'] });
      } catch (e) {
        toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    } else {
      const check = await cin<{ ok: boolean; name?: string; addonCount?: number; error?: string }>('addon-check-url', { url: clean }).catch(() => null);
      if (check?.ok) {
        setRepoStatus((prev) => ({ ...prev, [id]: { ok: true, label: `${check.name || 'Repo'} (${check.addonCount ?? 0})` } }));
      }
    }
    update((s) => { s.plugins.repositories.unshift({ id, url: clean, lastChecked: Date.now() }); });
    setRepoUrl('');
  };

  return (
    <SettingSection title={ar ? 'مستودعات الإضافات' : 'Plugin repositories'}>
      <InputRow
        label={ar ? 'إضافة رابط مستودع أو Manifest' : 'Add a repository or manifest URL'}
        value={repoUrl}
        placeholder="https://example.com/manifest.json"
        onChange={setRepoUrl}
        onSave={addRepo}
        saveLabel={ar ? 'إضافة' : 'Add'}
      />
      <ToggleRow label={ar ? 'فحص المستودعات يومياً' : 'Check repositories daily'} checked={pl.checkReposDaily} onChange={(v) => update((s) => { s.plugins.checkReposDaily = v; })} />
      <div className="pt-3 space-y-2">
        {pl.repositories.length ? pl.repositories.map((r) => {
          const st = repoStatus[r.id];
          return (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-black/25 px-3 py-2.5">
              <div className="min-w-0">
                <div dir="ltr" className="truncate font-mono text-xs">{r.url}</div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>{fmtLocaleDateTime(r.lastChecked, lang)}</span>
                  {st ? <span className={st.ok ? 'text-emerald-300 font-semibold' : 'text-red-300 font-semibold'}>{st.label}</span> : null}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button type="button" disabled={busyId === r.id} onClick={() => refreshRepo(r)} className="rounded-lg bg-white/8 p-1.5 hover:bg-white/15 disabled:opacity-40">
                  <RefreshCw size={12} className={busyId === r.id ? 'animate-spin' : ''} />
                </button>
                <button type="button" onClick={() => update((s) => { s.plugins.repositories = s.plugins.repositories.filter((x) => x.id !== r.id); })} className="rounded-lg bg-red-500/12 p-1.5 text-red-300 hover:bg-red-500/25"><Trash2 size={12} /></button>
              </div>
            </div>
          );
        }) : (
          <p className="py-4 text-center text-xs text-[var(--text-muted)]">{ar ? 'لم تتم إضافة مستودعات مخصصة.' : 'No custom repositories added.'}</p>
        )}
      </div>
    </SettingSection>
  );
}
