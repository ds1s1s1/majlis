'use strict';
// The media center's metadata: one item shape for every page, from sources that need no key
// (Cinemeta, AniList, TVMaze, ani.zip mappings), made richer when a TMDB key is there (the
// build's own, or the user's, which wins): localized logos, cast photos, recommendations,
// collections and real "trending today". RPDB / MDBList / Fanart layer on with the user's keys.
const http = require('./http');

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
      runtime: m.runtime || '', genres: m.genres || m.genre || [], imdbRating: m.imdbRating || null, cast: (m.cast || []).map((n) => ({ name: n })),
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
      genres: (t.genres || []).map((g) => g.name), imdbRating: t.vote_average ? (Math.round(t.vote_average * 10) / 10).toFixed(1) : null, popularity: t.popularity || 0,
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
          const t = await this.tmdb(`/${kind}/${f.id}`, { append_to_response: `${kind === 'tv' ? 'aggregate_credits' : 'credits'},recommendations,videos,images,release_dates,content_ratings`, include_image_language: `${this.lang()},en,null`, language: this.lang() === 'ar' ? 'ar' : 'en-US' });
          item.tmdbId = f.id;
          if (t.overview && this.lang() === 'ar') item.descriptionAr = t.overview;
          item.background = item.background || (t.backdrop_path && `${TMDB_IMG}/original${t.backdrop_path}`);
          item.backdrops = (t.images?.backdrops || []).slice(0, 8).map((b) => `${TMDB_IMG}/w1280${b.file_path}`);
          const cr = (t.credits || t.aggregate_credits)?.cast || [];
          if (cr.length) item.cast = cr.slice(0, 20).map((c) => ({ name: c.name, character: c.character || c.roles?.[0]?.character || '', photo: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : null }));
          item.recommendations = (t.recommendations?.results || []).slice(0, 20).map((r) => ({ ...Meta.fromTmdb(r, r.media_type === 'tv' ? 'series' : 'movie') }));
          item.collection = t.belongs_to_collection ? { id: t.belongs_to_collection.id, name: t.belongs_to_collection.name } : null;
          const yt = (t.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
          if (yt && !item.trailer) item.trailer = yt.key;
          item.certification = certification(t, this.lang());
        }
      } catch {}
      item.logo = await this.logo(item.id, type, item.logo);
    }
    return item;
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
      year: a.seasonYear || null, releaseInfo: a.seasonYear ? String(a.seasonYear) : '', genres: a.genres || [], malRating: a.averageScore ? (a.averageScore / 10).toFixed(1) : null,
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
}

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
