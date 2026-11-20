'use strict';
// Multi-episode / double-length episode detection for anime premieres & series finales.
// Parses S01E01E02 / S01E01-02 / 1x01-02 filenames and falls back to 2x runtime checks.

function pad2(n) {
  return String(Math.max(0, Number(n) || 0)).padStart(2, '0');
}

function parseMultiEpisode(text) {
  const s = String(text || '');
  if (!s) return null;
  const se = /\bS(\d{1,2})E(\d{1,3})(?:\s*[-+&]?\s*E|\s*[-+&]\s*)(\d{1,3})\b/i.exec(s);
  const alt = !se ? /\b(\d{1,2})x(\d{1,3})[-+](\d{1,3})\b/i.exec(s) : null;
  const m = se || alt;
  if (!m) return null;
  const season = Number(m[1]);
  const startEp = Number(m[2]);
  const endEp = Number(m[3]);
  if (!Number.isInteger(season) || !Number.isInteger(startEp) || !Number.isInteger(endEp)) return null;
  if (endEp <= startEp || endEp - startEp > 4) return null;
  const episodes = [];
  for (let e = startEp; e <= endEp; e++) episodes.push(e);
  return { season, startEp, endEp, episodes, count: episodes.length };
}

function detectDoubleLength({ durationSec = 0, expectedRuntimeMin = 0, filename = '', episodes = [], currentVideoId = '' } = {}) {
  if (!Array.isArray(episodes) || !episodes.length || !currentVideoId) return null;
  const idx = episodes.findIndex((e) => e.id === currentVideoId);
  if (idx < 0) return null;
  const cur = episodes[idx];
  const curSeason = Number(cur.season);
  const curEp = Number(cur.episode ?? cur.number);

  const parsed = parseMultiEpisode(filename);
  if (parsed && (!Number.isFinite(curSeason) || parsed.season === curSeason) && curEp >= parsed.startEp && curEp <= parsed.endEp) {
    const covered = [];
    for (let i = idx; i < episodes.length; i++) {
      const e = episodes[i];
      const epNum = Number(e.episode ?? e.number);
      if (Number(e.season) === parsed.season && parsed.episodes.includes(epNum)) {
        covered.push(e);
      } else if (covered.length) {
        break;
      }
    }
    if (covered.length >= 2) {
      const lastCovered = covered[covered.length - 1];
      const lastIdx = episodes.findIndex((e) => e.id === lastCovered.id);
      return {
        isMulti: true,
        reason: 'filename',
        coveredIds: covered.map((e) => e.id),
        rangeLabel: `S${pad2(parsed.season)}E${pad2(parsed.startEp)}–E${pad2(parsed.endEp)}`,
        nextAfterId: lastIdx >= 0 && episodes[lastIdx + 1] ? episodes[lastIdx + 1].id : null,
      };
    }
  }

  const next = episodes[idx + 1];
  const rtMin = Number(expectedRuntimeMin) || 0;
  const dur = Number(durationSec) || 0;
  if (next && rtMin >= 18 && dur >= rtMin * 60 * 1.75 && dur <= rtMin * 60 * 2.6) {
    const nextSeason = Number(next.season);
    const nextEp = Number(next.episode ?? next.number);
    if (!Number.isFinite(curSeason) || !Number.isFinite(nextSeason) || nextSeason === curSeason) {
      return {
        isMulti: true,
        reason: 'runtime',
        coveredIds: [cur.id, next.id],
        rangeLabel: `S${pad2(curSeason || 1)}E${pad2(curEp || 1)}–E${pad2(nextEp || (curEp + 1))}`,
        nextAfterId: episodes[idx + 2]?.id || null,
      };
    }
  }

  return null;
}

module.exports = { parseMultiEpisode, detectDoubleLength };
