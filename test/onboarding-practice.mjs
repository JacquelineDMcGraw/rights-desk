import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'rights-desk-practice-test-'));
const preload = join(dataDir, 'transport.mjs');
const callsPath = join(dataDir, 'payment-calls.json');
const port = 58000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const owner = randomUUID();
const buyer = randomUUID();
const otherBuyer = randomUUID();
const stranger = randomUUID();
const practiceCaseId = `case_${randomUUID()}`;
const realPaidCaseId = `case_${randomUUID()}`;
const termsVersion = 'rights-desk-license-v1';
const createdAt = '2026-11-05T12:00:00.000Z';
const token = () => randomBytes(32).toString('base64url');
const seededOffer = (status = 'OPEN') => ({
  id: `offer_${randomUUID()}`, token: token(), status, licensorName: 'Practice Creator',
  request: 'A synthetic one-time local editorial use', usage: 'editorial', term: 'one-time', territory: 'local',
  amount: '25.00', note: '', termsVersion, termsText: 'Synthetic test terms.',
  createdAt, expiresAt: '2099-01-01T00:00:00.000Z',
});
const readyPracticeOffer = seededOffer('OPEN');
const capturePracticeOffer = seededOffer('CHECKOUT');
const paidPracticeOffer = seededOffer('PAID');
const makeReceipt = (offer, title, issuedAt) => ({
  id: `license_${randomUUID()}`, offerId: offer.id, title, workType: 'illustration', workSha256: null,
  licensorName: 'Test Creator', licenseeName: 'Test Buyer', request: offer.request,
  usage: offer.usage, term: offer.term, territory: offer.territory, amount: offer.amount, currency: 'USD',
  note: 'Public approved attribution', paypalCaptureId: `TEST-CAPTURE-${randomUUID()}`,
  termsVersion, termsText: 'Approved terms snapshot.', acceptedAt: createdAt, issuedAt,
});
const orders = {};
for (const offer of [capturePracticeOffer, paidPracticeOffer]) {
  const orderId = `ord_${randomUUID()}`;
  offer.orderId = orderId;
  offer.buyerSessionId = buyer;
  offer.licenseeName = 'Test Buyer';
  orders[orderId] = { id: orderId, offerId: offer.id, caseId: practiceCaseId, sessionId: buyer,
    status: offer.status === 'PAID' ? 'COMPLETED' : 'READY', paypalOrderId: 'TEST-PRACTICE-NOT-SENT', createdAt };
}
paidPracticeOffer.receipt = makeReceipt(paidPracticeOffer, 'Practice should never become a paid record', '2026-11-05T16:00:00.000Z');
const paidOffer = seededOffer('PAID');
paidOffer.buyerSessionId = buyer;
paidOffer.receipt = makeReceipt(paidOffer, 'Original approved title', '2026-11-05T14:00:00.000Z');
const secondPaidOffer = seededOffer('PAID');
secondPaidOffer.buyerSessionId = otherBuyer;
secondPaidOffer.receipt = makeReceipt(secondPaidOffer, 'Second approved title', '2026-11-05T15:00:00.000Z');
const baseCase = { caseType: 'permission-review', workType: 'illustration', useChannel: 'unknown', jurisdiction: null,
  previewUploadId: null, previewSha256: null, sessionId: owner, createdAt, documents: [], permissionComparisons: [] };
await writeFile(join(dataDir, 'store.json'), JSON.stringify({ version: 1, uploads: {}, listings: {}, quotes: {}, orders, licenses: {}, cases: {
  [practiceCaseId]: { ...baseCase, id: practiceCaseId, practice: true, title: 'Seeded practice', offers: [readyPracticeOffer, capturePracticeOffer, paidPracticeOffer] },
  [realPaidCaseId]: { ...baseCase, id: realPaidCaseId, practice: false, title: 'PRIVATE MUTABLE CURRENT TITLE', story: 'PRIVATE CASE STORY', offers: [paidOffer, secondPaidOffer] },
} }));
// The preloader cannot reach real payment or model services. Record every
// synthetic payment call so practice guards are checked before transport.
await writeFile(callsPath, '[]');
await writeFile(preload, `
import ${JSON.stringify(new URL('./paypal-mock.mjs', import.meta.url).href)};
import {readFileSync,writeFileSync} from 'node:fs';
const paymentFetch=globalThis.fetch;
const callsPath=${JSON.stringify(callsPath)};
const reply=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  if(url.startsWith('https://api-m.sandbox.paypal.com')){
    const calls=JSON.parse(readFileSync(callsPath,'utf8'));calls.push(url);writeFileSync(callsPath,JSON.stringify(calls));
    return paymentFetch(input,options);
  }
  if(url==='http://practice-model.test/api/tags')return reply({models:[{name:'gemma3:4b'}]});
  if(url==='http://practice-model.test/api/chat'){
    const source=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    if(source.originalPermission.includes('MODEL_UNAVAILABLE'))return reply({message:{content:'invalid JSON'}});
    const dimensions=['purpose','channels','duration','territory'];
    return reply({message:{content:JSON.stringify({findings:dimensions.map(dimension=>({dimension,assessment:'changed',baselineQuote:source.originalPermission,requestQuote:source.newUsageRequest})),proposedChange:{purpose:'Paid advertising',channels:'Instagram advertisements',duration:'Six months',territory:'United States only'}})}});
  }
  throw new Error('Unexpected external request in isolated practice test');
};
`);
const server = spawn(process.execPath, ['--import', preload, fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd: fileURLToPath(root), env: { ...process.env, RIGHTS_DESK_KEYCHAIN: '0', DATA_DIR: dataDir, PORT: String(port),
    PAYPAL_CLIENT_ID: 'test-only-client', PAYPAL_CLIENT_SECRET: 'test-only-secret', OLLAMA_URL: 'http://practice-model.test' },
  stdio: 'pipe',
});
let output = '';
server.stderr.on('data', chunk => { output += chunk.toString(); });
async function call(path, { sid = owner, method = 'GET', body } = {}) {
  const response = await fetch(base + path, { method,
    headers: { cookie: `rd_session=${sid}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
const permissionText = 'Private original permission allows website publication for one year in Massachusetts.';
const requestText = 'Private proposed use: paid Instagram advertising for six months in the United States.';
const scope = { purpose: 'Paid advertising', channels: 'Instagram advertisements', duration: 'Six months', territory: 'United States only' };
const approval = { licensorName: 'Test Creator', amount: '25.00', approvedChange: { ...scope, conditions: 'Attribution required' }, baselineConfirmed: true, changesReviewed: true };
const legacyApproval = { licensorName: 'Test Creator', request: 'A one-time local editorial use', usage: 'editorial', term: 'one-time', territory: 'local', amount: '25.00' };
const expectPractice = result => {
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.code, 'PRACTICE_ONLY');
};

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await call('/api/status')).status === 200) { ready = true; break; } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, `Practice server failed to start: ${output}`);
  for (const practice of [null, 'true', 1, {}, []]) {
    assert.equal((await call('/api/permission-cases', { method: 'POST', body: { title: 'Practice work', workType: 'illustration', practice } })).status, 400);
  }
  const made = await call('/api/permission-cases', { method: 'POST', body: { title: 'Practice — fictional work', workType: 'illustration', practice: true } });
  assert.equal(made.status, 201);
  assert.equal(made.body.practice, true);
  const id = made.body.id;
  assert.equal((await call(`/api/cases/${id}`)).body.practice, true);
  assert.equal((await call(`/api/cases/${id}`, { sid: stranger })).status, 404);
  assert.deepEqual((await call('/api/cases', { sid: stranger })).body, []);
  assert.equal((await call(`/api/cases/${id}/details`, { method: 'POST', body: { practice: false } })).body.code, 'READ_ONLY_FIELD');
  assert.equal((await call(`/api/cases/${id}`)).body.practice, true, 'Practice cannot be promoted through case metadata');

  const comparison = await call(`/api/cases/${id}/permission-comparisons`, { method: 'POST', body: { permissionText, requestText } });
  assert.equal(comparison.status, 201);
  assert.equal(comparison.body.aiMode, 'ollama');
  assert.equal(comparison.body.status, 'ready_for_review');
  assert.equal((await call(`/api/cases/${id}/permission-comparisons`, { sid: stranger })).status, 404);
  const manual = await call(`/api/cases/${id}/permission-comparisons`, { method: 'POST', body: { permissionText: permissionText + ' MODEL_UNAVAILABLE', requestText, answers: scope } });
  assert.equal(manual.body.aiMode, 'manual');
  assert.equal(manual.body.status, 'ready_for_review', 'Practice remains usable with explicit scope when AI is unavailable');
  expectPractice(await call(`/api/cases/${id}/permission-comparisons/${comparison.body.id}/offer`, { method: 'POST', body: approval }));
  expectPractice(await call(`/api/cases/${id}/offers`, { method: 'POST', body: legacyApproval }));
  expectPractice(await call(`/api/cases/${id}/offer-draft`, { method: 'POST', body: { request: 'A local editorial feature', basePrice: 25 } }));
  assert.equal((await call(`/api/cases/${id}/offers`)).body.length, 0);
  assert.equal((await call(`/api/cases/${id}/permission-comparisons/${comparison.body.id}/offer`, { sid: stranger, method: 'POST', body: approval })).status, 404);

  // Guard stale/seeded practice offers at the payment boundaries too, including
  // the completed-receipt fast path that would otherwise return a fake result.
  expectPractice(await call(`/api/offers/${readyPracticeOffer.token}/checkout`, { sid: buyer, method: 'POST', body: { licenseeName: 'Test Buyer', acceptedTerms: true, termsVersion } }));
  for (const offer of [capturePracticeOffer, paidPracticeOffer]) {
    expectPractice(await call(`/api/offers/${offer.token}`, { sid: buyer }));
    expectPractice(await call(`/api/offers/${offer.token}/orders/${offer.orderId}/capture`, { sid: buyer, method: 'POST', body: {} }));
  }
  expectPractice(await call(`/api/offers/${paidPracticeOffer.token}/receipt?orderId=${paidPracticeOffer.orderId}`, { sid: buyer }));
  assert.deepEqual(JSON.parse(await readFile(callsPath, 'utf8')), [], 'Practice must never call even the mocked payment transport');

  const ownerReceipts = await call('/api/case-receipts');
  assert.equal(ownerReceipts.status, 200);
  assert.deepEqual(ownerReceipts.body, [secondPaidOffer.receipt, paidOffer.receipt]);
  assert.deepEqual((await call('/api/case-receipts', { sid: buyer })).body, [paidOffer.receipt]);
  assert.deepEqual((await call('/api/case-receipts', { sid: otherBuyer })).body, [secondPaidOffer.receipt]);
  assert.deepEqual((await call('/api/case-receipts', { sid: stranger })).body, []);
  const recordsText = JSON.stringify(ownerReceipts.body);
  for (const forbidden of ['PRIVATE MUTABLE CURRENT TITLE', 'PRIVATE CASE STORY', permissionText, requestText, 'Practice should never become', 'sessionId', 'buyerSessionId']) {
    assert.equal(recordsText.includes(forbidden), false, `Records must not contain ${forbidden}`);
  }

  const real = await call('/api/permission-cases', { method: 'POST', body: { title: 'Real review remains available', workType: 'photograph' } });
  assert.equal(real.body.practice, false);
  const realComparison = await call(`/api/cases/${real.body.id}/permission-comparisons`, { method: 'POST', body: { permissionText, requestText } });
  const realOffer = await call(`/api/cases/${real.body.id}/permission-comparisons/${realComparison.body.id}/offer`, { method: 'POST', body: approval });
  assert.equal(realOffer.status, 201, JSON.stringify(realOffer.body));
  const acceptance = { licenseeName: 'Test Buyer', acceptedTerms: true, termsVersion: realOffer.body.termsVersion, acceptedChangeHash: realOffer.body.changeSnapshot.changeHash };
  assert.equal((await call(`/api/offers/${realOffer.body.token}/checkout`, { sid: buyer, method: 'POST', body: acceptance })).status, 201);
  assert.ok(JSON.parse(await readFile(callsPath, 'utf8')).length > 0, 'The real review path must still reach the mocked Sandbox transport');
  assert.deepEqual((await call('/api/case-receipts')).body, ownerReceipts.body, 'An unpaid real offer must not invent a receipt');
  console.log('Onboarding practice passed: immutable practice mode, private comparisons, no practice offers/payments, normal checkout preserved, and session-private saved receipts.');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', resolve); setTimeout(resolve, 2000).unref(); } });
  await rm(dataDir, { recursive: true, force: true });
}
