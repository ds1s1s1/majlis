'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('sanitizeCanvasHtml, sanitizeCanvasCss, and buildSandboxedCanvasDoc neutralize XSS/exfiltration vectors', async () => {
  const modPath = pathToFileURL(path.resolve(__dirname, '../media/src/utils/sanitizeCanvas.ts')).href;
  const { sanitizeCanvasHtml, sanitizeCanvasCss, buildSandboxedCanvasDoc } = await import(modPath);

  const dirtyHtml = `<div onclick="alert(1)" style="background:expression(alert(2))"><script>fetch('https://evil')</script><img src="javascript:alert(3)" srcset="evil 2x" onerror="x()"><a href="data:text/html,<script>1</script>">ok</a></div>`;
  const cleanHtml = sanitizeCanvasHtml(dirtyHtml);
  assert.equal(/<script/i.test(cleanHtml), false);
  assert.equal(/onclick=/i.test(cleanHtml), false);
  assert.equal(/onerror=/i.test(cleanHtml), false);
  assert.equal(/javascript:/i.test(cleanHtml), false);
  assert.equal(/srcset=/i.test(cleanHtml), false);
  assert.equal(/expression\(/i.test(cleanHtml), false);

  const dirtyCss = `@import url("https://evil.test/s.css"); body { background: url('javascript:alert(1)'); behavior: url(evil.htc); color: #E5A93C; }`;
  const cleanCss = sanitizeCanvasCss(dirtyCss);
  assert.equal(/@import/i.test(cleanCss), false);
  assert.equal(/javascript:/i.test(cleanCss), false);
  assert.equal(/behavior\s*:/i.test(cleanCss), false);
  assert.equal(cleanCss.includes('#E5A93C'), true);

  const doc = buildSandboxedCanvasDoc({
    html: dirtyHtml,
    css: dirtyCss,
    font: 'IBM Plex Sans Arabic',
    bgColor: '#12100E',
    accentColor: '#E5A93C',
    textColor: '#F2EFE9',
    dir: 'rtl',
  });
  assert.equal(doc.includes("default-src 'none'"), true);
  assert.equal(/<script/i.test(doc), false);
});

test('preload.js ALLOWED_INVOKE blocks unauthorized IPC channels and permits allowlisted channels', async () => {
  const exposed = {};
  const invokedCalls = [];
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (k, api) => { exposed[k] = api; } },
        ipcRenderer: {
          invoke: async (ch, a) => { invokedCalls.push({ ch, a }); return { ok: true, ch }; },
          on: () => {},
          off: () => {},
        },
        webUtils: { getPathForFile: () => '' },
      };
    }
    return origLoad.apply(this, arguments);
  };

  try {
    global.window = { postMessage: () => {} };
    delete require.cache[require.resolve('../src/preload/preload')];
    require('../src/preload/preload');

    await assert.rejects(() => exposed.majlis.invoke('evil:shell', {}), /Blocked IPC channel/);
    await assert.rejects(() => exposed.majlis.invoke('open-external', { url: 'https://example.com' }), /Blocked IPC channel/);

    const r1 = await exposed.majlis.invoke('open', 'https://example.org');
    const r2 = await exposed.majlis.invoke('social:add', { idOrHandle: '123456789' });
    const r3 = await exposed.majlis.invoke('settings', { closeToTray: true });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, true);
    assert.equal(invokedCalls.length, 3);
  } finally {
    Module._load = origLoad;
    delete global.window;
  }
});
