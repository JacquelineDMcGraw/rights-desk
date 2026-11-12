import { WORK_TYPES } from './rights-guide.js';
import { renderPermissionHelp } from './permission-help.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const money = value => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(value) || 0);
const dimensions = [['purpose','Purpose / use'],['channels','Where it may appear'],['duration','How long'],['territory','Audience / territory']];
const stages = new Set(['permission','request','request-detail','report','question','answers','terms','preview','complete','practice-complete']);
const walkthroughTitle = 'Translation permission';
const legacyWalkthroughTitle = 'Practice — Translation permission';
export function permissionCaseTitle(item) {
  return item.practice && item.title === legacyWalkthroughTitle ? walkthroughTitle : item.title;
}
const requestUses = [
  {
    id: 'paid-social',
    label: 'promote the work on its website and in paid social advertisements',
    question: 'Which platforms will run the paid ads?',
    detailLabel: 'Paid ad platforms',
    example: 'For example, Instagram and Facebook',
    hint: 'For paid ads, include the platforms, campaign length, and where the ads will run if you know them.',
    purpose: 'Promoting the studio’s project through paid advertising.',
    channels: 'The studio’s website and paid social advertisements.',
  },
  {
    id: 'printed-brochure',
    label: 'feature the work in a printed brochure',
    question: 'Where will the brochure be handed out?',
    detailLabel: 'Brochure distribution locations',
    example: 'For example, at the studio’s gallery and local arts fairs',
    hint: 'For a brochure, include where and for how long it will be distributed. Add a print limit if you know it.',
    purpose: 'Promoting the studio’s project in a printed brochure.',
    channels: 'Printed brochures distributed by the studio.',
  },
];
const requestSentence = (use, practice) => `The studio wants to ${use.label}${practice
  ? ' for six months from payment confirmation, in the United States only. The creator will set any additional fee. Translation permission still needs to be discussed separately.'
  : '.'}`;
const requestUseFor = text => requestUses.find(use => text.trim().startsWith(`The studio wants to ${use.label}`));
function requestDetailLine(draft) {
  const use = requestUses.find(option => option.id === draft.requestUse);
  const answer = use && draft.requestDetails[use.id]?.trim();
  return answer ? `${use.detailLabel}: ${answer}` : '';
}
const proposedRequest = draft => [draft.requestText.trim(),requestDetailLine(draft)].filter(Boolean).join('\n\n');
const agreedTermsUrl = id => `/api/cases/${encodeURIComponent(id)}/agreed-terms`;
const contractTypes = ['application/pdf','image/jpeg','image/png'];
const sourceImport = {
  permission: {
    field: 'permissionText', label: 'Existing permission', max: 8000, endpoint: 'extract-terms',
    types: contractTypes, source: 'contract', selectLabel: 'Contract to read',
    attachLabel: 'Attach a contract', action: 'Pull terms from contract', reviewAction: 'Save agreed terms',
  },
  request: {
    field: 'requestText', label: 'Proposed use', max: 4000, endpoint: 'extract-proposed-use',
    types: [...contractTypes,'message/rfc822','text/plain'], source: 'email or brief', selectLabel: 'Email or brief to read',
    attachLabel: 'Attach an email or brief', action: 'Pull proposed use', reviewAction: 'Compare permissions',
  },
};
const sourceImportKey = (caseId,stage) => `${caseId}:${stage}`;
const practiceAnswers = {
  duration: 'Six months from payment confirmation.',
  territory: 'United States only.',
  translation: 'Only a Spanish translation of the text included in the work is permitted for this campaign, after the creator reviews and approves it in writing before publication. Other languages or adaptations need a separate agreement.',
};
const translationQuestion = { id:'translation', prompt:'Will translations of my work be needed, too?', help:'The work includes text. Ask which language the studio needs and decide whether you want to approve the translated version.' };
const translationDecline = 'The work may be used only in its original language. Translations are not included in this permission.';
const questionLabel = id => id === 'translation' ? 'Translation permission' : dimensions.find(([key]) => key === id)?.[1] || id;
const permissionExample = 'You can display my photo on your website for one year in the United States. Please credit me. Paid ads aren’t included.';
const practiceSample = {
  permissionText: 'The studio may display the creator’s work, including its original-language text, on its website. The creator keeps ownership. Advertising, translations, and sharing the work with other organizations are not part of this agreement.',
  requestText: requestSentence(requestUses[0],true),
};
const photoExample = {
  title: 'Harbor at Dawn Photo',
  permissionText: 'Harbor Diner may use my Harbor at Dawn Photo in its printed dine-in menus only. This permission excludes advertising and online use. I retain copyright.',
  requestText: 'Can Harbor Diner use Harbor at Dawn Photo in one 30-second paid online commercial?',
};
function sourceExampleFor(draft) {
  if (draft.stage === 'permission') return draft.practice ? permissionExample : photoExample.permissionText;
  return draft.practice ? practiceSample.requestText : photoExample.requestText;
}
const practiceAnswerFor = (draft, id) => (requestUses.find(use => use.id === draft.requestUse) || requestUseFor(draft.requestText) || requestUses[0])[id] || practiceAnswers[id];

function requestChoices(draft) {
  const proposal = draft.requestText.trim();
  const detail = requestDetailLine(draft);
  return `<fieldset class="pc-request-choices" id="pc-request-choices"><legend>The studio wants to:</legend><p class="helper">${draft.practice ? 'Choose a use to open its next question.' : 'Choose a use to open its next question, or write the request in your own words.'}</p>${detail ? `<p class="helper" id="pc-request-detail-summary">${esc(detail)}</p>` : ''}${requestUses.map(option => `<button type="button" class="button outline full" data-pc-request-use="${option.id}" aria-pressed="${draft.requestUse ? draft.requestUse === option.id : proposal === requestSentence(option,false) || proposal === requestSentence(option,true)}">${esc(option.label)}</button>`).join('')}${draft.practice ? '' : '<button type="button" class="button outline full" data-pc-request-use="other">use the work in another way</button>'}</fieldset>`;
}

function field(name, label, value, options = {}) {
  const id = `pc-${name}`;
  const common = `id="${id}" name="${name}" maxlength="${options.max || 500}" ${options.min ? `minlength="${options.min}"` : ''} ${options.required === false ? '' : 'required'}${options.help ? ` aria-describedby="${id}-help"` : ''}`;
  return `<div class="field" ${options.hidden ? 'hidden' : ''}><label for="${id}">${esc(label)}${options.required === false ? '' : ' *'}</label>${options.textarea ? `<textarea ${common} rows="${options.rows || 3}" placeholder="${esc(options.placeholder || '')}">${esc(value)}</textarea>` : `<input ${common} value="${esc(value)}" ${options.type === 'number' ? 'type="number" min="5" max="10000" step="0.01"' : 'type="text"'} placeholder="${esc(options.placeholder || '')}"/>`}${options.help ? `<small id="${id}-help">${esc(options.help)}</small>` : ''}</div>`;
}

export function permissionChangeTerms(change) {
  return `<dl class="offer-terms pc-scope">${dimensions.map(([key,label]) => `<div><dt>${esc(label)}</dt><dd>${esc(change?.[key] || 'Needs clarification')}</dd></div>`).join('')}${change?.conditions ? `<div><dt>Additional conditions</dt><dd>${esc(change.conditions)}</dd></div>` : ''}</dl>`;
}

/** Private source text and unfinished decisions stay in a per-case local draft. */
export class PermissionChanges {
  constructor({ api, jsonPost, render, announce, onOffer, onCase }) {
    Object.assign(this, { api, jsonPost, renderApp:render, announce, onOffer, onCase });
    this.drafts = new Map();
    this.records = new Map();
    this.loading = new Set();
    this.agreedTerms = new Map();
    this.savingAgreedTerms = new Set();
    this.sourceImports = new Map();
    // Practice is a server-owned case flag, never an authorization supplied by
    // the browser draft. The server independently blocks offers for these cases.
    this.practiceCases = new Map();
    this.practiceBusy = false;
    this.newCase = { title:'', workType:'photograph', step:0, busy:false, error:'', storageFailed:false };
    try {
      const stored = JSON.parse(localStorage.getItem('rights-desk-permission-case-draft-v1') || 'null');
      if (stored && typeof stored === 'object') {
        this.newCase.title = String(stored.title || '').slice(0,100);
        this.newCase.workType = WORK_TYPES.some(([id]) => id === stored.workType) ? stored.workType : 'photograph';
        this.newCase.step = stored.step === 1 ? 1 : 0;
      }
    } catch { this.newCase.storageFailed = true; }
    document.addEventListener('input', event => this.handleInput(event));
    document.addEventListener('change', event => this.handleInput(event));
    document.addEventListener('click', event => this.handleClick(event));
    document.addEventListener('submit', event => this.handleSubmit(event));
  }

  key(id) { return `rights-desk-permission-change-v1:${id}`; }
  sourceChanged(draft) {
    return Boolean(draft.comparison && (draft.comparison.permissionText !== draft.permissionText.trim() || draft.comparison.requestText !== proposedRequest(draft)));
  }
  ensure(id) {
    if (this.drafts.has(id)) return this.drafts.get(id);
    const draft = { caseId:id, stage:'permission', permissionText:'', requestText:'', requestUse:'', requestDetails:{}, answers:{}, practiceTranslation:'', practiceTranslationReviewed:false, practiceTranslationDeferred:false, questionIndex:0, comparison:null, terms:{}, practice:false, busy:false, error:'', storageFailed:false, touched:false };
    try {
      const stored = JSON.parse(localStorage.getItem(this.key(id)) || 'null');
      if (stored && stored.caseId === id) {
        draft.stage = stages.has(stored.stage) ? stored.stage : 'permission';
        draft.permissionText = String(stored.permissionText || '').slice(0,8000);
        draft.requestText = String(stored.requestText || '').slice(0,4000);
        draft.requestUse = requestUses.some(use => use.id === stored.requestUse) ? stored.requestUse : '';
        draft.requestDetails = Object.fromEntries(requestUses.filter(use => typeof stored.requestDetails?.[use.id] === 'string').map(use => [use.id,stored.requestDetails[use.id].slice(0,500)]));
        if (draft.stage === 'request-detail' && !draft.requestUse) draft.stage = 'request';
        draft.answers = Object.fromEntries(dimensions.filter(([key]) => typeof stored.answers?.[key] === 'string').map(([key]) => [key,stored.answers[key].slice(0,500)]));
        draft.practiceTranslation = String(stored.practiceTranslation || '').slice(0,500);
        draft.practiceTranslationReviewed = stored.practiceTranslationReviewed === true;
        draft.practiceTranslationDeferred = stored.practiceTranslationDeferred === true;
        draft.questionIndex = Math.max(0,Number(stored.questionIndex) || 0);
        draft.comparison = stored.comparison && typeof stored.comparison.id === 'string' ? stored.comparison : null;
        draft.terms = Object.fromEntries(['licensorName','amount','purpose','channels','duration','territory','conditions'].map(key => [key,String(stored.terms?.[key] || '').slice(0,500)]));
        draft.touched = Boolean(draft.permissionText || draft.requestText);
      }
    } catch { draft.storageFailed = true; }
    this.drafts.set(id,draft);
    return draft;
  }
  persist(draft) {
    try { localStorage.setItem(this.key(draft.caseId),JSON.stringify({ ...draft,busy:false,error:'',storageFailed:false })); }
    catch { draft.storageFailed = true; }
  }
  persistNew() {
    try { localStorage.setItem('rights-desk-permission-case-draft-v1',JSON.stringify({ title:this.newCase.title,workType:this.newCase.workType,step:this.newCase.step })); }
    catch { this.newCase.storageFailed = true; }
  }
  refresh(focus = '#pc-step-heading') {
    this.renderApp();
    const flow = document.querySelector('#permission-flow');
    if (flow?.dataset.pcCase) document.dispatchEvent(new CustomEvent('rights-desk-permission-stage', { detail:this.getGuideState(flow.dataset.pcCase) }));
    if (focus) requestAnimationFrame(() => { const element = document.querySelector(focus); element?.scrollIntoView({ block:'start',behavior:'instant' }); element?.focus({ preventScroll:true }); });
  }
  go(draft, stage) { draft.stage = stage; draft.error = ''; this.persist(draft); this.refresh(); }

  setPractice(id, practice) {
    const enabled = practice === true;
    this.practiceCases.set(id,enabled);
    const draft = this.ensure(id);
    draft.practice = enabled;
    if (enabled && draft.stage === 'complete') draft.stage = 'practice-complete';
    if (enabled && draft.terms.licensorName === 'Practice Creator') draft.terms.licensorName = 'Creator';
    if (!enabled && draft.stage === 'practice-complete') draft.stage = 'permission';
    return draft;
  }
  questionsFor(draft) {
    const questions = draft.comparison?.questions || [];
    return this.practiceCases.get(draft.caseId) === true && !draft.practiceTranslationReviewed
      ? [translationQuestion,...questions] : questions;
  }
  answerFor(draft,id) { return id === 'translation' ? draft.practiceTranslation : draft.answers[id]; }
  setAnswer(draft,id,value) {
    if (id === 'translation') {
      if (this.practiceCases.get(draft.caseId) !== true) return;
      draft.practiceTranslation = value;
      draft.practiceTranslationReviewed = false;
      draft.practiceTranslationDeferred = false;
    } else if (dimensions.some(([key]) => key === id)) draft.answers[id] = value;
  }
  getGuideState(id) {
    const draft = this.ensure(id);
    return { caseId:id,stage:draft.stage,isPractice:this.practiceCases.get(id) === true,busy:Boolean(draft.busy),questionIndex:draft.questionIndex };
  }
  resetPractice(draft) {
    Object.assign(draft,{ ...practiceSample,requestUse:'',requestDetails:{},answers:{},practiceTranslation:'',practiceTranslationReviewed:false,practiceTranslationDeferred:false,comparison:null,terms:{},stage:'permission',questionIndex:0,touched:true,error:'',busy:false });
    this.persist(draft);
  }
  async startPractice() {
    if (this.practiceBusy) return null;
    this.practiceBusy = true;
    try {
      // Reuse a real practice case when possible, so replaying help does not
      // fill the private desk with duplicate examples.
      const cases = await this.api('/api/cases');
      const candidates = Array.isArray(cases) ? cases.filter(item => item.practice === true && permissionCaseTitle(item) === walkthroughTitle && (item.comparisonCount || 0) < 28) : [];
      let item = candidates.sort((a,b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0];
      if (!item) item = await this.jsonPost('/api/permission-cases',{ title:walkthroughTitle,workType:'other',practice:true });
      if (item.practice !== true) throw new Error('This review could not be opened. Please try again.');
      const draft = this.setPractice(item.id,true);
      const resuming = draft.touched && draft.stage !== 'practice-complete';
      if (!resuming) this.resetPractice(draft);
      this.onCase(item);
      this.refresh();
      this.announce(resuming ? 'Your review is ready to continue.' : 'Your review is ready. Start with the existing permission.');
      return item;
    } catch (error) {
      this.announce(error.message || 'This review could not be opened. Please try again.',true);
      return null;
    } finally { this.practiceBusy = false; }
  }

  async load(id, { practice } = {}) {
    if (typeof practice === 'boolean') this.setPractice(id,practice);
    if (this.loading.has(id)) return;
    this.loading.add(id);
    const draft = this.ensure(id);
    const priorTerms = this.agreedTerms.get(id);
    const [comparisons, savedTerms] = await Promise.allSettled([
      this.api(`/api/cases/${encodeURIComponent(id)}/permission-comparisons`),
      draft.practice ? null : this.api(agreedTermsUrl(id)),
    ]);
    if (comparisons.status === 'fulfilled') {
      const result = comparisons.value;
      const records = [...(Array.isArray(result) ? result : result.comparisons || [])].reverse().sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      this.records.set(id,records);
      if (!draft.touched && !draft.comparison && records[0]) this.adopt(draft,records[0]);
    } else draft.loadError = comparisons.reason.message;
    if (!draft.practice && this.agreedTerms.get(id) === priorTerms) {
      this.agreedTerms.set(id,savedTerms.status === 'fulfilled' ? savedTerms.value : priorTerms || { unavailable:true });
    }
    this.loading.delete(id);
    this.refresh(null);
  }
  adopt(draft, record) {
    Object.assign(draft, { comparison:record,permissionText:record.permissionText || '',requestText:record.requestText || '',requestUse:'',requestDetails:{},answers:{ ...(record.answers || {}) },questionIndex:0,stage:'report',touched:true,terms:{},practiceTranslationReviewed:false });
    this.persist(draft);
  }

  agreedTermsReference(draft) {
    const record = this.agreedTerms.get(draft.caseId);
    if (record?.unavailable) return '<p class="helper" role="status">Couldn’t load the saved agreed terms. Reopen this case to try again.</p>';
    if (!record?.text) return '';
    const reuse = draft.stage === 'permission' ? '<button type="button" class="pc-text-button" data-pc-use-agreed-terms>Use these terms in Existing permission</button><p class="helper">This replaces any text in that box.</p>' : '';
    return `<details class="pc-source-guide pc-agreed-terms"><summary>Saved agreed terms</summary><div class="helper"><p>Saved ${esc(new Date(record.savedAt).toLocaleString())} · Private to this case</p><p class="pc-agreed-text">${esc(record.text)}</p>${reuse}</div></details>`;
  }

  fillSourceField(flow, fieldName, text) {
    const field = flow.querySelector(`#pc-${fieldName}`);
    if (!field) return false;
    field.value = text;
    this.handleInput({ target:field });
    field.focus();
    field.setSelectionRange(text.length,text.length);
    return true;
  }

  sourceImportStatus(draft) {
    const config = sourceImport[draft.stage];
    const entry = this.sourceImports.get(sourceImportKey(draft.caseId,draft.stage));
    if (!entry) return '';
    if (entry.pending) return `<p>Reading the ${config.source} on this computer…</p>`;
    if (entry.error) return `<p class="status-box error">${esc(entry.error)}</p>`;
    if (!entry.text) return '';
    const pages = entry.pages.length ? ` · ${entry.pages.length === 1 ? 'page' : 'pages'} ${entry.pages.join(', ')}` : '';
    const url = `/api/cases/${encodeURIComponent(draft.caseId)}/documents/${encodeURIComponent(entry.documentId)}/download`;
    return `<p><strong>${entry.filled ? 'Draft wording added' : 'Extracted wording ready'}</strong> · ${esc(entry.documentName)}${pages}</p>
      <p>Check the wording against the ${config.source} and edit it before you select <strong>${config.reviewAction}</strong>.</p>
      <a href="${esc(url)}" download>Download source ${config.source}</a>
      ${entry.filled ? '' : `<button type="button" class="button outline" data-pc-fill-source>Replace ${config.label} with extracted wording</button>`}`;
  }

  sourceImportPanel(draft, documents) {
    const config = sourceImport[draft.stage];
    const choices = documents.filter(doc => config.types.includes(doc.mime));
    const attach = `<button type="button" class="pc-text-button" data-attach-source aria-controls="permission-supporting-records">${config.attachLabel}</button>`;
    if (!choices.length) return `<div class="status-box pc-source-import">
      <p class="helper">Attach the ${config.source} to pull its wording into ${config.label}.</p>
      ${attach}
    </div>`;
    const entry = this.sourceImports.get(sourceImportKey(draft.caseId,draft.stage));
    const selectedId = entry?.documentId ?? (choices.length === 1 ? choices[0].id : '');
    return `<div class="status-box pc-source-import">
      <div class="field"><label for="pc-source-document">${config.selectLabel}</label>
        <select id="pc-source-document" ${entry?.pending ? 'disabled' : ''}>
          <option value="">Choose an attached file</option>
          ${choices.map(doc => `<option value="${esc(doc.id)}" ${doc.id === selectedId ? 'selected' : ''}>${esc(doc.name || 'Supporting file')}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="button outline" data-pc-extract-source ${!choices.some(doc => doc.id === selectedId) || entry?.pending ? 'disabled' : ''}>${entry?.pending ? 'Reading file…' : config.action}</button>
      <p class="helper">This fills ${config.label} with wording from the file for you to review and edit.</p>
      ${draft.stage === 'request' ? attach : ''}
      <div class="helper pc-source-status" role="status" data-pc-source-status>${this.sourceImportStatus(draft)}</div>
    </div>`;
  }

  selectSourceDocument(caseId, stage, attachment) {
    const key = sourceImportKey(caseId,stage);
    if (sourceImport[stage]?.types.includes(attachment?.mime) && !this.sourceImports.get(key)?.pending) {
      this.sourceImports.set(key,{ documentId:attachment.id });
    }
  }

  updateSourceImport(flow, draft) {
    const entry = this.sourceImports.get(sourceImportKey(draft.caseId,draft.stage));
    const select = flow.querySelector('#pc-source-document');
    const button = flow.querySelector('[data-pc-extract-source]');
    const status = flow.querySelector('[data-pc-source-status]');
    if (!select || !button || !status) return;
    select.disabled = Boolean(entry?.pending);
    button.disabled = !select.value || Boolean(entry?.pending);
    button.textContent = entry?.pending ? 'Reading file…' : sourceImport[draft.stage].action;
    status.innerHTML = this.sourceImportStatus(draft);
  }

  async extractSource(draft, flow) {
    const stage = draft.stage;
    const config = sourceImport[stage];
    const key = sourceImportKey(draft.caseId,stage);
    if (draft.practice || !config || this.sourceImports.get(key)?.pending) return;
    const select = flow.querySelector('#pc-source-document');
    const sourceField = flow.querySelector(`#pc-${config.field}`);
    if (!sourceField || !select?.value) return;
    const startValue = sourceField.value;
    const entry = { documentId: select.value, documentName: select.selectedOptions[0]?.textContent || 'Supporting file', pending:true };
    this.sourceImports.set(key,entry);
    this.updateSourceImport(flow,draft);

    try {
      const url = `/api/cases/${encodeURIComponent(draft.caseId)}/documents/${encodeURIComponent(entry.documentId)}/${config.endpoint}`;
      const result = await this.jsonPost(url,{});
      if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > config.max) throw new Error(`Couldn’t find wording to fill ${config.label}. You can paste the relevant wording from the ${config.source}.`);
      entry.text = result.text;
      const excerpts = Array.isArray(result.excerpts) ? result.excerpts : [];
      entry.pages = [...new Set(excerpts.map(excerpt => excerpt?.page).filter(page => Number.isInteger(page) && page > 0))].sort((a,b) => a - b);
    } catch (error) {
      entry.error = error.message || `Couldn’t read the ${config.source}. You can still enter ${config.label.toLowerCase()} by hand.`;
    } finally {
      entry.pending = false;
    }

    const currentFlow = document.querySelector('#permission-flow');
    if (currentFlow?.dataset.pcCase !== draft.caseId || draft.stage !== stage) return;
    // A rebuilt view or edits made during extraction need an explicit apply.
    if (entry.text && flow === currentFlow && !entry.edited && sourceField.value === startValue) {
      entry.filled = this.fillSourceField(flow,config.field,entry.text);
    }
    this.updateSourceImport(currentFlow,draft);
  }

  async saveAgreedTerms(draft, button) {
    const { caseId } = draft;
    if (draft.practice || this.savingAgreedTerms.has(caseId)) return;
    const text = draft.permissionText.trim();
    if (text.length < 12) {
      this.announce('Add at least a short sentence to Existing permission before saving.',true);
      button.closest('form')?.querySelector('#pc-permissionText')?.focus();
      return;
    }
    this.savingAgreedTerms.add(caseId);
    button.disabled = true;
    button.textContent = 'Saving agreed terms…';
    let failure;
    try { this.agreedTerms.set(caseId,await this.jsonPost(agreedTermsUrl(caseId),{ text })); }
    catch (error) { failure = error; }
    finally { this.savingAgreedTerms.delete(caseId); }

    const flow = document.querySelector('#permission-flow');
    if (flow?.dataset.pcCase !== caseId) return;
    const currentButton = flow.querySelector('[data-pc-save-agreed-terms]');
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = 'Save agreed terms'; }
    if (failure) { this.announce(failure.message || 'Couldn’t save the agreed terms. Try again.',true); return; }
    const reference = flow.querySelector('[data-pc-agreed-reference]');
    if (reference) reference.innerHTML = this.agreedTermsReference(draft);
    this.announce('Agreed terms saved. Open Saved agreed terms to refer to them later.');
  }

  renderStart() {
    const d = this.newCase;
    const prompt = d.step
      ? `<div class="field"><label for="pc-new-medium">Work type *</label><select id="pc-new-medium" name="workType" required>${WORK_TYPES.map(([id,label]) => `<option value="${esc(id)}" ${d.workType === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`
      : `${field('new-title','Work title',d.title,{ max:100,min:3,placeholder:'Enter a work or project title' })}
        <button type="button" class="pc-text-button" data-pc-example-title>Use example title: ${esc(photoExample.title)}</button>`;
    return `<section class="surface pc-start" id="permission-case-start"><div class="eyebrow">A private review · ${d.step + 1} of 2</div><h2 class="serif" id="pc-new-heading" tabindex="-1">${d.step ? 'What kind of work is it?' : 'What work are we reviewing?'}</h2><p class="helper">${d.step ? 'This keeps the work easy to recognize. You can add supporting records later.' : 'A title is enough to begin. No reference image or location is needed for a permission comparison.'}</p><form id="permission-case-form" class="form-stack">${prompt}<p class="pc-error" role="status">${esc(d.error)}</p><div class="pc-actions">${d.step ? '<button type="button" class="button outline" data-pc-new-back>← Back</button>' : ''}<button type="submit" class="button dark" ${d.busy ? 'disabled' : ''}>${d.busy ? 'Opening your review…' : d.step ? 'Start private review →' : 'Next →'}</button></div></form>${d.storageFailed ? '<p class="helper">Browser draft storage is unavailable. Keep this page open until your review is created.</p>' : '<p class="helper pc-subtle">You can pause here. Your unfinished title stays in this browser.</p>'}</section>`;
  }

  render(item, { documents = [] } = {}) {
    const d = this.setPractice(item.id,item.practice === true);
    const record = d.comparison;
    let body = '';
    if (d.stage === 'permission' || d.stage === 'request') body = this.sourceStep(d,item.caseType === 'permission-review' ? documents : null);
    else if (d.stage === 'request-detail') body = this.requestDetailStep(d);
    else if (d.stage === 'question') body = this.questionStep(d);
    else if (d.stage === 'answers') body = this.answerReview(d);
    else if (d.stage === 'terms') body = this.termsStep(d);
    else if (d.stage === 'preview') body = this.previewStep(d,item);
    else if (d.stage === 'practice-complete') body = this.practiceComplete(d);
    else if (d.stage === 'complete') body = `<div class="surface"><h3 class="serif" id="pc-step-heading" tabindex="-1">Your change offer is ready.</h3><p>The approved terms and fee are fixed in the buyer link below. Your source permission and private request stay in this case.</p><button type="button" class="button outline full pc-space" data-pc-action="report">Return to comparison</button></div>`;
    else body = this.report(d);
    const history = this.records.get(item.id) || [];
    return `<section class="page-pad form-section permission-flow" id="permission-flow" data-pc-case="${esc(item.id)}" data-pc-stage="${esc(d.stage)}" data-pc-practice="${d.practice ? 'true' : 'false'}"><div class="section-heading"><h2>${d.practice ? 'Review the permission change.' : 'Compare. Clarify. Get paid.'}</h2></div>${d.practice && d.stage !== 'practice-complete' ? '<div class="status-box pc-space" role="note"><strong>The studio’s campaign</strong>The studio wants a six-month U.S. campaign. The work includes text, so decide whether to allow a Spanish translation.<button type="button" class="pc-text-button pc-practice-restart" data-pc-practice-replay>Start this review over</button></div>' : ''}<ol class="pc-progress" aria-label="Permission change steps"><li class="${['permission','request','request-detail'].includes(d.stage) ? 'current' : ''}"><span>Compare</span></li><li class="${['report','question','answers'].includes(d.stage) ? 'current' : ''}"><span>Clarify</span></li><li class="${['terms','preview','complete','practice-complete'].includes(d.stage) ? 'current' : ''}"><span>Confirm</span></li></ol>${d.practice ? '' : `<div data-pc-agreed-reference>${this.agreedTermsReference(d)}</div>`}${d.busy ? `<div class="status-box pc-loading" role="status"><span class="spinner" aria-hidden="true"></span><strong>${d.busy === 'offer' ? 'Creating your approved offer…' : 'Reading both records…'}</strong>${d.busy === 'offer' ? 'The buyer link will contain only the terms you reviewed.' : 'The local model is comparing the text and checking supporting passages. Your work stays on this computer.'}</div>` : body}${d.error ? `<p class="status-box error pc-space" role="status"><strong>Let’s check this</strong>${esc(d.error)}</p>` : ''}${d.storageFailed ? '<p class="helper pc-space">Browser storage is unavailable. Unsaved changes remain on this page only; keep a copy of your source text.</p>' : '<p class="helper pc-subtle">Your unfinished answers save in this browser. Shared devices may retain drafts. Source text is stored privately with this case after comparison.</p>'}${history.length ? `<details class="pc-history"><summary>Saved comparisons (${history.length})</summary><p class="helper">Each comparison is a separate record. Approved offers keep their original terms.</p>${history.map(entry => `<button type="button" class="pc-history-row" data-pc-record="${esc(entry.id)}">${esc(new Date(entry.createdAt).toLocaleString())}<span>${entry.id === record?.id ? 'Viewing' : 'Open'}</span></button>`).join('')}</details>` : ''}${renderPermissionHelp()}</section>`;
  }

  sourceStep(d, documents = null) {
    const first = d.stage === 'permission';
    const help = first ? 'Look in a license, contract, email, or message where you agreed to the use. Paste the exact lines that say what they can do with your work.'
      : d.practice ? 'Read the studio’s proposal, then choose a use to compare with the existing permission.'
      : 'Paste the email or description of how someone wants to use your work. It is okay if details are missing; we will work through them one at a time.';
    const sourceLabel = first ? 'Existing permission' : 'Proposed use';
    const sourceExample = sourceExampleFor(d);
    const sourceGuide = `<details class="pc-source-guide">
      <summary>Need some help?</summary>
      <div class="helper">
        ${first ? `<ul>
          <li><strong>What can they do?</strong> Display, print, or advertise the work.</li>
          <li><strong>Where can it appear?</strong> Their website, social media, or printed materials.</li>
          <li><strong>How long?</strong> Look for dates or a time limit.</li>
          <li><strong>Who can see it?</strong> Look for a place or audience, such as the United States only.</li>
          <li><strong>What are the limits?</strong> Look for things like required credit, excluded paid ads, or approval for translations.</li>
        </ul>` : `<ul>
          <li><strong>What do they want to add or change?</strong> Look for a new use, a longer run, or a translation.</li>
          <li><strong>Where will the work appear?</strong> Include the site, platform, or print location if they named it.</li>
          <li><strong>When and for whom?</strong> Include dates, a time limit, or the audience if they specified one. You can come back to anything they left open.</li>
        </ul>`}
        <p><strong>What it might sound like</strong></p>
        <button type="button" class="pc-source-example" data-pc-source-example aria-labelledby="pc-example-label" aria-describedby="pc-example-text pc-example-hint">
          <span id="pc-example-text">“${esc(sourceExample)}”</span>
          <strong id="pc-example-label">Use this example</strong>
        </button>
        <p id="pc-example-hint">This replaces any text in the ${sourceLabel} box. You can edit it before continuing.</p>
        ${first ? '<p><strong>Can’t find the agreement?</strong> Choose <strong>Save for later</strong> while you look for it or ask the other party to confirm what you agreed to in writing.</p>' : ''}
      </div>
    </details>`;
    const saving = this.savingAgreedTerms.has(d.caseId);
    const saveAgreed = first && !d.practice ? `<button type="button" class="button outline" data-pc-save-agreed-terms ${saving ? 'disabled' : ''}>${saving ? 'Saving agreed terms…' : 'Save agreed terms'}</button>` : '';
    const sourceAttachment = !d.practice && documents ? this.sourceImportPanel(d,documents) : '';
    const sourceField = first
      ? field('permissionText',sourceLabel,d.permissionText,{ textarea:true,rows:8,max:8000,min:12,placeholder:'Paste the agreed wording here…',help:'Only have part of it? Paste what you can find. Rights Desk compares the wording you provide, and missing details can stay open.' })
      : field('requestText',sourceLabel,d.requestText,{ textarea:true,rows:6,max:4000,min:12,placeholder:'Describe the proposed use here…',help:requestUseFor(d.requestText)?.hint });
    const template = first && !d.practice ? `<details class="pc-sample"><summary>Start from a template</summary><p class="helper">Try the menu agreement and commercial request from the demo. This replaces both text fields. You can edit them before comparing.</p><button type="button" class="button light full pc-space" data-pc-sample>Load ${esc(photoExample.title)} example</button></details>` : '';
    return `<form class="surface form-stack" id="permission-source-form"><div class="eyebrow">${sourceLabel} · ${first ? '1' : '2'} of 2</div><h3 class="serif" id="pc-step-heading" tabindex="-1">${first ? 'What was already agreed?' : 'How do they want to use your work?'}</h3><p class="helper">${help}</p>${sourceAttachment}${sourceGuide}${sourceField}${first ? '' : requestChoices(d)}<div class="pc-actions">${first ? '' : '<button type="button" class="button outline" data-pc-action="permission">← Back</button>'}<button type="submit" class="button dark">${first ? 'Next →' : 'Compare permissions →'}</button>${saveAgreed}</div><button type="button" class="pc-text-button" data-pc-save>Save for later</button>${template}${d.comparison ? '<button type="button" class="pc-text-button" data-pc-action="report">Back to saved comparison</button>' : ''}</form>`;
  }

  requestDetailStep(d) {
    const use = requestUses.find(option => option.id === d.requestUse);
    return `<form class="surface form-stack" id="permission-request-detail-form"><div class="eyebrow">Proposed use · 2 of 2</div><h3 class="serif" id="pc-step-heading" tabindex="-1">${esc(use.question)}</h3><p class="helper">Add what you know. If you still need to ask, leave this blank and continue.</p>${field('request-detail',use.detailLabel,d.requestDetails[use.id] || '',{ textarea:true,required:false,placeholder:use.example })}<div class="pc-actions"><button type="button" class="button outline" data-pc-action="request">← Back</button><button type="submit" class="button dark">Compare permissions →</button></div><button type="button" class="pc-text-button" data-pc-save>Save for later</button></form>`;
  }

  report(d) {
    const c = d.comparison;
    if (!c) { d.stage = 'permission'; return this.sourceStep(d); }
    const questions = this.questionsFor(d);
    if (this.sourceChanged(d)) return `<div class="surface"><div class="eyebrow">Source text updated</div><h3 class="serif" id="pc-step-heading" tabindex="-1">Let’s compare the new wording.</h3><p>Your source text differs from the saved comparison. Run a new comparison before reviewing or approving a change.</p><p class="helper pc-space">Previous comparisons and approved offers retain their original text and terms.</p><button type="button" class="button dark full pc-space" data-pc-compare-updated>Compare updated text →</button><button type="button" class="pc-text-button" data-pc-action="permission">Review my source text</button></div>`;
    const labels = { changed:'Possible change',consistent:'Appears aligned',unclear:'Needs review' };
    return `<div class="surface pc-report-intro"><div class="evidence-head"><div class="eyebrow">Your comparison</div><span class="tag ${c.aiMode === 'ollama' ? '' : 'neutral'}">${c.aiMode === 'ollama' ? 'AI comparison' : 'Manual review · AI unavailable'}</span></div><h3 class="serif" id="pc-step-heading" tabindex="-1">See what may be changing.</h3><p>${esc(c.summary)}</p><p class="helper pc-space">Read the supporting passages before deciding. This comparison does not decide infringement or replace your judgment about the agreement.</p><button type="button" class="pc-text-button" data-pc-action="permission">Edit source text & compare again</button></div>${(c.warnings || []).length ? `<div class="status-box warn pc-space"><strong>Some details need your review</strong>${c.warnings.map(esc).join(' ')}</div>` : ''}<div class="pc-findings">${(c.findings || []).map(f => `<article class="surface pc-finding"><div class="evidence-head"><h4>${esc(f.label || dimensions.find(([key]) => key === f.dimension)?.[1] || 'Scope detail')}</h4><span class="tag ${f.assessment === 'changed' || f.assessment === 'unclear' ? 'warn' : 'neutral'}">${esc(labels[f.assessment] || labels.unclear)}</span></div><div class="pc-evidence"><div><h5>Existing permission</h5>${f.baselineQuote ? `<blockquote>${esc(f.baselineQuote)}</blockquote>` : '<p class="helper">No supporting passage found in the existing permission.</p>'}</div><div><h5>Proposed use</h5>${f.requestQuote ? `<blockquote>${esc(f.requestQuote)}</blockquote>` : '<p class="helper">No supporting passage found in the proposed use.</p>'}</div></div><p class="helper">${esc(f.explanation)}</p>${d.answers[f.dimension] ? `<p class="pc-clarified"><strong>Your clarification:</strong> ${esc(d.answers[f.dimension])}</p>` : ''}</article>`).join('')}</div>${d.practice && d.practiceTranslationReviewed ? `<div class="surface pc-space pc-translation-record"><div class="eyebrow">Your decision</div><h3 class="serif">Translation permission</h3><p class="helper">${esc(d.practiceTranslation)}</p><p class="helper pc-space">This came from your decision. It will appear under Additional conditions for you to review before the preview.</p></div>` : ''}${questions.length ? `<div class="surface pc-space"><div class="eyebrow">${d.practice && !d.practiceTranslationReviewed ? 'A creator decision' : 'A little clarification'}</div><h3 class="serif">${questions.length} ${questions.length === 1 ? 'detail' : 'details'} to work through.</h3><p class="helper">${d.practice && !d.practiceTranslationReviewed ? 'The campaign dates and audience are set. Read the studio’s reply and decide whether to allow a Spanish translation.' : 'You can answer one at a time, skip anything, and return when you know more. An offer can be prepared once the scope is clear.'}</p><div class="pc-question-links">${questions.map(q => `<button type="button" data-pc-question="${esc(q.id)}">${this.answerFor(d,q.id) ? '✓' : '○'} ${esc(questionLabel(q.id))} <span>›</span></button>`).join('')}</div><button type="button" class="button dark full pc-space" data-pc-action="questions">Work through the details →</button>${questions.some(q => this.answerFor(d,q.id)?.trim()) ? '<button type="button" class="button outline full pc-space" data-pc-action="answers">Review my answers</button>' : ''}</div>` : ''}<div class="surface pc-space"><h3 class="serif">You choose the permission and fee.</h3>${c.status === 'ready_for_review' && !(d.practice && !d.practiceTranslationReviewed) ? `<p class="helper">The scope has enough detail for your review. You can edit every proposed term before sharing.</p><button type="button" class="button dark full pc-space" data-pc-action="terms">Review proposed change →</button>` : `<p class="helper">${d.practice && !d.practiceTranslationReviewed ? 'Work through the translation choice above before reviewing the proposed terms.' : 'Clarify the missing scope above before preparing a buyer offer. You can save and come back at any time.'}</p>`}<button type="button" class="pc-text-button" data-pc-save>Save for later</button></div>`;
  }

  questionStep(d) {
    const questions = this.questionsFor(d);
    const q = questions[d.questionIndex];
    if (!q) return this.answerReview(d);
    const practiceAnswer = d.practice && practiceAnswerFor(d,q.id);
    return `<form class="surface form-stack" id="permission-answer-form" data-pc-question-id="${esc(q.id)}"><div class="eyebrow">Question ${d.questionIndex + 1} of ${questions.length}</div><h3 class="serif" id="pc-step-heading" tabindex="-1">${esc(q.prompt)}</h3><p class="helper">${esc(q.help || 'Use your own words. You can leave this for later.')}</p>${q.id !== 'translation' && practiceAnswer ? `<details class="pc-practice-hint"><summary>Review the suggested wording</summary><p class="helper">Consider this wording: <strong>${esc(practiceAnswer)}</strong></p><button type="button" class="button light full" data-pc-practice-answer>Use this wording</button><p class="helper">You can edit this wording before continuing.</p></details>` : ''}${d.practice && q.id === 'translation' ? `<div class="pc-studio-reply" role="note" tabindex="-1"><div class="eyebrow">Studio reply</div><p>“Could we use a Spanish translation of the text included in your work for this campaign? We can send it for your review and written approval before publication.”</p></div><div class="pc-translation-choices"><p class="helper"><strong>Your choice:</strong> allow this language with approval, keep the original language, or ask for help. Reading the reply does not grant permission.</p><button type="button" class="button light full" data-pc-practice-answer aria-pressed="${d.practiceTranslation === practiceAnswers.translation}">Allow Spanish, with my written approval</button><button type="button" class="button outline full" data-pc-translation-decline aria-pressed="${d.practiceTranslation === translationDecline}">Keep the original language only</button></div>` : ''}${field('answer',q.id === 'translation' ? 'Your translation decision' : 'Your clarification',this.answerFor(d,q.id) || '',{ textarea:true,rows:q.id === 'translation' ? 5 : 3,max:500,required:false,hidden:q.id === 'translation' && !d.practiceTranslation,placeholder:'Answer what you know…' })}<div class="pc-actions" ${q.id === 'translation' && !d.practiceTranslation ? 'hidden' : ''}><button type="button" class="button outline" data-pc-question-back>← Back</button><button type="submit" class="button dark">${d.questionIndex === questions.length - 1 ? 'Review answers →' : 'Next →'}</button></div><button type="button" class="pc-text-button" data-pc-question-skip>Come back to this</button><button type="button" class="pc-text-button" data-pc-help>Find help with this question</button><button type="button" class="pc-text-button" data-pc-save>Save for later</button></form>`;
  }

  answerReview(d) {
    const questions = this.questionsFor(d);
    return `<div class="surface"><div class="eyebrow">Your clarifications</div><h3 class="serif" id="pc-step-heading" tabindex="-1">Review at your pace.</h3><div class="pc-question-links">${questions.map(q => `<button type="button" data-pc-question="${esc(q.id)}"><span><strong>${esc(questionLabel(q.id))}</strong><small>${esc(this.answerFor(d,q.id) || 'Left for later')}</small></span><span>Edit ›</span></button>`).join('')}</div><p class="helper pc-space">${d.practice && !(d.comparison?.questions || []).length ? 'Save your translation decision to carry it into the additional conditions. If you leave it open, return before preparing terms.' : 'Applying these answers creates a new comparison record. Existing offers retain their approved terms.'}</p><button type="button" class="button dark full pc-space" data-pc-apply-answers>${d.practice && !(d.comparison?.questions || []).length ? 'Save translation decision →' : 'Update comparison →'}</button><button type="button" class="pc-text-button" data-pc-action="report">Back to comparison</button><button type="button" class="pc-text-button" data-pc-save>Save for later</button></div>`;
  }

  termsStep(d) {
    const t = d.terms;
    return `<form class="surface form-stack" id="permission-terms-form"><div class="eyebrow">Creator review</div><h3 class="serif" id="pc-step-heading" tabindex="-1">Make the change yours.</h3><p class="helper">${d.practice ? 'Your translation decision is included under Additional conditions. Review that condition, the campaign limits, and the fee.' : 'Edit the additional permission you are willing to grant. Set your own fee. Only these reviewed terms and your licensor name will appear in the buyer link.'}</p>${field('licensorName','Your name or business',t.licensorName,{ max:100,min:2 })}${dimensions.map(([key,label]) => field(key,label,t[key],{ textarea:true,max:500 })).join('')}${field('conditions','Additional conditions',t.conditions,{ textarea:true,max:500,required:false,placeholder:'For example: attribution, placement limits, or start date.' })}${field('amount','Fee for this change (USD)',t.amount,{ type:'number',max:12,help:d.practice ? 'This fee appears in the preview.' : 'You set this price. The AI does not decide the value of your rights.' })}<label class="radio-option"><input type="checkbox" name="baselineConfirmed" ${t.baselineConfirmed ? 'checked' : ''} required/><span>${d.practice ? 'I have checked the original permission.' : 'I have checked the existing permission and can grant this change.'}</span></label><label class="radio-option"><input type="checkbox" name="changesReviewed" ${t.changesReviewed ? 'checked' : ''} required/><span>I have reviewed these additional permissions and the fee.</span></label><div class="pc-actions"><button type="button" class="button outline" data-pc-action="report">← Back</button><button type="submit" class="button dark">${d.practice ? 'Preview permission →' : 'Preview buyer offer →'}</button></div><button type="button" class="pc-text-button" data-pc-save>Save for later</button></form>`;
  }

  previewStep(d,item) {
    return `<div class="surface" id="pc-offer-preview"><div class="eyebrow">${d.practice ? 'Permission preview · no payment' : 'What the buyer will see'}</div><h3 class="serif" id="pc-step-heading" tabindex="-1">${esc(permissionCaseTitle(item))}</h3><p class="pc-preview-price">${money(d.terms.amount)} <small>${d.practice ? 'USD · preview only' : 'USD · additional permission'}</small></p>${permissionChangeTerms(d.terms)}<p class="helper pc-space"><strong>Creator / licensor:</strong> ${esc(d.terms.licensorName)}</p><div class="status-box pc-space"><strong>${d.practice ? 'Review before sharing' : 'Additional permission only'}</strong>${d.practice ? 'This review ends at the preview. Start a permission review with your records to create a buyer link.' : 'The approved change starts after a verified PayPal Sandbox payment. It does not transfer copyright, settle past claims, or replace unrelated terms of the original permission.'}</div><p class="helper pc-space">${d.practice ? 'Finish the review to see the steps for sharing an offer.' : 'Your original permission, private request, and comparison passages stay in this case. Approving creates a buyer link; no one is contacted automatically.'}</p><div class="pc-actions pc-space"><button type="button" class="button outline" data-pc-action="terms">Edit terms</button><button type="button" class="button dark" data-pc-approve>${d.practice ? 'Finish review' : 'Approve & create link'}</button></div></div>`;
  }

  practiceComplete(d) {
    return `<div class="surface" id="pc-practice-complete"><div class="eyebrow">Review complete</div><h3 class="serif" id="pc-step-heading" tabindex="-1">You reviewed the proposed change.</h3><p>You started with the agreement, checked the studio’s proposal, chose how translations could be handled, and reviewed that condition with the campaign limits and fee. You can leave questions open and seek help before deciding.</p><div class="status-box pc-space"><strong>No payment was created</strong>This review ends at the preview.</div><h4 class="pc-space">Your next choice</h4><p class="helper pc-space">Start your own review when you have the relevant records. If something is unclear, keep it open and use the legal and technical resources below.</p><h4 class="pc-space">When both sides are ready</h4><ol class="helper pc-space"><li>You approve the exact terms and fee.</li><li>You share the buyer link yourself.</li><li>The buyer accepts the terms and completes PayPal Sandbox checkout.</li><li>A verified payment creates a receipt saved with the approved change in Records.</li></ol><p class="helper pc-space">PayPal Sandbox uses test funds.</p><button type="button" class="button dark full pc-space" data-pc-start-own>Start my own review →</button><div class="pc-actions"><button type="button" class="pc-text-button" data-pc-action="report">Revisit the comparison</button><button type="button" class="pc-text-button" data-pc-practice-replay>Review again</button></div></div>`;
  }

  handleInput(event) {
    if (event.target.closest('#permission-case-form')) {
      if (event.target.name === 'new-title') this.newCase.title = event.target.value;
      if (event.target.name === 'workType') this.newCase.workType = event.target.value;
      this.persistNew(); return;
    }
    const flow = event.target.closest('#permission-flow');
    if (!flow) return;
    const d = this.ensure(flow.dataset.pcCase);
    const { name,value,type,checked } = event.target;
    const importKey = sourceImportKey(d.caseId,d.stage);
    if (event.target.id === 'pc-source-document' && sourceImport[d.stage]) {
      const entry = this.sourceImports.get(importKey);
      if (entry?.pending) return;
      if (entry?.documentId !== value) this.sourceImports.set(importKey,{ documentId:value });
      this.updateSourceImport(flow,d);
      return;
    }
    if (['permissionText','requestText'].includes(name)) {
      if (name === sourceImport[d.stage]?.field && d[name] !== value) {
        const entry = this.sourceImports.get(importKey);
        if (entry?.pending) entry.edited = true;
      }
      if (name === 'requestText' && d.requestText !== value) {
        d.requestUse = '';
        flow.querySelector?.('#pc-request-detail-summary')?.remove();
        flow.querySelector?.('#pc-request-choices [aria-pressed="true"]')?.setAttribute('aria-pressed','false');
      }
      d[name] = value; d.touched = true;
      if (this.sourceChanged(d)) d.terms = {};
    }
    if (name === 'request-detail' && d.stage === 'request-detail') {
      d.requestDetails[d.requestUse] = value;
      if (this.sourceChanged(d)) d.terms = {};
    }
    if (name === 'answer') {
      const q = this.questionsFor(d)[d.questionIndex];
      if (q) this.setAnswer(d,q.id,value);
    }
    if (event.target.closest('#permission-terms-form') && name) d.terms[name] = type === 'checkbox' ? checked : value;
    this.persist(d);
  }

  handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-pc-example-title')) {
      const title = button.form?.querySelector('#pc-new-title');
      if (title) {
        this.newCase.title = title.value = photoExample.title;
        this.newCase.workType = 'photograph';
        this.persistNew();
        title.focus();
      }
      return;
    }
    if (button.hasAttribute('data-pc-new-back')) { this.newCase.step = 0; this.persistNew(); this.refresh('#pc-new-heading'); return; }
    const flow = button.closest('#permission-flow');
    if (!flow) return;
    const d = this.ensure(flow.dataset.pcCase);
    if (d.busy) return;
    if (button.hasAttribute('data-pc-source-example') && (d.stage === 'permission' || d.stage === 'request')) {
      const first = d.stage === 'permission';
      const example = sourceExampleFor(d);
      if (this.fillSourceField(flow,first ? 'permissionText' : 'requestText',example)) {
        this.announce(`Example added. You can edit it in ${first ? 'Existing permission' : 'Proposed use'}.`);
      }
      return;
    }
    if (button.hasAttribute('data-pc-save-agreed-terms') && d.stage === 'permission') {
      this.saveAgreedTerms(d,button);
      return;
    }
    if (button.hasAttribute('data-pc-use-agreed-terms') && d.stage === 'permission') {
      const terms = this.agreedTerms.get(d.caseId)?.text;
      if (terms && this.fillSourceField(flow,'permissionText',terms)) this.announce('Saved wording added to Existing permission.');
      return;
    }
    if (button.hasAttribute('data-pc-extract-source')) {
      this.extractSource(d,flow);
      return;
    }
    if (button.hasAttribute('data-pc-fill-source') && sourceImport[d.stage] && !d.practice) {
      const entry = this.sourceImports.get(sourceImportKey(d.caseId,d.stage));
      if (entry?.text) {
        entry.filled = this.fillSourceField(flow,sourceImport[d.stage].field,entry.text);
        this.updateSourceImport(flow,d);
      }
      return;
    }
    if (button.dataset.pcRequestUse && d.stage === 'request') {
      const use = requestUses.find(option => option.id === button.dataset.pcRequestUse);
      if (!use && (button.dataset.pcRequestUse !== 'other' || d.practice)) return;
      const existing = d.requestText.trim();
      const example = d.practice || requestUses.some(option => existing === requestSentence(option,true));
      if (!existing || requestUses.some(option => existing === requestSentence(option,example))) {
        const requestText = use ? requestSentence(use,example) : '';
        if (existing !== requestText) Object.assign(d,{ requestText,terms:{},touched:true });
      }
      d.requestUse = use?.id || '';
      if (use) this.go(d,'request-detail');
      else { this.persist(d); this.refresh('#pc-requestText'); this.announce('Describe the proposed use in your own words.'); }
      return;
    }
    if (button.hasAttribute('data-pc-start-own')) {
      this.persist(d);
      document.dispatchEvent(new CustomEvent('rights-desk-start-own-review',{detail:{fromCaseId:d.caseId}}));
      return;
    }
    if (button.hasAttribute('data-pc-practice-replay')) {
      if (this.practiceCases.get(d.caseId) !== true) return;
      this.resetPractice(d);
      this.refresh();
      document.dispatchEvent(new CustomEvent('rights-desk-practice-replay',{detail:{caseId:d.caseId}}));
      return;
    }
    if (button.hasAttribute('data-pc-help')) {
      this.persist(d);
      document.dispatchEvent(new CustomEvent('rights-desk-permission-help'));
      return;
    }
    if (button.hasAttribute('data-pc-practice-answer')) {
      const q = this.questionsFor(d)[d.questionIndex];
      const answer = q && practiceAnswerFor(d,q.id);
      if (this.practiceCases.get(d.caseId) !== true || !answer) return;
      this.setAnswer(d,q.id,answer);
      this.persist(d);
      this.refresh('#pc-answer');
      this.announce('Wording added. You can edit it before continuing.');
      return;
    }
    if (button.hasAttribute('data-pc-translation-decline')) {
      if (this.practiceCases.get(d.caseId) !== true) return;
      this.setAnswer(d,'translation',translationDecline);
      this.persist(d); this.refresh('#pc-answer');
      this.announce('Original-language-only condition added. Review it before continuing.');
      return;
    }
    if (button.hasAttribute('data-pc-save')) {
      this.persist(d);
      document.dispatchEvent(new CustomEvent('rights-desk-pause-permission-guide'));
      this.announce(d.storageFailed ? 'Browser storage is unavailable. Keep this page open and copy your unfinished text.' : 'Saved for later. Return to this case whenever you are ready.');
      return;
    }
    if (button.hasAttribute('data-pc-sample')) {
      const { permissionText, requestText } = photoExample;
      Object.assign(d,{ permissionText,requestText,requestUse:'',requestDetails:{},answers:{},practiceTranslation:'',practiceTranslationReviewed:false,practiceTranslationDeferred:false,comparison:null,terms:{},stage:'permission',touched:true });
      this.persist(d);
      this.refresh('#pc-permissionText');
      this.announce('Agreement and request loaded. Check both before comparing.');
      return;
    }
    if (button.dataset.pcRecord) { const record = (this.records.get(d.caseId) || []).find(r => r.id === button.dataset.pcRecord); if (record) { this.adopt(d,record); this.refresh(); } return; }
    if (button.dataset.pcQuestion) { d.questionIndex = Math.max(0,this.questionsFor(d).findIndex(q => q.id === button.dataset.pcQuestion)); this.go(d,'question'); return; }
    if (button.hasAttribute('data-pc-question-back')) { if (d.questionIndex > 0) { d.questionIndex--; this.go(d,'question'); } else this.go(d,'report'); return; }
    if (button.hasAttribute('data-pc-question-skip')) { if (this.questionsFor(d)[d.questionIndex]?.id === 'translation') d.practiceTranslationDeferred = true; this.advanceQuestion(d); return; }
    if (button.hasAttribute('data-pc-apply-answers')) {
      if (d.practice && !(d.comparison?.questions || []).length) {
        d.practiceTranslationReviewed = Boolean(d.practiceTranslation.trim()) && !d.practiceTranslationDeferred;
        d.terms = {}; this.go(d,'report');
        this.announce(d.practiceTranslationReviewed ? 'Translation decision saved for the proposed terms.' : 'Translation permission is still open. You can return when ready.');
      } else this.compare(d);
      return;
    }
    if (button.hasAttribute('data-pc-compare-updated')) { this.compare(d); return; }
    if (button.hasAttribute('data-pc-approve')) { this.approve(d); return; }
    const action = button.dataset.pcAction;
    if (!action) return;
    if (action === 'questions') { d.questionIndex = 0; this.go(d,'question'); return; }
    if (action === 'terms') {
      if (d.comparison?.status !== 'ready_for_review' || this.sourceChanged(d) || (d.practice && !d.practiceTranslationReviewed)) { this.go(d,'report'); return; }
      if (!d.terms.purpose) d.terms = { ...(d.comparison.proposedChange || {}),licensorName:d.practice ? 'Creator' : '',amount:d.practice ? '25.00' : '',conditions:d.practice ? d.practiceTranslation : '',baselineConfirmed:false,changesReviewed:false };
    }
    if (stages.has(action)) this.go(d,action);
  }

  handleSubmit(event) {
    const form = event.target;
    if (form.id === 'permission-case-form') { event.preventDefault(); this.createCase(form); return; }
    const flow = form.closest('#permission-flow');
    if (!flow) return;
    const d = this.ensure(flow.dataset.pcCase);
    if (form.id === 'permission-source-form') {
      event.preventDefault(); if (!form.reportValidity()) return;
      const sourceKey = d.stage === 'permission' ? 'permissionText' : 'requestText';
      d[sourceKey] = String(new FormData(form).get(sourceKey) || ''); d.touched = true;
      if (d.stage === 'permission') this.go(d,'request'); else this.compare(d);
    }
    if (form.id === 'permission-request-detail-form' && d.stage === 'request-detail') {
      event.preventDefault(); if (!form.reportValidity()) return;
      d.requestDetails[d.requestUse] = String(new FormData(form).get('request-detail') || '').trim();
      this.compare(d);
    }
    if (form.id === 'permission-answer-form') {
      event.preventDefault(); const question = this.questionsFor(d)[d.questionIndex];
      if (question) this.setAnswer(d,question.id,String(new FormData(form).get('answer') || ''));
      this.advanceQuestion(d);
    }
    if (form.id === 'permission-terms-form') {
      event.preventDefault(); if (!form.reportValidity()) return;
      const data = new FormData(form);
      for (const key of ['licensorName','amount','purpose','channels','duration','territory','conditions']) d.terms[key] = String(data.get(key) || '');
      d.terms.baselineConfirmed = data.get('baselineConfirmed') === 'on';
      d.terms.changesReviewed = data.get('changesReviewed') === 'on';
      this.go(d,'preview');
    }
  }
  advanceQuestion(d) { d.questionIndex++; this.go(d,d.questionIndex >= this.questionsFor(d).length ? 'answers' : 'question'); }

  async createCase(form) {
    const d = this.newCase;
    if (d.busy || !form.reportValidity()) return;
    const data = new FormData(form);
    if (!d.step) { d.title = String(data.get('new-title') || '').trim(); d.step = 1; this.persistNew(); this.refresh('#pc-new-heading'); return; }
    d.workType = String(data.get('workType') || 'photograph');
    d.busy = true; d.error = ''; this.refresh('#pc-new-heading');
    try {
      const item = await this.jsonPost('/api/permission-cases',{ title:d.title.trim(),workType:d.workType });
      d.busy = false; d.title = ''; d.step = 0; this.persistNew();
      this.ensure(item.id); this.onCase(item); this.refresh();
      this.announce('Your private review is ready. Start with the existing permission.');
    } catch (error) { d.busy = false; d.error = error.message; this.refresh('#pc-new-heading'); }
  }

  async compare(d) {
    if (d.busy) return;
    const requestText = proposedRequest(d);
    if (d.permissionText.trim().length < 12 || d.requestText.trim().length < 12) { d.error = 'Add the existing permission and proposed use, at least a short sentence each.'; this.refresh(); return; }
    if (requestText.length > 4000) { d.error = 'Shorten the proposed use or the added detail to 4,000 characters total.'; this.refresh(); return; }
    const changed = this.sourceChanged(d);
    if (changed) { d.answers = {}; if (d.practice) { d.practiceTranslation = ''; d.practiceTranslationReviewed = false; d.practiceTranslationDeferred = false; } }
    d.busy = 'comparison'; d.error = ''; this.refresh();
    try {
      const record = await this.jsonPost(`/api/cases/${encodeURIComponent(d.caseId)}/permission-comparisons`,{ permissionText:d.permissionText.trim(),requestText,answers:Object.fromEntries(Object.entries(d.answers).filter(([key,value]) => dimensions.some(([id]) => id === key) && value.trim())) });
      if (d.practice) d.practiceTranslationReviewed = Boolean(d.practiceTranslation.trim()) && !d.practiceTranslationDeferred;
      d.comparison = record; d.permissionText = record.permissionText; d.requestText = requestDetailLine(d) ? d.requestText.trim() : record.requestText; d.answers = { ...(record.answers || d.answers) }; d.terms = {}; d.stage = 'report'; d.questionIndex = 0; d.touched = true;
      this.records.set(d.caseId,[record,...(this.records.get(d.caseId) || []).filter(entry => entry.id !== record.id)]);
    } catch (error) { d.error = error.message; }
    d.busy = false; this.persist(d); this.refresh();
  }

  async approve(d) {
    if (d.busy || d.stage !== 'preview') return;
    if (this.sourceChanged(d)) { this.go(d,'report'); return; }
    if (!d.terms.baselineConfirmed || !d.terms.changesReviewed) { this.go(d,'terms'); return; }
    if (this.practiceCases.get(d.caseId) === true) {
      if (!d.practiceTranslationReviewed) { this.go(d,'report'); this.announce('Translation permission is still open. Return to the translation question before finishing.'); return; }
      this.go(d,'practice-complete');
      this.announce('Review complete. The terms are saved in your preview.');
      return;
    }
    const t = d.terms;
    d.busy = 'offer'; d.error = ''; this.refresh();
    try {
      const approvedChange = Object.fromEntries([...dimensions.map(([key]) => key),'conditions'].map(key => [key,String(t[key] || '').trim()]));
      const offer = await this.jsonPost(`/api/cases/${encodeURIComponent(d.caseId)}/permission-comparisons/${encodeURIComponent(d.comparison.id)}/offer`,{ licensorName:t.licensorName.trim(),amount:t.amount,approvedChange,baselineConfirmed:true,changesReviewed:true });
      d.stage = 'complete'; this.onOffer(d.caseId,offer); this.announce('Change approved. Its buyer link and exact terms are below.');
    } catch (error) { d.error = error.message; }
    d.busy = false; this.persist(d); this.refresh(d.stage === 'complete' ? '#case-offers' : '#pc-step-heading');
  }
}
