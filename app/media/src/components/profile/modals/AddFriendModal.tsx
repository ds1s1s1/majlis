import { useState } from 'react';
import { Check, Copy, UserCheck, UserPlus, UserX } from 'lucide-react';
import { social } from '../../../api';
import { type ProfileFriend } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

export function AddFriendModal({
  open,
  myId,
  friends: _friends,
  incomingRequests,
  onLocalFriendAdded: _onLocalFriendAdded,
  onResolveRequest,
  onSyncRefresh,
  onClose,
}: {
  open: boolean;
  myId: string;
  friends: ProfileFriend[];
  incomingRequests: { id: string; name: string; handle: string; avatar: string | null }[];
  onLocalFriendAdded: (f: ProfileFriend) => void;
  onResolveRequest: (id: string, accept: boolean) => void;
  onSyncRefresh: () => void;
  onClose: () => void;
}) {
  const { lang, toast } = useHost();
  const ar = lang === 'ar';
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const copyId = async () => {
    try { await navigator.clipboard.writeText(myId); } catch {}
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1600);
  };

  const sendAdd = async (idOrHandle: string) => {
    const clean = idOrHandle.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const res = await social<{ verifiedOffline?: boolean }>('add', { idOrHandle: clean });
      toast(res?.verifiedOffline
        ? (ar ? 'تم التحقق من رمز الصداقة وإضافته فوراً' : 'Signed Friend Code verified and added')
        : (ar ? 'تم إرسال طلب الصداقة' : 'Friend request sent'));
      setTarget('');
      onSyncRefresh();
    } catch (e) {
      const msg = (e as Error).message || '';
      toast(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const handleReq = async (id: string, accept: boolean) => {
    try {
      await social(accept ? 'accept' : 'decline', { id });
      onSyncRefresh();
    } catch {
      onResolveRequest(id, accept);
    }
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'إضافة صديق' : 'Add friend'}
      subtitle={ar ? 'أضف عبر معرّف مجلس المكون من 9 أرقام أو @اسم المستخدم' : 'Add friends by 9-digit Majlis ID or @handle'}
    >
      <div className="space-y-5">
        {/* Own ID copy */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/45">{ar ? 'معرّفي في مجلس' : 'Your Majlis ID'}</div>
            <div dir="ltr" className="font-mono text-sm font-bold text-[var(--pf-accent)]">{myId}</div>
          </div>
          <button type="button" onClick={copyId} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20">
            {copiedId ? <Check size={12} /> : <Copy size={12} />}
            <span>{copiedId ? (ar ? 'نُسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</span>
          </button>
        </div>

        {/* Direct Add Form */}
        <form onSubmit={(e) => { e.preventDefault(); sendAdd(target); }} className="flex gap-2">
          <input
            dir="ltr"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={ar ? 'مثال: 123456789 أو @player' : 'e.g. 123456789 or @handle'}
            className="flex-1 rounded-xl bg-black/35 px-3.5 py-2 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !target.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-45"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            <UserPlus size={14} />{ar ? 'إرسال طلب' : 'Add'}
          </button>
        </form>

        {/* Incoming Requests */}
        {incomingRequests.length ? (
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
              {ar ? 'طلبات واردة' : 'Incoming requests'}
            </div>
            <div className="space-y-2">
              {incomingRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="min-w-0">
                    <div dir="auto" className="truncate text-xs font-semibold">{r.name}</div>
                    <div dir="ltr" className="font-mono text-[10px] text-white/50">{r.handle ? `@${r.handle}` : r.id}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => handleReq(r.id, true)} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30">
                      <UserCheck size={12} />{ar ? 'قبول' : 'Accept'}
                    </button>
                    <button type="button" onClick={() => handleReq(r.id, false)} className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/25">
                      <UserX size={12} />{ar ? 'رفض' : 'Decline'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-white/60">
          {ar
            ? 'أضف أي صديق فوراً عبر معرفه (9 أرقام) أو @المعرف أو رمز الصداقة الموقّع رقمياً (majlis://friend/... أو MAJLIS-F1:...). لا يتطلب الأمر أي حساب مركزي أو موقع خارجي.'
            : 'Add any friend directly using their 9-digit Majlis ID, @handle, or cryptographically signed P2P friend code (majlis://friend/... or MAJLIS-F1:...). Works offline-first with zero central accounts.'}
        </div>
      </div>
    </ModalFrame>
  );
}
