import { spawnSync } from 'node:child_process';
import { ollamaAvailable } from '../lib/ai.mjs';
import { paypalConfigured } from '../lib/paypal.mjs';
import { loadPayPalCredentials } from '../lib/credentials.mjs';

const credentials = loadPayPalCredentials();
const available = binary => !spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 3000 }).error;
const modelReady = await ollamaAvailable();
const paypalReady = paypalConfigured();
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  node: process.version,
  ai: { model: process.env.OLLAMA_MODEL || 'gemma3:4b', available: modelReady, inferenceVerified: false },
  paypal: { mode: 'sandbox', credentialsPresent: paypalReady, credentialSource: credentials.source, captureVerified: false },
  optionalTools: Object.fromEntries(['magick', 'exiftool', 'c2patool'].map(binary => [binary, available(binary)])),
}, null, 2));
if (!modelReady) console.log('AI: start Ollama and make the configured model available. Run npm run verify:ai to test inference.');
if (!paypalReady) console.log('PayPal: configure both credentials in the server environment or the documented macOS Keychain entries.');
console.log('Readiness reports availability only. A real Sandbox checkout must be approved and captured before recording a successful PayPal demo.');
