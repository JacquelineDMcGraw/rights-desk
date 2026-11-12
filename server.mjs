import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, open, writeFile, readFile, stat, lstat, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { makeQuote, ollamaAvailable } from './lib/ai.mjs';
import { createOrder, captureOrder, getOrder, paypalConfigured, verifiedCapture } from './lib/paypal.mjs';
import { inspectEvidence } from './lib/provenance.mjs';
import { searchPublicCollections } from './lib/match.mjs';
import { loadPayPalCredentials } from './lib/credentials.mjs';
import { comparePermissions, isUnresolvedPermissionScope } from './lib/permission-comparison.mjs';
import { extractContractText } from './lib/contract-text.mjs';
import { suggestContractTerms } from './lib/contract-terms.mjs';
import { extractProposedSource, isProposedTextAttachment } from './lib/proposed-source.mjs';
import { suggestProposedUse } from './lib/proposed-use.mjs';
import { nearbyLegalHelp } from './lib/legal-help.mjs';

loadPayPalCredentials();

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const UPLOADS = join(DATA, 'uploads');
const DOCUMENTS = join(DATA, 'documents');
const IP_AUDIO = join(DATA, 'ip-audio');
const PORT = Number(process.env.PORT || 5188);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port');
const LOOPBACK_HOST = '127.0.0.1';
const HOST = process.env.RIGHTS_DESK_HOST ?? LOOPBACK_HOST;
const [firstOctet, secondOctet] = HOST.split('.').map(Number);
const isPrivateHost = isIPv4(HOST) && (firstOctet === 10 ||
  (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
  (firstOctet === 192 && secondOctet === 168));
if (HOST !== LOOPBACK_HOST && !isPrivateHost) {
  throw new Error('RIGHTS_DESK_HOST must be 127.0.0.1 or a private IPv4 address on your network.');
}
const LAN_URL = HOST === LOOPBACK_HOST ? null : new URL(`http://${HOST}:${PORT}`);
const ORIGIN = LAN_URL?.origin ?? `http://localhost:${PORT}`;
const store = new Store(join(DATA, 'store.json'));
const activeCaseSearches = new Set();
const activePermissionComparisons = new Set();
const activeDocumentReads = new Set();
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const IP_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const IP_TRANSCRIPT_MAX_LENGTH = 8_000;
const IP_NOTE_FIELDS = ['title', 'text', 'campaignId', 'audio'];
const CONTRACT_EXTENSIONS = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const PROPOSED_SOURCE_EXTENSIONS = { ...CONTRACT_EXTENSIONS, 'message/rfc822': '.eml', 'text/plain': '.txt' };
const TEXT_DOCUMENT_TYPES = {
  '.eml': { mime: 'message/rfc822', aliases: ['application/eml', 'application/x-eml', 'text/x-eml', 'text/plain'] },
  '.txt': { mime: 'text/plain', aliases: [] },
};
const CONTRACT_ERRORS = {
  CONTRACT_UNREADABLE: [422, 'Couldn’t read text from this contract. Try a clearer copy or paste the relevant wording.'],
  CONTRACT_TOO_LARGE: [413, 'This contract is too long or large to read here. Upload the pages with the relevant terms or paste the wording.'],
  CONTRACT_READER_UNAVAILABLE: [503, 'The local contract reader is unavailable. You can still paste the wording into Existing permission.'],
  CONTRACT_READ_TIMEOUT: [504, 'Reading the contract took too long. Try uploading the relevant pages or paste the wording.'],
  CONTRACT_NO_TERMS: [422, 'No clear usage terms were found. Review the contract and paste the relevant wording into Existing permission.'],
};
const PROPOSED_SOURCE_ERRORS = {
  CONTRACT_UNREADABLE: [422, 'Couldn’t read the studio’s request. Try a clearer copy or paste the relevant wording into Proposed use.'],
  CONTRACT_TOO_LARGE: [413, 'This source is too long or large to read here. Upload the relevant pages or paste the request into Proposed use.'],
  CONTRACT_READER_UNAVAILABLE: [503, 'The local reader is unavailable for this file. You can paste the request into Proposed use.'],
  CONTRACT_READ_TIMEOUT: [504, 'Reading the request took too long. Try a shorter file or paste the relevant wording.'],
  PROPOSED_USE_NO_TERMS: [422, 'No clear request to use the work was found. Review the source and paste the relevant wording into Proposed use.'],
};
const OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFER_TERMS_VERSION = 'rights-desk-license-v1';
const OFFER_TERMS_TEXT = 'After Rights Desk verifies the PayPal Sandbox payment, the creator named in this offer grants the named licensee nonexclusive permission to use the identified work only for the proposed use, use type, term, and territory recorded in this offer. The creator retains copyright; no ownership is transferred. This offer covers the described permission only and does not resolve claims about earlier use. Sandbox payments use test funds.';
const CHANGE_TERMS_VERSION = 'rights-desk-permission-change-v1';
const CHANGE_TERMS_TEXT = 'After Rights Desk verifies the PayPal Sandbox payment, the named creator grants the named licensee the nonexclusive additional permission stated in the approved change for the identified work. The original permission record is identified by its fingerprint; this offer does not publish that private record. Only the purpose, channels, duration, territory, and conditions in this approved change are offered. It does not transfer copyright, determine infringement, release earlier claims, or otherwise rewrite the original agreement. Sandbox payments use test funds.';
const CHANGE_FIELDS = ['purpose', 'channels', 'duration', 'territory'];

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
  if (req.method !== 'POST' && req.method !== 'PATCH') return;
  const origin = req.headers.origin;
  if (!origin) return; // curl and native tools do not send Origin.
  if (LAN_URL) {
    if (origin === ORIGIN) return;
    fail(403, 'ORIGIN_DENIED', 'Cross-origin writes are not allowed.');
  }
  try {
    const parsed = new URL(origin);
    if (parsed.host === req.headers.host && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return;
  } catch { /* invalid origin */ }
  fail(403, 'ORIGIN_DENIED', 'Cross-origin writes are not allowed.');
}

function localBaseUrl(req) {
  if (LAN_URL) {
    if (req.headers.host !== LAN_URL.host) fail(400, 'INVALID_HOST', 'Use the configured Rights Desk address.');
    return ORIGIN;
  }
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
    id: item.id, title: item.title, caseType: item.caseType || 'rights-evidence', practice: Boolean(item.practice), workType: item.workType, useChannel: item.useChannel,
    jurisdiction: item.jurisdiction, creatorLocation: item.creatorLocation || null,
    suspectedUrl: item.suspectedUrl || null, firstPublishedAt: item.firstPublishedAt || null,
    ownershipBasis: item.ownershipBasis || null, registrationNumber: item.registrationNumber || null,
    likenessInvolved: typeof item.likenessInvolved === 'boolean' ? item.likenessInvolved : null, story: item.story || '',
    previewUrl: item.previewUploadId ? `/api/previews/${item.previewUploadId}` : null, previewSha256: item.previewSha256 || null, createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    search: item.search || null, documents: (item.documents || []).map(documentMetadata),
    offers: (item.offers || []).map(ownerOffer),
    comparisonCount: (item.permissionComparisons || []).length,
    latestComparisonId: item.permissionComparisons?.at(-1)?.id || null,
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
    kind: offer.kind || 'license', changeSnapshot: offer.changeSnapshot || null,
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
    kind: offer.kind || 'license', changeSnapshot: offer.changeSnapshot || null,
  };
}

function findOffer(state, token) {
  for (const item of Object.values(state.cases)) {
    const offer = (item.offers || []).find(entry => entry.token === token);
    if (offer) return { item, offer };
  }
  return null;
}

function requireRealReview(item) {
  if (item.practice) fail(409, 'PRACTICE_ONLY', 'This review ends at the preview. Start a permission review with your records to create a buyer link.');
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

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJSON(value)).digest('hex');
}

function clarificationAnswers(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !CHANGE_FIELDS.includes(key))) {
    fail(400, 'INVALID_FIELD', 'Clarifications must use purpose, channels, duration, or territory.');
  }
  return Object.fromEntries(Object.entries(value).map(([key, answer]) => [key, textField(answer, key, 0, 500)]).filter(([, answer]) => answer));
}

function approvedPermissionChange(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![...CHANGE_FIELDS, 'conditions'].includes(key))) {
    fail(400, 'INVALID_FIELD', 'Review the purpose, channels, duration, territory, and optional conditions.');
  }
  const approved = {
    ...Object.fromEntries(CHANGE_FIELDS.map(key => [key, textField(value[key], `Approved ${key}`, 1, 500)])),
    conditions: optionalText(value.conditions, 'Approved conditions', 500) || '',
  };
  if (CHANGE_FIELDS.some(key => isUnresolvedPermissionScope(approved[key]))) fail(400, 'CLARIFICATION_REQUIRED', 'The approved purpose, channels, duration, and territory must be specific. You can leave the draft and return when you know.');
  return approved;
}

function assertChangeSnapshot(offer, order = null) {
  if (offer.kind !== 'permission-change') return;
  const snapshot = offer.changeSnapshot;
  if (!snapshot || typeof snapshot !== 'object') fail(409, 'CHANGE_MISMATCH', 'The approved change record needs review before payment.');
  const { changeHash, ...record } = snapshot;
  if (fingerprint(record) !== changeHash || record.amount !== offer.amount || record.licensorName !== offer.licensorName || record.caseId !== offer.caseId || record.workTitle !== offer.workTitle || record.workType !== offer.workType || record.workSha256 !== offer.workSha256 || record.version !== offer.termsVersion || record.termsText !== offer.termsText || record.approvedChange?.purpose !== offer.request || record.approvedChange?.conditions !== offer.note) {
    fail(409, 'CHANGE_MISMATCH', 'The offer no longer matches its approved change record.');
  }
  if (order && (order.changeSnapshot?.changeHash !== changeHash || canonicalJSON(order.changeSnapshot) !== canonicalJSON(snapshot))) {
    fail(409, 'CHANGE_MISMATCH', 'Payment must refer to the exact change accepted at checkout.');
  }
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

function textDocumentType(bytes, filename, contentType) {
  const ext = extname(String(filename || '')).toLowerCase();
  const type = TEXT_DOCUMENT_TYPES[ext];
  if (!type || !isProposedTextAttachment(bytes, type.mime)) return null;
  if (contentType && !['application/octet-stream', type.mime, ...type.aliases].includes(contentType)) {
    fail(415, 'MIME_MISMATCH', 'Content-Type does not match the document.');
  }
  return { ext, mime: type.mime };
}

function safeDocumentName(raw, ext) {
  const last = String(raw || '').replaceAll('\\', '/').split('/').at(-1) || `document${ext}`;
  const cleaned = last.normalize('NFKC').replace(/[^a-zA-Z0-9 ._()-]/g, '_').replace(/^\.+/, '').slice(0, 90).trim();
  const stem = cleaned.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim() || 'document';
  return `${stem}${ext}`;
}

function* mp4Boxes(bytes, start = 0, end = bytes.length) {
  for (let offset = start; offset + 8 <= end;) {
    let size = bytes.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      const largeSize = bytes.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(end - offset)) return;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || size > end - offset) return;
    const next = offset + size;
    yield { type: bytes.toString('latin1', offset + 4, offset + 8), start: offset + headerSize, end: next };
    offset = next;
  }
}

function isM4aAudio(bytes) {
  const topLevel = mp4Boxes(bytes);
  const first = topLevel.next().value;
  if (first?.type !== 'ftyp' || first.end - first.start < 8) return false;
  let hasMedia = false;
  let hasAudio = false;
  for (const box of topLevel) {
    if (box.type === 'mdat' && box.end > box.start) hasMedia = true;
    if (box.type !== 'moov') continue;
    for (const track of mp4Boxes(bytes, box.start, box.end)) {
      if (track.type !== 'trak') continue;
      const media = Iterator.from(mp4Boxes(bytes, track.start, track.end)).find(child => child.type === 'mdia');
      if (!media) continue;
      const handler = Iterator.from(mp4Boxes(bytes, media.start, media.end)).find(child => child.type === 'hdlr');
      if (!handler || handler.end - handler.start < 12) continue;
      const type = bytes.toString('latin1', handler.start + 8, handler.start + 12);
      if (type === 'vide') return false;
      if (type === 'soun') hasAudio = true;
    }
  }
  return hasMedia && hasAudio;
}

async function ipNoteForm(req) {
  const contentType = req.headers['content-type'] || '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    fail(415, 'MULTIPART_REQUIRED', 'Send the IP note as a form.');
  }
  const bytes = await bodyBytes(req, IP_AUDIO_MAX_BYTES + 64 * 1024);
  let form;
  try {
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    fail(400, 'INVALID_FORM', 'Could not read this IP note form.');
  }
  const names = [...form.keys()];
  if (names.some(name => !IP_NOTE_FIELDS.includes(name)) || names.length !== new Set(names).size) {
    fail(400, 'INVALID_FIELD', 'Submit each IP note field once.');
  }
  const title = textField(form.get('title'), 'Title', 1, 120);
  const text = textField(form.get('text') ?? '', 'Note text', 0, 8000);
  const campaignId = optionalText(form.get('campaignId'), 'Campaign', 80);
  const recording = form.get('audio');
  if (recording === null || (recording instanceof File && !recording.name && !recording.size)) {
    if (!text) fail(400, 'EMPTY_NOTE', 'Add a voice memo or some note text.');
    return { title, text, campaignId, audio: null, audioBytes: null };
  }
  if (!(recording instanceof File) || extname(recording.name).toLowerCase() !== '.m4a') {
    fail(415, 'UNSUPPORTED_AUDIO', 'Choose an .m4a recording from Voice Memos.');
  }
  if (recording.size > IP_AUDIO_MAX_BYTES) fail(413, 'UPLOAD_TOO_LARGE', 'Voice memos must be 20 MiB or smaller.');
  const audioBytes = Buffer.from(await recording.arrayBuffer());
  if (!isM4aAudio(audioBytes)) fail(415, 'UNSUPPORTED_AUDIO', 'Choose a readable .m4a recording from Voice Memos.');
  const audio = { filename: safeDocumentName(recording.name, '.m4a'), contentType: 'audio/mp4', size: audioBytes.length };
  return { title, text, campaignId, audio, audioBytes };
}

function assertIpNoteCampaign(state, campaignId, sid) {
  if (campaignId === null) return;
  const item = Object.hasOwn(state.cases, campaignId) && state.cases[campaignId];
  const listing = Object.hasOwn(state.listings, campaignId) && state.listings[campaignId];
  if ((item?.sessionId === sid && !item.practice) || listing?.sessionId === sid) return;
  fail(404, 'CAMPAIGN_NOT_FOUND', 'Choose a campaign from your desk.');
}

function privateIpNote({ id, title, text, transcript = '', campaignId, createdAt, audio }) {
  return { id, title, text, transcript, campaignId, createdAt, audio };
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

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return null;
  return { start, end };
}

async function streamFile(res, path, mime, disposition = null, cache = 'no-store', mediaRequest = null) {
  let fileStat;
  try { fileStat = await stat(path); }
  catch { fail(404, 'NOT_FOUND', 'File not found.'); }
  if (!fileStat.isFile()) fail(404, 'NOT_FOUND', 'File not found.');
  const range = mediaRequest?.headers.range ? byteRange(mediaRequest.headers.range, fileStat.size) : null;
  const headers = {
    'content-type': mime,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(disposition ? { 'content-disposition': disposition } : {}),
    ...(mediaRequest ? { 'accept-ranges': 'bytes' } : {}),
  };
  if (mediaRequest?.headers.range && !range) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${fileStat.size}`, 'content-length': 0 });
    res.end();
    return;
  }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': range ? range.end - range.start + 1 : fileStat.size,
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${fileStat.size}` } : {}),
  });
  if (mediaRequest?.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise((resolveDone, reject) => {
    const stream = createReadStream(path, range || undefined);
    stream.on('error', reject);
    res.on('close', () => { stream.destroy(); resolveDone(); });
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

  if (req.method === 'GET' && path === '/api/legal-help') {
    return json(res, 200, await nearbyLegalHelp(url.searchParams.get('zip')));
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

  if (req.method === 'GET' && path === '/api/ip-notes') {
    const state = store.snapshot();
    const notes = Object.values(state.ipNotes).filter(note => note.sessionId === sid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(privateIpNote);
    const campaigns = [
      ...Object.values(state.cases).filter(item => item.sessionId === sid && !item.practice)
        .map(({ id, title }) => ({ id, title, kind: 'case' })),
      ...Object.values(state.listings).filter(item => item.sessionId === sid)
        .map(({ id, title }) => ({ id, title, kind: 'listing' })),
    ].sort((a, b) => a.title.localeCompare(b.title));
    return json(res, 200, { notes, campaigns });
  }

  if (req.method === 'POST' && path === '/api/ip-notes') {
    const { audioBytes, ...fields } = await ipNoteForm(req);
    const note = { id: `ipn_${randomUUID()}`, ...fields, sessionId: sid, createdAt: new Date().toISOString() };
    let savedAudioPath;
    try {
      await store.update(async state => {
        assertIpNoteCampaign(state, note.campaignId, sid);
        if (Object.values(state.ipNotes).filter(item => item.sessionId === sid).length >= 100) {
          fail(429, 'NOTE_LIMIT', 'This desk has reached its 100-note limit.');
        }
        state.ipNotes[note.id] = note;
        if (!audioBytes) return;
        const audioPath = join(IP_AUDIO, `${note.id}.m4a`);
        const file = await open(audioPath, 'wx', 0o600);
        savedAudioPath = audioPath;
        try {
          await file.writeFile(audioBytes);
          await file.sync();
        } finally {
          await file.close();
        }
      });
    } catch (error) {
      if (savedAudioPath) await unlink(savedAudioPath).catch(() => {});
      throw error;
    }
    return json(res, 201, { note: privateIpNote(note) });
  }

  const ipNoteMatch = /^\/api\/ip-notes\/(ipn_[a-f0-9-]+)(\/audio)?$/.exec(path);
  if (ipNoteMatch) {
    const [, id, audioPath] = ipNoteMatch;
    const current = store.snapshot().ipNotes[id];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'IP note not found.');
    if (audioPath && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!current.audio) fail(404, 'NOT_FOUND', 'This IP note has no recording.');
      return streamFile(res, join(IP_AUDIO, `${id}.m4a`), current.audio.contentType, null, 'private, no-store', req);
    }
    if (!audioPath && req.method === 'PATCH') {
      const body = await jsonBody(req);
      if (Object.keys(body).length !== 1 || (!Object.hasOwn(body, 'campaignId') && !Object.hasOwn(body, 'transcript'))) {
        fail(400, 'INVALID_FIELD', 'Submit either the campaign or the transcript for this IP note.');
      }
      if (Object.hasOwn(body, 'transcript')) {
        if (!current.audio) fail(404, 'NOT_FOUND', 'This IP note has no recording.');
        const transcript = textField(body.transcript, 'Transcript', 0, IP_TRANSCRIPT_MAX_LENGTH);
        const note = await store.update(state => {
          state.ipNotes[id].transcript = transcript;
          return state.ipNotes[id];
        });
        return json(res, 200, { note: privateIpNote(note) });
      }
      const campaignId = body.campaignId === null ? null : textField(body.campaignId, 'Campaign', 1, 80);
      const note = await store.update(state => {
        assertIpNoteCampaign(state, campaignId, sid);
        state.ipNotes[id].campaignId = campaignId;
        return state.ipNotes[id];
      });
      return json(res, 200, { note: privateIpNote(note) });
    }
  }

  if (req.method === 'GET' && path === '/api/case-receipts') {
    const receipts = Object.values(store.snapshot().cases)
      .filter(item => !item.practice)
      .flatMap(item => (item.offers || [])
        .filter(offer => offer.status === 'PAID' && offer.receipt &&
          (item.sessionId === sid || offer.buyerSessionId === sid))
        .map(offer => offer.receipt))
      .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
    return json(res, 200, receipts);
  }

  if (req.method === 'POST' && path === '/api/permission-cases') {
    const body = await jsonBody(req);
    if (Object.keys(body).some(key => !['title', 'workType', 'practice'].includes(key))) fail(400, 'INVALID_FIELD', 'Start with a work title and work type.');
    if (body.practice !== undefined && typeof body.practice !== 'boolean') fail(400, 'INVALID_FIELD', 'Practice must be true or false.');
    const title = textField(body.title, 'Work title', 3, 120);
    const workType = textField(body.workType, 'Work type', 2, 80);
    const item = await store.update(state => {
      if (Object.values(state.cases).filter(entry => entry.sessionId === sid).length >= 20) fail(429, 'CASE_LIMIT', 'This local session has reached its 20-case limit.');
      const created = {
        id: `case_${randomUUID()}`, caseType: 'permission-review', practice: body.practice === true, title, workType,
        useChannel: 'unknown', jurisdiction: null, previewUploadId: null, previewSha256: null,
        sessionId: sid, createdAt: new Date().toISOString(), story: '', search: null,
        documents: [], permissionComparisons: [], offers: [],
      };
      state.cases[created.id] = created;
      return created;
    });
    return json(res, 201, publicCase(item));
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

  const agreedTermsMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/agreed-terms$/.exec(path);
  if (agreedTermsMatch && ['GET', 'POST'].includes(req.method)) {
    const caseId = agreedTermsMatch[1];
    const current = store.snapshot().cases[caseId];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    if (req.method === 'GET') return json(res, 200, current.agreedTerms || { text: '', savedAt: null });
    if (current.practice) fail(409, 'PRACTICE_ONLY', 'Start a permission review with your records to save agreed terms.');
    const body = await jsonBody(req);
    if (Object.keys(body).some(key => key !== 'text')) fail(400, 'INVALID_FIELD', 'Submit only the agreed terms text.');
    const text = textField(body.text, 'Agreed terms', 12, 8000);
    const agreedTerms = await store.update(state => {
      const item = state.cases[caseId];
      if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
      if (item.agreedTerms?.text !== text) item.agreedTerms = { text, savedAt: new Date().toISOString() };
      return item.agreedTerms;
    });
    return json(res, 200, agreedTerms);
  }

  const comparisonsMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/permission-comparisons$/.exec(path);
  if (req.method === 'GET' && comparisonsMatch) {
    const item = store.snapshot().cases[comparisonsMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    return json(res, 200, item.permissionComparisons || []);
  }
  if (req.method === 'POST' && comparisonsMatch) {
    const current = store.snapshot().cases[comparisonsMatch[1]];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    const body = await jsonBody(req);
    if (Object.keys(body).some(key => !['permissionText', 'requestText', 'answers'].includes(key))) fail(400, 'READ_ONLY_FIELD', 'Submit source text and clarification answers; comparison results are prepared on the server.');
    const permissionText = textField(body.permissionText, 'Existing permission text', 12, 8000);
    const requestText = textField(body.requestText, 'New usage request', 8, 4000);
    const answers = clarificationAnswers(body.answers);
    if ((current.permissionComparisons || []).length >= 30) fail(429, 'COMPARISON_LIMIT', 'This case has reached its thirty-comparison limit.');
    if (activePermissionComparisons.has(current.id)) fail(409, 'COMPARISON_IN_PROGRESS', 'A comparison is already being prepared for this case.');
    if (activePermissionComparisons.size >= 2) fail(429, 'COMPARISON_BUSY', 'Two comparisons are already running. Try again shortly.');
    activePermissionComparisons.add(current.id);
    try {
      const analysis = await comparePermissions({ permissionText, requestText, answers });
      const sourceHash = fingerprint({ permissionText, requestText, answers });
      const comparison = {
        id: `cmp_${randomUUID()}`, createdAt: new Date().toISOString(),
        permissionText, requestText, answers, sourceHash,
        originalPermissionHash: fingerprint(permissionText), requestHash: fingerprint(requestText),
        ...analysis,
        comparisonHash: fingerprint({ sourceHash, analysis }),
        status: analysis.questions.length || CHANGE_FIELDS.some(key => !analysis.proposedChange[key]?.trim()) ? 'needs_clarification' : 'ready_for_review',
      };
      await store.update(state => {
        const item = state.cases[current.id];
        if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
        item.permissionComparisons ||= [];
        if (item.permissionComparisons.length >= 30) fail(429, 'COMPARISON_LIMIT', 'This case has reached its thirty-comparison limit.');
        item.permissionComparisons.push(comparison);
        item.updatedAt = comparison.createdAt;
      });
      return json(res, 201, comparison);
    } finally { activePermissionComparisons.delete(current.id); }
  }

  const changeOfferMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/permission-comparisons\/(cmp_[a-f0-9-]+)\/offer$/.exec(path);
  if (req.method === 'POST' && changeOfferMatch) {
    const current = store.snapshot().cases[changeOfferMatch[1]];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    requireRealReview(current);
    const body = await jsonBody(req);
    if (Object.keys(body).some(key => !['licensorName', 'amount', 'approvedChange', 'baselineConfirmed', 'changesReviewed'].includes(key))) fail(400, 'READ_ONLY_FIELD', 'Approve the change fields and price; source references and fingerprints are prepared on the server.');
    const licensorName = textField(body.licensorName, 'Creator / licensor name', 2, 100);
    const amount = moneyField(body.amount, 'Additional permission fee', 5, 10000);
    const approvedChange = approvedPermissionChange(body.approvedChange);
    if (body.baselineConfirmed !== true || body.changesReviewed !== true) fail(400, 'CHANGE_REVIEW_REQUIRED', 'Confirm the original permission and review the exact additional permission before creating an offer.');
    const offer = await store.update(state => {
      const item = state.cases[changeOfferMatch[1]];
      if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
      requireRealReview(item);
      const comparison = (item.permissionComparisons || []).find(entry => entry.id === changeOfferMatch[2]);
      if (!comparison) fail(404, 'NOT_FOUND', 'Permission comparison not found in this case.');
      if (comparison.status !== 'ready_for_review' || comparison.questions.length || CHANGE_FIELDS.some(key => !comparison.proposedChange[key]?.trim())) fail(409, 'CLARIFICATION_REQUIRED', 'Answer the missing scope questions before approving an additional permission.');
      item.offers ||= [];
      if (item.offers.length >= 10) fail(429, 'OFFER_LIMIT', 'This case has reached its ten-offer limit.');
      if (item.offers.some(entry => ['OPEN', 'CHECKOUT'].includes(offerStatus(entry)) || state.orders[entry.orderId]?.status === 'CAPTURE_UNKNOWN')) fail(409, 'ACTIVE_OFFER', 'Resolve or revoke the current open offer before creating a new one.');
      const snapshot = {
        version: CHANGE_TERMS_VERSION, comparisonId: comparison.id,
        termsText: CHANGE_TERMS_TEXT,
        comparisonHash: comparison.comparisonHash, originalPermissionHash: comparison.originalPermissionHash,
        caseId: item.id, workTitle: item.title, workType: item.workType,
        workSha256: item.previewSha256 || null, licensorName, amount, currency: 'USD', approvedChange,
      };
      const changeSnapshot = { ...snapshot, changeHash: fingerprint(snapshot) };
      const now = new Date();
      const created = {
        id: `offer_${randomUUID()}`, token: randomBytes(32).toString('base64url'), kind: 'permission-change', caseId: item.id,
        workTitle: item.title, workType: item.workType, workSha256: item.previewSha256 || null,
        licensorName, request: approvedChange.purpose, amount, note: approvedChange.conditions,
        changeSnapshot, termsVersion: CHANGE_TERMS_VERSION, termsText: CHANGE_TERMS_TEXT,
        status: 'OPEN', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + OFFER_TTL_MS).toISOString(),
      };
      item.offers.push(created);
      return created;
    });
    return json(res, 201, ownerOffer(offer));
  }

  const caseDraftMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/offer-draft$/.exec(path);
  if (req.method === 'POST' && caseDraftMatch) {
    const item = store.snapshot().cases[caseDraftMatch[1]];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    requireRealReview(item);
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
    const current = store.snapshot().cases[caseOffersMatch[1]];
    if (!current || current.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    requireRealReview(current);
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
      requireRealReview(item);
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
    requireRealReview(found.item);
    return json(res, 200, buyerOffer(found.item, found.offer, sid));
  }

  const offerCheckoutMatch = /^\/api\/offers\/([A-Za-z0-9_-]{43})\/checkout$/.exec(path);
  if (req.method === 'POST' && offerCheckoutMatch) {
    if (!paypalConfigured()) {
      const found = findOffer(store.snapshot(), offerCheckoutMatch[1]);
      if (found) requireRealReview(found.item);
      fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured.');
    }
    const body = await jsonBody(req);
    const licenseeName = textField(body.licenseeName, 'Licensee name', 2, 100);
    if (body.acceptedTerms !== true) fail(400, 'TERMS_REQUIRED', 'Review and accept the exact offer terms before continuing.');
    const prepared = await store.update(state => {
      const found = findOffer(state, offerCheckoutMatch[1]);
      if (!found) fail(404, 'NOT_FOUND', 'Offer not found.');
      const { item, offer } = found;
      requireRealReview(item);
      assertChangeSnapshot(offer);
      if (offer.kind === 'permission-change' && Object.keys(body).some(key => !['licenseeName', 'acceptedTerms', 'termsVersion', 'acceptedChangeHash'].includes(key))) fail(400, 'READ_ONLY_FIELD', 'Checkout accepts the approved change as shown; its scope and fee cannot be changed by the buyer.');
      if (offer.kind === 'permission-change' && body.acceptedChangeHash !== offer.changeSnapshot.changeHash) fail(400, 'CHANGE_ACCEPTANCE_REQUIRED', 'Reload and accept the exact approved change before continuing to PayPal.');
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
        ...(offer.kind === 'permission-change' ? { changeSnapshot: structuredClone(offer.changeSnapshot) } : {}),
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
        description: `Rights Desk ${prepared.offer.kind === 'permission-change' ? 'permission change' : 'creator-approved license'}: ${prepared.offer.workTitle ?? prepared.item.title}`,
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
    requireRealReview(found.item);
    if (found.offer.status === 'PAID' && found.offer.receipt) return json(res, 200, { status: 'COMPLETED', receipt: found.offer.receipt });
    if (!paypalConfigured()) fail(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox checkout is not configured.');
    const prepared = await store.update(state => {
      const result = findOffer(state, offerCaptureMatch[1]);
      const order = state.orders[offerCaptureMatch[2]];
      if (!result || !order || order.offerId !== result.offer.id || order.sessionId !== sid || result.offer.orderId !== order.id) fail(404, 'NOT_FOUND', 'Offer checkout not found.');
      requireRealReview(result.item);
      assertChangeSnapshot(result.offer, order);
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
          kind: found.offer.kind || 'license',
          ...(found.offer.kind === 'permission-change' ? { changeSnapshot: structuredClone(prepared.order.changeSnapshot), changeHash: prepared.order.changeSnapshot.changeHash } : {}),
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
    requireRealReview(found.item);
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
    const bytes = await bodyBytes(req, DOCUMENT_MAX_BYTES);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const isPermissionReview = item.caseType === 'permission-review' && !item.practice;
    const binary = bytes.length >= 32 && documentType(bytes);
    if (binary && mime !== binary.mime) fail(415, 'MIME_MISMATCH', 'Content-Type does not match the document.');
    const file = binary || (isPermissionReview ? textDocumentType(bytes, req.headers['x-file-name'], mime) : null);
    if (!file) {
      const formats = isPermissionReview ? 'PDF, JPEG, PNG, EML, or UTF-8 TXT' : 'PDF, JPEG, or PNG';
      fail(415, 'UNSUPPORTED_DOCUMENT', `Upload a readable ${formats} document.`);
    }
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

  const documentReadMatch = /^\/api\/cases\/(case_[a-f0-9-]+)\/documents\/(doc_[a-f0-9-]+)\/(extract-terms|extract-proposed-use)$/.exec(path);
  if (req.method === 'POST' && documentReadMatch) {
    const [, caseId, documentId, action] = documentReadMatch;
    const isProposal = action === 'extract-proposed-use';
    const source = isProposal ? 'studio request' : 'contract';
    const formats = isProposal ? PROPOSED_SOURCE_EXTENSIONS : CONTRACT_EXTENSIONS;
    const errors = isProposal ? PROPOSED_SOURCE_ERRORS : CONTRACT_ERRORS;
    const item = store.snapshot().cases[caseId];
    if (!item || item.sessionId !== sid) fail(404, 'NOT_FOUND', 'Case not found.');
    const doc = (item.documents || []).find(entry => entry.id === documentId);
    if (!doc) fail(404, 'NOT_FOUND', 'Document not found.');
    if (item.practice) fail(409, 'PRACTICE_ONLY', `Start a permission review with your records to pull wording from a ${source}.`);
    if (Object.keys(await jsonBody(req)).length) fail(400, 'INVALID_FIELD', `Choose a ${source} already attached to this case.`);
    const extension = formats[doc.mime];
    if (!extension || doc.ext !== extension) {
      const supported = isProposal ? 'PDF, JPEG, PNG, EML, or UTF-8 TXT' : 'PDF, JPEG, or PNG';
      fail(415, 'UNSUPPORTED_DOCUMENT', `Use a ${supported} file for the ${source}.`);
    }
    if (activeDocumentReads.has(caseId)) fail(409, 'CONTRACT_READ_IN_PROGRESS', 'A document is already being read for this case.');
    if (activeDocumentReads.size >= 2) fail(429, 'CONTRACT_READER_BUSY', 'The local document reader is busy. Try again shortly.');
    activeDocumentReads.add(caseId);
    try {
      const filePath = join(DOCUMENTS, `${documentId}${extension}`);
      const file = await lstat(filePath).catch(() => null);
      if (!file?.isFile()) fail(404, 'DOCUMENT_MISSING', 'This attachment is unavailable. Upload the file again or paste the wording.');
      if (file.size > DOCUMENT_MAX_BYTES) fail(413, 'CONTRACT_TOO_LARGE', `Use a ${source} up to 10 MB or paste the relevant wording.`);
      if (isProposal) return json(res, 200, suggestProposedUse(await extractProposedSource(filePath, doc.mime)));
      const pages = await extractContractText(filePath, doc.mime);
      return json(res, 200, suggestContractTerms(pages));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (Object.hasOwn(errors, error?.code)) {
        const [status, message] = errors[error.code];
        fail(status, error.code, message);
      }
      fail(500, 'CONTRACT_READ_FAILED', `Couldn’t pull wording from this ${source}. Try again or paste the relevant wording.`);
    } finally { activeDocumentReads.delete(caseId); }
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
await mkdir(IP_AUDIO, { recursive: true, mode: 0o700 });
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
