import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cin, useSearch, useSearchPeople, useSocialFriends, useSocialMe } from '../api';
import { useHost, useNav, useT, type Tab } from '../host';
import { usePrefs } from '../pages/Profile';
import { SETTINGS_NAV_ITEMS } from '../settings/searchIndex';
import { useSettingsStore } from '../settings/useSettingsStore';
import { Icon } from './Icon';
import { Img } from './Img';

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  icon?: string;
  thumb?: string | null;
  run: () => void;
}

const fuzzy = (q: string, text: string): number => {
  const s = text.toLowerCase();
  const n = q.toLowerCase().trim();
  if (!n) return 1;
  const idx = s.indexOf(n);
  if (idx >= 0) return 120 - idx;
  let i = 0;
  for (const ch of s) if (ch === n[i]) i++;
  return i === n.length ? 25 : 0;
};

export function CommandPalette() {
  const t = useT();
  const nav = useNav();
  const host = useHost();
  const qc = useQueryClient();
  const prefs = usePrefs().data;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const friendsQ = useSocialFriends();
  const meQ = useSocialMe();
  const searchQ = useSearch(open ? debouncedQ : '');
  const peopleQ = useSearchPeople(open ? debouncedQ : '');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 180);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onBus = (e: Event) => {
      const detail = (e as CustomEvent<{ q?: string }>).detail;
      if (detail?.q) setQ(detail.q);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('majlis-cmd-palette', onBus);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('majlis-cmd-palette', onBus);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQ('');
      setDebouncedQ('');
    }
  }, [open]);

  const staticItems = useMemo<PaletteItem[]>(() => {
    const ar = host.lang === 'ar';
    const tabs: { id: Tab; icon: string; label: string; kw: string }[] = [
      { id: 'home', icon: 'home', label: t('home'), kw: 'home main الرئيسية' },
      { id: 'discover', icon: 'compass', label: t('discover'), kw: 'discover recommendations اكتشف' },
      { id: 'movies', icon: 'film', label: t('movies'), kw: 'movies films أفلام' },
      { id: 'shows', icon: 'tv', label: t('shows'), kw: 'series tv shows مسلسلات' },
      { id: 'anime', icon: 'sparkle', label: t('anime'), kw: 'anime anilist mal أنمي' },
      { id: 'library', icon: 'bookmark', label: t('library'), kw: 'library watchlist favorites مكتبتي' },
      { id: 'addons', icon: 'puzzle', label: t('addons'), kw: 'addons stremio plugins إضافات' },
      { id: 'friends', icon: 'users', label: t('friends'), kw: 'friends social الأصدقاء' },
      { id: 'party', icon: 'room', label: t('party'), kw: 'watch party voting المجلس سهرة' },
      { id: 'catalogs', icon: 'grid', label: t('catalogs'), kw: 'catalogs الكتالوجات' },
      { id: 'calendar', icon: 'calendar', label: t('calendar'), kw: 'calendar schedule التقويم' },
      { id: 'collections', icon: 'layers', label: t('collections'), kw: 'collections marathons المجموعات' },
      { id: 'downloads', icon: 'download', label: t('downloads'), kw: 'downloads offline التنزيلات' },
      { id: 'profile', icon: 'user', label: t('profile'), kw: 'profile stats badges الملف' },
      { id: 'settings', icon: 'set', label: t('settings'), kw: 'settings preferences الإعدادات' },
    ];

    const items: PaletteItem[] = tabs.map((tb) => ({
      id: `tab:${tb.id}`,
      group: t('pal_pages'),
      title: tb.label,
      sub: ar ? undefined : tb.kw.split(' ').slice(0, 2).join(' · '),
      icon: tb.icon,
      run: () => nav.go(tb.id),
    }));

    items.push(
      {
        id: 'act:lang',
        group: t('pal_quick_actions'),
        title: ar ? 'تبديل اللغة إلى الإنجليزية' : 'Switch Language to Arabic (العربية)',
        icon: 'chat',
        run: () => host.setLang?.(ar ? 'en' : 'ar'),
      },
      {
        id: 'act:copy-id',
        group: t('pal_quick_actions'),
        title: ar ? 'نسخ رابط الصداقة / المعرف' : 'Copy My Majlis Friend Link',
        sub: meQ.data?.friendLink || meQ.data?.id || '',
        icon: 'copy',
        run: async () => {
          const link = meQ.data?.friendLink || `majlis://friend/${meQ.data?.id || ''}`;
          await navigator.clipboard?.writeText(link).catch(() => {});
          host.toast(t('discord_copied'));
        },
      },
      {
        id: 'act:theme',
        group: t('pal_quick_actions'),
        title: ar ? 'تبديل ثيم السينما التالي' : 'Cycle Cinema Theme',
        icon: 'sparkle',
        run: async () => {
          const themes = ['majlis', 'oled', 'nord', 'dracula', 'noir'] as const;
          const cur = (prefs?.look?.theme || host.theme || 'majlis') as (typeof themes)[number];
          const next = themes[(themes.indexOf(cur) + 1) % themes.length];
          await cin('prefs-set', { look: { theme: next } }).catch(() => {});
          qc.invalidateQueries({ queryKey: ['prefs'] });
          host.toast(next.toUpperCase());
        },
      },
      {
        id: 'act:fullscreen',
        group: t('pal_quick_actions'),
        title: ar ? 'ملء الشاشة / استعادة' : 'Toggle Maximize Window',
        icon: 'full',
        run: () => { window.majlis?.invoke?.('win:maximize')?.catch(() => {}); },
      },
    );

    for (const f of friendsQ.data?.friends || []) {
      if (f.friendStatus !== 'accepted') continue;
      items.push({
        id: `friend:${f.id}`,
        group: t('friends'),
        title: f.name,
        sub: f.handle ? `@${f.handle}` : f.id,
        icon: 'user',
        thumb: f.avatar || null,
        run: () => nav.open({ kind: 'friend', id: f.id }),
      });
    }

    for (const s of SETTINGS_NAV_ITEMS) {
      items.push({
        id: `set:${s.id}`,
        group: t('pal_settings_pages'),
        title: ar ? s.titleAr : s.titleEn,
        sub: ar ? s.descAr : s.descEn,
        icon: 'sliders',
        run: () => {
          useSettingsStore.getState().setActivePage(s.id);
          nav.go('settings');
        },
      });
    }

    return items;
  }, [host, nav, t, qc, prefs?.look?.theme, friendsQ.data?.friends, meQ.data?.friendLink, meQ.data?.id]);

  const list = useMemo<PaletteItem[]>(() => {
    const query = q.trim();
    const isPlayableUrl = /^(magnet:\?|https?:\/\/)/i.test(query);
    const directPlayItems: PaletteItem[] = isPlayableUrl ? [{
      id: 'act:play-url',
      group: t('pal_quick_actions'),
      title: t('play_url_btn'),
      sub: query,
      icon: 'play',
      run: async () => {
        const res = await cin<{ ok: boolean; error?: string }>('play-url', { url: query }).catch(() => ({ ok: false, error: 'invalid_url' }));
        if (!res.ok) host.toast(t('play_url_invalid'));
      },
    }] : [];
    const rankedStatic = query
      ? staticItems
          .map((it) => ({ it, sc: Math.max(fuzzy(query, it.title), fuzzy(query, it.sub || '')) }))
          .filter((x) => x.sc > 0)
          .sort((a, b) => b.sc - a.sc)
          .map((x) => x.it)
      : staticItems.slice(0, 14);

    if (query.length < 2) return [...directPlayItems, ...rankedStatic].slice(0, 20);

    const mediaHits: PaletteItem[] = (searchQ.data || [])
      .flatMap((g) => g.metas)
      .slice(0, 8)
      .map((m) => ({
        id: `meta:${m.type}:${m.id}`,
        group: m.type === 'movie' ? t('type_movie') : t('type_series'),
        title: m.name,
        sub: [m.year, m.imdbRating ? `★ ${m.imdbRating}` : ''].filter(Boolean).join(' · '),
        thumb: m.poster || null,
        icon: m.type === 'movie' ? 'film' : 'tv',
        run: () => nav.open({ kind: 'title', type: m.type, id: m.id }),
      }));

    const personHits: PaletteItem[] = (peopleQ.data || [])
      .slice(0, 4)
      .map((p) => ({
        id: `person:${p.id}`,
        group: t('tab_people'),
        title: p.name,
        sub: p.knownFor || '',
        thumb: p.photo || null,
        icon: 'user',
        run: () => nav.open({ kind: 'person', id: p.id, name: p.name }),
      }));

    return [...directPlayItems, ...mediaHits, ...personHits, ...rankedStatic].slice(0, 24);
  }, [q, staticItems, searchQ.data, peopleQ.data, nav, t, host]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, list.length - 1)));
  }, [list.length]);

  if (!open) return null;

  const exec = (item?: PaletteItem) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  return (
    <div onClick={() => setOpen(false)} className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-md fade-in">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-bg1/96 shadow-2xl ring-1 ring-acc/25"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <Icon n="search" s={19} className="text-acc" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter' && list[sel]) { e.preventDefault(); exec(list[sel]); }
            }}
            placeholder={t('pal_placeholder')}
            className="min-w-0 flex-1 text-sm text-fg placeholder:text-fg3"
          />
          <kbd dir="ltr" className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-fg3">ESC</kbd>
        </div>

        <div className="max-h-[min(60vh,460px)] overflow-y-auto p-2">
          {!list.length ? (
            <div className="py-10 text-center text-xs text-fg3">{t('no_results', { q })}</div>
          ) : (
            list.map((it, idx) => (
              <button
                key={it.id}
                onMouseEnter={() => setSel(idx)}
                onClick={() => exec(it)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition ${
                  idx === sel ? 'bg-acc/18 text-fg ring-1 ring-acc/50' : 'text-fg2 hover:bg-white/6'
                }`}
              >
                {it.thumb ? (
                  <Img srcs={[it.thumb]} className="h-10 w-7 flex-none rounded bg-bg3 object-cover" />
                ) : (
                  <span className={`grid size-8 flex-none place-items-center rounded-lg ${idx === sel ? 'bg-acc text-acc-ink' : 'bg-white/8 text-fg3'}`}>
                    <Icon n={it.icon || 'search'} s={15} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-sm font-semibold">{it.title}</div>
                  {it.sub ? <div dir="auto" className="truncate text-[11px] text-fg3">{it.sub}</div> : null}
                </div>
                <span className="flex-none rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium text-fg3">{it.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
