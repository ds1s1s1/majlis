'use strict';
// Boots official stremio-server server.js under Majlis's isolated loopback port without colliding
// with official Stremio Desktop (11470 / 12470), and exits immediately when parent stdin closes.
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const https = require('https');

const basePort = Math.max(1024, Math.min(65500, Number(process.env.MAJLIS_STREMIO_PORT) || 11475));
const serverJs = path.resolve(process.env.MAJLIS_STREMIO_SERVER || path.join(__dirname, 'server.js'));
const appPath = process.env.APP_PATH ? path.resolve(process.env.APP_PATH) : '';
if (appPath) {
  try { fs.mkdirSync(appPath, { recursive: true }); } catch {}
}

process.env.NO_CORS = '1';
process.env.CASTING_DISABLED = '1';
process.env.NO_NETWORK_INTERFACES = '1';

// Quit deterministically when Electron closes our stdin pipe or exits unexpectedly
process.stdin.resume();
const cleanExit = () => { try { process.exit(0); } catch {} };
process.stdin.on('end', cleanExit);
process.stdin.on('close', cleanExit);
process.on('SIGTERM', cleanExit);
process.on('SIGINT', cleanExit);

function canBindLoopback(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      const addr = probe.address();
      const chosen = addr && typeof addr === 'object' ? addr.port : port;
      probe.close(() => resolve(chosen));
    });
  });
}

async function pickFreeLoopbackPort() {
  for (let p = basePort; p <= basePort + 25; p++) {
    const bound = await canBindLoopback(p);
    if (bound) return bound;
  }
  const ephem = await canBindLoopback(0);
  if (ephem) return ephem;
  return basePort;
}

(async () => {
  const chosenPort = await pickFreeLoopbackPort();
  process.env.PORT = String(chosenPort);

  const origHttpListen = http.Server.prototype.listen;
  let announced = false;
  http.Server.prototype.listen = function patchedHttpListen(...args) {
    const first = args[0];
    const portArg = typeof first === 'object' && first ? Number(first.port) : Number(first);
    if (portArg >= 11470 && portArg <= 11474) {
      const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
      this.once('listening', () => {
        if (!announced) {
          announced = true;
          const a = this.address();
          const actual = a && typeof a === 'object' ? a.port : chosenPort;
          process.stdout.write(`MAJLIS_STREMIO_READY ${actual}\n`);
        }
      });
      return origHttpListen.call(this, chosenPort, '127.0.0.1', cb);
    }
    return origHttpListen.apply(this, args);
  };

  // Never bind 12470 so official Stremio Desktop (if installed) never collides on HTTPS
  https.Server.prototype.listen = function blockedHttpsListen() {
    return this;
  };

  require(serverJs);
})().catch((err) => {
  process.stderr.write(`stremio-launcher fatal: ${err?.stack || err?.message || err}\n`);
  process.exit(1);
});
