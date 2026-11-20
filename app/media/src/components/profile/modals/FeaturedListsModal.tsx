import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ProfileList } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

export function FeaturedListsModal({
  open,
  lists,
  featuredIds,
  onSave,
  onCreateList,
  onClose,
}: {
  open: boolean;
  lists: ProfileList[];
  featuredIds: string[];
  onSave: (ids: string[]) => void;
  onCreateList: (name: string, description: string) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [selected, setSelected] = useState<string[]>(featuredIds);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    if (open) setSelected(featuredIds.filter((id) => lists.some((l) => l.id === id)).slice(0, 3));
  }, [open, featuredIds, lists]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...selected];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setSelected(next);
  };

  const toggle = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter((x) => x !== id));
    else if (selected.length < 3) setSelected([...selected, id]);
  };

  const featuredLists = selected.map((id) => lists.find((l) => l.id === id)).filter((x): x is ProfileList => !!x);
  const remainingLists = lists.filter((l) => !selected.includes(l.id));

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'القوائم المميزة' : 'Featured lists'}
      subtitle={ar ? 'اختر حتى 3 قوائم لتظهر في ملفك الشخصي' : 'Pick up to 3 lists to feature on your profile'}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => { onSave(selected); onClose(); }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-white/55">
            <span>{ar ? 'المميزة' : 'FEATURED'}</span>
            <span className="font-mono text-[var(--pf-accent)]">{featuredLists.length}/3</span>
          </div>
          {featuredLists.length ? (
            <div className="space-y-2">
              {featuredLists.map((l, i) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <div dir="auto" className="truncate text-sm font-semibold">{l.name}</div>
                    <div className="text-[11px] text-white/50">{l.items.length} {ar ? 'عمل' : 'items'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === featuredLists.length - 1} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={13} /></button>
                    <button type="button" onClick={() => toggle(l.id)} className="rounded p-1 text-red-400 hover:bg-red-500/15"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 py-4 text-center text-xs text-white/45">
              {ar ? 'اختر قوائم من الأسفل.' : 'Select lists below to feature.'}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
            {ar ? 'إضافة قائمة' : 'ADD A LIST'}
          </div>
          <div className="space-y-2">
            {remainingLists.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="min-w-0">
                  <div dir="auto" className="truncate text-xs font-semibold">{l.name}</div>
                  <div className="text-[11px] text-white/50">{l.items.length} {ar ? 'عمل' : 'items'}</div>
                </div>
                <button
                  type="button"
                  disabled={selected.length >= 3}
                  onClick={() => toggle(l.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-[var(--pf-accent)] hover:text-[var(--pf-accent-fg)] disabled:opacity-35"
                >
                  <Plus size={12} />{ar ? 'إضافة' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Create New List */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            onCreateList(newName.trim(), newDesc.trim());
            setNewName('');
            setNewDesc('');
          }}
          className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-2"
        >
          <div className="text-xs font-semibold">{ar ? 'إنشاء قائمة جديدة' : 'Create new list'}</div>
          <div className="flex gap-2">
            <input
              dir="auto"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={ar ? 'اسم القائمة...' : 'List name...'}
              className="flex-1 rounded-lg bg-black/35 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
            />
            <button type="submit" disabled={!newName.trim()} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-40">
              <Plus size={14} />
            </button>
          </div>
          <input
            dir="auto"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={ar ? 'وصف قصير (اختياري)...' : 'Short description (optional)...'}
            className="w-full rounded-lg bg-black/35 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
        </form>
      </div>
    </ModalFrame>
  );
}
