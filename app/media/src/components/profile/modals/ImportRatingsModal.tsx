import { useState } from 'react';
import { FileSpreadsheet, Library, Star } from 'lucide-react';
import { cin, type LibItem } from '../../../api';
import { inlinePoster, type ProfileRating } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

function parseRatingsCsv(raw: string): { name: string; year?: number; rating?: number }[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase().split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const nameIdx = Math.max(0, header.findIndex((h) => h === 'name' || h === 'title'));
  const yearIdx = header.findIndex((h) => h === 'year');
  const ratingIdx = header.findIndex((h) => h === 'rating' || h === 'score');
  const start = header[nameIdx] === 'name' || header[nameIdx] === 'title' ? 1 : 0;
  const rows: { name: string; year?: number; rating?: number }[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)?.map((c) => c.replace(/^"|"$/g, '').trim()) || [];
    const name = cols[nameIdx];
    if (!name) continue;
    const yr = yearIdx >= 0 ? Number(cols[yearIdx]) : NaN;
    const rt = ratingIdx >= 0 ? Number(cols[ratingIdx]) : NaN;
    rows.push({
      name,
      year: Number.isFinite(yr) && yr > 1880 ? yr : undefined,
      rating: Number.isFinite(rt) && rt > 0 ? rt : undefined,
    });
  }
  return rows;
}

export function ImportRatingsModal({
  open,
  onAddRating,
  onImportCsvRows,
  onClose,
}: {
  open: boolean;
  onAddRating: (r: Omit<ProfileRating, 'at'>) => void;
  onImportCsvRows: (rows: { name: string; year?: number; rating?: number }[]) => void;
  onClose: () => void;
}) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'movie' | 'series'>('movie');
  const [score, setScore] = useState(9);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);

  const importLibrary = async () => {
    setBusy(true);
    try {
      const lib = await cin<LibItem[]>('library');
      const rows = (lib || []).slice(0, 40).map((it) => ({
        name: it.name,
        year: (it as { year?: number }).year || undefined,
        rating: 4.5,
      }));
      if (!rows.length) {
        toast(ar ? 'مكتبة مجلس فارغة حاليًا' : 'Majlis library has no items to import');
        return;
      }
      onImportCsvRows(rows);
      toast(ar ? `تم استيراد ${rows.length} عمل من مكتبتك` : `Imported ${rows.length} titles from library`);
      onClose();
    } catch {
      toast(ar ? 'تعذّر قراءة المكتبة' : 'Could not read Majlis library');
    } finally {
      setBusy(false);
    }
  };

  const onCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    const rows = parseRatingsCsv(txt);
    if (!rows.length) {
      toast(ar ? 'لم يتم العثور على صفوف صالحة في CSV' : 'No valid ratings found in CSV');
      return;
    }
    onImportCsvRows(rows);
    toast(ar ? `تم استيراد ${rows.length} تقييم` : `Imported ${rows.length} ratings`);
    onClose();
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'إضافة أو استيراد التقييمات' : 'Add or import ratings'}
      subtitle={ar ? 'أضف تقييمًا سريعًا أو استورد من Letterboxd CSV / مكتبة مجلس' : 'Add a rating directly or import Letterboxd CSV / Majlis library'}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={importLibrary}
            className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-start transition hover:border-[var(--pf-accent)]/50 hover:bg-white/[0.08]"
          >
            <Library size={18} className="text-[var(--pf-accent)]" />
            <div>
              <div className="text-xs font-bold">{ar ? 'من مكتبة مجلس' : 'From Majlis Library'}</div>
              <div className="text-[10px] text-white/50">{ar ? 'استيراد سريع للأعمال المحفوظة' : 'Import saved films & series'}</div>
            </div>
          </button>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-start transition hover:border-[var(--pf-accent)]/50 hover:bg-white/[0.08]">
            <FileSpreadsheet size={18} className="text-emerald-400" />
            <div>
              <div className="text-xs font-bold">{ar ? 'ملف Letterboxd CSV' : 'Letterboxd ratings.csv'}</div>
              <div className="text-[10px] text-white/50">{ar ? 'اختر ملف CSV محلي' : 'Pick a local .csv file'}</div>
            </div>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvFile} />
          </label>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onAddRating({
              id: `usr-r-${Date.now()}`,
              title: title.trim(),
              type,
              poster: inlinePoster(title.trim(), '#2d2419', '#12100E'),
              score,
              review: review.trim() || undefined,
            });
            setTitle('');
            setReview('');
            onClose();
          }}
          className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-4"
        >
          <div className="flex items-center gap-2 text-xs font-bold">
            <Star size={14} className="text-[var(--pf-accent)]" />
            <span>{ar ? 'تقييم عمل جديد' : 'Add single rating'}</span>
          </div>
          <div className="flex gap-2">
            <input
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={ar ? 'اسم الفيلم أو المسلسل...' : 'Film or series title...'}
              className="flex-1 rounded-xl bg-black/35 px-3 py-2 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'movie' | 'series')}
              className="rounded-xl bg-black/35 px-3 py-2 text-xs outline-none ring-1 ring-white/10"
            >
              <option value="movie">{ar ? 'فيلم' : 'Movie'}</option>
              <option value="series">{ar ? 'مسلسل' : 'Series'}</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-white/70">{ar ? 'التقييم من 10' : 'Score (1–10)'}</span>
              <span className="font-mono font-bold text-[var(--pf-accent)]">{score}/10</span>
            </div>
            <input type="range" min={1} max={10} value={score} onChange={(e) => setScore(Number(e.target.value))} className="w-full accent-[var(--pf-accent)]" />
          </div>

          <textarea
            dir="auto"
            rows={2}
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder={ar ? 'مراجعة مختصرة (اختياري)...' : 'Short review (optional)...'}
            className="w-full resize-none rounded-xl bg-black/35 px-3 py-2 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-full px-5 py-1.5 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
            >
              {ar ? 'إضافة التقييم' : 'Save rating'}
            </button>
          </div>
        </form>
      </div>
    </ModalFrame>
  );
}
