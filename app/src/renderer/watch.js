// Watch party UI: the room page in watch mode, the bar under the film, chat, reactions,
// the ready check and the countdown. Shared helpers come in from app.js.
export const REACTIONS = ['😂', '🔥', '😮', '👏', '💀', '❤️'];

export function initWatch(d) {
  const { S, api, t, icon, esc, toast, avatar, set, $, $$ } = d;

  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
  };
  // position now, interpolated between the host's updates
  const livePos = (mv) => (mv ? Math.min(mv.dur || 1e9, mv.pos + (mv.playing ? (performance.now() - (mv.rx || performance.now())) / 1000 : 0)) : 0);
  const langName = (l) => ({ ara: 'العربية', ar: 'العربية', eng: 'English', en: 'English', fre: 'Français', fra: 'Français', spa: 'Español', jpn: '日本語', kor: '한국어', tur: 'Türkçe', hin: 'हिन्दी', und: '—' }[l] || l);

  // ------------------------------------------------------------------ room page (host, watch mode)
  function viewWatchRoom() {
    const h = S.host || {}, s = S.st.settings, mv = h.movie;
    const guests = h.guests || [];
    const notReady = guests.filter((g) => !g.ready).length;
    const tracks = mv?.tracks;
    return `<div class="page-head">
        <h1>${t('watch_title')}</h1>
        <span class="tag ${h.enabled ? 'ok' : ''}"><i class="dot ${h.enabled ? 'ok' : ''}"></i>${h.enabled ? t('hosting_on') : t('hosting_off')}</span>
        <span class="sp"></span>
        ${!h.enabled ? `<button class="btn primary" id="openroom">${t('hosting')}</button>` : ''}
        <button class="btn danger" id="panic">${icon('door', 16)}<span>${t('panic')}</span></button>
      </div>
      <div class="room">
        <div class="stack" style="gap:18px">
          ${mv ? `<section class="screen-card">
              <div class="sc-top"><div class="sc-title">${esc(mv.title)}</div></div>
              <div class="sc-time mono"><span id="wpos">${fmtTime(livePos(mv))}</span><span class="muted"> / ${fmtTime(mv.dur)}</span></div>
              <input type="range" class="seek" id="wseek" min="0" max="${Math.max(1, Math.floor(mv.dur))}" step="1" value="${Math.floor(livePos(mv))}">
              <div class="sc-ctl">
                <div class="transport" dir="ltr">
                  <button class="iconbtn lg" data-op="skip" data-v="-10" title="${t('back10')}">${icon('back', 22)}</button>
                  <button class="btn primary lg" data-op="toggle">${icon(mv.playing ? 'pause' : 'play', 18)}<span>${mv.playing ? t('pause') : t('play')}</span></button>
                  <button class="iconbtn lg" data-op="skip" data-v="10" title="${t('fwd10')}">${icon('fwd', 22)}</button>
                </div>
                <span class="sp"></span>
                <button class="btn sm" data-op="skip" data-v="85">${t('skip_intro')}</button>
                ${mv.next ? `<button class="btn sm" data-op="next" title="${esc(mv.next)}">${t('next_ep')}</button>` : ''}
                <button class="btn sm ghost" data-op="stop">${t('stop_movie')}</button>
              </div>
              <div class="sc-tracks">
                <div class="field"><label>${t('audio_track')}</label><select class="input" id="waudio">${(tracks?.audio || []).map((a) => `<option value="${a.i}" ${mv.audio === a.i ? 'selected' : ''}>${esc(langName(a.lang))}${a.title ? ` · ${esc(a.title)}` : ''}${a.ch ? ` · ${a.ch}ch` : ''}</option>`).join('')}</select></div>
                <div class="field"><label>${t('sub_track')}</label><select class="input" id="wsub"><option value="">${t('sub_off')}</option>${(tracks?.subs || []).map((x) => `<option value="${esc(x.key)}" ${mv.sub === x.key ? 'selected' : ''}>${esc(langName(x.lang))}${x.title ? ` · ${esc(x.title)}` : ''}</option>`).join('')}<option value="@file">${t('sub_file')}</option></select></div>
                <div class="prow" style="align-self:end;padding-bottom:6px"><div class="lbl"><div>${t('night_mode')}</div><div class="sub">${t('night_sub')}</div></div><button class="switch ${mv.night ? 'on' : ''}" id="wnight"></button></div>
              </div>
            </section>`
          : `<section class="screen-card empty-screen">
              <div class="es-art">${icon('film', 40)}</div>
              <h3>${t('watch_empty')}</h3>
              <div class="sub" style="max-width:460px">${t('watch_empty_sub')}</div>
              <div style="display:flex;gap:8px;margin-top:6px"><button class="btn primary lg" id="pickmovie">${icon('plus', 16)}<span>${t('pick_movie')}</span></button><button class="btn lg" id="pickscreen">${icon('monitor', 16)}<span>${t('or_screen')}</span></button></div>
              <div class="sub">${icon('shield', 13)} ${t('drm_note')}</div>
            </section>`}
          <section class="panel chatpanel"><div class="ph"><h3>${t('chat')}</h3></div><div class="pb" style="gap:8px">${chatList(true)}${chatInput('hchat')}</div></section>
        </div>
        <aside class="stack" style="gap:14px">
          <div class="panel"><div class="ph"><h3>${t('viewers')}</h3><span class="tag">${guests.length}</span></div><div class="pb" style="gap:8px">
            ${guests.length ? guests.map((g) => `<div class="vrow">${avatar(g.name, g.id)}<span class="nm">${esc(g.name)}</span>${g.ready ? `<span class="tag ok">${icon('check', 12)}${t('ready_yes')}</span>` : ''}<span class="ping mono">${g.rtt || '—'} ms</span></div>`).join('') : `<div class="empty" style="padding:4px 0">${t('room_empty')}</div>`}
            ${guests.length ? `<div style="display:flex;gap:6px;margin-top:4px"><button class="btn sm" id="readyq">${t('ready_check')}</button><button class="btn sm primary" id="readygo" ${mv ? '' : 'disabled'}>${t('ready_go')}</button></div>
              <div class="sub">${notReady ? t('ready_waiting', { n: notReady }) : t('all_ready')}</div>` : ''}
            ${mv ? `<button class="btn" id="watchnow" style="margin-top:6px">${icon('eye', 16)}<span>${t('watch_now')}</span></button>` : ''}
          </div></div>
          <div class="panel"><div class="pb">
            <div class="field"><label>${t('control_who')}</label><div class="seg" id="wctl"><button data-v="host" class="${s.watchControl !== 'all' ? 'on' : ''}">${t('control_host')}</button><button data-v="all" class="${s.watchControl === 'all' ? 'on' : ''}">${t('control_all')}</button></div></div>
            <div class="field"><label>${t('watch_quality')} <span class="mono" id="wqv">${s.watchMbps} Mbps</span></label><input type="range" min="4" max="40" step="1" value="${s.watchMbps}" id="wq"></div>
            <div class="prow"><div class="lbl">${t('allow_chat')}</div><button class="switch ${s.allowChat !== false ? 'on' : ''}" data-perm="allowChat"></button></div>
            <div class="prow"><div class="lbl">${t('allow_react')}</div><button class="switch ${s.allowReactions !== false ? 'on' : ''}" data-perm="allowReactions"></button></div>
            <div class="prow"><div class="lbl">${t('auto_next')}</div><button class="switch ${s.autoNext ? 'on' : ''}" data-k="autoNext"></button></div>
            <div class="prow"><div class="lbl">${t('auto_duck')}</div><button class="switch ${s.autoDuck !== false ? 'on' : ''}" data-k="autoDuck"></button></div>
            <div class="prow"><div class="lbl"><div>${t('cinema_buffer')}</div><div class="sub">${t('cinema_sub')}</div></div><span class="mono sub">${s.cinemaDelay} ms</span></div>
          </div></div>
        </aside>
      </div>`;
  }

  function mountWatchRoom() {
    const s = S.st.settings;
    $('#openroom') && ($('#openroom').onclick = async () => { S.host = await api.invoke('host:enable', true); d.render(); });
    $('#panic').onclick = () => api.invoke('host:panic');
    $('#pickmovie') && ($('#pickmovie').onclick = () => api.invoke('movie:pick'));
    $('#pickscreen') && ($('#pickscreen').onclick = () => d.pickWindow());
    $$('[data-op]').forEach((b) => (b.onclick = () => api.invoke('movie:ctl', { op: b.dataset.op, value: b.dataset.v })));
    const seek = $('#wseek');
    if (seek) { seek.oninput = () => { S.seeking = true; $('#wpos').textContent = fmtTime(+seek.value); }; seek.onchange = () => { S.seeking = false; api.invoke('movie:ctl', { op: 'seek', value: +seek.value }); }; }
    $('#waudio') && ($('#waudio').onchange = (e) => api.invoke('movie:ctl', { op: 'audio', value: e.target.value }));
    $('#wsub') && ($('#wsub').onchange = (e) => (e.target.value === '@file' ? api.invoke('movie:sub-file') : api.invoke('movie:ctl', { op: 'sub', value: e.target.value })));
    $('#wnight') && ($('#wnight').onclick = () => api.invoke('movie:ctl', { op: 'night', value: !S.host.movie.night }));
    $('#readyq') && ($('#readyq').onclick = () => api.invoke('ready:check'));
    $('#readygo') && ($('#readygo').onclick = () => api.invoke('ready:go'));
    $('#watchnow') && ($('#watchnow').onclick = () => openLocalStage());
    $$('#wctl button').forEach((b) => (b.onclick = async () => { await set({ watchControl: b.dataset.v }); d.render(); }));
    $('#wq').oninput = (e) => { $('#wqv').textContent = `${e.target.value} Mbps`; };
    $('#wq').onchange = (e) => set({ watchMbps: +e.target.value });
    $$('.switch[data-k]').forEach((b) => (b.onclick = async () => { await set({ [b.dataset.k]: !(s[b.dataset.k] ?? true) }); d.render(); }));
    wireChat('hchat', (text) => api.invoke('chat', text));
    $$('[data-perm]').forEach((b) => (b.onclick = async () => { S.st.settings = await api.invoke('perms', { [b.dataset.perm]: !(s[b.dataset.perm] !== false) }); d.render(); }));
  }

  function tickWatchRoom() {
    const mv = S.host?.movie;
    if (!mv || S.seeking) return;
    const p = livePos(mv);
    const a = $('#wpos'), b = $('#wseek');
    if (a) a.textContent = fmtTime(p);
    if (b) b.value = Math.floor(p);
  }

  // ------------------------------------------------------------------ chat
  function chatList(compact) {
    const list = S.chat.slice(-60);
    return `<div class="chatlist ${compact ? 'compact' : ''}" id="chatlist">${list.length ? list.map(chatRow).join('') : `<div class="sub">—</div>`}</div>`;
  }
  const chatRow = (c) => `<div class="cmsg"><b>${esc(c.from || '·')}</b><span>${esc(c.text)}</span></div>`;
  const chatInput = (id) => `<form class="chatin" data-chat="${id}"><input class="input" maxlength="300" placeholder="${t('chat_ph')}" autocomplete="off"><button class="btn sm" type="submit">${t('send')}</button></form>`;
  function wireChat(id, send) {
    const f = $(`[data-chat="${id}"]`); if (!f) return;
    f.onsubmit = (e) => { e.preventDefault(); const i = f.querySelector('input'); const v = i.value.trim(); if (v) { send(v); i.value = ''; } };
    f.querySelector('input').addEventListener('keydown', (e) => e.stopPropagation(), true);
    const l = $('#chatlist'); if (l) l.scrollTop = l.scrollHeight;
  }
  function addChat(c) {
    S.chat.push(c); if (S.chat.length > 200) S.chat.shift();
    $$('#chatlist, #schatlist').forEach((l) => { if (l.querySelector('.sub')) l.innerHTML = ''; l.insertAdjacentHTML('beforeend', chatRow(c)); l.scrollTop = l.scrollHeight; });
    if (!c.old && !$('#stage').hidden && !$('#chatbox')?.classList.contains('open')) floatChat(c);
  }
  function floatChat(c) {
    const el = document.createElement('div');
    el.className = 'chatfloat'; el.innerHTML = chatRow(c);
    $('#stage').append(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 600); }, 5000);
  }

  // ------------------------------------------------------------------ reactions
  function floatReaction(r) {
    const layer = $('#stage').hidden ? null : $('#stage');
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'react-float'; el.textContent = r;
    el.style.left = `${8 + Math.random() * 18}%`;
    layer.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ------------------------------------------------------------------ stage bar (guest + host local)
  function canControl() { return S.local || S.ctrl.canControl; }
  function stageMovie() { return S.local ? S.host?.movie : S.gmovie; }
  function movieCtl(op, value) {
    if (S.local) return api.invoke('movie:ctl', { op, value });
    if (!canControl()) return toast(t('no_control'));
    api.invoke('guest:ctrl', { t: 'movie', op, value });
  }

  function renderBar() {
    const bar = $('#wbar'); if (!bar) return;
    const mv = stageMovie();
    const ctl = canControl();
    bar.innerHTML = `
      <input type="range" class="seek" id="sseek" min="0" max="${Math.max(1, Math.floor(mv?.dur || 1))}" step="1" value="${Math.floor(livePos(mv))}" ${ctl && mv ? '' : 'disabled'}>
      <div class="wrow">
        <div class="transport" dir="ltr">
        <button class="iconbtn" id="splay" ${ctl && mv ? '' : 'disabled'}>${icon(mv?.playing ? 'pause' : 'play', 22)}</button>
        <button class="iconbtn" data-sop="skip" data-v="-10" ${ctl && mv ? '' : 'disabled'}>${icon('back', 20)}</button>
        <button class="iconbtn" data-sop="skip" data-v="10" ${ctl && mv ? '' : 'disabled'}>${icon('fwd', 20)}</button>
        </div>
        <span class="mono wtime"><span id="spos">${fmtTime(livePos(mv))}</span> / ${fmtTime(mv?.dur)}</span>
        <span class="wtitle">${esc(mv?.title || '')}</span>
        <span class="sp"></span>
        ${!ctl && !S.local ? `<button class="btn sm ghost" id="sask">${t('ask_pause')}</button>` : ''}
        ${ctl && mv ? `<button class="btn sm ghost" data-sop="skip" data-v="85">${t('skip_intro')}</button>` : ''}
        ${S.local || S.ctrl.perms?.react !== false ? `<div class="reactbar">${REACTIONS.map((r, i) => `<button class="rb" data-r="${r}" title="${i + 1}">${r}</button>`).join('')}</div>` : ''}
        <button class="iconbtn" id="schat" title="${t('chat')}">${icon('chat', 20)}</button>
        <button class="iconbtn" id="sshot" title="${t('shot')}">${icon('camera', 20)}</button>
        <button class="iconbtn" id="sfull" title="${t('fullscreen')}">${icon('full', 20)}</button>
        <button class="iconbtn" id="sleave" title="${S.local ? t('back_room') : t('leave')}">${icon('door', 20)}</button>
      </div>`;
    const seek = $('#sseek');
    seek.oninput = () => { S.seeking = true; $('#spos').textContent = fmtTime(+seek.value); };
    seek.onchange = () => { S.seeking = false; movieCtl('seek', +seek.value); };
    $('#splay').onclick = () => movieCtl('toggle');
    $$('[data-sop]', bar).forEach((b) => (b.onclick = () => movieCtl(b.dataset.sop, b.dataset.v)));
    $$('.rb', bar).forEach((b) => (b.onclick = () => sendReact(b.dataset.r)));
    $('#sask') && ($('#sask').onclick = () => api.invoke('guest:ctrl', { t: 'askpause' }));
    $('#schat').onclick = () => toggleChat();
    $('#sshot').onclick = () => shot();
    $('#sfull').onclick = () => api.invoke('fullscreen');
    $('#sleave').onclick = () => (S.local ? closeLocalStage() : d.leave());
  }

  function tickBar() {
    const mv = stageMovie(); if (!mv || S.seeking) return;
    const p = livePos(mv);
    const a = $('#spos'), b = $('#sseek');
    if (a) a.textContent = fmtTime(p);
    if (b) b.value = Math.floor(p);
  }

  function sendReact(r) {
    if (!S.local && S.ctrl.perms?.react === false) return;
    if (S.local) api.invoke('react', r); else api.invoke('guest:ctrl', { t: 'react', r });
  }
  function sendChat(text) {
    if (S.local) api.invoke('chat', text); else api.invoke('guest:ctrl', { t: 'chat', text });
  }

  function toggleChat(force) {
    const box = $('#chatbox');
    const open = force ?? !box.classList.contains('open');
    box.classList.toggle('open', open);
    if (open) {
      const canChat = S.local || S.ctrl.perms?.chat !== false;
      box.innerHTML = `<div class="ph"><h3>${t('chat')}</h3><button class="iconbtn" id="cclose">${icon('x', 16)}</button></div><div class="chatlist" id="schatlist">${S.chat.slice(-80).map(chatRow).join('')}</div>${canChat ? chatInput('schat') : `<div class="sub">${t('chat_off_note')}</div>`}`;
      $('#cclose').onclick = () => toggleChat(false);
      wireChat('schat', sendChat);
      const l = $('#schatlist'); l.scrollTop = l.scrollHeight;
      setTimeout(() => box.querySelector('input')?.focus(), 30);
    }
  }

  async function shot() {
    const url = S.player?.screenshot();
    if (!url) return;
    const file = await api.invoke('shot', url);
    if (file) toast(t('shot_saved'), { action: t('open_folder'), onAction: () => api.invoke('show-file', file) });
  }

  function setupWatchStage() {
    const stage = $('#stage');
    stage.classList.add('watch');
    if (!$('#wbar')) {
      stage.insertAdjacentHTML('beforeend', '<aside class="chatbox" id="chatbox"></aside><div class="wbar" id="wbar"></div>');
    }
    renderBar();
    S.player.setCinema(true, S.local ? 70 : S.st.settings.cinemaDelay || 180);
    S.player.inputEnabled = false;
    let hideT;
    const show = () => { stage.classList.remove('idle'); clearTimeout(hideT); hideT = setTimeout(() => stage.classList.add('idle'), 3000); };
    S.player.onActivity = show; show();
  }

  function teardownWatchStage() {
    const stage = $('#stage');
    stage.classList.remove('watch', 'idle');
    $('#wbar')?.remove(); $('#chatbox')?.remove();
    $$('.react-float, .chatfloat, .countdown, .readyask').forEach((x) => x.remove());
    if (S.player) { S.player.setCinema(false); S.player.inputEnabled = true; S.player.onActivity = null; }
  }

  // keys while watching: space play/pause, arrows seek, 1-6 react, Enter chat
  function watchKey(e, down) {
    if (!$('#stage').classList.contains('watch') || !down) return false;
    if (e.target.closest?.('input, select, textarea')) return false;
    const n = '123456'.indexOf(e.key);
    if (n >= 0) { sendReact(REACTIONS[n]); return true; }
    if (e.code === 'Space') { movieCtl('toggle'); return true; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { const rtl = document.documentElement.dir === 'rtl'; const fwd = (e.code === 'ArrowRight') !== rtl; movieCtl('skip', fwd ? 10 : -10); return true; }
    if (e.code === 'Enter') { toggleChat(true); return true; }
    if (e.code === 'KeyF') { api.invoke('fullscreen'); return true; }
    return false;
  }

  // ------------------------------------------------------------------ ready check + countdown
  function readyAsk() {
    $$('.readyask').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'readyask';
    el.innerHTML = `<div>${t('ready_q')}</div><button class="btn primary">${icon('check', 16)}<span>${t('ready_yes')}</span></button>`;
    el.querySelector('button').onclick = () => { api.invoke('guest:ctrl', { t: 'ready', on: true }); el.remove(); };
    ($('#stage').hidden ? document.body : $('#stage')).append(el);
  }

  function countdown(ms) {
    $$('.countdown').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'countdown';
    ($('#stage').hidden ? document.body : $('#stage')).append(el);
    let n = Math.round(ms / 1000);
    const step = () => { if (n <= 0) { el.remove(); return; } el.textContent = String(n); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); n--; setTimeout(step, 1000); };
    step();
  }

  // ------------------------------------------------------------------ host watches their own film
  function openLocalStage() {
    S.local = true;
    api.invoke('local:view', true);
    d.openStage({ host: { nick: S.st.settings.nick, id: S.st.id }, local: true });
  }
  function closeLocalStage() {
    api.invoke('local:view', false);
    S.local = false;
    d.closeStage();
  }

  // ------------------------------------------------------------------ session summary
  function summary(items) {
    if (!items?.length) return;
    const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? t('minutes', { n: m }) : t('hours', { h: Math.floor(m / 60), m: m % 60 }); };
    d.modal(`<div class="dialog"><div class="dh"><h3>${t('summary_title')}</h3></div><div class="db">
      ${items.map((x) => `<div class="sumrow">${avatar(x.name, '0')}<div style="flex:1"><div>${esc(x.name)}</div></div>
        <dl class="kv"><dt>${t('summary_dur')}</dt><dd class="mono">${dur(x.ms)}</dd><dt>${t('summary_ping')}</dt><dd class="mono">${x.rtt ?? '—'} ms</dd><dt>${t('summary_data')}</dt><dd class="mono">${x.mb >= 1000 ? `${(x.mb / 1000).toFixed(2)} GB` : `${x.mb} MB`}</dd></dl></div>`).join('')}
      </div><div class="df"><button class="btn primary" id="sumok">${t('ok')}</button></div></div>`, (L, close) => { $('#sumok', L).onclick = close; });
  }

  return { viewWatchRoom, mountWatchRoom, tickWatchRoom, addChat, floatReaction, renderBar, tickBar, setupWatchStage, teardownWatchStage, watchKey, readyAsk, countdown, openLocalStage, closeLocalStage, summary, fmtTime };
}
