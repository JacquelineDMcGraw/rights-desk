const DRAFT_KEY = 'rights-desk-case-draft-v1';
const DATABASE = 'rights-desk-private-draft-v1';
const IMAGE_KEY = 'reference';
const LIMIT = 12 * 1024 * 1024;
const QUESTIONS = [
  ['preview', 'Would you like to add the work?', 'A reference image or screenshot helps us compare public records. You can come back when you have the file.'],
  ['title', 'What do you call this work?', 'A working title is enough. Use words you would be comfortable searching in public catalogs.'],
  ['workType', 'What kind of work is it?', 'Choose the closest medium. This helps us suggest useful records to gather.'],
  ['useChannel', 'Where did you notice the possible use?', 'Choose the closest place or channel. “Not sure yet” is a useful answer too.'],
  ['jurisdiction', 'Where did the possible use happen?', 'Choose the best-known U.S. state or territory. If you do not know yet, leave it for later.'],
  ['creatorLocation', 'Where are you based?', 'This is optional context. You can choose a place now or return to it later.'],
  ['suspectedUrl', 'Do you have a link to the use?', 'A page, post, or product link can help you find it again. It is fine if you need to look for it.'],
  ['firstPublishedAt', 'When did you first share the work?', 'Add a publication date if you know it. No need to guess.'],
  ['ownershipBasis', 'How are you connected to the work?', 'This can help you decide which permissions and records matter. “I am not sure” is an option.'],
  ['registrationNumber', 'Do you have a registration number?', 'Add a copyright registration or application number if you have one. You can continue without it.'],
  ['likenessInvolved', 'Is someone’s name or likeness involved?', 'A person’s rights may be separate from the creator’s copyright. It is okay to be unsure.'],
  ['story', 'What would you like to remember?', 'A few notes about what you noticed are enough for now. You can leave this blank.'],
];
const REQUIRED = new Set(['preview', 'title', 'workType', 'useChannel', 'jurisdiction']);
const STARTER_NAMES = {preview:'a reference image under 12 MB', title:'a title', workType:'the work medium', useChannel:'a use channel', jurisdiction:'the location'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

function readDraft(key = DRAFT_KEY) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' && value.answers && typeof value.answers === 'object' ? value : null;
  } catch { return null; }
}
function imageStore(mode, action) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('Browser storage is unavailable')); return; }
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('images');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('images', mode);
      const request = action(transaction.objectStore('images'));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('Draft storage interrupted')); };
    };
  });
}

export class CaseIntake {
  constructor() {
    this.draft = readDraft() || { answers: {}, step: 0, paused: false, fileName: '' };
    this.key = DRAFT_KEY;
    this.cache = new Map();
    this.questions = QUESTIONS;
    this.editingId = null;
    this.file = null;
    this.form = null;
    this.imageQueue = Promise.resolve();
    this.generation = 0;
    this.storageOK = true;
    this.imageStorageOK = true;
    this.savingImage = false;
    document.addEventListener('case-intake-reveal', event => this.reveal(event.detail?.selector));
  }

  switchDraft(item) {
    const key = item ? `rights-desk-case-edit-v1:${item.id}` : DRAFT_KEY;
    if (this.key === key) return;
    if (this.key) this.cache.set(this.key, {draft:this.draft,file:this.file});
    const cached = this.cache.get(key);
    const existing = cached?.draft || readDraft(key);
    const answers = item ? Object.fromEntries(QUESTIONS.filter(([name]) => name !== 'preview').map(([name]) => [name, name === 'likenessInvolved' ? item[name] === true ? 'yes' : item[name] === false ? 'no' : '' : String(item[name] || '')])) : {};
    this.draft = existing || {answers,step:0,paused:false,fileName:''};
    this.file = cached?.file || null;
    this.key = key;
    this.editingId = item?.id || null;
    this.questions = item ? QUESTIONS.filter(([name]) => name !== 'preview') : QUESTIONS;
    this.storageOK = true;
    this.imageStorageOK = true;
  }

  mount(item = null) {
    const form = document.querySelector('#case-form');
    if (!form || form === this.form) { if (!form) this.form = null; return; }
    this.switchDraft(item);
    this.form = form;
    form.noValidate = true;
    form.dataset.enhanced = 'true';
    const groups = [...form.children].filter(element => element.classList.contains('field'));
    this.groups = this.questions.map(([name], index) => {
      const group = groups.find(element => element.querySelector(`[name="${name}"]`));
      group.dataset.caseStep = index;
      return group;
    });
    this.submit = form.querySelector('button[type="submit"]');
    this.submit.classList.add('intake-submit');
    this.submit.textContent = this.editingId ? 'Save case details' : 'Create my private case';
    this.submit.hidden = true;
    const header = document.createElement('div');
    header.className = 'intake-header';
    header.innerHTML = '<div class="intake-meta"><span class="eyebrow" data-intake-progress></span><button type="button" class="intake-text-button" data-intake-action="review">Review answers</button></div><h3 class="serif" id="intake-question" tabindex="-1"></h3><p class="helper" data-intake-guidance></p>';
    form.querySelector('.case-private-note').after(header);
    const review = document.createElement('div');
    review.className = 'intake-review';
    review.dataset.intakeReview = '';
    const controls = document.createElement('div');
    controls.className = 'intake-controls';
    controls.innerHTML = '<div class="intake-next-row"><button type="button" class="button outline" data-intake-action="back">← Back</button><button type="button" class="button dark" data-intake-action="next">Next →</button></div><button type="button" class="intake-text-button" data-intake-action="skip">Come back to this</button>';
    const pause = document.createElement('div');
    pause.className = 'intake-pause';
    pause.innerHTML = `<button type="button" class="button light full" data-intake-action="pause">Save for later</button><p class="intake-save-status helper" role="status" aria-live="polite" data-intake-save-status></p><p class="helper intake-local-note">${this.editingId ? 'Draft changes are saved privately in this browser when storage is available. Saved case details update only when you choose Save case details.' : 'Unfinished answers and a selected image are saved privately in this browser when storage is available.'} Shared devices may retain drafts. Clearing browser data removes them.</p>`;
    this.submit.before(review, controls);
    this.submit.after(pause);
    for (const [name] of this.questions) {
      if (name === 'preview') continue;
      const input = form.elements.namedItem(name);
      if (typeof this.draft.answers[name] === 'string') input.value = this.draft.answers[name];
    }
    if (!this.editingId) this.restoreFile();
    form.addEventListener('input', event => this.changed(event));
    form.addEventListener('change', event => this.changed(event));
    form.addEventListener('click', event => {
      const action = event.target.closest('[data-intake-action]');
      if (!action) return;
      event.preventDefault();
      const value = action.dataset.intakeAction;
      if (value === 'back') this.go(Math.max(0, Number(this.draft.step) - 1));
      if (value === 'next' || value === 'skip') this.go(Math.min(this.questions.length, Number(this.draft.step) + 1));
      if (value === 'review') this.go(this.questions.length);
      if (value === 'edit') this.go(Number(action.dataset.intakeStep));
      if (value === 'pause') { this.draft.paused = true; this.save(); this.show(true); }
      if (value === 'resume') { this.draft.paused = false; this.save(); this.show(true); }
    });
    this.show(false);
  }

  changed(event) {
    if (event.target.name === 'preview') {
      const file = event.target.files?.[0] || null;
      if (file === this.file) return;
      this.file = file;
      this.draft.fileName = file?.name || '';
      this.savingImage = Boolean(file && file.size <= LIMIT);
      this.imageQueue = this.imageQueue.then(() => imageStore('readwrite', store => file && file.size <= LIMIT ? store.put(file, IMAGE_KEY) : store.delete(IMAGE_KEY)))
        .then(() => { this.imageStorageOK = true; })
        .catch(() => { this.imageStorageOK = false; })
        .finally(() => { this.savingImage = false; this.updateStatus(); });
    }
    this.capture();
    this.save();
    if (Number(this.draft.step) === this.questions.length && !this.draft.paused) this.updateReview();
  }

  capture() {
    if (!this.form) return;
    for (const [name] of this.questions) {
      if (name !== 'preview') this.draft.answers[name] = String(this.form.elements.namedItem(name)?.value || '');
    }
  }

  save() {
    this.draft.updatedAt = Date.now();
    try { localStorage.setItem(this.key, JSON.stringify(this.draft)); this.storageOK = true; }
    catch { this.storageOK = false; }
    this.updateStatus();
  }

  updateStatus() {
    const status = this.form?.querySelector('[data-intake-save-status]');
    if (!status) return;
    if (!this.storageOK) status.textContent = 'Your answers stay available while this page is open. Browser storage is unavailable, so keep the page open to return to them.';
    else if (this.editingId) status.textContent = this.draft.updatedAt ? 'Draft changes saved in this browser. Your case updates when you choose Save case details.' : 'Your saved answers are here. You can return to anything you skipped.';
    else if (this.savingImage) status.textContent = 'Saving your selected image privately in this browser…';
    else if (!this.imageStorageOK && this.draft.fileName) status.textContent = 'Your answers are saved. If you reload, please choose your image again.';
    else if (this.draft.fileName && !this.file) status.textContent = `Your answers are saved. Choose ${this.draft.fileName} again when you are ready.`;
    else if (this.file?.size > LIMIT) status.textContent = 'Your answers are saved. Choose an image under 12 MB whenever you are ready.';
    else status.textContent = this.draft.updatedAt ? 'Draft saved in this browser. There is no need to finish now.' : 'You can leave any question for later.';
  }

  async restoreFile() {
    const form = this.form;
    const generation = this.generation;
    try {
      const stored = this.file || (this.draft.fileName ? await imageStore('readonly', store => store.get(IMAGE_KEY)) : null);
      if (!stored || form !== this.form || generation !== this.generation) return;
      const input = form.elements.namedItem('preview');
      if (input.files?.length) return;
      const file = stored instanceof File ? stored : new File([stored], this.draft.fileName || 'reference', {type:stored.type});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      this.file = file;
      this.imageStorageOK = true;
      this.updateStatus();
      if (Number(this.draft.step) === this.questions.length && !this.draft.paused) this.updateReview();
    } catch { this.imageStorageOK = false; this.updateStatus(); }
  }

  go(step, focus = true) {
    this.capture();
    this.draft.step = Math.max(0, Math.min(this.questions.length, Number(step) || 0));
    this.draft.paused = false;
    this.save();
    this.show(focus);
  }

  show(focus) {
    const form = this.form;
    if (!form) return;
    const index = Math.max(0, Math.min(this.questions.length, Number(this.draft.step) || 0));
    const paused = this.draft.paused;
    const reviewing = index === this.questions.length;
    form.dataset.caseHasDraft = this.draft.updatedAt ? 'true' : 'false';
    for (let i = 0; i < this.groups.length; i++) this.groups[i].hidden = paused || reviewing || i !== index;
    const header = form.querySelector('.intake-header');
    const heading = form.querySelector('#intake-question');
    header.querySelector('[data-intake-progress]').textContent = paused ? 'A place to pause' : reviewing ? 'Your answers, together' : `Question ${index + 1} of ${this.questions.length}`;
    header.querySelector('[data-intake-action="review"]').hidden = reviewing && !paused;
    heading.textContent = paused ? 'Your draft will be here.' : reviewing ? 'Look over what you have.' : this.questions[index][1];
    header.querySelector('[data-intake-guidance]').textContent = paused ? 'Come back when you have more information, or keep going now. You can review and change any answer.' : reviewing ? 'You can change any answer in this draft. Add optional details now, or keep the draft for another time.' : this.questions[index][2];
    const review = form.querySelector('[data-intake-review]');
    review.hidden = !reviewing && !paused;
    if (paused) review.innerHTML = '<button type="button" class="button dark full" data-intake-action="resume">Continue where I left off →</button>';
    else if (reviewing) this.updateReview();
    form.querySelector('.intake-controls').hidden = paused || reviewing;
    form.querySelector('[data-intake-action="back"]').disabled = index === 0;
    form.querySelector('[data-intake-action="next"]').textContent = index === this.questions.length - 1 ? 'Review answers →' : 'Next →';
    this.submit.hidden = paused || !reviewing;
    form.querySelector('[data-intake-action="pause"]').hidden = paused;
    this.updateStatus();
    if (focus) {
      heading.focus({preventScroll:true});
      heading.scrollIntoView({block:'start',behavior:'instant'});
    }
  }

  missing() {
    return this.questions.map(([name], index) => ({name,index})).filter(({name}) => {
      if (!REQUIRED.has(name)) return false;
      if (name === 'preview') return !this.form.elements.namedItem(name).files?.[0]?.size || this.form.elements.namedItem(name).files[0].size > LIMIT;
      return !this.form.elements.namedItem(name).value.trim();
    });
  }

  updateReview() {
    if (!this.form) return;
    const missing = this.missing();
    const remaining = missing.map(({name}) => STARTER_NAMES[name]);
    const remainingText = remaining.length < 2 ? remaining[0] : `${remaining.slice(0, -1).join(', ')} and ${remaining.at(-1)}`;
    const list = this.questions.map(([name, title], index) => {
      const input = this.form.elements.namedItem(name);
      let value;
      if (name === 'preview') value = input.files?.[0]?.name || '';
      else if (input.tagName === 'SELECT') value = input.value ? input.selectedOptions[0].textContent : '';
      else value = input.value.trim();
      return `<button type="button" class="intake-review-row" data-intake-action="edit" data-intake-step="${index}"><span><strong>${esc(title)}</strong><span>${esc(value || 'Come back to this')}</span></span><span class="intake-review-edit">${value ? 'Change' : 'Add'}</span></button>`;
    }).join('');
    this.form.querySelector('[data-intake-review]').innerHTML = `<p class="helper intake-readiness">${missing.length ? `Your draft is saved. When you are ready, add ${remainingText} to ${this.editingId ? 'save the case details' : 'create the case'}.` : this.editingId ? 'Your details are ready to save. Save them to the case now, or keep your draft changes for later.' : 'Your starting points are ready. Create the case now, or keep this draft for later.'}</p><div class="intake-review-list">${list}</div>`;
    this.submit.disabled = missing.length > 0;
  }

  allowSubmit() {
    if (!this.form) return true;
    if (this.draft.paused || Number(this.draft.step) !== this.questions.length) {
      this.go(Math.min(this.questions.length, Number(this.draft.step) + 1));
      return false;
    }
    const missing = this.missing();
    if (missing.length) { this.updateReview(); return false; }
    const invalid = [...this.form.elements].find(input => input.willValidate && !input.validity.valid);
    if (invalid) {
      const index = this.questions.findIndex(([name]) => name === invalid.name);
      this.go(index);
      invalid.focus();
      invalid.reportValidity();
      return false;
    }
    return true;
  }

  reveal(selector) {
    if (!this.form || !selector) return;
    const target = this.form.querySelector(selector);
    if (!target) return;
    const group = target.closest('[data-case-step]');
    if (group) this.go(Number(group.dataset.caseStep), false);
    else if (target === this.submit) this.go(this.questions.length, false);
  }

  clear(key = this.key) {
    const wasEditing = key !== DRAFT_KEY;
    this.cache.delete(key);
    if (key === this.key) {
      this.generation++;
      this.draft = {answers:{},step:0,paused:false,fileName:''};
      this.file = null;
      this.form = null;
      this.key = null;
    }
    try { localStorage.removeItem(key); } catch { /* Already held only in memory. */ }
    if (wasEditing) return Promise.resolve();
    this.imageQueue = this.imageQueue.then(() => imageStore('readwrite', store => store.delete(IMAGE_KEY))).catch(() => {});
    return this.imageQueue;
  }
}
