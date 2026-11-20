import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke, social, useSocialFriends, useSocialMe, type FriendEntry } from '../api';
import { useHost, useNav, useT } from '../host';
import { Icon } from '../ui/Icon';
import { QrCode } from '../ui/QrCode';
import { SocialAvatar } from '../ui/Social';
import { JoinFriendModal } from '../ui/JoinFriendModal';

const fmtId = (id: string) => (id.length === 9 ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : id);

export function Friends() {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const me = useSocialMe().data;
  const fq = useSocialFriends();
  const data = fq.data;
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['social-friends'] });
    qc.invalidateQueries({ queryKey: ['social-me'] });
  };

  const addFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = target.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await social<{ status: string }>('add', { idOrHandle: q });
      setTarget('');
      refresh();
      toast(r.status === 'accepted' ? t('friend_added') : t('friend_req_sent'));
    } catch (err) {
      toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (discordMsg = false) => {
    const link = data?.signedFriendCode || me?.signedFriendCode || data?.friendLink || me?.friendLink || '';
    if (!link) return;
    await navigator.clipboard?.writeText(discordMsg ? `${me?.displayName || 'Majlis'}: ${link}` : link).catch(() => {});
    toast(t(discordMsg ? 'discord_copied' : 'copy_friend_link'));
  };

  const [joinOpen, setJoinOpen] = useState(false);

  const joinFriend = async (id: string) => {
    const res = await invoke<{ ok?: boolean; reason?: string }>('connect', {
      target: id,
      caps: {
        codecs: [],
        screen: {
          w: Math.round(window.screen.width * (window.devicePixelRatio || 1)),
          h: Math.round(window.screen.height * (window.devicePixelRatio || 1)),
          hz: 60,
        },
      },
    }).catch((e) => ({ ok: false, reason: (e as Error)?.message || 'bad' }));
    if (res?.ok) {
      toast(t('join_requested'));
      return;
    }
    if (res?.reason === 'pin') {
      setJoinOpen(true);
      return;
    }
    const map: Record<string, Parameters<typeof t>[0]> = {
      no_server: 'fail_no_server',
      server_access: 'fail_server_access',
      offline: 'fail_offline',
      declined: 'fail_declined',
      timeout: 'fail_timeout',
      rate: 'fail_rate',
      bad: 'fail_bad',
    };
    const key = map[String(res?.reason || 'bad')];
    toast(key ? t(key) : String(res?.reason || t('fail_bad')));
  };

  const accept = async (id: string) => { await social('accept', { id }); refresh(); toast(t('friend_added')); };
  const decline = async (id: string) => { await social('decline', { id }); refresh(); };
  const toggleBlock = async (f: FriendEntry) => { await social('block', { id: f.id, block: f.trust !== 'block' }); refresh(); };
  const remove = async (id: string) => { await social('remove', { id }); refresh(); };

  const statusLine = (f: FriendEntry) => {
    if (f.trust === 'block') return t('block_user');
    if (f.inParty) return t('in_party_now', { n: f.inParty.count });
    if (f.watching) return t('watching_now', { name: f.watching.name });
    if (f.online) return t('online_now');
    return t('offline_status');
  };

  const incoming = (data?.requests || []).filter((r) => r.direction === 'in');
  const friends = data?.friends || [];

  return (
    <div className="h-full overflow-y-auto px-6 pb-24 pt-28 sm:px-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            {me ? <SocialAvatar avatar={me.avatar} name={me.displayName || me.id} accent={me.accent} size={56} /> : null}
            <div>
              <h1 className="text-3xl font-bold">{t('friends')}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg2">
                {me?.displayName ? <span dir="auto" className="font-semibold text-fg">{me.displayName}</span> : null}
                {data?.myId ? <span dir="ltr" className="rounded-full bg-white/8 px-2.5 py-0.5 font-mono text-xs">{fmtId(data.myId)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(data?.signedFriendCode || me?.signedFriendCode || data?.friendLink) ? (
              <div className="hidden rounded-xl bg-black/35 p-1.5 ring-1 ring-white/15 sm:block" title={t('copy_friend_link')}>
                <QrCode value={data?.signedFriendCode || me?.signedFriendCode || data?.friendLink || ''} size={68} />
              </div>
            ) : null}
            <button onClick={() => copyLink(false)} className="flex items-center gap-1.5 rounded-full bg-white/8 px-4 py-2 text-sm font-medium transition hover:bg-white/15">
              <Icon n="link" s={15} />{t('copy_friend_link')}
            </button>
            <button onClick={() => copyLink(true)} className="flex items-center gap-1.5 rounded-full bg-acc/20 px-4 py-2 text-sm font-semibold text-acc ring-1 ring-acc/30 transition hover:bg-acc hover:text-acc-ink">
              <Icon n="copy" s={15} />{t('share_discord')}
            </button>
            <button data-testid="friends-join-btn" onClick={() => setJoinOpen(true)} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-fg ring-1 ring-white/15 transition hover:bg-acc hover:text-acc-ink">
              <Icon n="users" s={15} />{t('join_by_code')}
            </button>
            <button onClick={() => nav.go('party')} className="flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink">
              <Icon n="users" s={15} />{t('party')}
            </button>
            <JoinFriendModal open={joinOpen} onClose={() => setJoinOpen(false)} />
          </div>
        </div>

        <form onSubmit={addFriend} className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg1 p-4 ring-1 ring-line">
          <Icon n="user" s={18} className="text-acc" />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={t('add_friend_ph')}
            className="min-w-[240px] flex-1 rounded-full bg-white/6 px-4 py-2.5 text-sm ring-1 ring-line focus:ring-acc"
          />
          <button type="submit" disabled={busy || !target.trim()} className="rounded-full bg-fg px-6 py-2.5 text-sm font-semibold text-bg transition hover:bg-acc hover:text-acc-ink disabled:opacity-50">
            {busy ? '…' : t('add_friend_btn')}
          </button>
        </form>

        {incoming.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('friend_requests')} ({incoming.length})</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {incoming.map((req) => (
                <div key={req.id} className="flex items-center gap-3.5 rounded-2xl bg-bg1 p-4 ring-1 ring-acc/35">
                  <SocialAvatar avatar={req.avatar} name={req.name} accent={req.accent} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={{ color: req.accent }}>{req.name}</div>
                    <div className="truncate text-xs text-fg3">
                      <span dir="ltr" className="font-mono">{fmtId(req.id)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => accept(req.id)} className="rounded-full bg-acc px-3.5 py-1.5 text-xs font-semibold text-acc-ink hover:brightness-110">{t('accept')}</button>
                    <button onClick={() => decline(req.id)} className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-fg2 hover:bg-white/15">{t('decline')}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {friends.length ? (
          <section className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {friends.map((f) => (
              <div key={f.id} className="flex flex-col gap-3 rounded-2xl bg-bg1 p-4 ring-1 ring-line transition hover:ring-white/25">
                <button onClick={() => nav.open({ kind: 'friend', id: f.id })} className="flex items-center gap-3.5 text-start">
                  <div className="relative">
                    <SocialAvatar avatar={f.avatar} name={f.name} accent={f.accent} size={50} />
                    <span className={`absolute bottom-0 end-0 size-3.5 rounded-full ring-2 ring-bg1 ${f.online ? 'bg-emerald-400' : 'bg-fg3/60'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold" style={{ color: f.accent }}>{f.name}</div>
                    <div className="truncate text-xs text-fg3">
                      <span dir="ltr" className="font-mono">{fmtId(f.id)}</span>
                    </div>
                    <div className={`mt-0.5 truncate text-xs ${f.watching || f.inParty ? 'text-acc' : f.online ? 'text-emerald-300' : 'text-fg3'}`}>
                      {statusLine(f)}
                    </div>
                    {f.compatibility?.pct != null ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-acc/15 px-2 py-0.5 text-[10.5px] font-bold text-acc ring-1 ring-acc/30">
                          {t('taste_compat_pct', { n: f.compatibility.pct })}
                        </span>
                        {f.compatibility.sharedGenres.slice(0, 2).map((g) => (
                          <span key={g} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-fg2">{g}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>
                {f.bio ? <p dir="auto" className="clamp-2 text-xs leading-relaxed text-fg2">{f.bio}</p> : null}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  <button onClick={() => nav.open({ kind: 'friend', id: f.id })} className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium hover:bg-white/15">
                    {t('view_profile')}
                  </button>
                  {(f.inParty || f.online) && f.trust !== 'block' ? (
                    <button onClick={() => joinFriend(f.id)} className="rounded-full bg-acc px-3 py-1.5 text-xs font-semibold text-acc-ink hover:brightness-110">
                      {t('join_friend')}
                    </button>
                  ) : null}
                  <span className="flex-1" />
                  <button onClick={() => toggleBlock(f)} className="rounded-full px-2.5 py-1.5 text-xs text-fg3 hover:bg-white/8 hover:text-fg">
                    {f.trust === 'block' ? t('unblock_user') : t('block_user')}
                  </button>
                  <button onClick={() => remove(f.id)} aria-label={t('remove')} className="rounded-full px-2.5 py-1.5 text-xs text-fg3 hover:bg-red-500/15 hover:text-red-300">
                    {t('remove')}
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : (
          <div className="rounded-2xl bg-bg1 p-10 text-center text-sm text-fg2 ring-1 ring-line">
            {t('empty_list')}
          </div>
        )}
      </div>
    </div>
  );
}
