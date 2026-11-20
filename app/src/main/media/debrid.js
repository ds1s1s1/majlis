'use strict';
// Debrid: a torrent the service already has ("cached") becomes a plain HTTPS link: instant start
// and full speed on lines where BitTorrent is slow or blocked. Uses the viewer's own key.
//  Real-Debrid  addMagnet -> info (files) -> selectFiles(the one) -> info.links -> unrestrict/link
//  TorBox       checkcached -> createtorrent -> mylist (files) -> requestdl (the one)
//  Premiumize   transfer/directdl (answers only for cached content)
//  AllDebrid    v4.1 magnet/upload -> magnet/status -> link/unlock (agent=Majlis)
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv)$/i;
const SERVICES = ['realdebrid', 'torbox', 'premiumize', 'alldebrid'];

class DebridError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function magnet(infoHash, sources = []) {
  const tr = sources.filter((s) => /^tracker:/.test(s)).map((s) => `&tr=${encodeURIComponent(s.slice(8))}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}${tr}`;
}

async function req(url, { method = 'GET', headers = {}, form, multipart } = {}) {
  let body;
  if (form) body = new URLSearchParams(form);
  if (multipart) { body = new FormData(); for (const [k, v] of Object.entries(multipart)) body.append(k, v); }
  const r = await fetch(url, { method, headers: { 'user-agent': 'Majlis', ...headers }, body, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (r.status === 401 || r.status === 403) throw new DebridError('auth', 'the debrid key was refused');
  if (!r.ok) throw new DebridError('failed', `${r.status} ${j?.error || j?.detail || text.slice(0, 120)}`);
  return j;
}

// the file the addon meant: its name when it gave one, else the biggest video
function pickFile(files, filename) {
  if (filename) { const f = files.find((x) => x.name.split('/').pop() === filename); if (f) return f; }
  return files.filter((x) => VIDEO.test(x.name)).sort((a, b) => b.size - a.size)[0] || null;
}

const RD = 'https://api.real-debrid.com/rest/1.0';
async function realdebrid(key, { infoHash, fileIdx, filename, sources }) {
  const h = { authorization: `Bearer ${key}` };
  const { id } = await req(`${RD}/torrents/addMagnet`, { method: 'POST', headers: h, form: { magnet: magnet(infoHash, sources) } });
  try {
    let info = await req(`${RD}/torrents/info/${id}`, { headers: h });
    for (let i = 0; i < 10 && ['magnet_conversion', 'queued'].includes(info.status); i++) { await sleep(500); info = await req(`${RD}/torrents/info/${id}`, { headers: h }); }
    const files = (info.files || []).map((f) => ({ id: f.id, name: String(f.path).replace(/^\//, ''), size: f.bytes }));
    // RD numbers files from 1 in torrent order, the same order the addon's fileIdx counts in
    const byIdx = fileIdx != null ? files.find((f) => f.id === fileIdx + 1 && VIDEO.test(f.name)) : null;
    const f = byIdx || pickFile(files, filename);
    if (!f) throw new DebridError('failed', 'no video in this torrent');
    await req(`${RD}/torrents/selectFiles/${id}`, { method: 'POST', headers: h, form: { files: String(f.id) } });
    info = await req(`${RD}/torrents/info/${id}`, { headers: h });
    if (info.status !== 'downloaded' || !info.links?.length) throw new DebridError('not-cached', 'Real-Debrid does not have this one yet');
    const u = await req(`${RD}/unrestrict/link`, { method: 'POST', headers: h, form: { link: info.links[0] } });
    return { url: u.download, name: f.name, size: f.size };
  } catch (e) {
    if (e.kind === 'not-cached') req(`${RD}/torrents/delete/${id}`, { method: 'DELETE', headers: h }).catch(() => {});
    throw e;
  }
}

const TB = 'https://api.torbox.app/v1/api';
async function torbox(key, { infoHash, filename, sources }) {
  const h = { authorization: `Bearer ${key}` };
  const c = await req(`${TB}/torrents/checkcached?hash=${infoHash}&format=list`, { headers: h });
  if (!Array.isArray(c?.data) || !c.data.length) throw new DebridError('not-cached', 'TorBox does not have this one yet');
  const add = await req(`${TB}/torrents/createtorrent`, { method: 'POST', headers: h, multipart: { magnet: magnet(infoHash, sources) } });
  const tid = add?.data?.torrent_id;
  if (!tid) throw new DebridError('failed', add?.detail || 'TorBox did not take the torrent');
  const info = await req(`${TB}/torrents/mylist?id=${tid}&bypass_cache=true`, { headers: h });
  const files = (info?.data?.files || []).map((f) => ({ id: f.id, name: f.name || f.short_name || '', size: f.size || 0 }));
  const f = pickFile(files, filename);
  if (!f) throw new DebridError('failed', 'no video in this torrent');
  const dl = await req(`${TB}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${tid}&file_id=${f.id}`);
  return { url: dl.data, name: f.name, size: f.size };
}

const PM = 'https://www.premiumize.me/api';
async function premiumize(key, { infoHash, filename, sources }) {
  const r = await req(`${PM}/transfer/directdl?apikey=${encodeURIComponent(key)}`, { method: 'POST', form: { src: magnet(infoHash, sources) } });
  if (r?.status !== 'success') throw new DebridError(/log|key|auth/i.test(r?.message || '') ? 'auth' : 'not-cached', r?.message || 'Premiumize does not have this one yet');
  const files = (r.content || []).map((x, i) => ({ id: i, name: x.path || '', size: x.size || 0, link: x.stream_link || x.link }));
  const f = pickFile(files, filename);
  if (!f) throw new DebridError('not-cached', 'Premiumize does not have this one yet');
  return { url: f.link, name: f.name, size: f.size };
}

const AD = 'https://api.alldebrid.com/v4.1';
function adFiles(list, pre = '') {
  const out = [];
  for (const x of list || []) {
    const name = pre + (x.n || x.filename || x.name || '');
    if (Array.isArray(x.e)) out.push(...adFiles(x.e, `${name}/`));
    else if (x.l || x.link) out.push({ name, size: x.s ?? x.size ?? 0, link: x.l || x.link });
  }
  return out;
}
function adCheck(r) {
  if (r?.status === 'success') return;
  const code = r?.error?.code || '', msg = r?.error?.message || 'AllDebrid failed';
  throw new DebridError(/auth|key|token/i.test(`${code} ${msg}`) ? 'auth' : 'failed', msg);
}
async function alldebrid(key, { infoHash, fileIdx, filename, sources }) {
  const h = { authorization: `Bearer ${key}` };
  const up = await req(`${AD}/magnet/upload?agent=Majlis`, { method: 'POST', headers: h, form: { 'magnets[]': magnet(infoHash, sources) } });
  adCheck(up);
  const m = up.data?.magnets?.[0];
  if (!m?.id) throw new DebridError('failed', 'AllDebrid did not take the magnet');
  const st = await req(`${AD}/magnet/status?agent=Majlis&id=${m.id}`, { headers: h });
  adCheck(st);
  const info = Array.isArray(st.data?.magnets) ? st.data.magnets[0] : st.data?.magnets;
  if (!info || (info.status !== 'Ready' && info.statusCode !== 4 && !m.ready)) {
    req(`${AD}/magnet/delete?agent=Majlis&id=${m.id}`, { method: 'POST', headers: h, form: { id: String(m.id) } }).catch(() => {});
    throw new DebridError('not-cached', 'AllDebrid does not have this one yet');
  }
  const files = adFiles(info.files || info.links);
  const byIdx = fileIdx != null && files[fileIdx] && VIDEO.test(files[fileIdx].name) ? files[fileIdx] : null;
  const f = byIdx || pickFile(files, filename);
  if (!f?.link) throw new DebridError('failed', 'no video in this torrent');
  const ul = await req(`${AD}/link/unlock?agent=Majlis&link=${encodeURIComponent(f.link)}`, { headers: h });
  adCheck(ul);
  return { url: ul.data.link, name: f.name.split('/').pop(), size: f.size || ul.data.filesize || 0 };
}

const RESOLVE = { realdebrid, torbox, premiumize, alldebrid };
// stream: an addon's torrent stream ({ infoHash, fileIdx, sources, behaviorHints.filename })
function resolve(service, key, stream) {
  const fn = RESOLVE[service];
  if (!fn || !key) throw new DebridError('failed', 'no debrid service set');
  return fn(key, { infoHash: String(stream.infoHash).toLowerCase(), fileIdx: stream.fileIdx ?? null, filename: stream.behaviorHints?.filename || null, sources: stream.sources || [] });
}

async function listCloud(service, key, folderId = null) {
  if (!key || !SERVICES.includes(service)) return [];
  if (service === 'torbox') {
    const h = { authorization: `Bearer ${key}` };
    const r = await req(`${TB}/torrents/mylist?bypass_cache=true`, { headers: h });
    const list = Array.isArray(r?.data) ? r.data : [];
    if (folderId != null && folderId !== '') {
      const t = list.find((x) => String(x.id) === String(folderId));
      return (t?.files || [])
        .filter((f) => VIDEO.test(f.name || f.short_name || ''))
        .map((f) => ({ id: `${t.id}:${f.id}`, torrentId: t.id, fileId: f.id, name: f.short_name || f.name, size: f.size || 0, kind: 'file', service: 'torbox' }));
    }
    return list.map((t) => {
      const files = (t.files || []).filter((f) => VIDEO.test(f.name || f.short_name || ''));
      const firstFile = files[0] || t.files?.[0];
      return {
        id: String(t.id),
        torrentId: t.id,
        fileId: firstFile?.id,
        name: t.name || `TorBox #${t.id}`,
        size: t.size || 0,
        kind: files.length > 1 ? 'folder' : 'file',
        service: 'torbox',
      };
    });
  }
  if (service === 'premiumize') {
    const q = folderId ? `&id=${encodeURIComponent(folderId)}` : '';
    const r = await req(`${PM}/folder/list?apikey=${encodeURIComponent(key)}${q}`);
    return (r?.content || [])
      .filter((x) => x.type === 'folder' || VIDEO.test(x.name || ''))
      .map((x) => ({
        id: String(x.id),
        name: x.name || 'Untitled',
        size: x.size || 0,
        kind: x.type === 'folder' ? 'folder' : 'file',
        link: x.stream_link || x.link || null,
        service: 'premiumize',
      }));
  }
  if (service === 'realdebrid') {
    const h = { authorization: `Bearer ${key}` };
    if (folderId) {
      const info = await req(`${RD}/torrents/info/${encodeURIComponent(folderId)}`, { headers: h });
      const files = (info.files || []).filter((f) => f.selected !== 0 && VIDEO.test(f.path || ''));
      const links = Array.isArray(info.links) ? info.links : [];
      return links.map((link, idx) => ({
        id: `${folderId}:${idx}`,
        name: (files[idx]?.path || info.filename || `File ${idx + 1}`).replace(/^\//, ''),
        size: files[idx]?.bytes || 0,
        kind: 'file',
        link,
        service: 'realdebrid',
      }));
    }
    const list = await req(`${RD}/torrents?limit=50`, { headers: h });
    return (Array.isArray(list) ? list : [])
      .filter((t) => t.status === 'downloaded')
      .map((t) => ({
        id: String(t.id),
        name: t.filename || `Torrent ${t.id}`,
        size: t.bytes || 0,
        kind: (t.links?.length || 0) > 1 ? 'folder' : 'file',
        link: t.links?.[0] || null,
        service: 'realdebrid',
      }));
  }
  if (service === 'alldebrid') {
    const h = { authorization: `Bearer ${key}` };
    const st = await req(`${AD}/magnet/status?agent=Majlis`, { headers: h });
    adCheck(st);
    const mags = Array.isArray(st?.data?.magnets) ? st.data.magnets : [];
    const ready = mags.filter((m) => m.status === 'Ready' || m.statusCode === 4);
    if (folderId) {
      const m = ready.find((x) => String(x.id) === String(folderId));
      return adFiles(m?.files || m?.links)
        .filter((f) => VIDEO.test(f.name || ''))
        .map((f, idx) => ({ id: `${folderId}:${idx}`, name: f.name, size: f.size || 0, kind: 'file', link: f.link, service: 'alldebrid' }));
    }
    return ready.map((m) => {
      const files = adFiles(m.files || m.links).filter((f) => VIDEO.test(f.name || ''));
      return {
        id: String(m.id),
        name: m.filename || `Magnet ${m.id}`,
        size: m.size || 0,
        kind: files.length > 1 ? 'folder' : 'file',
        link: files[0]?.link || null,
        service: 'alldebrid',
      };
    });
  }
  return [];
}

async function resolveCloud(service, key, item) {
  if (!key || !item) throw new DebridError('failed', 'missing cloud item');
  if (service === 'torbox') {
    const dl = await req(`${TB}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${encodeURIComponent(item.torrentId)}&file_id=${encodeURIComponent(item.fileId ?? 0)}`);
    return { url: dl.data, name: item.name };
  }
  if (service === 'premiumize') {
    if (!item.link) throw new DebridError('failed', 'no stream link');
    return { url: item.link, name: item.name };
  }
  if (service === 'realdebrid') {
    const h = { authorization: `Bearer ${key}` };
    const u = await req(`${RD}/unrestrict/link`, { method: 'POST', headers: h, form: { link: item.link } });
    return { url: u.download, name: u.filename || item.name };
  }
  if (service === 'alldebrid') {
    const h = { authorization: `Bearer ${key}` };
    const ul = await req(`${AD}/link/unlock?agent=Majlis&link=${encodeURIComponent(item.link)}`, { headers: h });
    adCheck(ul);
    return { url: ul.data.link, name: ul.data.filename || item.name };
  }
  throw new DebridError('failed', 'unsupported debrid service');
}

module.exports = { resolve, listCloud, resolveCloud, SERVICES, DebridError, pickFile, magnet, adFiles };
