import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePassword, normalizeEmail, validateFullName, sha256, cookieOptions } from '../server/security.js';

test('scrypt hashes are salted, verify correctly, and never equal the password', async () => {
  const password = 'A strong MoneyTrack 2026!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt\$131072,8,1\$/);
  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword(password, 'not-a-hash'), false);
});

test('normal passwords require length and non-obvious composition while bootstrap allows numeric temporary secret', () => {
  assert.throws(() => validatePassword('123456789012'), (error) => error.code === 'WEAK_PASSWORD');
  assert.throws(() => validatePassword('passwordpassword'), (error) => error.code === 'WEAK_PASSWORD');
  assert.equal(validatePassword('123456', { bootstrap: true }), true);
  assert.throws(() => validatePassword('123456'), (error) => error.code === 'WEAK_PASSWORD');
  assert.equal(validatePassword('Correct Horse 2026!'), true);
});

test('identity validation normalizes email and rejects malformed values', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
  assert.throws(() => normalizeEmail('not-an-email'), (error) => error.code === 'INVALID_EMAIL');
  assert.equal(validateFullName('  MoneyTrack Owner  '), 'MoneyTrack Owner');
  assert.throws(() => validateFullName(''), (error) => error.code === 'INVALID_NAME');
});

test('session material uses one-way token hashing and explicit local cookie mode', () => {
  assert.equal(sha256('token').length, 64);
  const previous = process.env.MONEYTRACK_LOCAL_HTTP;
  delete process.env.MONEYTRACK_LOCAL_HTTP;
  assert.deepEqual(cookieOptions().sameSite, 'none');
  assert.equal(cookieOptions().secure, true);
  process.env.MONEYTRACK_LOCAL_HTTP = 'true';
  assert.deepEqual(cookieOptions().sameSite, 'lax');
  assert.equal(cookieOptions().secure, false);
  if (previous === undefined) delete process.env.MONEYTRACK_LOCAL_HTTP; else process.env.MONEYTRACK_LOCAL_HTTP = previous;
});
