import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { makeQuote, ollamaAvailable } from './lib/ai.mjs';
import { createOrder, captureOrder, getOrder, paypalConfigured, verifiedCapture } from './lib/paypal.mjs';
import { inspectEvidence } from './lib/provenance.mjs';
import { searchPublicCollections } from './lib/match.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const UPLOADS = join(DATA, 'uploads');
const DOCUMENTS = join(DATA, 'documents');
const PORT = Number(process.env.PORT || 5188);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port');
const HOST = '127.0.0.1';
const ORIGIN = `http://localhost:${PORT}`;
const store = new Store(join(DATA, 'store.json'));
const activeCaseSearches = new Set();
const OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFER_TERMS_VERSION = 'rights-desk-license-v1';
const OFFER_TERMS_TEXT = 'After Rights Desk verifies the PayPal Sandbox payment, the creator named in this offer grants the named licensee nonexclusive permission to use the identified work only for the proposed use, use type, term, and territory recorded in this offer. The creator retains copyright; no ownership is transferred. This offer covers the described permission only and does not resolve claims about earlier use. Sandbox payments use test funds.';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new HttpError(status, code, message);
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function session(req, res) {
  const match = /(?:^|;\s*)rd_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '');
  if (match) return match[1];
  const id = randomUUID();
  res.setHeader('set-cookie', `rd_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
  return id;
}

function checkOrigin(req) {
  if (req.method !== 'POST') return;
  const origin = req.headers.origin;
  if (!origin) return; // curl and native tools do not send Origin.
  try {
    const parsed = new URL(origin);
    if (parsed.host === req.headers.host && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return;
  } catch { /* invalid origin */ }
  fail(403, 'ORIGIN_DENIED', 'Cross-origin writes are not allowed.');
}

function localBaseUrl(req) {
  let url;
  try { url = new URL(`http://${req.headers.host || ''}`); }
  catch { fail(400, 'INVALID_HOST', 'Use a localhost address for checkout.'); }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]' && !hostname.endsWith('.localhost')) {
    fail(400, 'INVALID_HOST', 'Use a localhost address for checkout.');
  }
  return url.origin;
}

async function bodyBytes(req, maxBytes) {
  const claimed = Number(req.headers['content-length']);
  if (Number.isFinite(claimed) && claimed > maxBytes) fail(413, 'UPLOAD_TOO_LARGE', `Request exceeds ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
  const parts = [];
  let count = 0;
  for await (const part of req) {
    count += part.length;
    if (count > maxBytes) fail(413, 'UPLOAD_TOO_LARGE', `Request exceeds ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
    parts.push(part);
  }
  return Buffer.concat(parts, count);
}

async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'JSON_REQUIRED', 'Send Content-Type: application/json.');
  let parsed;
  try { parsed = JSON.parse((await bodyBytes(req, 32 * 1024)).toString('utf8')); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  return parsed;
}

function textField(value, name, min, max) {
  if (typeof value !== 'string') fail(400, 'INVALID_FIELD', `${name} must be text.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) fail(400, 'INVALID_FIELD', `${name} must be ${min}–${max} characters.`);
  return clean;
}

function declarationClaim(value) {
  const raw = typeof value === 'object' && value !== null ? value.claim : value;
  if (typeof raw !== 'string') fail(400, 'INVALID_DECLARATION', 'Choose camera, AI assisted, AI generated, or unsure.');
  const aliases = {
    camera: 'camera', 'camera-captured': 'camera', camera_captured: 'camera',
    ai_assisted: 'ai_assisted', 'ai-assisted': 'ai_assisted',
    ai_generated: 'ai_generated', 'ai-generated': 'ai_generated', generated: 'ai_generated',
    unsure: 'unsure', unknown: 'unsure',
  };
  const claim = Object.hasOwn(aliases, raw) ? aliases[raw] : null;
  if (!claim) fail(400, 'INVALID_DECLARATION', 'Choose camera, AI assisted, AI generated, or unsure.');
  return claim;
}

function sniff(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: '.png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buffer.length >= 4 && (buffer.toString('latin1', 0, 4) === 'II*\x00' || buffer.toString('latin1', 0, 4) === 'MM\x00*')) return { mime: 'image/tiff', ext: '.tif' };
  return null;
}

function uploadFilePath(upload) {
  return join(UPLOADS, `${upload.id}${upload.ext}`);
}

function publicListing(listing) {
  return {
    id: listing.id,
    title: listing.title,
    artist: listing.artist,
    story: listing.story,
    declaration: listing.declaration,
    basePrice: listing.basePrice,
    currency: 'USD',
    previewUrl: `/api/previews/${listing.previewUploadId}`,
    inspection: listing.inspection || null,
    createdAt: listing.createdAt,
  };
}

function publicCase(item) {
  return {
    id: item.id, title: item.title, workType: item.workType, useChannel: item.useChannel,
    jurisdiction: item.jurisdiction, creatorLocation: item.creatorLocation || null,
    suspectedUrl: item.suspectedUrl || null, firstPublishedAt: item.firstPublishedAt || null,
    ownershipBasis: item.ownershipBasis || null, registrationNumber: item.registrationNumber || null,
    likenessInvolved: typeof item.likenessInvolved === 'boolean' ? item.likenessInvolved : null, story: item.story || '',
    previewUrl: `/api/previews/${item.previewUploadId}`, previewSha256: item.previewSha256 || null, createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    search: item.search || null, documents: (item.documents || []).map(documentMetadata),
    offers: (item.offers || []).map(ownerOffer),
  };
}

function offerStatus(offer) {
  return ['OPEN', 'CHECKOUT'].includes(offer.status) && Date.parse(offer.expiresAt) <= Date.now() ? 'EXPIRED' : offer.status;
}

function ownerOffer(offer) {
  return {
    id: offer.id, token: offer.token, sharePath: `/?offer=${encodeURIComponent(offer.token)}`,
    status: offerStatus(offer), licensorName: offer.licensorName, licenseeName: offer.licenseeName || null,
    request: offer.request, usage: offer.usage, term: offer.term, territory: offer.territory,
    amount: offer.amount, currency: 'USD', note: offer.note || '',
    termsVersion: offer.termsVersion || OFFER_TERMS_VERSION, termsText: offer.termsText || OFFER_TERMS_TEXT,
    createdAt: offer.createdAt, expiresAt: offer.expiresAt, paidAt: offer.paidAt || null,
    receiptId: offer.receipt?.id || null, receipt: offer.receipt || null,
  };
}

function buyerOffer(item, offer, sid) {
  return {
    id: offer.id, title: offer.workTitle ?? item.title, workType: offer.workType ?? item.workType, workSha256: offer.workSha256 ?? item.previewSha256,
    licensorName: offer.licensorName,
    request: offer.request, usage: offer.usage, term: offer.term, territory: offer.territory,
    amount: offer.amount, currency: 'USD', note: offer.note || '',
    termsVersion: offer.termsVersion || OFFER_TERMS_VERSION, termsText: offer.termsText || OFFER_TERMS_TEXT,
    status: offerStatus(offer), expiresAt: offer.expiresAt,
    checkout: offer.buyerSessionId === sid && offer.orderId ? { orderId: offer.orderId, licenseeName: offer.licenseeName } : null,
  };
}

function findOffer(state, token) {
  for (const item of Object.values(state.cases)) {
    const offer = (item.offers || []).find(entry => entry.token === token);
    if (offer) return { item, offer };
  }
  return null;
}

function moneyField(value, name, min = 5, max = 100000) {
  const raw = String(value ?? '');
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw)) fail(400, 'INVALID_PRICE', `${name} must be a dollar amount with at most two decimal places.`);
  const cents = Math.round(Number(raw) * 100);
  if (cents < min * 100 || cents > max * 100) fail(400, 'INVALID_PRICE', `${name} must be $${min}–$${max}.`);
  return (cents / 100).toFixed(2);
}

function enumField(value, name, values) {
  if (typeof value !== 'string' || !values.includes(value)) fail(400, 'INVALID_FIELD', `Choose a valid ${name}.`);
  return value;
}

function documentMetadata(item) {
  return { id: item.id, name: item.name, mime: item.mime, size: item.size, uploadedAt: item.uploadedAt };
}

function optionalText(value, name, max) {
  if (value === undefined || value === null || value === '') return null;
  return textField(value, name, 1, max);
}

function optionalHttpUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  const candidate = textField(value, 'Suspected URL', 8, 1000);
  try {
    const parsed = new URL(candidate);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid');
    return parsed.href;
  } catch { fail(400, 'INVALID_URL', 'Suspected URL must be an HTTP or HTTPS page address.'); }
}

function optionalDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    fail(400, 'INVALID_DATE', 'First published date must be YYYY-MM-DD.');
  }
  return value;
}

function caseDetails(body) {
  if (body.likenessInvolved != null && typeof body.likenessInvolved !== 'boolean') fail(400, 'INVALID_FIELD', 'Likeness involved must be true, false, or null when unsure.');
  return {
    title: textField(body.title, 'Title', 3, 120),
    workType: textField(body.workType, 'Medium', 2, 80),
    useChannel: textField(body.useChannel, 'Suspected use', 2, 80),
    jurisdiction: textField(body.jurisdiction, 'Location of suspected use', 2, 80),
    creatorLocation: optionalText(body.creatorLocation, 'Creator location', 80),
    suspectedUrl: optionalHttpUrl(body.suspectedUrl),
    firstPublishedAt: optionalDate(body.firstPublishedAt),
    ownershipBasis: optionalText(body.ownershipBasis, 'Ownership basis', 500),
    registrationNumber: optionalText(body.registrationNumber, 'Registration number', 80),
    likenessInvolved: body.likenessInvolved ?? null,
    story: optionalText(body.story, 'Story', 1200) || '',
  };
}

function snapshotOfferWork(item, offer) {
  offer.workTitle ??= item.title;
  offer.workType ??= item.workType;
  offer.workSha256 ??= item.previewSha256;
}

function documentType(bytes) {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: '.png' };
  return null;
}

function safeDocumentName(raw, ext) {
  const last = String(raw || '').replaceAll('\\', '/').split('/').at(-1) || `document${ext}`;
  const cleaned = last.normalize('NFKC').replace(/[^a-zA-Z0-9 ._()-]/g, '_').replace(/^\.+/, '').slice(0, 90).trim();
  const stem = cleaned.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim() || 'document';
  return `${stem}${ext}`;
}

function publicQuote(quote) {
  const { sessionId, ...rest } = quote;
  return rest;
}

function publicLicense(license, state) {
  const listing = state.listings[license.listingId];
  const quote = state.quotes[license.quoteId];
  return {
    token: license.token,
    licenseToken: license.token,
    downloadUrl: `/api/download/${license.token}`,
    orderId: license.orderId,
    listingId: license.listingId,
    title: listing?.title || 'Licensed image',
    artist: listing?.artist || '',
    usage: quote?.usage,
    term: quote?.term,
    territory: quote?.territory,
    amount: quote?.amount,
    currency: 'USD',
    issuedAt: license.issuedAt,
  };
}

async function streamFile(res, path, mime, disposition = null, cache = 'no-store') {
  let fileStat;
  try { fileStat = await stat(path); }
  catch { fail(404, 'NOT_FOUND', 'File not found.'); }
  if (!fileStat.isFile()) fail(404, 'NOT_FOUND', 'File not found.');
  res.writeHead(200, {
    'content-type': mime,
    'content-length': fileStat.size,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(disposition ? { 'content-disposition': disposition } : {}),
  });
  await new Promise((resolveDone, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    res.on('close', resolveDone);
    stream.on('end', resolveDone);
    stream.pipe(res);
  });
}

async function handleApi(req, res, url) {
  const sid = session(req, res);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/status') {
    return json(res, 200, { paypalConfigured: paypalConfigured(), ollamaAvailable: await ollamaAvailable(), paypalMode: 'sandbox' });
  }

  if (req.method === 'GET' && path === '/api/listings') {
    const state = store.snapshot();
    const listings = Object.values(state.listings).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicListing);
    return json(res, 200, listings);
  }

  if (req.method === 'GET' && path === '/api/cases') {
    const cases = Object.values(store.snapshot().cases).filter(item => item.sessionId === sid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicCase);
    return json(res, 200, cases);
  }

  if (req.method === 'POST' && path === '/api/cases') {
    const body = await jsonBody(req);
    const details = caseDetails(body);
    const previewUploadId = textField(body.previewUploadId, 'Preview upload ID', 5, 80);
    const item = await store.update(async state => {
      const upload = state.uploads[previewUploadId];
      if (!upload || upload.kind !== 'preview' || upload.sessionId !== sid) fail(400, 'INVALID_UPLOAD', 'Choose a preview uploaded in this browser session.');
      if (Object.values(state.listings).some(listing => listing.previewUploadId === upload.id)) fail(409, 'PREVIEW_PUBLISHED', 'This preview is already public in a listing. Upload a separate private preview for this case.');
      if (Object.values(state.cases).filter(entry => entry.sessionId === sid).length >= 20) fail(429, 'CASE_LIMIT', 'This local session has reached its 20-case limit.');
      const previewSha256 = createHash('sha256').update(await readFile(uploadFilePath(upload))).digest('hex');
      const item = {
        id: `case_${randomUUID()}`, ...details, previewUploadId, sessionId: sid,
        previewSha256, createdAt: new Date().toISOString(), search: null, documents: [],
      };
      state.cases[item.id] = item;
      return item;
    });
    return json(res, 201, publicCase(item));
  }

  const caseMatch = /^\/api\/cases\/(case_[a-f0-9-]+)$/.exec(path);
  if (req.method === 'GET' && caseMatch) {
    const item = store.snapshot().cases[caseMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    return json(res, 200, publicCase(item));
  }

  const caseDetailsMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/details$/.exec(path);
  if (req.method === 'POST' && caseDetailsMatch) {
    const current = store.snapshot().cases[caseDetailsMatch[1]];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    const body = await jsonBody(req);
    const allowed = new Set(['title', 'workType', 'useChannel', 'jurisdiction', 'creatorLocation', 'suspectedUrl', 'firstPublishedAt', 'ownershipBasis', 'registrationNumber', 'likenessInvolved', 'story']);
    if (Object.keys(body).some(key => !allowed.has(key))) fail(400, 'READ_ONLY_FIELD', 'Only case details can be changed. The reference, evidence, and offers stay with the case.');
    const details = caseDetails(body);
    const item = await store.update(state => {
      const item = state.cases[caseDetailsMatch[1]];
      if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
      // Legacy offers get their original work identity frozen before the
      // editable case facts change. Accepted and shared terms remain stable.
      for (const offer of item.offers || []) snapshotOfferWork(item, offer);
      Object.assign(item, details, { updatedAt: new Date().toISOString() });
      return item;
    });
    return json(res, 200, publicCase(item));
  }

  const caseDraftMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/offer-draft$/.exec(path);
  if (req.method === 'POST' && caseDraftMatch) {
    const item = store.snapshot().cases[caseDraftMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    const body = await jsonBody(req);
    const request = textField(body.request, 'Proposed licensed use', 12, 1000);
    const basePrice = Number(moneyField(body.basePrice, 'Base price', 5, 4000));
    return json(res, 200, await makeQuote(request, basePrice));
  }

  const caseOffersMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/offers$/.exec(path);
  if (req.method === 'GET' && caseOffersMatch) {
    const item = store.snapshot().cases[caseOffersMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    return json(res, 200, (item.offers || []).map(ownerOffer));
  }
  if (req.method === 'POST' && caseOffersMatch) {
    const body = await jsonBody(req);
    const licensorName = textField(body.licensorName, 'Licensor name', 2, 100);
    const request = textField(body.request, 'Proposed licensed use', 12, 1000);
    const usage = enumField(body.usage, 'use type', ['editorial', 'commercial', 'advertising']);
    const term = enumField(body.term, 'term', ['one-time', 'one-year', 'perpetual']);
    const territory = enumField(body.territory, 'territory', ['local', 'national', 'worldwide']);
    const amount = moneyField(body.amount, 'Offer price');
    const note = optionalText(body.note, 'Offer note', 500) || '';
    const offer = await store.update(state => {
      const item = state.cases[caseOffersMatch[1]];
      if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
      item.offers ||= [];
      if (item.offers.length >= 10) fail(429, 'OFFER_LIMIT', 'This case has reached its ten-offer limit.');
      if (item.offers.some(entry => ['OPEN', 'CHECKOUT'].includes(offerStatus(entry)) || state.orders[entry.orderId]?.status === 'CAPTURE_UNKNOWN')) fail(409, 'ACTIVE_OFFER', 'Resolve or revoke the current open offer before creating a new one.');
      const now = new Date();
      const created = {
        id: `offer_${randomUUID()}`, token: randomBytes(32).toString('base64url'),
        workTitle: item.title, workType: item.workType, workSha256: item.previewSha256,
        licensorName, request, usage, term, territory, amount, note,
        termsVersion: OFFER_TERMS_VERSION, termsText: OFFER_TERMS_TEXT,
        status: 'OPEN', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + OFFER_TTL_MS).toISOString(),
      };
      item.offers.push(created);
      return created;
    });
    return json(res, 201, ownerOffer(offer));
  }

  const revokeOfferMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/offers\/(offer_[a-f0-9-]+)\/revoke$/.exec(path);
  if (req.method === 'POST' && revokeOfferMatch) {
    await jsonBody(req);
    const revoked = await store.update(state => {
      const item = state.cases[revokeOfferMatch[1]];
      if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
      const offer = (item.offers || []).find(entry => entry.id === revokeOfferMatch[2]);
      if (!offer) fail(404, 'NOT_FOUND', 'Offer not found.');
      if (offer.status === 'PAID') fail(409, 'ALREADY_PAID', 'A paid license cannot be revoked through this prototype.');
      if (offer.status === 'REVOKED') return offer;
      const order = offer.orderId && state.orders[offer.orderId];
      if (['CAPTURING', 'CAPTURE_UNKNOWN', 'COMPLETED'].includes(order?.status)) fail(409, 'PAYMENT_IN_PROGRESS', 'Payment confirmation needs to finish before this offer can be revoked. The buyer can retry confirmation.');
      offer.status = 'REVOKED';
      offer.revokedAt = new Date().toISOString();
      return offer;
    });
    return json(res, 200, ownerOffer(revoked));
  }

  const buyerOfferMatch = /^\/api\/offers\/([A-Za-z0-9_-]{43})$/.exec(path);
  if (req.method === 'GET' && buyerOfferMatch) {
    const found = findOffer(store.snapshot(), buyerOfferMatch[1]);
    if (!found) fail(404, 'NOT_FOUND', 'Offer not found.');
    return json(res, 200, buyerOffer(found.item, found.offer, sid));
  }

  const offerCheckoutMatch = /^\/api\/offers\/([A-Za-z0-9_-]{43})\/checkout$/.exec(path);
  if (req.method === 'POST' && offerCheckoutMatch) {
    if (!paypalConfigured()) fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured.');
    const body = await jsonBody(req);
    const licenseeName = textField(body.licenseeName, 'Licensee name', 2, 100);
    if (body.acceptedTerms !== true) fail(400, 'TERMS_REQUIRED', 'Review and accept the exact offer terms before continuing.');
    const prepared = await store.update(state => {
      const found = findOffer(state, offerCheckoutMatch[1]);
      if (!found) fail(404, 'NOT_FOUND', 'Offer not found.');
      const { item, offer } = found;
      if (body.termsVersion !== (offer.termsVersion || OFFER_TERMS_VERSION)) fail(400, 'TERMS_CHANGED', 'Reload this offer and review its current terms before continuing.');
      const status = offerStatus(offer);
      if (status === 'EXPIRED') fail(409, 'OFFER_EXPIRED', 'This offer has expired. Ask the creator for a new offer.');
      if (status === 'REVOKED' || status === 'PAID') fail(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available for checkout.');
      const now = new Date().toISOString();
      if (status === 'CHECKOUT') {
        if (offer.buyerSessionId !== sid) fail(409, 'OFFER_RESERVED', 'This offer is already being checked out in another browser session.');
        if (offer.licenseeName !== licenseeName) fail(409, 'NAME_LOCKED', 'The licensee name cannot change after checkout starts.');
        const order = state.orders[offer.orderId];
        if (!order || order.offerId !== offer.id) fail(409, 'ORDER_MISSING', 'The offer checkout could not be resumed.');
        if (['CAPTURING', 'CAPTURE_UNKNOWN'].includes(order.status)) fail(409, 'CAPTURE_IN_PROGRESS', 'Payment confirmation is in progress. Retry confirmation for the existing order.');
        if (order.paypalOrderId && order.approvalUrl) return { order, offer, item, existing: true };
        if (order.status === 'CREATING' && Date.now() - Date.parse(order.updatedAt) < 30000) fail(409, 'CHECKOUT_IN_PROGRESS', 'Checkout is being created. Try again shortly.');
        order.status = 'CREATING';
        order.updatedAt = now;
        return { order, offer, item, existing: false };
      }
      const order = {
        id: `ord_${randomUUID()}`, offerId: offer.id, caseId: item.id, sessionId: sid,
        status: 'CREATING', requestId: randomUUID(), captureRequestId: randomUUID(),
        createdAt: now, updatedAt: now,
        termsVersion: offer.termsVersion || OFFER_TERMS_VERSION, termsText: offer.termsText || OFFER_TERMS_TEXT,
      };
      state.orders[order.id] = order;
      offer.status = 'CHECKOUT';
      offer.buyerSessionId = sid;
      offer.licenseeName = licenseeName;
      offer.acceptedAt = now;
      offer.orderId = order.id;
      return { order, offer, item, existing: false };
    });
    if (prepared.existing) return json(res, 200, { orderId: prepared.order.id, approvalUrl: prepared.order.approvalUrl, status: prepared.order.status });
    const baseUrl = localBaseUrl(req);
    const query = `offer=${encodeURIComponent(prepared.offer.token)}&orderId=${encodeURIComponent(prepared.order.id)}`;
    try {
      const payPalOrder = await createOrder({
        orderId: prepared.order.id,
        quote: { id: prepared.offer.id, amount: prepared.offer.amount },
        listing: { title: prepared.offer.workTitle ?? prepared.item.title },
        requestId: prepared.order.requestId,
        baseUrl,
        returnUrl: `${baseUrl}/?${query}&offerCheckout=return`,
        cancelUrl: `${baseUrl}/?${query}&offerCheckout=cancel`,
        description: `Rights Desk creator-approved license: ${prepared.offer.workTitle ?? prepared.item.title}`,
      });
      await store.update(state => {
        const found = findOffer(state, prepared.offer.token);
        const order = state.orders[prepared.order.id];
        if (!found || offerStatus(found.offer) !== 'CHECKOUT' || found.offer.orderId !== order?.id) fail(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available.');
        order.paypalOrderId = payPalOrder.paypalOrderId;
        order.approvalUrl = payPalOrder.approvalUrl;
        order.status = 'READY';
        order.updatedAt = new Date().toISOString();
      });
      return json(res, 201, { orderId: prepared.order.id, approvalUrl: payPalOrder.approvalUrl, status: 'READY' });
    } catch (error) {
      await store.update(state => {
        const order = state.orders[prepared.order.id];
        if (order?.status === 'CREATING') { order.status = 'RETRYABLE'; order.updatedAt = new Date().toISOString(); }
      });
      throw error;
    }
  }

  const offerCaptureMatch = /^\/api\/offers\/([A-Za-z0-9_-]{43})\/orders\/(ord_[a-f0-9-]+)\/capture$/.exec(path);
  if (req.method === 'POST' && offerCaptureMatch) {
    await jsonBody(req);
    const current = store.snapshot();
    const found = findOffer(current, offerCaptureMatch[1]);
    const currentOrder = current.orders[offerCaptureMatch[2]];
    if (!found || !currentOrder || currentOrder.offerId !== found.offer.id || currentOrder.sessionId !== sid || found.offer.orderId !== currentOrder.id) fail(404, 'NOT_FOUND', 'Offer checkout not found.');
    if (found.offer.status === 'PAID' && found.offer.receipt) return json(res, 200, { status: 'COMPLETED', receipt: found.offer.receipt });
    if (!paypalConfigured()) fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured.');
    const prepared = await store.update(state => {
      const result = findOffer(state, offerCaptureMatch[1]);
      const order = state.orders[offerCaptureMatch[2]];
      if (!result || !order || order.offerId !== result.offer.id || order.sessionId !== sid || result.offer.orderId !== order.id) fail(404, 'NOT_FOUND', 'Offer checkout not found.');
      if (result.offer.status === 'PAID' && result.offer.receipt) return { completed: true, receipt: result.offer.receipt };
      const reconcileOnly = ['CAPTURE_UNKNOWN', 'CAPTURING'].includes(order.status);
      if (offerStatus(result.offer) !== 'CHECKOUT' && !reconcileOnly) fail(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available.');
      if (!order.paypalOrderId || order.status === 'CREATING' || order.status === 'RETRYABLE') fail(409, 'ORDER_NOT_READY', 'PayPal order has not been created.');
      if (order.status === 'CAPTURING' && Date.now() - Date.parse(order.updatedAt) < 30000) fail(409, 'CAPTURE_IN_PROGRESS', 'Payment capture is in progress. Try again shortly.');
      order.status = 'CAPTURING';
      order.updatedAt = new Date().toISOString();
      return { completed: false, order, offer: result.offer, item: result.item, reconcileOnly };
    });
    if (prepared.completed) return json(res, 200, { status: 'COMPLETED', receipt: prepared.receipt });
    let paymentKnown = false;
    try {
      const result = prepared.reconcileOnly
        ? await getOrder(prepared.order.paypalOrderId)
        : await captureOrder(prepared.order.paypalOrderId, prepared.order.captureRequestId);
      paymentKnown = result?.status !== 'COMPLETED';
      const captureId = verifiedCapture(result, {
        paypalOrderId: prepared.order.paypalOrderId,
        quoteId: prepared.offer.id,
        amount: prepared.offer.amount,
      });
      if (!captureId) fail(409, 'PAYMENT_NOT_COMPLETED', 'PayPal has not confirmed a completed capture for this exact license amount.');
      paymentKnown = true;
      const receipt = await store.update(state => {
        const found = findOffer(state, prepared.offer.token);
        const order = state.orders[prepared.order.id];
        if (!found || !order || found.offer.orderId !== order.id) fail(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available.');
        if (found.offer.status === 'PAID' && found.offer.receipt) return found.offer.receipt;
        if (found.offer.status !== 'CHECKOUT' || order.status !== 'CAPTURING') fail(409, 'OFFER_UNAVAILABLE', 'This offer is no longer available.');
        const issuedAt = new Date().toISOString();
        const issued = {
          id: `license_${randomUUID()}`, offerId: found.offer.id, title: found.offer.workTitle ?? found.item.title,
          workType: found.offer.workType ?? found.item.workType, workSha256: found.offer.workSha256 ?? found.item.previewSha256,
          licensorName: found.offer.licensorName, licenseeName: found.offer.licenseeName,
          request: found.offer.request, usage: found.offer.usage, term: found.offer.term,
          territory: found.offer.territory, note: found.offer.note,
          amount: found.offer.amount, currency: 'USD', paypalCaptureId: captureId,
          termsVersion: prepared.order.termsVersion || OFFER_TERMS_VERSION,
          termsText: prepared.order.termsText || OFFER_TERMS_TEXT,
          acceptedAt: found.offer.acceptedAt,
          issuedAt,
        };
        found.offer.status = 'PAID';
        found.offer.paidAt = issuedAt;
        found.offer.receipt = issued;
        order.status = 'COMPLETED';
        order.captureId = captureId;
        order.updatedAt = issuedAt;
        return issued;
      });
      return json(res, 200, { status: 'COMPLETED', receipt });
    } catch (error) {
      await store.update(state => {
        const order = state.orders[prepared.order.id];
        if (order?.status === 'CAPTURING') { order.status = paymentKnown ? 'READY' : 'CAPTURE_UNKNOWN'; order.updatedAt = new Date().toISOString(); }
      });
      throw error;
    }
  }

  const offerReceiptMatch = /^\/api\/offers\/([A-Za-z0-9_-]{43})\/receipt$/.exec(path);
  if (req.method === 'GET' && offerReceiptMatch) {
    const state = store.snapshot();
    const found = findOffer(state, offerReceiptMatch[1]);
    const orderId = url.searchParams.get('orderId');
    const order = orderId && state.orders[orderId];
    if (!found || !order || found.offer.orderId !== order.id || order.offerId !== found.offer.id || (sid !== order.sessionId && sid !== found.item.sessionId)) fail(404, 'NOT_FOUND', 'License receipt not found.');
    if (found.offer.status !== 'PAID' || !found.offer.receipt || order.status !== 'COMPLETED') fail(409, 'PAYMENT_REQUIRED', 'Payment has not been confirmed.');
    return json(res, 200, found.offer.receipt);
  }

  const caseResultsMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/search-results$/.exec(path);
  if (req.method === 'GET' && caseResultsMatch) {
    const item = store.snapshot().cases[caseResultsMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    return json(res, 200, { caseId: item.id, search: item.search || null });
  }

  const caseSearchMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/search$/.exec(path);
  if (req.method === 'POST' && caseSearchMatch) {
    const state = store.snapshot();
    const item = state.cases[caseSearchMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    if (item.search && Date.now() - Date.parse(item.search.searchedAt) < 5 * 60 * 1000) {
      return json(res, 200, { case: publicCase(item), search: item.search, cached: true });
    }
    if (activeCaseSearches.has(item.id)) fail(409, 'SEARCH_IN_PROGRESS', 'A search is already running for this case.');
    if (activeCaseSearches.size >= 2) fail(429, 'SEARCH_BUSY', 'Two searches are already running. Try again shortly.');
    activeCaseSearches.add(item.id);
    try {
      const upload = state.uploads[item.previewUploadId];
      if (!upload) fail(404, 'PREVIEW_MISSING', 'Case preview is unavailable.');
      const search = await searchPublicCollections({ previewPath: uploadFilePath(upload), title: item.title, story: item.story });
      const updated = await store.update(draft => {
        const current = draft.cases[item.id];
        if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
        current.search = search;
        return current;
      });
      return json(res, 200, { case: publicCase(updated), search, cached: false });
    } finally { activeCaseSearches.delete(item.id); }
  }

  const caseDocumentsMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/documents$/.exec(path);
  if (req.method === 'GET' && caseDocumentsMatch) {
    const item = store.snapshot().cases[caseDocumentsMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    return json(res, 200, (item.documents || []).map(documentMetadata));
  }
  if (req.method === 'POST' && caseDocumentsMatch) {
    const item = store.snapshot().cases[caseDocumentsMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    if ((item.documents || []).length >= 8) fail(429, 'DOCUMENT_LIMIT', 'This case already has eight documents.');
    const bytes = await bodyBytes(req, 10 * 1024 * 1024);
    const file = documentType(bytes);
    if (!file || bytes.length < 32) fail(415, 'UNSUPPORTED_DOCUMENT', 'Upload a PDF, JPEG, or PNG document.');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (mime !== file.mime) fail(415, 'MIME_MISMATCH', 'Content-Type does not match the document.');
    const id = `doc_${randomUUID()}`;
    const doc = {
      id, name: safeDocumentName(req.headers['x-file-name'], file.ext), mime: file.mime,
      ext: file.ext, size: bytes.length, uploadedAt: new Date().toISOString(),
    };
    const filePath = join(DOCUMENTS, `${id}${file.ext}`);
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await store.update(draft => {
        const current = draft.cases[item.id];
        if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
        if ((current.documents || []).length >= 8) fail(429, 'DOCUMENT_LIMIT', 'This case already has eight documents.');
        current.documents ||= [];
        current.documents.push(doc);
      });
    } catch (error) { await unlink(filePath).catch(() => {}); throw error; }
    return json(res, 201, documentMetadata(doc));
  }

  const caseDocumentDownloadMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/documents\/(doc_[a-f0-9-]+)\/download$/.exec(path);
  if (req.method === 'GET' && caseDocumentDownloadMatch) {
    const item = store.snapshot().cases[caseDocumentDownloadMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    const doc = (item.documents || []).find(entry => entry.id === caseDocumentDownloadMatch[2]);
    if (!doc) fail(404, 'NOT_FOUND', 'Document not found.');
    return streamFile(res, join(DOCUMENTS, `${doc.id}${doc.ext}`), doc.mime, `attachment; filename="${doc.name}"`);
  }

  const listingMatch = /^\/api\/listings\/([a-z0-9_-]+)$/.exec(path);
  if (req.method === 'GET' && listingMatch) {
    const listing = store.snapshot().listings[listingMatch[1]];
    if (!listing) fail(404, 'NOT_FOUND', 'Listing not found.');
    return json(res, 200, publicListing(listing));
  }

  const previewMatch = /^\/api\/previews\/([a-z0-9_-]+)$/.exec(path);
  if (req.method === 'GET' && previewMatch) {
    const state = store.snapshot();
    const upload = state.uploads[previewMatch[1]];
    if (!upload || upload.kind !== 'preview') fail(404, 'NOT_FOUND', 'Preview not found.');
    const published = Object.values(state.listings).some(item => item.previewUploadId === upload.id);
    if (!published && upload.sessionId !== sid) fail(404, 'NOT_FOUND', 'Preview not found.');
    return streamFile(res, uploadFilePath(upload), upload.mime, null, published ? 'public, max-age=300' : 'private, no-store');
  }

  if (req.method === 'POST' && path === '/api/uploads') {
    const kind = url.searchParams.get('kind');
    if (kind !== 'preview' && kind !== 'source') fail(400, 'INVALID_KIND', 'Upload kind must be preview or source.');
    const bytes = await bodyBytes(req, kind === 'source' ? 32 * 1024 * 1024 : 12 * 1024 * 1024);
    if (bytes.length < 32) fail(400, 'INVALID_IMAGE', 'Image file is empty or too small.');
    const file = sniff(bytes);
    if (!file || (kind === 'preview' && file.mime === 'image/tiff')) fail(415, 'UNSUPPORTED_IMAGE', 'Use JPEG, PNG, or WebP for previews; source also accepts TIFF/DNG-style files.');
    const declaredMime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const acceptedMimes = kind === 'source' && file.mime === 'image/tiff'
      ? ['image/tiff', 'image/x-adobe-dng', 'image/dng', 'image/x-dng', 'image/x-canon-cr2', 'image/x-nikon-nef', 'application/octet-stream']
      : [file.mime, 'application/octet-stream'];
    if (!acceptedMimes.includes(declaredMime)) fail(415, 'MIME_MISMATCH', 'Content-Type does not match the uploaded image.');
    const id = `upl_${randomUUID()}`;
    const fileNameExtension = extname(String(req.headers['x-file-name'] || '')).toLowerCase();
    const sourceExtension = kind === 'source' && file.mime === 'image/tiff'
      ? (['.dng', '.cr2', '.nef', '.tif', '.tiff'].includes(fileNameExtension) ? fileNameExtension
        : ({ 'image/x-adobe-dng': '.dng', 'image/dng': '.dng', 'image/x-dng': '.dng', 'image/x-canon-cr2': '.cr2', 'image/x-nikon-nef': '.nef' })[declaredMime])
      : null;
    const upload = { id, kind, mime: file.mime, ext: sourceExtension || file.ext, size: bytes.length, sessionId: sid, createdAt: new Date().toISOString() };
    await writeFile(uploadFilePath(upload), bytes, { flag: 'wx', mode: 0o600 });
    await store.update(state => { state.uploads[id] = upload; });
    return json(res, 201, { uploadId: id, kind, previewUrl: kind === 'preview' ? `/api/previews/${id}` : null });
  }

  if (req.method === 'POST' && path === '/api/listings') {
    const body = await jsonBody(req);
    const title = textField(body.title, 'Title', 3, 100);
    const artist = textField(body.artist, 'Artist', 2, 80);
    const story = textField(body.story, 'Story', 10, 1200);
    const declaration = declarationClaim(body.declaration);
    const price = Number(body.basePrice);
    if (!Number.isFinite(price) || price < 5 || price > 10000 || Math.round(price * 100) / 100 !== price) fail(400, 'INVALID_PRICE', 'Base price must be $5–$10,000 with at most two decimal places.');
    const id = `img_${randomUUID()}`;
    const listing = await store.update(state => {
      const preview = state.uploads[body.previewUploadId];
      const source = state.uploads[body.sourceUploadId];
      if (!preview || preview.kind !== 'preview' || preview.sessionId !== sid) fail(400, 'INVALID_UPLOAD', 'Choose a preview uploaded in this browser session.');
      if (!source || source.kind !== 'source' || source.sessionId !== sid) fail(400, 'INVALID_UPLOAD', 'Choose a source file uploaded in this browser session.');
      if (Object.values(state.cases).some(item => item.previewUploadId === preview.id)) fail(409, 'PRIVATE_PREVIEW', 'This preview belongs to a private case. Upload a separate preview for the public listing.');
      if (Object.values(state.listings).some(item => item.previewUploadId === preview.id || item.sourceUploadId === source.id)) fail(409, 'UPLOAD_USED', 'Each upload can be attached to one listing.');
      const item = { id, title, artist, story, declaration, previewUploadId: preview.id, sourceUploadId: source.id, basePrice: price, inspection: null, sessionId: sid, createdAt: new Date().toISOString() };
      state.listings[id] = item;
      return item;
    });
    return json(res, 201, publicListing(listing));
  }

  const inspectMatch = /^\/api\/listings\/([a-z0-9_-]+)\/inspect$/.exec(path);
  if (req.method === 'POST' && inspectMatch) {
    const state = store.snapshot();
    const listing = state.listings[inspectMatch[1]];
    if (!listing) fail(404, 'NOT_FOUND', 'Listing not found.');
    if (listing.sessionId !== sid) fail(403, 'NOT_OWNER', 'Only this listing’s uploader can request inspection.');
    const preview = state.uploads[listing.previewUploadId];
    const source = state.uploads[listing.sourceUploadId];
    const inspection = await inspectEvidence({
      previewPath: uploadFilePath(preview),
      sourcePath: uploadFilePath(source),
      declaration: { claim: listing.declaration },
    });
    const updated = await store.update(draft => {
      draft.listings[listing.id].inspection = inspection;
      return draft.listings[listing.id];
    });
    return json(res, 200, { listing: publicListing(updated), inspection });
  }

  const quoteMatch = /^\/api\/listings\/([a-z0-9_-]+)\/quote$/.exec(path);
  if (req.method === 'POST' && quoteMatch) {
    const listing = store.snapshot().listings[quoteMatch[1]];
    if (!listing) fail(404, 'NOT_FOUND', 'Listing not found.');
    const body = await jsonBody(req);
    const request = textField(body.request, 'License request', 12, 1000);
    const scope = await makeQuote(request, listing.basePrice);
    const quote = {
      id: `q_${randomUUID()}`, listingId: listing.id, sessionId: sid, request,
      basePrice: listing.basePrice, ...scope,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    await store.update(state => { state.quotes[quote.id] = quote; });
    return json(res, 201, publicQuote(quote));
  }

  if (req.method === 'POST' && path === '/api/checkout') {
    if (!paypalConfigured()) fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.');
    const body = await jsonBody(req);
    const quoteId = textField(body.quoteId, 'Quote ID', 3, 80);
    const prepared = await store.update(state => {
      const quote = state.quotes[quoteId];
      if (!quote || quote.sessionId !== sid) fail(404, 'NOT_FOUND', 'Quote not found.');
      if (Date.parse(quote.expiresAt) < Date.now()) fail(409, 'QUOTE_EXPIRED', 'This quote has expired. Request a new quote.');
      const previous = Object.values(state.orders).find(order => order.quoteId === quoteId && order.sessionId === sid);
      if (previous) {
        if (previous.status === 'CREATING' && Date.now() - Date.parse(previous.updatedAt) < 30000) fail(409, 'CHECKOUT_IN_PROGRESS', 'Checkout is being created. Try again shortly.');
        if (previous.status === 'CREATING') previous.status = 'RETRYABLE';
        if (previous.status === 'RETRYABLE') { previous.status = 'CREATING'; previous.updatedAt = new Date().toISOString(); }
        return { order: previous, quote, listing: state.listings[quote.listingId], existing: Boolean(previous.paypalOrderId) };
      }
      const now = new Date().toISOString();
      const order = { id: `ord_${randomUUID()}`, quoteId, sessionId: sid, status: 'CREATING', requestId: randomUUID(), captureRequestId: randomUUID(), createdAt: now, updatedAt: now };
      state.orders[order.id] = order;
      return { order, quote, listing: state.listings[quote.listingId], existing: false };
    });
    if (prepared.existing) return json(res, 200, { orderId: prepared.order.id, approvalUrl: prepared.order.approvalUrl, status: prepared.order.status });
    try {
      const payPalOrder = await createOrder({ orderId: prepared.order.id, quote: prepared.quote, listing: prepared.listing, requestId: prepared.order.requestId, baseUrl: localBaseUrl(req) });
      await store.update(state => {
        const order = state.orders[prepared.order.id];
        order.paypalOrderId = payPalOrder.paypalOrderId;
        order.approvalUrl = payPalOrder.approvalUrl;
        order.status = 'READY';
        order.updatedAt = new Date().toISOString();
      });
      return json(res, 201, { orderId: prepared.order.id, approvalUrl: payPalOrder.approvalUrl, status: 'READY' });
    } catch (error) {
      await store.update(state => { state.orders[prepared.order.id].status = 'RETRYABLE'; state.orders[prepared.order.id].updatedAt = new Date().toISOString(); });
      throw error;
    }
  }

  const captureMatch = /^\/api\/checkout\/(ord_[a-f0-9-]+)\/capture$/.exec(path);
  if (req.method === 'POST' && captureMatch) {
    if (!paypalConfigured()) fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured.');
    const prepared = await store.update(state => {
      const order = state.orders[captureMatch[1]];
      if (!order || order.sessionId !== sid || !order.quoteId) fail(404, 'NOT_FOUND', 'Checkout not found.');
      if (order.status === 'COMPLETED') return { completed: true, order };
      if (!order.paypalOrderId) fail(409, 'ORDER_NOT_READY', 'PayPal order has not been created.');
      if (order.status === 'CAPTURING' && Date.now() - Date.parse(order.updatedAt) < 30000) fail(409, 'CAPTURE_IN_PROGRESS', 'Payment capture is in progress. Try again shortly.');
      order.status = 'CAPTURING';
      order.updatedAt = new Date().toISOString();
      return { completed: false, order, quote: state.quotes[order.quoteId] };
    });
    if (prepared.completed) {
      const state = store.snapshot();
      const license = state.licenses[prepared.order.licenseToken];
      return json(res, 200, { status: 'COMPLETED', license: publicLicense(license, state) });
    }
    try {
      const result = await captureOrder(prepared.order.paypalOrderId, prepared.order.captureRequestId);
      const captureId = verifiedCapture(result, {
        paypalOrderId: prepared.order.paypalOrderId,
        quoteId: prepared.quote.id,
        amount: prepared.quote.amount,
      });
      if (!captureId) fail(409, 'PAYMENT_NOT_COMPLETED', 'PayPal has not confirmed a completed capture for this exact license amount.');
      const token = randomBytes(32).toString('base64url');
      const license = await store.update(state => {
        const order = state.orders[prepared.order.id];
        if (order.status === 'COMPLETED') return state.licenses[order.licenseToken];
        const issued = { token, orderId: order.id, quoteId: prepared.quote.id, listingId: prepared.quote.listingId, sessionId: sid, paypalCaptureId: captureId, issuedAt: new Date().toISOString() };
        state.licenses[token] = issued;
        order.status = 'COMPLETED';
        order.captureId = captureId;
        order.licenseToken = token;
        order.updatedAt = issued.issuedAt;
        return issued;
      });
      return json(res, 200, { status: 'COMPLETED', license: publicLicense(license, store.snapshot()) });
    } catch (error) {
      await store.update(state => {
        const order = state.orders[prepared.order.id];
        if (order?.status === 'CAPTURING') { order.status = 'READY'; order.updatedAt = new Date().toISOString(); }
      });
      throw error;
    }
  }

  if (req.method === 'GET' && path === '/api/licenses') {
    const state = store.snapshot();
    const licenses = Object.values(state.licenses).filter(item => item.sessionId === sid).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(item => publicLicense(item, state));
    return json(res, 200, licenses);
  }

  const downloadMatch = /^\/api\/download\/([A-Za-z0-9_-]{43})$/.exec(path);
  if (req.method === 'GET' && downloadMatch) {
    const state = store.snapshot();
    const license = state.licenses[downloadMatch[1]];
    if (!license || license.sessionId !== sid) fail(404, 'NOT_FOUND', 'Licensed download not found.');
    const order = state.orders[license.orderId];
    if (!order || order.status !== 'COMPLETED' || !order.captureId) fail(403, 'PAYMENT_REQUIRED', 'Payment has not been confirmed.');
    const listing = state.listings[license.listingId];
    const source = listing && state.uploads[listing.sourceUploadId];
    if (!source) fail(404, 'NOT_FOUND', 'Licensed source file is unavailable.');
    const safeName = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'photo';
    return streamFile(res, uploadFilePath(source), source.mime, `attachment; filename="rights-desk-${safeName}${source.ext}"`);
  }

  fail(404, 'NOT_FOUND', 'API route not found.');
}

async function handleStatic(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { fail(400, 'BAD_PATH', 'Invalid path.'); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${sep}`) || relative.split('/').some(part => part.startsWith('.'))) fail(404, 'NOT_FOUND', 'Page not found.');
  const mimes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
  const mime = mimes[extname(file).toLowerCase()];
  if (!mime) fail(404, 'NOT_FOUND', 'Page not found.');
  return streamFile(res, file, mime, null, 'no-cache');
}

async function handle(req, res) {
  localBaseUrl(req);
  const url = new URL(req.url || '/', ORIGIN);
  checkOrigin(req);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method === 'GET' || req.method === 'HEAD') return handleStatic(res, url.pathname);
  fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
}

await mkdir(UPLOADS, { recursive: true, mode: 0o700 });
await mkdir(DOCUMENTS, { recursive: true, mode: 0o700 });
await store.init();

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.headersSent) { res.destroy(error); return; }
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = error.code || 'SERVER_ERROR';
    if (status >= 500 && code !== 'PAYPAL_NOT_CONFIGURED') console.error(`[Rights Desk] ${code}: ${error.message}`);
    json(res, status, { error: status >= 500 && code === 'SERVER_ERROR' ? 'Unexpected server error.' : error.message, code });
  });
});

server.listen(PORT, HOST, () => console.log(`Rights Desk: ${ORIGIN}`));
