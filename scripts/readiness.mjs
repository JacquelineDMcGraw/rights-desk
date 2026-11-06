import { spawnSync } from 'node:child_process';
import { ollamaAvailable } from '../lib/ai.mjs';
import { paypalConfigured } from '../lib/paypal.mjs';

const available = binary => !spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 3000 }).error;
const modelReady = await ollamaAvailable();
const paypalReady = paypalConfigured();
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  node: process.version,
  ai: { model: process.env.OLLAMA_MODEL || 'gemma3:4b', available: modelReady, inferenceVerified: false },
  paypal: { mode: 'sandbox', credentialsPresent: paypalReady, captureVerified: false },
  optionalTools: Object.fromEntries(['magick', 'exiftool', 'c2patool'].map(binary => [binary, available(binary)])),
}, null, 2));
if (!modelReady) console.log('AI: start Ollama and make the configured model available. Run npm run verify:ai to test inference.');
if (!paypalReady) console.log('PayPal: configure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET privately in .env or the server environment.');
console.log('Readiness reports availability only. A real Sandbox checkout must be approved and captured before recording a successful PayPal demo.');
