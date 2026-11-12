import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'rights-desk-offer-test-'));
const port = 54000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const clockPath = join(dataDir, 'clock.txt');
await writeFile(clockPath, '0');
const server = spawn(process.execPath, ['--import', fileURLToPath(new URL('./paypal-mock.mjs', import.meta.url)), fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd: fileURLToPath(root),
  env: { ...process.env, RIGHTS_DESK_KEYCHAIN: '0', DATA_DIR: dataDir, PORT: String(port), PAYPAL_CLIENT_ID: 'test-only-client', PAYPAL_CLIENT_SECRET: 'test-only-secret', OLLAMA_URL: 'http://127.0.0.1:1', RIGHTS_DESK_TEST_CLOCK_PATH: clockPath },
  stdio: 'pipe',
});
let serverOutput = '';
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

const owner = randomUUID();
const buyer = randomUUID();
const stranger = randomUUID();
async function call(path, { sid = owner, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { cookie: `rd_session=${sid}`, ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { const status = await call('/api/status'); if (status.status === 200) { ready = true; break; } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, `server did not start: ${serverOutput}`);
  const image = await readFile(new URL('../docs/mobile-preview.png', import.meta.url));
  const uploaded = await call('/api/uploads?kind=preview', { method: 'POST', body: image, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const made = await call('/api/cases', { method: 'POST', body: {
    title: 'Tour test photograph', workType: 'photograph', useChannel: 'website', jurisdiction: 'New York',
    story: 'PRIVATE STORY MUST NOT REACH BUYER', previewUploadId: uploaded.body.uploadId,
  } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const caseId = made.body.id;
  const draft = await call(`/api/cases/${caseId}/offer-draft`, { method: 'POST', body: { request: 'A one-year local editorial feature online', basePrice: 75 } });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.aiMode, 'rules');
  const offerResult = await call(`/api/cases/${caseId}/offers`, { method: 'POST', body: {
    licensorName: 'Test Photographer', request: 'A one-year local editorial feature online',
    usage: draft.body.usage, term: draft.body.term, territory: draft.body.territory,
    amount: draft.body.amount, note: 'Attribution: Test Photographer',
  } });
  assert.equal(offerResult.status, 201, JSON.stringify(offerResult.body));
  const offer = offerResult.body;
  assert.equal(offer.termsVersion, 'rights-desk-license-v1');
  assert.match(offer.termsText, /nonexclusive/);
  assert.match(offer.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call(`/api/cases/${caseId}/offers`, { sid: stranger })).status, 404);
  assert.equal((await call(`/api/cases/${caseId}/offers`, { method: 'POST', body: {
    licensorName: 'Test Photographer', request: 'Another use of this image', usage: 'editorial', term: 'one-year', territory: 'local', amount: '25.00',
  } })).status, 409);
  const buyerView = await call(`/api/offers/${offer.token}`, { sid: buyer });
  assert.equal(buyerView.status, 200);
  assert.equal(buyerView.body.title, 'Tour test photograph');
  assert.equal(buyerView.body.workSha256, made.body.previewSha256);
  assert.equal(buyerView.body.status, 'OPEN');
  assert.equal(JSON.stringify(buyerView.body).includes('PRIVATE STORY'), false);
  assert.equal(JSON.stringify(buyerView.body).includes('previewUrl'), false);
  assert.equal((await call(`/api/offers/${offer.token}/checkout`, { sid: buyer, method: 'POST', body: { licenseeName: 'Test Buyer', acceptedTerms: false } })).status, 400);
  assert.equal((await call(`/api/offers/${offer.token}/checkout`, { sid: buyer, method: 'POST', body: { licenseeName: 'Test Buyer', acceptedTerms: true, termsVersion: 'stale-version' } })).status, 400);
  const acceptance = { licenseeName: 'Test Buyer', acceptedTerms: true, termsVersion: offer.termsVersion };
  const checkout = await call(`/api/offers/${offer.token}/checkout`, { sid: buyer, method: 'POST', body: acceptance });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.match(checkout.body.approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal((await call(`/api/offers/${offer.token}`, {sid:buyer})).body.checkout.licenseeName, 'Test Buyer');
  assert.equal((await call(`/api/offers/${offer.token}`, {sid:stranger})).body.checkout, null);
  assert.equal((await call(`/api/offers/${offer.token}/checkout`, { sid: stranger, method: 'POST', body: { ...acceptance, licenseeName: 'Other Buyer' } })).status, 409);
  assert.equal((await call(`/api/offers/${offer.token}/orders/${checkout.body.orderId}/capture`, { sid: stranger, method: 'POST', body: {} })).status, 404);
  assert.equal((await call(`/api/checkout/${checkout.body.orderId}/capture`, { sid: buyer, method: 'POST', body: {} })).status, 404);
  const paid = await call(`/api/offers/${offer.token}/orders/${checkout.body.orderId}/capture`, { sid: buyer, method: 'POST', body: {} });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, 'COMPLETED');
  assert.equal(paid.body.receipt.licenseeName, 'Test Buyer');
  assert.equal(paid.body.receipt.amount, offer.amount);
  assert.equal(paid.body.receipt.workSha256, made.body.previewSha256);
  assert.equal(paid.body.receipt.termsText, offer.termsText);
  assert.equal(paid.body.receipt.termsVersion, offer.termsVersion);
  assert.ok(paid.body.receipt.acceptedAt);
  const duplicate = await call(`/api/offers/${offer.token}/orders/${checkout.body.orderId}/capture`, { sid: buyer, method: 'POST', body: {} });
  assert.equal(duplicate.body.receipt.id, paid.body.receipt.id);
  const ownerCase = await call(`/api/cases/${caseId}`);
  assert.equal(ownerCase.body.offers[0].status, 'PAID');
  assert.equal(ownerCase.body.offers[0].receipt.id, paid.body.receipt.id);
  const receiptPath = `/api/offers/${offer.token}/receipt?orderId=${checkout.body.orderId}`;
  assert.equal((await call(receiptPath, { sid: buyer })).status, 200);
  assert.equal((await call(receiptPath, { sid: stranger })).status, 404);
  assert.equal((await call(`/api/cases/${caseId}/offers/${offer.id}/revoke`, { method: 'POST', body: {} })).status, 409);

  async function createOffer(title) {
    await writeFile(clockPath, '0');
    const made = await call('/api/cases', {method:'POST', body:{title,workType:'photograph',useChannel:'website',jurisdiction:'New York',previewUploadId:uploaded.body.uploadId}});
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const offered = await call(`/api/cases/${made.body.id}/offers`, {method:'POST', body:{licensorName:'Test Photographer',request:'One online editorial feature for one year',usage:'editorial',term:'one-year',territory:'national',amount:'75.00'}});
    assert.equal(offered.status, 201, JSON.stringify(offered.body));
    return {item:made.body, offer:offered.body};
  }
  async function startCheckout(offer) {
    return call(`/api/offers/${offer.token}/checkout`, {sid:buyer,method:'POST',body:{...acceptance,termsVersion:offer.termsVersion}});
  }
  async function confirm(offer, orderId) {
    return call(`/api/offers/${offer.token}/orders/${orderId}/capture`, {sid:buyer,method:'POST',body:{}});
  }
  for (const scenario of ['Wrong amount','Wrong currency','Wrong reference','Wrong order','Unapproved']) {
    const fixture = await createOffer(scenario+' photograph');
    const order = await startCheckout(fixture.offer);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const rejected = await confirm(fixture.offer, order.body.orderId);
    assert.equal(rejected.status, 409, scenario);
    const item = await call(`/api/cases/${fixture.item.id}`);
    assert.notEqual(item.body.offers[0].status, 'PAID', scenario);
    assert.equal(item.body.offers[0].receipt, null, scenario);
  }
  const lost = await createOffer('Lost response photograph');
  const lostOrder = await startCheckout(lost.offer);
  assert.equal((await confirm(lost.offer,lostOrder.body.orderId)).status, 200, 'read after a lost capture response recovers verified payment');

  const uncertain = await createOffer('Uncertain capture photograph');
  const uncertainOrder = await startCheckout(uncertain.offer);
  assert.equal((await confirm(uncertain.offer,uncertainOrder.body.orderId)).status, 502);
  assert.equal((await call(`/api/cases/${uncertain.item.id}/offers/${uncertain.offer.id}/revoke`, {method:'POST',body:{}})).status, 409);
  await writeFile(clockPath,String(8*24*60*60*1000));
  assert.equal((await confirm(uncertain.offer,uncertainOrder.body.orderId)).status, 200, 'already captured payment is recoverable after expiry');

  const expired = await createOffer('Expired photograph');
  const expiredOrder = await startCheckout(expired.offer);
  await writeFile(clockPath,String(8*24*60*60*1000));
  assert.equal((await confirm(expired.offer,expiredOrder.body.orderId)).status, 409, 'expiry blocks a fresh capture');
  assert.equal((await call(`/api/offers/${expired.offer.token}`,{sid:buyer})).body.status,'EXPIRED');

  const revoked = await createOffer('Revoked photograph');
  assert.equal((await call(`/api/cases/${revoked.item.id}/offers/${revoked.offer.id}/revoke`, {sid:stranger,method:'POST',body:{}})).status, 404);
  assert.equal((await call(`/api/cases/${revoked.item.id}/offers/${revoked.offer.id}/revoke`, {method:'POST',body:{}})).status, 200);
  assert.equal((await startCheckout(revoked.offer)).status, 409);

  const retry = await createOffer('Lost checkout photograph');
  assert.equal((await startCheckout(retry.offer)).status, 502);
  const resumed = await startCheckout(retry.offer);
  assert.equal(resumed.status, 201, JSON.stringify(resumed.body));
  assert.equal((await confirm(retry.offer,resumed.body.orderId)).status, 200);

  const disabledPort = port + 1500;
  const disabled = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    cwd: fileURLToPath(root),
    env: {...process.env, RIGHTS_DESK_KEYCHAIN:'0', PORT:String(disabledPort), DATA_DIR:join(dataDir,'without-paypal'), PAYPAL_CLIENT_ID:'', PAYPAL_CLIENT_SECRET:'', OLLAMA_URL:'http://127.0.0.1:1'},
    stdio:'pipe',
  });
  try {
    let disabledReady = false;
    for (let i=0;i<80;i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${disabledPort}/api/status`, {signal:AbortSignal.timeout(1000)});
        if (response.ok) { assert.equal((await response.json()).paypalConfigured,false); disabledReady=true; break; }
      } catch { await new Promise(resolve=>setTimeout(resolve,50)); }
    }
    assert.equal(disabledReady,true,'unconfigured server started');
    const blocked = await fetch(`http://127.0.0.1:${disabledPort}/api/offers/${offer.token}/checkout`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(acceptance)});
    assert.equal(blocked.status,503,'missing credentials cannot simulate checkout');
    assert.equal((await blocked.json()).code,'PAYPAL_NOT_CONFIGURED');
  } finally { disabled.kill('SIGTERM'); }
  console.log('Case offer integration passed: session privacy, versioned acceptance, exact capture verification, revocation, expiry, retries, lost-response recovery, receipts, idempotency, and unconfigured checkout.');
} finally {
  server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
