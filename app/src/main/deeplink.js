'use strict';

function parseDeepLink(argv) {
  for (const a of argv || []) {
    const str = String(a || '').trim();
    if (!str) continue;

    if (/^majlis:\/\/addon/i.test(str)) {
      try {
        const u = new URL(str);
        const target = u.searchParams.get('url');
        if (target && /^https?:\/\//i.test(target)) return { kind: 'addon', url: target };
      } catch {}
    }

    const ms = /^stremio:\/\/(.+)/i.exec(str);
    if (ms) {
      let rest = ms[1].replace(/^\/+/, '');
      if (rest && !/^https?:\/\//i.test(rest)) rest = `https://${rest}`;
      if (rest && !/\.json(\?|$)/i.test(rest)) rest = `${rest.replace(/\/+$/, '')}/manifest.json`;
      if (/^https?:\/\//i.test(rest)) return { kind: 'addon', url: rest };
    }

    const mf = /^majlis:\/\/friend\/(.+)$/i.exec(str);
    if (mf) {
      const tail = mf[1].replace(/\/+$/, '');
      const qIdx = tail.indexOf('?');
      const pathRaw = qIdx >= 0 ? tail.slice(0, qIdx) : tail;
      let decoded = pathRaw;
      try { decoded = decodeURIComponent(pathRaw); } catch {}
      decoded = decoded.replace(/\/+$/, '').trim();
      if (decoded) {
        let pk = null;
        if (qIdx >= 0) {
          try { pk = new URLSearchParams(tail.slice(qIdx + 1)).get('pk') || null; } catch {}
        }
        return { kind: 'friend', target: decoded, ...(pk ? { pk } : {}), raw: str };
      }
    }

    const mjc = /^majlis:\/\/(join|code)\/([A-Za-z0-9_-]{4,24})(?:[/?#].*)?$/i.exec(str);
    if (mjc) {
      return { kind: mjc[1].toLowerCase(), target: mjc[2], raw: str };
    }
  }
  return null;
}

module.exports = { parseDeepLink };
