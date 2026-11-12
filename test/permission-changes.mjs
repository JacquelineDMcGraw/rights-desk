import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'rights-desk-permission-test-'));
const preload = join(dataDir, 'transport.mjs');
const port = 57000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
// This test transport only returns synthetic model and PayPal data. It cannot
// reach a real model, payment service, or Keychain item.
await writeFile(preload, `
import ${JSON.stringify(new URL('./paypal-mock.mjs', import.meta.url).href)};
const previousFetch = globalThis.fetch;
const reply = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
globalThis.fetch = async (input, options = {}) => {
  if (!String(input).startsWith('http://permission-model.test/')) return previousFetch(input, options);
  if (String(input).endsWith('/api/tags')) return reply({models:[{name:'gemma3:4b'}]});
  const submitted = JSON.parse(options.body);
  const source = JSON.parse(submitted.messages.at(-1).content);
  if (source.originalPermission.includes('MODEL_INVALID')) return reply({message:{content:'not JSON'}});
  const rows = [
    ['purpose','editorial publication only','paid advertising','Paid advertising'],
    ['channels','company website','Instagram','Paid Instagram ads'],
    ['duration','one year','six months','Six months'],
    ['territory','Massachusetts','United States','United States'],
  ];
  const findings = rows.map(([dimension, baseline, requested]) => ({dimension,assessment:'changed',
    baselineQuote:source.originalPermission.includes(baseline)?baseline:null,
    requestQuote:source.newUsageRequest.includes(requested)?requested:null}));
  if (source.originalPermission.includes('MODEL_HALLUCINATED')) findings[2].requestQuote='forever on every planet';
  const proposedChange=Object.fromEntries(rows.map(([dimension,,requested,value])=>[dimension,source.newUsageRequest.includes(requested)?value:null]));
  return reply({message:{content:JSON.stringify({findings,proposedChange})}});
};
`);
const server = spawn(process.execPath, ['--import', preload, fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd: fileURLToPath(root),
  env: { ...process.env, RIGHTS_DESK_KEYCHAIN: '0', DATA_DIR: dataDir, PORT: String(port),
    PAYPAL_CLIENT_ID: 'test-only-client', PAYPAL_CLIENT_SECRET: 'test-only-secret', OLLAMA_URL: 'http://permission-model.test' },
  stdio: 'pipe',
});
let output = '';
server.stderr.on('data', chunk => { output += chunk.toString(); });
const owner = randomUUID();
const buyer = randomUUID();
const stranger = randomUUID();
const permissionText = 'PRIVATE BASELINE: Permission granted for editorial publication only on company website for one year in Massachusetts. Confidential client notes must stay private.';
const agreementText = 'PRIVATE AGREEMENT: Display the photographs for one year with a named credit.\nPaid ads require separate approval.';
const requestText = 'PRIVATE REQUEST: Please permit paid advertising on Instagram for six months in the United States.';
const attachedRequest = 'Hi Jackie,\n\nCould we use the photograph in paid Instagram ads for six months?\nThe campaign will run only in the United States.\n\nThanks,\nStudio team\n';
const proposedChange = { purpose: 'Paid advertising', channels: 'Paid Instagram ads', duration: 'Six months', territory: 'United States' };
const approvedChange = { ...proposedChange, conditions: 'Attribution: Test Creator. No sublicensing.' };
const approval = { licensorName: 'Test Creator', amount: '125.00', approvedChange, baselineConfirmed: true, changesReviewed: true };
async function call(path, { sid = owner, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, headers: { cookie: `rd_session=${sid}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function makeCase(title = 'Permission change photograph') {
  const result = await call('/api/permission-cases', { method: 'POST', body: { title, workType: 'photograph' } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
async function uploadDocument(caseId, { name, mime, body, sid = owner }) {
  const response = await fetch(`${base}/api/cases/${caseId}/documents`, {
    method: 'POST',
    headers: { cookie: `rd_session=${sid}`, 'content-type': mime, 'x-file-name': name },
    body,
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function attachContract(caseId) {
  const uploaded = await uploadDocument(caseId, {
    name: 'synthetic-contract.pdf', mime: 'application/pdf',
    body: '%PDF-1.4\nA synthetic contract fixture for request authorization.\n%%EOF',
  });
  assert.equal(uploaded.status, 201);
  return uploaded.body;
}
async function compare(caseId, patch = {}) {
  return call(`/api/cases/${caseId}/permission-comparisons`, { method: 'POST', body: { permissionText, requestText, ...patch } });
}
async function offer(caseId, comparisonId, body = approval) {
  return call(`/api/cases/${caseId}/permission-comparisons/${comparisonId}/offer`, { method: 'POST', body });
}
const comparisons = caseId => `/api/cases/${caseId}/permission-comparisons`;
const checkout = token => `/api/offers/${token}/checkout`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await call('/api/status')).status === 200) { ready = true; break; } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, `Comparison server failed to start: ${output}`);
  assert.equal((await call('/api/permission-cases', { method: 'POST', body: { title: 'No', workType: 'photograph' } })).status, 400);
  assert.equal((await call('/api/permission-cases', { method: 'POST', body: { title: 'A valid work', workType: 'photograph', sessionId: stranger } })).status, 400);
  const item = await makeCase();
  assert.equal(item.caseType, 'permission-review');
  assert.equal(item.previewUrl, null);
  assert.equal(item.previewSha256, null);
  assert.equal(item.jurisdiction, null, 'Starting a permission review must not invent a location');
  assert.equal(item.useChannel, 'unknown');
  assert.equal((await call(`/api/cases/${item.id}`, { sid: stranger })).status, 404);
  assert.deepEqual((await call('/api/cases', { sid: stranger })).body, []);
  const agreedTermsPath = `/api/cases/${item.id}/agreed-terms`;
  const saveTerms = (body, sid = owner) => call(agreedTermsPath, { method: 'POST', body, sid });
  assert.deepEqual((await call(agreedTermsPath)).body, { text: '', savedAt: null });
  assert.equal((await saveTerms({ text: 'Too short' })).status, 400);
  assert.equal((await saveTerms({ text: 'x'.repeat(8001) })).status, 400);
  assert.equal((await saveTerms({ text: agreementText, savedAt: 'forged' })).status, 400);
  const savedTerms = await saveTerms({ text: `  ${agreementText}\n` });
  assert.equal(savedTerms.status, 200);
  assert.equal(savedTerms.body.text, agreementText);
  assert.ok(Number.isFinite(Date.parse(savedTerms.body.savedAt)));
  assert.deepEqual((await saveTerms({ text: agreementText })).body, savedTerms.body);
  assert.deepEqual((await call(agreedTermsPath)).body, savedTerms.body);
  assert.equal((await call(agreedTermsPath, { sid: stranger })).status, 404);
  assert.equal((await saveTerms({ text: agreementText }, buyer)).status, 404);
  assert.equal((await call(`/api/cases/${item.id}`)).body.agreedTerms, undefined);
  assert.equal((await call('/api/cases')).body[0].agreedTerms, undefined);
  const previewCase = (await call('/api/permission-cases', { method: 'POST', body: { title: 'Translation permission', workType: 'photograph', practice: true } })).body;
  assert.equal((await call(`/api/cases/${previewCase.id}/agreed-terms`, { method: 'POST', body: { text: agreementText } })).body.code, 'PRACTICE_ONLY');
  const contract = await attachContract(item.id);
  const contractPath = `/api/cases/${item.id}/documents/${contract.id}/extract-terms`;
  const extractTerms = (path, options = {}) => call(path, { method: 'POST', body: {}, ...options });
  assert.equal((await extractTerms(contractPath, { sid: stranger })).status, 404);
  assert.equal((await extractTerms(contractPath, { sid: buyer })).status, 404);
  assert.equal((await extractTerms(contractPath, { headers: { origin: 'https://another-origin.test' } })).body.code, 'ORIGIN_DENIED');
  assert.equal((await extractTerms(contractPath, { body: { path: 'not-an-attachment.pdf' } })).body.code, 'INVALID_FIELD');
  const previewContract = await attachContract(previewCase.id);
  assert.equal((await extractTerms(`/api/cases/${previewCase.id}/documents/${previewContract.id}/extract-terms`)).body.code, 'PRACTICE_ONLY');
  assert.equal((await extractTerms(`/api/cases/${item.id}/documents/${previewContract.id}/extract-terms`)).status, 404);
  await rm(join(dataDir, 'documents', `${contract.id}.pdf`));
  const missingContract = await extractTerms(contractPath);
  assert.equal(missingContract.status, 404);
  assert.equal(missingContract.body.code, 'DOCUMENT_MISSING');
  const attachedText = await uploadDocument(item.id, { name:'studio-brief.txt', mime:'text/plain', body:attachedRequest });
  assert.equal(attachedText.status, 201, JSON.stringify(attachedText.body));
  assert.equal(attachedText.body.mime, 'text/plain');
  const proposedPath = `/api/cases/${item.id}/documents/${attachedText.body.id}/extract-proposed-use`;
  assert.equal((await extractTerms(proposedPath, { sid: stranger })).status, 404);
  assert.equal((await extractTerms(proposedPath, { sid: buyer })).status, 404);
  assert.equal((await extractTerms(proposedPath, { headers: { origin: 'https://another-origin.test' } })).body.code, 'ORIGIN_DENIED');
  assert.equal((await extractTerms(proposedPath, { body: { text: attachedRequest } })).body.code, 'INVALID_FIELD');
  assert.equal((await extractTerms(`/api/cases/${previewCase.id}/documents/${attachedText.body.id}/extract-proposed-use`)).status, 404);
  assert.equal((await extractTerms(`/api/cases/${previewCase.id}/documents/${previewContract.id}/extract-proposed-use`)).body.code, 'PRACTICE_ONLY');
  assert.equal((await extractTerms(`/api/cases/${item.id}/documents/${attachedText.body.id}/extract-terms`)).body.code, 'UNSUPPORTED_DOCUMENT');
  const extractedProposal = await extractTerms(proposedPath);
  assert.equal(extractedProposal.status, 200, JSON.stringify(extractedProposal.body));
  assert.equal(extractedProposal.body.method, 'proposed-use-excerpts');
  assert.match(extractedProposal.body.text, /Could we use the photograph in paid Instagram ads for six months\?/);
  assert.match(extractedProposal.body.text, /The campaign will run only in the United States\./);
  assert.doesNotMatch(extractedProposal.body.text, /Hi Jackie|Thanks,|Studio team/);
  assert.ok(extractedProposal.body.excerpts.every(({ page, text }) => page === null && attachedRequest.includes(text)));
  const email = `From: Studio Team <studio@example.test>\r\nSubject: Proposed campaign\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${attachedRequest.replaceAll('\n','\r\n')}`;
  const attachedEmail = await uploadDocument(item.id, { name:'studio-request.eml', mime:'application/octet-stream', body:email });
  assert.equal(attachedEmail.status, 201, JSON.stringify(attachedEmail.body));
  assert.equal(attachedEmail.body.mime, 'message/rfc822');
  assert.equal((await uploadDocument(item.id, { name:'binary-as-text.txt', mime:'text/plain', body:Buffer.from([0, 255, 12, 13]) })).body.code, 'UNSUPPORTED_DOCUMENT');
  assert.equal((await uploadDocument(item.id, { name:'invalid-email.eml', mime:'message/rfc822', body:attachedRequest })).body.code, 'UNSUPPORTED_DOCUMENT');
  assert.deepEqual((await call(agreedTermsPath)).body, savedTerms.body);
  assert.deepEqual((await call(comparisons(item.id))).body, [], 'Extracting a source does not save or compare a proposal');
  assert.equal((await call(`/api/cases/${item.id}/search`, { method: 'POST', body: {} })).body.code, 'PREVIEW_MISSING');
  assert.equal((await call(comparisons(item.id), { sid: stranger })).status, 404);
  assert.equal((await call(comparisons(item.id), { sid: stranger, method: 'POST', body: { permissionText, requestText } })).status, 404);
  assert.equal((await compare(item.id, { status: 'ready_for_review' })).status, 400);
  assert.equal((await compare(item.id, { permissionText: 'x'.repeat(8001) })).status, 400);
  assert.equal((await compare(item.id, { requestText: 'x'.repeat(4001) })).status, 400);
  assert.equal((await compare(item.id, { answers: { legalVerdict: 'infringement' } })).status, 400);
  assert.equal((await compare(item.id, { answers: { duration: 'x'.repeat(501) } })).status, 400);
  const comparison = await compare(item.id);
  assert.equal(comparison.status, 201, JSON.stringify(comparison.body));
  const record = comparison.body;
  assert.match(record.id, /^cmp_[a-f0-9-]{36}$/);
  assert.equal(record.aiMode, 'ollama');
  assert.equal(record.status, 'ready_for_review');
  assert.equal(record.originalPermissionHash, createHash('sha256').update(permissionText).digest('hex'));
  assert.deepEqual(record.proposedChange, proposedChange);
  assert.equal(record.findings.length, 4);
  assert.equal(record.findings.every(finding => finding.assessment === 'changed'), true);
  assert.equal(record.findings[0].baselineQuote, 'editorial publication only');
  assert.equal(record.findings[0].requestQuote, 'paid advertising');
  assert.deepEqual((await call(comparisons(item.id))).body, [record]);
  const other = await makeCase('Another permission record');
  assert.equal((await offer(other.id, record.id)).status, 404, 'Comparisons cannot cross case boundaries');
  const changePath = `${comparisons(item.id)}/${record.id}/offer`;
  assert.equal((await call(changePath, { sid: stranger, method: 'POST', body: approval })).status, 404);
  for (const body of [
    { ...approval, baselineConfirmed: false }, { ...approval, changesReviewed: false },
    { ...approval, approvedChange: { ...approvedChange, duration: '' } },
    { ...approval, approvedChange: { ...approvedChange, duration: 'not sure' } },
    { ...approval, approvedChange: { ...approvedChange, arbitraryRights: 'everything' } },
    { ...approval, comparisonHash: 'forged' }, { ...approval, amount: '0.01' }, { ...approval, amount: '10000.01' },
  ]) assert.equal((await offer(item.id, record.id, body)).status, 400, JSON.stringify(body));

  const incomplete = await compare(item.id, { requestText: 'Please permit paid advertising on Instagram.' });
  assert.equal(incomplete.body.status, 'needs_clarification');
  assert.deepEqual(incomplete.body.questions.map(question => question.id), ['duration', 'territory']);
  assert.equal((await offer(item.id, incomplete.body.id)).body.code, 'CLARIFICATION_REQUIRED');
  const blankAnswers = await compare(item.id, { requestText: 'Please permit paid advertising on Instagram.', answers: { duration: '', territory: '  ' } });
  assert.equal(blankAnswers.body.status, 'needs_clarification', 'Empty UI answers can be left for later');
  assert.deepEqual(blankAnswers.body.answers, {});
  const clarified = await compare(item.id, { requestText: 'Please permit paid advertising on Instagram.', answers: { duration: 'Six weeks from May 1', territory: 'Maine and Vermont only' } });
  assert.equal(clarified.body.status, 'ready_for_review');
  assert.equal(clarified.body.proposedChange.duration, 'Six weeks from May 1');
  const ungrounded = await compare(item.id, { permissionText: permissionText + ' MODEL_HALLUCINATED' });
  assert.equal(ungrounded.body.proposedChange.duration, null);
  assert.equal(ungrounded.body.findings.find(finding => finding.dimension === 'duration').assessment, 'unclear');
  assert.equal(ungrounded.body.warnings.length > 0, true);
  assert.equal((await offer(item.id, ungrounded.body.id)).body.code, 'CLARIFICATION_REQUIRED');
  const offline = await compare(item.id, { permissionText: permissionText + ' MODEL_INVALID' });
  assert.equal(offline.body.aiMode, 'manual');
  assert.equal(offline.body.status, 'needs_clarification');
  const manual = await compare(item.id, { permissionText: permissionText + ' MODEL_INVALID', answers: proposedChange });
  assert.equal(manual.body.aiMode, 'manual');
  assert.equal(manual.body.status, 'ready_for_review');

  const made = await offer(item.id, record.id);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const approved = made.body;
  assert.equal(approved.kind, 'permission-change');
  assert.equal(approved.termsVersion, 'rights-desk-permission-change-v1');
  assert.match(approved.termsText, /additional permission/);
  assert.deepEqual(approved.changeSnapshot.approvedChange, approvedChange);
  assert.equal(approved.changeSnapshot.amount, '125.00');
  assert.equal(approved.changeSnapshot.currency, 'USD');
  assert.equal(approved.changeSnapshot.licensorName, approval.licensorName);
  assert.equal(approved.changeSnapshot.comparisonId, record.id);
  assert.equal(approved.changeSnapshot.comparisonHash, record.comparisonHash);
  assert.equal(approved.changeSnapshot.originalPermissionHash, record.originalPermissionHash);
  assert.equal(approved.changeSnapshot.workSha256, null);
  assert.equal(approved.changeSnapshot.caseId, item.id);
  assert.equal(approved.changeSnapshot.workTitle, item.title);
  assert.equal(approved.changeSnapshot.workType, item.workType);
  assert.match(approved.changeSnapshot.changeHash, /^[a-f0-9]{64}$/);
  assert.equal((await offer(item.id, record.id)).body.code, 'ACTIVE_OFFER');
  const shared = (await call(`/api/offers/${approved.token}`, { sid: buyer })).body;
  const sharedText = JSON.stringify(shared);
  for (const privateText of [permissionText, requestText, 'PRIVATE AGREEMENT', 'PRIVATE BASELINE', 'PRIVATE REQUEST', 'Confidential client notes', 'findings', 'baselineQuote', 'requestQuote', 'sourceHash']) {
    assert.equal(sharedText.includes(privateText), false, `Buyer must not see ${privateText}`);
  }
  assert.deepEqual(shared.changeSnapshot, approved.changeSnapshot);
  const originalSnapshot = structuredClone(shared.changeSnapshot);
  const acceptance = { licenseeName: 'Test Buyer', acceptedTerms: true, termsVersion: approved.termsVersion, acceptedChangeHash: approved.changeSnapshot.changeHash };
  const { acceptedChangeHash, ...missingHash } = acceptance;
  assert.equal((await call(checkout(approved.token), { sid: buyer, method: 'POST', body: missingHash })).body.code, 'CHANGE_ACCEPTANCE_REQUIRED');
  assert.equal((await call(checkout(approved.token), { sid: buyer, method: 'POST', body: { ...acceptance, acceptedChangeHash: 'forged' } })).status, 400);
  assert.equal((await call(checkout(approved.token), { sid: buyer, method: 'POST', body: { ...acceptance, acceptedTerms: false } })).status, 400);
  assert.equal((await call(checkout(approved.token), { sid: buyer, method: 'POST', body: { ...acceptance, amount: '0.01', approvedChange: { ...approvedChange, duration: 'Forever' } } })).status, 400, 'Buyer scope/fee changes are rejected');
  const started = await call(checkout(approved.token), { sid: buyer, method: 'POST', body: acceptance });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const stored = JSON.parse(await readFile(join(dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(stored.cases[item.id].agreedTerms, savedTerms.body);
  assert.deepEqual(stored.orders[started.body.orderId].changeSnapshot, originalSnapshot);
  assert.equal(stored.cases[item.id].offers[0].amount, '125.00', 'Buyer input cannot change the approved fee');
  assert.equal((await call(checkout(approved.token), { sid: stranger, method: 'POST', body: acceptance })).status, 409);
  const revisedAgreement = `${agreementText}\nThe parties also agreed to credit the original title.`;
  assert.equal((await saveTerms({ text: revisedAgreement })).body.text, revisedAgreement);
  assert.deepEqual((await call(comparisons(item.id))).body[0], record, 'Saving a reference cannot alter a comparison');
  await compare(item.id, { requestText: requestText + ' The client later asks about another campaign.' });
  await call(`/api/cases/${item.id}/details`, { method: 'POST', body: { title: 'Updated working title', workType: 'illustration', useChannel: 'social', jurisdiction: 'Massachusetts', story: 'Later private notes.' } });
  const currentShared = (await call(`/api/offers/${approved.token}`, { sid: buyer })).body;
  assert.deepEqual(currentShared.changeSnapshot, originalSnapshot);
  assert.equal(currentShared.title, item.title, 'The original offered work identity stays fixed');
  const capturePath = `/api/offers/${approved.token}/orders/${started.body.orderId}/capture`;
  assert.equal((await call(capturePath, { sid: stranger, method: 'POST', body: {} })).status, 404);
  const paid = await call(capturePath, { sid: buyer, method: 'POST', body: {} });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, 'COMPLETED');
  assert.equal(paid.body.receipt.kind, 'permission-change');
  assert.deepEqual(paid.body.receipt.changeSnapshot, originalSnapshot);
  assert.equal(paid.body.receipt.changeHash, originalSnapshot.changeHash);
  assert.equal(paid.body.receipt.amount, '125.00');
  assert.equal(paid.body.receipt.termsVersion, approved.termsVersion);
  assert.equal(paid.body.receipt.termsText, approved.termsText);
  assert.ok(paid.body.receipt.paypalCaptureId);
  assert.equal(JSON.stringify(paid.body.receipt).includes('PRIVATE BASELINE'), false);
  const repeated = await call(capturePath, { sid: buyer, method: 'POST', body: {} });
  assert.deepEqual(repeated.body.receipt, paid.body.receipt, 'Retries retain the same exact approved change and receipt');
  const ownerCase = (await call(`/api/cases/${item.id}`)).body;
  assert.equal(ownerCase.offers[0].status, 'PAID');
  assert.deepEqual(ownerCase.offers[0].receipt.changeSnapshot, originalSnapshot);
  assert.equal((await call(`/api/offers/${approved.token}/receipt?orderId=${started.body.orderId}`, { sid: stranger })).status, 404);

  const wrongCase = await makeCase('Wrong amount permission change');
  const wrongComparison = (await compare(wrongCase.id)).body;
  const wrongOffer = (await offer(wrongCase.id, wrongComparison.id)).body;
  const wrongStart = await call(checkout(wrongOffer.token), { sid: buyer, method: 'POST', body: { ...acceptance, acceptedChangeHash: wrongOffer.changeSnapshot.changeHash } });
  assert.equal(wrongStart.status, 201);
  const wrongCapture = await call(`/api/offers/${wrongOffer.token}/orders/${wrongStart.body.orderId}/capture`, { sid: buyer, method: 'POST', body: {} });
  assert.equal(wrongCapture.status, 409);
  assert.equal(wrongCapture.body.code, 'PAYMENT_NOT_COMPLETED');
  assert.equal((await call(`/api/cases/${wrongCase.id}`)).body.offers[0].receipt, null);
  console.log('Permission changes passed: private agreed terms and attachment imports, source privacy, grounded comparison readiness, explicit approvals, free-form scope, immutable fee-bound snapshots, exact buyer acceptance, capture checks, and preserved receipts.');
} finally {
  server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
