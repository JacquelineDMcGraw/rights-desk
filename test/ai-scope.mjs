import assert from 'node:assert/strict';

// Simulate a valid but mistaken model response to test the trust boundary:
// clearly stated rights must survive model mistakes and pricing stays fixed.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => Response.json({ message: { content: JSON.stringify({
  usage: 'commercial', term: 'perpetual', territory: 'worldwide',
  explicitUsage: false, explicitTerm: false, explicitTerritory: false,
}) } });
try {
  const { makeQuote } = await import('../lib/ai.mjs');
  const quote = await makeQuote('A one year national editorial article', 75);
  assert.equal(quote.aiMode, 'ollama');
  assert.equal(quote.usage, 'editorial');
  assert.equal(quote.term, 'one-year');
  assert.equal(quote.territory, 'national');
  assert.equal(quote.amount, '168.75');
  assert.deepEqual(quote.assumptions, []);
  globalThis.fetch = async () => { throw new Error('Model offline'); };
  const fallback = await makeQuote('Local one-time editorial article', 75);
  assert.equal(fallback.aiMode, 'rules');
  assert.equal(fallback.amount, '75.00');
  console.log('AI scope: explicit rights preserved, deterministic pricing, and labeled offline fallback passed.');
} finally {
  globalThis.fetch = originalFetch;
}
