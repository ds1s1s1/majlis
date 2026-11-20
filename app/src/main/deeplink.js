'use strict';

function toAsciiDigits(str) {
  return String(str || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

function parseJoinTarget(raw) {
  const trimmed = String(raw || '').trim();
  const s = toAsciiDigits(trimmed);
  if (!s) return null;

  const protoMatch = /^majlis:\/\/(join|code)\/([A-Za-z0-9_-]{4,24})(?:[/?#].*)?$/i.exec(s);
  if (protoMatch) {
    return { kind: protoMatch[1].toLowerCase(), target: protoMatch[2], raw: trimmed };
  }

  const webMatch = /^https?:\/\/[^/\s]+\/(j|c)\/([A-Za-z0-9_-]{4,24})(?:[/?#].*)?$/i.exec(s);
  if (webMatch) {
    return {
      kind: webMatch[1].toLowerCase() === 'c' ? 'code' : 'join',
      target: webMatch[2],
      raw: trimmed,
    };
  }

  const flat = s.replace(/[\s-]+/g, '');
  if (/^\d{9}$/.test(flat)) return { kind: 'join', target: flat, raw: trimmed };
  if (/^[A-Za-z0-9]{6}$/.test(flat)) return { kind: 'code', target: flat.toUpperCase(), raw: trimmed };
  return null;
}

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

    if (/^(majlis:\/\/(join|code)\/|https?:\/\/[^/\s]+\/(j|c)\/)/i.test(str)) {
      const parsed = parseJoinTarget(str);
      if (parsed) return parsed;
    }
  }
  return null;
}

module.exports = { parseDeepLink, parseJoinTarget };
