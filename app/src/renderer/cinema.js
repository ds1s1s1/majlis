// Cinema mode: browse Stremio-compatible catalogs, open a title, pick (or auto-pick) a stream and
// play it in the theater. Rows load as they scroll into view; everything here is plain DOM.
export function initCinema(d) {
  const { api, t, icon, esc, toast, $, $$ } = d;
  const C = { page: 'home', rows: null, data: new Map(), detail: null, q: '', results: null, addons: null, hero: null };

  const img = (u, cls = '') => (u ? `<img class="${cls}" src="${esc(u)}" loading="lazy" alt="" referrerpolicy="no-referrer">` : `<div class="${cls} noimg">${icon('film', 28)}</div>`);
  const card = (m) => `<button class="pcard" data-type="${esc(m.type)}" data-id="${esc(m.id)}" title="${esc(m.name)}">${img(m.poster, 'pimg')}<span class="pname">${esc(m.name)}</span></button>`;
  const fmtMin = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

  function bar() {
    return `<div class="cbar">
      ${C.page !== 'home' ? `<button class="btn ghost" id="cback">${icon('back', 18)}<span>${t('cin_back')}</span></button>` : `<h2>${t('cin_title')}</h2>`}
      <div class="grow"></div>
      <label class="csearch">${icon('search', 16)}<input id="cq" class="input" placeholder="${t('cin_search')}" value="${esc(C.q)}"></label>
      <button class="btn ghost" id="caddons">${icon('set', 18)}<span>${t('cin_addons')}</span></button>
    </div>`;
  }

  function viewHome() {
    const prog = Object.entries(C.progress || {}).sort((a, b) => b[1].at - a[1].at).filter(([, p]) => p.meta);
    const h = C.hero;
    return `${bar()}
      <section class="hero ${h ? '' : 'empty'}" ${h ? `data-type="${esc(h.type)}" data-id="${esc(h.id)}"` : ''}>
        ${h ? `${h.background || h.poster ? `<img class="hero-bg" src="${esc(h.background || h.poster)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="hero-shade"></div>
        <div class="hero-body">
          ${h.logo ? `<img class="hero-logo" src="${esc(h.logo)}" alt="${esc(h.name)}" referrerpolicy="no-referrer">` : `<h1>${esc(h.name)}</h1>`}
          <div class="hero-meta">${[h.releaseInfo, h.imdbRating && `IMDb ${h.imdbRating}`, ...(h.genres || h.genre || []).slice(0, 3)].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          <p dir="auto">${esc((h.description || '').slice(0, 260))}</p>
          <div class="row gap"><button class="btn acc" id="heroplay">${icon('play', 18)}<span>${t('cin_play')}</span></button><button class="btn" id="heroinfo">${icon('info', 18)}<span>${t('cin_more')}</span></button></div>
        </div>` : `<div class="hero-body"><h1>${t('cin_title')}</h1><p>${t('cin_loading')}</p></div>`}
      </section>
      ${prog.length ? `<section class="crow"><h3>${t('cin_continue')}</h3><div class="ctrack">${prog.map(([id, p]) => `<button class="pcard cont" data-type="${esc(p.meta.type)}" data-id="${esc(p.meta.metaId || id)}">${img(p.meta.poster, 'pimg')}<span class="pname">${esc(p.meta.name)}</span><i class="pbar" style="width:${Math.min(100, Math.round((p.t / (p.d || 1)) * 100))}%"></i></button>`).join('')}</div></section>` : ''}
      ${(C.rows || []).map((r, i) => `<section class="crow" data-row="${i}"><h3>${esc(r.name)} <small>${esc(r.addonName)} · ${t(r.type === 'series' ? 'cin_series' : 'cin_movies')}</small></h3><div class="ctrack">${C.data.has(i) ? C.data.get(i).map(card).join('') : '<div class="cskel"></div>'.repeat(8)}</div></section>`).join('')}
      ${C.rows && !C.rows.length ? `<p class="sub">${t('cin_no_rows')}</p>` : ''}`;
  }

  function viewSearch() {
    return `${bar()}${C.results == null ? `<p class="sub">${t('cin_loading')}</p>` : C.results.filter((r) => r.metas.length).map((r) => `<section class="crow"><h3>${esc(r.name)} <small>${t(r.type === 'series' ? 'cin_series' : 'cin_movies')}</small></h3><div class="cgrid">${r.metas.map(card).join('')}</div></section>`).join('') || `<p class="sub">${t('cin_nothing')}</p>`}`;
  }

  function badges(s) {
    const m = s.majlis || {};
    return [m.height && `${m.height === 2160 ? '4K' : m.height + 'p'}`, m.hdr && 'HDR', m.direct ? t('cin_instant') : m.seeders ? `👤 ${m.seeders}` : null, m.sizeGb ? `${m.sizeGb.toFixed(1)} GB` : null].filter(Boolean).map((b) => `<span class="badge2">${esc(b)}</span>`).join('');
  }

  function viewDetail() {
    const D = C.detail, m = D.meta;
    if (!m) return `${bar()}<p class="sub">${t('cin_loading')}</p>`;
    const seasons = [...new Set((m.videos || []).map((v) => v.season).filter((s) => s != null))].sort((a, b) => (a || 99) - (b || 99));
    const eps = (m.videos || []).filter((v) => v.season === D.season).sort((a, b) => (a.episode || a.number || 0) - (b.episode || b.number || 0));
    return `${bar()}
      <section class="dhead">
        ${m.background ? `<img class="hero-bg" src="${esc(m.background)}" alt="" referrerpolicy="no-referrer">` : ''}<div class="hero-shade"></div>
        <div class="dbody">
          ${img(m.poster, 'dposter')}
          <div class="dtext">
            ${m.logo ? `<img class="hero-logo" src="${esc(m.logo)}" alt="${esc(m.name)}" referrerpolicy="no-referrer">` : `<h1>${esc(m.name)}</h1>`}
            <div class="hero-meta">${[m.releaseInfo || m.year, m.runtime, m.imdbRating && `IMDb ${m.imdbRating}`, ...(m.genres || m.genre || []).slice(0, 4)].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
            <p dir="auto">${esc(m.description || '')}</p>
            ${(m.cast || []).length ? `<p class="sub">${t('cin_cast')}: ${esc(m.cast.slice(0, 8).join('، '))}</p>` : ''}
            ${D.streams?.length ? `<button class="btn acc" id="playbest">${icon('play', 18)}<span>${t('cin_play_best')}</span></button>` : ''}
          </div>
        </div>
      </section>
      ${seasons.length ? `<section class="crow"><div class="seg">${seasons.map((s) => `<button data-season="${s}" class="${s === D.season ? 'on' : ''}">${s === 0 ? t('cin_specials') : `${t('cin_season')} ${s}`}</button>`).join('')}</div>
        <div class="eplist">${eps.map((v) => `<button class="ep ${v.id === D.video ? 'on' : ''}" data-vid="${esc(v.id)}">${img(v.thumbnail, 'epimg')}<span><b>${v.episode ?? v.number ?? ''}. ${esc(v.name || v.title || '')}</b><small>${esc((v.overview || v.description || '').slice(0, 140))}</small></span></button>`).join('')}</div></section>` : ''}
      <section class="crow"><h3>${t('cin_streams')}</h3>
        ${D.streams == null ? (D.video || m.type !== 'series' ? `<p class="sub">${t('cin_finding')}</p>` : `<p class="sub">${t('cin_pick_ep')}</p>`)
          : D.streams.length ? `<div class="slist">${D.streams.slice(0, 40).map((s, i) => `<button class="srow" data-s="${i}"><span class="sname">${esc((s.name || '').replace(/\n/g, ' '))}</span><span class="stitle">${esc((s.title || s.description || '').split('\n')[0])}</span><span class="sbadges">${badges(s)}</span><span class="saddon">${esc(s.addon?.name || '')}</span>${icon('play', 16)}</button>`).join('')}</div>`
          : `<p class="sub">${t('cin_no_streams')}</p>`}
      </section>`;
  }

  function viewAddons() {
    return `${bar()}<section class="crow"><h3>${t('cin_addons')}</h3><p class="sub">${t('cin_addons_sub')}</p>
      <div class="row gap"><input id="aurl" class="input grow" placeholder="https://…/manifest.json" dir="ltr"><button class="btn acc" id="aadd">${icon('plus', 16)}<span>${t('cin_add')}</span></button></div>
      <div class="alist">${(C.addons || []).map((a, i) => `<div class="arow" data-url="${esc(a.url)}">${a.logo ? `<img src="${esc(a.logo)}" alt="" referrerpolicy="no-referrer">` : icon('lib', 22)}
        <span class="grow"><b>${esc(a.name || a.url)}</b> <small>${esc(a.version || '')}</small><small class="block">${esc(a.error || a.description || '')}</small><small class="block">${esc((a.resources || []).map((r) => r.name || r).join(' · '))}</small></span>
        <button class="btn ghost" data-move="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost" data-move="1" ${i === C.addons.length - 1 ? 'disabled' : ''}>↓</button><button class="btn ghost" data-rm>${icon('x', 16)}</button></div>`).join('')}</div></section>`;
  }

  function view() { return `<div class="cinema">${{ home: viewHome, search: viewSearch, detail: viewDetail, addons: viewAddons }[C.page]()}</div>`; }
  function redraw() { const v = $('#view'); if (!v || !v.querySelector('.cinema')) return; const y = v.scrollTop; v.innerHTML = view(); mount(); if (C.page === 'home') v.scrollTop = y; }

  async function open(type, id) {
    C.page = 'detail'; C.detail = { type, id, meta: null, streams: null, season: null, video: null };
    redraw(); $('#view').scrollTop = 0;
    try {
      const r = await api.invoke('media:meta', { type, id });
      if (C.detail?.id !== id) return;
      C.detail.meta = r.meta;
      const vids = r.meta.videos || [];
      if (type === 'series' && vids.length) {
        // pick up where you were: the last episode with progress, else the first of the first season
        const prog = C.progress || {};
        const last = vids.filter((v) => prog[v.id]).sort((a, b) => prog[b.id].at - prog[a.id].at)[0];
        const real = vids.map((v) => v.season).filter((s) => s > 0);
        C.detail.season = last?.season ?? (real.length ? Math.min(...real) : vids[0].season);
        if (last) streams(last.id);
      } else streams(id);
    } catch (e) { toast(t('cin_err', { e: e.message })); }
    redraw();
  }

  async function streams(vid) {
    const D = C.detail; D.video = vid; D.streams = null; redraw();
    try { const r = await api.invoke('media:streams', { type: D.type, id: vid }); if (C.detail === D && D.video === vid) D.streams = r.streams || []; }
    catch (e) { D.streams = []; toast(t('cin_err', { e: e.message })); }
    redraw();
  }

  async function play(s) {
    const D = C.detail, m = D.meta;
    const ep = (m.videos || []).find((v) => v.id === D.video);
    const name = ep ? `${m.name} · S${ep.season}E${ep.episode ?? ep.number}` : m.name;
    try { await api.invoke('media:play', { type: D.type, id: D.video, card: { name, poster: m.poster, type: D.type, metaId: m.id }, stream: s }); }
    catch (e) { toast(t('cin_err', { e: e.message })); }
  }

  async function loadRow(i) {
    if (C.data.has(i) || C.loading?.has(i)) return;
    (C.loading ||= new Set()).add(i);
    const r = C.rows[i];
    try {
      const res = await api.invoke('media:catalog', { addon: r.addon, type: r.type, id: r.id });
      C.data.set(i, (res.metas || []).slice(0, 40).map((m) => ({ ...m, type: m.type || r.type })));
      if (!C.hero && C.data.get(i).length) { C.hero = C.data.get(i).find((m) => m.background) || C.data.get(i)[0]; if (C.page === 'home') redraw(); }
    } catch { C.data.set(i, []); }
    const sec = $(`.crow[data-row="${i}"] .ctrack`);
    if (sec) { sec.innerHTML = C.data.get(i).map(card).join('') || `<p class="sub">${t('cin_nothing')}</p>`; wireCards(sec); }
  }

  function wireCards(root) { $$('.pcard', root).forEach((b) => (b.onclick = () => open(b.dataset.type, b.dataset.id))); }

  function mount() {
    const v = $('#view');
    $('#cback') && ($('#cback').onclick = () => { C.page = 'home'; redraw(); });
    $('#caddons').onclick = async () => { C.page = 'addons'; redraw(); C.addons = await api.invoke('media:addons'); redraw(); };
    const q = $('#cq');
    q.onkeydown = async (e) => {
      if (e.key !== 'Enter' || !q.value.trim()) return;
      C.q = q.value.trim(); C.page = 'search'; C.results = null; redraw();
      C.results = await api.invoke('media:search', { q: C.q }).catch(() => []); redraw();
    };
    wireCards(v);
    if (C.page === 'home') {
      const h = $('.hero[data-id]');
      if (h) { $('#heroplay').onclick = () => open(h.dataset.type, h.dataset.id); $('#heroinfo').onclick = () => open(h.dataset.type, h.dataset.id); }
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); loadRow(+e.target.dataset.row); } }, { root: v, rootMargin: '400px' });
      $$('.crow[data-row]').forEach((s) => { if (!C.data.has(+s.dataset.row)) io.observe(s); });
    }
    if (C.page === 'detail') {
      $$('[data-season]').forEach((b) => (b.onclick = () => { C.detail.season = +b.dataset.season; redraw(); }));
      $$('[data-vid]').forEach((b) => (b.onclick = () => streams(b.dataset.vid)));
      $$('[data-s]').forEach((b) => (b.onclick = () => play(C.detail.streams[+b.dataset.s])));
      $('#playbest') && ($('#playbest').onclick = () => play(C.detail.streams[0]));
    }
    if (C.page === 'addons') {
      $('#aadd').onclick = async () => {
        const u = $('#aurl').value.trim(); if (!u) return;
        try { await api.invoke('media:addon-add', u); C.addons = await api.invoke('media:addons'); C.rows = null; C.data.clear(); C.hero = null; redraw(); }
        catch (e) { toast(t('cin_bad_addon', { e: e.message })); }
      };
      $$('.arow').forEach((r) => {
        r.querySelector('[data-rm]').onclick = async () => { await api.invoke('media:addon-remove', r.dataset.url); C.addons = await api.invoke('media:addons'); C.rows = null; C.data.clear(); C.hero = null; redraw(); };
        r.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => { await api.invoke('media:addon-move', { url: r.dataset.url, dir: +b.dataset.move }); C.addons = await api.invoke('media:addons'); C.rows = null; C.data.clear(); redraw(); }));
      });
    }
  }

  async function enter() {
    C.progress = await api.invoke('media:progress').catch(() => ({}));
    if (!C.rows) { C.rows = await api.invoke('media:rows').catch(() => []); redraw(); }
  }

  return { viewCinema: view, mountCinema: () => { mount(); enter(); }, cinemaState: C, openTitle: open };
}
