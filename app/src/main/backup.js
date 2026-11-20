'use strict';
// Scheduled local auto-backup (weekly default) & 1-click snapshot restore.
// Stores atomic `.json.gz` snapshots inside `userData/backups/` with pre-restore safety capture.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WEEK_MS = 7 * 86400000;
const CHECK_MS = 12 * 3600 * 1000;
const BLOCKED_SETTINGS = new Set(['accessKey', 'discordWebhookUrl', 'telegramBotToken', 'mediaKeys']);

function sanitizeHomeServers(list) {
  if (!Array.isArray(list)) return [];
  return list.map((srv) => {
    if (!srv || typeof srv !== 'object') return srv;
    const { apiKeyEnc, apiKey, ...rest } = srv;
    return rest;
  });
}

function sanitizeMirrorSettings(v) {
  if (!v || typeof v !== 'object') return v;
  const copy = JSON.parse(JSON.stringify(v));
  if (copy.sources?.search && typeof copy.sources.search === 'object') copy.sources.search.aiApiKey = '';
  if (copy.system && typeof copy.system === 'object') {
    copy.system.discordWebhookUrl = '';
    copy.system.telegramBotToken = '';
  }
  return copy;
}

function sanitizeStoreData(raw = {}) {
  const settings = {};
  for (const [k, v] of Object.entries(raw.settings || {})) {
    if (BLOCKED_SETTINGS.has(k) || k.startsWith('oauth_') || k.startsWith('stremioKey')) continue;
    settings[k] = k === 'homeServers' ? sanitizeHomeServers(v) : v;
  }
  const extra = {};
  for (const [k, v] of Object.entries(raw)) {
    if (['identity', 'settings', 'friends', 'friendRequests', 'friendProfiles', 'socialProfiles', 'handleDir', 'games', 'peaks', 'partyHistory'].includes(k)) continue;
    if (k.startsWith('stremioKey') || k.startsWith('oauth_')) continue;
    extra[k] = v;
  }
  return {
    settings,
    friends: Array.isArray(raw.friends) ? raw.friends : [],
    friendRequests: Array.isArray(raw.friendRequests) ? raw.friendRequests : [],
    friendProfiles: raw.friendProfiles && typeof raw.friendProfiles === 'object' ? raw.friendProfiles : {},
    socialProfiles: raw.socialProfiles && typeof raw.socialProfiles === 'object' ? raw.socialProfiles : {},
    handleDir: raw.handleDir && typeof raw.handleDir === 'object' ? raw.handleDir : {},
    games: Array.isArray(raw.games) ? raw.games : [],
    partyHistory: Array.isArray(raw.partyHistory) ? raw.partyHistory : [],
    extra,
  };
}

class BackupManager {
  constructor({ store, dataDir, reloadLibs = () => {} }) {
    this.store = store;
    this.dataDir = dataDir;
    this.reloadLibs = reloadLibs;
    this.timer = null;
    this.bootTimer = null;
  }

  dir() {
    const custom = String(this.store.get('backupDir') || '').trim();
    const d = custom && path.isAbsolute(custom) ? custom : path.join(this.dataDir, 'backups');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  _mirrorPath() {
    return path.join(this.dir(), '.renderer-mirror.json');
  }

  readMirror() {
    try { return JSON.parse(fs.readFileSync(this._mirrorPath(), 'utf8')); } catch { return { settingsV2: null, profileV1: null }; }
  }

  mirror({ settingsV2, profileV1 } = {}) {
    const cur = this.readMirror();
    const cleanSettings = settingsV2 && typeof settingsV2 === 'object' ? sanitizeMirrorSettings(settingsV2) : sanitizeMirrorSettings(cur.settingsV2);
    const next = {
      settingsV2: cleanSettings,
      profileV1: profileV1 && typeof profileV1 === 'object' ? profileV1 : cur.profileV1,
      updatedAt: Date.now(),
    };
    const fp = this._mirrorPath();
    fs.writeFileSync(`${fp}.tmp`, JSON.stringify(next));
    fs.renameSync(`${fp}.tmp`, fp);
    return true;
  }

  _collectLibraries() {
    const profiles = ['default', ...(this.store.d?.mediaProfiles || [])];
    const libs = {};
    for (const prof of profiles) {
      const safe = String(prof || 'default').replace(/[^\w-]/g, '_');
      const file = path.join(this.dataDir, 'media', safe, 'library.json');
      try {
        if (fs.existsSync(file)) libs[safe] = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {}
    }
    return libs;
  }

  create({ reason = 'manual', nowMs = Date.now() } = {}) {
    const dir = this.dir();
    const d = new Date(nowMs);
    const stamp = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const id = `majlis-backup-${stamp}-${reason.replace(/[^\w-]/g, '')}.json.gz`;
    const filePath = path.join(dir, id);

    const storeSnap = sanitizeStoreData(this.store.d || {});
    const libraries = this._collectLibraries();
    const rawMirror = this.readMirror();
    const mirror = { ...rawMirror, settingsV2: sanitizeMirrorSettings(rawMirror.settingsV2) };

    let libraryItemsCount = 0;
    for (const lib of Object.values(libraries)) libraryItemsCount += Object.keys(lib?.items || {}).length;
    let ratingsCount = Array.isArray(mirror.profileV1?.ratings) ? mirror.profileV1.ratings.length : 0;
    for (const sp of Object.values(storeSnap.socialProfiles || {})) {
      if (Array.isArray(sp?.ratings)) ratingsCount = Math.max(ratingsCount, sp.ratings.length);
    }

    const meta = {
      id,
      reason,
      createdAt: nowMs,
      profilesCount: Object.keys(libraries).length,
      libraryItemsCount,
      ratingsCount,
      partyHistoryCount: storeSnap.partyHistory.length,
    };

    const payload = { v: 1, meta, store: storeSnap, libraries, mirror };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    fs.writeFileSync(`${filePath}.tmp`, gz);
    fs.renameSync(`${filePath}.tmp`, filePath);

    if (reason !== 'pre-restore') this.store.set('lastBackupAt', nowMs);
    this.rotate();
    return { ...meta, sizeBytes: gz.length, filePath };
  }

  rotate() {
    const keep = Math.max(1, Math.min(30, Number(this.store.get('autoBackupKeep')) || 6));
    const list = this.list().filter((x) => x.reason !== 'pre-restore');
    if (list.length <= keep) return 0;
    let deleted = 0;
    for (const old of list.slice(keep)) {
      if (this.delete(old.id)) deleted++;
    }
    return deleted;
  }

  list() {
    const dir = this.dir();
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.json.gz')) continue;
      const fp = path.join(dir, ent.name);
      try {
        const st = fs.statSync(fp);
        const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString('utf8'));
        const meta = parsed?.meta || {};
        out.push({
          id: ent.name,
          reason: meta.reason || 'manual',
          createdAt: Number(meta.createdAt) || Math.round(st.mtimeMs),
          sizeBytes: st.size,
          profilesCount: meta.profilesCount || Object.keys(parsed?.libraries || {}).length,
          libraryItemsCount: meta.libraryItemsCount || 0,
          ratingsCount: meta.ratingsCount || 0,
          partyHistoryCount: meta.partyHistoryCount || 0,
        });
      } catch {}
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  resolveBackupPath(id) {
    const raw = String(id || '');
    if (!/^[a-zA-Z0-9._-]+\.json\.gz$/.test(raw)) throw new Error('invalid_backup_id');
    const baseDir = path.resolve(this.dir());
    const fp = path.resolve(baseDir, raw);
    const rel = path.relative(baseDir, fp);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('invalid_backup_id');
    return { safeName: raw, fp };
  }

  restore(id) {
    const { safeName, fp } = this.resolveBackupPath(id);
    if (!fs.existsSync(fp)) throw new Error('backup_not_found');
    const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.store) throw new Error('invalid_backup_file');

    // Safety net: snapshot current state before overwriting
    const pre = this.create({ reason: 'pre-restore' });

    const stSnap = parsed.store;
    const preserveIdentity = this.store.d.identity;
    const preserveAccessKey = this.store.d.settings.accessKey;
    const preserveWebhook = this.store.d.settings.discordWebhookUrl;
    const preserveTg = this.store.d.settings.telegramBotToken;
    const preserveMediaKeys = this.store.d.settings.mediaKeys;
    const prevServerKeys = new Map(
      (Array.isArray(this.store.d.settings.homeServers) ? this.store.d.settings.homeServers : [])
        .filter((s) => s?.id && s.apiKeyEnc)
        .map((s) => [s.id, s.apiKeyEnc]),
    );

    const restoredSettings = { ...(stSnap.settings || {}) };
    if (Array.isArray(restoredSettings.homeServers)) {
      restoredSettings.homeServers = restoredSettings.homeServers.map((s) => (
        s?.id && !s.apiKeyEnc && prevServerKeys.has(s.id) ? { ...s, apiKeyEnc: prevServerKeys.get(s.id) } : s
      ));
    }

    this.store.d.settings = {
      ...this.store.d.settings,
      ...restoredSettings,
      accessKey: preserveAccessKey,
      discordWebhookUrl: preserveWebhook,
      telegramBotToken: preserveTg,
      mediaKeys: preserveMediaKeys,
    };
    this.store.d.identity = preserveIdentity;
    if (Array.isArray(stSnap.friends)) this.store.d.friends = stSnap.friends;
    if (Array.isArray(stSnap.friendRequests)) this.store.d.friendRequests = stSnap.friendRequests;
    if (stSnap.friendProfiles) this.store.d.friendProfiles = stSnap.friendProfiles;
    if (stSnap.socialProfiles) this.store.d.socialProfiles = stSnap.socialProfiles;
    if (stSnap.handleDir) this.store.d.handleDir = stSnap.handleDir;
    if (Array.isArray(stSnap.games)) this.store.d.games = stSnap.games;
    if (Array.isArray(stSnap.partyHistory)) this.store.d.partyHistory = stSnap.partyHistory;
    for (const [k, v] of Object.entries(stSnap.extra || {})) {
      if (!k.startsWith('stremioKey') && !k.startsWith('oauth_')) this.store.d[k] = v;
    }
    this.store.flush();

    for (const [prof, libData] of Object.entries(parsed.libraries || {})) {
      const safeProf = String(prof || 'default').replace(/[^\w-]/g, '_');
      const target = path.join(this.dataDir, 'media', safeProf, 'library.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(libData));
      fs.renameSync(`${target}.tmp`, target);
    }
    this.reloadLibs();

    const mirror = parsed.mirror || {};
    this.mirror({ settingsV2: mirror.settingsV2, profileV1: mirror.profileV1 });
    return {
      ok: true,
      restoredId: safeName,
      preRestoreId: pre.id,
      settingsV2: sanitizeMirrorSettings(mirror.settingsV2) || null,
      profileV1: mirror.profileV1 || null,
    };
  }

  delete(id) {
    let fp;
    try { ({ fp } = this.resolveBackupPath(id)); } catch { return false; }
    if (!fs.existsSync(fp)) return false;
    fs.unlinkSync(fp);
    return true;
  }

  maybeRunScheduled(nowMs = Date.now()) {
    if (this.store.get('autoBackupEnabled') === false) return null;
    const days = Math.max(1, Number(this.store.get('autoBackupIntervalDays')) || 7);
    const intervalMs = days * 86400000;
    const last = Number(this.store.get('lastBackupAt')) || 0;
    if (nowMs - last < intervalMs) return null;
    return this.create({ reason: 'scheduled', nowMs });
  }

  startScheduler() {
    this.stopScheduler();
    this.bootTimer = setTimeout(() => { try { this.maybeRunScheduled(); } catch {} }, 20000);
    this.bootTimer.unref?.();
    this.timer = setInterval(() => { try { this.maybeRunScheduled(); } catch {} }, CHECK_MS);
    this.timer.unref?.();
  }

  stopScheduler() {
    clearTimeout(this.bootTimer);
    clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
  }
}

module.exports = { BackupManager, WEEK_MS, sanitizeStoreData };
