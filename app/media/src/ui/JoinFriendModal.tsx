import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke, parseJoinTarget, normalizeDigits, useSocialFriends, useSocialRoom, type FriendEntry } from '../api';
import { useHost, useNav, useT } from '../host';
import { Icon } from './Icon';
import { SocialAvatar } from './Social';
import { useSettingsStore } from '../settings/useSettingsStore';
import type { Key } from '../i18n';

const FAIL_KEY_MAP: Record<string, Key> = {
  no_server: 'fail_no_server',
  server_access: 'fail_server_access',
  pin: 'fail_pin',
  offline: 'fail_offline',
  declined: 'fail_declined',
  timeout: 'fail_timeout',
  rate: 'fail_rate',
  bad: 'fail_bad',
};

export function JoinFriendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { toast } = useHost();
  const nav = useNav();
  const qc = useQueryClient();

  const [input, setInput] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [needsServer, setNeedsServer] = useState(false);

  const friendsQ = useSocialFriends(open);
  const roomQ = useSocialRoom(open);

  useEffect(() => {
    if (!open) return;
    setErrMsg(null);
    setNeedsServer(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const myId = roomQ.data?.myId || friendsQ.data?.myId || '';
  const serverUnavailable = roomQ.data?.hasServer === false;
  const activeFriends: FriendEntry[] = (friendsQ.data?.friends || []).filter(
    (f) => f.trust !== 'block' && (f.inParty || f.online),
  );

  const goRelaySettings = () => {
    useSettingsStore.getState().setActivePage('relay');
    onClose();
    nav.go('settings');
  };

  const connectTarget = async (raw: string, explicitPin?: string) => {
    if (busy) return;
    const parsed = parseJoinTarget(raw);
    if (!parsed) {
      setErrMsg(t('join_bad_target'));
      return;
    }
    if (myId && parsed.target === myId) {
      setErrMsg(t('join_self'));
      return;
    }

    setBusy(true);
    setErrMsg(null);
    setNeedsServer(false);
    const cleanPin = normalizeDigits(explicitPin ?? pin).replace(/\D/g, '');
    try {
      const caps = {
        codecs: [],
        screen: {
          w: Math.round(window.screen.width * (window.devicePixelRatio || 1)),
          h: Math.round(window.screen.height * (window.devicePixelRatio || 1)),
          hz: 60,
        },
      };
      const res = await invoke<{ ok?: boolean; reason?: string }>('connect', {
        target: parsed.target,
        caps,
        ...(cleanPin ? { pin: cleanPin } : {}),
      }).catch((e) => ({ ok: false, reason: (e as Error)?.message || 'bad' }));

      if (res?.ok) {
        toast(t('join_requested'));
        qc.invalidateQueries({ queryKey: ['social-room'] });
        onClose();
        return;
      }

      const reason = String(res?.reason || 'bad');
      if (reason === 'pin') {
        setShowPin(true);
        setErrMsg(t('fail_pin'));
        return;
      }
      if (reason === 'no_server' || reason === 'server_access') {
        setNeedsServer(true);
      }
      const key = FAIL_KEY_MAP[reason];
      const localized = key ? t(key) : reason;
      setErrMsg(localized);
      toast(localized);
    } finally {
      setBusy(false);
    }
  };

  const fmtId = (id: string) => `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;

  return (
    <div
      data-testid="join-friend-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-bg1 p-6 shadow-2xl ring-1 ring-white/15 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-fg">{t('join_modal_title')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg2">{t('join_modal_sub')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-white/8 text-fg2 hover:bg-white/15 hover:text-fg"
          >
            <Icon n="x" s={15} />
          </button>
        </div>

        {(serverUnavailable || needsServer) ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-acc/30 bg-acc/10 px-4 py-3 text-xs">
            <div className="flex items-center gap-2 text-fg">
              <Icon n="spark" s={15} className="text-acc shrink-0" />
              <span>{t('party_server_needed')}</span>
            </div>
            <button
              type="button"
              onClick={goRelaySettings}
              className="rounded-full bg-acc px-3 py-1.5 font-bold text-acc-ink hover:brightness-110"
            >
              {t('party_open_server_settings')}
            </button>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            connectTarget(input);
          }}
          className="space-y-3"
        >
          <input
            dir="ltr"
            autoFocus
            data-testid="join-target-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (errMsg) setErrMsg(null);
            }}
            placeholder={t('join_input_ph')}
            className="w-full rounded-2xl bg-black/40 px-4 py-3 font-mono text-sm text-fg ring-1 ring-white/12 placeholder:font-sans placeholder:text-fg3 outline-none focus:ring-acc"
          />

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              className="text-xs font-medium text-fg2 hover:text-acc"
            >
              {showPin ? '▾' : '▸'} {t('join_pin_ph')}
            </button>
          </div>

          {showPin ? (
            <input
              dir="ltr"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={t('join_pin_ph')}
              className="w-full rounded-2xl bg-black/40 px-4 py-2.5 font-mono text-sm text-fg ring-1 ring-white/12 placeholder:font-sans placeholder:text-fg3 outline-none focus:ring-acc"
            />
          ) : null}

          {errMsg ? (
            <div className="rounded-xl bg-red-500/15 px-3.5 py-2 text-xs font-medium text-red-200 ring-1 ring-red-400/30">
              {errMsg}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/8 px-4 py-2 text-xs font-semibold text-fg2 hover:bg-white/15"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-full bg-acc px-5 py-2 text-xs font-bold text-acc-ink hover:brightness-110 disabled:opacity-45"
            >
              {busy ? t('join_connecting') : t('join_connect_now')}
            </button>
          </div>
        </form>

        <div className="border-t border-line pt-4 space-y-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-fg3">
            {t('join_quick_friends')} ({activeFriends.length})
          </div>
          {activeFriends.length ? (
            <div className="max-h-44 space-y-2 overflow-y-auto pe-1">
              {activeFriends.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-bg2 p-2.5 ring-1 ring-line"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <SocialAvatar avatar={f.avatar} name={f.name} accent={f.accent} size={34} />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-fg">{f.name}</div>
                      <div dir="ltr" className="font-mono text-[11px] text-fg3">
                        {fmtId(f.id)}
                        {f.inParty ? ` · ${t('in_party_now', { n: f.inParty.count })}` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => connectTarget(f.id)}
                    className="shrink-0 rounded-full bg-acc/20 px-3.5 py-1.5 text-xs font-bold text-acc ring-1 ring-acc/30 hover:bg-acc hover:text-acc-ink disabled:opacity-45"
                  >
                    {t('join_btn')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-bg2/60 p-3 text-center text-xs text-fg3">
              {t('join_no_friends_online')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
