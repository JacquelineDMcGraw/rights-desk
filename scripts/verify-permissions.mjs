import assert from 'node:assert/strict';
import { comparePermissions } from '../lib/permission-comparison.mjs';

const permissionText = 'The photographer grants Harbor Studio permission to use three photographs on its own website for one year in the United States. Paid advertising, social media advertising, and merchandise are excluded. Copyright remains with the photographer.';
const requestText = 'We would also like to use those three photographs in paid Instagram advertisements for our next campaign.';
const started = Date.now();
const comparison = await comparePermissions({ permissionText, requestText });
assert.equal(comparison.aiMode, 'ollama', 'Actual model comparison was not verified. Start Ollama with the configured model.');
assert.equal(comparison.findings.length, 4);
assert.ok(comparison.findings.some(row => row.assessment === 'changed' && row.baselineQuote && row.requestQuote), 'No grounded change was identified.');
for (const dimension of ['channels', 'duration', 'territory']) {
  assert.ok(comparison.findings.find(row => row.dimension === dimension)?.baselineQuote,
    `The existing ${dimension} passage should remain visible even when the new request omits it.`);
}
assert.ok(comparison.questions.some(question => question.id === 'duration'), 'Missing requested duration should remain a question.');
assert.ok(comparison.questions.some(question => question.id === 'territory'), 'Missing requested territory should remain a question.');
const clarified = await comparePermissions({ permissionText, requestText, answers: {
  purpose: 'Paid advertising for Harbor Studio’s next campaign',
  channels: 'Instagram advertisements only',
  duration: 'Six months from the payment confirmation date',
  territory: 'United States only',
} });
assert.equal(clarified.proposedChange.duration, 'Six months from the payment confirmation date');
assert.equal(clarified.proposedChange.territory, 'United States only');
assert.equal(clarified.questions.length, 0, 'Explicit scope answers should resolve the questions.');
console.log(JSON.stringify({
  verifiedAt: new Date().toISOString(), model: process.env.OLLAMA_MODEL || 'gemma3:4b',
  firstComparison: comparison, clarifiedComparison: clarified, elapsedMs: Date.now() - started,
  paymentVerified: false,
}, null, 2));
