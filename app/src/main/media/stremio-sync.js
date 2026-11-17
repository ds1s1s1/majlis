'use strict';
// A Stremio account, the way Stremio itself talks to it (stremio-core src/types/api/*):
//  - sign in on stremio.com in the browser (appCallback back to a one-shot local server), so the
//    password never passes through Majlis; the key that comes back is kept encrypted
//  - addons: addonCollectionGet / addonCollectionSet (the whole list each time)
//  - library: datastoreMeta -> pull what's newer there (datastoreGet ids) -> push what's newer
//    here (datastorePut changes); type "other" and long-removed items never go up
const http = require('http');
const API = 'https://api.strem.io/api';
const LOGIN = 'https://www.stremio.com/login';

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.message || String(j.error));
  if (!('result' in j)) throw new Error(`stremio api ${r.status}`);
  return j.result;
}

// opens the Stremio login page; resolves with the authKey when the browser comes back
function loginInBrowser(openExternal, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const page = (ok) => `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#050507;color:#eee;display:grid;place-items:center;height:100vh">${ok ? 'تم ربط حساب Stremio. ارجع لمجلس. / Stremio linked, you can go back to Majlis.' : 'ما وصل المفتاح. / No key received.'}</body>`;
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return; }
      const key = u.searchParams.get('key') || u.searchParams.get('authKey');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(!!key));
      if (key) { clearTimeout(t); srv.close(); resolve(key); }
    });
    const t = setTimeout(() => { srv.close(); reject(new Error('timed out waiting for Stremio login')); }, timeoutMs);
    srv.listen(0, '127.0.0.1', () => {
      const cb = `http://127.0.0.1:${srv.address().port}/cb`;
      openExternal(`${LOGIN}?appName=${encodeURIComponent('Majlis')}&appCallback=${encodeURIComponent(cb)}`);
    });
    srv.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

class StremioAccount {
  constructor(authKey) { this.authKey = authKey; }
  static async login(email, password) { return new StremioAccount((await call('login', { type: 'Login', email, password, facebook: false })).authKey); }
  user() { return call('getUser', { type: 'GetUser', authKey: this.authKey }); }
  logout() { return call('logout', { type: 'Logout', authKey: this.authKey }).catch(() => {}); }

  async addons() { return (await call('addonCollectionGet', { type: 'AddonCollectionGet', authKey: this.authKey, update: true })).addons || []; }
  // the whole list, in order (Stremio replaces it)
  setAddons(descriptors) { return call('addonCollectionSet', { type: 'AddonCollectionSet', authKey: this.authKey, addons: descriptors }); }

  // two-way library sync with a Library (library.js); returns { pulled, pushed }
  async syncLibrary(lib) {
    const meta = await call('datastoreMeta', { authKey: this.authKey, collection: 'libraryItem' }); // [[id, mtimeMs]]
    const remote = new Map((meta || []).map(([id, m]) => [id, m]));
    const sec = (iso) => Math.floor(Date.parse(iso || 0) / 1000);
    const pull = [...remote.entries()].filter(([id, m]) => { const l = lib.get(id); return !l || Math.floor(m / 1000) > sec(l._mtime); }).map(([id]) => id);
    if (pull.length) lib.merge(await call('datastoreGet', { authKey: this.authKey, collection: 'libraryItem', ids: pull, all: false }));
    const yearAgo = Date.now() - 365 * 864e5;
    const push = Object.values(lib.items).filter((it) => it.type !== 'other' && !(it.removed && !it.temp && Date.parse(it._mtime) < yearAgo))
      .filter((it) => !remote.has(it._id) || sec(it._mtime) > Math.floor(remote.get(it._id) / 1000));
    lib.takeDirty();
    if (push.length) await call('datastorePut', { authKey: this.authKey, collection: 'libraryItem', changes: push });
    return { pulled: pull.length, pushed: push.length };
  }
}

module.exports = { StremioAccount, loginInBrowser, call };
