import { spawnSync } from 'node:child_process';

export const PAYPAL_KEYCHAIN_ACCOUNT = 'JacquelineDMcGraw';
export const PAYPAL_KEYCHAIN_SERVICES = Object.freeze({
  PAYPAL_CLIENT_ID: 'codex.rights-desk.paypal_sandbox_client_id',
  PAYPAL_CLIENT_SECRET: 'codex.rights-desk.paypal_sandbox_client_secret',
});

// Keep credentials in process memory. Never print Keychain output or combine
// credentials from different sources. Tests inject a reader and disable lookup.
export function loadPayPalCredentials({ env = process.env, platform = process.platform, run = spawnSync } = {}) {
  const fields = Object.keys(PAYPAL_KEYCHAIN_SERVICES);
  const present = fields.filter(field => Boolean(env[field]?.trim()));
  if (present.length === fields.length) return { source: 'environment', available: true };
  if (present.length) return { source: 'incomplete-environment', available: false };
  if (platform !== 'darwin' || env.RIGHTS_DESK_KEYCHAIN === '0' || env.CI) {
    return { source: 'none', available: false };
  }
  const values = {};
  for (const [field, service] of Object.entries(PAYPAL_KEYCHAIN_SERVICES)) {
    let result;
    try {
      result = run('/usr/bin/security', [
        'find-generic-password', '-a', PAYPAL_KEYCHAIN_ACCOUNT, '-s', service, '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 8192 });
    } catch {
      return { source: 'keychain-unavailable', available: false };
    }
    if (result.error || result.status !== 0 || !result.stdout?.trim()) {
      return { source: 'keychain-unavailable', available: false };
    }
    values[field] = result.stdout.trim();
  }
  Object.assign(env, values);
  return { source: 'keychain', available: true };
}
