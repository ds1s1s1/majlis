import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import {
  DEMO_BOOK_CATALOG, DEMO_GAME_CATALOG, DEMO_MUSIC_CATALOG, inlinePoster,
  type ProfileFavoriteWork, type ProfileMusicArtist,
} from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { ModalFrame } from './ModalFrame';

export function FavoritesPickerModal({
  open,
  variant,
  selectedGames,
  selectedBooks,
  selectedMusic,
  onSaveGames,
  onSaveBooks,
  onSaveMusic,
  onClose,
}: {
  open: boolean;
  variant: 'games' | 'books' | 'music' | null;
  selectedGames: ProfileFavoriteWork[];
  selectedBooks: ProfileFavoriteWork[];
  selectedMusic: ProfileMusicArtist[];
  onSaveGames: (items: ProfileFavoriteWork[]) => void;
  onSaveBooks: (items: ProfileFavoriteWork[]) => void;
  onSaveMusic: (items: ProfileMusicArtist[]) => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [query, setQuery] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customSub, setCustomSub] = useState('');
  const [pickedWorks, setPickedWorks] = useState<ProfileFavoriteWork[]>([]);
  const [pickedMusic, setPickedMusic] = useState<ProfileMusicArtist[]>([]);

  const maxItems = variant === 'music' ? 12 : 5;

  useEffect(() => {
    if (!open || !variant) return;
    setQuery('');
    setCustomTitle('');
    setCustomSub('');
    if (variant === 'games') setPickedWorks([...selectedGames]);
    else if (variant === 'books') setPickedWorks([...selectedBooks]);
    else setPickedMusic([...selectedMusic]);
  }, [open, variant, selectedGames, selectedBooks, selectedMusic]);

  const workPool = useMemo(() => {
    const base = variant === 'games' ? DEMO_GAME_CATALOG : DEMO_BOOK_CATALOG;
    const map = new Map<string, ProfileFavoriteWork>();
    for (const x of [...pickedWorks, ...base]) map.set(x.id, x);
    const q = query.trim().toLowerCase();
    return [...map.values()].filter((x) => !q || x.title.toLowerCase().includes(q) || (x.subtitle || '').toLowerCase().includes(q));
  }, [variant, pickedWorks, query]);

  const musicPool = useMemo(() => {
    const map = new Map<string, ProfileMusicArtist>();
    for (const x of [...pickedMusic, ...DEMO_MUSIC_CATALOG]) map.set(x.id, x);
    const q = query.trim().toLowerCase();
    return [...map.values()].filter((x) => !q || x.name.toLowerCase().includes(q) || (x.genre || '').toLowerCase().includes(q));
  }, [pickedMusic, query]);

  if (!variant) return null;

  const title = variant === 'games'
    ? (ar ? 'الألعاب المفضلة' : 'Favourite Games')
    : variant === 'books'
      ? (ar ? 'الكتب المفضلة' : 'Favourite Books')
      : (ar ? 'الفنانون والموسيقى المفضلة' : 'Favourite Music');

  const count = variant === 'music' ? pickedMusic.length : pickedWorks.length;

  const addCustom = () => {
    const t = customTitle.trim();
    if (!t) return;
    if (variant === 'music') {
      if (pickedMusic.length >= maxItems) return;
      setPickedMusic([...pickedMusic, {
        id: `cus-mus-${Date.now()}`,
        name: t,
        genre: customSub.trim() || undefined,
        avatar: inlinePoster(t, '#2d1c10', '#12100E'),
      }]);
    } else {
      if (pickedWorks.length >= maxItems) return;
      setPickedWorks([...pickedWorks, {
        id: `cus-${variant}-${Date.now()}`,
        title: t,
        subtitle: customSub.trim() || undefined,
        kind: variant,
        cover: inlinePoster(t, '#2b2114', '#12100E'),
      }]);
    }
    setCustomTitle('');
    setCustomSub('');
  };

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={title}
      subtitle={ar ? `اختر حتى ${maxItems} عناصر (${count}/${maxItems})` : `Choose up to ${maxItems} items (${count}/${maxItems})`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-medium hover:bg-white/15">
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (variant === 'games') onSaveGames(pickedWorks);
              else if (variant === 'books') onSaveBooks(pickedWorks);
              else onSaveMusic(pickedMusic);
              onClose();
            }}
            className="rounded-full px-5 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'حفظ' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ar ? 'ابحث في القائمة...' : 'Filter catalog...'}
            className="w-full rounded-xl bg-black/35 py-2 pe-3 ps-9 text-xs outline-none ring-1 ring-white/10 focus:ring-[var(--pf-accent)]"
          />
        </div>

        {/* Selected Chips */}
        {count > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {variant === 'music'
              ? pickedMusic.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--pf-accent)]/15 px-2.5 py-1 text-xs text-[var(--pf-accent)]">
                  <span>{m.name}</span>
                  <button type="button" onClick={() => setPickedMusic(pickedMusic.filter((x) => x.id !== m.id))}><X size={12} /></button>
                </span>
              ))
              : pickedWorks.map((w) => (
                <span key={w.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--pf-accent)]/15 px-2.5 py-1 text-xs text-[var(--pf-accent)]">
                  <span>{w.title}</span>
                  <button type="button" onClick={() => setPickedWorks(pickedWorks.filter((x) => x.id !== w.id))}><X size={12} /></button>
                </span>
              ))}
          </div>
        ) : null}

        {/* Catalog Grid */}
        {variant === 'music' ? (
          <div className="grid grid-cols-2 gap-2.5">
            {musicPool.map((m) => {
              const sel = pickedMusic.some((x) => x.id === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (sel) setPickedMusic(pickedMusic.filter((x) => x.id !== m.id));
                    else if (pickedMusic.length < maxItems) setPickedMusic([...pickedMusic, m]);
                  }}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-start transition ${sel ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <img src={m.avatar || ''} alt="" className="size-10 rounded-full object-cover bg-black/40" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{m.name}</div>
                    {m.genre ? <div className="truncate text-[10px] text-white/50">{m.genre}</div> : null}
                  </div>
                  {sel ? <Check size={14} className="text-[var(--pf-accent)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {workPool.map((w) => {
              const sel = pickedWorks.some((x) => x.id === w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    if (sel) setPickedWorks(pickedWorks.filter((x) => x.id !== w.id));
                    else if (pickedWorks.length < maxItems) setPickedWorks([...pickedWorks, w]);
                  }}
                  className={`group rounded-xl border p-1.5 text-start transition ${sel ? 'border-[var(--pf-accent)] bg-[var(--pf-accent)]/12' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-black/40">
                    <img src={w.cover} alt="" className="h-full w-full object-cover" />
                    {sel ? (
                      <span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[var(--pf-accent)] text-[#12100E]">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    ) : null}
                  </div>
                  <div dir="auto" className="mt-1.5 truncate text-[11px] font-medium">{w.title}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom Entry */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="mb-2 text-xs font-semibold">{ar ? 'إضافة عنصر مخصّص' : 'Add custom item'}</div>
          <div className="flex flex-wrap gap-2">
            <input
              dir="auto"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={variant === 'music' ? (ar ? 'اسم الفنان...' : 'Artist name...') : (ar ? 'العنوان...' : 'Title...')}
              className="min-w-[140px] flex-1 rounded-lg bg-black/35 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10"
            />
            <input
              dir="auto"
              value={customSub}
              onChange={(e) => setCustomSub(e.target.value)}
              placeholder={ar ? 'التصنيف (اختياري)' : 'Genre / note (optional)'}
              className="min-w-[120px] flex-1 rounded-lg bg-black/35 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10"
            />
            <button
              type="button"
              disabled={!customTitle.trim() || count >= maxItems}
              onClick={addCustom}
              className="inline-flex items-center gap-1 rounded-lg bg-white/12 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
            >
              <Plus size={13} />{ar ? 'إضافة' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
