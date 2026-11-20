import { useState } from 'react';
import { Bold, Italic, Link2, List, Quote, Eye, EyeOff, Strikethrough, Music } from 'lucide-react';
import { cin } from '../../../api';
import { useHost } from '../../../host';
import type { ProfileDraft } from '../../../store/useProfileStore';
import { renderSafeMarkdown } from '../../../utils/renderMarkdown';

const REGIONS = [
  { code: '', label: 'None', labelAr: 'غير محدد' },
  { code: 'SA', label: 'Saudi Arabia', labelAr: 'السعودية' },
  { code: 'AE', label: 'UAE', labelAr: 'الإمارات' },
  { code: 'KW', label: 'Kuwait', labelAr: 'الكويت' },
  { code: 'QA', label: 'Qatar', labelAr: 'قطر' },
  { code: 'BH', label: 'Bahrain', labelAr: 'البحرين' },
  { code: 'OM', label: 'Oman', labelAr: 'عُمان' },
  { code: 'EG', label: 'Egypt', labelAr: 'مصر' },
  { code: 'JO', label: 'Jordan', labelAr: 'الأردن' },
  { code: 'US', label: 'United States', labelAr: 'أمريكا' },
  { code: 'GB', label: 'United Kingdom', labelAr: 'بريطانيا' },
  { code: 'JP', label: 'Japan', labelAr: 'اليابان' },
];

export function EditGeneralTab({
  draft,
  onChange,
}: {
  draft: ProfileDraft;
  onChange: (updater: (d: ProfileDraft) => void) => void;
}) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const g = draft.general;
  const [previewMd, setPreviewMd] = useState(false);
  const [downloadingSong, setDownloadingSong] = useState(false);
  const [customLoc, setCustomLoc] = useState(() => !!g.location && !REGIONS.some((r) => r.code === g.location));

  const wrapSelection = (before: string, after = '') => {
    onChange((d) => {
      d.general.about = `${d.general.about}${d.general.about && !d.general.about.endsWith('\n') ? '\n' : ''}${before}text${after}`;
    });
  };

  const fetchYtClip = async () => {
    const url = g.profileSongUrl.trim();
    if (!url || downloadingSong) return;
    setDownloadingSong(true);
    try {
      await cin('song-set', { url, start: 0 });
      toast(ar ? 'تم حفظ مقطع الصوت' : 'Audio clip saved to profile');
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setDownloadingSong(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Display Name */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--pf-text)]">
          <label>{ar ? 'الاسم المعروض' : 'Display Name'}</label>
          <span className="font-mono text-[var(--pf-text-muted)]">{g.alias.length} / 32</span>
        </div>
        <input
          value={g.alias}
          maxLength={32}
          onChange={(e) => onChange((d) => { d.general.alias = e.target.value; })}
          className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3.5 py-2 text-sm text-[var(--pf-text)] focus:border-[var(--pf-accent)]"
        />
      </div>

      {/* Status bubble */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--pf-text)]">
          <label>{ar ? 'الحالة (فقاعة التفكير)' : 'Status'}</label>
          <span className="font-mono text-[var(--pf-text-muted)]">{g.status.length} / 60</span>
        </div>
        <input
          value={g.status}
          maxLength={60}
          placeholder={ar ? 'تظهر كفقاعة فوق صورتك' : 'Shows as a bubble on your profile'}
          onChange={(e) => onChange((d) => { d.general.status = e.target.value; })}
          className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3.5 py-2 text-sm text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-accent)]"
        />
      </div>

      {/* Pronouns + Location */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--pf-text)]">{ar ? 'الضمائر (اختياري)' : 'Pronouns'}</label>
          <input
            value={g.pronouns}
            maxLength={24}
            placeholder="he/him, she/her..."
            onChange={(e) => onChange((d) => { d.general.pronouns = e.target.value; })}
            className="w-full rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3.5 py-2 text-sm text-[var(--pf-text)] focus:border-[var(--pf-accent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--pf-text)]">{ar ? 'الدولة / المنطقة' : 'Location'}</label>
          <select
            value={customLoc ? 'CUSTOM' : (REGIONS.some((r) => r.code === g.location) ? g.location : 'CUSTOM')}
            onChange={(e) => {
              if (e.target.value === 'CUSTOM') {
                setCustomLoc(true);
                if (REGIONS.some((r) => r.code === g.location)) onChange((d) => { d.general.location = ''; });
              } else {
                setCustomLoc(false);
                onChange((d) => { d.general.location = e.target.value; });
              }
            }}
            className="w-full rounded-xl border border-[var(--pf-card-border)] bg-[#141210] px-3.5 py-2 text-sm text-[var(--pf-text)] focus:border-[var(--pf-accent)]"
          >
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>{ar ? r.labelAr : r.label}</option>
            ))}
            <option value="CUSTOM">{ar ? 'أخرى / مخصص' : 'Other / Custom'}</option>
          </select>
          {customLoc || (!!g.location && !REGIONS.some((r) => r.code === g.location)) ? (
            <input
              dir="auto"
              value={g.location}
              maxLength={40}
              placeholder={ar ? 'أدخل مدينتك أو منطقتك...' : 'Enter city or region...'}
              onChange={(e) => onChange((d) => { d.general.location = e.target.value; })}
              className="mt-2 w-full rounded-xl border border-[var(--pf-card-border)] bg-black/25 px-3.5 py-2 text-sm text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-accent)]"
            />
          ) : null}
        </div>
      </div>

      {/* Profile song */}
      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--pf-text)]">
          <Music size={14} className="text-[var(--pf-accent)]" />
          <span>{ar ? 'أغنية الملف' : 'Profile song'}</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <input
            dir="ltr"
            value={g.profileSongUrl}
            placeholder="YouTube, SoundCloud, Spotify, or audio URL"
            onChange={(e) => onChange((d) => { d.general.profileSongUrl = e.target.value; })}
            className="sm:col-span-2 rounded-xl border border-[var(--pf-card-border)] bg-black/30 px-3 py-2 text-xs text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)]"
          />
          <input
            value={g.profileSongTitle}
            placeholder={ar ? 'اسم الأغنية' : 'Track title'}
            onChange={(e) => onChange((d) => { d.general.profileSongTitle = e.target.value; })}
            className="rounded-xl border border-[var(--pf-card-border)] bg-black/30 px-3 py-2 text-xs text-[var(--pf-text)]"
          />
          <input
            value={g.profileSongArtist}
            placeholder={ar ? 'الفنان' : 'Artist name'}
            onChange={(e) => onChange((d) => { d.general.profileSongArtist = e.target.value; })}
            className="rounded-xl border border-[var(--pf-card-border)] bg-black/30 px-3 py-2 text-xs text-[var(--pf-text)]"
          />
        </div>
        {/^https?:\/\/(www\.|music\.)?(youtube\.com|youtu\.be)\//i.test(g.profileSongUrl) ? (
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[11px] text-[var(--pf-text-muted)]">{ar ? 'سيتم استخراج 30 ثانية للملف.' : 'Fetches a 30s audio clip for instant playback.'}</span>
            <button
              type="button"
              onClick={fetchYtClip}
              disabled={downloadingSong}
              className="rounded-full bg-[var(--pf-accent)]/20 px-3 py-1 text-xs font-semibold text-[var(--pf-accent)] hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)]"
            >
              {downloadingSong ? '…' : (ar ? 'حفظ المقطع الآن' : 'Fetch clip now')}
            </button>
          </div>
        ) : null}
      </div>

      {/* About Markdown Composer */}
      <div className="rounded-2xl border border-[var(--pf-card-border)] bg-black/20 p-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pf-card-border)] pb-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {[
              { ic: <Bold size={13} />, label: 'Bold', fn: () => wrapSelection('**', '**') },
              { ic: <Italic size={13} />, label: 'Italic', fn: () => wrapSelection('*', '*') },
              { ic: <Strikethrough size={13} />, label: 'Strike', fn: () => wrapSelection('~~', '~~') },
              { ic: <Link2 size={13} />, label: 'Link', fn: () => wrapSelection('[label](https://example.com)', '') },
              { ic: <Quote size={13} />, label: 'Quote', fn: () => wrapSelection('> ', '') },
              { ic: <EyeOff size={13} />, label: 'Spoiler', fn: () => wrapSelection('||', '||') },
              { ic: <List size={13} />, label: 'List', fn: () => wrapSelection('- ', '') },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                title={b.label}
                onClick={b.fn}
                className="grid size-7 place-items-center rounded-lg text-[var(--pf-text-muted)] hover:bg-white/10 hover:text-[var(--pf-text)]"
              >
                {b.ic}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPreviewMd((p) => !p)}
            className="inline-flex items-center gap-1 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-[var(--pf-text)] hover:bg-white/15"
          >
            <Eye size={12} />
            <span>{previewMd ? (ar ? 'تحرير' : 'Edit') : (ar ? 'معاينة' : 'Preview')}</span>
          </button>
        </div>

        {previewMd ? (
          <div dir="auto" className="min-h-[120px] space-y-2 p-1 text-sm text-[var(--pf-text)]/90">
            {renderSafeMarkdown(g.about) || <span className="text-xs text-[var(--pf-text-muted)]">{ar ? 'فارغ' : 'Nothing to preview'}</span>}
          </div>
        ) : (
          <textarea
            rows={5}
            maxLength={1200}
            value={g.about}
            onChange={(e) => onChange((d) => { d.general.about = e.target.value; })}
            className="w-full resize-y bg-transparent text-sm text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)]"
          />
        )}
      </div>
    </div>
  );
}
