import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'rights-desk-details-test-'));
const port = 55000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const owner = randomUUID();
const buyer = randomUUID();
const stranger = randomUUID();
const caseId = `case_${randomUUID()}`;
const uploadId = `up_${randomUUID()}`;
const documentId = `doc_${randomUUID()}`;
const legacyToken = randomBytes(32).toString('base64url');
const image = await readFile(new URL('../docs/mobile-preview.png', import.meta.url));
const fingerprint = createHash('sha256').update(image).digest('hex');
const createdAt = '2026-10-25T12:00:00.000Z';
const original = {
  title: 'Original case title', workType: 'photograph', useChannel: 'website', jurisdiction: 'New York',
  creatorLocation: 'New Jersey', suspectedUrl: 'https://example.com/article', firstPublishedAt: '2026-01-01',
  ownershipBasis: 'creator', registrationNumber: 'VA-EXAMPLE', likenessInvolved: true, story: 'Private creation notes',
};
const search = {status:'complete',searchedAt:createdAt,queries:['Original case title'],coverage:[{source:'Fixture collection',status:'searched',retrieved:0,compared:0}],matches:[],summary:'Fixture report for preservation check.'};
const document = {id:documentId,name:'supporting.pdf',mime:'application/pdf',ext:'.pdf',size:64,uploadedAt:createdAt};
const legacyOffer = {id:`offer_${randomUUID()}`,token:legacyToken,licensorName:'Original Creator',request:'An old one-time editorial use',usage:'editorial',term:'one-time',territory:'national',amount:'75.00',note:'',status:'REVOKED',createdAt,expiresAt:createdAt};
await mkdir(join(dataDir, 'uploads'));
await mkdir(join(dataDir, 'documents'));
await writeFile(join(dataDir, 'uploads', `${uploadId}.jpg`), image);
await writeFile(join(dataDir, 'documents', `${documentId}.pdf`), Buffer.from('%PDF-1.4\n' + 'test'.repeat(20)));
await writeFile(join(dataDir, 'store.json'), JSON.stringify({
  version:1,uploads:{[uploadId]:{id:uploadId,kind:'preview',mime:'image/jpeg',ext:'.jpg',size:image.length,sessionId:owner,createdAt}},
  cases:{[caseId]:{id:caseId,...original,previewUploadId:uploadId,previewSha256:fingerprint,sessionId:owner,createdAt,search,documents:[document],offers:[legacyOffer]}},
  listings:{},quotes:{},orders:{},licenses:{},
}));
const server = spawn(process.execPath, ['--import', fileURLToPath(new URL('./paypal-mock.mjs', import.meta.url)), fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  cwd:fileURLToPath(root),env:{...process.env,RIGHTS_DESK_KEYCHAIN:'0',DATA_DIR:dataDir,PORT:String(port),PAYPAL_CLIENT_ID:'test-only-client',PAYPAL_CLIENT_SECRET:'test-only-secret',OLLAMA_URL:'http://127.0.0.1:1'},stdio:'pipe',
});
let output = '';
server.stderr.on('data', chunk => { output += chunk; });
async function call(path, {sid=owner,method='GET',body,headers={}}={}) {
  const response = await fetch(base+path,{method,headers:{cookie:`rd_session=${sid}`,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
  return {status:response.status,body:await response.json()};
}
const detailsPath = `/api/cases/${caseId}/details`;
try {
  let ready = false;
  for(let i=0;i<80;i++) {
    try { if((await call('/api/status')).status===200) {ready=true;break;} }
    catch {await new Promise(resolve=>setTimeout(resolve,50));}
  }
  assert.equal(ready,true,`Server failed to start: ${output}`);
  const before = (await call(`/api/cases/${caseId}`)).body;
  assert.equal((await call(detailsPath,{sid:stranger,method:'POST',body:{}})).status,404);
  assert.equal((await call(`/api/cases/case_${randomUUID()}/details`,{method:'POST',body:original})).status,404);
  for(const patch of [
    {title:''},{title:'ab'},{workType:12},{useChannel:''},{jurisdiction:''},
    {suspectedUrl:'javascript:alert(1)'},{suspectedUrl:'https://user:password@example.com'},
    {firstPublishedAt:'2026-02-30'},{likenessInvolved:'yes'},{story:'x'.repeat(1201)},
    {ownershipBasis:'x'.repeat(501)},{registrationNumber:'x'.repeat(81)},
    {previewUploadId:'other-reference'},{previewSha256:'other-fingerprint'},{search:{}},{documents:[]},{offers:[]},{sessionId:stranger},
  ]) {
    const response=await call(detailsPath,{method:'POST',body:{...original,...patch}});
    assert.equal(response.status,400,JSON.stringify({patch,response}));
  }
  const blockedOrigin=await call(detailsPath,{method:'POST',body:original,headers:{origin:'https://outside.example'}});
  assert.equal(blockedOrigin.status,403);
  assert.deepEqual((await call(`/api/cases/${caseId}`)).body,before,'Rejected updates must not change case state');

  const offered=await call(`/api/cases/${caseId}/offers`,{method:'POST',body:{licensorName:'Original Creator',request:'One editorial article for one year in the United States',usage:'editorial',term:'one-year',territory:'national',amount:'75.00',note:'Credit the creator'}});
  assert.equal(offered.status,201,JSON.stringify(offered.body));
  const offer=offered.body;
  const buyerBefore=(await call(`/api/offers/${offer.token}`,{sid:buyer})).body;
  const legacyBefore=(await call(`/api/offers/${legacyToken}`,{sid:buyer})).body;
  const ownerBefore=(await call(`/api/cases/${caseId}`)).body;
  const updated=await call(detailsPath,{method:'POST',body:{...original,title:'Updated case title',workType:'illustration',jurisdiction:'California',creatorLocation:'',suspectedUrl:'',firstPublishedAt:'',ownershipBasis:'',registrationNumber:'',likenessInvolved:null,story:''}});
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  assert.equal(updated.body.title,'Updated case title');
  assert.equal(updated.body.workType,'illustration');
  assert.equal(updated.body.jurisdiction,'California');
  for(const field of ['creatorLocation','suspectedUrl','firstPublishedAt','ownershipBasis','registrationNumber','likenessInvolved']) assert.equal(updated.body[field],null,field);
  assert.equal(updated.body.story,'');
  assert.equal(updated.body.createdAt,createdAt);
  assert.ok(updated.body.updatedAt);
  assert.equal(updated.body.previewSha256,fingerprint);
  assert.equal(updated.body.previewUrl,before.previewUrl);
  assert.deepEqual(updated.body.search,search);
  assert.deepEqual(updated.body.documents,before.documents);
  assert.deepEqual(updated.body.offers,ownerBefore.offers);
  assert.deepEqual((await call(`/api/offers/${offer.token}`,{sid:buyer})).body,buyerBefore,'New shared offer stays unchanged after case edits');
  assert.deepEqual((await call(`/api/offers/${legacyToken}`,{sid:buyer})).body,legacyBefore,'Legacy shared offer freezes its original work before case edits');
  const documentResponse=await fetch(base+`/api/cases/${caseId}/documents/${documentId}/download`,{headers:{cookie:`rd_session=${owner}`}});
  assert.equal(documentResponse.status,200);

  const checkout=await call(`/api/offers/${offer.token}/checkout`,{sid:buyer,method:'POST',body:{licenseeName:'Test Buyer',acceptedTerms:true,termsVersion:offer.termsVersion}});
  assert.equal(checkout.status,201,JSON.stringify(checkout.body));
  const paid=await call(`/api/offers/${offer.token}/orders/${checkout.body.orderId}/capture`,{sid:buyer,method:'POST',body:{}});
  assert.equal(paid.status,200,JSON.stringify(paid.body));
  assert.equal(paid.body.receipt.title,original.title);
  assert.equal(paid.body.receipt.workType,original.workType);
  assert.equal(paid.body.receipt.workSha256,fingerprint);
  assert.equal(paid.body.receipt.request,buyerBefore.request);
  const afterPaid=await call(detailsPath,{method:'POST',body:{...original,title:'Updated after paid receipt',likenessInvolved:false}});
  assert.equal(afterPaid.status,200);
  assert.equal(afterPaid.body.likenessInvolved,false);
  assert.deepEqual(afterPaid.body.offers.find(entry=>entry.id===offer.id).receipt,paid.body.receipt);
  const unknown=await call('/api/cases',{method:'POST',body:{title:'Unknown likeness case',workType:'photograph',useChannel:'website',jurisdiction:'New York',previewUploadId:uploadId,likenessInvolved:null}});
  assert.equal(unknown.status,201,JSON.stringify(unknown.body));
  assert.equal(unknown.body.likenessInvolved,null);
  console.log('Case details integration passed: owner-only edits, validation, optional clearing, unknown answers, evidence preservation, and immutable offer/receipt identity.');
} finally {
  server.kill('SIGTERM');
  await rm(dataDir,{recursive:true,force:true});
}
