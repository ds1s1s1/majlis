'use strict';
// The addon store: stremio-addons.net's public catalog (the one Harbor uses). Install goes through
// AddonClient.check(manifestUrl) like any pasted URL, so a store entry is never trusted blindly.
const http = require('./http');
const { normManifest, isAdultAddon, isAdultCategory } = require('./addon-client');
const BASE = 'https://stremio-addons.net/api/v0';
const TTL = 30 * 60000;

function card(a) {
  let manifest = null;
  try { manifest = a.manifest ? normManifest(a.manifest) : null; } catch {}
  return {
    slug: a.slug, manifestUrl: a.manifestUrl, page: a.url, stars: a.stars || 0, nsfw: !!a.nsfw,
    name: a.name || manifest?.name || '', description: a.description || manifest?.description || '',
    tags: Array.isArray(a.tags) ? a.tags : [],
    categories: (a.categories || []).map((c) => c.slug || c), configurable: !!a.configureUrl || !!manifest?.behaviorHints?.configurable,
    configureUrl: a.configureUrl || null, manifest, updatedAt: a.updatedAt || null,
  };
}

// { page, limit, search, category, sort ('stars' | 'created_at' | ...) } -> { addons, pagination }
// Adult / NSFW / pornographic addons and categories are unconditionally blocked.
async function list({ page = 1, limit = 30, search, category, sort = 'stars' } = {}) {
  if (category && isAdultCategory(category)) {
    return { addons: [], pagination: null };
  }
  const q = new URLSearchParams({ page: String(page), limit: String(limit), sort_by: sort });
  if (search) q.set('search', search);
  if (category) q.set('category', category);
  const j = await http.json(`${BASE}/addons?${q}`, { ttl: TTL });
  const addons = (j.addons || []).map(card).filter((a) => !isAdultAddon(a));
  return { addons, pagination: j.pagination || null };
}

async function get(slug) {
  const c = card(await http.json(`${BASE}/addons/${encodeURIComponent(slug)}`, { ttl: TTL }));
  if (isAdultAddon(c)) throw new Error('Adult / NSFW addons are not permitted in Majlis');
  return c;
}

async function categories() {
  const j = await http.json(`${BASE}/categories`, { ttl: 6 * 3600000 });
  return (j.categories || []).filter((c) => !isAdultCategory(c));
}

module.exports = { list, get, categories, card };
