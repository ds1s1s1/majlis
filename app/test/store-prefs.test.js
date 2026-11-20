'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');

test('store: ingests installer_prefs.json on first boot only and does not overwrite existing settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-instprefs-'));
  const prefsPath = path.join(dir, 'installer_prefs.json');
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({
      language: 'en',
      launchStartup: true,
      optionalComponents: ['opt_gamepad', 'opt_discord'],
      cinemaTheme: 'nord',
    }), 'utf8');

    const userDir = path.join(dir, 'userdata1');
    const st1 = new Store(userDir, null, { installerPrefsPath: prefsPath });
    assert.equal(st1.get('lang'), 'en');
    assert.equal(st1.get('launchOnStartup'), true);
    assert.equal(st1.get('discordPresence'), true);
    assert.equal(st1.get('cinemaTheme'), 'nord');
    assert.deepEqual(st1.get('installerOptionalComponents'), ['opt_gamepad', 'opt_discord']);
    assert.equal(st1.get('installerPrefsApplied'), true);
    st1.flush();

    // Mutate user settings and verify reloading Store does not re-apply installer_prefs.json
    st1.set('lang', 'ar');
    st1.flush();
    const st1Reload = new Store(userDir, null, { installerPrefsPath: prefsPath });
    assert.equal(st1Reload.get('lang'), 'ar');
    st1Reload.flush();

    // Existing majlis.json without installerPrefsApplied also preserves existing user settings
    const userDir2 = path.join(dir, 'userdata2');
    fs.mkdirSync(userDir2, { recursive: true });
    fs.writeFileSync(path.join(userDir2, 'majlis.json'), JSON.stringify({
      settings: { lang: 'ar', launchOnStartup: false },
    }), 'utf8');
    const st2 = new Store(userDir2, null, { installerPrefsPath: prefsPath });
    assert.equal(st2.get('lang'), 'ar');
    assert.equal(st2.get('launchOnStartup'), false);
    assert.equal(st2.get('installerPrefsApplied'), true);
    st2.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preload: ALLOWED_INVOKE includes window control channels win:minimize/maximize/close/is-maximized', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
  for (const ch of ['win:minimize', 'win:maximize', 'win:close', 'win:is-maximized']) {
    assert.ok(src.includes(`'${ch}'`), `preload ALLOWED_INVOKE missing ${ch}`);
  }
});
