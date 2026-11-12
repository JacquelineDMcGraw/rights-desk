const SEEN_KEY = 'rights-desk-introduction-seen-v1';
const GUIDE_KEY = 'rights-desk-permission-guide-v1';
const GUIDE_STAGES = new Set(['permission','request','request-detail','report','question','answers','terms','preview','complete','practice-complete']);
const HELP_STAGES = new Set(['report','question','answers']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key,value) => { try { localStorage.setItem(key,value); return true; } catch { return false; } };

const CREATOR_PATHS = [
  {
    id:'own', symbol:'↔', title:'Review a new use',
    text:'A client wants to reuse a photo, illustration, or piece of writing.',
    bring:'The current agreement and the client’s request, such as a contract and an email.',
    outcome:'See what would change, choose your terms and fee, and prepare a buyer link.',
    start:'Start a permission review',
  },
  {
    id:'evidence', symbol:'◎', title:'Document possible misuse',
    text:'You found your work somewhere you weren’t expecting.',
    bring:'An image of your work or a screenshot of the use. You can add supporting records later.',
    outcome:'Create a private case to organize what you find and what you still need to check.',
    start:'Start the evidence tour',
  },
  {
    id:'notes', symbol:'≋', title:'Capture an IP note',
    text:'Save an idea or voice memo for a campaign, even before you create it.',
    bring:'A voice memo from Apple Watch or iPhone, a written note, or both.',
    outcome:'Keep the note in your private inbox, with the option to attach it to a campaign now or later.',
    start:'Start the IP Notes tour',
  },
];

const BUYER_STEPS = [
  {
    eyebrow: 'A clear permission change',
    title: 'Review before you pay.',
    text: 'This offer describes the additional use the creator is willing to allow.',
    body: '<dl class="rd-intro-prep"><div><dt>Check the whole scope</dt><dd>Read the purpose, where the work may appear, duration, audience, conditions, and fee.</dd></div><div><dt>Something needs changing?</dt><dd>Ask the creator for a revised offer before you accept.</dd></div></dl>',
  },
  {
    eyebrow: 'Your approval matters',
    title: 'Accept the terms you reviewed.',
    text: 'Enter the licensee name, review the exact additional permission, and continue to PayPal when you are ready.',
    body: '<div class="rd-intro-callout"><strong>PayPal Sandbox test</strong><p>Use a Personal Sandbox test account as the buyer. Sandbox uses test funds.</p></div><p class="rd-intro-note">The creator’s original records stay private. Only the approved offer and its identifying fingerprints are shared.</p>',
  },
  {
    eyebrow: 'Keep a record',
    title: 'Return for your receipt.',
    text: 'PayPal returns you to Rights Desk. A receipt appears after the payment is verified against this exact offer.',
    body: '<div class="rd-intro-callout"><strong>Save your permission</strong><p>Download the paid permission record for your files. You can also find paid permissions in Records in this browser.</p></div><p class="rd-intro-note">Keep checkout and the return page in the same browser. A canceled or unconfirmed payment does not create a paid permission.</p>',
  },
];

function guideStep(stage,isPractice) {
  const translationReviewed = isPractice && stage === 'report' && Boolean(document.querySelector('.pc-translation-record'));
  const requestDetailTitle = stage === 'request-detail' ? document.querySelector('#permission-request-detail-form #pc-step-heading')?.textContent?.trim() : '';
  const questionForm = stage === 'question' ? document.querySelector('#permission-answer-form') : null;
  const questionTitle = questionForm?.querySelector('#pc-step-heading')?.textContent?.trim() || '';
  const translationQuestion = isPractice && stage === 'question' && (
    ['translation','translations'].includes(questionForm?.dataset.pcQuestionId) || questionTitle === 'Will translations of my work be needed, too?'
  );
  const awaitingTranslationChoice = translationQuestion && !questionForm.querySelector('#pc-answer')?.value.trim();
  return {
    permission: { step:1, title:'Find the starting point.', what:isPractice ? 'You are the creator. The studio has website permission.' : 'Start with the relevant agreement, email, or written permission.', why:'Every proposed change is checked against this wording.', next:isPractice ? 'Read the filled-in agreement, then use Next.' : 'Add the agreed wording, then use Next.', selectors:['#pc-permissionText','#permission-source-form'] },
    request: { step:2, title:isPractice ? 'Choose what the studio wants to do.' : 'Describe the requested use.', what:isPractice ? 'Choose paid social ads or a printed brochure.' : 'Choose a starting point or write the request in your own words.', why:'The proposed use determines which details you review next.', next:'Choose a use for a follow-up question, or compare the wording you entered.', selectors:['#pc-request-choices','#pc-requestText','#permission-source-form'] },
    'request-detail': { step:2, title:requestDetailTitle || 'Clarify the proposed use.', what:'Add any detail you know about the use you chose.', why:'A clear request helps you see what the existing permission covers and what remains open.', next:'This detail is optional. Add what you know, then use Compare permissions.', selectors:['#pc-request-detail','#permission-request-detail-form'] },
    loading: { step:2, title:'Reading the two records.', what:'The comparison looks for supporting words in your records.', why:'Missing details should remain open, rather than be guessed.', next:'Wait for the comparison to appear.', selectors:['.pc-loading'] },
    updating: { step:4, title:'Applying your clarifications.', what:'Your answers are being added to a new comparison.', why:'Earlier comparisons and approved offers keep their terms.', next:'Review the updated evidence when it appears.', selectors:['.pc-loading'] },
    report: { step:translationReviewed ? 4 : 3, title:translationReviewed ? 'Your translation choice is saved.' : 'Check the evidence.', what:translationReviewed ? 'Your decision is separate from the AI comparison.' : 'Each card pairs the agreement with the proposed use.', why:translationReviewed ? 'The same condition will appear in the terms and preview.' : 'AI labels need supporting words and your review.', next:translationReviewed ? 'Review the proposed terms, including Additional conditions.' : 'Check the quotes before deciding what to clarify or allow.', selectors:translationReviewed ? ['.pc-translation-record'] : ['.pc-findings','.pc-report-intro'] },
    question: { step:4, title:translationQuestion ? 'Will translations of my work be needed, too?' : questionTitle || 'Work out one detail.', what:translationQuestion ? awaitingTranslationChoice ? 'The studio asks to translate your text into Spanish.' : 'Your choice is written as a proposed condition.' : isPractice ? 'Use the supplied studio reply to clarify this detail.' : 'Clarify one detail before choosing the terms.', why:translationQuestion ? awaitingTranslationChoice ? 'It offers to get your written approval before publication.' : 'This wording will be included in the terms you review.' : 'Either party may need more information before agreeing.', next:translationQuestion ? awaitingTranslationChoice ? 'Read the studio reply. Choose below, or find help.' : 'Read or edit your condition, then use Next.' : isPractice ? 'Use the guided answer, edit it, or leave this for later.' : 'Answer what you know, or leave this for later.', isTranslationQuestion:translationQuestion,awaitingTranslationChoice,selectors:awaitingTranslationChoice ? ['#permission-answer-form .pc-studio-reply','#pc-step-heading'] : ['#pc-answer','#permission-answer-form'] },
    answers: { step:4, title:'Check your open questions.', what:'These are your draft clarifications.', why:'A question can stay open until you have an answer.', next:'Revisit an answer, or update the comparison.', selectors:['.pc-question-links','#pc-step-heading'] },
    terms: { step:5, title:'Choose what you would allow.', what:isPractice ? 'Review the use, any translation conditions, and a fee.' : 'Set the extra use, its limits, and a fee.', why:isPractice ? 'Your choices appear together in the offer preview.' : 'Only the terms you approve will become the offer.', next:'Edit the terms, review the checkboxes, then preview.', selectors:['#permission-terms-form'] },
    preview: { step:6, title:'See the buyer’s view.', what:'This is the additional permission and fee together.', why:isPractice ? 'This review ends at the offer preview.' : 'The buyer must see the exact permission you intend to grant.', next:isPractice ? 'Check the scope and fee, then finish the review.' : 'Check every term. Edit it, or approve the buyer link.', selectors:['#pc-offer-preview'] },
    complete: { step:7, title:'Share the approved change.', what:'Your approved terms are fixed in the buyer link.', why:'Payment is tied to this exact permission.', next:'Share it yourself. Find the verified paid record in Records.', selectors:['#case-offers'] },
  }[stage] || null;
}

function helpStep(step) {
  return {step,title:'Find the right help.',what:'These resources are for either party’s questions.',why:'A legal professional can help with permission terms. Technical support can help you understand files and formats.',next:'Choose a resource if useful, then return to your review.',selectors:['#permission-flow details.permission-help','details.permission-help']};
}

function displayGuideStage(stage) {
  if (!document.querySelector('#permission-flow .pc-loading')) return stage;
  return ['answers','question','report'].includes(stage) ? 'updating' : 'loading';
}

function place(element,left,top,width,height) {
  if (!element) return;
  Object.assign(element.style,{left:`${Math.round(left)}px`,top:`${Math.round(top)}px`,width:`${Math.max(0,Math.round(width))}px`,height:`${Math.max(0,Math.round(height))}px`});
}

/** A short introduction plus a nonmodal guide that follows the actual review. */
export class RightsDeskOnboarding {
  constructor({onPractice,onOwn,onEvidence,onNotes,onClose} = {}) {
    Object.assign(this,{onClose});
    this.pathActions = { practice:onPractice, own:onOwn, evidence:onEvidence, notes:onNotes };
    this.dialog = null;
    this.previousFocus = null;
    this.audience = 'creator';
    this.step = 0;
    this.path = null;
    this.busy = false;
    this.choiceGeneration = 0;
    this.error = '';
    this.autoConsidered = false;
    this.guide = null;
    this.guideRoot = null;
    this.guideFrame = 0;
    this.guideSignature = '';
    this.context = null;
    this.helpDetour = null;
    try {
      const saved = JSON.parse(read(GUIDE_KEY) || 'null');
      if (saved && typeof saved.caseId === 'string' && /^case_[a-f0-9-]+$/.test(saved.caseId)) {
        this.guide = {caseId:saved.caseId,stage:GUIDE_STAGES.has(saved.stage) ? saved.stage : 'permission',isPractice:Boolean(saved.isPractice),paused:Boolean(saved.paused),spotlight:saved.spotlight !== false};
      }
    } catch { /* A damaged guide preference must not block the desk. */ }
    this.onGuideViewport = () => this.scheduleGuide(false);
    this.onGuideKey = event => {
      if (event.key === 'Escape' && this.guideRoot && !this.isOpen && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        if (this.helpDetour) this.returnFromHelp();
        else this.pauseGuide();
      }
    };
    document.addEventListener('keydown',this.onGuideKey);
    document.addEventListener('rights-desk-permission-help',() => this.openHelp());
    document.addEventListener('toggle',event => {
      if (this.helpDetour && event.target === this.helpDetour.details) {
        if (!event.target.open) this.returnFromHelp();
        else this.scheduleGuide(false);
      }
    },true);
    window.addEventListener('resize',this.onGuideViewport);
    window.addEventListener('scroll',this.onGuideViewport,{passive:true});
    window.visualViewport?.addEventListener('resize',this.onGuideViewport);
    window.visualViewport?.addEventListener('scroll',this.onGuideViewport);
  }

  get isOpen() { return Boolean(this.dialog?.open); }
  get isGuiding() { return Boolean(this.guide && !this.guide.paused); }
  get guideCaseId() { return this.guide?.caseId || null; }

  maybeOffer({hasCases = false,buyerView = false} = {}) {
    if (this.autoConsidered || buyerView) return false;
    this.autoConsidered = true;
    if (hasCases || read(SEEN_KEY) === '1') return false;
    return this.open({audience:'creator'});
  }

  ensureDialog() {
    if (this.dialog) return;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'rights-desk-introduction';
    this.dialog.className = 'rd-intro';
    this.dialog.setAttribute('aria-labelledby','rd-intro-title');
    this.dialog.setAttribute('aria-describedby','rd-intro-description');
    document.body.append(this.dialog);
    this.dialog.addEventListener('click',event => {
      const control = event.target.closest('[data-rd-intro], [data-rd-path]');
      if (!control) return;
      const action = control.dataset.rdIntro;
      const path = CREATOR_PATHS.find(option => option.id === control.dataset.rdPath);
      if (path && !this.busy) { this.path = path; this.error = ''; this.renderIntro(); return; }
      if (!action) return;
      if (action === 'close' || action === 'skip') { this.close(); return; }
      if (this.busy) return;
      if (action === 'back') {
        this.path = null;
        this.error = '';
        this.step = Math.max(0,this.step - 1);
        this.renderIntro();
      }
      else if (action === 'next') { this.step = Math.min(2,this.step + 1); this.renderIntro(); }
      else if (Object.hasOwn(this.pathActions,action)) this.choose(action);
    });
    this.dialog.addEventListener('cancel',event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close',() => {
      document.body.classList.remove('rd-intro-open');
      const previous = this.previousFocus;
      if (this.restoreIntroFocus !== false) {
        const fallback = document.querySelector('[data-open-onboarding]');
        (previous?.isConnected && previous !== document.body ? previous : fallback)?.focus({preventScroll:true});
      }
      this.previousFocus = null;
      this.restoreIntroFocus = true;
      this.onClose?.();
      if (this.context) this.syncGuide(this.context);
    });
  }

  open({audience = 'creator',trigger} = {}) {
    if (this.isOpen || document.querySelector('#case-tour')) return false;
    this.ensureDialog();
    this.audience = audience === 'buyer' ? 'buyer' : 'creator';
    this.step = 0;
    this.path = null;
    this.busy = false;
    this.choiceGeneration++;
    this.error = '';
    this.previousFocus = trigger || document.activeElement;
    this.autoConsidered = true;
    write(SEEN_KEY,'1');
    this.hideGuide();
    this.renderIntro();
    this.dialog.showModal();
    document.body.classList.add('rd-intro-open');
    this.dialog.querySelector('#rd-intro-title')?.focus({preventScroll:true});
    return true;
  }

  renderIntro() {
    if (!this.dialog) return;
    const buyer = this.audience === 'buyer';
    const path = this.path;
    const page = buyer ? BUYER_STEPS[this.step] : path || {
      title:'What do you want to do today?',
      text:'Choose a path and see what you’ll need before you start.',
    };
    const progress = buyer ? `<p class="rd-intro-progress">About this offer · ${this.step + 1} of ${BUYER_STEPS.length}</p><ol class="rd-intro-dots" aria-label="Introduction progress">${BUYER_STEPS.map((_,index) => `<li ${index === this.step ? 'aria-current="step"' : ''}><span class="rd-sr-only">Step ${index + 1}${index === this.step ? ', current' : ''}</span></li>`).join('')}</ol>` : '';
    const practice = '<button type="button" class="rd-intro-example" data-rd-intro="practice">Try an example →</button>';
    const content = buyer ? page.body : path
      ? `<dl class="rd-intro-prep"><div><dt>What you’ll need</dt><dd>${esc(path.bring)}</dd></div><div><dt>What you’ll do</dt><dd>${esc(path.outcome)}</dd></div></dl><button type="button" class="button dark full rd-intro-start" data-rd-intro="${path.id}">${esc(path.start)} →</button>${path.id === 'own' ? practice : ''}`
      : `<div class="rd-intro-choices">${CREATOR_PATHS.map(option => `<button type="button" class="rd-intro-choice" data-rd-path="${option.id}"><span class="rd-choice-symbol" aria-hidden="true">${option.symbol}</span><span><strong>${esc(option.title)}</strong><small>${esc(option.text)}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div>${practice}`;
    const next = buyer
      ? this.step === BUYER_STEPS.length - 1
        ? '<button type="button" class="button dark rd-intro-next" data-rd-intro="close">Back to offer</button>'
        : '<button type="button" class="button dark rd-intro-next" data-rd-intro="next">Next →</button>'
      : '';
    this.dialog.innerHTML = `
      <div class="rd-intro-header"><span class="rd-intro-brand"><span aria-hidden="true">r.</span> rights desk</span><button type="button" class="rd-intro-close" data-rd-intro="close" aria-label="Close introduction">×</button></div>
      <div class="rd-intro-body">${progress}<p class="rd-intro-eyebrow">${esc(page.eyebrow || 'Guided tour')}</p>
        <h2 id="rd-intro-title" tabindex="-1">${esc(page.title)}</h2><p id="rd-intro-description" class="rd-intro-description">${esc(page.text)}</p>${content}
        ${this.error ? `<p class="rd-intro-error" role="status">${esc(this.error)}</p>` : ''}${this.busy ? '<p class="rd-intro-status" role="status">Opening your selection…</p>' : ''}</div>
      <div class="rd-intro-footer"><div class="rd-intro-secondary">${this.step || path ? '<button type="button" class="rd-intro-back" data-rd-intro="back">← Back</button>' : ''}<button type="button" class="rd-intro-skip" data-rd-intro="skip">${buyer ? 'Close guide' : 'Skip tour'}</button></div>${next}</div>`;
    this.dialog.querySelector('.rd-intro-body').scrollTop = 0;
    if (this.dialog.open) this.dialog.querySelector('#rd-intro-title')?.focus({preventScroll:true});
    if (this.busy) this.dialog.querySelectorAll('button:not([data-rd-intro="close"]):not([data-rd-intro="skip"])').forEach(button => { button.disabled = true; });
  }

  close({restoreFocus = true} = {}) {
    if (!this.isOpen) return;
    this.choiceGeneration++;
    this.restoreIntroFocus = restoreFocus;
    this.dialog.close();
  }

  async choose(action) {
    if (this.busy || this.audience === 'buyer') return;
    const callback = this.pathActions[action];
    if (typeof callback !== 'function') {
      this.error = 'This option is not available yet. Close the introduction and start from My desk.';
      this.renderIntro();
      return;
    }
    this.busy = true;
    const generation = ++this.choiceGeneration;
    this.error = '';
    this.renderIntro();
    try {
      const result = await callback();
      if (generation !== this.choiceGeneration || !this.isOpen) return;
      this.busy = false;
      const caseId = typeof result === 'string' ? result : result?.id;
      if (action === 'practice' && (typeof caseId !== 'string' || !/^case_[a-f0-9-]+$/.test(caseId))) {
        this.error = 'Could not open the studio review. Choose Try an example to try again.';
        this.renderIntro();
        return;
      }
      this.close({restoreFocus:false});
      if (action === 'practice' && caseId) this.startGuide(caseId);
    } catch (error) {
      if (generation !== this.choiceGeneration || !this.isOpen) return;
      this.busy = false;
      this.error = typeof error?.message === 'string' ? error.message : 'The review could not be opened. Please try again.';
      this.renderIntro();
    }
  }

  persistGuide() {
    if (!this.guide) return;
    write(GUIDE_KEY,JSON.stringify(this.guide));
  }

  guideContinuation(stage) {
    if (stage === 'request') {
      const selector = '#permission-source-form button[type="submit"]';
      const button = document.querySelector(selector);
      return button && !button.disabled && button.getClientRects().length ? { selector,label:'Compare this request →' } : null;
    }
    if (stage !== 'report') return null;
    for (const [selector,label] of [
      ['#permission-flow [data-pc-action="questions"]','Continue to questions →'],
      ['#permission-flow [data-pc-action="terms"]','Review proposed terms →'],
    ]) {
      const button = document.querySelector(selector);
      if (button && !button.disabled && button.getClientRects().length) return {selector,label};
    }
    return null;
  }

  helpDetails() {
    return document.querySelector('#permission-flow details.permission-help') || document.querySelector('details.permission-help');
  }

  reviewFocusTarget() {
    if (this.context?.stage === 'question') {
      for (const selector of ['#pc-answer','#permission-answer-form .pc-studio-reply','#pc-step-heading']) {
        const target = document.querySelector(selector);
        if (target?.getClientRects().length) return target;
      }
    }
    return document.querySelector('#pc-step-heading') || document.activeElement;
  }

  /** Open the real resources without changing or submitting the current form. */
  openHelp() {
    const details = this.helpDetails();
    if (!details || this.isOpen || document.querySelector('dialog[open]')) return false;
    const canGuide = this.isGuiding && this.guide.caseId === this.context?.caseId && HELP_STAGES.has(this.context?.stage);
    if (canGuide && !this.helpDetour) {
      const target = this.reviewFocusTarget();
      this.helpDetour = {
        caseId:this.context.caseId,stage:this.context.stage,questionIndex:this.context.questionIndex,
        details,wasOpen:details.open,returnTarget:target,
        selectionStart:target?.selectionStart,selectionEnd:target?.selectionEnd,
        selectionDirection:target?.selectionDirection,
        scrollX:window.scrollX,scrollY:window.scrollY,
      };
    }
    details.open = true;
    if (canGuide) {
      this.syncGuide(this.context);
      details.querySelector('summary')?.focus({preventScroll:true});
      this.scheduleGuide(true);
    } else {
      details.scrollIntoView({block:'start',behavior:'instant'});
      details.querySelector('summary')?.focus({preventScroll:true});
    }
    return true;
  }

  clearHelp({closeDetails = true} = {}) {
    const detour = this.helpDetour;
    this.helpDetour = null;
    if (detour && closeDetails && !detour.wasOpen && detour.details.isConnected) detour.details.open = false;
    return detour;
  }

  returnFromHelp() {
    const detour = this.clearHelp();
    if (!detour) return false;
    this.guideSignature = '';
    this.syncGuide(this.context);
    const target = detour.returnTarget?.isConnected && detour.returnTarget.getClientRects().length ? detour.returnTarget : this.reviewFocusTarget();
    window.scrollTo({left:detour.scrollX,top:detour.scrollY,behavior:'instant'});
    target?.focus({preventScroll:true});
    if (target && typeof detour.selectionStart === 'number' && typeof target.setSelectionRange === 'function') {
      target.setSelectionRange(detour.selectionStart,detour.selectionEnd,detour.selectionDirection);
    }
    this.scheduleGuide(true,true);
    return true;
  }

  startGuide(caseId) {
    if (typeof caseId !== 'string' || !/^case_[a-f0-9-]+$/.test(caseId)) return false;
    this.clearHelp();
    if (this.guide?.caseId === caseId) this.guide.paused = false;
    else this.guide = {caseId,stage:'permission',isPractice:false,paused:false,spotlight:true};
    this.guideSignature = '';
    this.persistGuide();
    if (this.context?.caseId === caseId) this.syncGuide(this.context);
    return true;
  }

  pauseGuide() {
    if (this.guide) { this.guide.paused = true; this.persistGuide(); }
    this.clearHelp({closeDetails:false});
    this.hideGuide();
  }

  hideGuide() {
    cancelAnimationFrame(this.guideFrame);
    this.guideScrollRequested = false;
    this.guideForceScrollRequested = false;
    this.guideRoot?.remove();
    this.guideRoot = null;
    this.guideSignature = '';
    document.body.classList.remove('rd-guide-active');
    document.body.style.removeProperty('--rd-guide-reserve');
    document.body.style.removeProperty('--rd-guide-field-max');
  }

  syncGuide(context = {}) {
    const {caseId,stage,isPractice = false,busy = false,questionIndex = 0} = context || {};
    this.context = {caseId,stage,isPractice,busy,questionIndex};
    if (this.helpDetour && (caseId !== this.helpDetour.caseId || stage !== this.helpDetour.stage || questionIndex !== this.helpDetour.questionIndex || busy)) this.clearHelp();
    if (!this.guide || this.guide.paused || this.guide.caseId !== caseId || this.isOpen || document.querySelector('#case-tour') || document.querySelector('dialog[open]')) {
      this.hideGuide();
      return;
    }
    const normalizedStage = stage === 'practice_complete' ? 'practice-complete' : stage;
    if (normalizedStage === 'practice-complete' || (isPractice && normalizedStage === 'complete')) {
      this.guide.stage = 'practice-complete';
      this.pauseGuide();
      return;
    }
    this.guide.stage = GUIDE_STAGES.has(normalizedStage) ? normalizedStage : 'permission';
    this.guide.isPractice = Boolean(isPractice);
    this.persistGuide();
    if (!document.querySelector('#permission-flow')) { this.hideGuide(); return; }
    const displayStage = displayGuideStage(this.guide.stage);
    if (this.helpDetour && !this.helpDetour.details.isConnected) {
      const details = this.helpDetails();
      if (details) { this.helpDetour.details = details; details.open = true; }
      else this.clearHelp();
    }
    const baseInfo = guideStep(displayStage,this.guide.isPractice);
    const helpMode = Boolean(this.helpDetour);
    const info = helpMode && baseInfo ? helpStep(baseInfo.step) : baseInfo;
    if (!info) { this.hideGuide(); return; }
    const continuation = helpMode ? null : this.guideContinuation(displayStage);
    const translationMode = !helpMode && Boolean(baseInfo?.isTranslationQuestion);
    const awaitingChoice = translationMode && Boolean(baseInfo?.awaitingTranslationChoice);
    const helpAvailable = !helpMode && HELP_STAGES.has(displayStage) && Boolean(this.helpDetails());
    const hintAvailable = !helpMode && isPractice && displayStage === 'question' && (!translationMode || awaitingChoice) && Boolean(document.querySelector('#permission-answer-form [data-pc-practice-answer]'));
    const declineAvailable = awaitingChoice && Boolean(document.querySelector('#permission-answer-form [data-pc-translation-decline]'));
    const skipAvailable = !helpMode && displayStage === 'question' && Boolean(document.querySelector('#permission-answer-form [data-pc-question-skip]'));
    const saveAvailable = Boolean(document.querySelector('#permission-flow [data-pc-save]:not(:disabled)'));
    const signature = `${caseId}:${displayStage}:${questionIndex}:${info.title}:${Boolean(isPractice)}:${this.guide.spotlight}:${continuation?.selector || ''}:${helpMode}:${helpAvailable}:${hintAvailable}:${declineAvailable}:${skipAvailable}:${saveAvailable}:${awaitingChoice}`;
    const changed = signature !== this.guideSignature || !this.guideRoot;
    if (!this.guideRoot) {
      this.guideRoot = document.createElement('div');
      this.guideRoot.id = 'permission-guide';
      this.guideRoot.className = 'rd-guide';
      document.body.append(this.guideRoot);
      this.guideRoot.addEventListener('click',event => {
        const action = event.target.closest('[data-rd-guide]')?.dataset.rdGuide;
        if (action === 'pause') {
          document.querySelector('#permission-flow [data-pc-save]:not(:disabled)')?.click();
          this.pauseGuide();
        }
        if (action === 'help') this.openHelp();
        if (action === 'return') this.returnFromHelp();
        if (action === 'hint' && this.guide?.isPractice && this.context?.stage === 'question') {
          document.querySelector('#permission-answer-form [data-pc-practice-answer]')?.click();
          this.scheduleGuide(true,true);
        }
        if (action === 'decline' && this.guide?.isPractice && this.context?.stage === 'question') {
          document.querySelector('#permission-answer-form [data-pc-translation-decline]')?.click();
          this.scheduleGuide(true,true);
        }
        if (action === 'skip' && this.context?.stage === 'question') {
          document.querySelector('#permission-answer-form [data-pc-question-skip]')?.click();
          this.scheduleGuide(true,true);
        }
        if (action === 'continue') {
          const next = this.guideContinuation(this.guide?.stage);
          if (next) document.querySelector(next.selector)?.click();
        }
        if (action === 'spotlight' && this.guide) {
          this.guide.spotlight = !this.guide.spotlight;
          this.persistGuide();
          this.syncGuide(this.context);
        }
      });
    }
    if (changed) {
      const primaryAction = helpMode ? '<button type="button" class="rd-guide-continue" data-rd-guide="return">← Back to my review</button>' : continuation ? `<button type="button" class="rd-guide-continue" data-rd-guide="continue">${esc(continuation.label)}</button>` : hintAvailable ? `<button type="button" class="rd-guide-continue" data-rd-guide="hint">${translationMode ? 'Allow Spanish with approval' : 'Use the guided answer'}</button>` : '';
      const declineAction = declineAvailable ? '<button type="button" class="rd-guide-defer" data-rd-guide="decline">Keep original language</button>' : '';
      const helpAction = helpAvailable ? '<button type="button" class="rd-guide-help" data-rd-guide="help">Find help with this question ↗</button>' : '';
      const skipAction = skipAvailable ? '<button type="button" class="rd-guide-defer" data-rd-guide="skip">Leave for later</button>' : '';
      this.guideRoot.innerHTML = `<div class="rd-guide-fog rd-guide-top" aria-hidden="true"></div><div class="rd-guide-fog rd-guide-left" aria-hidden="true"></div><div class="rd-guide-fog rd-guide-right" aria-hidden="true"></div><div class="rd-guide-fog rd-guide-bottom" aria-hidden="true"></div><div class="rd-guide-ring" aria-hidden="true"></div><section class="rd-guide-card" role="region" aria-label="${helpMode ? 'Resources for this review step' : 'Review help'}"><div class="rd-guide-content"><div class="rd-guide-copy" role="status" aria-live="polite" aria-atomic="true"><div class="rd-guide-progress"><span>Your review</span><span>${helpMode ? `Help for step ${info.step}` : `${info.step} of ${isPractice ? 6 : 7}`}</span></div><h2>${esc(info.title)}</h2><dl class="rd-guide-lesson">${[['What',info.what],['Why',info.why],['Next',info.next]].map(([label,text]) => `<div><dt>${label}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl></div></div>${primaryAction || helpAction || skipAction ? `<div class="rd-guide-actions${declineAvailable ? ' rd-guide-actions-grid' : ''}">${primaryAction}${declineAction}${helpAction}${skipAction}</div>` : ''}<div class="rd-guide-controls"><button type="button" data-rd-guide="spotlight" aria-pressed="${this.guide.spotlight}">${this.guide.spotlight ? 'Hide spotlight' : 'Show spotlight'}</button><button type="button" data-rd-guide="pause">${saveAvailable ? 'Save &amp; pause' : 'Pause help'}</button></div><p class="rd-guide-keyboard">${helpMode ? 'Resource links open in a new tab. Escape returns to your review.' : 'Keep using the form. Escape pauses help.'}</p></section>`;
      this.guideSignature = signature;
    }
    this.guideRoot.classList.toggle('rd-guide-help-mode',helpMode);
    this.guideRoot.classList.toggle('rd-guide-translation-choice',awaitingChoice);
    this.guideRoot.classList.toggle('rd-guide-no-fog',!this.guide.spotlight);
    document.body.classList.add('rd-guide-active');
    this.scheduleGuide(changed);
  }

  scheduleGuide(scrollTarget,forceScroll = false) {
    if (!this.guideRoot || this.isOpen) return;
    this.guideScrollRequested ||= Boolean(scrollTarget);
    this.guideForceScrollRequested ||= Boolean(forceScroll);
    cancelAnimationFrame(this.guideFrame);
    // The actual form moves focus on its next frame. Position help after that
    // movement, so the guide never fights the form for scroll position.
    this.guideFrame = requestAnimationFrame(() => {
      this.guideFrame = requestAnimationFrame(() => {
        const scroll = this.guideScrollRequested;
        const force = this.guideForceScrollRequested;
        this.guideScrollRequested = false;
        this.guideForceScrollRequested = false;
        this.layoutGuide(scroll,force);
      });
    });
  }

  layoutGuide(scrollTarget,forceScroll = false) {
    if (!this.guideRoot || !this.guide || this.guide.paused) return;
    const stage = displayGuideStage(this.guide.stage);
    const baseInfo = guideStep(stage,this.guide.isPractice);
    const info = this.helpDetour && baseInfo ? helpStep(baseInfo.step) : baseInfo;
    const card = this.guideRoot.querySelector('.rd-guide-card');
    const target = info?.selectors.map(selector => document.querySelector(selector)).find(Boolean);
    if (!card || !target || !target.getClientRects().length) { this.guideRoot.classList.add('rd-guide-no-target'); return; }
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const width = viewport?.width || window.innerWidth;
    const originTop = viewport?.offsetTop || 0;
    const originLeft = viewport?.offsetLeft || 0;
    const inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    this.guideRoot.classList.toggle('rd-guide-compact',target.id === 'pc-request-choices' || (height < 520 && inputFocused));
    this.guideRoot.classList.toggle('rd-guide-small',height < 680);
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const navSpace = nav && nav.top < originTop + height ? Math.max(0,originTop + height - nav.top) : 0;
    card.style.left = `${originLeft + width / 2}px`;
    card.style.width = `${Math.min(430,Math.max(240,width - 24))}px`;
    card.style.maxHeight = `${Math.max(110,Math.min(300,height * (info.awaitingTranslationChoice ? .5 : .43)))}px`;
    const cardHeight = card.getBoundingClientRect().height;
    const cardTop = Math.max(originTop + 12,originTop + height - navSpace - 12 - cardHeight);
    card.style.top = `${Math.round(cardTop)}px`;
    card.style.bottom = 'auto';
    document.body.style.setProperty('--rd-guide-reserve',`${Math.round(cardHeight + navSpace + 36)}px`);
    const availableTop = originTop + 14;
    const availableBottom = cardTop - 12;
    if (!this.helpDetour && ['permission','request','request-detail','question'].includes(stage) && target.tagName === 'TEXTAREA') {
      const fieldRect = target.getBoundingClientRect();
      const actions = target.closest('form')?.querySelector('.pc-actions')?.getBoundingClientRect();
      if (actions) {
        const gap = Math.max(0,actions.top - fieldRect.bottom);
        const fieldMax = Math.max(56,Math.floor(availableBottom - availableTop - actions.height - gap - 14));
        document.body.style.setProperty('--rd-guide-field-max',`${fieldMax}px`);
      }
    }
    const measureTarget = () => {
      const rect = target.getBoundingClientRect();
      // Keep the real advance button in the same clear window as the answer.
      const actions = !this.helpDetour && !info.awaitingTranslationChoice && target.id !== 'pc-request-choices' && ['permission','request','request-detail','question'].includes(stage)
        ? target.closest('form')?.querySelector('.pc-actions')?.getBoundingClientRect() : null;
      if (!actions) return rect;
      const left = Math.min(rect.left,actions.left);
      const right = Math.max(rect.right,actions.right);
      const top = Math.min(rect.top,actions.top);
      const bottom = Math.max(rect.bottom,actions.bottom);
      return {left,right,top,bottom,width:right-left,height:bottom-top};
    };
    let rect = measureTarget();
    if (scrollTarget && (!inputFocused || forceScroll) && availableBottom - availableTop > 70) {
      const desiredTop = availableTop + Math.max(0,(availableBottom - availableTop - Math.min(rect.height,availableBottom - availableTop)) / 2);
      if (rect.top < availableTop || rect.bottom > availableBottom) window.scrollBy({top:rect.top - desiredTop,behavior:'instant'});
      rect = measureTarget();
    }
    const left = Math.max(originLeft,Math.min(originLeft + width,rect.left - 7));
    const right = Math.max(left,Math.min(originLeft + width,rect.right + 7));
    const top = Math.max(availableTop,Math.min(availableBottom,rect.top - 7));
    const bottom = Math.max(top,Math.min(availableBottom,rect.bottom + 7));
    const visible = right - left > 24 && bottom - top > 24;
    this.guideRoot.classList.toggle('rd-guide-no-target',!visible);
    place(this.guideRoot.querySelector('.rd-guide-top'),originLeft,originTop,width,Math.max(0,top - originTop));
    place(this.guideRoot.querySelector('.rd-guide-left'),originLeft,top,Math.max(0,left - originLeft),bottom - top);
    place(this.guideRoot.querySelector('.rd-guide-right'),right,top,Math.max(0,originLeft + width - right),bottom - top);
    place(this.guideRoot.querySelector('.rd-guide-bottom'),originLeft,bottom,width,Math.max(0,originTop + height - bottom));
    place(this.guideRoot.querySelector('.rd-guide-ring'),left,top,right - left,bottom - top);
  }
}
