'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The stream port (video, audio, cursor, input) is handed to the page as soon as it exists.
ipcRenderer.on('port', (e) => { window.postMessage('majlis-port', '*', [e.ports[0]]); });

contextBridge.exposeInMainWorld('majlis', {
  invoke: (ch, data) => ipcRenderer.invoke(ch, data),
  on: (fn) => { const h = (e, m) => fn(m); ipcRenderer.on('ev', h); return () => ipcRenderer.off('ev', h); },
});
