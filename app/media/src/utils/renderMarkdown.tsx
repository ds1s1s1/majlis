import { Fragment, useState, type ReactNode } from 'react';
import { invoke } from '../api';

function SpoilerSpan({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShown((s) => !s)}
      title={shown ? 'Hide spoiler' : 'Reveal spoiler'}
      className={`inline rounded px-1.5 py-0.5 text-[0.92em] transition ${
        shown
          ? 'bg-white/10 text-[var(--pf-text)]'
          : 'bg-white/15 text-transparent blur-[3px] select-none hover:bg-white/25'
      }`}
    >
      {text}
    </button>
  );
}

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  // Match spoilers ||text||, markdown links [label](url), bold **text**, strike ~~text~~, italic *text*, quote @"Title"
  const tokenRe = /(\|\|[^|]+?\|\||\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+?\*\*|~~[^~]+?~~|\*[^*\s][^*]*?\*|@"[^"]{1,100}")/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const m of line.matchAll(tokenRe)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(line.slice(last, start));
    const raw = m[0];
    const k = `${keyPrefix}-${idx++}`;
    if (raw.startsWith('||') && raw.endsWith('||')) {
      parts.push(<SpoilerSpan key={k} text={raw.slice(2, -2)} />);
    } else if (raw.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(raw);
      if (lm) {
        parts.push(
          <button
            key={k}
            type="button"
            onClick={() => invoke('open', lm[2]).catch(() => {})}
            className="text-[var(--pf-accent)] underline decoration-[var(--pf-accent)]/40 underline-offset-2 hover:decoration-[var(--pf-accent)]"
          >
            {lm[1]}
          </button>,
        );
      } else {
        parts.push(raw);
      }
    } else if (raw.startsWith('**')) {
      parts.push(<strong key={k} className="font-semibold text-[var(--pf-text)]">{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith('~~')) {
      parts.push(<del key={k} className="opacity-65">{raw.slice(2, -2)}</del>);
    } else if (raw.startsWith('*')) {
      parts.push(<em key={k} className="italic">{raw.slice(1, -1)}</em>);
    } else if (raw.startsWith('@"')) {
      const inner = raw.slice(2, -1);
      parts.push(
        <span key={k} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-[var(--pf-accent)]/15 px-1.5 py-0.5 font-medium text-[var(--pf-accent)] ring-1 ring-[var(--pf-accent)]/30">
          {inner}
        </span>,
      );
    }
    last = start + raw.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function renderSafeMarkdown(raw: string): ReactNode {
  const text = String(raw || '').trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = (keyBase: number) => {
    if (!listBuf.length) return;
    blocks.push(
      <ul key={`ul-${keyBase}`} className="my-1.5 list-disc space-y-1 ps-5">
        {listBuf.map((li, j) => <li key={j}>{renderInline(li, `li-${keyBase}-${j}`)}</li>)}
      </ul>,
    );
    listBuf = [];
  };

  lines.forEach((line, i) => {
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      listBuf.push(bullet[1]);
      return;
    }
    flushList(i);
    if (line.trimStart().startsWith('> ')) {
      blocks.push(
        <blockquote key={`bq-${i}`} className="my-1.5 border-s-2 border-[var(--pf-accent)] ps-3 italic opacity-85">
          {renderInline(line.replace(/^\s*>\s?/, ''), `bq-${i}`)}
        </blockquote>,
      );
    } else if (!line.trim()) {
      blocks.push(<div key={`sp-${i}`} className="h-2" />);
    } else {
      blocks.push(<p key={`p-${i}`} className="leading-relaxed">{renderInline(line, `p-${i}`)}</p>);
    }
  });
  flushList(lines.length);
  return <Fragment>{blocks}</Fragment>;
}
