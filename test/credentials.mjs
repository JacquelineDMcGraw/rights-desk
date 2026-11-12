import assert from 'node:assert/strict';
import { loadPayPalCredentials, PAYPAL_KEYCHAIN_ACCOUNT, PAYPAL_KEYCHAIN_SERVICES } from '../lib/credentials.mjs';

const forbidden = () => { throw new Error('Unexpected Keychain access'); };
const existing = { PAYPAL_CLIENT_ID: 'test-id', PAYPAL_CLIENT_SECRET: 'test-secret' };
assert.equal(loadPayPalCredentials({ env: existing, platform: 'darwin', run: forbidden }).source, 'environment');
const partial = { PAYPAL_CLIENT_ID: 'test-id' };
assert.equal(loadPayPalCredentials({ env: partial, platform: 'darwin', run: forbidden }).available, false);
assert.equal(partial.PAYPAL_CLIENT_SECRET, undefined);
for (const options of [{ env: { RIGHTS_DESK_KEYCHAIN: '0' }, platform: 'darwin' }, { env: {}, platform: 'linux' }, { env: { CI: 'true' }, platform: 'darwin' }]) {
  assert.equal(loadPayPalCredentials({ ...options, run: forbidden }).available, false);
}
const env = {};
const calls = [];
const success = loadPayPalCredentials({ env, platform: 'darwin', run: (binary, args, options) => {
  calls.push(args);
  assert.equal(binary, '/usr/bin/security');
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(args[2], PAYPAL_KEYCHAIN_ACCOUNT);
  return { status: 0, stdout: calls.length === 1 ? 'test-id\n' : 'test-secret\n' };
} });
assert.deepEqual(success, { source: 'keychain', available: true });
assert.deepEqual(env, existing);
assert.deepEqual(calls.map(args => args[4]), Object.values(PAYPAL_KEYCHAIN_SERVICES));
for (const failure of [{ status: 44, stdout: '' }, { status: 0, stdout: '\n' }, { status: null, error: new Error('timed out') }]) {
  let reads = 0;
  const failedEnv = {};
  const result = loadPayPalCredentials({ env: failedEnv, platform: 'darwin', run: () => ++reads === 1 ? { status: 0, stdout: 'test-id\n' } : failure });
  assert.equal(result.available, false);
  assert.deepEqual(failedEnv, {}, 'A failed pair must not partially change the environment');
  assert.equal(JSON.stringify(result).includes('test-id'), false);
}
assert.equal(loadPayPalCredentials({ env: {}, platform: 'darwin', run: forbidden }).available, false);
console.log('Credential source isolation, atomic Keychain loading, and safe status checks passed.');
