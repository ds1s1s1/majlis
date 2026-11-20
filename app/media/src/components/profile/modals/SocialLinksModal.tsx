import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ProfileSocialLink } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { SOCIAL_PLATFORMS, SocialPlatformIcon, type SocialPlatformId } from '../icons/SocialIcons';
import { ModalFrame } from './ModalFrame';

export function SocialLinksModal({
  open,
  links,
  onSave,
  onClose,
}: {
  open: boolean;
  links: ProfileSocialLink[];
  onSave: (next: ProfileSocialLink[]) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [items, setItems] = useState<ProfileSocialLink[]>(links);
  const [platform, setPlatform] = useState<SocialPlatformId>('discord');
  const [handle, setHandle] = useState('');

  useEffect(() => {
    if (open) {
      setItems(links.map((x) => ({ ...x })));
      setHandle('');
    }
  }, [open, links]);

  const activeMeta = SOCIAL_PLATFORMS.find((p) => p.id === platform) || SOCIAL_PLATFORMS[0];

  const addLink = () => {
    const clean = handle.trim();
    if (!clean || items.length >= 8) return;
    setItems([...items, { id: `soc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, platform, handle: clean }]);
    setHandle('');
  };

  const move = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= items.length) return;
    const next = [...items];
    [next[idx], next[t]] = [next[t], next[idx]];
    setItems(next);
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      maxWidth="max-w-2xl"
      title={ar ? 'الروابط الاجتماعية' : 'Social links'}
      subtitle={ar ? `اربط حتى 8 حسابات خارجية (${items.length}/8)` : `Link up to 8 external accounts (${items.length}/8)`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => { onSave(items); onClose(); }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 8x2 Platform Selector Grid */}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {SOCIAL_PLATFORMS.map((p) => {
            const on = platform === p.id;
            return (
              <button
                key={p.id}
                type="button"
                title={p.name}
                onClick={() => setPlatform(p.id)}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-2 transition ${
                  on ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08]'
                }`}
              >
                <span style={{ color: p.color }}><SocialPlatformIcon id={p.id} size={16} /></span>
                <span className="w-full truncate text-center text-[10px] text-white/75">{p.name}</span>
              </button>
            );
          })}
        </div>

        {/* Handle Input */}
        <form onSubmit={(e) => { e.preventDefault(); addLink(); }} className="flex flex-wrap items-center gap-2">
          <div dir="ltr" className="flex min-w-[220px] flex-1 items-center overflow-hidden rounded-xl bg-black/35 ring-1 ring-white/10 focus-within:ring-[var(--pf-accent)]">
            <span className="shrink-0 bg-white/5 px-3 py-2 font-mono text-[11px] text-white/45">{activeMeta.prefix}</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="username"
              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-xs text-white outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!handle.trim() || items.length >= 8}
            className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            <Plus size={14} />{ar ? 'إضافة' : 'Add'}
          </button>
        </form>

        {/* Added Links List */}
        {items.length ? (
          <div className="space-y-1.5">
            {items.map((l, i) => {
              const meta = SOCIAL_PLATFORMS.find((p) => p.id === l.platform) || SOCIAL_PLATFORMS[0];
              return (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span style={{ color: meta.color }}><SocialPlatformIcon id={meta.id} size={15} /></span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{meta.name}</div>
                      <div dir="ltr" className="truncate font-mono text-[11px] text-white/55">{l.handle}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowUp size={12} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded p-1 hover:bg-white/10 disabled:opacity-25"><ArrowDown size={12} /></button>
                    <button type="button" onClick={() => setItems(items.filter((x) => x.id !== l.id))} className="rounded p-1 text-red-400 hover:bg-red-500/15"><Trash2 size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 py-4 text-center text-xs text-white/45">
            {ar ? 'لم تتم إضافة روابط بعد.' : 'No social accounts added yet.'}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
