import { useEffect, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { UserProfileState } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

type GamingCfg = UserProfileState['showcase']['gamingCard'];

const PLATFORMS: { id: GamingCfg['platform']; name: string; color: string; hint: string }[] = [
  { id: 'steam', name: 'Steam', color: '#66C0F4', hint: 'steamcommunity.com/id/...' },
  { id: 'xbox', name: 'Xbox', color: '#107C10', hint: 'Gamertag' },
  { id: 'playstation', name: 'PlayStation', color: '#0070D1', hint: 'PSN Online ID' },
  { id: 'minecraft', name: 'Minecraft', color: '#5CB874', hint: 'Java / Bedrock Name' },
];

export function GamingProfileModal({
  open,
  value,
  onSave,
  onClose,
}: {
  open: boolean;
  value: GamingCfg;
  onSave: (next: GamingCfg) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [enabled, setEnabled] = useState(value.enabled);
  const [platform, setPlatform] = useState<GamingCfg['platform']>(value.platform);
  const [gamertag, setGamertag] = useState(value.gamertag);

  useEffect(() => {
    if (open) {
      setEnabled(value.enabled);
      setPlatform(value.platform);
      setGamertag(value.gamertag);
    }
  }, [open, value]);

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'بطاقة الألعاب' : 'Gaming profile card'}
      subtitle={ar ? 'اعرض حسابك في الألعاب على ملفك الشخصي' : 'Show your connected gaming identity on your profile'}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => { onSave({ enabled, platform, gamertag: gamertag.trim() }); onClose(); }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/25 px-4 py-3">
          <span className="text-sm font-medium">{ar ? 'إظهار بطاقة الألعاب في الملف' : 'Show gaming card on profile'}</span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--pf-accent)]" />
        </label>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
            {ar ? 'المنصة' : 'Platform'}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {PLATFORMS.map((p) => {
              const sel = platform === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-start transition ${
                    sel ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${p.color}22`, color: p.color }}>
                    <Gamepad2 size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{p.name}</div>
                    <div className="truncate text-[10px] text-white/45">{p.hint}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-white/75">{ar ? 'اسم اللاعب / المعرّف' : 'Gamertag / Username'}</span>
          <input
            dir="ltr"
            value={gamertag}
            maxLength={40}
            onChange={(e) => setGamertag(e.target.value)}
            placeholder="PlayerOne"
            className="w-full rounded-xl bg-black/35 px-3.5 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
        </label>
      </div>
    </ModalFrame>
  );
}
