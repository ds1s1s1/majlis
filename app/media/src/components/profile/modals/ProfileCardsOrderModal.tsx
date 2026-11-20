import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { createInitialProfileSeed, type CardPlacement, type LeftCardId, type RightCardId } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

const LEFT_LABELS: Record<LeftCardId, { en: string; ar: string }> = {
  about: { en: 'About', ar: 'نبذة' },
  lists: { en: 'My Lists', ar: 'قوائمي' },
  ratings: { en: 'Ratings & Histogram', ar: 'التقييمات والمنحنى' },
  games: { en: 'Games', ar: 'الألعاب' },
  books: { en: 'Books', ar: 'الكتب' },
  music: { en: 'Music', ar: 'الموسيقى' },
  badges: { en: 'Badges', ar: 'الشارات' },
  activity: { en: 'Recent Activity', ar: 'النشاط الأخير' },
  comments: { en: 'Comments', ar: 'التعليقات' },
};

const RIGHT_LABELS: Record<RightCardId, { en: string; ar: string }> = {
  song: { en: 'Profile Song Player', ar: 'أغنية الملف' },
  tracker: { en: 'Tracker Profile (Letterboxd)', ar: 'حساب المتابعة' },
  gaming: { en: 'Gaming Profile Card', ar: 'بطاقة الألعاب' },
  friends: { en: 'Friends', ar: 'الأصدقاء' },
  groups: { en: 'Groups', ar: 'المجموعات' },
  socials: { en: 'Socials', ar: 'الروابط الاجتماعية' },
};

export function ProfileCardsOrderModal({
  open,
  leftCards,
  rightCards,
  onSave,
  onClose,
}: {
  open: boolean;
  leftCards: CardPlacement<LeftCardId>[];
  rightCards: CardPlacement<RightCardId>[];
  onSave: (left: CardPlacement<LeftCardId>[], right: CardPlacement<RightCardId>[]) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [left, setLeft] = useState<CardPlacement<LeftCardId>[]>(leftCards);
  const [right, setRight] = useState<CardPlacement<RightCardId>[]>(rightCards);

  useEffect(() => {
    if (open) {
      setLeft(leftCards.map((x) => ({ ...x })));
      setRight(rightCards.map((x) => ({ ...x })));
    }
  }, [open, leftCards, rightCards]);

  const moveItem = <T extends string>(arr: CardPlacement<T>[], idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return arr;
    const next = [...arr];
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  };

  const resetDefaults = () => {
    const seed = createInitialProfileSeed();
    setLeft(seed.showcase.leftCards);
    setRight(seed.showcase.rightCards);
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      maxWidth="max-w-2xl"
      title={ar ? 'ترتيب وإظهار البطاقات' : 'Profile cards & order'}
      subtitle={ar ? 'أعد ترتيب البطاقات أو أخفِ أي بطاقة' : 'Toggle visibility and reorder left & right columns'}
      footer={
        <>
          <button type="button" onClick={resetDefaults} className="me-auto inline-flex items-center gap-1 rounded-full bg-white/8 px-3 py-1.5 text-xs hover:bg-white/15">
            <RotateCcw size={12} />{ar ? 'افتراضي' : 'Reset'}
          </button>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => { onSave(left, right); onClose(); }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
            {ar ? 'العمود الرئيسي (9 بطاقات)' : 'Main Column (9 cards)'}
          </div>
          <div className="space-y-1.5">
            {left.map((c, i) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setLeft(left.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)))}
                  className={`flex items-center gap-2 text-xs font-medium ${c.visible ? 'text-white' : 'text-white/40 line-through'}`}
                >
                  {c.visible ? <Eye size={13} className="text-[var(--pf-accent)]" /> : <EyeOff size={13} />}
                  <span>{ar ? LEFT_LABELS[c.id].ar : LEFT_LABELS[c.id].en}</span>
                </button>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => setLeft(moveItem(left, i, -1))} disabled={i === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={12} /></button>
                  <button type="button" onClick={() => setLeft(moveItem(left, i, 1))} disabled={i === left.length - 1} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
            {ar ? 'العمود الجانبي (6 بطاقات)' : 'Sidebar Column (6 cards)'}
          </div>
          <div className="space-y-1.5">
            {right.map((c, i) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setRight(right.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)))}
                  className={`flex items-center gap-2 text-xs font-medium ${c.visible ? 'text-white' : 'text-white/40 line-through'}`}
                >
                  {c.visible ? <Eye size={13} className="text-[var(--pf-accent)]" /> : <EyeOff size={13} />}
                  <span>{ar ? RIGHT_LABELS[c.id].ar : RIGHT_LABELS[c.id].en}</span>
                </button>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => setRight(moveItem(right, i, -1))} disabled={i === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={12} /></button>
                  <button type="button" onClick={() => setRight(moveItem(right, i, 1))} disabled={i === right.length - 1} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
