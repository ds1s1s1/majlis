import { useEffect, useState } from 'react';
import { Globe, Lock, Plus, X } from 'lucide-react';
import type { ProfileGroup } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

const GROUP_COLORS = ['#E5A93C', '#3B82F6', '#34D399', '#A855F7', '#EF5350', '#EC4899'];
const PRESET_TAGS = ['Movies', 'Series', 'Anime', 'Watch Party', 'Sci-Fi', 'Horror', '4K Masters', 'Gaming'];

export function CreateGroupModal({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: (grp: Omit<ProfileGroup, 'id'>) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'invite'>('public');
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const [tags, setTags] = useState<string[]>(['Movies', 'Watch Party']);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setPrivacy('public');
      setColor(GROUP_COLORS[0]);
      setTags(['Movies', 'Watch Party']);
      setTagInput('');
    }
  }, [open]);

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) setTags(tags.filter((x) => x !== tag));
    else if (tags.length < 5) setTags([...tags, tag]);
  };

  const addCustomTag = () => {
    const clean = tagInput.trim().slice(0, 20);
    if (!clean || tags.includes(clean) || tags.length >= 5) return;
    setTags([...tags, clean]);
    setTagInput('');
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'إنشاء مجموعة جديدة' : 'Create new group'}
      subtitle={ar ? 'اجمع أصدقاءك لمناقشات السهرات والقوائم' : 'Start a watch club or interest group'}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              if (!name.trim()) return;
              onCreate({ name: name.trim(), description: description.trim(), membersCount: 1, privacy, color, tags });
              onClose();
            }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'إنشاء المجموعة' : 'Create group'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium text-white/80">{ar ? 'اسم المجموعة' : 'Group name'}</span>
            <span className="font-mono text-white/40">{name.length}/50</span>
          </div>
          <input
            dir="auto"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ar ? 'مثال: سهرة الخميس السينمائية' : 'e.g. Friday 4K Classics'}
            className="w-full rounded-xl bg-black/35 px-3.5 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
        </label>

        <label className="block space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium text-white/80">{ar ? 'الوصف' : 'Description'}</span>
            <span className="font-mono text-white/40">{description.length}/200</span>
          </div>
          <textarea
            dir="auto"
            rows={2}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={ar ? 'صف موضوع المجموعة...' : 'Describe what this group is about...'}
            className="w-full resize-none rounded-xl bg-black/35 px-3.5 py-2 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
        </label>

        <div>
          <div className="mb-2 text-xs font-medium text-white/80">{ar ? 'الخصوصية' : 'Privacy'}</div>
          <div className="grid grid-cols-2 gap-2.5">
            {([
              { id: 'public', label: ar ? 'عامة' : 'Public', sub: ar ? 'يمكن لأي شخص الانضمام' : 'Anyone can join', icon: <Globe size={15} /> },
              { id: 'invite', label: ar ? 'بدعوة فقط' : 'Invite-only', sub: ar ? 'تتطلب دعوة' : 'Requires invite link', icon: <Lock size={15} /> },
            ] as const).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPrivacy(p.id)}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-start transition ${
                  privacy === p.id ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <span className="mt-0.5 text-[var(--pf-accent)]">{p.icon}</span>
                <div>
                  <div className="text-xs font-bold">{p.label}</div>
                  <div className="text-[10px] text-white/50">{p.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-white/80">{ar ? 'لون الشارة' : 'Badge accent color'}</div>
          <div className="flex flex-wrap gap-2">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`size-8 rounded-full transition ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#161310] scale-105' : 'opacity-80 hover:opacity-100'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-white/80">{ar ? 'الوسوم (حتى 5)' : 'Tags (up to 5)'}</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESET_TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    on ? 'bg-[var(--pf-accent)] text-[var(--pf-accent-fg)]' : 'bg-white/8 text-white/70 hover:bg-white/15'
                  }`}
                >
                  {t}
                </button>
              );
            })}
            {tags.filter((t) => !PRESET_TAGS.includes(t)).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--pf-accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--pf-accent-fg)]">
                {t}
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))}><X size={11} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              dir="auto"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
              placeholder={ar ? 'وسم مخصّص...' : 'Custom tag...'}
              className="flex-1 rounded-lg bg-black/35 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10"
            />
            <button type="button" onClick={addCustomTag} disabled={!tagInput.trim() || tags.length >= 5} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-40">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
