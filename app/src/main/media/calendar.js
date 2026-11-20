'use strict';
// Release calendar. Sources, merged and de-duplicated (the first source to claim an episode keeps it):
//  library  series in the viewer's library -> Cinemeta episode air dates (no key)
//  tv       TVMaze schedule: streaming (/schedule/web) + US broadcast (/schedule), per day (no key)
//  anime    AniList airingSchedules (no key)
//  movies   TMDB theatrical/digital releases (built-in or user key)
//  trakt    Trakt movie calendar (needs a Trakt client id)
// Entry: { at (ms), day 'YYYY-MM-DD' local, source, id, type, name, title, season, episode, videoId, poster }
const httpMod = require('./http');
const { CINEMETA, Meta } = require('./meta');
const DAY = 864e5, H = 3600000;

const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const entry = (e) => ({ season: null, episode: null, videoId: null, poster: null, title: '', ...e, day: ymd(e.at) });

class Calendar {
  // meta: Meta, library: Library, keys(): { trakt }, get: http.json (injectable for tests)
  constructor({ meta, library, keys = () => ({}), get = httpMod.json }) { Object.assign(this, { meta, lib: library, keys, get }); }

  async calendarVideosIds(from, to) {
    const seen = new Set();
    const series = this.lib.library().filter((it) => it.type === 'series' && /^tt\d+$/.test(it._id) && !seen.has(it._id) && seen.add(it._id)).slice(0, 200);
    const out = [];
    const CONCURRENCY = 5;
    let idx = 0;
    const worker = async () => {
      while (idx < series.length) {
        const it = series[idx++];
        const j = await this.get(`${CINEMETA}/meta/series/${it._id}.json`, { ttl: 6 * H }).catch(() => null);
        for (const v of j?.meta?.videos || []) {
          const at = Date.parse(v.released || v.firstAired || '');
          if (at >= from && at < to && v.season) out.push(entry({ at, source: 'library', id: it._id, type: 'series', name: it.name, title: v.name || v.title || '', season: v.season, episode: v.episode ?? v.number, videoId: v.id, poster: it.poster }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, series.length) }, worker));
    return out;
  }

  async library(from, to) {
    return this.calendarVideosIds(from, to);
  }

  // one request per day per list (throttled in http.js to ~18 req / 10 s for api.tvmaze.com)
  async tv(from, to) {
    const out = [], days = [];
    for (let t = from; t < to && days.length < 35; t += DAY) days.push(ymd(t));
    const add = (x) => {
      const show = x.show || x._embedded?.show; const at = Date.parse(x.airstamp || x.airdate || '');
      if (!show || !(at >= from && at < to)) return;
      const imdb = show.externals?.imdb;
      out.push(entry({ at, source: 'tv', id: imdb || `tvmaze:${show.id}`, type: 'series', name: show.name, title: x.name || '', season: x.season, episode: x.number, videoId: imdb && x.season ? `${imdb}:${x.season}:${x.number}` : null, poster: show.image?.medium || null }));
    };
    await Promise.all(days.flatMap((d) => [`https://api.tvmaze.com/schedule/web?date=${d}`, `https://api.tvmaze.com/schedule?date=${d}&country=US`]
      .map((u) => this.get(u, { ttl: 6 * H }).then((l) => (l || []).forEach(add), () => {}))));
    return out;
  }

  async anime(from, to) {
    const q = `query($p:Int,$a:Int,$b:Int){Page(page:$p,perPage:50){pageInfo{hasNextPage}airingSchedules(airingAt_greater:$a,airingAt_lesser:$b,sort:TIME){airingAt episode media{id isAdult format title{romaji english}coverImage{large}}}}}`;
    const out = [];
    for (let p = 1; p <= 6; p++) {
      const d = await this.meta.anilist(q, { p, a: Math.floor(from / 1000), b: Math.floor(to / 1000) }, H).catch(() => null);
      const page = d?.data?.Page;
      for (const s of page?.airingSchedules || []) {
        if (s.media.isAdult) continue;
        out.push(entry({ at: s.airingAt * 1000, source: 'anime', id: `anilist:${s.media.id}`, type: s.media.format === 'MOVIE' ? 'movie' : 'series', name: s.media.title.english || s.media.title.romaji, episode: s.episode, poster: s.media.coverImage?.large || null }));
      }
      if (!page?.pageInfo?.hasNextPage) break;
    }
    return out;
  }

  async movies(from, to) {
    if (!this.meta.tmdbOn()) return [];
    const j = await this.meta.tmdb('/discover/movie', { 'primary_release_date.gte': ymd(from), 'primary_release_date.lte': ymd(to - 1), sort_by: 'popularity.desc', with_release_type: '2|3|4', 'vote_count.gte': 0 }, 6 * H).catch(() => null);
    return (j?.results || []).filter((t) => t.release_date).map((t) => { const m = Meta.fromTmdb(t, 'movie'); return entry({ at: Date.parse(t.release_date), source: 'movies', id: m.id, type: 'movie', name: m.name, poster: m.poster }); });
  }

  async trakt(from, to) {
    const id = this.keys().trakt;
    if (!id) return [];
    const days = Math.min(33, Math.ceil((to - from) / DAY));
    const l = await this.get(`https://api.trakt.tv/calendars/all/movies/${ymd(from)}/${days}`, { ttl: 6 * H, headers: { 'trakt-api-version': '2', 'trakt-api-key': id } }).catch(() => []);
    return (l || []).map((x) => entry({ at: Date.parse(x.released), source: 'trakt', id: x.movie.ids.imdb || `tmdb:movie:${x.movie.ids.tmdb}`, type: 'movie', name: x.movie.title }));
  }

  // sources: subset of ['library', 'tv', 'anime', 'movies', 'trakt'], in priority order
  async range(from, to, sources = ['library']) {
    const lists = await Promise.all(sources.map((s) => this[s](from, to).catch(() => [])));
    return Calendar.merge(lists);
  }

  static merge(lists) {
    const seen = new Set(), out = [];
    for (const e of lists.flat()) {
      const k = e.type === 'series' ? `${e.id}:${e.season}:${e.episode}` : `${e.id}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(e);
    }
    return out.sort((a, b) => a.at - b.at);
  }
}

module.exports = { Calendar, ymd };
