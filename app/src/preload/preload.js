'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Strict allowlist of renderer -> main IPC channels (least privilege with sandbox: true)
const ALLOWED_INVOKE = new Set([
  'app:relaunch',
  'cancel', 'chat', 'clip:send-guest', 'clip:send-host', 'connect', 'copy',
  'datasaver', 'displays', 'ffmpeg:get', 'friend', 'friend:remove', 'fullscreen',
  'games:add', 'games:launch', 'games:scan', 'games:update', 'guest:ctrl',
  'helper:ensure', 'host:chatmute', 'host:code', 'host:decide', 'host:enable',
  'host:expiry', 'host:hotseat', 'host:kick', 'host:mute', 'host:pads-reset', 'host:panic',
  'host:pass', 'host:privacy', 'host:role', 'host:slot', 'host:source', 'host:watch-control',
  'identity:new', 'invite', 'leave', 'local:view', 'logs',
  'media:close', 'media:friends-on', 'media:letterboxd-import', 'media:play',
  'mini', 'mode', 'movie:ctl', 'movie:open', 'movie:pick', 'movie:sub-file',
  'net:isp-bench', 'netcheck', 'open', 'party:end', 'party:info', 'party:preset-del', 'party:preset-launch', 'party:preset-save', 'party:presets', 'party:start', 'perms', 'pick:file',
  'player:cmd', 'player:next', 'quit', 'react', 'ready:check', 'ready:go', 'replay:save',
  'routerlock', 'settings', 'shot', 'show-file', 'sources', 'state', 'vigem',
  'vote:cast', 'vote:clear', 'vote:nominate', 'vote:room', 'vote:winner',
  'win:close', 'win:is-maximized', 'win:maximize', 'win:minimize', 'windows',
  // Backup & Clipboard/Export helpers
  'backup:create', 'backup:delete', 'backup:list', 'backup:mirror', 'backup:open-dir', 'backup:restore',
  'clipboard:write-image', 'file:save-png',
  // Cinema hub channels
  'cin:addon-install', 'cin:addon-move', 'cin:addon-refresh', 'cin:addon-remove', 'cin:addon-toggle', 'cin:addon-check-url',
  'cin:addons', 'cin:addons-ping', 'cin:anime-hub', 'cin:anime-trending', 'cin:brand-catalog', 'cin:cache-clear', 'cin:cache-stats',
  'cin:calendar', 'cin:caps', 'cin:catalog', 'cin:cinema-stats', 'cin:cloud-list', 'cin:cloud-resolve', 'cin:collection', 'cin:continue', 'cin:continue-dismiss',
  'cin:custom-list-create', 'cin:custom-list-delete', 'cin:custom-list-rename', 'cin:custom-list-reorder', 'cin:custom-list-toggle', 'cin:custom-lists',
  'cin:diagnostics-heal', 'cin:diagnostics-run', 'cin:discover', 'cin:dl-add', 'cin:dl-clear-done', 'cin:dl-config', 'cin:dl-folder', 'cin:dl-folder-pick', 'cin:dl-list',
  'cin:dl-pause', 'cin:dl-pause-all', 'cin:dl-remove', 'cin:dl-reorder', 'cin:dl-resume', 'cin:dl-resume-all', 'cin:drop-file', 'cin:entity-catalog', 'cin:export-data', 'cin:history',
  'cin:home-prefs', 'cin:home-prefs-set', 'cin:hs-items', 'cin:hs-list', 'cin:hs-remove', 'cin:hs-save', 'cin:hs-stream', 'cin:hs-test', 'cin:hs-watched',
  'cin:image-data-url', 'cin:import-data', 'cin:incognito-set', 'cin:keys', 'cin:keys-set',
  'cin:lib-add', 'cin:library', 'cin:library-audit', 'cin:library-repair', 'cin:lib-mark-prev', 'cin:lib-remove', 'cin:lib-rewind', 'cin:lib-season', 'cin:lib-toggle', 'cin:lib-watched',
  'cin:lists', 'cin:local-match', 'cin:local-scan', 'cin:marathons', 'cin:meta', 'cin:notifications',
  'cin:notif-read', 'cin:notif-test', 'cin:p2p-status', 'cin:person', 'cin:person-track-list', 'cin:person-track-toggle', 'cin:play-url', 'cin:player-probes', 'cin:prefetch', 'cin:prefs', 'cin:prefs-set',
  'cin:profile-remove', 'cin:profile-use', 'cin:queue-sync', 'cin:quickplay', 'cin:rows', 'cin:search',
  'cin:search-people', 'cin:season', 'cin:song-clear', 'cin:song-get', 'cin:song-set',
  'cin:store', 'cin:store-categories', 'cin:streams', 'cin:stremio-login', 'cin:stremio-logout',
  'cin:stremio-sync', 'cin:subtitles', 'cin:torrent-health', 'cin:tracker-import', 'cin:tracker-out',
  'cin:trackers', 'cin:tracker-start', 'cin:trending', 'cin:tune', 'cin:tune-set', 'cin:upcoming',
  'cin:updater-check',
  // Social & profile channels
  'social:accept', 'social:add', 'social:block', 'social:brb', 'social:comment-add', 'social:comment-del',
  'social:compare', 'social:cursor', 'social:decline', 'social:friends', 'social:me',
  'social:me-set', 'social:party-chat', 'social:party-history', 'social:party-history-del',
  'social:profile', 'social:profile-save', 'social:rate', 'social:remove', 'social:room',
  'social:note-add', 'social:note-del', 'social:similar',
  'social:swipe-start', 'social:swipe-vote', 'social:taste', 'social:wheel-spin', 'social:wrapped',
]);

// The stream port (video, audio, cursor, input) is handed to the page as soon as it exists.
ipcRenderer.on('port', (e) => { window.postMessage('majlis-port', '*', [e.ports[0]]); });

contextBridge.exposeInMainWorld('majlis', {
  invoke: (ch, data) => {
    if (typeof ch !== 'string' || !ALLOWED_INVOKE.has(ch)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${String(ch)}`));
    }
    return ipcRenderer.invoke(ch, data);
  },
  // the real path of a dropped file (File.path is gone in current Electron)
  pathFor: (file) => webUtils.getPathForFile(file),
  on: (fn) => { const h = (e, m) => fn(m); ipcRenderer.on('ev', h); return () => ipcRenderer.off('ev', h); },
});
