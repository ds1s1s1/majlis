// Strict HTML & CSS sanitizer for user-supplied Custom Profile Canvas.
// Output runs inside <iframe sandbox="" srcDoc={...}> with zero scripts allowed.

const DANGEROUS_TAGS = /<\/?\s*(script|iframe|frame|frameset|object|embed|applet|base|link|meta|form|input|button|textarea|select|noscript)\b[^>]*>/gi;
const SCRIPT_TAG_BLOCK = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const INLINE_EVENTS = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_ATTR_URLS = /\s+(href|src|xlink:href|poster|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gi;
const SRCSET_ATTR = /\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeCanvasHtml(rawHtml: string): string {
  let out = String(rawHtml || '').slice(0, 5000);
  out = out.replace(SCRIPT_TAG_BLOCK, '');
  out = out.replace(DANGEROUS_TAGS, '');
  out = out.replace(INLINE_EVENTS, '');
  out = out.replace(DANGEROUS_ATTR_URLS, '');
  out = out.replace(SRCSET_ATTR, '');
  // Neutralize any stray style="..." containing expression/url(javascript:)
  out = out.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_, css) => ` style="${sanitizeCanvasCss(css).replace(/"/g, '&quot;')}"`);
  out = out.replace(/\sstyle\s*=\s*'([^']*)'/gi, (_, css) => ` style='${sanitizeCanvasCss(css).replace(/'/g, '&#39;')}'`);
  return out;
}

export function sanitizeCanvasCss(rawCss: string): string {
  let out = String(rawCss || '').slice(0, 5000);
  out = out.replace(/<\/?\s*style\b[^>]*>/gi, '');
  out = out.replace(/@(?:import|charset|namespace)\b[^;]*(?:;|$)/gi, '');
  out = out.replace(/expression\s*\([^)]*\)/gi, '');
  out = out.replace(/-moz-binding\s*:[^;]*(?:;|$)/gi, '');
  out = out.replace(/behavior\s*:[^;]*(?:;|$)/gi, '');
  out = out.replace(/url\s*\(\s*['"]?\s*(?:javascript:|vbscript:|data:text\/html)[^)]*\)/gi, 'none');
  return out;
}

export function buildSandboxedCanvasDoc(opts: {
  html: string;
  css: string;
  font: string;
  bgColor: string;
  accentColor: string;
  textColor: string;
  dir: 'rtl' | 'ltr';
}): string {
  const safeHtml = sanitizeCanvasHtml(opts.html);
  const safeCss = sanitizeCanvasCss(opts.css);
  const safeFont = /^[a-z0-9\s,'-]+$/i.test(opts.font || '') ? opts.font : 'system-ui, sans-serif';
  const safeBg = /^#[0-9a-f]{3,8}$/i.test(opts.bgColor) ? opts.bgColor : 'transparent';
  const safeAcc = /^#[0-9a-f]{3,8}$/i.test(opts.accentColor) ? opts.accentColor : '#E5A93C';
  const safeTxt = /^#[0-9a-f]{3,8}$/i.test(opts.textColor) ? opts.textColor : '#F2EFE9';

  return `<!doctype html>
<html dir="${opts.dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:;">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    background: ${safeBg};
    color: ${safeTxt};
    font-family: ${safeFont}, system-ui, -apple-system, sans-serif;
    --pf-accent: ${safeAcc};
    --pf-text: ${safeTxt};
    overflow-x: hidden;
  }
  ${safeCss}
</style>
</head>
<body>${safeHtml}</body>
</html>`;
}
