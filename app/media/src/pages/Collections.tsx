import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { social, useCaps, useMarathons, useSocialMe, type CustomList } from '../api';
import { useHost, useNav, useT } from '../host';
import { Img } from '../ui/Img';
import { Icon } from '../ui/Icon';
import { Poster } from '../ui/Poster';

// Custom user lists + TMDB Film Marathons
export function Collections() {
  const t = useT(), nav = useNav(), { toast } = useHost(), qc = useQueryClient();
  const me = useSocialMe().data;
  const caps = useCaps().data;
  const q = useMarathons(!!caps?.tmdb);
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const lists = me?.lists || [];
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim().slice(0, 48);
    if (!clean || !me) return;
    const list: CustomList = { id: `list-${Date.now()}`, name: clean, items: [] };
    await social('me-set', { lists: [...me.lists, list] });
    setName('');
    setOpenId(list.id);
    qc.invalidateQueries({ queryKey: ['social-me'] });
    qc.invalidateQueries({ queryKey: ['social-profile'] });
    toast(t('profile_saved'));
  };

  return (
    <div className="h-full overflow-y-auto px-12 pb-20 pt-28">
      <section className="mb-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">{t('my_custom_lists')}</h1>
          <form onSubmit={create} className="flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder={t('list_name_ph')}
              className="rounded-full bg-bg1 px-4 py-2 text-sm ring-1 ring-line focus:ring-acc" />
            <button type="submit" disabled={!name.trim()} className="rounded-full bg-acc px-4 py-2 text-sm font-semibold text-acc-ink disabled:opacity-40">
              + {t('new_list')}
            </button>
          </form>
        </div>

        {!lists.length ? (
          <p className="rounded-2xl bg-white/4 p-6 text-sm text-fg2">{t('empty_list')}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {lists.map((l) => {
                const open = openId === l.id;
                return (
                  <button key={l.id} onClick={() => setOpenId(open ? null : l.id)}
                    className={`group flex items-center gap-4 rounded-2xl bg-bg1 p-4 text-start ring-1 transition ${open ? 'ring-2 ring-acc' : 'ring-line hover:ring-acc/60'}`}>
                    <div className="flex -space-x-5 rtl:space-x-reverse">
                      {l.items.slice(0, 3).map((p) => (
                        <span key={p.id} className="h-16 w-11 flex-none overflow-hidden rounded-md bg-bg3 ring-2 ring-bg">
                          <Img srcs={[p.poster]} className="h-full w-full object-cover" />
                        </span>
                      ))}
                      {!l.items.length ? <span className="grid h-16 w-11 flex-none place-items-center rounded-md bg-bg3 text-fg3"><Icon n="layers" s={18} /></span> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold group-hover:text-acc">{l.name}</div>
                      <div className="text-xs text-fg2">{t('films_n', { n: l.items.length })}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {openId ? (() => {
              const sel = lists.find((x) => x.id === openId);
              if (!sel) return null;
              return (
                <div className="rounded-2xl bg-bg1/70 p-6 ring-1 ring-line">
                  <h3 className="mb-4 text-lg font-bold">{sel.name}</h3>
                  {sel.items.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-6">
                      {sel.items.map((p) => <Poster key={p.id} item={p} w={160} />)}
                    </div>
                  ) : <p className="text-sm text-fg3">{t('empty_list')}</p>}
                </div>
              );
            })() : null}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-2xl font-bold">{t('marathons')}</h2>
        <p className="mb-6 text-sm text-fg2">{caps && !caps.tmdb ? t('needs_tmdb') : t('collections_sub')}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
          {q.isLoading ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skel aspect-video rounded-xl" />) : null}
          {(q.data || []).map((c) => (
            <button key={c.id} onClick={() => nav.open({ kind: 'collection', id: c.id, name: c.name })} className="group text-start">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-bg2 ring-1 ring-line transition group-hover:ring-2 group-hover:ring-acc/70">
                <Img srcs={[c.background]} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                <div className="shade-b absolute inset-0" />
                <div className="absolute inset-x-4 bottom-3 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold">{c.name}</div>
                    <div className="text-xs text-fg2">{t('films_n', { n: c.parts.length })}</div>
                  </div>
                  <div className="flex -space-x-6 rtl:space-x-reverse">
                    {c.parts.slice(0, 4).map((p) => <span key={p.id} className="h-16 w-11 overflow-hidden rounded-md ring-2 ring-bg"><Img srcs={[p.poster]} className="h-full w-full object-cover" /></span>)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
