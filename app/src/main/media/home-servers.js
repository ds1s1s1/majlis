'use strict';

// Home Media Server client (Jellyfin / Emby / Plex) for LAN & private home servers.
const KINDS = new Set(['jellyfin', 'emby', 'plex']);

function normalizeServerUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 512) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.toString().replace(/\/+$/, '');
}

function authHeaders(kind, apiKey) {
  if (kind === 'plex') {
    return {
      Accept: 'application/json',
      'X-Plex-Token': apiKey || '',
      'X-Plex-Product': 'Majlis',
      'X-Plex-Client-Identifier': 'majlis-desktop',
    };
  }
  const h = {
    Accept: 'application/json',
    'X-Emby-Authorization': `MediaBrowser Client="Majlis", Device="Desktop", DeviceId="majlis-desktop", Version="0.6.1"${apiKey ? `, Token="${apiKey}"` : ''}`,
  };
  if (apiKey) h['X-Emby-Token'] = apiKey;
  return h;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || 8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function resolveJellyfinUserId(base, headers) {
  const users = await fetchJson(`${base}/Users`, { headers }).catch(() => null);
  if (Array.isArray(users) && users[0]?.Id) return String(users[0].Id);
  return '';
}

async function testServer({ kind = 'jellyfin', url, apiKey = '' } = {}) {
  const k = KINDS.has(kind) ? kind : 'jellyfin';
  const base = normalizeServerUrl(url);
  if (!base) return { ok: false, error: 'invalid_url' };
  const headers = authHeaders(k, apiKey);
  try {
    if (k === 'plex') {
      const id = await fetchJson(`${base}/identity`, { headers });
      const libs = await fetchJson(`${base}/library/sections`, { headers }).catch(() => null);
      const mc = id?.MediaContainer || {};
      const libCount = Array.isArray(libs?.MediaContainer?.Directory) ? libs.MediaContainer.Directory.length : undefined;
      return {
        ok: true,
        serverName: mc.friendlyName || mc.machineIdentifier || 'Plex Server',
        version: mc.version || '',
        libCount,
      };
    }
    const pub = await fetchJson(`${base}/System/Info/Public`, { headers });
    const userId = apiKey ? await resolveJellyfinUserId(base, headers) : '';
    return {
      ok: true,
      serverName: pub?.ServerName || (k === 'emby' ? 'Emby Server' : 'Jellyfin Server'),
      version: pub?.Version || '',
      userId,
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'connection_failed' };
  }
}

async function listServerItems(server, { query = '', limit = 30 } = {}) {
  const base = normalizeServerUrl(server?.url);
  if (!base) return [];
  const k = KINDS.has(server.kind) ? server.kind : 'jellyfin';
  const headers = authHeaders(k, server.apiKey || '');
  const max = Math.min(60, Math.max(1, Number(limit) || 30));

  if (k === 'plex') {
    const endpoint = query.trim()
      ? `${base}/hubs/search?query=${encodeURIComponent(query.trim())}&limit=${max}`
      : `${base}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${max}`;
    const data = await fetchJson(endpoint, { headers }).catch(() => null);
    let raw = [];
    if (Array.isArray(data?.MediaContainer?.Metadata)) raw = data.MediaContainer.Metadata;
    else if (Array.isArray(data?.MediaContainer?.Hub)) {
      raw = data.MediaContainer.Hub.flatMap((h) => Array.isArray(h.Metadata) ? h.Metadata : []);
    }
    const tokenQ = server.apiKey ? `?X-Plex-Token=${encodeURIComponent(server.apiKey)}` : '';
    return raw
      .filter((x) => x && ['movie', 'show', 'episode'].includes(String(x.type)))
      .slice(0, max)
      .map((x) => {
        const key = String(x.ratingKey || '');
        const thumb = x.thumb || x.parentThumb || x.grandparentThumb;
        const poster = thumb ? `${base}${thumb.startsWith('/') ? thumb : `/${thumb}`}${tokenQ}` : null;
        return {
          id: `homesrv:${server.id}:${key}`,
          type: x.type === 'movie' ? 'movie' : 'series',
          name: String(x.grandparentTitle ? `${x.grandparentTitle} · ${x.title}` : x.title || 'Untitled'),
          poster,
          year: Number(x.year) || null,
          genres: Array.isArray(x.Genre) ? x.Genre.map((g) => g.tag).filter(Boolean) : [],
          description: x.summary || '',
          watched: Number(x.viewCount || 0) > 0,
          homeServer: { serverId: server.id, serverName: server.name || 'Plex', itemId: key, kind: k },
        };
      });
  }

  // Jellyfin / Emby
  const q = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series,Episode',
    SortBy: query.trim() ? 'SortName' : 'DateCreated',
    SortOrder: query.trim() ? 'Ascending' : 'Descending',
    Fields: 'Overview,ProviderIds,Genres,ProductionYear,UserData',
    Limit: String(max),
  });
  if (query.trim()) q.set('SearchTerm', query.trim());
  const uid = server.userId || await resolveJellyfinUserId(base, headers);
  const pathUrl = uid ? `${base}/Users/${encodeURIComponent(uid)}/Items?${q}` : `${base}/Items?${q}`;
  const data = await fetchJson(pathUrl, { headers }).catch(() => null);
  const items = Array.isArray(data?.Items) ? data.Items : [];
  return items.map((it) => {
    const id = String(it.Id || '');
    const poster = it.ImageTags?.Primary
      ? `${base}/Items/${encodeURIComponent(id)}/Images/Primary?maxWidth=400${server.apiKey ? `&api_key=${encodeURIComponent(server.apiKey)}` : ''}`
      : null;
    return {
      id: it.ProviderIds?.Imdb || `homesrv:${server.id}:${id}`,
      type: it.Type === 'Movie' ? 'movie' : 'series',
      name: String(it.SeriesName ? `${it.SeriesName} · ${it.Name}` : it.Name || 'Untitled'),
      poster,
      year: Number(it.ProductionYear) || null,
      genres: Array.isArray(it.Genres) ? it.Genres : [],
      description: it.Overview || '',
      watched: !!it.UserData?.Played,
      homeServer: { serverId: server.id, serverName: server.name || k, itemId: id, kind: k },
    };
  });
}

async function resolveServerStream(server, itemId) {
  const base = normalizeServerUrl(server?.url);
  if (!base || !itemId) throw new Error('invalid_server_or_item');
  const k = KINDS.has(server.kind) ? server.kind : 'jellyfin';
  const headers = authHeaders(k, server.apiKey || '');

  if (k === 'plex') {
    const meta = await fetchJson(`${base}/library/metadata/${encodeURIComponent(itemId)}`, { headers });
    const entry = meta?.MediaContainer?.Metadata?.[0];
    const partKey = entry?.Media?.[0]?.Part?.[0]?.key;
    if (!partKey) throw new Error('plex_stream_not_found');
    const url = `${base}${partKey.startsWith('/') ? partKey : `/${partKey}`}${server.apiKey ? `?X-Plex-Token=${encodeURIComponent(server.apiKey)}` : ''}`;
    return { url, name: entry?.title || 'Plex Stream' };
  }

  const q = server.apiKey ? `&api_key=${encodeURIComponent(server.apiKey)}` : '';
  return {
    url: `${base}/Videos/${encodeURIComponent(itemId)}/stream?Static=true${q}`,
    headers: server.apiKey ? { 'X-Emby-Token': server.apiKey } : {},
  };
}

async function syncServerWatched(server, itemId, watched) {
  const base = normalizeServerUrl(server?.url);
  if (!base || !itemId) return false;
  const k = KINDS.has(server.kind) ? server.kind : 'jellyfin';
  const headers = authHeaders(k, server.apiKey || '');
  if (k === 'plex') {
    const act = watched ? 'scrobble' : 'unscrobble';
    const r = await fetch(`${base}/:/${act}?identifier=com.plexapp.plugins.library&key=${encodeURIComponent(itemId)}`, { headers, signal: AbortSignal.timeout(8000) });
    return r.ok;
  }
  const uid = server.userId || await resolveJellyfinUserId(base, headers);
  if (!uid) return false;
  const r = await fetch(`${base}/Users/${encodeURIComponent(uid)}/PlayedItems/${encodeURIComponent(itemId)}`, {
    method: watched ? 'POST' : 'DELETE',
    headers,
    signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

module.exports = { normalizeServerUrl, testServer, listServerItems, resolveServerStream, syncServerWatched };
