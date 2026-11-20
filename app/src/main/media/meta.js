'use strict';
// The media center's metadata: one item shape for every page, from sources that need no key
// (Cinemeta, AniList, TVMaze, ani.zip mappings), made richer when a TMDB key is there (the
// build's own, or the user's, which wins): localized logos, cast photos, recommendations,
// collections and real "trending today". RPDB / MDBList / Fanart layer on with the user's keys.
const http = require('./http');
const { normalizeGenres, TMDB_ID_TO_GENRES } = require('./genres');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const ANILIST = 'https://graphql.anilist.co';
const H = 3600000;

class Meta {
  // keys(): { tmdb, rpdb, mdblist, fanart } (user keys over the build's), lang(): 'ar' | 'en'
  constructor({ keys, lang }) { this.keys = keys; this.lang = lang; this.logoCache = new Map(); }

  // ------------------------------------------------------------ TMDB
  tmdbOn() { return !!this.keys().tmdb; }
  async tmdb(path, params = {}, ttl = 6 * H) {
    const k = this.keys().tmdb;
    if (!k) throw new Error('no TMDB key');
    const q = new URLSearchParams({ ...params, ...(/^[0-9a-f]{32}$/i.test(k) ? { api_key: k } : {}) });
    // a v4 read token goes in the header, a v3 key in the query
    return http.json(`${TMDB}${path}?${q}`, { ttl, headers: /^[0-9a-f]{32}$/i.test(k) ? {} : { authorization: `Bearer ${k}` } });
  }
  img(p, size = 'w500') { return p ? `${TMDB_IMG}/${size}${p}` : null; }

  // tt id -> { id, type } on TMDB
  async tmdbFind(imdb, type) {
    const r = await this.tmdb(`/find/${imdb}`, { external_source: 'imdb_id' }, 24 * 7 * H);
    const hit = (type === 'series' ? r.tv_results : r.movie_results)?.[0] || r.movie_results?.[0] || r.tv_results?.[0];
    return hit ? { id: hit.id, type: hit.media_type === 'tv' || r.tv_results?.[0]?.id === hit.id ? 'series' : 'movie' } : null;
  }

  // the best logo: the UI language first, then English, then any (TMDB), else Cinemeta's
  async logo(imdb, type, fallback) {
    const k = `${imdb}|${this.lang()}`;
    if (this.logoCache.has(k)) return this.logoCache.get(k);
    let url = fallback || null;
    if (this.tmdbOn() && /^tt\d+$/.test(imdb)) {
      try {
        const f = await this.tmdbFind(imdb, type);
        if (f) {
          const im = await this.tmdb(`/${f.type === 'series' ? 'tv' : 'movie'}/${f.id}/images`, { include_image_language: `${this.lang()},en,null` }, 24 * H);
          const pick = ['ar', 'en', null].map((l) => (im.logos || []).filter((x) => (x.iso_639_1 || null) === (l === 'ar' ? this.lang() : l)).sort((a, b) => b.vote_average - a.vote_average)[0]).find(Boolean);
          if (pick) url = this.img(pick.file_path, 'w500').replace('.svg', '.png');
        }
      } catch {}
    }
    this.logoCache.set(k, url);
    if (this.logoCache.size > 1200) this.logoCache.delete(this.logoCache.keys().next().value);
    return url;
  }

  // ------------------------------------------------------------ item shape
  // Cinemeta / addon meta -> the media center's item
  static fromStremio(m) {
    if (!m) return null;
    return {
      id: m.id, type: m.type, name: m.name, poster: m.poster || null, background: m.background || null, logo: m.logo || null,
      description: m.description || '', releaseInfo: m.releaseInfo || m.year || '', year: parseInt(String(m.releaseInfo || m.year || ''), 10) || null,
      runtime: m.runtime || '', genres: normalizeGenres(m.genres || m.genre || []), imdbRating: m.imdbRating || null, cast: (m.cast || []).map((n) => ({ name: n })),
      director: m.director || [], trailer: (m.trailerStreams || m.trailers || []).map((t) => t.ytId || t.source).find(Boolean) || null,
      released: m.released || null, status: m.status || null, links: m.links || [], behaviorHints: m.behaviorHints || {},
      videos: (m.videos || []).map((v) => ({ id: v.id, season: v.season ?? null, episode: v.episode ?? v.number ?? null, name: v.name || v.title || '', released: v.released || v.firstAired || null, thumbnail: v.thumbnail || null, overview: v.overview || v.description || '' })),
    };
  }

  static fromTmdb(t, type) {
    const tv = type === 'series';
    const d = tv ? t.first_air_date : t.release_date;
    return {
      id: t.external_ids?.imdb_id || t.imdb_id || `tmdb:${tv ? 'tv' : 'movie'}:${t.id}`, tmdbId: t.id, type,
      name: tv ? t.name : t.title, poster: t.poster_path ? `${TMDB_IMG}/w500${t.poster_path}` : null, background: t.backdrop_path ? `${TMDB_IMG}/original${t.backdrop_path}` : null,
      description: t.overview || '', year: d ? +d.slice(0, 4) : null, releaseInfo: d ? d.slice(0, 4) : '', released: d || null,
      genres: normalizeGenres([...(t.genres || []).map((g) => g.name || g), ...(t.genre_ids || []).flatMap((id) => TMDB_ID_TO_GENRES[id] || [])]),
      imdbRating: t.vote_average ? (Math.round(t.vote_average * 10) / 10).toFixed(1) : null, popularity: t.popularity || 0,
    };
  }

  // ------------------------------------------------------------ details
  // Cinemeta (or the addon's own meta) first; TMDB adds what it lacks. `base` = the addon meta.
  async details(type, id, base) {
    let item = base ? Meta.fromStremio(base) : null;
    if (!item && /^tt\d+/.test(id)) {
      try { item = Meta.fromStremio((await http.json(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`, { ttl: 6 * H })).meta); } catch {}
    }
    if (/^tmdb:/.test(id) && this.tmdbOn()) {
      const [, kind, tid] = id.split(':');
      const t = await this.tmdb(`/${kind}/${tid}`, { append_to_response: 'external_ids' });
      const imdb = t.external_ids?.imdb_id || t.imdb_id;
      if (imdb) return this.details(type, imdb);
      item = Meta.fromTmdb(t, type);
    }
    if (!item) throw new Error('title not found');
    if (this.tmdbOn() && /^tt\d+/.test(item.id)) {
      try {
        const f = await this.tmdbFind(item.id, type);
        if (f) {
          const kind = f.type === 'series' ? 'tv' : 'movie';
          const t = await this.tmdb(`/${kind}/${f.id}`, { append_to_response: `${kind === 'tv' ? 'aggregate_credits' : 'credits'},recommendations,videos,images,release_dates,content_ratings,keywords`, include_image_language: `${this.lang()},en,null`, language: this.lang() === 'ar' ? 'ar' : 'en-US' });
          const kwList = t.keywords?.keywords || t.keywords?.results || [];
          const afterCredits = kwList.some((kw) => kw.id === 179430 || /aftercreditsstinger|post.?credits/i.test(kw.name || ''));
          const duringCredits = kwList.some((kw) => kw.id === 179431 || /duringcreditsstinger|mid.?credits/i.test(kw.name || ''));
          if (afterCredits || duringCredits) item.postCredits = { after: afterCredits, during: duringCredits };
          item.tmdbId = f.id;
          if (t.overview && this.lang() === 'ar') item.descriptionAr = t.overview;
          item.background = item.background || (t.backdrop_path && `${TMDB_IMG}/original${t.backdrop_path}`);
          item.backdrops = (t.images?.backdrops || []).slice(0, 8).map((b) => `${TMDB_IMG}/w1280${b.file_path}`);
          const cr = (t.credits || t.aggregate_credits)?.cast || [];
          if (cr.length) item.cast = cr.slice(0, 20).map((c) => ({ id: c.id || null, name: c.name, character: c.character || c.roles?.[0]?.character || '', photo: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null }));
          const dirRaw = [
            ...(t.credits?.crew || []).filter((c) => c.job === 'Director'),
            ...(t.aggregate_credits?.crew || []).filter((c) => Array.isArray(c.jobs) ? c.jobs.some((j) => /director/i.test(j.job || '')) : c.job === 'Director'),
            ...(t.created_by || []),
          ];
          const seenDir = new Set();
          const dirs = dirRaw.filter((d) => {
            if (!d?.name) return false;
            const k = `${d.id || ''}:${d.name}`;
            if (seenDir.has(k)) return false;
            seenDir.add(k);
            return true;
          }).slice(0, 12).map((d) => ({
            id: d.id || null,
            name: d.name,
            photo: d.profile_path ? `${TMDB_IMG}/w185${d.profile_path}` : null,
          }));
          if (dirs.length) {
            item.directors = dirs;
            item.director = dirs.map((d) => d.name);
          }
          item.networks = (t.networks || t.production_companies || []).slice(0, 3).map((n) => n.name);
          const seenEnt = new Set();
          item.entities = [
            ...(t.networks || []).map((n) => ({ type: 'network', id: n.id, name: n.name })),
            ...(t.production_companies || []).map((c) => ({ type: 'company', id: c.id, name: c.name })),
          ].filter((ent) => {
            if (!ent.id || !ent.name) return false;
            const k = `${ent.type}:${ent.id}`;
            if (seenEnt.has(k)) return false;
            seenEnt.add(k);
            return true;
          }).slice(0, 6);
          item.country = t.production_countries?.[0]?.name || t.origin_country?.[0] || null;
          item.tagline = t.tagline || null;
          item.recommendations = (t.recommendations?.results || []).slice(0, 20).map((r) => ({ ...Meta.fromTmdb(r, r.media_type === 'tv' ? 'series' : 'movie') }));
          item.collection = t.belongs_to_collection ? { id: t.belongs_to_collection.id, name: t.belongs_to_collection.name } : null;
          const ytList = (t.videos?.results || []).filter((v) => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip', 'Featurette'].includes(v.type));
          if (ytList[0] && !item.trailer) item.trailer = ytList[0].key;
          item.trailers = ytList.slice(0, 12).map((v) => ({ key: v.key, name: v.name || v.type, type: v.type }));
          item.certification = certification(t, this.lang());
        }
      } catch {}
      item.logo = await this.logo(item.id, type, item.logo);
    }
    if (/^tt\d+$/.test(item.id)) {
      const k = this.keys();
      const jobs = [];
      if (k.mdblist) jobs.push(this.ratings(item.id).then((r) => { if (r) item.ratings = { imdb: r.imdb, rt: r.tomatoes, metacritic: r.metacritic, trakt: r.trakt, letterboxd: r.letterboxd, mal: r.mal, ...r }; }).catch(() => {}));
      if (k.fanart) jobs.push(this.fanart(item.id, type, k.fanart).then((fa) => { if (fa?.logo && !item.logo) item.logo = fa.logo; if (fa?.background && !item.background) item.background = fa.background; }).catch(() => {}));
      if (jobs.length) await Promise.all(jobs);
      if (k.rpdb) item.poster = this.poster(item) || item.poster;
    }
    return item;
  }

  async fanart(imdbOrTvdb, type, apiKey) {
    const kind = type === 'series' ? 'tv' : 'movies';
    const r = await http.json(`https://webservice.fanart.tv/v3/${kind}/${encodeURIComponent(imdbOrTvdb)}?api_key=${encodeURIComponent(apiKey)}`, { ttl: 24 * H });
    const pick = (arr) => (arr || []).find((x) => x.lang === this.lang() || x.lang === 'en') || (arr || [])[0];
    return {
      logo: pick(r?.hdmovielogo || r?.hdtvlogo || r?.clearlogo)?.url || null,
      background: pick(r?.moviebackground || r?.showbackground)?.url || null,
    };
  }

  // a TV season's episode stills and overviews (TMDB), when Cinemeta's are missing
  async season(tmdbId, n) {
    if (!this.tmdbOn() || !tmdbId) return [];
    const s = await this.tmdb(`/tv/${tmdbId}/season/${n}`, { language: this.lang() === 'ar' ? 'ar' : 'en-US' });
    return (s.episodes || []).map((e) => ({ season: n, episode: e.episode_number, name: e.name, overview: e.overview, thumbnail: e.still_path ? `${TMDB_IMG}/w500${e.still_path}` : null, released: e.air_date, runtime: e.runtime }));
  }

  // ------------------------------------------------------------ lists
  // trending today (real ranking) with a TMDB key; without one, Cinemeta's top
  async trending(type = 'movie') {
    if (this.tmdbOn()) {
      const r = await this.tmdb(`/trending/${type === 'series' ? 'tv' : 'movie'}/day`, { language: this.lang() === 'ar' ? 'ar' : 'en-US' }, H);
      const items = (r.results || []).map((t) => Meta.fromTmdb(t, type));
      // trending has no IMDb ids: fetch them for the first 20 so their pages and streams work
      await Promise.all(items.slice(0, 20).map(async (it) => { try { const x = await this.tmdb(`/${type === 'series' ? 'tv' : 'movie'}/${it.tmdbId}/external_ids`, {}, 24 * 7 * H); if (x.imdb_id) it.id = x.imdb_id; } catch {} }));
      return items;
    }
    const r = await http.json(`${CINEMETA}/catalog/${type}/top.json`, { ttl: 6 * H });
    return (r.metas || []).map(Meta.fromStremio);
  }

  async collection(id) {
    const c = await this.tmdb(`/collection/${id}`, { language: this.lang() === 'ar' ? 'ar' : 'en-US' }, 24 * H);
    return { id, name: c.name, background: this.img(c.backdrop_path, 'original'), parts: (c.parts || []).sort((a, b) => String(a.release_date).localeCompare(String(b.release_date))).map((p) => Meta.fromTmdb(p, 'movie')) };
  }

  // ------------------------------------------------------------ anime (AniList, keyless)
  async anilist(query, variables, ttl = 3 * H) {
    const body = JSON.stringify({ query, variables });
    return http.json(ANILIST, { ttl, method: 'POST', body, cacheKey: `${ANILIST}#${body}`, headers: { 'content-type': 'application/json' } });
  }

  async animeTrending(page = 1) {
    const r = await this.anilist(`query($p:Int){Page(page:$p,perPage:30){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){id idMal title{romaji english} coverImage{extraLarge} bannerImage description(asHtml:false) averageScore genres seasonYear format episodes nextAiringEpisode{episode airingAt}}}}`, { p: page });
    return (r.data?.Page?.media || []).map(Meta.fromAniList);
  }

  static fromAniList(a) {
    return {
      id: `anilist:${a.id}`, anilistId: a.id, malId: a.idMal || null, type: a.format === 'MOVIE' ? 'movie' : 'series', name: a.title?.english || a.title?.romaji,
      poster: a.coverImage?.extraLarge || null, background: a.bannerImage || null, description: String(a.description || '').replace(/<[^>]+>/g, ''),
      year: a.seasonYear || null, releaseInfo: a.seasonYear ? String(a.seasonYear) : '', genres: normalizeGenres(a.genres || []), malRating: a.averageScore ? (a.averageScore / 10).toFixed(1) : null,
      nextEpisode: a.nextAiringEpisode ? { episode: a.nextAiringEpisode.episode, at: a.nextAiringEpisode.airingAt * 1000 } : null,
    };
  }

  // AniList id -> the ids addons understand (Kitsu for anime addons, IMDb when there is one)
  async animeIds(anilistId) {
    const r = await http.json(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, { ttl: 24 * 7 * H });
    return { kitsu: r.mappings?.kitsu_id ? `kitsu:${r.mappings.kitsu_id}` : null, imdb: r.mappings?.imdb_id || null, mal: r.mappings?.mal_id || null, tvdb: r.mappings?.thetvdb_id || null };
  }

  // ------------------------------------------------------------ ratings / posters (user keys)
  // RPDB poster with the ratings drawn on it, when the user has an RPDB key
  poster(item) {
    const k = this.keys().rpdb;
    return k && /^tt\d+$/.test(item.id) ? `https://api.ratingposterdb.com/${k}/imdb/poster-default/${item.id}.jpg` : item.poster;
  }

  async ratings(imdb) {
    const k = this.keys().mdblist;
    if (!k || !/^tt\d+$/.test(imdb)) return null;
    const r = await http.json(`https://api.mdblist.com/imdb/${imdb}?apikey=${encodeURIComponent(k)}`, { ttl: 24 * H });
    return Object.fromEntries((r.ratings || []).filter((x) => x.value != null).map((x) => [x.source, x.value]));
  }

  async person(id) {
    if (!this.tmdbOn() || !id) return null;
    const p = await this.tmdb(`/person/${encodeURIComponent(id)}`, { append_to_response: 'combined_credits,external_ids', language: this.lang() === 'ar' ? 'ar' : 'en-US' }, 24 * H);
    const byKey = new Map();
    const pushCredit = (x, role, extra) => {
      if (!x || (x.media_type !== 'movie' && x.media_type !== 'tv') || (!x.poster_path && !x.backdrop_path)) return;
      const k = `${x.media_type}:${x.id}`;
      let entry = byKey.get(k);
      if (!entry) {
        entry = {
          ...Meta.fromTmdb(x, x.media_type === 'tv' ? 'series' : 'movie'),
          roles: [],
          jobs: [],
          department: extra.department || null,
          character: extra.character || null,
          popularity: x.popularity || 0,
          voteCount: x.vote_count || 0,
        };
        byKey.set(k, entry);
      }
      if (!entry.roles.includes(role)) entry.roles.push(role);
      if (extra.job && !entry.jobs.includes(extra.job)) entry.jobs.push(extra.job);
      if (extra.character && !entry.character) entry.character = extra.character;
      if ((x.popularity || 0) > entry.popularity) entry.popularity = x.popularity || 0;
    };
    for (const x of p.combined_credits?.cast || []) pushCredit(x, 'cast', { department: 'Acting', character: x.character || null });
    for (const x of p.combined_credits?.crew || []) pushCredit(x, 'crew', { department: x.department || null, job: x.job || null });
    const all = [...byKey.values()]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 120);
    return {
      id: p.id, imdbId: p.external_ids?.imdb_id || null, name: p.name,
      bio: p.biography || '', birthday: p.birthday || null, deathday: p.deathday || null, place: p.place_of_birth || null,
      knownFor: p.known_for_department || null, photo: p.profile_path ? `${TMDB_IMG}/w500${p.profile_path}` : null,
      credits: all,
    };
  }

  async searchPeople(q) {
    if (!this.tmdbOn() || !q?.trim()) return [];
    const r = await this.tmdb('/search/person', { query: q.trim(), language: this.lang() === 'ar' ? 'ar' : 'en-US' }, 6 * H);
    return (r.results || []).filter((p) => p.profile_path).slice(0, 12).map((p) => ({
      id: p.id, name: p.name, knownFor: p.known_for_department || '',
      photo: p.profile_path ? `${TMDB_IMG}/w185${p.profile_path}` : null,
    }));
  }

  async animeHub() {
    const q = `query($s:MediaSeason,$y:Int){
      trending:Page(page:1,perPage:24){media(type:ANIME,sort:TRENDING_DESC,isAdult:false){id idMal title{romaji english} coverImage{extraLarge} bannerImage description(asHtml:false) averageScore genres seasonYear format episodes nextAiringEpisode{episode airingAt}}}
      season:Page(page:1,perPage:24){media(type:ANIME,season:$s,seasonYear:$y,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{extraLarge} bannerImage description(asHtml:false) averageScore genres seasonYear format episodes nextAiringEpisode{episode airingAt}}}
      topRated:Page(page:1,perPage:24){media(type:ANIME,sort:SCORE_DESC,isAdult:false){id idMal title{romaji english} coverImage{extraLarge} bannerImage description(asHtml:false) averageScore genres seasonYear format episodes}}
      movies:Page(page:1,perPage:20){media(type:ANIME,format:MOVIE,sort:POPULARITY_DESC,isAdult:false){id idMal title{romaji english} coverImage{extraLarge} bannerImage description(asHtml:false) averageScore genres seasonYear format}}
    }`;
    const now = new Date(), m = now.getMonth() + 1;
    const s = m <= 3 ? 'WINTER' : m <= 6 ? 'SPRING' : m <= 9 ? 'SUMMER' : 'FALL';
    const r = await this.anilist(q, { s, y: now.getFullYear() }, H);
    const d = r.data || {};
    return {
      trending: (d.trending?.media || []).map(Meta.fromAniList),
      season: (d.season?.media || []).map(Meta.fromAniList),
      topRated: (d.topRated?.media || []).map(Meta.fromAniList),
      movies: (d.movies?.media || []).map(Meta.fromAniList),
    };
  }

  async discover({ type = 'movie', genre = '', yearFrom = '', yearTo = '', minRating = '', sort = 'popularity.desc', provider = '', page = 1 } = {}) {
    if (this.tmdbOn()) {
      const tv = type === 'series';
      const params = {
        sort_by: sort || 'popularity.desc',
        page: String(page || 1),
        'vote_count.gte': sort === 'vote_average.desc' ? '250' : '40',
        language: this.lang() === 'ar' ? 'ar' : 'en-US',
      };
      const genreId = TMDB_GENRES[String(genre || '').toLowerCase()];
      if (genreId) params.with_genres = String(genreId);
      if (minRating) params['vote_average.gte'] = String(minRating);
      if (yearFrom) params[tv ? 'first_air_date.gte' : 'primary_release_date.gte'] = `${yearFrom}-01-01`;
      if (yearTo) params[tv ? 'first_air_date.lte' : 'primary_release_date.lte'] = `${yearTo}-12-31`;
      if (provider) {
        params.with_watch_providers = String(provider);
        params.watch_region = this.lang() === 'ar' && [8, 350, 337, 9, 283, 1899].includes(+provider) ? 'SA' : 'US';
      }
      const r = await this.tmdb(`/discover/${tv ? 'tv' : 'movie'}`, params, 2 * H);
      return (r.results || []).map((x) => Meta.fromTmdb(x, type));
    }
    const skip = Math.max(0, ((Number(page) || 1) - 1) * 20);
    const baseCat = sort === 'vote_average.desc' ? 'imdbRating' : 'top';
    const parts = [];
    if (genre) parts.push(`genre=${encodeURIComponent(genre)}`);
    if (skip > 0) parts.push(`skip=${skip}`);
    const suffix = parts.length ? `/${parts.join('&')}.json` : '.json';
    const url = `${CINEMETA}/catalog/${type}/${baseCat}${suffix}`;
    const r = await http.json(url, { ttl: 6 * H }).catch(() => ({ metas: [] }));
    let items = (r.metas || []).map(Meta.fromStremio);
    if (yearFrom) items = items.filter((x) => (x.year || 0) >= +yearFrom);
    if (yearTo) items = items.filter((x) => (x.year || 9999) <= +yearTo);
    if (minRating) items = items.filter((x) => parseFloat(x.imdbRating || '0') >= +minRating);
    if (sort === 'vote_average.desc') {
      items.sort((a, b) => (parseFloat(b.imdbRating || '0') || 0) - (parseFloat(a.imdbRating || '0') || 0));
    } else if (sort === 'primary_release_date.desc' || sort === 'first_air_date.desc') {
      items.sort((a, b) => (b.year || 0) - (a.year || 0));
    }
    return items;
  }

  async discoverByEntity({ entityType = 'company', id, type = 'movie', page = 1 } = {}) {
    const eid = Number(id);
    if (!this.tmdbOn() || !Number.isFinite(eid) || eid <= 0) return [];
    const tv = type === 'series';
    const params = {
      sort_by: 'popularity.desc',
      page: String(Math.max(1, Number(page) || 1)),
      language: this.lang() === 'ar' ? 'ar' : 'en-US',
    };
    if (entityType === 'network' && tv) params.with_networks = String(eid);
    else params.with_companies = String(eid);
    const r = await this.tmdb(`/discover/${tv ? 'tv' : 'movie'}`, params, 2 * H).catch(() => ({ results: [] }));
    return (r.results || []).map((x) => Meta.fromTmdb(x, tv ? 'series' : 'movie'));
  }
}

const TMDB_GENRES = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18,
  family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749,
  'sci-fi': 878, thriller: 53, war: 10752, western: 37,
};

function certification(t, lang) {
  const want = lang === 'ar' ? ['SA', 'AE', 'US'] : ['US'];
  for (const c of want) {
    const rd = t.release_dates?.results?.find((x) => x.iso_3166_1 === c)?.release_dates?.find((x) => x.certification)?.certification;
    const cr = t.content_ratings?.results?.find((x) => x.iso_3166_1 === c)?.rating;
    if (rd || cr) return rd || cr;
  }
  return null;
}

module.exports = { Meta, CINEMETA, certification };
