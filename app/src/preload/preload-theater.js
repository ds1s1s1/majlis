'use strict';
// Strict allowlisted preload for the Theater overlay window: zero access to host/game/system IPC.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'state',
  'player:cmd',
  'player:next',
  'party:info',
  'party:start',
  'party:end',
  'ready:ack',
  'ready:check',
  'ready:go',
  'cin:streams',
  'cin:subtitles',
  'cin:meta',
  'cin:torrent-health',
  'social:brb',
  'social:rate',
  'social:room',
  'social:similar',
  'vote:nominate',
  'cin:queue-sync',
  'theater:html5-event',
  'win:start-drag',
  'win:minimize',
  'win:maximize',
  'win:close',
  'win:is-maximized',
  'mini',
  'shot',
  'show-file',
  'copy',
  'fullscreen',
]);

contextBridge.exposeInMainWorld('majlis', {
  invoke: (ch, data) => {
    if (!ALLOWED_INVOKE.has(ch)) return Promise.reject(new Error(`blocked ipc: ${ch}`));
    return ipcRenderer.invoke(ch, data);
  },
  on: (fn) => {
    const h = (_e, m) => fn(m);
    ipcRenderer.on('ev', h);
    return () => ipcRenderer.off('ev', h);
  },
});
