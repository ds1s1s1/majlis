'use strict';
// Stremio-style lastVideosIds episode tracker: checks library series every 6 hours, records new
// aired episodes without flooding on first baseline scan, and persists unread items per profile.
const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL = 6 * 3600 * 1000;
const MAX_ITEMS = 80;

function diffNewEpisodes(seriesMeta, prevIds, nowMs = Date.now()) {
  if (!seriesMeta?.id) return { nextIds: prevIds || [], added: [] };
  const aired = (seriesMeta.videos || []).filter((v) => {
    if (!v?.id) return false;
    if (v.season != null && v.season <= 0) return false;
    if (!v.released) return false;
    const t = Date.parse(v.released);
    return Number.isFinite(t) && t <= nowMs;
  });
  const nextIds = [...new Set([...(prevIds || []), ...aired.map((v) => v.id)])].slice(-400);
  if (!Array.isArray(prevIds)) return { nextIds, added: [] }; // establish baseline quietly
  const seen = new Set(prevIds);
  const added = [];
  for (const v of aired) {
    if (seen.has(v.id)) continue;
    added.push({
      id: v.id,
      metaId: seriesMeta.id,
      type: seriesMeta.type || 'series',
      name: seriesMeta.name || seriesMeta.id,
      title: v.name || (v.season && v.episode ? `S${v.season}E${v.episode}` : v.id),
      videoId: v.id,
      season: v.season ?? null,
      episode: v.episode ?? null,
      poster: seriesMeta.poster || null,
      at: Date.parse(v.released) || nowMs,
      read: false,
    });
  }
  return { nextIds, added };
}

class Notifications {
  constructor({ fileFor, onAdded = () => {} }) {
    this.fileFor = fileFor;
    this.onAdded = onAdded;
    this.cache = new Map();
  }

  _load(prof) {
    if (this.cache.has(prof)) return this.cache.get(prof);
    let data = { lastVideosIds: {}, items: [], lastCheck: 0, notifiedToday: { date: '', ids: [] } };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.fileFor(prof), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        data = {
          lastVideosIds: parsed.lastVideosIds || {},
          items: Array.isArray(parsed.items) ? parsed.items : [],
          lastCheck: parsed.lastCheck || 0,
          notifiedToday: parsed.notifiedToday && typeof parsed.notifiedToday === 'object'
            ? { date: String(parsed.notifiedToday.date || ''), ids: Array.isArray(parsed.notifiedToday.ids) ? parsed.notifiedToday.ids : [] }
            : { date: '', ids: [] },
          trackedCredits: parsed.trackedCredits && typeof parsed.trackedCredits === 'object' ? parsed.trackedCredits : {},
        };
      }
    } catch {}
    if (!data.trackedCredits) data.trackedCredits = {};
    this.cache.set(prof, data);
    return data;
  }

  _save(prof) {
    const data = this._load(prof);
    const f = this.fileFor(prof);
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(data));
      fs.renameSync(`${f}.tmp`, f);
    } catch {}
  }

  list(prof) {
    const d = this._load(prof);
    const unread = d.items.filter((x) => !x.read).length;
    return { items: d.items, unread };
  }

  markRead(prof, { ids, all } = {}) {
    const d = this._load(prof);
    const set = Array.isArray(ids) ? new Set(ids) : null;
    for (const item of d.items) {
      if (all || (set && set.has(item.id))) item.read = true;
    }
    this._save(prof);
    return this.list(prof);
  }

  async check({ prof, library, fetchMeta, nowMs = Date.now(), force = false }) {
    const d = this._load(prof);
    if (!force && nowMs - d.lastCheck < CHECK_INTERVAL) return { added: [] };
    d.lastCheck = nowMs;
    const seenIds = new Set();
    const series = (library.library() || [])
      .filter((it) => (it.type === 'series' || it.type === 'anime') && !seenIds.has(it._id) && seenIds.add(it._id))
      .slice(0, 40);
    const allAdded = [];
    const CONCURRENCY = 5;
    let idx = 0;
    const worker = async () => {
      while (idx < series.length) {
        const item = series[idx++];
        const m = await fetchMeta(item.type || 'series', item._id).catch(() => null);
        if (!m) continue;
        const prev = d.lastVideosIds[item._id];
        const { nextIds, added } = diffNewEpisodes(m, prev, nowMs);
        d.lastVideosIds[item._id] = nextIds;
        for (const a of added) {
          if (!d.items.some((x) => x.id === a.id)) {
            d.items.unshift(a);
            allAdded.push(a);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, series.length) }, worker));
    d.items = d.items.slice(0, MAX_ITEMS);
    this._save(prof);
    if (allAdded.length) this.onAdded({ prof, added: allAdded, ...this.list(prof) });
    return { added: allAdded };
  }

  async checkTodaysReleases({ prof, library, fetchMeta, nowMs = Date.now() }) {
    const d = this._load(prof);
    const dt = new Date(nowMs);
    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (d.notifiedToday.date !== dayKey) d.notifiedToday = { date: dayKey, ids: [] };
    const notifiedSet = new Set(d.notifiedToday.ids);
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).getTime();
    const dayEnd = dayStart + 86400000;

    const seenIds = new Set();
    const items = (library.library() || [])
      .filter((it) => ['series', 'anime', 'movie'].includes(it.type) && !seenIds.has(it._id) && seenIds.add(it._id))
      .slice(0, 40);
    const allAdded = [];
    const CONCURRENCY = 5;
    let idx = 0;

    const worker = async () => {
      while (idx < items.length) {
        const item = items[idx++];
        const m = await fetchMeta(item.type || 'movie', item._id).catch(() => null);
        if (!m) continue;
        if (item.type === 'movie') {
          const relRaw = m.digitalRelease || m.released;
          const relTs = relRaw ? Date.parse(relRaw) : NaN;
          if (!Number.isFinite(relTs) || relTs < dayStart || relTs >= dayEnd) continue;
          const notifId = `today:${dayKey}:${m.id || item._id}`;
          if (notifiedSet.has(notifId)) continue;
          notifiedSet.add(notifId);
          d.notifiedToday.ids.push(notifId);
          const entry = {
            id: notifId,
            metaId: m.id || item._id,
            type: 'movie',
            name: m.name || item.name || item._id,
            title: m.name || item.name || 'Today',
            videoId: m.id || item._id,
            season: null,
            episode: null,
            poster: m.poster || item.poster || null,
            at: nowMs,
            read: false,
            todayRelease: true,
          };
          if (!d.items.some((x) => x.id === notifId)) d.items.unshift(entry);
          allAdded.push(entry);
        } else {
          for (const v of m.videos || []) {
            if (!v?.id || (v.season != null && v.season <= 0) || !v.released) continue;
            const relTs = Date.parse(v.released);
            if (!Number.isFinite(relTs) || relTs < dayStart || relTs >= dayEnd) continue;
            const notifId = `today:${dayKey}:${v.id}`;
            if (notifiedSet.has(notifId)) continue;
            notifiedSet.add(notifId);
            d.notifiedToday.ids.push(notifId);
            const code = v.season != null && v.episode != null
              ? `S${String(v.season).padStart(2, '0')}E${String(v.episode).padStart(2, '0')}`
              : '';
            const epLabel = [code, v.name].filter(Boolean).join(' · ') || v.id;
            const entry = {
              id: notifId,
              metaId: m.id || item._id,
              type: m.type || item.type || 'series',
              name: m.name || item.name || item._id,
              title: epLabel,
              videoId: v.id,
              season: v.season ?? null,
              episode: v.episode ?? null,
              poster: m.poster || item.poster || null,
              at: nowMs,
              read: false,
              todayRelease: true,
            };
            if (!d.items.some((x) => x.id === notifId)) d.items.unshift(entry);
            allAdded.push(entry);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    d.notifiedToday.ids = d.notifiedToday.ids.slice(-300);
    d.items = d.items.slice(0, MAX_ITEMS);
    this._save(prof);
    if (allAdded.length) this.onAdded({ prof, added: allAdded, ...this.list(prof) });
    return { added: allAdded };
  }

  async checkTrackedPeople({ prof, trackedPeople = [], fetchPerson, nowMs = Date.now() }) {
    if (!Array.isArray(trackedPeople) || !trackedPeople.length || typeof fetchPerson !== 'function') return { added: [] };
    const d = this._load(prof);
    d.trackedCredits = d.trackedCredits || {};
    const curYear = new Date(nowMs).getFullYear();
    const allAdded = [];
    for (const p of trackedPeople.slice(0, 25)) {
      if (!p?.id) continue;
      const person = await fetchPerson(p.id).catch(() => null);
      const credits = Array.isArray(person?.credits) ? person.credits : [];
      if (!credits.length) continue;
      const pid = String(p.id);
      const prev = d.trackedCredits[pid];
      const allIds = [...new Set(credits.map((c) => String(c.id)).filter(Boolean))].slice(0, 120);
      if (!Array.isArray(prev)) {
        d.trackedCredits[pid] = allIds;
        continue;
      }
      const seen = new Set(prev);
      for (const c of credits) {
        const cid = String(c.id || '');
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const yr = Number(c.year);
        if (Number.isFinite(yr) && yr < curYear - 1) continue;
        const notifId = `person:${pid}:${cid}`;
        const entry = {
          id: notifId,
          metaId: cid,
          type: c.type || 'movie',
          name: p.name || person.name || 'Tracked',
          title: c.name || cid,
          videoId: cid,
          season: null,
          episode: null,
          poster: c.poster || person.photo || p.photo || null,
          at: nowMs,
          read: false,
          trackedPersonId: pid,
        };
        if (!d.items.some((x) => x.id === notifId)) d.items.unshift(entry);
        allAdded.push(entry);
      }
      d.trackedCredits[pid] = [...seen].slice(-120);
    }
    d.items = d.items.slice(0, MAX_ITEMS);
    this._save(prof);
    if (allAdded.length) this.onAdded({ prof, added: allAdded, ...this.list(prof) });
    return { added: allAdded };
  }
}

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{8,}/i;
const TELEGRAM_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const TELEGRAM_CHAT_RE = /^-?\d+$/;

async function dispatchNotificationWebhooks({ discordWebhookUrl = '', telegramBotToken = '', telegramChatId = '', items = [], fetchFn = fetch } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean).slice(0, 5);
  const res = {
    discord: { attempted: false, ok: false },
    telegram: { attempted: false, ok: false },
  };
  if (!list.length || typeof fetchFn !== 'function') return res;

  const dcUrl = String(discordWebhookUrl || '').trim();
  const tgTok = String(telegramBotToken || '').trim();
  const tgChat = String(telegramChatId || '').trim();

  const tasks = [];
  if (DISCORD_WEBHOOK_RE.test(dcUrl)) {
    res.discord.attempted = true;
    const embeds = list.map((it) => ({
      title: String(it.name || 'Majlis').slice(0, 200),
      description: String(it.title || '').slice(0, 400),
      color: 0xE5A93C,
      ...(typeof it.poster === 'string' && /^https:\/\//i.test(it.poster) ? { thumbnail: { url: it.poster } } : {}),
    }));
    tasks.push(
      Promise.resolve().then(() => fetchFn(dcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Majlis' },
        body: JSON.stringify({ username: 'Majlis', embeds }),
        signal: AbortSignal.timeout(5000),
      })).then((r) => { res.discord.ok = !!r?.ok; }).catch(() => { res.discord.ok = false; }),
    );
  }

  if (TELEGRAM_TOKEN_RE.test(tgTok) && TELEGRAM_CHAT_RE.test(tgChat)) {
    res.telegram.attempted = true;
    const text = list.map((it) => `🎬 ${String(it.name || 'Majlis')}${it.title ? ` — ${String(it.title)}` : ''}`).join('\n').slice(0, 3500);
    tasks.push(
      Promise.resolve().then(() => fetchFn(`https://api.telegram.org/bot${tgTok}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Majlis' },
        body: JSON.stringify({ chat_id: tgChat, text }),
        signal: AbortSignal.timeout(5000),
      })).then((r) => { res.telegram.ok = !!r?.ok; }).catch(() => { res.telegram.ok = false; }),
    );
  }

  await Promise.all(tasks);
  return res;
}

module.exports = { Notifications, diffNewEpisodes, dispatchNotificationWebhooks, CHECK_INTERVAL };
