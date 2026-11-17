'use strict';
// The media center's main-process side: one AddonClient / Meta / Library / Calendar per app,
// exposed to the Cinema page as `cin:*` IPC. Profiles ("who's watching") keep their own addons,
// library and Stremio account; the default profile uses the plain store keys (as theater.js does).
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const http = require('./http');
const { AddonClient, normalizeUrl } = require('./addon-client');
const { Meta } = require('./meta');
const { Library } = require('./library');
const { Calendar } = require('./calendar');
const { rank } = require('./ranking');
const store = require('./store-api');
const { StremioAccount, loginInBrowser } = require('./stremio-sync');
const debrid = require('./debrid');
const { Downloads } = require('./downloads');
const { DEFAULT_ADDONS } = require('../mediasvc');

// build-config.json (private builds only): { mediaKeys: { tmdb, trakt, ... } } as the built-in fallback
let BUILD = {};
try { BUILD = require('../build-config.json'); } catch {}
const KEY_NAMES = ['tmdb', 'rpdb', 'mdblist', 'fanart', 'trakt', 'opensubtitles', 'realdebrid', 'torbox', 'premiumize'];
// film series worth a marathon (TMDB collection ids)
const MARATHONS = [119, 1241, 10, 230, 263, 2344, 264, 84, 295, 87359, 404609, 9485, 8091, 31562, 328, 131635, 726871, 87096, 10194, 748, 1570, 8945, 528, 645];

function setup({ store: st, dataDir, openExternal, openPath = () => {}, videosDir = dataDir, svc = null, emit = () => {} }) {
  http.init(path.join(dataDir, 'media-cache'));
  const profile = () => st.get('mediaProfile') || 'default';
  const pk = (k) => (profile() === 'default' ? k : `${k}@${profile()}`);
  const pget = (k) => st.get(pk(k));
  const pset = (k, v) => st.set(pk(k), v);
  const addons = () => pget('addons') || DEFAULT_ADDONS;

  // the user's own keys win; empty ones fall back to the build's
  const userKeys = () => st.get('mediaKeys') || {};
  const keys = () => Object.fromEntries(KEY_NAMES.map((k) => [k, userKeys()[k] || BUILD.mediaKeys?.[k] || '']));
  const lang = () => st.get('lang') || 'ar';

  const client = new AddonClient();
  const meta = new Meta({ keys, lang });

  // one Library per profile, each in its own file
  const libs = new Map();
  const library = () => {
    const p = profile();
    if (!libs.has(p)) {
      const file = path.join(dataDir, 'media', p.replace(/[^\w-]/g, '_'), 'library.json');
      libs.set(p, new Library({
        load: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
        save: (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(s)); fs.renameSync(`${file}.tmp`, file); },
      }));
    }
    return libs.get(p);
  };
  const calendar = () => new Calendar({ meta, library: library(), keys });

  // the Stremio auth key, encrypted at rest like the identity key
  const stremio = () => { const s = pget('stremioKey'); return s ? new StremioAccount(st._unprotect(s).toString()) : null; };

  const manifests = async () => (await Promise.all(addons().map((url) => client.manifest(url).then((m) => ({ url, m }), () => null)))).filter(Boolean);
  const h = (name, fn) => ipcMain.handle(`cin:${name}`, (e, a) => fn(a || {}));

  // ---- addons
  h('addons', async () => Promise.all(addons().map((url) => client.manifest(url).then((m) => ({ url, manifest: m }), (e) => ({ url, error: e.message })))));
  h('addon-install', async ({ url }) => {
    url = normalizeUrl(url);
    const m = await client.check(url);
    pset('addons', [...addons().filter((u) => u !== url), url]);
    return m;
  });
  h('addon-remove', ({ url }) => { pset('addons', addons().filter((u) => u !== url)); client.forget(url); return addons(); });
  h('addon-move', ({ url, to }) => {
    const l = addons().filter((u) => u !== url);
    l.splice(Math.max(0, Math.min(l.length, to)), 0, url);
    pset('addons', l); return l;
  });
  h('store', (q) => store.list(q));
  h('store-categories', () => store.categories());

  // ---- browsing
  // every catalog that needs no input, in addon order (genre/skip options kept for the filter bar)
  h('rows', async () => (await manifests()).flatMap(({ url, m }) => m.catalogs
    .filter((c) => !c.extra.some((x) => x.isRequired))
    .map((c) => ({ addon: url, addonName: m.name, type: c.type, id: c.id, name: c.name || c.id, extra: c.extra }))));
  // { addon, type, id, extra: [[name, value]] } -> metas
  h('catalog', async ({ addon, type, id, extra = [] }) => (await client.request(addon, { resource: 'catalog', type, id, extra })).metas);
  h('search', async ({ q }) => {
    const out = [];
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs) {
        if (!c.extra.some((x) => x.name === 'search')) continue;
        out.push(client.request(url, { resource: 'catalog', type: c.type, id: c.id, extra: [['search', q]] })
          .then((r) => ({ addon: url, type: c.type, name: c.name, metas: r.metas }), () => null));
      }
    }
    return (await Promise.all(out)).filter(Boolean);
  });
  h('trending', ({ type }) => meta.trending(type));
  h('anime-trending', ({ page }) => meta.animeTrending(page));
  h('collection', ({ id }) => meta.collection(id));
  h('season', ({ tmdbId, n }) => meta.season(tmdbId, n));

  // the title page: the first addon that has this id's meta, then TMDB on top
  // AniList id -> Kitsu (anime addons) or IMDb; new shows without a mapping are found by name in the Kitsu addon
  async function animeId(id) {
    const n = id.slice('anilist:'.length);
    const ids = await meta.animeIds(n).catch(() => ({}));
    if (ids.kitsu || ids.imdb) return ids.kitsu || ids.imdb;
    const a = await meta.anilist('query($id:Int){Media(id:$id){title{english romaji}}}', { id: +n }).catch(() => null);
    const names = [a?.data?.Media?.title?.romaji, a?.data?.Media?.title?.english].filter(Boolean);
    for (const { url, m } of await manifests()) {
      for (const c of m.catalogs.filter((c) => c.extra.some((x) => x.name === 'search'))) {
        for (const name of names) {
          const r = await client.request(url, { resource: 'catalog', type: c.type, id: c.id, extra: [['search', name]] }).catch(() => null);
          const hit = r?.metas.find((x) => x.id.startsWith('kitsu:'));
          if (hit) return hit.id;
        }
      }
    }
    return null;
  }
  h('meta', async ({ type, id }) => {
    if (id.startsWith('anilist:')) { id = await animeId(id); if (!id) throw new Error('this anime is not in any of your addons yet'); }
    const r = await client.all(addons(), { resource: 'meta', type, id });
    const base = r.find((x) => x.result?.meta)?.result.meta || null;
    const item = await meta.details(type, id, base);
    const lib = library().get(item.id);
    return { ...item, library: lib ? { inLibrary: !lib.removed, state: lib.state } : null };
  });

  // every addon's streams for a video, ranked best first
  async function streams({ type, id, bingeGroup }) {
    const r = await client.all(addons(), { resource: 'stream', type, id });
    const list = r.flatMap((x, addonRank) => (x.result?.streams || []).map((stream) => ({ stream, addon: { url: x.url, name: x.manifest.name }, addonRank })));
    const o = { maxHeight: st.get('mediaMaxHeight') || 1080, downMbps: st.get('downMbps') || 0, debridOnly: !!st.get('debridOnly'), lang: lang(), bingeGroup };
    return { streams: rank(list, o), errors: r.filter((x) => x.error).map((x) => ({ addon: x.manifest.name, error: x.error.message })) };
  }
  async function subtitles({ type, id, extra = [] }) {
    return (await client.all(addons(), { resource: 'subtitles', type, id, extra })).flatMap((x) => (x.result?.subtitles || []).map((s) => ({ ...s, addon: x.manifest.name })));
  }
  // opening/ending times for an anime episode (AniSkip, keyless; Kitsu ids map to MAL through ani.zip)
  async function skips(videoId, durationSec) {
    const m = /^kitsu:(\d+):(\d+)$/.exec(videoId || '');
    if (!m) return [];
    const map = await http.json(`https://api.ani.zip/mappings?kitsu_id=${m[1]}`, { ttl: 7 * 864e5 }).catch(() => null);
    const mal = map?.mappings?.mal_id;
    if (!mal) return [];
    const r = await http.json(`https://api.aniskip.com/v2/skip-times/${mal}/${m[2]}?types[]=op&types[]=ed&types[]=recap&episodeLength=${Math.round(durationSec || 0)}`, { ttl: 864e5 }).catch(() => null);
    return (r?.results || []).map((x) => ({ kind: x.skipType, start: x.interval.startTime, end: x.interval.endTime }));
  }
  // the viewer's debrid service, when one has a key: { name, resolve(stream) }
  function debridService() {
    const k = keys(), name = st.get('debridService') || debrid.SERVICES.find((s) => k[s]);
    return name && k[name] ? { name, resolve: (s) => debrid.resolve(name, k[name], s) } : null;
  }
  h('streams', streams);

  // ---- downloads (one list for the whole app, not per profile: files on disk are shared)
  const folder = () => st.get('downloadDir') || path.join(videosDir, 'Majlis');
  const downloads = new Downloads({ file: path.join(dataDir, 'media', 'downloads.json'), folder, svc, debrid: () => debridService(), changed: () => emit('downloads', {}) });
  h('dl-list', () => downloads.list());
  h('dl-add', (a) => downloads.add(a));
  h('dl-pause', ({ id }) => downloads.pause(id));
  h('dl-resume', ({ id }) => downloads.start(id));
  h('dl-remove', ({ id, deleteFile }) => downloads.remove(id, deleteFile));
  h('dl-folder', () => openPath(folder()));
  h('subtitles', subtitles);

  // ---- library
  h('library', () => library().library());
  h('continue', () => library().continueWatching());
  h('history', () => Library.groupHistory(library().history));
  h('lists', () => ({ watchlist: library().watchlist, favorites: library().favorites }));
  h('lib-add', ({ meta: m }) => library().add(m));
  h('lib-remove', ({ id }) => library().remove(id));
  h('lib-watched', ({ meta: m, videoId, on }) => library().setWatched(m, videoId, on));
  h('lib-toggle', ({ list, meta: m }) => (['watchlist', 'favorites'].includes(list) ? library().toggleList(list, m) : null));

  // ---- Discover: what the viewer liked and didn't (per profile): { [id]: { v: 1 | -1, genres } }
  h('tune', () => pget('mediaTune') || {});
  h('tune-set', ({ id, v, genres }) => {
    const t = { ...(pget('mediaTune') || {}) };
    if (v) t[id] = { v: v > 0 ? 1 : -1, genres: (genres || []).slice(0, 6) }; else delete t[id];
    pset('mediaTune', t); return t;
  });
  h('marathons', async () => (meta.tmdbOn() ? (await Promise.all(MARATHONS.map((id) => meta.collection(id).catch(() => null)))).filter(Boolean) : []));

  // ---- calendar: { from, to, sources }
  h('calendar', ({ from, to, sources }) => calendar().range(from, to, sources));

  // ---- Stremio account
  h('stremio-login', async ({ email, password }) => {
    const acc = email ? await StremioAccount.login(email, password) : new StremioAccount(await loginInBrowser(openExternal));
    pset('stremioKey', st._protect(Buffer.from(acc.authKey)));
    const user = await acc.user().catch(() => null);
    return { email: user?.email || null };
  });
  h('stremio-logout', async () => { await stremio()?.logout(); pset('stremioKey', null); return true; });
  h('stremio-sync', async ({ addons: withAddons }) => {
    const acc = stremio();
    if (!acc) throw new Error('not signed in to Stremio');
    const out = await acc.syncLibrary(library());
    if (withAddons) {
      const theirs = (await acc.addons()).map((a) => a.transportUrl).filter(Boolean);
      const mine = addons();
      pset('addons', [...mine, ...theirs.filter((u) => !mine.includes(u))]);
      out.addons = theirs.length;
    }
    return out;
  });

  // ---- keys (the user's own; built-in ones are never sent to the page)
  h('caps', () => ({ tmdb: meta.tmdbOn(), trakt: !!keys().trakt, stremio: !!pget('stremioKey'), debrid: debridService()?.name || null }));
  h('keys', () => ({ user: userKeys(), builtIn: Object.fromEntries(KEY_NAMES.map((k) => [k, !!BUILD.mediaKeys?.[k]])) }));
  h('keys-set', (patch) => {
    const k = { ...userKeys() };
    for (const n of KEY_NAMES) if (typeof patch[n] === 'string') k[n] = patch[n].trim().slice(0, 200);
    st.set('mediaKeys', k);
    http.forget('https://api.themoviedb.org');
    return true;
  });

  // for the player (theater.js): progress into the library
  // a finished download's file, for the player (by id: the page never hands mpv a path)
  const downloadFile = (id) => { const d = downloads.items.find((x) => x.id === id && x.state === 'done'); return d?.file && fs.existsSync(d.file) ? d.file : null; };
  return { library, client, meta, addons, streams, subtitles, skips, debrid: debridService, downloadFile, flush: () => { for (const l of libs.values()) l.flush(); downloads.save(true); } };
}

module.exports = { setup };
