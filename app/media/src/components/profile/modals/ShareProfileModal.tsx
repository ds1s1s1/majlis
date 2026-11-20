import { useMemo, useState } from 'react';
import { Check, Code2, Copy, Grid2x2, Link2 } from 'lucide-react';
import { useSocialMe } from '../../../api';
import { APP_BRAND, friendLinkFor } from '../../../config/appBrand';
import type { UserProfileState } from '../../../data/profileMockSeed';
import { useHost } from '../../../host';
import { QrCode } from '../../../ui/QrCode';
import { ModalFrame } from './ModalFrame';

export function ShareProfileModal({
  open,
  profile,
  onOpenCollage,
  onClose,
}: {
  open: boolean;
  profile: UserProfileState;
  onOpenCollage?: () => void;
  onClose: () => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const meQ = useSocialMe();
  const [tab, setTab] = useState<'link' | 'card'>('link');
  const [copied, setCopied] = useState<'url' | 'code' | 'signed' | null>(null);
  const [embedStyle, setEmbedStyle] = useState<'full' | 'compact'>('full');
  const [embedTheme, setEmbedTheme] = useState<'majlis' | 'slate' | 'midnight'>('majlis');
  const [codeTab, setCodeTab] = useState<'discord' | 'markdown'>('discord');

  const isOwnProfile = !meQ.data?.id || profile.id === meQ.data.id || profile.id === 'default';
  const url = useMemo(
    () => friendLinkFor(profile.general.customUrl || profile.general.handle || profile.id),
    [profile.general.customUrl, profile.general.handle, profile.id],
  );
  const signedCode = isOwnProfile ? (meQ.data?.signedFriendCode || url) : url;

  const copyText = async (txt: string, kind: 'url' | 'code' | 'signed') => {
    try { await navigator.clipboard.writeText(txt); } catch {}
    setCopied(kind);
    setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 1800);
  };

  const titleText = `${profile.general.alias} (${APP_BRAND.nameEn})`;

  const embedCode = useMemo(() => {
    const bio = profile.general.about ? `\n> ${profile.general.about.slice(0, 120)}` : '';
    const statsLine = embedStyle === 'full'
      ? `\nMovies: ${profile.stats.moviesCount} · Episodes: ${profile.stats.episodesCount} · Ratings: ${profile.ratings.length}`
      : '';
    if (codeTab === 'markdown') return `**${titleText}** (\`@${profile.general.handle}\`)${bio}${statsLine}\n${url}`;
    return `🎬 ${titleText} (@${profile.general.handle})${statsLine}\n${url}`;
  }, [url, embedStyle, codeTab, titleText, profile]);

  const previewColors = {
    majlis: { bg: '#181613', border: 'rgba(229,169,60,0.35)', acc: '#E5A93C', fg: '#F2EFE9' },
    slate: { bg: '#18191D', border: 'rgba(161,161,170,0.3)', acc: '#A1A1AA', fg: '#F4F4F5' },
    midnight: { bg: '#0F172A', border: 'rgba(59,130,246,0.35)', acc: '#3B82F6', fg: '#F1F5F9' },
  }[embedTheme];

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      title={ar ? 'مشاركة الملف الشخصي' : 'Share profile'}
      subtitle={ar ? 'شارك رابط ملفك أو انسخ كود التضمين' : 'Share your profile URL or grab an embed card'}
    >
      {/* Profile header strip */}
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
        <div
          className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold"
          style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
        >
          {profile.general.avatar ? <img src={profile.general.avatar} alt="" className="h-full w-full object-cover" /> : (profile.general.alias[0] || 'M').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div dir="auto" className="truncate text-sm font-bold">{profile.general.alias}</div>
          <div dir="ltr" className="truncate font-mono text-xs text-white/55">@{profile.general.handle}</div>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="mb-4 flex gap-2 rounded-xl bg-black/30 p-1 ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => setTab('link')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${tab === 'link' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}
        >
          <Link2 size={13} />{ar ? 'رابط الصداقة (P2P)' : 'Friend Link (P2P)'}
        </button>
        <button
          type="button"
          onClick={() => setTab('card')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${tab === 'card' ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}
        >
          <Code2 size={13} />{ar ? 'بطاقة المشاركة' : 'Profile Card'}
        </button>
      </div>

      {tab === 'link' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex shrink-0 flex-col items-center gap-1.5 rounded-xl bg-black/40 p-2.5 ring-1 ring-white/10">
              <QrCode value={signedCode} size={136} />
              <span className="text-[10px] font-medium text-white/55">{ar ? 'امسح لإضافة P2P' : 'Scan to add via P2P'}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              {isOwnProfile && meQ.data?.signedFriendCode ? (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/50">
                    {ar ? 'رمز الصداقة الموقّع (يعمل بدون سيرفر)' : 'Signed P2P Friend Code (Offline-Verified)'}
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-black/35 p-2 ring-1 ring-white/10">
                    <input dir="ltr" readOnly value={signedCode} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[11px] text-white/85 outline-none" />
                    <button
                      type="button"
                      onClick={() => copyText(signedCode, 'signed')}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                      style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
                    >
                      {copied === 'signed' ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copied === 'signed' ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</span>
                    </button>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/50">
                  {ar ? 'معرّف مجلس السريع' : 'Quick P2P Link'}
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-black/35 p-2 ring-1 ring-white/10">
                  <input dir="ltr" readOnly value={url} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-white/75 outline-none" />
                  <button
                    type="button"
                    onClick={() => copyText(url, 'url')}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20"
                  >
                    {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copied === 'url' ? (ar ? 'نُسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <p className="min-w-0 flex-1 text-xs text-white/55">
              {ar ? 'موقّع بمفتاح Ed25519 للتحقق المباشر بين الأصدقاء.' : 'Ed25519-signed for zero-server P2P friend verification.'}
            </p>
            {onOpenCollage ? (
              <button
                type="button"
                onClick={onOpenCollage}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                <Grid2x2 size={13} className="text-[var(--pf-accent)]" />
                <span>{ar ? 'ملصق المفضلة (Top 4 / 9 PNG)' : 'Poster Collage (2×2 / 3×3 PNG)'}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                {ar ? 'شكل البطاقة' : 'Card Style'}
              </div>
              <div className="flex gap-1.5">
                {(['full', 'compact'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEmbedStyle(s)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium capitalize ring-1 ${embedStyle === s ? 'bg-[var(--pf-accent)]/20 text-[var(--pf-accent)] ring-[var(--pf-accent)]' : 'bg-white/5 text-white/65 ring-white/10'}`}
                  >
                    {s === 'full' ? (ar ? 'كامل' : 'Full') : (ar ? 'مضغوط' : 'Compact')}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                {ar ? 'ثيم المعاينة' : 'Theme'}
              </div>
              <div className="flex gap-1.5">
                {(['majlis', 'slate', 'midnight'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEmbedTheme(t)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium capitalize ring-1 ${embedTheme === t ? 'bg-[var(--pf-accent)]/20 text-[var(--pf-accent)] ring-[var(--pf-accent)]' : 'bg-white/5 text-white/65 ring-white/10'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Embed Preview */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
              {ar ? 'معاينة حية' : 'LIVE PREVIEW'}
            </div>
            <div
              className="rounded-xl p-3.5"
              style={{ background: previewColors.bg, border: `1px solid ${previewColors.border}`, color: previewColors.fg }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-full text-xs font-bold" style={{ background: previewColors.acc, color: '#12100E' }}>
                    {(profile.general.alias[0] || 'M').toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{profile.general.alias}</div>
                    <div dir="ltr" className="font-mono text-[11px] opacity-65">@{profile.general.handle} · {APP_BRAND.nameEn}</div>
                  </div>
                </div>
                <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: `${previewColors.acc}26`, color: previewColors.acc }}>
                  {profile.stats.moviesCount} {ar ? 'فيلم' : 'films'}
                </span>
              </div>
              {embedStyle === 'full' ? (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5 text-center font-mono text-xs">
                  <div><div className="font-bold">{profile.stats.episodesCount}</div><div className="text-[10px] opacity-55">{ar ? 'حلقة' : 'Episodes'}</div></div>
                  <div><div className="font-bold">{profile.ratings.length}</div><div className="text-[10px] opacity-55">{ar ? 'تقييم' : 'Ratings'}</div></div>
                  <div><div className="font-bold">{profile.lists.length}</div><div className="text-[10px] opacity-55">{ar ? 'قائمة' : 'Lists'}</div></div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Copyable Code */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex gap-1.5">
                {(['discord', 'markdown'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCodeTab(c)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase ${codeTab === c ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => copyText(embedCode, 'code')}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/20"
              >
                {copied === 'code' ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied === 'code' ? (ar ? 'نُسخ' : 'Copied') : (ar ? 'نسخ الكود' : 'Copy snippet')}</span>
              </button>
            </div>
            <pre dir="ltr" className="overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] text-white/80 ring-1 ring-white/10">
              {embedCode}
            </pre>
          </div>
        </div>
      )}
    </ModalFrame>
  );
}
