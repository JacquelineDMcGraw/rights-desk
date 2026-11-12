import { loadPayPalCredentials } from '../lib/credentials.mjs';
import { verifyPayPalAuthentication } from '../lib/paypal.mjs';

const credentials = loadPayPalCredentials();
try {
  const result = await verifyPayPalAuthentication();
  console.log(JSON.stringify({ ...result, credentialSource: credentials.source }, null, 2));
} catch (error) {
  // Print a fixed error code only; no credentials, HTTP headers, or token body.
  const allowed = ['PAYPAL_NOT_CONFIGURED', 'PAYPAL_NETWORK_ERROR', 'PAYPAL_AUTH_ERROR'];
  console.error(JSON.stringify({ mode: 'sandbox', authenticated: false, credentialSource: credentials.source,
    code: allowed.includes(error.code) ? error.code : 'PAYPAL_VERIFICATION_FAILED' }, null, 2));
  process.exitCode = 1;
}
