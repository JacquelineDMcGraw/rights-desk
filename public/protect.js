import { STATES, TERRITORIES, WORK_TYPES, USE_CHANNELS, GUIDE_LINKS, guideFor } from './rights-guide.js';
import { renderCaseOffers } from './offers.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fromList = (list, value) => list.find(([id]) => id === value)?.[1] || value || 'Not specified';
function localUrl(value) { try { const url = new URL(value, location.origin); return url.origin === location.origin ? esc(url.href) : ''; } catch { return ''; } }
function httpsUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? esc(url.href) : ''; } catch { return ''; } }
function options(list) { return list.map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join(''); }
function places() {
  return `<option value="">Choose a place</option><optgroup label="50 states">${STATES.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</optgroup><optgroup label="District"> <option value="District of Columbia">District of Columbia</option></optgroup><optgroup label="U.S. territories">${TERRITORIES.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</optgroup>`;
}

function caseForm(editing = false) {
  return `<form id="case-form" class="surface form-stack case-intake">
    <div class="status-box case-private-note"><strong>A little at a time</strong>${editing ? 'Return to any answer, including details you skipped. Draft changes stay in this browser until you save them to the case.' : 'Answer what you know and leave the rest for later. Your unfinished draft stays in this browser. When you create the case, its files stay private on this local server, accessible to this browser session.'}</div>
    ${editing ? '' : '<div class="field"><label for="case-preview">Reference image or screenshot *</label><input id="case-preview" name="preview" type="file" accept="image/jpeg,image/png,image/webp" required/><small>JPEG, PNG, or WebP, up to 12 MB. Visual matching applies to this image; other media need additional records.</small></div>'}
    <div class="field"><label for="case-title">Work title *</label><input id="case-title" name="title" maxlength="100" placeholder="The title you use for this work" required/></div>
    <div class="field"><label for="case-work">What kind of work is it? *</label><select id="case-work" name="workType" required><option value="">Choose work type</option>${options(WORK_TYPES)}</select></div>
    <div class="field"><label for="case-channel">Where did you see the possible use? *</label><select id="case-channel" name="useChannel" required><option value="">Choose use channel</option>${options(USE_CHANNELS)}</select></div>
    <div class="field"><label for="case-jurisdiction">Where did the suspected use occur? *</label><select id="case-jurisdiction" name="jurisdiction" required>${places()}</select><small>For activity spanning several locations, choose the best known place and record the rest below.</small></div>
    <div class="field"><label for="case-creator-location">Where are you based?</label><select id="case-creator-location" name="creatorLocation">${places()}</select></div>
    <div class="field"><label for="case-url">Link to the possible use</label><input id="case-url" name="suspectedUrl" type="url" maxlength="500" placeholder="https://example.com/page"/></div>
    <div class="field"><label for="case-published">When was your work first published?</label><input id="case-published" name="firstPublishedAt" type="date"/></div>
    <div class="field"><label for="case-ownership">Your relationship to the work</label><select id="case-ownership" name="ownershipBasis"><option value="">Choose, if known</option><option value="creator">I created it</option><option value="assignee">Rights were assigned to me</option><option value="employer">Created for my employer</option><option value="commissioned">Commissioned or client work</option><option value="coauthor">Created with others</option><option value="unsure">I am not sure</option></select></div>
    <div class="field"><label for="case-registration">Copyright registration or application number</label><input id="case-registration" name="registrationNumber" maxlength="80" placeholder="Optional"/></div>
    <div class="field"><label for="case-likeness">Is a person’s name or likeness involved?</label><select id="case-likeness" name="likenessInvolved"><option value="">I’m not sure yet</option><option value="yes">Yes</option><option value="no">No</option></select><small>Publicity and privacy rights may be separate from copyright and vary by place.</small></div>
    <div class="field"><label for="case-story">What happened?</label><textarea id="case-story" name="story" maxlength="1200" placeholder="Describe the use you saw, who posted it, dates, any prior license, and what you want to resolve."></textarea></div>
    <button type="submit" class="button dark full">Create private case <span aria-hidden="true">→</span></button>
  </form>`;
}

export function renderCaseEditor(state, item) {
  return `<section class="page-title page-pad"><button type="button" class="back" data-cancel-case-edit>← Back to case</button><div class="eyebrow">Your case, at your pace</div><h1>Add what<br/><em>you know.</em></h1><p class="lede">You can revisit any answer. Save when you are ready, or keep your draft changes for later.</p></section><section class="page-pad form-section"><div class="intake-fixed-work"><img src="${localUrl(item.previewUrl)}" alt="Reference for ${esc(item.title)}"/><div><strong>${esc(item.title)}</strong><p class="helper">This reference and its fingerprint identify the work in this case. Update the details below whenever you learn more.</p></div></div>${caseForm(true)}</section>`;
}

export function renderProtect(state) {
  return `<section class="page-title page-pad"><div class="eyebrow">Rights protection</div><h1>Keep proof.<br/><em>Find a path.</em></h1><p class="lede">Compare a work with named public collections, keep your creation evidence together, and explore U.S. next steps.</p><button type="button" class="tour-launch" data-start-case-tour="create">Take the first-case tour <span aria-hidden="true">↗</span></button></section>
    <section class="page-pad form-section"><div class="surface why-card"><div class="eyebrow">Why this matters now</div><h2 class="serif">A changing image economy.</h2><p>Getty Images Holdings filed a prepackaged Chapter 11 case on October 21, 2026. Its own reports also identify generative AI as a risk to licensed content. The filing describes a financial restructuring; it does not say AI caused it.</p><a href="https://www.sec.gov/Archives/edgar/data/1898496/000121390026111193/ea0309225-8k_getty.htm" target="_blank" rel="noopener noreferrer">Read Getty’s SEC filing ↗</a></div>
      <div class="section-heading"><h2>Private cases</h2><small>${state.cases.length} saved</small></div>
      ${state.cases.length ? `<div class="mini-list">${state.cases.map(item => `<button type="button" class="mini-item" data-case="${esc(item.id)}"><img src="${localUrl(item.previewUrl)}" alt=""/><span><strong>${esc(item.title)}</strong><small>${esc(fromList(WORK_TYPES,item.workType))} · ${esc(item.jurisdiction)} · ${item.search?.matches?.length || 0} candidate matches</small></span><span class="arrow">›</span></button>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>Start with the work</h2><p>A private case keeps the reference image, public search results, and your supporting records in one place.</p></div>`}
      <div class="section-heading"><h2>Start a case</h2></div>${!state.cases.length || state.showCaseForm ? caseForm() : `<button type="button" class="button dark full" data-new-case="true">Create a private case →</button>`}
      <p class="helper" style="margin-top:15px">Rights Desk searches only the sources named in each report. A missing result is not proof that a work is unlicensed, unprotected, or unused.</p></section>`;
}

function matchCard(match, reference) {
  const thumbnail = httpsUrl(match.thumbnailUrl);
  const page = httpsUrl(match.pageUrl);
  const similarity = match.similarity || {};
  const score = Number(similarity.score);
  const displayScore = Number.isFinite(score) ? `Visual ${Math.round(score)}/100` : '';
  const leadLabel = similarity.level === 'strong_visual_lead' ? 'Strong visual lead' : 'Possible visual lead';
  const evidence = Array.isArray(match.evidence) ? match.evidence : [];
  return `<article class="surface match-card"><div class="evidence-head"><div><div class="eyebrow">${esc(match.source || 'Public source')}</div><h3 class="serif">${esc(match.title || 'Candidate record')}</h3></div><span class="tag neutral">${esc(displayScore || 'Visual lead')}</span></div>
    <div class="match-pair"><div><img src="${localUrl(reference)}" alt="Your uploaded reference"/><small>Your reference</small></div><div>${thumbnail ? `<img src="${thumbnail}" alt="Candidate image from ${esc(match.source)}" referrerpolicy="no-referrer"/>` : `<div class="match-no-image">No public thumbnail</div>`}<small>Public candidate</small></div></div>
    <p class="helper">${esc(leadLabel)} · ${esc(match.creator || 'Creator not listed')} · ${esc(match.license || 'License not listed')}</p>
    ${evidence.length ? `<ul class="evidence-points">${evidence.slice(0,4).map(item => `<li>${esc(typeof item === 'string' ? item : item.detail || item.label || '')}</li>`).join('')}</ul>` : ''}
    <p class="helper">${esc(similarity.method || 'Candidate comparison')} is a lead for review, not an ownership or infringement decision.</p>
    ${page ? `<a class="button outline full" href="${page}" target="_blank" rel="noopener noreferrer">Open source record ↗</a>` : ''}</article>`;
}

function searchSection(item, state) {
  const search = item.search;
  const matches = Array.isArray(search?.matches) ? search.matches : [];
  const coverage = Array.isArray(search?.coverage) ? search.coverage : [];
  const nonVisual = !['photograph','illustration','ai_visual'].includes(item.workType);
  return `<section class="page-pad form-section"><div class="section-heading"><h2>Public collection search</h2><small>${search?.searchedAt ? esc(new Date(search.searchedAt).toLocaleDateString()) : 'Not run'}</small></div>
    <div class="status-box"><strong>What a match means</strong>Rights Desk compares your reference with candidates returned by named public sources. Similar images or matching titles do not establish ownership, a valid license, or infringement.</div>
    ${nonVisual ? `<div class="status-box warn" style="margin-top:12px"><strong>Image-only comparison</strong>This search compares the uploaded still image or screenshot. It does not compare full video, text, or audio content. Keep the original media and relevant excerpts with your case.</div>` : ''}
    <p class="helper" style="margin-top:12px">Searching sends your case title and short terms from your description or a local image model to the named public catalogs. Your image and supporting files stay on this computer.</p><button type="button" class="button dark full" data-run-case-search="true" ${state.searchingCase ? 'disabled' : ''} style="margin-top:15px">${state.searchingCase ? 'Searching public collections…' : search ? 'Search again' : 'Search public collections'} →</button>
    ${search ? `<div class="surface" style="margin-top:12px"><div class="eyebrow">${esc(search.status || 'Search result')}</div><p class="evidence-summary">${esc(search.summary || 'Search finished.')}</p>${Array.isArray(search.queries) && search.queries.length ? `<p class="helper" style="margin-top:12px"><strong>Terms sent to catalogs:</strong> ${search.queries.map(term => `“${esc(term)}”`).join(', ')}</p>` : ''}<div class="coverage-list">${coverage.map(source => `<div class="coverage-row"><strong>${esc(source.source)}</strong><span class="tag ${source.status === 'searched' || source.status === 'ok' || source.status === 'complete' ? '' : 'warn'}">${esc(source.status || 'unknown')}</span><small>${esc(source.detail || '')}${Number.isFinite(Number(source.retrieved)) ? ` · ${esc(source.retrieved)} returned` : ''}${Number.isFinite(Number(source.compared)) ? ` · ${esc(source.compared)} compared` : ''}${Number.isFinite(Number(source.count)) ? ` · ${esc(source.count)} visual leads` : ''}</small></div>`).join('')}</div>${Array.isArray(search.limitations) ? `<p class="helper" style="margin-top:12px">${search.limitations.map(esc).join(' ')}</p>` : ''}</div>
      <div class="section-heading"><h2>Candidate matches</h2><small>${matches.length} shown</small></div>${matches.length ? `<div class="mini-list">${matches.map(match => matchCard(match, item.previewUrl)).join('')}</div>` : search.status === 'unavailable' ? `<div class="status-box warn"><strong>Search unavailable</strong>Rights Desk could not complete a public visual comparison. Keep your records, check the coverage report, and try again when the unavailable tools or sources recover.</div>` : `<div class="status-box warn"><strong>No match in sources checked</strong>We have not found a candidate in the listed sources. This does not clear the work. Add your creation and licensing documentation below so you can assess your rights with evidence.</div>`}` : `<p class="helper" style="margin-top:13px">The report will name every queried source, show any unavailable source, and link each candidate back to its public record.</p>`}
  </section>`;
}

function documentsSection(item, state, guide) {
  const docs = state.caseDocuments || [];
  return `<section class="page-pad form-section"><div class="section-heading"><h2>Document your rights</h2><small>${docs.length} files</small></div>
    <div class="surface"><p class="evidence-summary">If the search finds nothing or a result is uncertain, your own records matter. For ${esc(fromList(WORK_TYPES,item.workType).toLowerCase())}, gather:</p><p class="doc-prompt">${esc(guide.workEvidence)}</p><p class="helper">Also keep assignments, releases, contracts, licenses granted, correspondence, and registration or application records. A public record search can miss unregistered or recent works.</p>
      <form id="document-form" class="form-stack" style="margin-top:16px"><div class="field"><label for="case-document">Add a private supporting file</label><input id="case-document" name="document" type="file" accept="application/pdf,image/jpeg,image/png" required/><small>PDF, JPEG, or PNG, up to 10 MB. This file is available only in this browser session.</small></div><button type="submit" class="button light full" ${state.uploadingDocument ? 'disabled' : ''}>${state.uploadingDocument ? 'Saving document…' : 'Save supporting file'}</button></form>
      ${docs.length ? `<div class="doc-list">${docs.map(doc => { const download = localUrl(doc.downloadUrl || `/api/cases/${encodeURIComponent(item.id)}/documents/${encodeURIComponent(doc.id)}/download`); return `<a href="${download}" class="doc-row" download><span>▣</span><span>${esc(doc.name || 'Supporting file')}<small>${doc.size ? `${Math.round(doc.size / 1024)} KB · ` : ''}${esc(doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '')}</small></span><strong>↓</strong></a>`; }).join('')}</div>` : ''}
    </div></section>`;
}

function guideSection(item, guide) {
  const online = item.useChannel === 'website' || item.useChannel === 'social';
  const special = item.jurisdiction === 'American Samoa';
  const local = guide.localLaw;
  const localTopics = local ? [
    ['Publicity / likeness', local.publicity],
    ['Privacy', local.privacy],
    ['Contracts / permissions', local.contract],
  ] : [];
  return `<section class="page-pad form-section"><div class="section-heading"><h2>Your U.S. next steps</h2><small>${esc(item.jurisdiction)}</small></div>
    <div class="status-box ${special ? 'warn' : ''}"><strong>Location matters</strong>${esc(guide.jurisdictionNote)}</div>
    <div class="steps rights-steps">${guide.steps.map((step,index) => `<div class="step"><span class="step-number">${index + 1}</span><span><strong>${esc(step.title)}</strong><small>${esc(step.text)}</small></span></div>`).join('')}</div>
    ${guide.aiNote ? `<div class="status-box warn" style="margin-top:12px"><strong>AI and protected expression</strong>${esc(guide.aiNote)} <a href="${GUIDE_LINKS.ai}" target="_blank" rel="noopener noreferrer">Copyright Office AI guidance ↗</a></div>` : ''}
    ${local ? `<div class="surface local-law"><div class="eyebrow">${esc(item.jurisdiction)} · checked ${esc(local.asOf || 'date unavailable')}</div><h3 class="serif">Local issues to review</h3><p class="helper">The creator’s copyright, a person’s likeness or privacy, and a contract can belong to different people. These prompts flag possible issues; the actual facts and current law control.</p>${localTopics.map(([label,topic]) => `<div class="law-topic"><strong>${esc(label)}</strong><p>${esc(topic?.summary || 'Local review needed.')}</p>${httpsUrl(topic?.sourceUrl) ? `<a href="${httpsUrl(topic.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : ''}</div>`).join('')}${httpsUrl(local.helpUrl) ? `<a class="law-help" href="${httpsUrl(local.helpUrl)}" target="_blank" rel="noopener noreferrer">Find legal help ↗</a>` : ''}</div>` : ''}
    <div class="surface guide-links"><h3 class="serif">Official starting points</h3><a href="${GUIDE_LINKS.basics}" target="_blank" rel="noopener noreferrer">Copyright basics ↗</a><a href="${GUIDE_LINKS.records}" target="_blank" rel="noopener noreferrer">Search federal records ↗</a><a href="${GUIDE_LINKS.registration}" target="_blank" rel="noopener noreferrer">Registration options ↗</a>${!special && online ? `<a href="${GUIDE_LINKS.dmca}" target="_blank" rel="noopener noreferrer">Online notice guidance ↗</a>` : ''}${!special ? `<a href="${GUIDE_LINKS.ccb}" target="_blank" rel="noopener noreferrer">Copyright Claims Board ↗</a>` : ''}<a href="${special ? GUIDE_LINKS.territories : GUIDE_LINKS.legalHelp}" target="_blank" rel="noopener noreferrer">${special ? 'Territorial coverage source' : 'Find legal help'} ↗</a></div>
    <p class="helper" style="margin-top:13px">Check ownership, existing permission, exceptions, and exact use before making a claim. This guide is a starting path; it does not decide your legal rights.</p><button type="button" class="button outline full" data-export-case="true" style="margin-top:14px">Download case summary ↓</button></section>`;
}

export function renderCaseDetail(state, item) {
  const guide = guideFor(item);
  return `<section class="page-pad" style="padding-top:17px"><div class="case-toolbar"><button type="button" class="back" data-back-case="true">← Back to private cases</button><button type="button" class="tour-replay" data-start-case-tour="collect">Tour this case ↗</button></div><div class="private-image"><img src="${localUrl(item.previewUrl)}" alt="Reference for ${esc(item.title)}"/><span>PRIVATE CASE</span></div></section>
    <section class="detail-body"><div class="eyebrow">${esc(fromList(WORK_TYPES,item.workType))} · ${esc(fromList(USE_CHANNELS,item.useChannel))}</div><h1>${esc(item.title)}</h1><p class="detail-meta">Possible use in ${esc(item.jurisdiction)} · opened ${esc(new Date(item.createdAt).toLocaleDateString())}</p>${item.story ? `<p class="detail-story">${esc(item.story)}</p>` : ''}${item.suspectedUrl && httpsUrl(item.suspectedUrl) ? `<a class="case-link" href="${httpsUrl(item.suspectedUrl)}" target="_blank" rel="noopener noreferrer">Open reported use ↗</a>` : ''}${item.previewSha256 ? `<p class="hash-line"><strong>Reference SHA-256</strong> ${esc(item.previewSha256)}</p>` : ''}<button type="button" class="button outline full" data-edit-case style="margin-top:16px">Update case details →</button><p class="helper" style="margin-top:8px">Return to anything you skipped, add a registration number, or update your notes.</p></section>
    ${searchSection(item,state)}${documentsSection(item,state,guide)}${renderCaseOffers(state,item)}${guideSection(item,guide)}<p class="footer-note page-pad">Rights Desk · Case files are stored on this local machine</p>`;
}
