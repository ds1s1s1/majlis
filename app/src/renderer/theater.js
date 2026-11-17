// The controls over the film (a transparent window above mpv's). Everything the player does goes
// through 'player:cmd'; mpv's property changes come back as 'player' events.
import { t, setLang } from './i18n.js';
import { icon } from './icons.js';

const api = window.majlis;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = {}; // mpv properties as they come in
const cmd = (c, x = {}) => api.invoke('player:cmd', { cmd: c, ...x });
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };
let night = false, hideT = 0;

function icons() {
  $('#close').innerHTML = icon('x', 22);
  $('#play').innerHTML = icon(P.pause ? 'play' : 'pause', 24);
  $('#back10').innerHTML = icon('back', 22); $('#fwd10').innerHTML = icon('fwd', 22);
  $('#vol').innerHTML = icon('vol', 22); $('#subs').innerHTML = icon('sub', 22); $('#audio').innerHTML = icon('wave', 22);
  $('#night').innerHTML = icon('moon', 22); $('#full').innerHTML = icon('full', 22);
  $('#night').classList.toggle('on', night);
}

// a chapter called intro/opening (in either language) gets a skip button; credits get "next"
const INTRO = /\b(intro|opening|op|recap|previously)\b|مقدمة|شارة البداية/i, OUTRO = /\b(credits|ending|ed|outro|preview)\b|شارة النهاية/i;
// AniSkip times (anime) work the same way: inside an opening/recap -> skip it; inside the ending -> next
let SKIPS = [];
function chapters() {
  const list = P['chapter-list'] || [], i = P.chapter ?? -1, c = list[i], p = P['time-pos'] ?? -1;
  const sk = SKIPS.find((s) => p >= s.start && p < s.end - 1);
  const intro = sk && sk.kind !== 'ed' ? { time: sk.end } : c && INTRO.test(c.title || '') && list[i + 1];
  $('#skipintro').hidden = !intro;
  if (intro) $('#skipintro').dataset.to = intro.time;
  $('#nextep').hidden = !(P.series && ((sk && sk.kind === 'ed') || (c && OUTRO.test(c.title || '')) || (P.duration && p > P.duration - 60)));
}

function draw() {
  const d = P.duration || 0, p = P['time-pos'] || 0, c = Math.min(d, p + (P['demuxer-cache-duration'] || 0));
  $('#fill').style.width = d ? `${(p / d) * 100}%` : '0';
  $('#knob').style.insetInlineStart = d ? `${(p / d) * 100}%` : '0';
  $('#cache').style.width = d ? `${(c / d) * 100}%` : '0';
  $('#time').textContent = `${fmt(p)} / ${fmt(d)}`;
  $('#speed').textContent = `${Math.round((P.speed || 1) * 100) / 100}×`;
  const waiting = P['paused-for-cache'] || (P['time-pos'] == null && !P['eof-reached']);
  $('#center').innerHTML = waiting ? `<div class="th-spin"></div><span>${t('th_buffering')}</span>` : '';
  $('#play').innerHTML = icon(P.pause ? 'play' : 'pause', 24);
  chapters();
}

// controls fade out while the film plays and the mouse rests
function wake() { document.body.classList.remove('idle'); clearTimeout(hideT); hideT = setTimeout(() => { if (!P.pause && $('#menu').hidden) document.body.classList.add('idle'); }, 2500); }

function menu(html, wire) {
  const m = $('#menu');
  if (!m.hidden && m.dataset.kind === html.kind) { m.hidden = true; return; }
  m.dataset.kind = html.kind; m.innerHTML = html.body; m.hidden = false; wire(m);
}

function tracks(type) { return (P['track-list'] || []).filter((x) => x.type === type); }

function subsMenu() {
  const list = tracks('sub');
  menu({ kind: 'sub', body: `<h4>${t('th_subs')}</h4>
    <button data-sid="no" class="${list.some((x) => x.selected) ? '' : 'on'}">${t('th_off')}</button>
    ${list.map((x) => `<button data-sid="${x.id}" class="${x.selected ? 'on' : ''}">${esc(x.title || x.lang || `#${x.id}`)}${x.external ? '' : ` · ${t('th_builtin')}`}</button>`).join('')}
    <h4>${t('th_sub_delay')}: <span class="mono">${(P['sub-delay'] || 0).toFixed(1)}s</span></h4>
    <div class="th-pair"><button data-d="-0.1">−0.1</button><button data-d="0.1">+0.1</button></div>
    <h4>${t('th_sub_size')}</h4><div class="th-pair"><button data-scale="0.8">A−</button><button data-scale="1">A</button><button data-scale="1.3">A+</button></div>` }, (m) => {
    m.querySelectorAll('[data-sid]').forEach((b) => (b.onclick = () => { cmd('sid', { id: b.dataset.sid === 'no' ? 'no' : +b.dataset.sid }); m.hidden = true; }));
    m.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { await cmd('sub-delay', { d: +b.dataset.d }); m.hidden = true; subsMenu(); }));
    m.querySelectorAll('[data-scale]').forEach((b) => (b.onclick = () => cmd('sub-scale', { v: +b.dataset.scale })));
  });
}

function audioMenu() {
  menu({ kind: 'audio', body: `<h4>${t('th_audio')}</h4>${tracks('audio').map((x) => `<button data-aid="${x.id}" class="${x.selected ? 'on' : ''}">${esc(x.title || x.lang || `#${x.id}`)}${x.codec ? ` · ${esc(x.codec)}` : ''}${x['demux-channel-count'] ? ` ${x['demux-channel-count']}ch` : ''}</button>`).join('')}` }, (m) => {
    m.querySelectorAll('[data-aid]').forEach((b) => (b.onclick = () => { cmd('aid', { id: +b.dataset.aid }); m.hidden = true; }));
  });
}

function speedMenu() {
  menu({ kind: 'speed', body: `<h4>${t('th_speed')}</h4>${[0.75, 1, 1.25, 1.5, 2].map((v) => `<button data-v="${v}" class="${(P.speed || 1) === v ? 'on' : ''}">${v}×</button>`).join('')}` }, (m) => {
    m.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { cmd('speed', { v: +b.dataset.v }); m.hidden = true; }));
  });
}

function seekFrom(e) {
  const r = $('#seek').getBoundingClientRect();
  let f = (e.clientX - r.left) / r.width;
  if (document.dir === 'rtl' || document.documentElement.dir === 'rtl') f = 1 - f; // the bar fills from the right in Arabic
  return Math.max(0, Math.min(1, f)) * (P.duration || 0);
}

// watch together: the button (hosting with friends in the room) and what the party is doing
async function partyButton() {
  const i = await api.invoke('party:info');
  const b = $('#party');
  b.hidden = !(i.canStart || (i.on && i.role === 'host'));
  b.innerHTML = `${icon('room', 20)}<span>${t(i.on ? 'th_end_together' : 'th_together')}</span>`;
}
function partyState(s) {
  const el = $('#pstate');
  if (!s) { el.textContent = ''; partyButton(); return; }
  el.textContent = s.reason === 'buffering' ? t('th_waiting', { who: (s.waitingFor || []).join('، ') }) : s.reason === 'start' ? t('th_party_starting') : t('th_party_on');
  partyButton();
}

let saidT = 0;
async function said() {
  const s = await cmd('sub-text');
  const el = $('#said');
  el.textContent = s || t('th_said_none'); el.hidden = false;
  clearTimeout(saidT); saidT = setTimeout(() => (el.hidden = true), 4500);
}

async function init() {
  const st = await api.invoke('state');
  setLang(st.settings?.lang);
  document.documentElement.dir = (st.settings?.lang || 'ar') === 'ar' ? 'rtl' : 'ltr';
  icons(); draw();
  api.on((m) => {
    if (m.type === 'player') { P[m.name] = m.value; draw(); if (m.name === 'pause') { icons(); wake(); } }
    else if (m.type === 'skips') { SKIPS = m.list || []; chapters(); }
    else if (m.type === 'theater') { SKIPS = []; $('#title').textContent = m.card?.name || ''; P.series = m.card?.type === 'series'; night = false; icons(); wake(); partyButton(); }
    else if (m.type === 'next') { $('#state').textContent = t('th_next_up', { n: m.name }); }
    else if (m.type === 'party') partyState(m.state);
    else if (m.type === 'player-state') $('#state').textContent = m.state === 'recovering' ? t('th_recovering') : m.state === 'failed' ? t('th_failed') : '';
  });
  Object.assign(P, await cmd('state') || {});
  $('#title').textContent = P.now?.card?.name || ''; draw();
  $('#close').onclick = () => cmd('close');
  $('#said-btn').innerHTML = icon('chat', 22); $('#said-btn').title = t('th_said');
  $('#said-btn').onclick = said;
  $('#skipintro').textContent = t('th_skip_intro'); $('#nextep').textContent = t('th_next_ep');
  $('#skipintro').onclick = () => cmd('seek', { to: +$('#skipintro').dataset.to, abs: true });
  $('#nextep').onclick = () => api.invoke('player:next');
  $('#party').onclick = async () => { const i = await api.invoke('party:info'); if (i.on && i.role === 'host') await api.invoke('party:end'); else if (!i.on) await api.invoke('party:start'); partyButton(); };
  partyButton();
  $('#play').onclick = () => cmd('toggle');
  $('#back10').onclick = () => cmd('seek', { to: -10 });
  $('#fwd10').onclick = () => cmd('seek', { to: 10 });
  $('#vol').onclick = () => cmd('mute');
  $('#volume').oninput = (e) => cmd('volume', { v: +e.target.value });
  $('#subs').onclick = subsMenu; $('#audio').onclick = audioMenu; $('#speed').onclick = speedMenu;
  $('#night').onclick = () => { night = !night; cmd('night'); icons(); };
  $('#full').onclick = () => cmd('fullscreen');
  const seek = $('#seek');
  seek.onclick = (e) => cmd('seek', { to: seekFrom(e), abs: true });
  seek.onmousemove = (e) => { const tip = $('#tip'); tip.hidden = false; tip.textContent = fmt(seekFrom(e)); tip.style.left = `${e.clientX - seek.getBoundingClientRect().left}px`; };
  seek.onmouseleave = () => ($('#tip').hidden = true);
  document.addEventListener('mousemove', wake);
  document.addEventListener('dblclick', (e) => { if (!e.target.closest('button, .th-seek, .th-menu')) cmd('fullscreen'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('button, .th-seek, .th-menu, input')) { if (!$('#menu').hidden) $('#menu').hidden = true; else cmd('toggle'); } });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), big = e.shiftKey ? 30 : 5;
    const act = {
      ' ': () => cmd('toggle'), k: () => cmd('toggle'),
      arrowleft: () => cmd('seek', { to: document.documentElement.dir === 'rtl' ? big : -big }),
      arrowright: () => cmd('seek', { to: document.documentElement.dir === 'rtl' ? -big : big }),
      j: () => cmd('seek', { to: -10 }), l: () => cmd('seek', { to: 10 }),
      arrowup: () => { const v = Math.min(150, +$('#volume').value + 5); $('#volume').value = v; cmd('volume', { v }); },
      arrowdown: () => { const v = Math.max(0, +$('#volume').value - 5); $('#volume').value = v; cmd('volume', { v }); },
      f: () => cmd('fullscreen'), m: () => cmd('mute'), n: () => $('#night').onclick(),
      w: () => said(), z: () => cmd('sub-delay', { d: -0.1 }), x: () => cmd('sub-delay', { d: 0.1 }), c: () => subsMenu(), a: () => audioMenu(),
      escape: () => { if (!$('#menu').hidden) $('#menu').hidden = true; else cmd('close'); },
    }[k];
    if (act) { e.preventDefault(); act(); wake(); }
  });
  // a subtitle file dropped on the film
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; const fp = f && api.pathFor(f); if (fp && /\.(srt|ass|ssa|vtt|sub)$/i.test(fp)) cmd('sub-file', { path: fp }); });
  wake();
}
init();
