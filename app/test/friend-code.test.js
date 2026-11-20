'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { encodeSignedFriendCode, verifySignedFriendCode } = require('../src/main/social');

test('friend-code: Ed25519 signed URI and MAJLIS-F1 compact codes verify offline and reject tampering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-fc-'));
  try {
    const st = new Store(dir);
    st.setSocialProfile({ displayName: 'Faisal', handle: '@faisal_k', accent: '#3e63dd' });
    const myId = st.identity().id;

    const uri = encodeSignedFriendCode(st, { compact: false });
    assert.ok(uri.startsWith(`majlis://friend/${myId}?`));
    const parsedUri = verifySignedFriendCode(uri);
    assert.ok(parsedUri);
    assert.strictEqual(parsedUri.id, myId);
    assert.strictEqual(parsedUri.name, 'Faisal');
    assert.strictEqual(parsedUri.handle, 'faisal_k');
    assert.strictEqual(parsedUri.accent, '#3e63dd');
    assert.strictEqual(parsedUri.pkB64, st.identity().pkB64);

    const compact = encodeSignedFriendCode(st, { compact: true });
    assert.ok(compact.startsWith('MAJLIS-F1:'));
    const parsedCompact = verifySignedFriendCode(compact);
    assert.strictEqual(parsedCompact.id, myId);
    assert.strictEqual(parsedCompact.handle, 'faisal_k');

    // Tampered parameter / forged ID must fail Ed25519 verification
    assert.strictEqual(verifySignedFriendCode(uri.replace('Faisal', 'Evil')), null);
    assert.strictEqual(verifySignedFriendCode(uri.replace(myId, myId === '123456789' ? '987654321' : '123456789')), null);
    assert.strictEqual(verifySignedFriendCode(`majlis://friend/${myId}`), null);
    assert.strictEqual(verifySignedFriendCode('MAJLIS-F1:not_valid_base64'), null);
    st.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('qrEncode: generates valid square finder-patterned QR matrices across V1..V14 including signed friend codes', async () => {
  const { encodeQrMatrix } = await import('../media/src/utils/qrEncode.ts');
  const small = encodeQrMatrix('majlis://friend/123456789');
  assert.ok(small.size >= 25 && small.size <= 33);
  assert.strictEqual(small.rows.length, small.size);
  assert.strictEqual(small.rows[0].length, small.size);

  // Top-left finder pattern outer 7x7 corners must be dark
  assert.strictEqual(small.rows[0][0], true);
  assert.strictEqual(small.rows[0][6], true);
  assert.strictEqual(small.rows[6][0], true);
  assert.strictEqual(small.rows[6][6], true);
  assert.strictEqual(small.rows[1][1], false);
  // Dark module invariant at (size - 8, 8)
  assert.strictEqual(small.rows[small.size - 8][8], true);

  // Realistic ~220-char signed P2P friend code fits cleanly (Version <= 14)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-qr-'));
  try {
    const st = new Store(dir);
    st.setSocialProfile({ displayName: 'Abdulrahman', handle: 'abdulrahman_99' });
    const signed = encodeSignedFriendCode(st);
    const large = encodeQrMatrix(signed);
    assert.ok(large.size >= 45 && large.size <= 73, `unexpected QR size ${large.size} for len=${signed.length}`);
    assert.strictEqual(large.rows[large.size - 8][8], true);
    st.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
