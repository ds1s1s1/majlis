'use strict';
// Debrid: a torrent the service already has ("cached") becomes a plain HTTPS link: instant start
// and full speed on lines where BitTorrent is slow or blocked. Uses the viewer's own key.
//  Real-Debrid  addMagnet -> info (files) -> selectFiles(the one) -> info.links -> unrestrict/link
//  TorBox       checkcached -> createtorrent -> mylist (files) -> requestdl (the one)
//  Premiumize   transfer/directdl (answers only for cached content)
// shortcut: AllDebrid isn't wired (its v4.1 magnet API needs a real account to test); add it the same way.
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv)$/i;
const SERVICES = ['realdebrid', 'torbox', 'premiumize'];

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

const RESOLVE = { realdebrid, torbox, premiumize };
// stream: an addon's torrent stream ({ infoHash, fileIdx, sources, behaviorHints.filename })
function resolve(service, key, stream) {
  const fn = RESOLVE[service];
  if (!fn || !key) throw new DebridError('failed', 'no debrid service set');
  return fn(key, { infoHash: String(stream.infoHash).toLowerCase(), fileIdx: stream.fileIdx ?? null, filename: stream.behaviorHints?.filename || null, sources: stream.sources || [] });
}

module.exports = { resolve, SERVICES, DebridError, pickFile, magnet };
