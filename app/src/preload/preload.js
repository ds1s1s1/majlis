'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The stream port (video, audio, cursor, input) is handed to the page as soon as it exists.
ipcRenderer.on('port', (e) => { window.postMessage('majlis-port', '*', [e.ports[0]]); });

contextBridge.exposeInMainWorld('majlis', {
  invoke: (ch, data) => ipcRenderer.invoke(ch, data),
  // the real path of a dropped file (File.path is gone in current Electron)
  pathFor: (file) => webUtils.getPathForFile(file),
  on: (fn) => { const h = (e, m) => fn(m); ipcRenderer.on('ev', h); return () => ipcRenderer.off('ev', h); },
});
