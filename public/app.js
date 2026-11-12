import { renderProtect, renderCaseDetail, renderCaseEditor } from './protect.js';
import { guideFor } from './rights-guide.js';
import { CaseTour } from './tour.js';
import { renderBuyerOffer, receiptText } from './offers.js';
import { AppearanceSettings } from './preferences.js';
import { CaseIntake } from './case-intake.js';
import { PermissionChanges, permissionChangeTerms } from './permission-changes.js';
import { RightsDeskOnboarding } from './onboarding.js';
import { IpNotes } from './ip-notes.js';
import { installLegalHelpLookup } from './permission-help.js';

const tour = new CaseTour();
const preferences = new AppearanceSettings({ onClose: () => { syncCaseTour(); syncLearningGuide(); } });
const intake = new CaseIntake();
const ipNotes = new IpNotes({ api, announce });
const deskArchiveKey = 'rights-desk-desk-archive-v1';

function readDeskArchive() {
  try {
    const ids = JSON.parse(localStorage.getItem(deskArchiveKey) || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  } catch { return new Set(); }
}

const icons = {
  discover: '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/><path d="M18 6h.01"/></svg>',
  licenses: '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h10l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M17 3v5h4M7 13h10M7 17h7"/></svg>',
  studio: '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 8 4v6c0 5.5-3.4 8.5-8 10-4.6-1.5-8-4.5-8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-5-5L5 21"/></svg>',
  protect: '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 8 4v6c0 5.5-3.4 8.5-8 10-4.6-1.5-8-4.5-8-10V6z"/><path d="M9 12h6M12 9v6"/></svg>',
};

const state = {
  tab: validTab(location.hash.slice(1)),
  listings: [],
  cases: [],
  archivedDeskCases: readDeskArchive(),
  showDeskArchive: false,
  caseDocuments: [],
  licenses: [],
  caseReceipts: [],
  status: { paypalConfigured: false, ollamaAvailable: false },
  loading: true,
  error: '',
  filter: 'all',
  detailId: null,
  activeCaseId: null,
  editingCaseId: null,
  showCaseForm: false,
  creatingCase: false,
  searchingCase: false,
  uploadingDocument: false,
  quote: null,
  creating: false,
  quoting: false,
  checkingOut: false,
  toast: null,
  offerDraft: null,
  savingOffer: false,
  offerError: '',
  buyerToken: new URLSearchParams(location.search).get('offer'),
  buyerOffer: null,
  offerLoading: false,
  offerCheckoutBusy: false,
  confirmingOffer: false,
  offerReceipt: null,
  offerOrderId: new URLSearchParams(location.search).get('orderId'),
  licenseeName: '',
};

const permissionChanges = new PermissionChanges({
  api, jsonPost, render, announce,
  onCase(item) {
    state.cases = [item, ...state.cases.filter(entry => entry.id !== item.id)];
    permissionChanges.setPractice(item.id, Boolean(item.practice));
    state.activeCaseId = item.id;
    state.editingCaseId = null;
    state.tab = 'protect';
    state.caseDocuments = item.documents || [];
    state.offerDraft = null;
    state.offerError = '';
    history.replaceState(null,'','#protect');
    if (guideNextOwnReview && !item.practice) {
      guideNextOwnReview = false;
      onboarding.startGuide(item.id);
    }
  },
  onOffer(caseId,offer) {
    state.cases = state.cases.map(item => item.id === caseId ? { ...item,offers:[...(item.offers || []),offer] } : item);
  },
});
state.permissionChanges = permissionChanges;

let guideNextOwnReview = false;
let startingPractice = false;
const onboarding = new RightsDeskOnboarding({
  onPractice: startPracticeReview,
  onOwn: () => startOwnReview(true),
  onEvidence: startEvidenceTour,
  onNotes: () => {
    if (window.rightsDeskNativeHome === true) {
      window.location.href = 'rightsdesk://ip-notes';
      return;
    }
    navTo('ip-notes');
    requestAnimationFrame(() => { if (state.tab === 'ip-notes') tour.startNotes(); });
  },
  onClose: syncLearningGuide,
});

async function startPracticeReview() {
  if (startingPractice) return;
  startingPractice = true;
  try {
    tour.close();
    navTo('protect');
    const result = await permissionChanges.startPractice();
    const id = typeof result === 'string' ? result : result?.id;
    if (id) onboarding.startGuide(id);
    return result;
  } finally { startingPractice = false; }
}

function startOwnReview(guided = false) {
  guideNextOwnReview = guided;
  onboarding.pauseGuide();
  navTo('protect');
  requestAnimationFrame(() => {
    const field = document.querySelector('#pc-new-title, #pc-new-medium');
    let ancestor = field?.parentElement;
    while (ancestor) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    field?.scrollIntoView({ block:'center', behavior:'instant' });
    field?.focus({ preventScroll:true });
  });
}

function startEvidenceTour() {
  onboarding.pauseGuide();
  navTo('protect');
  requestAnimationFrame(() => { if (state.tab === 'protect' && !state.activeCaseId) tour.startCreate(); });
}

function updateDeskArchive({ restore = false, caseId } = {}) {
  const cases = caseId ? state.cases.filter(item => item.id === caseId) : state.cases;
  const archive = readDeskArchive();
  for (const item of cases) {
    if (restore) archive.delete(item.id);
    else archive.add(item.id);
  }
  try { localStorage.setItem(deskArchiveKey, JSON.stringify([...archive])); }
  catch { announce('Couldn’t save your desk view in this browser.',true); return; }
  state.archivedDeskCases = archive;
  state.showDeskArchive = Boolean(caseId);
  render();
  state.showDeskArchive = false;
  const archiveSummary = caseId && document.querySelector('#private-desk-archive > summary');
  (archiveSummary || document.querySelector('#private-desk-heading'))?.focus();
  announce(restore ? (caseId ? 'Case restored to your desk.' : 'Cases restored to your desk.') : 'Desk cleared. Your cases are in Archived cases.');
}

function learningAudience() {
  return state.buyerToken || (!state.cases.length && (state.caseReceipts.length || state.licenses.length)) ? 'buyer' : 'creator';
}

function offerOnboardingIfNeeded() {
  if (state.loading || state.error || state.tab !== 'protect' || state.activeCaseId || location.search || state.caseReceipts.length || state.licenses.length) return;
  onboarding.maybeOffer({ hasCases:state.cases.length > 0, buyerView:Boolean(state.buyerToken) });
}

function syncLearningGuide() {
  const item = getCase(state.activeCaseId);
  const current = item && !state.buyerToken && state.tab === 'protect' ? permissionChanges.getGuideState(item.id) : null;
  onboarding.syncGuide(current || { caseId:null, stage:null, isPractice:false });
}

function validTab(value) { if (value === 'check') return 'protect'; return ['discover', 'protect', 'licenses', 'studio', 'ip-notes'].includes(value) ? value : 'protect'; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function safeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
  } catch { return ''; }
}
function externalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? escapeHtml(url.href) : ''; }
  catch { return ''; }
}
function dollars(value) { const amount = Number(value); return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(amount) : '$0.00'; }
function plural(value, word) { return `${value} ${word}${value === 1 ? '' : 's'}`; }
function statusLabel(value) { return ({ documented_capture:'Documented capture', ai_disclosed:'AI use disclosed', needs_review:'Needs review', unverified:'Origin unverified' })[value] || 'Origin unverified'; }
function statusClass(value) { return value === 'documented_capture' ? '' : value === 'ai_disclosed' || value === 'needs_review' ? 'warn' : 'neutral'; }
function declarationLabel(value) { return ({ camera:'Camera captured', ai_assisted:'AI assisted', ai_generated:'AI generated', unsure:'Unsure' })[value] || 'Origin unspecified'; }
function getListing(id) { return state.listings.find(item => String(item.id) === String(id)); }
function getCase(id) { return state.cases.find(item => String(item.id) === String(id)); }
function inspectionOf(item) { return item?.inspection || null; }
function statusOf(item) { return inspectionOf(item)?.status || 'unverified'; }

async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', ...options });
  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) data = await response.json();
  else data = {error: await response.text()};
  if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
  return data;
}
function jsonPost(path, body) { return api(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); }
function announce(message, error = false) {
  state.toast = { message, error };
  const app = document.querySelector('#app');
  if (app) {
    app.querySelector('.toast')?.remove();
    const element = document.createElement('div');
    element.className = `toast ${error ? 'error' : ''}`;
    element.setAttribute('role', 'status');
    element.textContent = message;
    app.append(element);
  }
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { state.toast = null; document.querySelector('#app .toast')?.remove(); }, 4900);
}
function navTo(tab, { notesCampaignId } = {}) {
  if (state.buyerToken) {
    state.buyerToken = null;
    state.offerError = '';
    history.replaceState(null, '', `${location.pathname}#${validTab(tab)}`);
    state.loading = true;
    loadData();
  }
  state.tab = validTab(tab);
  if (state.tab === 'ip-notes') ipNotes.enter(notesCampaignId);
  state.detailId = null;
  state.activeCaseId = null;
  state.editingCaseId = null;
  state.quote = null;
  // Internal navigation has already updated state. Avoid a queued hashchange
  // resetting a newly opened practice case after its fast local API response.
  if (location.hash !== `#${state.tab}` || location.search) history.pushState(null, '', `${location.pathname}#${state.tab}`);
  render();
  window.scrollTo({top:0, behavior:'instant'});
  if (state.tab === 'ip-notes') document.querySelector('#ip-notes-heading')?.focus({ preventScroll:true });
  offerOnboardingIfNeeded();
}
function openListing(id) {
  state.detailId = id;
  state.quote = null;
  render();
  window.scrollTo({top:0, behavior:'instant'});
}

async function loadData() {
  try {
    const [listings, status, licenses, cases, caseReceipts] = await Promise.all([
      api('/api/listings'), api('/api/status'), api('/api/licenses'), api('/api/cases'), api('/api/case-receipts')
    ]);
    state.listings = Array.isArray(listings) ? listings : [];
    state.status = status || state.status;
    state.licenses = Array.isArray(licenses) ? licenses : [];
    state.cases = Array.isArray(cases) ? cases : [];
    state.caseReceipts = Array.isArray(caseReceipts) ? caseReceipts : [];
    state.error = '';
  } catch (error) { state.error = error.message; }
  state.loading = false;
  render();
  offerOnboardingIfNeeded();
}

function navMarkup() {
  const tabs = [['protect','My desk'],['discover','Discover'],['licenses','Records'],['studio','Studio']];
  const activeTab = state.tab === 'ip-notes' ? 'protect' : state.tab;
  return `<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([tab,label]) => `<button type="button" class="nav-item ${activeTab === tab ? 'active' : ''}" data-tab="${tab}" aria-label="${label}" ${state.tab === tab ? 'aria-current="page"' : ''}>${icons[tab]}<span>${label}</span></button>`).join('')}</nav>`;
}
function headerMarkup() {
  return `<header class="topbar"><a class="brand" href="/#protect" data-desk-home aria-label="Rights Desk home"><span class="brand-mark" aria-hidden="true">r.</span><span>rights desk</span></a><div class="top-right"><button type="button" class="round-button learn-trigger" data-open-onboarding aria-label="Learn how to use Rights Desk" title="How Rights Desk works"><span aria-hidden="true">?</span></button><button type="button" class="round-button settings-trigger" data-open-settings aria-label="Settings" aria-haspopup="dialog"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.2-2 .9-2.2-.5-2.5 4.3 1.5 1.7v2.3l-1.5 1.7 2.5 4.3 2.2-.5 2 .9.7 2.2h5l.7-2.2 2-.9 2.2.5 2.5-4.3-1.5-1.7v-2.3l1.5-1.7-2.5-4.3-2.2.5-2-.9L14.5 3z"/><circle cx="12" cy="12.7" r="3.2"/></svg></button></div></header>`;
}
function introNote() {
  return `<div class="intro-note">${icons.shield}<span>Evidence makes an image’s creation trail visible. No automated check can prove human authorship on its own.</span></div>`;
}
function listingCard(item) {
  const image = safeUrl(item.previewUrl);
  return `<button type="button" class="listing-card" data-listing="${escapeHtml(item.id)}" aria-label="View ${escapeHtml(item.title)}"><img src="${image}" alt="${escapeHtml(item.title)}" loading="lazy"/><div class="tile-label">${escapeHtml(statusLabel(statusOf(item)))}</div><div class="tile-title">${escapeHtml(item.title)}</div><div class="tile-sub">by ${escapeHtml(item.artist || 'Unknown maker')} · from ${dollars(item.basePrice)}</div></button>`;
}
function discoverPage() {
  const filtered = state.filter === 'all' ? state.listings : state.listings.filter(item => state.filter === 'camera' ? item.declaration === 'camera' : item.declaration === 'ai_assisted' || item.declaration === 'ai_generated');
  return `<section class="hero page-pad"><div class="eyebrow">An image is more than a file</div><h1>See the story<br/>behind the <em>image.</em></h1><p class="lede">Discover photography with a visible creation trail, protect your own work, and license directly from its maker.</p></section>
    <div class="pills" role="group" aria-label="Filter images"><button type="button" class="pill ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All work</button><button type="button" class="pill ${state.filter === 'camera' ? 'active' : ''}" data-filter="camera">Camera declared</button><button type="button" class="pill ${state.filter === 'ai' ? 'active' : ''}" data-filter="ai">AI disclosed</button></div>
    <section class="feature-card"><div class="feature-art" aria-hidden="true"><span class="art-label">Rights Desk / 001</span></div><div class="feature-copy"><div class="eyebrow">For photographers & image makers</div><h2>Every image deserves context.</h2><p>Share the work and the evidence you have. Keep the source file private until a license is paid.</p><button type="button" class="button dark" data-tab="studio">Submit your work ${icons.arrow}</button></div></section>
    <section class="page-pad"><div class="protect-invite"><div class="eyebrow">For creators</div><h2 class="serif">Think your work was used?</h2><p>Keep it private. Search named public collections and build a rights record you can act on.</p><button type="button" class="button outline" data-tab="protect">Start a private case ${icons.arrow}</button></div></section>
    <section class="page-pad"><div class="section-heading"><h2>Browse the collection</h2><small>${plural(filtered.length, 'image')}</small></div>${filtered.length ? `<div class="listing-grid">${filtered.map(listingCard).join('')}</div>` : `<div class="empty-gallery"><div class="preview-tile"><div class="tile-art one"></div><div class="tile-label">Illustrative preview</div><div class="tile-title">The human eye</div><div class="tile-sub">Sample layout · not licensable</div></div><div class="preview-tile"><div class="tile-art two"></div><div class="tile-label">Illustrative preview</div><div class="tile-title">Visible origins</div><div class="tile-sub">Sample layout · not licensable</div></div></div><p class="helper" style="margin-top:13px">The collection is waiting for its first submission. The visuals above are illustrations, not photographs offered for license.</p>`}
      <div class="section-heading"><h2>How it works</h2></div><div class="steps"><div class="step"><span class="step-number">1</span><span>Upload a public preview and a private source file.</span></div><div class="step"><span class="step-number">2</span><span>Review the visible provenance signals and disclosures.</span></div><div class="step"><span class="step-number">3</span><span>Describe a use, receive a quote, and pay in PayPal Sandbox.</span></div></div>${introNote()}<p class="footer-note">Rights Desk · An experiment in transparent image licensing</p></section>`;
}
function studioPage() {
  return `<section class="page-title page-pad"><div class="eyebrow">Your studio</div><h1>Put a story<br/><em>in the frame.</em></h1><p class="lede">Create a listing with an honest origin declaration. The source file stays private until a paid license.</p></section>
    <section class="page-pad form-section"><h2>New image listing</h2><form id="listing-form" class="surface form-stack">
      <div class="field"><label for="preview">Public preview *</label><input id="preview" name="preview" type="file" accept="image/jpeg,image/png,image/webp" required/><small>JPEG, PNG, or WebP. This image appears in the public collection.</small></div>
      <div class="field"><label for="source">Private source image *</label><input id="source" name="source" type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.dng,.tif,.tiff" required/><small>Original or high resolution image, up to 32 MB. Only a paid licensee can download it.</small></div>
      <div class="field"><label for="title">Image title *</label><input id="title" name="title" maxlength="100" placeholder="A quiet morning, Brooklyn" required/></div>
      <div class="field"><label for="artist">Photographer / maker *</label><input id="artist" name="artist" maxlength="80" placeholder="Your name" required/></div>
      <div class="field"><label for="story">The story behind it *</label><textarea id="story" name="story" minlength="10" maxlength="1200" required placeholder="Where it was made, what you noticed, and any meaningful edits..."></textarea></div>
      <div class="field"><label>How was this image made? *</label><div class="radio-list">
        <label class="radio-option"><input type="radio" name="declaration" value="camera" required checked/><span><strong>Camera captured</strong><small>I captured this image with a camera. I’ll disclose meaningful AI edits in the story.</small></span></label>
        <label class="radio-option"><input type="radio" name="declaration" value="ai_assisted"/><span><strong>AI assisted</strong><small>AI meaningfully changed a camera image.</small></span></label>
        <label class="radio-option"><input type="radio" name="declaration" value="ai_generated"/><span><strong>AI generated</strong><small>Generative AI created the primary image.</small></span></label>
        <label class="radio-option"><input type="radio" name="declaration" value="unsure"/><span><strong>Unsure</strong><small>I cannot confidently describe its origin.</small></span></label>
      </div></div>
      <div class="field"><label for="basePrice">Starting license price (USD) *</label><input id="basePrice" name="basePrice" type="number" inputmode="decimal" min="5" max="10000" step="0.01" value="75" required/><small>Rights Desk uses this as the base for a quote based on requested use.</small></div>
      ${state.creating ? '<div class="loading"><span class="spinner"></span>Uploading and checking image evidence…</div>' : ''}
      <button class="button dark full" type="submit" ${state.creating ? 'disabled' : ''}>Publish listing ${icons.arrow}</button>
    </form><div class="note-inline">${icons.info}<span>Origin checks report available signals and uncertainty. They cannot certify that an image was made by a human.</span></div></section>`;
}
function checkPage() {
  return `<section class="page-title page-pad"><div class="eyebrow">Origin evidence</div><h1>Look <em>closer.</em></h1><p class="lede">Inspect disclosures, metadata, and any Content Credentials. A missing signal is a reason to ask more questions, not a verdict.</p></section>
    <section class="page-pad form-section">${introNote()}<div class="section-heading"><h2>Images to inspect</h2><small>${plural(state.listings.length,'listing')}</small></div>${state.listings.length ? `<div class="mini-list">${state.listings.map(item => `<button type="button" class="mini-item" data-listing="${escapeHtml(item.id)}"><img src="${safeUrl(item.previewUrl)}" alt=""/><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(statusLabel(statusOf(item)))} · ${escapeHtml(declarationLabel(item.declaration))}</small></span><span class="arrow">›</span></button>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icons.image}</div><h2>Nothing to inspect yet</h2><p>Publish an image in Studio to see its evidence report here.</p><button type="button" class="button dark" data-tab="studio">Open Studio ${icons.arrow}</button></div>`}
    <div class="section-heading"><h2>What we look for</h2></div><div class="steps"><div class="step"><span class="step-number">1</span><span>Content Credentials that describe the asset’s history.</span></div><div class="step"><span class="step-number">2</span><span>Camera and edit metadata in the original file.</span></div><div class="step"><span class="step-number">3</span><span>Consistency between the files and the maker’s disclosure.</span></div></div></section>`;
}
function evidenceCard(item) {
  const inspection = inspectionOf(item);
  const status = statusOf(item);
  const signals = Array.isArray(inspection?.signals) ? inspection.signals : [];
  const review = inspection?.aiReview;
  const tools = inspection?.tools;
  return `<div class="surface"><div class="evidence-head"><h2>Origin report</h2><span class="tag ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span></div><p class="evidence-summary">${escapeHtml(inspection?.summary || 'No inspection has been completed yet.')}</p><div class="signal-list">${signals.map(signal => `<div class="signal"><span class="signal-dot ${signal.level === 'supporting' ? 'good' : signal.level === 'information' ? 'neutral' : ''}"></span><div><strong>${escapeHtml(signal.label || signal.code || 'Evidence signal')}</strong><p>${escapeHtml(signal.detail || '')}</p></div></div>`).join('')}</div>${review?.state === 'checked' ? `<div class="status-box" style="margin-top:13px"><strong>Local visual review</strong>${escapeHtml(review.note || '')}${review.question ? `<br/>Question to ask: ${escapeHtml(review.question)}` : ''}</div>` : ''}${tools ? `<p class="helper" style="margin-top:13px">Checks: Content Credentials ${escapeHtml(tools.c2pa || 'unavailable')} · metadata ${escapeHtml(tools.exif || 'unavailable')} · visual review ${escapeHtml(tools.vision || 'unavailable')}</p>` : ''}<div class="note-inline">${icons.info}<span>Automated signals can be missing, modified, or misleading. This report does not certify human authorship.</span></div></div>`;
}
function detailPage(item) {
  const quote = state.quote;
  return `<section class="page-pad" style="padding-top:17px"><button type="button" class="back" data-back="true">← Back to collection</button><img class="detail-image" src="${safeUrl(item.previewUrl)}" alt="${escapeHtml(item.title)}"/></section>
    <section class="detail-body"><div class="eyebrow">${escapeHtml(declarationLabel(item.declaration))}</div><h1>${escapeHtml(item.title)}</h1><p class="detail-meta">by ${escapeHtml(item.artist || 'Unknown maker')} · licenses from ${dollars(item.basePrice)}</p><p class="detail-story">${escapeHtml(item.story || 'The maker has not added a story yet.')}</p></section>
    <section class="page-pad form-section"><h2>Origin & context</h2>${evidenceCard(item)}</section>
    <section class="page-pad form-section"><h2>License this image</h2><div class="surface"><form id="quote-form" class="form-stack"><div class="field"><label for="request">Tell us how you will use it</label><textarea name="request" id="request" maxlength="1000" required placeholder="For example: a one year editorial feature in a US magazine, online and print."></textarea><small>Include the type of project, where it will appear, and how long you need the rights.</small></div><button type="submit" class="button dark full" ${state.quoting ? 'disabled' : ''}>${state.quoting ? 'Building quote…' : 'Get a license quote'} ${icons.arrow}</button></form></div>
      ${quote ? `<div class="surface" style="margin-top:12px"><div class="eyebrow">Your proposed license</div><div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:11px"><div class="quote-price">${dollars(quote.amount)}</div><span class="tag neutral">${quote.aiMode === 'ollama' ? 'AI interpreted use' : 'Rules based quote'}</span></div><div class="quote-grid"><div class="quote-cell"><small>Use</small><strong>${escapeHtml(quote.usage)}</strong></div><div class="quote-cell"><small>Term</small><strong>${escapeHtml(quote.term)}</strong></div><div class="quote-cell"><small>Territory</small><strong>${escapeHtml(quote.territory)}</strong></div><div class="quote-cell"><small>Base price</small><strong>${dollars(quote.basePrice)}</strong></div></div><p class="quote-explanation">${escapeHtml(quote.explanation || 'Price calculated from the maker’s base rate and the proposed use.')}</p>${Array.isArray(quote.assumptions) && quote.assumptions.length ? `<p class="quote-explanation" style="margin-top:8px">Assumptions: ${quote.assumptions.map(escapeHtml).join('; ')}</p>` : ''}<div style="margin-top:18px">${state.status.paypalConfigured ? `<button type="button" class="button dark full" data-checkout="true" ${state.checkingOut ? 'disabled' : ''}>${state.checkingOut ? 'Connecting to PayPal…' : 'Continue to PayPal Sandbox'} ${icons.arrow}</button>` : `<div class="status-box warn"><strong>PayPal Sandbox setup needed</strong>Add sandbox credentials to the local environment to enable a real test checkout. Quotes remain available.</div>`}</div></div>` : ''}</section>`;
}
function licensesPage() {
  const receipts = state.caseReceipts;
  const receiptCards = receipts.map(receipt => `<article class="surface"><div class="evidence-head"><div class="quote-price">${dollars(receipt.amount)}</div><span class="tag neutral">Paid · Sandbox</span></div><div class="eyebrow pc-space">${receipt.changeSnapshot ? 'Additional permission' : 'License record'}</div><h2 class="serif pc-space">${escapeHtml(receipt.title || 'Your work')}</h2><p class="helper pc-space">${escapeHtml(receipt.licensorName || 'Creator')} → ${escapeHtml(receipt.licenseeName || 'Buyer')} · ${escapeHtml(new Date(receipt.issuedAt).toLocaleDateString())}</p><details class="pc-history"><summary>View agreed permission</summary>${receipt.changeSnapshot ? permissionChangeTerms(receipt.changeSnapshot.approvedChange) : `<p class="helper pc-space">${escapeHtml(receipt.request || '')}</p>`}${receipt.changeHash ? `<p class="hash-line pc-space"><strong>Approved change fingerprint</strong> ${escapeHtml(receipt.changeHash)}</p>` : ''}</details><button type="button" class="button outline full pc-space" data-download-case-record="${escapeHtml(receipt.id)}">Download permission record ↓</button></article>`).join('');
  const files = state.licenses.map(license => {
    const item = getListing(license.listingId);
    const download = safeUrl(license.downloadUrl || (license.licenseToken ? `/api/download/${encodeURIComponent(license.licenseToken)}` : ''));
    return `<article class="surface"><div class="eyebrow">Licensed file · Sandbox</div><h2 class="serif pc-space">${escapeHtml(item?.title || license.title || 'Licensed image')}</h2><p class="helper pc-space">${escapeHtml(license.usage || 'Licensed use')} · ${escapeHtml(license.term || '')} · ${escapeHtml(license.territory || '')}</p>${download ? `<a class="button dark full pc-space" href="${download}" download>Download licensed file ↓</a>` : ''}</article>`;
  }).join('');
  return `<section class="page-title page-pad"><div class="eyebrow">Your permission records</div><h1>Permission.<br/><em>On record.</em></h1><p class="lede">Find your paid permissions and licensed files here. Keep a downloaded copy; these records are linked to this browser.</p></section><section class="page-pad form-section"><div class="section-heading"><h2>Saved payment records</h2><button type="button" class="tour-replay" data-refresh-records>Refresh</button></div>${receipts.length || state.licenses.length ? `<div class="mini-list">${receiptCards}${files}</div>` : '<div class="empty-state"><h2>Your records will be here.</h2><p>After a buyer pays, the agreed permission and payment confirmation appear here.</p><button type="button" class="button dark pc-space" data-start-own-review>Start my own review →</button><button type="button" class="button outline pc-space" data-open-onboarding>How it works</button></div>'}</section>`;
}

function syncCaseTour() {
  if (preferences.isOpen || onboarding.isOpen) return;
  tour.sync({ tab: state.buyerToken ? 'offer' : state.tab, activeCaseId: getCase(state.activeCaseId)?.id, hasCases: state.cases.length > 0, loading: state.loading || state.offerLoading, error: state.error });
}
function render() {
  const app = document.querySelector('#app');
  if (!app) return;
  if (state.buyerToken) {
    app.innerHTML = `${headerMarkup()}<main id="main">${renderBuyerOffer(state)}</main>`;
    syncCaseTour();
    syncLearningGuide();
    return;
  }
  const detail = getListing(state.detailId);
  const activeCase = getCase(state.activeCaseId);
  const supportingRecords = app.querySelector('#permission-supporting-records');
  const supportingRecordsOpen = supportingRecords?.open && supportingRecords.dataset.caseId === activeCase?.id;
  const contractFieldFocused = supportingRecordsOpen && document.activeElement?.id === 'case-document';
  if (activeCase) permissionChanges.setPractice(activeCase.id, Boolean(activeCase.practice));
  const content = state.loading ? '<div class="page-pad loading" style="padding-top:40px"><span class="spinner"></span>Opening Rights Desk…</div>' : state.error ? `<section class="page-pad" style="padding-top:40px"><div class="status-box error"><strong>Could not reach Rights Desk</strong>${escapeHtml(state.error)}</div><button type="button" class="button dark" data-retry="true" style="margin-top:16px">Try again</button></section>` : activeCase && state.tab === 'protect' ? (state.editingCaseId === activeCase.id ? renderCaseEditor(state, activeCase) : renderCaseDetail(state, activeCase, { supportingRecordsOpen })) : detail ? detailPage(detail) : ({discover:discoverPage, protect:() => renderProtect(state), licenses:licensesPage, studio:studioPage, 'ip-notes':() => ipNotes.render()})[state.tab]();
  app.innerHTML = `${headerMarkup()}<main id="main">${content}</main>${navMarkup()}${state.toast ? `<div class="toast ${state.toast.error ? 'error' : ''}" role="status">${escapeHtml(state.toast.message)}</div>` : ''}`;
  if (contractFieldFocused) app.querySelector('#case-document')?.focus({ preventScroll:true });
  intake.mount(activeCase && state.editingCaseId === activeCase.id ? activeCase : null);
  if (state.tab === 'ip-notes' && !state.loading && !state.error) ipNotes.mount();
  syncCaseTour();
  syncLearningGuide();
}

async function createListing(form) {
  if (state.creating) return;
  const data = new FormData(form);
  const preview = data.get('preview');
  const source = data.get('source');
  if (!(preview instanceof File) || !preview.size) { announce('Choose a public preview image.', true); return; }
  const basePrice = Number(data.get('basePrice'));
  if (!Number.isFinite(basePrice) || basePrice < 5 || basePrice > 10000) { announce('Enter a starting price between $5 and $10,000.', true); return; }
  if (!(source instanceof File) || !source.size) { announce('Choose a private source image.', true); return; }
  state.creating = true;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Uploading and checking image evidence…';
  try {
    const upload = async (file, kind) => api(`/api/uploads?kind=${kind}`, { method:'POST', headers:{'Content-Type':file.type || 'application/octet-stream', ...(kind === 'source' ? {'X-File-Name':file.name} : {})}, body:file });
    const previewResult = await upload(preview, 'preview');
    const sourceResult = await upload(source, 'source');
    const item = await jsonPost('/api/listings', {
      title:String(data.get('title')).trim(), artist:String(data.get('artist')).trim(), story:String(data.get('story')).trim(),
      declaration:data.get('declaration'), previewUploadId:previewResult.uploadId, sourceUploadId:sourceResult.uploadId,
      basePrice
    });
    let inspected = item;
    try { const result = await jsonPost(`/api/listings/${encodeURIComponent(item.id)}/inspect`, {}); inspected = result.listing || item; }
    catch (error) { announce(`Listing published. Inspection is pending: ${error.message}`, true); }
    state.listings.unshift(inspected);
    state.creating = false;
    state.tab = 'discover';
    history.replaceState(null, '', '#discover');
    state.detailId = item.id;
    render();
    window.scrollTo({top:0, behavior:'instant'});
    announce('Your listing is live. Review its origin report.');
  } catch (error) { state.creating = false; announce(error.message, true); render(); }
}

async function createQuote(form) {
  if (state.quoting || !state.detailId) return;
  const request = String(new FormData(form).get('request') || '').trim();
  if (request.length < 12) { announce('Add a little more detail about the intended use.', true); return; }
  state.quoting = true;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Building quote…';
  try { state.quote = await jsonPost(`/api/listings/${encodeURIComponent(state.detailId)}/quote`, {request}); announce('Quote ready. Review the terms below.'); }
  catch (error) { announce(error.message, true); }
  state.quoting = false;
  render();
}

async function createCase(form) {
  if (state.creatingCase) return;
  const data = new FormData(form);
  const draftKey = intake.key;
  const image = data.get('preview');
  if (!(image instanceof File) || !image.size) { announce('Choose a reference image or screenshot.', true); return; }
  if (image.size > 12 * 1024 * 1024) { announce('Choose an image smaller than 12 MB.', true); return; }
  state.creatingCase = true;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Creating private case…';
  try {
    const upload = await api('/api/uploads?kind=preview', {method:'POST', headers:{'Content-Type':image.type || 'application/octet-stream'}, body:image});
    const payload = {
      title:String(data.get('title') || '').trim(), workType:data.get('workType'), useChannel:data.get('useChannel'),
      jurisdiction:data.get('jurisdiction'), previewUploadId:upload.uploadId,
      likenessInvolved:data.get('likenessInvolved') === 'yes' ? true : data.get('likenessInvolved') === 'no' ? false : null,
    };
    for (const field of ['story','creatorLocation','suspectedUrl','firstPublishedAt','ownershipBasis','registrationNumber']) {
      const value = String(data.get(field) || '').trim();
      if (value) payload[field] = value;
    }
    const item = await jsonPost('/api/cases', payload);
    await intake.clear(draftKey);
    state.cases.unshift(item);
    state.activeCaseId = item.id;
    state.caseDocuments = item.documents || [];
    state.showCaseForm = false;
    state.creatingCase = false;
    history.replaceState(null, '', '#protect');
    render();
    window.scrollTo({top:0, behavior:'instant'});
    announce('Private case created. Compare what was allowed with the proposed use when you are ready.');
  } catch (error) { state.creatingCase = false; button.disabled = false; button.textContent = 'Create private case →'; announce(error.message, true); }
}

async function saveCaseDetails(form) {
  const id = state.editingCaseId;
  if (!id || state.creatingCase) return;
  const data = new FormData(form);
  const payload = {
    title:String(data.get('title') || '').trim(), workType:data.get('workType'), useChannel:data.get('useChannel'), jurisdiction:data.get('jurisdiction'),
    likenessInvolved:data.get('likenessInvolved') === 'yes' ? true : data.get('likenessInvolved') === 'no' ? false : null,
  };
  for (const field of ['story','creatorLocation','suspectedUrl','firstPublishedAt','ownershipBasis','registrationNumber']) payload[field] = String(data.get(field) || '').trim();
  state.creatingCase = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving case details…';
  try {
    const updated = await jsonPost(`/api/cases/${encodeURIComponent(id)}/details`, payload);
    state.cases = state.cases.map(item => item.id === id ? updated : item);
    await intake.clear(`rights-desk-case-edit-v1:${id}`);
    state.editingCaseId = null;
    state.creatingCase = false;
    render();
    window.scrollTo({top:0,behavior:'instant'});
    announce('Your case details are saved.');
  } catch (error) {
    state.creatingCase = false;
    button.disabled = false;
    button.textContent = 'Save case details';
    announce(error.message, true);
  }
}

async function openCase(id) {
  state.activeCaseId = id;
  state.editingCaseId = null;
  state.offerDraft = null;
  state.offerError = '';
  state.detailId = null;
  state.caseDocuments = getCase(id)?.documents || [];
  render();
  window.scrollTo({top:0, behavior:'instant'});
  permissionChanges.load(id, { practice:Boolean(getCase(id)?.practice) });
  try {
    const docs = await api(`/api/cases/${encodeURIComponent(id)}/documents`);
    if (state.activeCaseId === id) { state.caseDocuments = Array.isArray(docs) ? docs : []; render(); }
  } catch { /* Existing case still displays; document list can be retried on upload. */ }
}

async function searchCase() {
  const id = state.activeCaseId;
  if (!id || state.searchingCase) return;
  state.searchingCase = true;
  render();
  try {
    const result = await jsonPost(`/api/cases/${encodeURIComponent(id)}/search`, {});
    const item = result.case || {...getCase(id), search:result.search};
    state.cases = state.cases.map(existing => existing.id === id ? item : existing);
    announce(`${result.search?.matches?.length || 0} candidate matches found in the sources checked.`);
  } catch (error) { announce(`Search could not finish: ${error.message}`, true); }
  state.searchingCase = false;
  render();
}

async function uploadCaseDocument(form) {
  const id = state.activeCaseId;
  if (!id || state.uploadingDocument) return;
  const sourceStage = getCase(id)?.caseType === 'permission-review' ? permissionChanges.getGuideState(id).stage : '';
  const file = new FormData(form).get('document');
  if (!(file instanceof File) || !file.size) { announce('Choose a supporting file.', true); return; }
  if (file.size > 10 * 1024 * 1024) { announce('Choose a file smaller than 10 MB.', true); return; }
  state.uploadingDocument = true;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  button.textContent = 'Saving document…';
  try {
    const name = file.name.replace(/[^\x20-\x7e]/g,'_');
    const uploaded = await api(`/api/cases/${encodeURIComponent(id)}/documents`, {method:'POST', headers:{'Content-Type':file.type || 'application/octet-stream','X-File-Name':name}, body:file});
    permissionChanges.selectSourceDocument(id,sourceStage,uploaded);
    const docs = await api(`/api/cases/${encodeURIComponent(id)}/documents`);
    if (Array.isArray(docs)) {
      state.cases = state.cases.map(item => item.id === id ? { ...item, documents:docs } : item);
      if (state.activeCaseId === id) state.caseDocuments = docs;
    }
    announce('Supporting file saved privately.');
  } catch (error) { announce(error.message, true); }
  state.uploadingDocument = false;
  render();
}

function exportCaseSummary() {
  const item = getCase(state.activeCaseId);
  if (!item) return;
  const search = item.search;
  const guide = guideFor(item);
  const local = guide.localLaw;
  const textContent = [
    'RIGHTS DESK — PRIVATE CASE SUMMARY',
    `Generated: ${new Date().toISOString()}`,
    `Title: ${item.title}`,
    `Work type: ${item.workType}`,
    `Possible use: ${item.useChannel}`,
    `Location of possible use: ${item.jurisdiction}`,
    `Creator location: ${item.creatorLocation || 'Not provided'}`,
    `First published: ${item.firstPublishedAt || 'Not provided'}`,
    `Relationship to work: ${item.ownershipBasis || 'Not provided'}`,
    `Registration/application: ${item.registrationNumber || 'Not provided'}`,
    `Reference image SHA-256: ${item.previewSha256 || 'Not recorded'}`,
    `Reported URL: ${item.suspectedUrl || 'Not provided'}`,
    `Notes: ${item.story || 'Not provided'}`,
    '',
    `Public search: ${search?.status || 'Not run'}`,
    `Searched at: ${search?.searchedAt || 'Not run'}`,
    `Terms sent to public catalogs: ${(search?.queries || []).join(' | ') || 'None yet'}`,
    ...((search?.coverage || []).map(source => `Source: ${source.source} — ${source.status}; ${source.detail || ''}`)),
    ...((search?.matches || []).map(match => `Candidate: ${match.title || 'Untitled'} — ${match.source}; ${match.pageUrl || ''}; ${match.similarity?.method || ''} ${match.similarity?.score ?? ''}`)),
    '',
    'Supporting files:',
    ...(state.caseDocuments.length ? state.caseDocuments.map(doc => `- ${doc.name} (${doc.uploadedAt || 'date unknown'})`) : ['- None added']),
    '',
    'VOLUNTARY LICENSE OFFERS',
    ...((item.offers || []).length ? item.offers.flatMap(offer => [`Offer: ${offer.id} — ${offer.status}`,`Scope: ${offer.request}; ${offer.usage}; ${offer.term}; ${offer.territory}`,`Price: ${offer.amount} USD`,...(offer.receipt ? [receiptText(offer.receipt)] : [])]) : ['No offer created.']),
    '',
    'EVIDENCE CHECKLIST',
    `For this work: ${guide.workEvidence}`,
    `For this use: ${guide.useEvidence}`,
    '',
    'RIGHTS ROUTE',
    guide.jurisdictionNote,
    ...guide.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.text}`),
    ...(guide.aiNote ? [guide.aiNote] : []),
    ...(local ? [
      '', `${local.name} local issue prompts (checked ${local.asOf}):`,
      ...[['Publicity / likeness',local.publicity],['Privacy',local.privacy],['Contracts / permissions',local.contract]].map(([topic,entry]) => `${topic}: ${entry.summary} Source: ${entry.sourceUrl}`),
      `Legal-help starting point: ${local.helpUrl}`,
    ] : []),
    '',
    'A match is a lead for review, not an ownership or infringement conclusion. A missing result covers only the sources checked.',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([textContent], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rights-desk-case-${String(item.id).replace(/[^a-z0-9_-]/gi, '')}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function focusOffer(selector) {
  requestAnimationFrame(() => {
    const element = document.querySelector(selector);
    element?.scrollIntoView({block:'center', behavior:'instant'});
    element?.focus({preventScroll:true});
  });
}

function readOfferForm() {
  const form = document.querySelector('#offer-draft-form');
  if (!form) return state.offerDraft;
  const data = new FormData(form);
  const draft = {...state.offerDraft};
  for (const field of ['licensorName','request','basePrice','usage','term','territory','amount','note']) draft[field] = String(data.get(field) || '').trim();
  draft.authorized = data.get('authorized') === 'on';
  state.offerDraft = draft;
  return draft;
}

async function refreshOffers() {
  readOfferForm();
  const id = state.activeCaseId;
  if (!id) return;
  try {
    const item = await api(`/api/cases/${encodeURIComponent(id)}`);
    state.cases = state.cases.map(entry => entry.id === id ? item : entry);
    render();
  } catch (error) { announce(error.message, true); }
}

async function suggestOffer() {
  const form = document.querySelector('#offer-draft-form');
  const draft = readOfferForm();
  if (!draft || state.savingOffer) return;
  for (const id of ['offer-request','offer-base']) {
    const input = form.querySelector(`#${id}`);
    if (!input.reportValidity()) return;
  }
  state.savingOffer = true;
  state.offerError = '';
  render();
  try {
    const quote = await jsonPost(`/api/cases/${encodeURIComponent(draft.caseId)}/offer-draft`, {request:draft.request,basePrice:Number(draft.basePrice)});
    if (state.offerDraft?.caseId === draft.caseId) state.offerDraft = {...draft,quote,usage:quote.usage,term:quote.term,territory:quote.territory,amount:quote.amount};
  } catch (error) { state.offerError = error.message; }
  state.savingOffer = false;
  render();
  focusOffer('#offer-usage');
}

function reviewOffer(form) {
  if (state.savingOffer || !form.reportValidity()) return;
  const draft = readOfferForm();
  if (!draft.authorized) return;
  state.offerDraft = {...draft,stage:'review'};
  state.offerError = '';
  render();
  focusOffer('#offer-review');
}

async function approveOffer() {
  const draft = state.offerDraft;
  if (!draft || draft.stage !== 'review' || state.savingOffer) return;
  state.savingOffer = true;
  state.offerError = '';
  render();
  try {
    const payload = {};
    for (const field of ['licensorName','request','usage','term','territory','amount','note']) payload[field] = draft[field];
    const offer = await jsonPost(`/api/cases/${encodeURIComponent(draft.caseId)}/offers`, payload);
    state.cases = state.cases.map(item => item.id === draft.caseId ? {...item,offers:[...(item.offers || []),offer]} : item);
    state.offerDraft = null;
    announce('Offer approved. Copy the buyer link when you are ready.');
  } catch (error) { state.offerError = error.message; }
  state.savingOffer = false;
  render();
  focusOffer(state.offerDraft ? '#offer-review' : '.offer-link input');
}

async function revokeOffer(id) {
  if (state.savingOffer) return;
  state.savingOffer = true;
  try {
    await jsonPost(`/api/cases/${encodeURIComponent(state.activeCaseId)}/offers/${encodeURIComponent(id)}/revoke`, {});
    await refreshOffers();
    announce('The unpaid offer is revoked. Its buyer link is closed.');
  } catch (error) { announce(error.message, true); }
  state.savingOffer = false;
  render();
}

async function copyOffer(id) {
  const offer = getCase(state.activeCaseId)?.offers?.find(item => item.id === id);
  if (!offer) return;
  const url = new URL(offer.sharePath, location.origin).href;
  try { await navigator.clipboard.writeText(url); announce('Buyer link copied. Share it yourself when ready.'); }
  catch { const input = document.getElementById(`offer-link-${id}`); input?.focus(); input?.select(); announce('Select and copy the buyer link above.'); }
}

function downloadOfferReceipt(id) {
  const receipt = state.buyerToken ? state.offerReceipt : getCase(state.activeCaseId)?.offers?.find(offer => offer.id === id)?.receipt;
  saveReceipt(receipt);
}

function saveReceipt(receipt) {
  if (!receipt) return;
  const url = URL.createObjectURL(new Blob([receiptText(receipt)], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rights-desk-${String(receipt.id).replace(/[^a-z0-9_-]/gi,'')}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),5000);
}

async function loadBuyerOffer() {
  if (!state.buyerToken) return;
  state.offerLoading = true;
  render();
  try {
    const [offer,status] = await Promise.all([api(`/api/offers/${encodeURIComponent(state.buyerToken)}`),api('/api/status')]);
    state.buyerOffer = offer;
    state.licenseeName ||= offer.checkout?.licenseeName || '';
    state.status = status;
    state.offerOrderId ||= offer.checkout?.orderId;
    if (offer.status === 'PAID' && state.offerOrderId) {
      try { state.offerReceipt = await api(`/api/offers/${encodeURIComponent(state.buyerToken)}/receipt?orderId=${encodeURIComponent(state.offerOrderId)}`); }
      catch { /* Another session cannot retrieve the buyer's record. */ }
    }
  } catch (error) { state.offerError = error.message; }
  state.offerLoading = false;
  render();
}

async function checkoutOffer(form) {
  if (state.offerCheckoutBusy || !form.reportValidity()) return;
  const data = new FormData(form);
  state.licenseeName = String(data.get('licenseeName') || '').trim();
  state.offerCheckoutBusy = true;
  state.offerError = '';
  render();
  try {
    const result = await jsonPost(`/api/offers/${encodeURIComponent(state.buyerToken)}/checkout`, {licenseeName:state.licenseeName,acceptedTerms:data.get('acceptedTerms') === 'on',termsVersion:state.buyerOffer.termsVersion,...(state.buyerOffer.changeSnapshot ? {acceptedChangeHash:state.buyerOffer.changeSnapshot.changeHash} : {})});
    const url = new URL(result.approvalUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com'))) throw new Error('PayPal returned an unexpected approval destination.');
    location.assign(url.href);
  } catch (error) { state.offerError = error.message; state.offerCheckoutBusy = false; render(); }
}

async function captureOffer() {
  if (!state.buyerToken || !state.offerOrderId || state.confirmingOffer) return;
  state.confirmingOffer = true;
  state.offerError = '';
  render();
  try {
    const result = await jsonPost(`/api/offers/${encodeURIComponent(state.buyerToken)}/orders/${encodeURIComponent(state.offerOrderId)}/capture`, {});
    if (result.status !== 'COMPLETED' || !result.receipt) throw new Error('Payment has not completed.');
    state.offerReceipt = result.receipt;
    state.buyerOffer = {...state.buyerOffer,status:'PAID'};
  } catch (error) { state.offerError = error.message; }
  state.confirmingOffer = false;
  render();
}

async function handleOfferReturn() {
  const params = new URLSearchParams(location.search);
  const checkout = params.get('offerCheckout');
  if (!checkout) return;
  params.delete('offerCheckout');
  history.replaceState(null,'',`${location.pathname}?${params.toString()}`);
  if (checkout === 'return' && state.offerOrderId && state.buyerOffer) await captureOffer();
  else if (checkout === 'cancel') { state.offerError = 'Checkout was cancelled. No license record has been issued. You can resume when ready.'; render(); }
}

async function beginCheckout() {
  if (state.checkingOut || !state.quote) return;
  state.checkingOut = true;
  render();
  try {
    const result = await jsonPost('/api/checkout', {quoteId:state.quote.id});
    if (!result.approvalUrl || !/^https:\/\//.test(result.approvalUrl)) throw new Error('PayPal did not return a secure approval link.');
    location.assign(result.approvalUrl);
  } catch (error) { state.checkingOut = false; announce(error.message, true); }
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const checkout = params.get('checkout');
  const orderId = params.get('orderId');
  if (!checkout) return;
  history.replaceState(null, '', `${location.pathname}#licenses`);
  state.tab = 'licenses';
  render();
  if (checkout === 'cancel') { announce('Checkout cancelled. No license was issued.'); return; }
  if (checkout !== 'return' || !orderId) { announce('PayPal returned without an order reference.', true); return; }
  announce('Confirming your PayPal Sandbox payment…');
  try {
    const result = await jsonPost(`/api/checkout/${encodeURIComponent(orderId)}/capture`, {});
    if (result.status !== 'COMPLETED' && !result.license) throw new Error('Payment has not completed yet.');
    state.licenses = await api('/api/licenses');
    render();
    announce('Payment complete. Your license is ready.');
  } catch (error) { announce(`Payment confirmation needs attention: ${error.message}`, true); }
}

document.addEventListener('click', event => {
  const deskHome = event.target.closest('[data-desk-home]');
  if (deskHome) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    tour.close({ restoreFocus:false });
    navTo('protect');
    if (!onboarding.isOpen) document.getElementById('desk-home-heading')?.focus({ preventScroll:true });
    return;
  }
  const learnTrigger = event.target.closest('[data-open-onboarding]');
  if (learnTrigger) { tour.close(); onboarding.open({ audience:learningAudience(), trigger:learnTrigger }); return; }
  if (event.target.closest('[data-start-own-review]')) { startOwnReview(); return; }
  if (event.target.closest('[data-start-ip-notes-tour]')) { tour.startNotes(); return; }
  if (event.target.closest('[data-ip-notes-retry]')) { ipNotes.load(); return; }
  const caseNotes = event.target.closest('[data-case-ip-notes]');
  if (caseNotes) { navTo('ip-notes', { notesCampaignId:caseNotes.dataset.caseIpNotes }); return; }
  const notesBack = event.target.closest('[data-ip-notes-back]');
  if (notesBack) {
    navTo('protect');
    if (getCase(notesBack.dataset.ipNotesBack)) openCase(notesBack.dataset.ipNotesBack);
    return;
  }
  const guideTrigger = event.target.closest('[data-resume-permission-guide]');
  if (guideTrigger) { onboarding.startGuide(guideTrigger.dataset.resumePermissionGuide); syncLearningGuide(); return; }
  if (event.target.closest('[data-attach-original-contract], [data-attach-source]')) {
    const records = document.querySelector('#permission-supporting-records');
    if (records) {
      onboarding.pauseGuide();
      records.open = true;
      records.querySelector('#case-document')?.focus();
    }
    return;
  }
  if (event.target.closest('[data-return-to-source]')) {
    document.querySelector('#pc-source-document, #permission-source-form [data-attach-source]')?.focus();
    return;
  }
  if (event.target.closest('[data-refresh-records]')) { state.loading = true; render(); loadData(); return; }
  const savedRecord = event.target.closest('[data-download-case-record]');
  if (savedRecord) { saveReceipt(state.caseReceipts.find(receipt => receipt.id === savedRecord.dataset.downloadCaseRecord)); return; }
  const settingsTrigger = event.target.closest('[data-open-settings]');
  if (settingsTrigger) { preferences.open(settingsTrigger); return; }
  if (event.target.closest('[data-edit-case]')) {
    state.editingCaseId = state.activeCaseId;
    render();
    requestAnimationFrame(() => document.querySelector('#intake-question')?.focus());
    return;
  }
  if (event.target.closest('[data-cancel-case-edit]')) {
    state.editingCaseId = null;
    render();
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  if (event.target.closest('[data-start-offer]')) {
    state.offerDraft = {caseId:state.activeCaseId,stage:'edit',licensorName:'',request:'',basePrice:'75',amount:'75.00',note:''};
    state.offerError = '';
    render(); focusOffer('#offer-licensor'); return;
  }
  if (event.target.closest('[data-suggest-offer]')) { suggestOffer(); return; }
  if (event.target.closest('[data-edit-offer]')) { state.offerDraft.stage = 'edit'; render(); focusOffer('#offer-licensor'); return; }
  if (event.target.closest('[data-cancel-offer]')) { state.offerDraft = null; state.offerError = ''; render(); return; }
  if (event.target.closest('[data-approve-offer]')) { approveOffer(); return; }
  const copy = event.target.closest('[data-copy-offer]');
  if (copy) { copyOffer(copy.dataset.copyOffer); return; }
  const revoke = event.target.closest('[data-revoke-offer]');
  if (revoke) { revokeOffer(revoke.dataset.revokeOffer); return; }
  const receipt = event.target.closest('[data-download-offer-receipt]');
  if (receipt) { downloadOfferReceipt(receipt.dataset.downloadOfferReceipt); return; }
  if (event.target.closest('[data-refresh-offers]')) { refreshOffers(); return; }
  if (event.target.closest('[data-reload-offer]')) { state.offerError = ''; loadBuyerOffer(); return; }
  if (event.target.closest('[data-retry-offer-capture]')) { captureOffer(); return; }
  const tourTrigger = event.target.closest('[data-start-case-tour]');
  if (tourTrigger) {
    if (tourTrigger.dataset.startCaseTour === 'collect') tour.startCollect();
    else {
      if (!document.querySelector('#case-form')) {
        state.showCaseForm = true;
        render();
      }
      tour.startCreate();
    }
    return;
  }
  const tab = event.target.closest('[data-tab]');
  if (tab) { navTo(tab.dataset.tab); return; }
  const filter = event.target.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; render(); return; }
  const listing = event.target.closest('[data-listing]');
  if (listing) { openListing(listing.dataset.listing); return; }
  if (event.target.closest('[data-clear-private-desk]')) { updateDeskArchive(); return; }
  if (event.target.closest('[data-restore-private-desk]')) { updateDeskArchive({ restore:true }); return; }
  const restoreCase = event.target.closest('[data-restore-desk-case]');
  if (restoreCase) { updateDeskArchive({ restore:true, caseId:restoreCase.dataset.restoreDeskCase }); return; }
  const caseButton = event.target.closest('[data-case]');
  if (caseButton) { openCase(caseButton.dataset.case); return; }
  if (event.target.closest('[data-back]')) { state.detailId = null; state.quote = null; render(); return; }
  if (event.target.closest('[data-back-case]')) { state.activeCaseId = null; state.editingCaseId = null; state.caseDocuments = []; render(); return; }
  if (event.target.closest('[data-new-case]')) { state.showCaseForm = true; render(); return; }
  if (event.target.closest('[data-run-case-search]')) { searchCase(); return; }
  if (event.target.closest('[data-export-case]')) { exportCaseSummary(); return; }
  if (event.target.closest('[data-checkout]')) { beginCheckout(); return; }
  if (event.target.closest('[data-retry]')) { state.loading = true; state.error = ''; render(); loadData(); }
});

window.addEventListener('storage', event => {
  if (event.key !== deskArchiveKey) return;
  state.archivedDeskCases = readDeskArchive();
  if (state.tab === 'protect' && !state.activeCaseId && !state.buyerToken) render();
});
document.addEventListener('rights-desk-start-own-review', () => startOwnReview(true));
document.addEventListener('rights-desk-pause-permission-guide', () => onboarding.pauseGuide());
document.addEventListener('rights-desk-practice-replay', () => startPracticeReview().catch(error => announce(error.message,true)));
document.addEventListener('submit', event => {
  if (event.target.id === 'ip-note-form') { event.preventDefault(); ipNotes.save(event.target); }
  if (event.target.matches('[data-ip-note-assignment]')) { event.preventDefault(); ipNotes.assign(event.target); }
  if (event.target.id === 'offer-draft-form') { event.preventDefault(); reviewOffer(event.target); }
  if (event.target.id === 'buyer-offer-form') { event.preventDefault(); checkoutOffer(event.target); }
  if (event.target.id === 'listing-form') { event.preventDefault(); createListing(event.target); }
  if (event.target.id === 'quote-form') { event.preventDefault(); createQuote(event.target); }
  if (event.target.id === 'case-form') { event.preventDefault(); if (intake.allowSubmit()) { if (state.editingCaseId) saveCaseDetails(event.target); else createCase(event.target); } }
  if (event.target.id === 'document-form') { event.preventDefault(); uploadCaseDocument(event.target); }
});
window.addEventListener('hashchange', () => { state.tab = validTab(location.hash.slice(1)); if (state.tab === 'ip-notes') ipNotes.enter(); state.detailId = null; state.activeCaseId = null; state.editingCaseId = null; state.quote = null; render(); });

render();
installLegalHelpLookup();
if (state.buyerToken) loadBuyerOffer().then(handleOfferReturn);
else loadData().then(handleCheckoutReturn);
