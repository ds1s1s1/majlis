'use strict';
const test = require('node:test');
const assert = require('node:assert');

// The packaged app must not double as a Node runtime or a debug target (REA audit, v0.6.0).
test('release build flips the hardening fuses', () => {
  const { build } = require('../package.json');
  assert.deepStrictEqual(build.electronFuses, {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  });
});
