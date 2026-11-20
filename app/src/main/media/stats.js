'use strict';

function localDayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDayKeyUtc(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function computeStreaks(dayKeys, nowMs) {
  if (!dayKeys.size) return { currentStreak: 0, longestStreak: 0 };
  const sortedDays = [...dayKeys].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    const diff = Math.round((parseDayKeyUtc(sortedDays[i]) - parseDayKeyUtc(sortedDays[i - 1])) / 86400000);
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else if (diff > 1) {
      run = 1;
    }
  }
  const todayKey = localDayKey(nowMs);
  const yesterdayKey = localDayKey(nowMs - 86400000);
  let current = 0;
  let cursor = dayKeys.has(todayKey) ? todayKey : (dayKeys.has(yesterdayKey) ? yesterdayKey : null);
  while (cursor && dayKeys.has(cursor)) {
    current++;
    cursor = localDayKey(parseDayKeyUtc(cursor) - 86400000);
  }
  return { currentStreak: current, longestStreak: longest };
}

function addRanked(map, key, label, id, minutes) {
  if (!key) return;
  const k = String(key).trim().toLowerCase();
  if (!k) return;
  const cur = map.get(k) || { name: String(label || key).trim(), id: id ?? null, count: 0, minutes: 0 };
  if (id != null && cur.id == null) cur.id = id;
  cur.count++;
  cur.minutes += minutes;
  map.set(k, cur);
}

function computeCinemaDashboard({
  items = {},
  history = [],
  watchLog = {},
  partyHistory = [],
  ratings = [],
  seedGenresById = null,
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const activeDays = new Set();
  const monthMs = new Map();

  for (const [day, ms] of Object.entries(watchLog || {})) {
    const val = Number(ms) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || val <= 0) continue;
    activeDays.add(day);
    const ym = day.slice(0, 7);
    monthMs.set(ym, (monthMs.get(ym) || 0) + val);
  }

  let itemMsTotal = 0;
  let moviesWatched = 0;
  let episodesWatched = 0;
  const watchedIds = new Set();

  const genreMap = new Map();
  const directorMap = new Map();
  const actorMap = new Map();

  for (const [id, it] of Object.entries(items || {})) {
    if (!it) continue;
    const s = it.state || {};
    itemMsTotal += Number(s.overallTimeWatched) || 0;
    const mw = Array.isArray(s.majlisWatched) ? s.majlisWatched : [];
    const watchedFlag = !!s.flaggedWatched || mw.length > 0;
    if (s.lastWatched) {
      const ts = Date.parse(s.lastWatched);
      if (Number.isFinite(ts) && ts > 0) activeDays.add(localDayKey(ts));
    }
    if (!watchedFlag) continue;

    watchedIds.add(id);
    if (it.type === 'series') episodesWatched += Math.max(1, mw.length);
    else moviesWatched += 1;

    const min = Math.max(0, Math.round((Number(s.overallTimeWatched) || ((Number(it.runtimeMin) || 0) * 60000)) / 60000));
    const genres = (Array.isArray(it.genres) && it.genres.length ? it.genres : seedGenresById?.[id]) || [];
    for (const g of genres) addRanked(genreMap, g, g, null, min);
    for (const d of Array.isArray(it.directors) ? it.directors : []) {
      const dName = typeof d === 'string' ? d : d?.name;
      const dId = typeof d === 'object' ? d?.id : null;
      addRanked(directorMap, dName, dName, dId, min);
    }
    for (const a of Array.isArray(it.cast) ? it.cast.slice(0, 6) : []) {
      const aName = typeof a === 'string' ? a : a?.name;
      const aId = typeof a === 'object' ? a?.id : null;
      addRanked(actorMap, aName, aName, aId, min);
    }
  }

  const fallbackMonthMs = new Map();
  for (const h of Array.isArray(history) ? history : []) {
    if (!h?.at) continue;
    const ts = Number(h.at);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    activeDays.add(localDayKey(ts));
    const ym = localDayKey(ts).slice(0, 7);
    const estMs = (Number(h.durationMs) || ((Number(h.runtimeMin) || (h.type === 'series' ? 42 : 105)) * 60000));
    fallbackMonthMs.set(ym, (fallbackMonthMs.get(ym) || 0) + estMs);
    if (h.id && !watchedIds.has(h.id)) {
      watchedIds.add(h.id);
      if (h.type === 'series') episodesWatched += 1;
      else moviesWatched += 1;
      const min = Math.round(estMs / 60000);
      const genres = (Array.isArray(h.genres) && h.genres.length ? h.genres : seedGenresById?.[h.id]) || [];
      for (const g of genres) addRanked(genreMap, g, g, null, min);
      for (const d of Array.isArray(h.directors) ? h.directors : []) {
        const dName = typeof d === 'string' ? d : d?.name;
        const dId = typeof d === 'object' ? d?.id : null;
        addRanked(directorMap, dName, dName, dId, min);
      }
      for (const a of Array.isArray(h.cast) ? a.cast.slice(0, 6) : []) {
        const aName = typeof a === 'string' ? a : a?.name;
        const aId = typeof a === 'object' ? a?.id : null;
        addRanked(actorMap, aName, aName, aId, min);
      }
    }
  }

  for (const p of Array.isArray(partyHistory) ? partyHistory : []) {
    const ts = Number(p?.startedAt || p?.endedAt) || 0;
    if (ts > 0) {
      activeDays.add(localDayKey(ts));
      const ym = localDayKey(ts).slice(0, 7);
      fallbackMonthMs.set(ym, (fallbackMonthMs.get(ym) || 0) + (Number(p?.watchedMs) || 0));
    }
  }

  const logMsTotal = Object.values(watchLog || {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const totalMs = Math.max(itemMsTotal, logMsTotal);
  const totalMinutes = Math.round(totalMs / 60000);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  const monthlyHours = [];
  const curDate = new Date(nowMs);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(curDate.getFullYear(), curDate.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const ms = monthMs.get(ym) || fallbackMonthMs.get(ym) || 0;
    monthlyHours.push({ ym, hours: Math.round((ms / 3600000) * 10) / 10 });
  }

  const { currentStreak, longestStreak } = computeStreaks(activeDays, nowMs);
  const sortTop = (map) => [...map.values()]
    .sort((a, b) => (b.count - a.count) || (b.minutes - a.minutes) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((x) => ({ ...x, minutes: Math.round(x.minutes) }));

  const validRatings = (Array.isArray(ratings) ? ratings : [])
    .map((r) => Number(r?.score ?? r?.rating ?? r))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgRating = validRatings.length
    ? Math.round((validRatings.reduce((a, b) => a + b, 0) / validRatings.length) * 10) / 10
    : null;

  return {
    totalHours,
    totalMinutes,
    moviesWatched,
    episodesWatched,
    currentStreak,
    longestStreak,
    monthlyHours,
    topGenres: sortTop(genreMap),
    topDirectors: sortTop(directorMap),
    topActors: sortTop(actorMap),
    avgRating,
  };
}

module.exports = { computeCinemaDashboard, localDayKey };
