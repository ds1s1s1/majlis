'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

test('cinema strings: ar and en have the same keys and placeholders', async () => {
  const { STR } = await import(pathToFileURL(path.join(__dirname, '../media/src/i18n.ts')).href);
  assert.deepStrictEqual(Object.keys(STR.ar).sort(), Object.keys(STR.en).sort());
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(STR.en)) assert.strictEqual(vars(STR.ar[k]), vars(STR.en[k]), k);
});
