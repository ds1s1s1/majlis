// Command palette (Ctrl+K): every page and common action in one box, found by typing a few
// letters in either language. Arrow keys move, Enter runs, Esc closes.
export function initPalette({ t, icon, esc, commands }) {
  let el = null, sel = 0, list = [];

  // loose match: the letters of the query in order (so "stng" finds "settings")
  const score = (q, s) => {
    s = s.toLowerCase(); q = q.toLowerCase().trim();
    if (!q) return 1;
    if (s.includes(q)) return 100 - s.indexOf(q);
    let i = 0; for (const c of s) if (c === q[i]) i++;
    return i === q.length ? 10 : 0;
  };

  function draw() {
    const q = el.querySelector('input').value;
    list = commands().filter((c) => c.when !== false).map((c) => ({ c, s: Math.max(score(q, c.label), score(q, c.alt || '')) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
    // a query that isn't a command can still be a search in cinema
    if (q.trim()) list.push({ id: 'cinema-search', label: t('pal_search_cinema', { q: q.trim() }), icon: 'search', run: () => commands().find((c) => c.id === 'cinema-search-run')?.run(q.trim()) });
    sel = Math.min(sel, Math.max(0, list.length - 1));
    el.querySelector('.pal-list').innerHTML = list.map((c, i) => `<button class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}">${icon(c.icon || 'more', 18)}<span>${esc(c.label)}</span>${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ''}</button>`).join('') || `<div class="sub pal-empty">${t('pal_none')}</div>`;
    el.querySelectorAll('.pal-item').forEach((b) => (b.onclick = () => run(+b.dataset.i)));
  }

  function run(i) { const c = list[i]; close(); c?.run(); }
  function close() { el?.remove(); el = null; }

  function open() {
    if (el) return close();
    el = document.createElement('div');
    el.className = 'pal-layer';
    el.innerHTML = `<div class="palette" role="dialog" aria-label="${esc(t('pal_title'))}"><label class="pal-q">${icon('search', 18)}<input placeholder="${esc(t('pal_hint'))}" aria-label="${esc(t('pal_hint'))}"></label><div class="pal-list" role="listbox"></div></div>`;
    document.body.append(el);
    const inp = el.querySelector('input');
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { run(sel); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    };
    el.onclick = (e) => { if (e.target === el) close(); };
    draw(); inp.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
      if (document.body.classList.contains('cin-on')) {
        close();
        return;
      }
      e.preventDefault();
      open();
    }
  });
  return { open, close };
}
