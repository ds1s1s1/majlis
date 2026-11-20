import { useMemo, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { useHost } from '../../../host';
import { fmtLocaleDateTime } from '../../../i18n';
import type { ProfileComment, ProfileRating } from '../../../data/profileMockSeed';
import { renderSafeMarkdown } from '../../../utils/renderMarkdown';
import { ProfileCardShell } from './ProfileCardShell';

export function CommentsCard({
  comments,
  ratings,
  myId,
  isOwner = false,
  hideTitle,
  transparent,
  onPost,
  onDelete,
}: {
  comments: ProfileComment[];
  ratings: ProfileRating[];
  myId: string;
  isOwner?: boolean;
  hideTitle?: boolean;
  transparent?: boolean;
  onPost: (body: string) => void;
  onDelete: (id: string) => void;
}) {
  const { lang } = useHost();
  const ar = lang === 'ar';
  const [text, setText] = useState('');

  // @ rating-quote autocomplete detection
  const atQuery = useMemo(() => {
    const m = /(?:^|\s)@([^\s"@]{0,40})$/.exec(text);
    return m ? m[1].toLowerCase() : null;
  }, [text]);

  const quoteSuggestions = useMemo(() => {
    if (atQuery === null) return [];
    return ratings.filter((r) => r.title.toLowerCase().includes(atQuery)).slice(0, 5);
  }, [atQuery, ratings]);

  const insertQuote = (r: ProfileRating) => {
    const chip = `@"${r.title} ★${r.score}" `;
    setText((prev) => prev.replace(/@([^\s"@]{0,40})$/, chip));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onPost(text);
    setText('');
  };

  return (
    <ProfileCardShell icon={<MessageSquare size={14} />} title={ar ? 'التعليقات' : 'COMMENTS'} hideTitle={hideTitle} transparent={transparent}>
      <form onSubmit={submit} className="relative mb-4">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={800}
          placeholder={ar ? 'اترك تعليقاً... اكتب @ لاقتباس تقييم.' : 'Leave a comment... Type @ to quote a rating.'}
          className="w-full resize-none rounded-xl border border-[var(--pf-card-border)] bg-black/25 p-3 text-sm text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-accent)]"
        />
        {quoteSuggestions.length > 0 ? (
          <div className="mt-1 rounded-xl border border-[var(--pf-card-border)] bg-[#1B1814] p-1 shadow-xl">
            {quoteSuggestions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => insertQuote(r)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-start text-xs hover:bg-white/10"
              >
                <span className="truncate font-medium text-[var(--pf-text)]">{r.title}</span>
                <span className="font-mono text-[var(--pf-accent)]">★ {r.score}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-[var(--pf-text-muted)]">
            {ar ? 'يدعم ||الحرق|| واقتباس @' : 'Supports ||spoiler|| & @quote'}
          </span>
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-full px-4 py-1.5 text-xs font-semibold transition hover:brightness-110 disabled:opacity-40"
            style={{ background: 'var(--pf-accent)', color: 'var(--pf-accent-fg)' }}
          >
            {ar ? 'نشر' : 'Post'}
          </button>
        </div>
      </form>

      {comments.length ? (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3 rounded-xl bg-black/20 p-3 ring-1 ring-white/5">
              <div
                className="grid size-8 flex-none place-items-center overflow-hidden rounded-full text-xs font-bold"
                style={{ background: c.authorAvatar?.startsWith('data:') ? undefined : c.authorAccent, color: '#12100E' }}
              >
                {c.authorAvatar?.startsWith('data:') ? <img src={c.authorAvatar} alt="" className="h-full w-full object-cover" /> : c.authorName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold" style={{ color: c.authorAccent }}>{c.authorName}</span>
                  <span className="text-[11px] text-[var(--pf-text-muted)]">{fmtLocaleDateTime(c.at, lang)}</span>
                  {(c.authorId === myId || isOwner) ? (
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      aria-label={ar ? 'حذف' : 'Delete'}
                      className="ms-auto text-[var(--pf-text-muted)] hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
                <div dir="auto" className="mt-1 space-y-1 text-[13px] text-[var(--pf-text)]/90">
                  {renderSafeMarkdown(c.body)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-[var(--pf-text-muted)]">
          {ar ? 'لا توجد تعليقات بعد. كن أول من يسلّم.' : 'No comments yet. Be the first to say hello.'}
        </p>
      )}
    </ProfileCardShell>
  );
}
