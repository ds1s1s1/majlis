import { t, setLang, ago, getLang } from './i18n.js';
import { icon, mark } from './icons.js';
import { Player, VoiceHub, decodeCaps, measureHz } from './stream.js';
import { accelFrom, matchAccel } from './keys.js';
import { initWatch } from './watch.js';

const api = window.majlis;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtId = (id) => (id ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : '');
const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

const S = {
  view: 'home', st: null, host: null, presence: {}, guest: { state: 'idle' }, knockQ: [], check: null, checking: false,
  connect: { state: 'idle', reason: null, target: '' }, upHist: [], player: null, gstats: null, pstats: null, drawer: false,
  ctrl: { roster: null, role: null, slot: null, library: null }, port: null, recKey: null, hz: 60,
  chat: [], gmovie: null, local: false, summaries: [], hub: null, voiceGains: {}, latHist: [],
};

// ------------------------------------------------------------------------- utils
const PALETTE = ['#6d5a3f', '#4f5d4a', '#5a4b5e', '#3f5a5c', '#6b4a3f', '#4a5470', '#5f5a3a', '#6a4e55'];
function avatar(name, id, status) {
  const col = PALETTE[parseInt(String(id || '0').slice(-3), 10) % PALETTE.length];
  const init = String(name || id || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  return `<span class="avatar" style="background:${col}">${esc(init)}${status ? `<i class="dot ${status}"></i>` : ''}</span>`;
}
function pingCls(ms) { return ms == null ? '' : ms < 30 ? 'ok' : ms < 70 ? 'warn' : 'bad'; }
function pathLabel(p) {
  if (!p) return '—';
  if (p.kind === 'ws') return t('path_tcp');
  if (p.kind === 'relay') return t('path_relay', { name: relayName(p.label) });
  if (p.lan) return t('path_lan');
  return `${t('path_direct')} ${p.fam === 'v6' ? 'IPv6' : 'IPv4'}`;
}
const RELAY_AR = { cloudflare: 'Cloudflare', jed: 'جدة', jeddah: 'جدة', ruh: 'الرياض', riyadh: 'الرياض', dmm: 'الدمام', dammam: 'الدمام', bah: 'البحرين', bahrain: 'البحرين', dxb: 'دبي', dubai: 'دبي', local: 'المحلي' };
function relayName(l) { if (getLang() !== 'ar') return l; return RELAY_AR[String(l || '').toLowerCase()] || l; }

function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = `toast ${opts.bad ? 'bad' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<span class="act">${esc(opts.action)}</span>` : ''}`;
  if (opts.onAction) el.querySelector('.act').onclick = () => { opts.onAction(); el.remove(); };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), opts.ms || 4200);
}

function menu(x, y, items) {
  $$('.menu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.bad ? 'bad' : ''}">${it.icon ? icon(it.icon, 16) : ''}<span>${esc(it.label)}</span></button>`)).join('');
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  m.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; m.remove(); items[+b.dataset.i].run(); };
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
}

function modal(html, onMount) {
  const L = $('#modal');
  L.innerHTML = html; L.classList.add('open');
  const close = () => { L.classList.remove('open'); L.innerHTML = ''; };
  L.onmousedown = (e) => { if (e.target === L) close(); };
  onMount?.(L, close);
  return close;
}

const set = async (patch) => { S.st.settings = await api.invoke('settings', patch); };

let W;
function watchUI() {
  W ||= initWatch({ S, api, t, icon, esc, toast, avatar, set, $, $$, modal, render: () => render(), pickWindow: () => pickWindow(), openStage: (i) => openStage(i), closeStage: (k) => closeStage(k), leave: () => { api.invoke('leave'); closeStage(); } });
  return W;
}

// ------------------------------------------------------------------------- frame
const NAV = [['home', 'home', 'nav_home'], ['room', 'room', 'nav_room'], ['net', 'net', 'nav_net'], ['lib', 'lib', 'nav_lib']];
function renderRail() {
  const knocks = S.host?.knocks?.length || 0;
  $('#rail').innerHTML = NAV.map(([v, ic, k]) => `<button data-v="${v}" class="${S.view === v ? 'on' : ''}">${icon(ic, 21)}<span>${t(k)}</span>${v === 'room' && knocks ? `<span class="badge">${knocks}</span>` : ''}</button>`).join('')
    + `<div class="grow"></div><button data-v="set" class="${S.view === 'set' ? 'on' : ''}">${icon('set', 21)}<span>${t('nav_set')}</span></button>`;
  $$('#rail button').forEach((b) => (b.onclick = () => go(b.dataset.v)));
}

function renderStatus() {
  const st = S.st;
  let s;
  if (st?.noServer) s = `<span><i class="dot bad"></i>${t('st_noserver')}</span>`;
  else if (!st?.registered) s = `<span><i class="dot warn"></i>${t('st_connecting')}</span>`;
  else s = `<span><i class="dot ok"></i>${t('st_online')}${S.via === 'ws' ? ` · ${t('st_tcp')}` : ''}</span>`;
  if (S.host?.guests?.length) s = `<span><b>${S.host.guests.length}</b> ${getLang() === 'ar' ? 'بالمجلس' : 'in room'}</span>` + s;
  $('#tbStatus').innerHTML = s;
}

function go(v) { S.view = v; renderRail(); render(); }

function render() {
  const fn = { home: viewHome, room: viewRoom, net: viewNet, lib: viewLib, set: viewSettings }[S.view];
  $('#view').innerHTML = fn();
  ({ home: mountHome, room: mountRoom, net: mountNet, lib: mountLib, set: mountSettings }[S.view])?.();
}

// ========================================================================= HOME
function viewHome() {
  const id = S.st.id;
  const [a, b, c] = [id.slice(0, 3), id.slice(3, 6), id.slice(6)];
  const pub = S.st.publicAddr || {};
  const hosting = S.host?.enabled;
  const code = S.host?.code;
  return `<div class="home">
    <div>
      ${S.st.noServer ? `<div class="knockline fail" style="margin:0 0 22px;color:var(--fg)"><span style="flex:1">${t('noserver_note')}</span><button class="btn sm primary" id="gosrv">${t('nav_set')}</button></div>` : ''}
      <section class="idblock">
        <div class="label">${t('your_number')}</div>
        <div class="bignum mono" id="bignum"><span>${a}</span><span>${b}</span><span>${c}</span></div>
        <div class="idactions">
          <button class="btn sm" id="cpy">${icon('copy', 15)}<span>${t('copy')}</span></button>
          <button class="btn sm" id="inv">${icon('link', 15)}<span>${t('invite')}</span></button>
          <button class="btn sm" id="wa">${icon('chat', 15)}<span>${t('whatsapp')}</span></button>
        </div>
        <div class="idstatus">
          <span><i class="dot ${S.st.registered ? 'ok' : 'warn'}"></i>${S.st.registered ? t('st_online') : t('st_connecting')}</span>
          <span><i class="dot ${pub.v6 ? 'ok' : ''}"></i>IPv6 ${pub.v6 ? t('yes') : t('no')}</span>
          ${S.st.relays?.length ? `<span>${icon('router', 14)}${S.st.relays.map((r) => esc(relayName(r.label || r.name))).join(' · ')}</span>` : ''}
        </div>
      </section>

      <div class="sadu"></div>

      <section class="connect">
        <h2>${t('connect_title')}</h2>
        <div class="digits" id="digits">
          ${[0, 1, 2].map((g) => `<div class="grp">${[0, 1, 2].map((i) => `<input inputmode="numeric" maxlength="1" data-i="${g * 3 + i}" aria-label="digit ${g * 3 + i + 1}">`).join('')}</div>`).join('')}
        </div>
        <div class="row">
          <button class="btn primary lg" id="go">${t('connect_btn')}</button>
          <span class="hint">${t('connect_hint')}</span>
        </div>
        <div id="knockline"></div>
      </section>

      <section class="modepick">
        <h2>${t('mode_label')}</h2>
        <div class="modes">
          <button class="mode ${S.host?.mode !== 'watch' ? 'on' : ''}" data-m="play">${icon('pad', 26)}<span class="mt">${t('mode_play')}</span><span class="ms">${t('mode_play_sub')}</span></button>
          <button class="mode ${S.host?.mode === 'watch' ? 'on' : ''}" data-m="watch">${icon('film', 26)}<span class="mt">${t('mode_watch')}</span><span class="ms">${t('mode_watch_sub')}</span></button>
        </div>
      </section>

      <section class="hostcard">
        <div class="top">
          <div class="txt"><h3>${hosting ? t('hosting_on') : t('hosting_off')}</h3><div class="sub">${hosting ? t('hosting_sub_on') : t('hosting_sub_off')}</div></div>
          <button class="switch ${hosting ? 'on' : ''}" id="hostsw" aria-label="${t('hosting')}"></button>
        </div>
        ${hosting ? `<div class="code">
          ${code ? `<div class="val">${code.code.slice(0, 3)} ${code.code.slice(3)}</div>
            <div class="meta"><div>${t('temp_code')}</div><div class="sub" id="codeleft">${t('temp_code_left', { m: Math.max(0, Math.round((code.exp - Date.now()) / 60000)) })}</div></div>
            <button class="btn sm" id="cpycode">${icon('copy', 15)}</button><button class="btn sm ghost" id="revoke">${t('revoke')}</button>`
          : `<div class="meta"><div>${t('temp_code')}</div><div class="sub">${t('temp_code_hint')}</div></div><button class="btn sm" id="newcode">${t('temp_code_new')}</button>`}
        </div>` : ''}
      </section>
    </div>

    <aside class="friends">
      <div class="head"><h2>${t('friends')}</h2><button class="btn sm ghost" id="addf">${icon('plus', 15)}<span>${t('add_friend')}</span></button></div>
      <div class="flist" id="flist">${friendsList()}</div>
    </aside>
  </div>`;
}

function friendsList() {
  const fs = (S.st.friends || []).filter((f) => f.trust !== 'block' || true);
  if (!fs.length) return `<div class="empty">${t('friends_empty')}</div>`;
  const rank = (f) => (S.presence[f.id] === 'online' ? 0 : S.presence[f.id] === 'busy' ? 1 : 2);
  return fs.slice().sort((a, b) => rank(a) - rank(b) || (b.lastSeen || 0) - (a.lastSeen || 0)).map((f) => {
    const p = S.presence[f.id];
    const st = f.trust === 'block' ? '' : p === 'online' ? 'ok' : p === 'busy' ? 'acc' : '';
    const line = f.trust === 'block' ? t('f_block') : p === 'online' ? t('f_online') : p === 'busy' ? t('f_busy') : t('f_last', { when: ago(f.lastSeen) });
    return `<div class="frow" data-id="${f.id}">
      ${avatar(f.name, f.id, st)}
      <div class="who"><div class="nm">${esc(f.name)}${f.trust === 'always' ? ` <span class="tag acc" style="height:18px">${icon('shield', 12)}</span>` : ''}</div>
        <div class="ln"><span class="mono">${fmtId(f.id)}</span><span>${esc(line)}</span></div></div>
      <div class="act">
        ${f.trust !== 'block' ? `<button class="iconbtn" data-act="call" title="${t('f_connect')}">${icon('door', 17)}</button>` : ''}
        <button class="iconbtn" data-act="more">${icon('more', 17)}</button>
      </div>
    </div>`;
  }).join('');
}

function mountHome() {
  const id = S.st.id;
  S.homeSig = JSON.stringify([S.host?.enabled, S.host?.code?.code, S.host?.mode]);
  $('#gosrv') && ($('#gosrv').onclick = () => go('set'));
  $('#cpy').onclick = () => { api.invoke('copy', id); toast(t('copied')); };
  $('#inv').onclick = async () => { const l = await api.invoke('invite', id); api.invoke('copy', l); toast(t('copied')); };
  $('#wa').onclick = async () => {
    const l = await api.invoke('invite', id);
    api.invoke('open', `https://wa.me/?text=${encodeURIComponent(t('share_text', { num: fmtId(id), link: l }))}`);
  };
  $$('.mode[data-m]').forEach((b) => (b.onclick = async () => { S.host = await api.invoke('mode', b.dataset.m); render(); }));
  $('#hostsw').onclick = async () => { S.host = await api.invoke('host:enable', !S.host?.enabled); render(); renderRail(); };
  $('#newcode') && ($('#newcode').onclick = () => api.invoke('host:code', false));
  $('#revoke') && ($('#revoke').onclick = () => api.invoke('host:code', true));
  $('#cpycode') && ($('#cpycode').onclick = async () => { const c = S.host.code.code; api.invoke('copy', `${c}\n${await api.invoke('invite', c)}`); toast(t('copied')); });
  $('#addf').onclick = () => addFriendDialog();
  wireDigits();
  wireFriends();
  renderKnockLine();
}

function wireDigits() {
  const boxes = $$('#digits input');
  const value = () => boxes.map((b) => b.value).join('');
  const fill = (str, from = 0) => {
    const d = toLatin(str).replace(/\D/g, '').slice(0, 9 - from);
    [...d].forEach((ch, i) => { boxes[from + i].value = ch; });
    boxes.forEach((b) => b.classList.toggle('filled', !!b.value));
    const next = boxes.find((b) => !b.value);
    (next || boxes[8]).focus();
  };
  boxes.forEach((b, i) => {
    b.oninput = () => { const v = toLatin(b.value).replace(/\D/g, ''); b.value = v.slice(-1); b.classList.toggle('filled', !!b.value); if (b.value && i < 8) boxes[i + 1].focus(); };
    b.onkeydown = (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); boxes[i - 1].classList.remove('filled'); e.preventDefault(); }
      if (e.key === 'Enter') doConnect(value());
      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      if (e.key === 'ArrowLeft' && boxes[i + (dir === 1 ? 0 : -1)]) { /* digits are LTR */ if (i < 8) boxes[i + 1].focus(); }
      if (e.key === 'ArrowRight' && i > 0) boxes[i - 1].focus();
    };
    b.onpaste = (e) => { e.preventDefault(); boxes.forEach((x) => (x.value = '')); fill(e.clipboardData.getData('text')); };
  });
  if (S.connect.target) fill(S.connect.target);
  $('#go').onclick = () => doConnect(value());
}

function askPin(target) {
  modal(`<div class="dialog" style="width:380px"><div class="dh"><h3>${t('pin_title')}</h3><div class="sub" style="margin-top:4px">${t('pin_sub')}</div></div>
    <div class="db"><input class="input mono pinbox" id="pinin" inputmode="numeric" maxlength="8" autocomplete="off"></div>
    <div class="df"><button class="btn ghost" id="x">${t('cancel')}</button><button class="btn primary" id="ok">${t('connect_btn')}</button></div></div>`, (L, close) => {
    const i = $('#pinin', L); i.focus();
    const go = () => { const v = toLatin(i.value).replace(/\D/g, ''); if (!v) return i.focus(); close(); doConnect(target, v); };
    $('#ok', L).onclick = go; i.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('#x', L).onclick = close;
  });
}

async function doConnect(raw, pin) {
  const target = toLatin(raw).replace(/\D/g, '');
  if (!(target.length === 9 || target.length === 6)) { $$('#digits input').find((b) => !b.value)?.focus(); return; }
  if (target === S.st.id) return;
  S.connect = { state: 'knocking', target };
  renderKnockLine();
  const caps = await decodeCaps();
  const scr = { w: Math.round(screen.width * devicePixelRatio), h: Math.round(screen.height * devicePixelRatio), hz: S.hz };
  const padType = [...navigator.getGamepads()].find(Boolean)?.id.match(/054c/i) ? 'ds4' : 'x360';
  const r = await api.invoke('connect', { target, caps: { codecs: caps.codecs, screen: scr, padType }, pin });
  if (!r.ok && r.reason === 'pin') { S.connect = { state: 'idle', target }; renderKnockLine(); return askPin(target); }
  if (!r.ok) { S.connect = { state: 'failed', reason: r.reason, target }; renderKnockLine(); }
}

function renderKnockLine() {
  const el = $('#knockline'); if (!el) return;
  const c = S.connect;
  if (c.state === 'knocking' || c.state === 'waiting') {
    el.innerHTML = `<div class="knockline"><span class="pulse"></span><span>${c.state === 'waiting' ? t('waiting_host') : t('knocking')}</span><span class="mono muted">${c.target.length === 9 ? fmtId(c.target) : c.target}</span><span class="sp"></span><button class="btn sm ghost" id="cancelk">${t('cancel')}</button></div>`;
    $('#cancelk').onclick = () => { api.invoke('cancel'); S.connect = { state: 'idle', target: c.target }; renderKnockLine(); };
  } else if (c.state === 'failed' && c.reason !== 'cancelled') {
    el.innerHTML = `<div class="knockline fail">${icon('x', 16)}<span>${t(`fail_${c.reason}`) || c.reason}</span></div>`;
  } else el.innerHTML = '';
}

function wireFriends() {
  $$('#flist .frow').forEach((row) => {
    const id = row.dataset.id;
    const f = S.st.friends.find((x) => x.id === id);
    row.ondblclick = () => doConnect(id);
    row.querySelector('[data-act="call"]')?.addEventListener('click', () => doConnect(id));
    const more = (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        { label: t('f_connect'), icon: 'door', run: () => doConnect(id) },
        { label: t('f_rename'), icon: 'set', run: () => addFriendDialog(f) },
        f.trust === 'always' ? { label: t('f_untrust'), icon: 'shield', run: () => upFriend({ id, trust: 'ask' }) } : { label: t('f_trust'), icon: 'shield', run: () => upFriend({ id, trust: 'always' }) },
        '-',
        f.trust === 'block' ? { label: t('f_unblock'), run: () => upFriend({ id, trust: 'ask' }) } : { label: t('f_block'), bad: true, run: () => upFriend({ id, trust: 'block' }) },
        { label: t('f_remove'), bad: true, run: async () => { await api.invoke('friend:remove', id); await refresh(); } },
      ]);
    };
    row.querySelector('[data-act="more"]').onclick = more;
    row.oncontextmenu = more;
  });
}

async function upFriend(f) { await api.invoke('friend', f); await refresh(); }

function addFriendDialog(f) {
  modal(`<div class="dialog"><div class="dh"><h3>${f ? t('f_rename') : t('add_friend_title')}</h3></div>
    <div class="db">
      <div class="field"><label>${t('name')}</label><input class="input" id="fn" value="${esc(f?.name || '')}"></div>
      <div class="field"><label>${t('number')}</label><input class="input mono" id="fid" value="${esc(f?.id || '')}" ${f ? 'disabled' : ''} placeholder="123 456 789"></div>
    </div>
    <div class="df"><button class="btn ghost" id="x">${t('cancel')}</button><button class="btn primary" id="ok">${t('save')}</button></div></div>`, (L, close) => {
    $('#fn', L).focus();
    $('#x', L).onclick = close;
    $('#ok', L).onclick = async () => {
      const id = toLatin($('#fid', L).value).replace(/\D/g, '');
      const name = $('#fn', L).value.trim();
      if (!/^[1-9]\d{8}$/.test(id)) { $('#fid', L).focus(); return; }
      await api.invoke('friend', { id, name: name || id });
      close(); await refresh();
    };
  });
}

// ========================================================================= ROOM
function roomSig() {
  const h = S.host || {};
  const mv = h.movie;
  return JSON.stringify([h.mode, mv && [mv.title, mv.playing, mv.audio, mv.sub, mv.night, mv.next, mv.tracks?.subs?.length], (h.guests || []).map((g) => g.ready), S.st.settings.watchControl, h.enabled, h.hotseat, (h.guests || []).map((g) => [g.sid, g.role, g.slot, g.muted, g.hand, g.baton, g.expiresAt]), (h.knocks || []).map((k) => k.sid), S.st.settings.captureWindow, S.st.settings.display]);
}

function viewRoom() {
  if (S.host?.mode === 'watch') return watchUI().viewWatchRoom();
  const h = S.host || { guests: [], knocks: [], tiers: {} };
  const set_ = S.st.settings;
  const play = h.tiers?.play;
  const guests = h.guests || [];
  const bySlot = (n) => guests.find((g) => g.slot === n && g.role !== 'watch');
  const spect = guests.filter((g) => g.role === 'watch' || !g.slot);
  return `<div class="page-head">
      <h1>${t('room_title')}</h1>
      <span class="tag ${h.enabled ? 'ok' : ''}"><i class="dot ${h.enabled ? 'ok' : ''}"></i>${h.enabled ? t('hosting_on') : t('hosting_off')}</span>
      <span class="summary mono" id="sum">${play ? streamSummary(play) : ''}</span>
      <span class="sp"></span>
      ${!h.enabled ? `<button class="btn primary" id="openroom">${t('hosting')}</button>` : ''}
      <button class="btn danger" id="panic">${icon('door', 16)}<span>${t('panic')}</span><span class="kbd">${esc(shortKey(set_.panicKey))}</span></button>
    </div>
    <div class="room">
      <div>
        ${h.knocks?.length ? `<div class="lane" style="margin:0 0 22px"><h2>${t('waiting')}</h2><div class="stack">${h.knocks.map((k) => `<div class="knockrow" data-sid="${k.sid}">${avatar(k.name, k.from)}<div style="flex:1"><div>${esc(k.name)}</div><div class="sub mono">${fmtId(k.from)}</div></div><button class="btn sm primary" data-act="review">${t('let_in')}</button><button class="btn sm ghost" data-act="no">${t('decline')}</button></div>`).join('')}</div></div>` : ''}
        ${!guests.length && !h.knocks?.length ? `<div class="empty" style="padding:6px 0 22px"><h3 style="color:var(--fg);margin-bottom:4px">${t('room_empty_title')}</h3>${t('room_empty')}</div>` : ''}
        <div class="slots">
          ${[1, 2, 3, 4].map((n) => { const g = bySlot(n); return `<div class="slot ${g ? 'filled' : ''}" data-slot="${n}">
            <div class="slab"><span>${t('slot', { n })}</span>${icon('pad', 15)}</div>
            ${g ? gcard(g) : `<div class="free">${t('slot_free')}</div>`}
          </div>`; }).join('')}
        </div>
        <div class="lane">
          <h2>${t('spectators')}</h2>
          <div class="lanebox" data-slot="0">${spect.length ? spect.map(gcard).join('') : `<div class="empty">${t('spectators_empty')}</div>`}</div>
        </div>
        <div class="lane">
          <div class="panel"><div class="pb"><div class="prow">
            <div class="lbl"><div>${t('hotseat')}</div><div class="sub">${h.hotseat?.on ? t('holder', { name: esc(guests.find((g) => g.baton)?.name || '—') }) : t('hotseat_sub')}</div></div>
            ${h.hotseat?.on ? `<button class="btn sm" id="pass">${icon('swap', 15)}<span>${t('pass_next')}</span></button>` : ''}
            <button class="switch ${h.hotseat?.on ? 'on' : ''}" id="hotseat"></button>
          </div></div></div>
        </div>
      </div>

      <aside class="stack" style="gap:14px">
        <div class="panel">
          <div class="ph"><h3>${t('stream')}</h3><span class="tag mono" id="upnow">${fmtMbps(h.upKbps)}</span></div>
          <div class="pb">
            <canvas class="spark" id="spark" width="560" height="92"></canvas>
            <div class="field"><label>${t('source')}</label>
              <button class="srcbtn" id="src">${icon(set_.captureWindow ? 'window' : 'monitor', 18)}<span>${set_.captureWindow ? esc(set_.captureWindow.title).slice(0, 48) : t('source_display', { n: (set_.display | 0) + 1 })}</span><span class="sub">${t('change')}</span></button>
              ${set_.captureWindow ? `<div class="sub">${icon('shield', 13)} ${t('privacy_note')}</div>` : ''}
            </div>
            <div class="field"><label>${t('room_pin')}</label><input class="input mono" id="roompin" maxlength="8" inputmode="numeric" placeholder="${t('room_pin_ph')}" value="${esc(set_.roomPin || '')}"><div class="sub">${t('room_pin_sub')}</div></div>
            <div class="prow"><div class="lbl">${t('allow_chat')}</div><button class="switch ${set_.allowChat !== false ? 'on' : ''}" data-perm="allowChat"></button></div>
            <div class="prow"><div class="lbl">${t('allow_react')}</div><button class="switch ${set_.allowReactions !== false ? 'on' : ''}" data-perm="allowReactions"></button></div>
            <div class="field"><label>${t('codec')}</label>
              <div class="seg" id="codec">${['auto', 'av1', 'hevc', 'h264'].map((c) => `<button data-v="${c}" class="${set_.codec === c ? 'on' : ''}" ${c !== 'auto' && !S.st.encoders.some((e) => e.startsWith(c)) ? 'disabled style="opacity:.4"' : ''}>${c === 'auto' ? t('auto') : c.toUpperCase()}</button>`).join('')}<button disabled style="opacity:.35" title="${t('pyrowave_soon')}">Pyro</button></div>
            </div>
            <div class="field"><label>${t('max_bitrate')} <span class="mono" id="mbv">${set_.maxMbps} Mbps</span></label><input type="range" min="5" max="150" step="5" value="${set_.maxMbps}" id="mbps"></div>
            <div class="field"><label>${t('resolution')}</label><div class="seg" id="res">${['source', '1440', '1080', '720'].map((r) => `<button data-v="${r}" class="${(set_.maxRes || 'source') === r ? 'on' : ''}">${r === 'source' ? t('res_source') : `${r}p`}</button>`).join('')}</div></div>
            <div class="field"><label>${t('quality')}</label><div class="seg" id="qp">${['speed', 'balanced', 'quality'].map((q) => `<button data-v="${q}" class="${(set_.qualityPreset || 'balanced') === q ? 'on' : ''}">${t(`q_${q}`)}</button>`).join('')}</div><div class="sub">${t(`q_${set_.qualityPreset || 'balanced'}_sub`)}</div></div>
            <div class="prow"><div class="lbl"><div>${t('light_spect')}</div><div class="sub">${t('light_spect_sub')}</div></div><button class="switch ${set_.lightSpectators ? 'on' : ''}" data-k="lightSpectators"></button></div>
            <div class="prow"><div class="lbl">${t('fps')}</div><div class="seg" id="fps">${[30, 60, 90, 120].map((f) => `<button data-v="${f}" class="${set_.fps === f ? 'on' : ''}">${f}</button>`).join('')}</div></div>
            <div class="prow"><div class="lbl"><div>${t('stability')}</div><div class="sub">${t('stability_sub')}</div></div>
              <div class="seg" id="stab">${['auto', 'on', 'off'].map((v) => `<button data-v="${v}" class="${set_.stability === v ? 'on' : ''}">${t(v === 'auto' ? 'auto' : v)}</button>`).join('')}</div></div>
            <div class="prow"><div class="lbl"><div>${t('ten_bit')}</div><div class="sub">${t('ten_bit_sub')}</div></div><button class="switch ${set_.tenBit ? 'on' : ''}" data-k="tenBit"></button></div>
            <div class="prow"><div class="lbl"><div>${t('match_res')}</div><div class="sub">${t('match_res_sub')}</div></div><button class="switch ${set_.matchResolution ? 'on' : ''}" data-k="matchResolution"></button></div>
            <div class="prow"><div class="lbl"><div>${t('hdr')}</div></div><button class="switch ${set_.hdr ? 'on' : ''}" data-k="hdr"></button></div>
          </div>
        </div>
        <div class="panel"><div class="pb">
          <div class="prow"><div class="lbl"><div>${t('replay')}</div><div class="sub">${t('replay_sub', { s: set_.replaySeconds })}</div></div><button class="switch ${set_.replay ? 'on' : ''}" data-k="replay"></button></div>
          <button class="btn" id="saveclip" ${set_.replay ? '' : 'disabled'}>${icon('clip', 16)}<span>${t('replay_save')}</span><span class="kbd">${esc(shortKey(set_.replayKey))}</span></button>
        </div></div>
      </aside>
    </div>`;
}

function shortKey(a) { return String(a || '').replace('Control', 'Ctrl').replaceAll('+', ' + '); }
function fmtMbps(k) { return `${((k || 0) / 1000).toFixed(1)} Mbps`; }
function streamSummary(p) { return `${p.codec.toUpperCase()} · ${p.scale ? `${p.scale.w}×${p.scale.h}` : 'native'} · ${p.fps} · ${(p.kbps / 1000).toFixed(1)} Mbps${p.lan ? ' · LAN' : ''}`; }

function gcard(g) {
  const p = g.path;
  const left = g.expiresAt ? Math.max(0, Math.round((g.expiresAt - Date.now()) / 60000)) : null;
  return `<div class="gcard ${g.speaking ? 'speaking' : ''}" draggable="true" data-sid="${g.sid}">
    <div class="r1">${avatar(g.name, g.id)}<span class="nm">${esc(g.name)}</span>
      ${g.hand ? `<span class="baton" title="${t('hand_up')}">${icon('hand', 15)}</span>` : ''}
      ${g.baton ? `<span class="baton">${icon('pad', 15)}</span>` : ''}
      ${g.muted ? `<span class="muted">${icon('micoff', 14)}</span>` : ''}
      <button class="iconbtn" data-act="more" style="width:24px;height:24px">${icon('more', 15)}</button></div>
    <div class="r2"><span class="tag"><span class="ping ${pingCls(g.rtt)}" data-f="rtt">${g.rtt || '—'} ms</span></span><span class="tag" data-f="path">${esc(pathLabel(p))}</span>${left != null ? `<span class="tag acc">${t('acc_left', { m: left })}</span>` : ''}</div>
    <div class="r3"><select class="input" data-act="role">${['watch', 'pad', 'kbm', 'full'].map((r) => `<option value="${r}" ${g.role === r ? 'selected' : ''}>${t(`role_${r}`)}</option>`).join('')}</select></div>
  </div>`;
}

let lastRoomSig = '';
function mountRoom() {
  lastRoomSig = roomSig();
  if (S.host?.mode === 'watch') return watchUI().mountWatchRoom();
  const set_ = S.st.settings;
  $('#openroom') && ($('#openroom').onclick = async () => { S.host = await api.invoke('host:enable', true); render(); });
  $('#panic').onclick = () => api.invoke('host:panic');
  $('#hotseat').onclick = () => api.invoke('host:hotseat', !S.host?.hotseat?.on);
  $('#pass') && ($('#pass').onclick = () => api.invoke('host:pass'));
  $$('.knockrow').forEach((r) => {
    r.querySelector('[data-act="review"]').onclick = () => { const k = S.host.knocks.find((x) => x.sid === r.dataset.sid); if (k) knockDialog(k); };
    r.querySelector('[data-act="no"]').onclick = () => api.invoke('host:decide', { sid: r.dataset.sid, accept: false });
  });
  // drag & drop between pads and spectators
  $$('.gcard').forEach((c) => {
    c.ondragstart = (e) => { e.dataTransfer.setData('text/sid', c.dataset.sid); e.dataTransfer.effectAllowed = 'move'; };
    c.querySelector('[data-act="role"]').onchange = (e) => api.invoke('host:role', { sid: c.dataset.sid, role: e.target.value });
    c.querySelector('[data-act="more"]').onclick = (e) => guestMenu(e, c.dataset.sid);
    c.oncontextmenu = (e) => guestMenu(e, c.dataset.sid);
  });
  $$('[data-slot]').forEach((z) => {
    z.ondragover = (e) => { e.preventDefault(); z.classList.add('drop'); };
    z.ondragleave = () => z.classList.remove('drop');
    z.ondrop = (e) => {
      e.preventDefault(); z.classList.remove('drop');
      const sid = e.dataTransfer.getData('text/sid'); if (!sid) return;
      const n = +z.dataset.slot;
      if (n === 0) api.invoke('host:role', { sid, role: 'watch' });
      else api.invoke('host:slot', { sid, slot: n });
    };
  });
  $('#src').onclick = () => pickWindow();
  $('#roompin') && ($('#roompin').onchange = (e) => set({ roomPin: toLatin(e.target.value).replace(/\D/g, '') }));
  $$('[data-perm]').forEach((b) => (b.onclick = async () => { S.st.settings = await api.invoke('perms', { [b.dataset.perm]: !(set_[b.dataset.perm] !== false) }); render(); }));
  $$('#codec button').forEach((b) => (b.onclick = async () => { if (b.disabled) return; await set({ codec: b.dataset.v }); render(); }));
  $$('#fps button').forEach((b) => (b.onclick = async () => { await set({ fps: +b.dataset.v }); render(); }));
  $$('#res button').forEach((b) => (b.onclick = async () => { await set({ maxRes: b.dataset.v }); render(); }));
  $$('#qp button').forEach((b) => (b.onclick = async () => { await set({ qualityPreset: b.dataset.v }); render(); }));
  $$('#stab button').forEach((b) => (b.onclick = async () => { await set({ stability: b.dataset.v }); render(); }));
  $('#mbps').oninput = (e) => { $('#mbv').textContent = `${e.target.value} Mbps`; };
  $('#mbps').onchange = (e) => set({ maxMbps: +e.target.value });
  $$('.switch[data-k]').forEach((b) => (b.onclick = async () => { await set({ [b.dataset.k]: !set_[b.dataset.k] }); render(); }));
  $('#saveclip').onclick = async () => { const r = await api.invoke('replay:save'); toast(r.ok ? t('replay_saved') : t('replay_off'), { bad: !r.ok }); };
  drawSpark();
}

function guestMenu(e, sid) {
  e.preventDefault();
  const g = S.host.guests.find((x) => x.sid === sid); if (!g) return;
  menu(e.clientX, e.clientY, [
    { label: `${t('access')}: ${t('acc_session')}`, run: () => api.invoke('host:expiry', { sid, duration: 'session' }) },
    { label: `${t('access')}: ${t('acc_1h')}`, run: () => api.invoke('host:expiry', { sid, duration: '1h' }) },
    { label: `${t('access')}: ${t('acc_10m')}`, run: () => api.invoke('host:expiry', { sid, duration: '10m' }) },
    '-',
    { label: g.muted ? t('unmute') : t('mute'), icon: g.muted ? 'mic' : 'micoff', run: () => api.invoke('host:mute', { sid, on: !g.muted }) },
    { label: g.chatMuted ? t('chat_unmute') : t('chat_mute'), icon: 'chat', run: () => api.invoke('host:chatmute', { sid, on: !g.chatMuted }) },
    { label: t('clip_send'), icon: 'copy', run: async () => { await api.invoke('clip:send-guest', sid); toast(t('clip_sent')); } },
    { label: `${t('their_volume')}: ${t('vol_low')}`, run: () => setVoiceGain(S.host.guests.indexOf(g) + 1, 0.5) },
    { label: `${t('their_volume')}: ${t('vol_normal')}`, run: () => setVoiceGain(S.host.guests.indexOf(g) + 1, 1) },
    { label: `${t('their_volume')}: ${t('vol_high')}`, run: () => setVoiceGain(S.host.guests.indexOf(g) + 1, 1.8) },
    ...(S.host.hotseat?.on ? [{ label: t('pass_next'), icon: 'swap', run: () => api.invoke('host:pass', sid) }] : []),
    { label: `${t('safety')}: ${g.safety}`, icon: 'shield', run: () => {} },
    '-',
    { label: t('kick'), icon: 'door', bad: true, run: () => api.invoke('host:kick', { sid }) },
    { label: t('kick_block'), bad: true, run: () => api.invoke('host:kick', { sid, block: true }) },
  ]);
}

async function pickWindow() {
  modal(`<div class="dialog picker"><div class="dh"><h3>${t('pick_source')}</h3><div class="sub" style="margin-top:4px">${t('privacy_note')}</div></div>
    <div class="ptabs seg" id="ptabs"><button data-k="window" class="on">${t('tab_windows')}</button><button data-k="screen">${t('tab_screens')}</button></div>
    <div class="db scroll pgrid" id="pgrid"><div class="sub">…</div></div>
    <div class="df"><button class="btn ghost" id="prefresh">${icon('refresh', 15)}<span>${t('refresh')}</span></button><span style="flex:1"></span><button class="btn ghost" id="x">${t('cancel')}</button><button class="btn primary" id="pgo" disabled>${t('go_live')}</button></div></div>`, async (L, close) => {
    let list = [], tab = 'window', pick = null;
    const draw = () => {
      const items = list.filter((s) => s.kind === tab);
      $('#pgrid', L).innerHTML = items.length ? items.map((s, i) => `<button class="pcard ${pick === s ? 'on' : ''}" data-i="${list.indexOf(s)}">
          <div class="pthumb">${s.thumb ? `<img src="${s.thumb}" alt="">` : icon(s.kind === 'screen' ? 'monitor' : 'window', 30)}</div>
          <div class="pname">${s.icon ? `<img class="picon" src="${s.icon}" alt="">` : ''}<span>${esc(s.kind === 'screen' ? `${t('source_display', { n: s.index + 1 })}${s.res ? ` · ${s.res}` : ''}` : s.name)}</span></div>
        </button>`).join('') : `<div class="empty">—</div>`;
      $$('.pcard', L).forEach((b) => (b.onclick = () => { pick = list[+b.dataset.i]; $('#pgo', L).disabled = false; draw(); }));
      $$('.pcard', L).forEach((b) => (b.ondblclick = () => go()));
    };
    const load = async () => { list = await api.invoke('sources'); if (pick) pick = list.find((s) => s.kind === pick.kind && (s.hwnd === pick.hwnd && s.index === pick.index)) || null; draw(); };
    const go = async () => {
      if (!pick) return;
      close();
      if (pick.kind === 'window') await api.invoke('host:source', { kind: 'window', hwnd: pick.hwnd, title: pick.name });
      else await api.invoke('host:source', { kind: 'display', index: pick.index });
      await refresh();
    };
    $$('#ptabs button', L).forEach((b) => (b.onclick = () => { tab = b.dataset.k; $$('#ptabs button', L).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#prefresh', L).onclick = load;
    $('#x', L).onclick = close;
    $('#pgo', L).onclick = go;
    load();
  });
}

async function pickWindowOld() {
  const list = await api.invoke('windows');
  modal(`<div class="dialog" style="width:520px"><div class="dh"><h3>${t('pick_window')}</h3><div class="sub" style="margin-top:4px">${t('privacy_note')}</div></div>
    <div class="db scroll" style="max-height:380px;overflow:auto;gap:2px">${list.map((w) => `<button class="btn ghost" style="justify-content:flex-start;height:auto;padding:9px 10px" data-h="${w.hwnd}" data-t="${esc(w.title)}">${icon('window', 16)}<span style="flex:1;text-align:start;overflow:hidden;text-overflow:ellipsis">${esc(w.title)}</span><span class="sub mono">${esc(w.exe)}</span></button>`).join('')}</div>
    <div class="df"><button class="btn ghost" id="x">${t('cancel')}</button></div></div>`, (L, close) => {
    $('#x', L).onclick = () => { close(); render(); };
    $$('[data-h]', L).forEach((b) => (b.onclick = async () => { close(); await api.invoke('host:source', { kind: 'window', hwnd: +b.dataset.h, title: b.dataset.t }); await refresh(); }));
  });
}

function patchRoom() {
  if (S.view !== 'room') return;
  if (roomSig() !== lastRoomSig) { if (!document.activeElement?.matches('select, input')) render(); return; }
  if (S.host?.mode === 'watch') { watchUI().tickWatchRoom(); return; }
  const h = S.host;
  $('#upnow') && ($('#upnow').textContent = fmtMbps(h.upKbps));
  $('#sum') && ($('#sum').textContent = h.tiers?.play ? streamSummary(h.tiers.play) : '');
  for (const g of h.guests || []) {
    const c = $(`.gcard[data-sid="${g.sid}"]`); if (!c) continue;
    const r = c.querySelector('[data-f="rtt"]'); r.textContent = `${g.rtt || '—'} ms`; r.className = `ping ${pingCls(g.rtt)}`;
    c.querySelector('[data-f="path"]').textContent = pathLabel(g.path);
    c.classList.toggle('speaking', !!g.speaking);
  }
  drawSpark();
}

function drawSpark() {
  const c = $('#spark'); if (!c) return;
  const x = c.getContext('2d');
  const W = c.width, H = c.height, d = S.upHist;
  x.clearRect(0, 0, W, H);
  if (d.length < 2) return;
  const max = Math.max(5000, ...d) * 1.15;
  const css = getComputedStyle(document.documentElement);
  x.strokeStyle = css.getPropertyValue('--line-2'); x.lineWidth = 1;
  for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(0, (H / 3) * i); x.lineTo(W, (H / 3) * i); x.stroke(); }
  x.beginPath();
  d.forEach((v, i) => { const px = (i / (d.length - 1)) * W, py = H - (v / max) * H; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.strokeStyle = css.getPropertyValue('--acc'); x.lineWidth = 2; x.stroke();
  x.lineTo(W, H); x.lineTo(0, H); x.closePath();
  x.fillStyle = css.getPropertyValue('--acc-soft'); x.fill();
}

// ------------------------------------------------------------------------- knock dialog
function knockDialog(k) {
  const role0 = S.st.settings.defaultRole || 'pad';
  modal(`<div class="dialog">
      <div class="timer" style="animation-duration:${Math.max(1, 60 - (Date.now() - k.at) / 1000)}s"></div>
      <div class="dh"><div class="sub">${t('knock_title')}</div></div>
      <div class="db">
        <div class="who">${avatar(k.name, k.from)}<div><div class="nm">${esc(k.name)}</div><div class="mono muted">${fmtId(k.from)}</div></div></div>
        <div style="display:flex;gap:6px">${k.known ? `<span class="tag ok">${t('knock_known')}</span>` : `<span class="tag">${t('knock_new')}</span>`}${k.viaCode ? `<span class="tag acc">${t('knock_code')}</span>` : ''}</div>
        ${k.keyChanged ? `<div class="warnbox">${t('key_changed')}</div>` : ''}
        <div class="field"><label>${t('as_role')}</label><div class="seg" id="krole">${['watch', 'pad', 'kbm', 'full'].map((r) => `<button data-v="${r}" class="${r === role0 ? 'on' : ''}">${t(`role_${r}`)}</button>`).join('')}</div></div>
        <div class="field"><label>${t('access')}</label><div class="seg" id="kdur">${['session', '1h', '10m'].map((d, i) => `<button data-v="${d}" class="${i === 0 ? 'on' : ''}">${t(`acc_${d}`)}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="ktrust" ${k.keyChanged ? 'disabled' : ''}>${t('trust_always')}</label>
      </div>
      <div class="df"><button class="btn ghost" id="kno">${t('decline')}</button><button class="btn primary" id="kyes">${t('let_in')}</button></div>
    </div>`, (L, close) => {
    const pick = (id) => $(`#${id} button.on`, L).dataset.v;
    $$('.seg button', L).forEach((b) => (b.onclick = () => { $$('button', b.parentElement).forEach((x) => x.classList.remove('on')); b.classList.add('on'); }));
    $('#kno', L).onclick = () => { api.invoke('host:decide', { sid: k.sid, accept: false }); close(); };
    $('#kyes', L).onclick = () => { api.invoke('host:decide', { sid: k.sid, accept: true, role: pick('krole'), duration: pick('kdur'), trust: $('#ktrust', L).checked }); close(); };
    S.knockClose = { sid: k.sid, close };
  });
}

// ========================================================================= NETWORK
function viewNet() {
  const c = S.check;
  const set_ = S.st.settings;
  const head = `<div class="page-head"><h1>${t('net_title')}</h1><span class="sp"></span>
    <label class="sub">${t('conn_override')}</label>
    <select class="input" id="ctype" style="width:auto">${['auto', 'fiber', '5g', '4g', 'wifi'].map((v) => `<option value="${v}" ${set_.connType === v ? 'selected' : ''}>${t(`conn_${v}`)}</option>`).join('')}</select>
    <button class="btn primary" id="runcheck" ${S.checking ? 'disabled' : ''}>${S.checking ? `<span class="pulse"></span>${t('net_checking')}` : `${icon('refresh', 16)}<span>${t('net_check')}</span>`}</button></div>`;
  if (!c) return `${head}<div class="empty">${t('net_never')}</div>${peakBlock()}`;
  const best = c.relays[0];
  const cell = (k, v) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const wifi = c.wifi ? `${esc(c.wifi.band || '')}<small>${c.wifi.signal}%</small>` : '—';
  return `${head}
    <div class="netgrid">
      ${cell(t('conn_type'), `${t(`link_${c.link}`)}${c.wan !== 'unknown' ? `<small>${t(`wan_${c.wan}`)}</small>` : ''}`)}
      ${cell(t('upload'), c.upload ? `<span class="mono">${c.upload.capped ? '≥' : ''}${c.upload.mbps.toFixed(1)}</span><small>${t('mbps')}</small>` : '—')}
      ${cell(t('relay_best'), best?.best != null ? `<span class="mono">${best.best.toFixed(1)}</span><small>${t('ms')} · ${esc(relayName(best.label))}</small>` : '—')}
      ${cell(t('jitter'), c.jitter != null ? `<span class="mono">${c.jitter.toFixed(1)}</span><small>${t('ms')}</small>` : '—')}
      ${cell(t('ipv6'), c.v6 ? t('yes') : t('no'))}
      ${cell(t('cgnat'), c.cgnat == null ? t('cgnat_unk') : c.cgnat ? t('cgnat_yes') : t('cgnat_no'))}
      ${cell(t('router'), c.router ? esc(c.router.model || c.router.friendly || '—') : '—')}
      ${cell(t('data_today'), `<span class="mono">${fmtBytes(S.st.usage?.today)}</span><small>${t('data_month')}: ${fmtBytes(S.st.usage?.month)}</small>`)}
      ${cell(t('rec_bitrate'), c.recBitrate ? `<span class="mono">${c.recBitrate}</span><small>${t('mbps')}</small>` : '—')}
    </div>
    <div class="two">
      <section>
        <h2>${t('tips')}</h2>
        ${c.tips.length ? `<ol class="tips">${c.tips.map((k) => `<li><div>${t(`tip_${k}`)}${tipAction(k)}</div></li>`).join('')}</ol>` : `<div class="empty">—</div>`}
      </section>
      <section>
        <h2>${t('relays')}</h2>
        <table class="t"><thead><tr><th></th><th class="n">${t('relay_best')}</th><th class="n">${t('jitter')}</th><th class="n">${t('loss')}</th><th style="width:30%"></th></tr></thead><tbody>
          ${c.relays.map((r) => `<tr><td>${esc(relayName(r.label))} <span class="sub mono">${r.fam}</span></td><td class="n">${r.best != null ? r.best.toFixed(1) : '—'}</td><td class="n">${r.jitter.toFixed(1)}</td><td class="n">${Math.round(r.loss * 100)}%</td><td><div class="bar"><i style="width:${r.best != null ? Math.max(4, 100 - r.best) : 0}%"></i></div></td></tr>`).join('')}
        </tbody></table>
        ${peakBlock()}
      </section>
    </div>`;
}

function tipAction(k) {
  if (k === 'stability') return `<div class="act"><button class="btn sm" data-tip="stability">${t('do_stability')}</button></div>`;
  if (k === 'bandLock') return `<div class="act"><button class="btn sm" data-tip="bandLock">${icon('router', 15)}<span>${t('do_bandlock')}</span></button></div>`;
  return '';
}

function peakBlock() {
  const peaks = S.st.peaks || {};
  const has = Object.keys(peaks).length > 0;
  const days = t('days');
  let rows = '';
  for (let d = 0; d < 7; d++) {
    rows += `<div>${days[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const p = peaks[`${d}-${h}`];
      const v = p ? Math.min(1, p.events) : 0;
      rows += `<div class="c" title="${days[d]} ${h}:00${p ? ` · ${p.mbps.toFixed(1)} Mbps` : ''}" style="${p ? `background:color-mix(in srgb, var(--acc) ${Math.round(18 + v * 70)}%, var(--bg-2))` : ''}"></div>`;
    }
  }
  return `<div style="margin-top:30px"><h2 style="margin-bottom:2px">${t('peak_title')}</h2><div class="sub">${has ? t('peak_sub') : t('peak_empty')}</div>
    <div class="heat"><div></div>${Array.from({ length: 24 }, (_, h) => `<div class="hl">${h % 6 === 0 ? h : ''}</div>`).join('')}${rows}</div></div>`;
}

function mountNet() {
  $('#runcheck').onclick = runCheck;
  $('#ctype').onchange = (e) => set({ connType: e.target.value });
  $$('[data-tip]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.tip === 'stability') { await set({ stability: 'on' }); toast(t('stability')); }
    if (b.dataset.tip === 'bandLock') api.invoke('routerlock');
  }));
}

async function runCheck() {
  S.checking = true; render();
  try { S.check = await api.invoke('netcheck', {}); } finally { S.checking = false; }
  if (S.check?.autoType && S.st.settings.connType === 'auto') S.st.settings.detectedType = S.check.autoType;
  render();
}

// ========================================================================= LIBRARY
function viewLib() {
  const games = S.st.games || [];
  return `<div class="page-head"><h1>${t('lib_title')}</h1><span class="sp"></span>
      <button class="btn" id="scan">${icon('refresh', 16)}<span>${t('lib_scan')}</span></button>
      <button class="btn primary" id="addg">${icon('plus', 16)}<span>${t('lib_add')}</span></button></div>
    ${games.length ? `<div class="covers">${games.map((g) => `<div class="cover ${g.visible ? '' : 'hidden'}" data-id="${esc(g.id)}">
        <div class="art">${g.cover ? `<img src="file:///${esc(g.cover.replace(/\\/g, '/'))}" alt="" loading="lazy">` : `<div class="ph">${esc(g.name.slice(0, 2))}</div>`}</div>
        <div class="play">${icon('bolt', 26)}</div>
        <div class="nm"><span title="${esc(g.name)}">${esc(g.name)}</span><button class="iconbtn" data-act="vis" title="${g.visible ? t('lib_visible') : t('lib_hidden')}">${icon(g.visible ? 'eye' : 'eyeoff', 16)}</button></div>
      </div>`).join('')}</div>` : `<div class="empty">${t('lib_empty')}</div>`}`;
}

function mountLib() {
  $('#scan').onclick = async () => { S.st.games = await api.invoke('games:scan'); render(); };
  $('#addg').onclick = async () => { S.st.games = await api.invoke('games:add'); render(); };
  $$('.cover').forEach((c) => {
    const id = c.dataset.id;
    c.querySelector('.art').onclick = async () => { await api.invoke('games:launch', id); };
    c.querySelector('[data-act="vis"]').onclick = async () => {
      const games = S.st.games.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g));
      S.st.games = await api.invoke('games:update', games); render();
    };
    c.oncontextmenu = (e) => menu(e.clientX, e.clientY, [{ label: t('f_remove'), bad: true, run: async () => { S.st.games = await api.invoke('games:update', S.st.games.filter((g) => g.id !== id)); render(); } }]);
  });
}

// ========================================================================= SETTINGS
function viewSettings() {
  const s = S.st.settings;
  const helper = S.st.helper;
  const row = (label, ctl, sub) => `<div class="prow"><div class="lbl"><div>${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${ctl}</div>`;
  const sw = (k) => `<button class="switch ${s[k] ? 'on' : ''}" data-k="${k}"></button>`;
  const key = (k) => `<span class="keycap" data-key="${k}">${esc(shortKey(s[k]))}</span>`;
  return `<div class="page-head"><h1>${t('set_title')}</h1></div>
  <div class="settings">
    <section class="sgroup"><h2>${t('set_identity')}</h2><div class="rows">
      <div class="field"><label>${t('nick')}</label><input class="input" data-s="nick" value="${esc(s.nick)}" placeholder="${t('nick_hint')}"></div>
      ${row(`<span class="mono" style="font-size:16px">${fmtId(S.st.id)}</span>`, `<button class="btn sm danger" id="newid">${t('new_identity')}</button>`, t('new_identity_sub'))}
    </div></section>

    <section class="sgroup"><h2>${t('set_server')}</h2><div class="rows">
      <div class="field"><label>${t('server')}</label><input class="input mono" data-s="server" value="${esc(s.server)}" placeholder="${s.builtInServer ? t('server_builtin') : t('server_hint')}"></div>
      ${s.builtInServer ? `<div class="sub">${icon('shield', 13)} ${t('builtin_note')}</div>` : `<div class="field"><label>${t('access_key')}</label><input class="input mono" type="password" data-s="accessKey" value="${esc(s.accessKey)}"><div class="sub">${t('access_key_sub')}</div></div>`}
      <div class="field"><label>${t('server_ws')}</label><input class="input mono" data-s="serverWs" value="${esc(s.serverWs)}" placeholder="wss://majlis.example.com/signal"></div>
      <div class="field"><label>${t('invite_base')}</label><input class="input mono" data-s="inviteBase" value="${esc(s.inviteBase)}" placeholder="https://majlis.example.com"></div>
    </div></section>

    <section class="sgroup"><h2>${t('set_stream')}</h2><div class="rows">
      ${row(t('encoders'), `<span class="mono sub">${S.st.encoders.length ? esc(S.st.encoders.join('  ')) : t('none_found')}</span>`)}
      <div class="field"><label>${t('ffmpeg')}</label><div style="display:flex;gap:8px"><input class="input mono" style="flex:1" data-s="ffmpeg" value="${esc(s.ffmpeg)}" placeholder="ffmpeg"><button class="btn" id="pickff">${t('browse')}</button></div></div>
      ${row(t('spectator_q'), `<div class="seg" id="sq">${[0.25, 0.35, 0.5].map((v) => `<button data-v="${v}" class="${s.spectatorQuality === v ? 'on' : ''}">${Math.round(v * 100)}%</button>`).join('')}</div>`)}
      ${row(t('no_vsync'), sw('noVsync'), t('no_vsync_sub'))}
      ${row(t('mouse_sens'), `<input type="range" min="0.3" max="3" step="0.05" value="${s.mouseSens ?? 1}" data-num="mouseSens" style="width:180px"><span class="mono sub" style="min-width:40px">${(s.mouseSens ?? 1).toFixed(2)}×</span>`)}
      ${row(t('pad_dz'), `<input type="range" min="0" max="0.3" step="0.01" value="${s.padDeadzone ?? 0.08}" data-num="padDeadzone" style="width:180px"><span class="mono sub" style="min-width:40px">${Math.round((s.padDeadzone ?? 0.08) * 100)}%</span>`)}
      ${row(t('pad_swap'), sw('padSwapAB'), t('pad_swap_sub'))}
      ${row(t('default_role'), `<select class="input" data-s="defaultRole" style="width:auto">${['watch', 'pad', 'kbm', 'full'].map((r) => `<option value="${r}" ${s.defaultRole === r ? 'selected' : ''}>${t(`role_${r}`)}</option>`).join('')}</select>`)}
    </div></section>

    <section class="sgroup"><h2>${t('set_pads')}</h2><div class="rows">
      ${helper?.vigem ? `<div class="prow"><i class="dot ok"></i><div class="lbl">${t('vigem_ok')}</div></div>` : `<div class="prow"><i class="dot warn"></i><div class="lbl">${t('vigem_missing')}</div><button class="btn sm" id="vigem">${t('vigem_get')}</button></div>`}
    </div></section>

    <section class="sgroup"><h2>${t('set_voice')}</h2><div class="rows">
      ${row(t('voice'), `<div class="seg" id="vmode">${['off', 'ptt', 'open'].map((v) => `<button data-v="${v}" class="${s.voice === v ? 'on' : ''}">${t(`voice_${v}`)}</button>`).join('')}</div>`)}
      ${row(t('ptt_key'), key('pttKey'), t('ptt_sub'))}
      ${row(t('knock_sound'), sw('knockSound'))}
    </div></section>

    <section class="sgroup"><h2>${t('set_keys')}</h2><div class="rows">
      ${row(t('panic_key'), key('panicKey'))}
      ${row(t('overlay_key'), key('overlayKey'))}
      ${row(t('replay_key'), key('replayKey'))}
    </div></section>

    <section class="sgroup"><h2>${t('set_privacy')}</h2><div class="rows">
      ${row(t('share_status'), sw('shareStatus'), t('share_status_sub'))}
      ${row(t('accept_codes'), sw('acceptCodes'), t('temp_code_hint'))}
    </div></section>

    <section class="sgroup"><h2>${t('set_look')}</h2><div class="rows">
      ${row(t('theme'), `<div class="seg" id="theme"><button data-v="dark" class="${s.theme === 'dark' ? 'on' : ''}">${t('theme_dark')}</button><button data-v="light" class="${s.theme === 'light' ? 'on' : ''}">${t('theme_light')}</button></div>`)}
      ${row(t('lang'), `<div class="seg" id="lang"><button data-v="ar" class="${s.lang === 'ar' ? 'on' : ''}">العربية</button><button data-v="en" class="${s.lang === 'en' ? 'on' : ''}">English</button></div>`)}
    </div></section>

    <section class="sgroup"><h2>${t('set_integr')}</h2><div class="rows">
      ${row(t('routerlock'), `<span class="tag ${S.st.routerLock ? 'ok' : ''}">${S.st.routerLock ? t('routerlock_found') : t('routerlock_missing')}</span><button class="btn sm" id="rl">${t('routerlock_open')}</button>`, S.st.routerLock ? `<span class="mono">${esc(S.st.routerLock)}</span>` : '')}
    </div></section>

    <section class="sgroup"><h2>${t('diag')}</h2><div class="rows">
      <div class="prow"><div class="lbl"><div>${t('diag_log')}</div><div class="sub">${t('diag_sub')}</div></div><button class="btn sm" id="openlogs">${t('open_folder')}</button></div>
    </div></section>

    <section class="sgroup"><h2>${t('about')}</h2><div class="rows"><div class="sub" style="line-height:1.8">${t('about_text')}<br><span class="mono">v${esc(S.st.version)}</span></div></div></section>
  </div>`;
}

function mountSettings() {
  const s = S.st.settings;
  $$('[data-s]').forEach((el) => (el.onchange = () => set({ [el.dataset.s]: el.value.trim() })));
  $$('.switch[data-k]').forEach((b) => (b.onclick = async () => { await set({ [b.dataset.k]: !s[b.dataset.k] }); render(); }));
  const seg = (id, k, num) => $$(`#${id} button`).forEach((b) => (b.onclick = async () => { await set({ [k]: num ? +b.dataset.v : b.dataset.v }); applyLook(); render(); renderRail(); }));
  seg('vmode', 'voice'); seg('theme', 'theme'); seg('lang', 'lang'); seg('sq', 'spectatorQuality', true);
  $('#newid').onclick = () => { if (confirm(t('confirm_new_id'))) api.invoke('identity:new'); };
  $('#pickff').onclick = async () => { const p = await api.invoke('pick:file', [{ name: 'ffmpeg', extensions: ['exe'] }]); if (p) { await set({ ffmpeg: p }); render(); } };
  $('#vigem') && ($('#vigem').onclick = () => api.invoke('vigem'));
  $('#rl').onclick = () => api.invoke('routerlock');
  $('#openlogs').onclick = () => api.invoke('logs');
  $$('[data-num]').forEach((r) => {
    r.oninput = () => { r.nextElementSibling.textContent = r.dataset.num === 'padDeadzone' ? `${Math.round(r.value * 100)}%` : `${(+r.value).toFixed(2)}×`; S.st.settings[r.dataset.num] = +r.value; };
    r.onchange = () => set({ [r.dataset.num]: +r.value });
  });
  $('.switch[data-k="noVsync"]') && $('.switch[data-k="noVsync"]').addEventListener('click', () => toast(t('restart_note')));
  $$('.keycap').forEach((k) => (k.onclick = () => {
    $$('.keycap').forEach((x) => x.classList.remove('rec'));
    k.classList.add('rec'); k.textContent = t('press_key');
    if (k.dataset.key === 'pttKey') {
      const onMouse = async (e) => { if (e.button < 1) return; e.preventDefault(); window.removeEventListener('mousedown', onMouse, true); S.recKey = null; await set({ pttKey: `Mouse${e.button + 1}` }); render(); };
      setTimeout(() => window.addEventListener('mousedown', onMouse, true), 0);
    }
    S.recKey = async (e) => {
      e.preventDefault();
      const name = k.dataset.key === 'pttKey' ? e.code : accelFrom(e);
      if (!name) return;
      S.recKey = null; await set({ [k.dataset.key]: name }); render();
    };
  }));
}

function applyLook() {
  const s = S.st.settings;
  document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
  setLang(s.lang);
  $$('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
}

// ========================================================================= STAGE (guest)
function openStage(info) {
  if (S.player) { S.player.destroy(); S.player = null; }
  S.connect = { state: 'idle', target: '' };
  const stage = $('#stage');
  stage.hidden = false;
  if (!info.local) S.ctrl = { roster: null, role: null, slot: null, library: null, host: info.host, safety: info.safety, keyChanged: info.keyChanged, mode: 'play' };
  $('#stageWait').innerHTML = `<span class="pulse"></span><span>${t('no_signal')}</span>`;
  $('#stageWait').hidden = false;
  S.player = new Player({
    port: S.port, canvas: $('#screen'), cursorEl: $('#cursor'), stage: $('#stageVideo'), settings: S.st.settings,
    onStats: (p) => { S.pstats = p; updateHud(); if (S.drawer) updateDrawerStats(); },
    onFirstFrame: () => { $('#stageWait').hidden = true; },
  });
  S.player.filterKey = (e, down) => {
    const s = S.st.settings;
    if (watchUI().watchKey(e, down)) { e.preventDefault(); return true; }
    if (down && matchAccel(e, s.overlayKey)) { e.preventDefault(); toggleDrawer(); return true; }
    if (down && e.code === 'F11') { e.preventDefault(); api.invoke('fullscreen'); return true; }
    if (s.voice === 'ptt' && e.code === s.pttKey) { e.preventDefault(); if (!e.repeat) S.player.setMicOpen(down); return true; }
    if (S.drawer && (e.target.closest?.('.drawer'))) return true;
    return false;
  };
  S.player.onSpeak = (idx) => speaking(idx);
  hub(false);
  S.player.setMouseMode('abs');
  if (info.local || S.ctrl.mode === 'watch') watchUI().setupWatchStage();
  setupVoice();
  const pill = document.createElement('div');
  pill.className = 'hint-pill'; pill.textContent = t('overlay_hint', { key: shortKey(S.st.settings.overlayKey) });
  stage.append(pill);
  setTimeout(() => { pill.style.opacity = '0'; setTimeout(() => pill.remove(), 700); }, 3500);
  renderDrawer();
  if (new URLSearchParams(location.search).get('drawer')) setTimeout(() => toggleDrawer(true), 1500);
}

async function setupVoice() {
  const mode = S.st.settings.voice;
  if (mode === 'off' || !S.player) return;
  try {
    await S.player.startMic((b) => S.port.postMessage({ t: 'vo', data: b }));
    S.player.setMicOpen(mode === 'open');
  } catch {}
}

function closeStage(msgKey) {
  if (document.body.classList.contains('mini')) { api.invoke('mini'); document.body.classList.remove('mini'); }
  setTimeout(() => hub((S.host?.guests?.length || 0) > 0), 50);
  watchUI().teardownWatchStage();
  if (S.local) { S.local = false; api.invoke('local:view', false); }
  S.player?.destroy(); S.player = null;
  $('#stage').hidden = true;
  toggleDrawer(false);
  $('#hud').classList.remove('on');
  api.invoke('fullscreen', false);
  if (msgKey) toast(t(msgKey));
  refresh();
}

function toggleDrawer(force) {
  S.drawer = force === undefined ? !S.drawer : force;
  $('#drawer').classList.toggle('open', S.drawer);
  if (S.player) S.player.active = !S.drawer;
  if (S.drawer) { if (document.pointerLockElement) document.exitPointerLock(); S.player?.releaseAll?.(); renderDrawer(); }
}

function renderDrawer() {
  const c = S.ctrl, s = S.st.settings;
  const roleName = c.role ? t(`role_${c.role}`) : '—';
  const isHolder = c.roster?.list?.find((r) => r.idx === c.roster.you)?.baton;
  const me = c.roster?.list?.find((r) => r.idx === c.roster?.you);
  $('#drawer').innerHTML = `
    <div class="dtop">${mark(20).replace('<svg', '<svg style="color:var(--acc)"')}<span class="nm">${esc(c.host?.nick || fmtId(c.host?.id))}</span><button class="iconbtn" id="dclose">${icon('x', 17)}</button></div>
    <div class="dsec">
      <h2>${t('lat_total')}</h2>
      <div class="bigms" id="dtotal">—<small>ms</small></div>
      <div class="latbar" id="dbar"></div>
      <div class="latlegend" id="dleg"></div>
      <dl class="kv" style="margin-top:14px" id="dkv"></dl>
    </div>
    <div class="dsec">
      <h2>${t('players')} <span class="tag" style="margin-inline-start:6px">${t('your_role', { role: roleName })}</span></h2>
      <div class="roster">${(c.roster?.list || []).map((r) => `<div class="rr">${avatar(r.name, String(r.idx) + '00')}<span class="nm">${esc(r.name)}${r.idx === c.roster.you ? ` · ${t('you')}` : ''}</span>${r.slot ? `<span class="tag">${t('slot', { n: r.slot })}</span>` : `<span class="tag">${t('role_watch')}</span>`}${r.baton ? `<span class="baton">${icon('pad', 14)}</span>` : ''}${r.hand ? `<span class="baton">${icon('hand', 14)}</span>` : ''}${r.idx !== c.roster.you ? `<input type="range" class="pvol" min="0" max="2" step="0.1" value="${S.voiceGains[r.idx] ?? 1}" data-idx="${r.idx}" title="${t('their_volume')}">` : ''}</div>`).join('')}${c.roster ? `<div class="rr"><span class="avatar" style="width:24px;height:24px;font-size:11px;background:var(--bg-3)">${icon('star', 12)}</span><span class="nm">${esc(c.roster.host || c.host?.nick || '')}</span><span class="tag">${t('host_tag')}</span><input type="range" class="pvol" min="0" max="2" step="0.1" value="${S.voiceGains[0] ?? 1}" data-idx="0"></div>` : ''}</div>
      ${c.roster?.hotseat ? `<div style="display:flex;gap:6px;margin-top:12px">${isHolder ? `<button class="btn sm" id="dpass">${icon('swap', 15)}<span>${t('pass_next')}</span></button>` : `<button class="btn sm" id="dhand">${icon('hand', 15)}<span>${me?.hand ? t('lower_hand') : t('raise_hand')}</span></button>`}</div>` : (c.role === 'watch' ? `<div style="margin-top:12px"><button class="btn sm" id="dhand">${icon('hand', 15)}<span>${me?.hand ? t('lower_hand') : t('raise_hand')}</span></button></div>` : '')}
    </div>
    <div class="dsec">
      <h2>${t('voice')}</h2>
      <div class="seg" id="dvoice">${['off', 'ptt', 'open'].map((v) => `<button data-v="${v}" class="${s.voice === v ? 'on' : ''}">${t(`voice_${v}`)}</button>`).join('')}</div>
      <div class="field" style="margin-top:12px"><label>${t('game_vol')}</label><input type="range" min="0" max="1" step="0.05" value="${s.gameVol ?? 1}" id="gv"></div>
      <div class="field"><label>${t('voice_vol')}</label><input type="range" min="0" max="1.5" step="0.05" value="${s.voiceVol ?? 1}" id="vv"></div>
      <div class="field"><label>${t('av_offset')} <span class="mono" id="avv">${s.avOffset || 0} ms</span></label><input type="range" min="-300" max="300" step="10" value="${s.avOffset || 0}" id="avo"><div class="sub">${t('av_offset_sub')}</div></div>
    </div>
    <div class="dsec stack">
      <h2>${t('lat_graph')}</h2>
      <canvas class="spark" id="dgraph" width="600" height="90"></canvas>
      <div class="prow tight"><div class="lbl"><div>${t('data_saver')}</div><div class="sub">${t('data_saver_sub')}</div></div><button class="switch ${s.dataSaver ? 'on' : ''}" id="dsaver"></button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="dmini">${icon('window', 15)}<span>${t('mini')}</span></button>${['kbm', 'full'].includes(c.role) ? `<button class="btn sm" id="dclip">${icon('copy', 15)}<span>${t('clip_to_host')}</span></button>` : ''}</div>
    </div>
    ${c.role === 'full' ? `<div class="dsec"><h2>${t('library')}</h2><div class="minicovers" id="dlib">${(c.library || []).map((g) => `<div class="mc" data-id="${esc(g.id)}" title="${esc(g.name)}">${g.cover ? `<img src="data:image/jpeg;base64,${g.cover}" alt="">` : esc(g.name)}</div>`).join('') || `<span class="sub">…</span>`}</div></div>` : ''}
    <div class="dsec stack">
      <div class="prow tight"><div class="lbl">${t('mouse_lock')}</div><button class="switch ${S.player?.mouseMode === 'rel' ? 'on' : ''}" id="dlock"></button></div>
      <div class="prow tight"><div class="lbl">${t('gyro')}</div><button class="btn sm" id="dgyro">${S.player?.hid ? t('gyro_on') : 'DualSense'}</button></div>
      <div class="prow tight"><div class="lbl">HUD</div><button class="switch ${$('#hud').classList.contains('on') ? 'on' : ''}" id="dhud"></button></div>
    </div>
    <div class="dsec">
      <h2>${t('safety')}</h2>
      <div class="safety">${esc(c.safety || '')}</div>
      <div class="sub" style="margin-top:4px">${t('safety_sub')}</div>
      ${c.keyChanged ? `<div class="warnbox" style="margin-top:10px;background:var(--bad-soft);color:var(--bad);padding:8px 10px;border-radius:5px;font-size:12.5px">${t('key_changed')}</div>` : ''}
    </div>
    <div class="dsec">
      <h2>${t('chat')}</h2>
      <div class="chatlist compact" id="schatlist">${S.chat.slice(-40).map((c) => `<div class="cmsg"><b>${esc(c.from || '·')}</b><span>${esc(c.text)}</span></div>`).join('')}</div>
      ${S.ctrl.perms?.chat === false ? `<div class="sub" style="margin-top:8px">${t('chat_off_note')}</div>` : `<form class="chatin" data-chat="dchat" style="margin-top:8px"><input class="input" maxlength="300" placeholder="${t('chat_ph')}" autocomplete="off"><button class="btn sm" type="submit">${t('send')}</button></form>`}
    </div>
    <div class="dsec" style="display:flex;gap:8px;border:0">
      <button class="btn" id="dshot">${icon('camera', 16)}<span>${t('shot')}</span></button>
      <button class="btn" id="dfull">${icon('full', 16)}<span>${t('fullscreen')}</span></button>
      <span style="flex:1"></span>
      <button class="btn danger" id="dleave">${icon('door', 16)}<span>${t('leave')}</span></button>
    </div>`;
  const D = $('#drawer');
  $('#dclose', D).onclick = () => toggleDrawer(false);
  $('#dleave', D).onclick = () => { api.invoke('leave'); closeStage(); };
  $('#dfull', D).onclick = () => api.invoke('fullscreen');
  $('#dshot', D).onclick = async () => { const u = S.player?.screenshot(); if (!u) return; const f = await api.invoke('shot', u); if (f) toast(t('shot_saved'), { action: t('open_folder'), onAction: () => api.invoke('show-file', f) }); };
  const cf = $('[data-chat="dchat"]', D);
  if (cf) cf.onsubmit = (e) => { e.preventDefault(); const i = cf.querySelector('input'); const v = i.value.trim(); if (v) { api.invoke('guest:ctrl', { t: 'chat', text: v }); i.value = ''; } };
  const cl = $('#schatlist', D); cl.scrollTop = cl.scrollHeight;
  $('#dlock', D).onclick = () => { S.player?.setMouseMode(S.player.mouseMode === 'rel' ? 'abs' : 'rel'); renderDrawer(); };
  $('#dgyro', D).onclick = async () => { try { await S.player?.enableGyro(); } catch {} renderDrawer(); };
  $('#dhud', D).onclick = () => { $('#hud').classList.toggle('on'); renderDrawer(); updateHud(); };
  $('#dhand', D) && ($('#dhand', D).onclick = () => api.invoke('guest:ctrl', { t: 'hand', on: !me?.hand }));
  $('#dpass', D) && ($('#dpass', D).onclick = () => api.invoke('guest:ctrl', { t: 'pass' }));
  $$('#dvoice button', D).forEach((b) => (b.onclick = async () => { await set({ voice: b.dataset.v }); if (b.dataset.v === 'off') S.player?.stopMic(); else { await setupVoice(); S.player?.setMicOpen(b.dataset.v === 'open'); } renderDrawer(); }));
  $('#gv', D).oninput = (e) => { S.st.settings.gameVol = +e.target.value; S.player?.setVolumes(+e.target.value, S.st.settings.voiceVol ?? 1); };
  $('#vv', D).oninput = (e) => { S.st.settings.voiceVol = +e.target.value; S.player?.setVolumes(S.st.settings.gameVol ?? 1, +e.target.value); };
  $('#gv', D).onchange = () => set({ gameVol: S.st.settings.gameVol });
  $('#avo', D).oninput = (e) => { S.st.settings.avOffset = +e.target.value; $('#avv', D).textContent = `${e.target.value} ms`; };
  $('#avo', D).onchange = () => set({ avOffset: S.st.settings.avOffset });
  $('#dsaver', D).onclick = async () => { const on = !S.st.settings.dataSaver; S.st.settings.dataSaver = on; await api.invoke('datasaver', on); renderDrawer(); };
  $('#dmini', D).onclick = async () => { const on = await api.invoke('mini'); toggleDrawer(false); document.body.classList.toggle('mini', on); };
  $('#dclip', D) && ($('#dclip', D).onclick = async () => { await api.invoke('clip:send-host'); toast(t('clip_sent')); });
  $$('.pvol', D).forEach((r) => (r.oninput = () => setVoiceGain(+r.dataset.idx, +r.value)));
  $$('#dlib .mc', D).forEach((m) => (m.onclick = () => api.invoke('guest:ctrl', { t: 'launch', id: m.dataset.id })));
  if (c.role === 'full' && !c.library) { c.library = []; api.invoke('guest:ctrl', { t: 'library' }); }
  updateDrawerStats();
}

function latParts() {
  const p = S.pstats || {}, g = S.gstats || {};
  const enc = p.enc || 0, net = p.net || (g.rtt ? g.rtt / 2 : 0), dec = p.dec || 0, disp = p.disp || 0;
  return { enc, net, dec, disp, total: enc + net + dec + disp };
}

function updateDrawerStats() {
  const l0 = latParts();
  if (l0.total) { S.latHist.push(l0.total); if (S.latHist.length > 120) S.latHist.shift(); }
  const D = $('#drawer'); if (!S.drawer || !D) return;
  const l = latParts(), g = S.gstats || {};
  drawGraph($('#dgraph', D), S.latHist);
  const col = { enc: 'var(--fg-3)', net: 'var(--acc)', dec: 'var(--ok)', disp: 'var(--fg-2)' };
  const tot = $('#dtotal', D); if (!tot) return;
  tot.innerHTML = `${l.total ? l.total.toFixed(1) : '—'}<small>ms</small>`;
  $('#dbar', D).innerHTML = ['enc', 'net', 'dec', 'disp'].map((k) => `<i style="flex:${Math.max(0.5, l[k])};background:${col[k]}"></i>`).join('');
  $('#dleg', D).innerHTML = ['enc', 'net', 'dec', 'disp'].map((k) => `<div><span class="sw" style="background:${col[k]}"></span>${t(`lat_${k}`)}<b>${l[k].toFixed(1)}</b></div>`).join('');
  const p = S.pstats || {};
  $('#dkv', D).innerHTML = `
    <dt>${t('path')}</dt><dd>${esc(pathLabel(g.path))}</dd>
    <dt>RTT</dt><dd class="mono">${g.rtt ?? '—'} ms</dd>
    <dt>${t('bitrate')}</dt><dd class="mono">${((g.kbps || 0) / 1000).toFixed(1)} Mbps</dd>
    <dt>${t('loss')}</dt><dd class="mono">${((g.loss || 0) * 100).toFixed(1)}%${g.recovered ? ` · ${t('fec')} ${g.recovered}` : ''}</dd>
    <dt>${t('fps_now')}</dt><dd class="mono">${p.fps || 0}${p.codec ? ` · ${String(p.codec.codec || '').toUpperCase()}` : ''}</dd>`;
}

function updateHud() {
  const hud = $('#hud'); if (!hud.classList.contains('on')) return;
  const l = latParts(), g = S.gstats || {}, p = S.pstats || {};
  hud.textContent = `${l.total.toFixed(1)} ms  enc ${l.enc.toFixed(1)}  net ${l.net.toFixed(1)}  dec ${l.dec.toFixed(1)}\n${((g.kbps || 0) / 1000).toFixed(1)} Mbps  ${p.fps || 0} fps  loss ${((g.loss || 0) * 100).toFixed(1)}%  ${pathLabel(g.path)}`;
}

// ------------------------------------------------------------------------- small helpers
function fmtBytes(b) { b = b || 0; return b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`; }

// two soft notes, so a knock is noticed even when the window is behind a game
function chime() {
  try {
    const ac = new AudioContext(), t0 = ac.currentTime;
    [[659, 0], [880, 0.16]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(0.18, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 0.5);
      o.connect(g).connect(ac.destination); o.start(t0 + d); o.stop(t0 + d + 0.55);
    });
    setTimeout(() => ac.close(), 1200);
  } catch {}
}

function setVoiceGain(idx, g) { S.voiceGains[idx] = g; S.player?.setVoiceGain(idx, g); S.hub?.setGain(idx, g); }

// The host hears friends and talks to them from the room page too, not only inside a stream.
async function hub(want) {
  const s = S.st?.settings || {};
  want = want && !S.player && s.voice !== 'off';
  if (!want) { if (S.hub) { S.hub.destroy(); S.hub = null; } return; }
  if (S.hub) return;
  S.hub = new VoiceHub({ port: S.port, settings: s, onSpeak: (idx) => speaking(idx) });
  await S.hub.ready;
  for (const [i, g] of Object.entries(S.voiceGains)) S.hub.setGain(+i, g);
  try { await S.hub.startMic((b) => S.port.postMessage({ t: 'hvo', data: b })); S.hub.setMicOpen(s.voice === 'open'); } catch {}
}

// who's talking: a name chip over the stream
function speaking(idx) {
  let name = '';
  if (S.player && S.ctrl.roster) name = idx === 0 ? (S.ctrl.roster.host || S.ctrl.host?.nick || '') : (S.ctrl.roster.list.find((r) => r.idx === idx)?.name || '');
  else if (S.host?.guests) name = S.host.guests[idx - 1]?.name || '';
  if (!name || $('#stage').hidden) return;
  let el = $(`.talk[data-i="${idx}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'talk'; el.dataset.i = idx; el.innerHTML = `${icon('mic', 13)}<span>${esc(name)}</span>`; ($('#talkers') || $('#stage').appendChild(Object.assign(document.createElement('div'), { id: 'talkers' }))).append(el); }
  clearTimeout(el._t); el._t = setTimeout(() => el.remove(), 450);
}

function drawGraph(c, data) {
  if (!c) return;
  const x = c.getContext('2d'), W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  if (data.length < 2) return;
  const max = Math.max(40, ...data) * 1.15;
  x.strokeStyle = 'rgba(236,228,214,.12)'; x.lineWidth = 1;
  for (const v of [16, 33, 50, 100]) { if (v > max) break; const y = H - (v / max) * H; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  x.beginPath();
  data.forEach((v, i) => { const px = (i / (data.length - 1)) * W, py = H - (v / max) * H; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.strokeStyle = '#e2a43a'; x.lineWidth = 2; x.stroke();
}

// ------------------------------------------------------------------------- ffmpeg download
function ffmpegStatus(m) {
  let el = $('#fftoast');
  if (m.state === 'missing') return;
  if (!el) { el = document.createElement('div'); el.id = 'fftoast'; el.className = 'toast'; $('#toasts').append(el); }
  if (m.state === 'downloading') el.innerHTML = `<span class="pulse"></span><span>${t('ff_downloading')}</span><span class="mono">${m.pct}%</span>`;
  else if (m.state === 'extracting') el.innerHTML = `<span class="pulse"></span><span>${t('ff_extracting')}</span>`;
  else if (m.state === 'ready') { el.innerHTML = `<span>${t('ff_ready')}</span>`; setTimeout(() => el.remove(), 3500); }
  else if (m.state === 'failed') { el.classList.add('bad'); el.innerHTML = `<span>${t('ff_failed')}</span>`; setTimeout(() => el.remove(), 8000); }
}

// ========================================================================= events
async function refresh() {
  S.st = await api.invoke('state');
  S.host = S.st.host;
  applyLook(); renderRail(); renderStatus();
  if (!(S.view === 'home' && document.activeElement?.matches('#digits input')) && !document.activeElement?.matches('.view input.input')) render();
}

// Events can arrive before the first state load finishes; hold them until it has.
const early = [];
api.on((m) => { if (!S.st) early.push(m); else handleEvent(m); });

function handleEvent(m) {
  switch (m.type) {
    case 'registered': S.st.registered = true; S.st.publicAddr = m.publicAddr; S.st.relays = m.relays; S.via = m.via; renderStatus(); if (S.view === 'home') { const st = $('.idstatus'); if (st) render(); } break;
    case 'id-changed': refresh(); break;
    case 'presence': S.presence = m.on; if (S.view === 'home') { const fl = $('#flist'); if (fl) { fl.innerHTML = friendsList(); wireFriends(); } } break;
    case 'knock-progress': if (m.state === 'waiting' && S.connect.state === 'knocking') { S.connect.state = 'waiting'; renderKnockLine(); } break;
    case 'knock': S.host = S.host || {}; renderRail(); if (S.st.settings.knockSound !== false) chime(); knockDialog(m); if (S.view === 'room') render(); break;
    case 'ptt': if (S.st.settings.voice === 'ptt') { S.player?.setMicOpen(m.down); S.hub?.setMicOpen(m.down); } break;
    case 'clip': toast(t('clip_got', { name: m.from || '' })); break;
    case 'knock-gone': if (S.knockClose?.sid === m.sid) S.knockClose.close(); break;
    case 'host': {
      const prevG = S.host?.guests?.length || 0;
      if (m.movie) m.movie.rx = performance.now();
      setTimeout(() => hub(m.guests.length > 0), 0);
      S.host = m; if (S.st) S.st.host = m;
      S.upHist.push(m.upKbps || 0); if (S.upHist.length > 120) S.upHist.shift();
      renderRail(); renderStatus();
      if (S.view === 'room') patchRoom();
      const hs = JSON.stringify([m.enabled, m.code?.code, m.mode]);
      if (S.view === 'home' && hs !== S.homeSig && !document.activeElement?.matches('#digits input')) render();
      S.homeSig = hs;
      if (prevG === 0 && m.guests?.length && S.view === 'home') go('room');
      break;
    }
    case 'joined': toast(t('joined', { name: m.name })); break;
    case 'left':
      toast(t('left', { name: m.name }));
      if (m.summary && m.summary.ms > 60000) S.summaries.push(m.summary);
      setTimeout(() => { if (!S.host?.guests?.length && S.summaries.length) { watchUI().summary(S.summaries); S.summaries = []; } }, 800);
      break;
    case 'movie': if (S.host) { S.host.movie = { ...m, rx: performance.now() }; if (S.local) watchUI().renderBar(); if (S.view === 'room') patchRoom(); } break;
    case 'chat': watchUI().addChat(m); break;
    case 'react': watchUI().floatReaction(m.r); break;
    case 'countdown': watchUI().countdown(m.ms); break;
    case 'askpause': toast(t('asked_pause', { name: m.name }), { action: t('pause'), onAction: () => api.invoke('movie:ctl', { op: 'pause' }) }); break;
    case 'movie-by': toast(t('by_who', { by: m.by, op: t(`op_${m.op}`) }), { ms: 2200 }); break;
    case 'hand': if (m.on) toast(t('hand_note', { name: m.name }), { action: t('pass_next'), onAction: () => api.invoke('host:pass', m.sid) }); break;
    case 'baton': toast(t('baton_to', { name: m.name })); break;
    case 'panic': toast(t('panic_done')); refresh(); break;
    case 'notice': toast(t(`notice_${m.key}`), { bad: true }); break;
    case 'replay': toast(m.ok ? t('replay_saved') : t('replay_off'), { bad: !m.ok }); break;
    case 'launched': toast(m.by ? t('launched_by', { by: m.by, name: m.name }) : t('launched', { name: m.name })); break;
    case 'encoders': S.st.encoders = m.list; S.st.ffmpeg = true; if (S.view === 'set' || S.view === 'room') render(); break;
    case 'ffmpeg': ffmpegStatus(m); break;
    case 'helper': S.st.helper = m; if (S.view === 'set' || S.view === 'room') render(); break;
    case 'deeplink': go('home'); S.connect.target = m.target; render(); doConnect(m.target); break;
    case 'guest':
      if (m.state === 'reconnecting') { if (S.player) { $('#stageWait').hidden = false; $('#stageWait').innerHTML = `<span class="pulse"></span><span>${t('reconnecting')}</span>`; } break; }
      if (m.state === 'linked') openStage(m);
      else if (m.state === 'failed') { S.connect = { state: 'failed', reason: m.reason, target: m.target }; renderKnockLine(); }
      else if (m.state === 'ended' && S.player && !S.local) { closeStage('ended'); if (m.summary && m.summary.ms > 60000) watchUI().summary([m.summary]); }
      break;
    case 'kicked': if (S.player) closeStage('kicked'); break;
    case 'guest-stats': S.gstats = m; break;
    case 'guest-ctrl': {
      const c = S.ctrl;
      if (m.t === 'welcome') {
        c.role = m.role; c.slot = m.slot; c.host = { ...c.host, nick: m.host, id: m.hostId }; c.canControl = m.canControl; c.perms = m.perms || { chat: true, react: true };
        if (m.mode === 'watch' && c.mode !== 'watch') { c.mode = 'watch'; if (S.player) watchUI().setupWatchStage(); }
      }
      if (m.t === 'mode') {
        c.mode = m.mode; c.canControl = m.canControl;
        if (S.player) { if (m.mode === 'watch') watchUI().setupWatchStage(); else watchUI().teardownWatchStage(); }
      }
      if (m.t === 'movie') { S.gmovie = { ...m, rx: performance.now() }; watchUI().renderBar(); }
      if (m.t === 'perms') { c.perms = { chat: m.chat, react: m.react }; watchUI().renderBar(); if (!m.chat) toast(t('chat_off_note')); }
      if (m.t === 'chat') watchUI().addChat(m);
      if (m.t === 'react') watchUI().floatReaction(m.r);
      if (m.t === 'ready?') watchUI().readyAsk();
      if (m.t === 'countdown') watchUI().countdown(m.ms);
      if (m.t === 'role') { c.role = m.role; c.slot = m.slot; toast(t('your_role', { role: t(`role_${m.role}`) })); }
      if (m.t === 'roster') c.roster = m;
      if (m.t === 'library') c.library = m.games;
      if (m.t === 'notice') toast(t(`notice_${m.key}`));
      if (S.drawer) renderDrawer();
      break;
    }
  }
}

window.addEventListener('message', (e) => {
  if (e.data === 'majlis-port' && e.ports[0]) {
    S.port = e.ports[0];
    S.port.onmessage = (ev) => {
      const d = ev.data;
      if (S.player) S.player.onMessage(d);
      else if (d.t === 'vo' && S.hub) S.hub.play(d.idx, d.data);
    };
    S.port.start();
  }
});

window.addEventListener('keydown', (e) => {
  if (S.recKey) { S.recKey(e); return; }
  if (!S.player && e.key === 'Escape') $('#modal').classList.contains('open') && $('#modal').click();
}, true);

setInterval(() => { if (W) { W.tickBar(); if (S.view === 'room' && S.host?.mode === 'watch') W.tickWatchRoom(); } }, 500);

setInterval(() => {
  if (S.view === 'home' && S.host?.code) { const el = $('#codeleft'); if (el) el.textContent = t('temp_code_left', { m: Math.max(0, Math.round((S.host.code.exp - Date.now()) / 60000)) }); }
}, 20000);

// ------------------------------------------------------------------------- boot
(async () => {
  $('.brand-mark').innerHTML = mark(18);
  S.hz = await measureHz().catch(() => 60);
  await refresh();
  for (const m of early.splice(0)) handleEvent(m);
  const q = new URLSearchParams(location.search);
  if (q.get('view')) go(q.get('view'));
  if (q.get('pick')) setTimeout(() => pickWindow(), 600);
  // test aid: the host opens its own view of the film once it's playing
  if (q.get('local')) { const iv = setInterval(() => { const b = $('#watchnow'); if (b) { clearInterval(iv); b.click(); } }, 500); }
})();
