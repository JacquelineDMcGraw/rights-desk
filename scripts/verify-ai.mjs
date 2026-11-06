import assert from 'node:assert/strict';
import { makeQuote, ollamaAvailable } from '../lib/ai.mjs';

assert.equal(await ollamaAvailable(), true, 'Start Ollama with the configured model before verifying AI.');
const request = 'A one year national editorial article on our magazine website';
const started = Date.now();
const quote = await makeQuote(request, 75);
assert.equal(quote.aiMode, 'ollama', 'The request fell back to rules; AI inference was not verified.');
assert.equal(quote.usage, 'editorial');
assert.equal(quote.term, 'one-year');
assert.equal(quote.territory, 'national');
assert.equal(quote.amount, '168.75');
assert.deepEqual(quote.assumptions, []);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), model: process.env.OLLAMA_MODEL || 'gemma3:4b', request, quote, elapsedMs: Date.now() - started }, null, 2));
