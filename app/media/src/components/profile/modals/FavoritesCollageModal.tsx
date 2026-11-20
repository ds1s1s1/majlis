import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Download, Grid2x2, Grid3x3, Sparkles } from 'lucide-react';
import { cin, invoke, useLists, useSocialMe } from '../../../api';
import type { UserProfileState } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

interface CollageCandidate {
  id: string;
  name: string;
  poster: string | null;
  score?: number;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImgElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function FavoritesCollageModal({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: UserProfileState;
  onClose: () => void;
}) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const meQ = useSocialMe();
  const listsQ = useLists();

  const [gridMode, setGridMode] = useState<4 | 9>(4);
  const [showRank, setShowRank] = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgCacheRef = useRef(new Map<string, string>());

  const candidates = useMemo<CollageCandidate[]>(() => {
    const map = new Map<string, CollageCandidate>();
    const push = (c: CollageCandidate) => {
      if (!c.id || !c.name) return;
      const cur = map.get(c.id);
      if (!cur || (!cur.poster && c.poster)) map.set(c.id, { ...cur, ...c });
    };
    for (const f of meQ.data?.favorites || []) push({ id: f.id, name: f.name, poster: f.poster || null });
    for (const f of meQ.data?.libraryFavorites || []) push({ id: f.id, name: f.name, poster: f.poster || null });
    for (const f of listsQ.data?.favorites || []) push({ id: f.id, name: f.name, poster: f.poster || null });
    for (const l of profile.lists || []) {
      for (const it of l.items || []) push({ id: it.id, name: it.name, poster: it.poster || null });
    }
    for (const r of [...(profile.ratings || [])].sort((a, b) => b.score - a.score || b.at - a.at)) {
      push({ id: r.id, name: r.title, poster: r.poster || null, score: r.score });
    }
    return [...map.values()];
  }, [meQ.data, listsQ.data, profile.lists, profile.ratings]);

  const [pickedIds, setPickedIds] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setPickedIds((prev) => {
      const valid = prev.filter((id) => candidates.some((c) => c.id === id));
      if (valid.length >= gridMode) return valid.slice(0, gridMode);
      const fill = candidates.filter((c) => !valid.includes(c.id)).slice(0, gridMode - valid.length).map((c) => c.id);
      return [...valid, ...fill];
    });
  }, [open, gridMode, candidates]);

  const activeItems = useMemo(
    () => pickedIds.map((id) => candidates.find((c) => c.id === id)).filter(Boolean) as CollageCandidate[],
    [pickedIds, candidates],
  );

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= gridMode) return [...prev.slice(0, gridMode - 1), id];
      return [...prev, id];
    });
  };

  const movePick = (idx: number, dir: -1 | 1) => {
    setPickedIds((prev) => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      const cols = gridMode === 4 ? 2 : 3;
      const W = gridMode === 4 ? 1200 : 1500;
      const H = gridMode === 4 ? 1680 : 2100;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const accent = profile.look.customColors.accent || '#E5A93C';
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#181410');
      grad.addColorStop(0.55, '#12100E');
      grad.addColorStop(1, '#090807');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Subtle warm glow behind header
      const glow = ctx.createRadialGradient(W * 0.5, 110, 20, W * 0.5, 110, W * 0.65);
      glow.addColorStop(0, `${accent}26`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, 380);

      // Header text
      ctx.fillStyle = accent;
      ctx.font = 'bold 26px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(gridMode === 4 ? 'MAJLIS TOP 4' : 'MAJLIS TOP 9', 64, 84);
      ctx.fillStyle = '#F2EFE9';
      ctx.font = 'bold 46px system-ui, "Segoe UI", sans-serif';
      ctx.fillText((profile.general.alias || 'Majlis Viewer').slice(0, 28), 64, 140);

      const resolvedUrls = await Promise.all(
        activeItems.map(async (item) => {
          const src = item.poster;
          if (!src) return null;
          if (src.startsWith('data:')) return src;
          if (imgCacheRef.current.has(src)) return imgCacheRef.current.get(src)!;
          try {
            const dataUrl = await cin<string>('image-data-url', { url: src });
            if (dataUrl) {
              imgCacheRef.current.set(src, dataUrl);
              return dataUrl;
            }
          } catch {}
          return null;
        }),
      );
      if (cancelled) return;

      const imgs = await Promise.all(resolvedUrls.map((u) => (u ? loadImgElement(u) : Promise.resolve(null))));
      if (cancelled) return;

      const padX = 64;
      const topY = 188;
      const footerH = 128;
      const gap = gridMode === 4 ? 32 : 24;
      const gridW = W - padX * 2;
      const gridH = H - topY - footerH;
      const cellW = (gridW - gap * (cols - 1)) / cols;
      const cellH = (gridH - gap * (cols - 1)) / cols;

      for (let i = 0; i < gridMode; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = padX + col * (cellW + gap);
        const y = topY + row * (cellH + gap);
        const item = activeItems[i];
        const img = imgs[i];

        ctx.save();
        drawRoundedRect(ctx, x, y, cellW, cellH, 22);
        ctx.clip();
        ctx.fillStyle = '#1E1A16';
        ctx.fillRect(x, y, cellW, cellH);

        if (img && img.width > 0 && img.height > 0) {
          const scale = Math.max(cellW / img.width, cellH / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
        } else if (item) {
          ctx.fillStyle = '#2B241C';
          ctx.fillRect(x, y, cellW, cellH);
          ctx.fillStyle = accent;
          ctx.font = 'bold 56px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText((item.name[0] || 'M').toUpperCase(), x + cellW / 2, y + cellH / 2 + 16);
          ctx.textAlign = 'left';
        }

        if (item && showTitles) {
          const fade = ctx.createLinearGradient(0, y + cellH * 0.56, 0, y + cellH);
          fade.addColorStop(0, 'rgba(10,9,8,0)');
          fade.addColorStop(1, 'rgba(10,9,8,0.92)');
          ctx.fillStyle = fade;
          ctx.fillRect(x, y + cellH * 0.52, cellW, cellH * 0.48);

          ctx.fillStyle = '#F7F4ED';
          ctx.font = `bold ${gridMode === 4 ? 26 : 20}px system-ui, "Segoe UI", sans-serif`;
          const maxCh = gridMode === 4 ? 26 : 20;
          const label = item.name.length > maxCh ? `${item.name.slice(0, maxCh - 1)}…` : item.name;
          ctx.fillText(label, x + 20, y + cellH - 22);
        }

        if (item && showRank) {
          const rSize = gridMode === 4 ? 48 : 38;
          ctx.fillStyle = accent;
          drawRoundedRect(ctx, x + 16, y + 16, rSize, rSize, 12);
          ctx.fill();
          ctx.fillStyle = '#12100E';
          ctx.font = `bold ${gridMode === 4 ? 24 : 20}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`#${i + 1}`, x + 16 + rSize / 2, y + 16 + rSize / 2 + 8);
          ctx.textAlign = 'left';
        }
        ctx.restore();

        // Subtle border stroke
        ctx.strokeStyle = item ? `${accent}4D` : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, x, y, cellW, cellH, 22);
        ctx.stroke();
      }

      // Footer bar (zero domains, local P2P handle + 9-digit ID only)
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(64, H - 96);
      ctx.lineTo(W - 64, H - 96);
      ctx.stroke();

      ctx.fillStyle = 'rgba(242,239,233,0.75)';
      ctx.font = '600 24px monospace';
      const handleTxt = profile.general.handle ? `@${profile.general.handle}` : profile.general.alias;
      ctx.fillText(handleTxt, 64, H - 46);

      ctx.textAlign = 'right';
      ctx.fillStyle = accent;
      ctx.fillText(`Majlis ID · ${profile.id}`, W - 64, H - 46);
      ctx.textAlign = 'left';

      setRendering(false);
    })();
    return () => { cancelled = true; };
  }, [open, gridMode, activeItems, showRank, showTitles, profile]);

  const exportPng = async (mode: 'save' | 'copy') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (mode === 'copy') {
        await invoke('clipboard:write-image', dataUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
        toast(ar ? 'تم نسخ صورة الكولاج إلى الحافظة' : 'Collage PNG copied to clipboard');
      } else {
        const res = await invoke<{ ok?: boolean; canceled?: boolean }>('file:save-png', {
          dataUrl,
          defaultName: `Majlis-Top${gridMode}-${new Date().toISOString().slice(0, 10)}.png`,
        });
        if (res?.ok) toast(ar ? 'تم حفظ صورة الكولاج' : 'Collage PNG saved');
      }
    } catch (e) {
      toast((e as Error).message || 'Export failed');
    }
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'مولّد ملصق المفضلة (PNG Collage)' : 'Favorites Poster Collage'}
      subtitle={ar ? 'أنشئ صورة عالية الدقة لأفضل 4 أو 9 أعمال لمشاركتها مع أصدقائك' : 'Build a crisp Top-4 (2×2) or Top-9 (3×3) PNG poster to share anywhere'}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5 rounded-xl bg-black/35 p-1 ring-1 ring-white/10">
              <button type="button" onClick={() => setGridMode(4)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${gridMode === 4 ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}>
                <Grid2x2 size={13} />2×2 (Top 4)
              </button>
              <button type="button" onClick={() => setGridMode(9)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${gridMode === 9 ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}>
                <Grid3x3 size={13} />3×3 (Top 9)
              </button>
            </div>
            <div className="flex gap-2 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1">
                <input type="checkbox" checked={showRank} onChange={(e) => setShowRank(e.target.checked)} />
                <span>{ar ? 'الترتيب #' : 'Rank #'}</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1">
                <input type="checkbox" checked={showTitles} onChange={(e) => setShowTitles(e.target.checked)} />
                <span>{ar ? 'العناوين' : 'Titles'}</span>
              </label>
            </div>
          </div>

          <div className="relative flex justify-center rounded-xl border border-white/10 bg-black/50 p-3">
            <canvas ref={canvasRef} className="max-h-[340px] w-auto rounded-lg shadow-2xl" />
            {rendering ? (
              <div className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-semibold text-white/80">
                {ar ? 'جاري تحميل البوسترات...' : 'Rendering high-DPI posters...'}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => exportPng('copy')}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20">
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{ar ? 'نسخ الصورة' : 'Copy PNG'}</span>
            </button>
            <button type="button" onClick={() => exportPng('save')}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
              style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}>
              <Download size={13} />
              <span>{ar ? 'حفظ PNG' : 'Save PNG'}</span>
            </button>
          </div>
        </div>

        <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/60">
            <Sparkles size={12} className="text-[var(--pf-accent)]" />
            <span>{ar ? `المختارة (${pickedIds.length}/${gridMode})` : `Picked (${pickedIds.length}/${gridMode})`}</span>
          </div>
          {activeItems.map((it, idx) => (
            <div key={it.id} className="flex items-center justify-between gap-1.5 rounded-lg bg-white/8 px-2 py-1.5 text-xs">
              <span className="font-mono text-[10px] text-[var(--pf-accent)]">#{idx + 1}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate">{it.name}</span>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => movePick(idx, -1)} className="rounded p-1 hover:bg-white/15"><ArrowUp size={11} /></button>
                <button type="button" onClick={() => movePick(idx, 1)} className="rounded p-1 hover:bg-white/15"><ArrowDown size={11} /></button>
              </div>
            </div>
          ))}
          <div className="mt-1 border-t border-white/10 pt-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
            {ar ? 'من مفضلتك وتقييماتك' : 'From Your Library & Ratings'}
          </div>
          {!candidates.length ? (
            <p className="text-xs text-white/45">{ar ? 'أضف أعمالاً للمفضلة أو قيّمها لتظهر هنا.' : 'Favorite or rate titles to populate candidates.'}</p>
          ) : candidates.map((c) => {
            const on = pickedIds.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => togglePick(c.id)}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs transition ${on ? 'bg-[var(--pf-accent)]/20 text-white ring-1 ring-[var(--pf-accent)]/50' : 'bg-white/[0.04] text-white/75 hover:bg-white/10'}`}>
                <span dir="auto" className="truncate">{c.name}</span>
                {on ? <Check size={12} className="flex-none text-[var(--pf-accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </ModalFrame>
  );
}
