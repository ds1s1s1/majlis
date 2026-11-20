'use strict';
// Network check: what kind of line this is, how each relay looks from here, how much upload
// there really is, whether we're behind carrier NAT, and what to change.
const { execFile } = require('child_process');
const dgram = require('dgram');
const os = require('os');

const run = (cmd, args, timeout = 6000) => new Promise((res) => execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (e, out) => res(e ? '' : out)));

async function wifiInfo() {
  const out = await run('netsh', ['wlan', 'show', 'interfaces']);
  if (!out || !/State\s*:\s*connected/i.test(out)) return null;
  const g = (re) => (out.match(re) || [])[1]?.trim();
  return { ssid: g(/^\s*SSID\s*:\s*(.+)$/m), band: g(/^\s*Band\s*:\s*(.+)$/m), channel: g(/^\s*Channel\s*:\s*(.+)$/m), signal: parseInt(g(/^\s*Signal\s*:\s*(\d+)/m) || '0', 10), radio: g(/^\s*Radio type\s*:\s*(.+)$/m), rx: g(/Receive rate \(Mbps\)\s*:\s*(.+)$/m), tx: g(/Transmit rate \(Mbps\)\s*:\s*(.+)$/m) };
}

async function defaultAdapter() {
  const ps = "$r=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue|Sort-Object RouteMetric|Select-Object -First 1;if($r){$a=Get-NetAdapter -InterfaceIndex $r.ifIndex;@{name=$a.Name;desc=$a.InterfaceDescription;media=[string]$a.PhysicalMediaType;speed=$a.LinkSpeed;gw=$r.NextHop}|ConvertTo-Json -Compress}";
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], 10000);
  try { return JSON.parse(out); } catch { return null; }
}

// ---- UPnP: ask the router who it is and what its WAN address is (carrier NAT check)
function ssdp(timeout = 1800) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4');
    const found = new Set();
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n');
    s.on('message', (b) => { const m = String(b).match(/^location:\s*(.+)$/im); if (m) found.add(m[1].trim()); });
    s.on('error', () => {});
    s.bind(() => { try { s.send(msg, 1900, '239.255.255.250'); } catch {} });
    setTimeout(() => { try { s.close(); } catch {} res([...found]); }, timeout);
  });
}

async function upnpInfo() {
  const locs = await ssdp();
  for (const loc of locs) {
    try {
      const xml = await (await fetch(loc, { signal: AbortSignal.timeout(2500) })).text();
      const tag = (t) => (xml.match(new RegExp(`<${t}>([^<]*)</${t}>`, 'i')) || [])[1] || '';
      const info = { friendly: tag('friendlyName'), model: tag('modelName'), maker: tag('manufacturer'), wanIp: null };
      const svc = xml.match(/<serviceType>(urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
      if (svc) {
        const url = new URL(svc[2], loc).toString();
        const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="${svc[1]}"/></s:Body></s:Envelope>`;
        const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc[1]}#GetExternalIPAddress"` }, signal: AbortSignal.timeout(2500) });
        info.wanIp = ((await r.text()).match(/<NewExternalIPAddress>([^<]*)</i) || [])[1] || null;
      }
      return info;
    } catch {}
  }
  return null;
}

const isPrivate4 = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip || '');

function classify(adapter, wifi, upnp) {
  const d = `${adapter?.desc || ''} ${adapter?.media || ''} ${adapter?.name || ''}`;
  const r = `${upnp?.friendly || ''} ${upnp?.model || ''} ${upnp?.maker || ''}`;
  let link = 'unknown';
  if (wifi || /802\.11|wireless|wi-?fi|wlan/i.test(d)) link = 'wifi';
  else if (/ethernet|802\.3|realtek|intel.*connection|killer e/i.test(d)) link = 'ethernet';
  if (/mobile|wwan|cellular|lte|5g/i.test(d)) link = 'mobile';
  // 4G/5G home routers seen around here: Huawei H-series / B-series, Brovi, ZTE MC, TP-Link NX/Archer MR
  let wan = 'unknown';
  if (/5g|nr\b|h1[0-9]{2}|h3[0-9]{2}|brovi|mc8|mc7|nx[0-9]{3}|cpe pro|cpe 5/i.test(r)) wan = '5g';
  else if (/lte|4g|b[0-9]{3}|mr[0-9]{3}|b311|b535|b818/i.test(r)) wan = '4g';
  else if (/fiber|ont|gpon|hg8|eg8|f6[0-9]{2}|ftth/i.test(r)) wan = 'fiber';
  return { link, wan };
}

async function downloadTest(bytes = 2000000, timeoutMs = 6000, fetchFn = fetch) {
  if (typeof fetchFn !== 'function') return null;
  const n = Math.max(65536, Math.min(20000000, Number(bytes) || 2000000));
  const t0 = performance.now();
  try {
    const r = await fetchFn(`https://speed.cloudflare.com/__down?bytes=${n}`, {
      cache: 'no-store',
      headers: { 'user-agent': 'Majlis' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r?.ok) return null;
    const buf = await r.arrayBuffer();
    if (!buf || !buf.byteLength) return null;
    const dt = Math.max(10, performance.now() - t0);
    const mbps = +((buf.byteLength * 8) / (dt * 1000)).toFixed(1);
    return { mbps, bytes: buf.byteLength, ms: Math.round(dt) };
  } catch {
    return null;
  }
}

async function check(net, store, { upload = true, download = false } = {}) {
  const t0 = Date.now();
  const [wifi, adapter, upnp] = await Promise.all([wifiInfo(), defaultAdapter(), upnpInfo()]);
  const { link, wan } = classify(adapter, wifi, upnp);

  // relays: 12 pings each, best + average + jitter + loss
  const relays = [];
  if (net.cloud) {
    const { stunBinding } = require('./turn');
    const addrs = await require('dns').promises.lookup('turn.cloudflare.com', { all: true }).catch(() => []);
    for (const fam of [4, 6]) {
      const a = addrs.find((x) => x.family === fam);
      const sock = fam === 6 ? net.s6 : net.s4;
      if (!a || !sock) continue;
      (net.stunAddrs ||= new Set()).add(a.address);
      const rtts = [];
      for (let i = 0; i < 12; i++) { const r = await stunBinding(sock, a.address, 3478); rtts.push(r ? r.rtt : null); await new Promise((z) => setTimeout(z, 25)); }
      const ok = rtts.filter((x) => x != null);
      const avg = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : null;
      const jitter = ok.length > 1 ? ok.slice(1).reduce((s2, v, i) => s2 + Math.abs(v - ok[i]), 0) / (ok.length - 1) : 0;
      relays.push({ name: 'cf', label: net.colo || 'Cloudflare', fam: fam === 6 ? 'v6' : 'v4', best: ok.length ? Math.min(...ok) : null, avg, jitter, loss: 1 - ok.length / rtts.length });
    }
  }
  for (const r of net.cloud ? [] : net.relays) {
    const addrs = await require('dns').promises.lookup(r.host || net.serverHost, { all: true }).catch(() => []);
    for (const fam of [4, 6]) {
      const a = addrs.find((x) => x.family === fam);
      const sock = fam === 6 ? net.s6 : net.s4;
      if (!a || !sock) continue;
      const rtts = [];
      for (let i = 0; i < 12; i++) { const v = await net.relayPing(sock, a.address, r.udp || 7701, 700); rtts.push(v); await new Promise((z) => setTimeout(z, 25)); }
      const ok = rtts.filter((x) => x != null);
      const avg = ok.length ? ok.reduce((x, y) => x + y, 0) / ok.length : null;
      const jitter = ok.length > 1 ? ok.slice(1).reduce((s, v, i) => s + Math.abs(v - ok[i]), 0) / (ok.length - 1) : 0;
      relays.push({ name: r.name, label: r.label || r.name, fam: fam === 6 ? 'v6' : 'v4', best: ok.length ? Math.min(...ok) : null, avg, jitter, loss: 1 - ok.length / rtts.length });
    }
  }
  relays.splice(0, relays.length, ...rankPathsByJitter(relays));

  let up = null;
  let dl = null;
  const upTask = (upload && net.relays.length)
    ? (async () => {
      const best = net.relays.find((r) => r.name === relays[0]?.name) || net.relays[0];
      up = await net.uploadTest(best, 80, 1500).catch(() => null);
      if (up && up.loss < 0.02) up.capped = true; // the line may be faster than what we pushed
    })()
    : Promise.resolve();
  const dlTask = download ? downloadTest().then((x) => { dl = x; }).catch(() => {}) : Promise.resolve();
  await Promise.all([upTask, dlTask]);

  const v6 = Object.values(os.networkInterfaces()).flat().some((a) => a && a.family === 'IPv6' && !a.internal && /^[23]/.test(a.address) && !/^(2001:0?:|2002:)/i.test(a.address));
  const pub4 = net.publicAddr.v4?.ip || null;
  const cgnat = upnp?.wanIp ? (isPrivate4(upnp.wanIp) || (pub4 && upnp.wanIp !== pub4)) : null;
  const jitter = relays[0]?.jitter ?? null;

  const tips = [];
  if (link === 'wifi' && wifi && /2\.4/.test(wifi.band || '')) tips.push('wifi24');
  else if (link === 'wifi' && wifi && wifi.signal && wifi.signal < 60) tips.push('wifiWeak');
  else if (link === 'wifi') tips.push('wifiEthernet');
  if (cgnat && !v6) tips.push('cgnatNoV6');
  else if (cgnat && v6) tips.push('cgnatV6');
  if (!v6) tips.push('enableV6');
  if (wan === '5g' || wan === '4g' || (jitter != null && jitter > 6)) tips.push('stability');
  if ((wan === '5g' || wan === '4g') && jitter != null && jitter > 4) tips.push('bandLock');
  if (up && up.mbps < 12) tips.push('lowUpload');
  if (relays[0]?.best != null && relays[0].best > 45) tips.push('farRelay');

  const recBitrate = up ? Math.max(3, Math.min(80, Math.floor(up.mbps * (up.capped ? 0.8 : 0.65)))) : null;
  const res = {
    at: Date.now(), took: Date.now() - t0, link, wan, wifi, adapter, router: upnp, cgnat, v6, pub4, pub6: net.publicAddr.v6?.ip || null,
    isp: detectSaudiIsp([adapter?.desc, adapter?.name, net.colo].filter(Boolean).join(' ')),
    registered: net.registered, via: net.wsSig ? 'tcp' : 'udp', relays, upload: up, download: dl, jitter, tips, recBitrate,
    recStability: wan === '5g' || wan === '4g' || (jitter != null && jitter > 6),
  };
  if (store.get('connType') === 'auto') res.detected = wan !== 'unknown' ? wan : link === 'wifi' ? 'wifi' : link === 'ethernet' ? 'fiber' : 'auto';
  return res;
}

function detectSaudiIsp(orgOrIp = '') {
  const s = String(orgOrIp || '').trim();
  if (!s) return 'other';
  if (/\bstc\b|saudi\s*telecom|awalnet|arabian\s*internet/i.test(s)) return 'stc';
  if (/mobily|etihad\s*etisalat|bayanat/i.test(s)) return 'mobily';
  if (/\bzain\b|mobile\s*telecommunication\s*company\s*saudi/i.test(s)) return 'zain';
  if (/\bsalam\b|integrated\s*telecom|\bitc\b/i.test(s)) return 'salam';
  return 'other';
}

function summarizeProbeSamples(samples = [], fallback = {}) {
  const ok = samples.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const total = samples.length || 1;
  const best = ok.length ? Math.min(...ok) : (fallback.best ?? null);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : (fallback.avg ?? best);
  let jitter = fallback.jitter ?? 0;
  if (ok.length > 1) {
    let sum = 0;
    for (let i = 1; i < ok.length; i++) sum += Math.abs(ok[i] - ok[i - 1]);
    jitter = sum / (ok.length - 1);
  }
  const loss = samples.length ? (1 - ok.length / total) : (fallback.loss ?? (avg == null ? 1 : 0));
  const avgVal = avg == null ? 1e6 : avg;
  const score = Math.round((avgVal + 2 * jitter + loss * 200) * 100) / 100;
  return {
    ...fallback,
    best: best != null ? Math.round(best * 10) / 10 : null,
    avg: avg != null ? Math.round(avg * 10) / 10 : null,
    jitter: Math.round(jitter * 10) / 10,
    loss: Math.round(loss * 1000) / 1000,
    score,
  };
}

function rankPathsByJitter(paths = [], opts = {}) {
  const probeFn = typeof opts?.probeFn === 'function' ? opts.probeFn : null;
  if (probeFn) {
    return (async () => {
      const out = [];
      for (const p of paths) {
        const res = await probeFn(p).catch(() => null);
        const samples = Array.isArray(res) ? res : (Array.isArray(res?.rtts) ? res.rtts : []);
        const base = res && !Array.isArray(res) ? { ...p, ...res } : { ...p };
        out.push(summarizeProbeSamples(samples, base));
      }
      return out.sort((a, b) => (a.score - b.score) || (a.jitter - b.jitter) || ((a.best ?? 1e9) - (b.best ?? 1e9)));
    })();
  }
  return (Array.isArray(paths) ? paths : []).map((p) => {
    const samples = Array.isArray(p?.rtts) ? p.rtts : [];
    return summarizeProbeSamples(samples, p || {});
  }).sort((a, b) => (a.score - b.score) || (a.jitter - b.jitter) || ((a.best ?? 1e9) - (b.best ?? 1e9)));
}

module.exports = { check, upnpInfo, wifiInfo, classify, downloadTest, detectSaudiIsp, rankPathsByJitter };
