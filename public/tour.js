const SEEN_KEY = 'rights-desk-first-case-tour-seen-v1';
const PENDING_KEY = 'rights-desk-first-case-tour-pending-v1';

const CREATE_STEPS = [
  {
    selector: '.case-private-note',
    title: 'Start a private case',
    text: 'Answer one question at a time, or leave it for later. The unfinished draft stays in this browser; a saved case is private on the local server.',
  },
  {
    selector: '#case-preview',
    title: 'Choose the work you want to protect',
    text: 'Add a clear image of your work or a screenshot of the possible use. For a photograph, keep the original RAW or first-generation file for the evidence step.',
  },
  {
    selector: '#case-title',
    title: 'Name the work',
    text: 'Use the title you normally use. Rights Desk can search this title in public catalogs, so avoid putting private details here.',
  },
  {
    selector: '#case-work',
    title: 'Select its medium',
    text: 'Choose photo, illustration, video, writing, audio, or AI-assisted work. This changes the records Rights Desk asks you to gather.',
  },
  {
    selector: '#case-channel',
    title: 'Say where you saw it',
    text: 'A social post, ad, product, print piece, or AI output needs a different evidence trail. Choose the closest use channel.',
  },
  {
    selector: '#case-jurisdiction',
    title: 'Pick the location of the possible use',
    text: 'Choose the best-known U.S. state or territory. The later guide will show local issues and official sources for that place.',
  },
  {
    selector: '#case-story',
    title: 'Write down what happened',
    text: 'Record the page or seller, dates, prior permissions, and what you noticed. You can revisit publication, ownership, registration, and likeness questions from Review answers.',
  },
  {
    selector: '#case-form button[type="submit"]',
    title: 'Create the case when you are ready',
    text: 'Close this tour, fill the required fields, then save. The walkthrough will resume on your new case with search and document collection.',
  },
];

const COLLECT_STEPS = [
  {
    selector: '.private-image',
    title: 'Your case is saved privately',
    text: 'This is the reference you uploaded. Rights Desk also records its SHA-256 fingerprint so the exact file can be identified later.',
  },
  {
    selector: '[data-run-case-search]',
    title: 'Search named public collections',
    text: 'Run a source-by-source search when you are ready. The title and short search terms go to public catalogs; the image stays local. A visual lead is not proof of misuse.',
  },
  {
    selector: '#case-document',
    title: 'Collect your creation records',
    text: 'Add originals, drafts, contracts, licenses, releases, or registration records. The checklist above this field changes with the work medium.',
  },
  {
    selector: '.case-offers h2',
    title: 'Offer a path to permission',
    text: 'You can draft a voluntary license, review the terms and price, and create a buyer link. Share it yourself. A confirmed PayPal Sandbox payment adds a license record to this case.',
  },
  {
    selector: '.local-law h3',
    title: 'Review the location guide',
    text: 'Check publicity, privacy, and contract issues alongside federal copyright steps. Open the official sources before deciding what to do next.',
  },
  {
    selector: '[data-export-case]',
    title: 'Take the case summary with you',
    text: 'Download a report with your facts, search coverage, evidence checklist, and legal starting points. You can return to add more records later.',
  },
];

function read(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function write(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* Storage can be disabled. */ }
}
function remove(storage, key) {
  try { storage.removeItem(key); } catch { /* Storage can be disabled. */ }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
}
function place(element, left, top, width, height) {
  if (!element) return;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.style.width = `${Math.max(0, Math.round(width))}px`;
  element.style.height = `${Math.max(0, Math.round(height))}px`;
}

export class CaseTour {
  constructor() {
    this.phase = null;
    this.index = 0;
    this.root = null;
    this.previousFocus = null;
    this.frame = 0;
    this.onKeydown = event => this.handleKeydown(event);
    this.onViewportChange = () => this.scheduleLayout(false);
    this.onClick = event => this.handleClick(event);
  }

  sync({ tab, activeCaseId, hasCases, loading, error }) {
    if (this.phase) {
      const wrongPage = tab !== 'protect' || loading || error ||
        (this.phase === 'create' && activeCaseId) || (this.phase === 'collect' && !activeCaseId);
      if (wrongPage) this.close({ clearPending: false, restoreFocus: false });
      else this.scheduleLayout(true);
      return;
    }
    if (tab !== 'protect' || loading || error) return;
    if (activeCaseId && read(sessionStorage, PENDING_KEY) === '1') {
      this.startCollect();
    }
  }

  startCreate() {
    if (!document.querySelector('#case-form')) return false;
    remove(sessionStorage, PENDING_KEY);
    write(localStorage, SEEN_KEY, '1');
    this.open('create');
    return true;
  }

  startCollect() {
    if (!document.querySelector('[data-run-case-search]')) return false;
    remove(sessionStorage, PENDING_KEY);
    write(localStorage, SEEN_KEY, '1');
    this.open('collect');
    return true;
  }

  open(phase) {
    if (this.phase) this.close({ clearPending: false, restoreFocus: false });
    this.phase = phase;
    this.index = 0;
    this.previousFocus = document.activeElement;
    this.root = document.createElement('div');
    this.root.id = 'case-tour';
    this.root.className = 'tour-root';
    document.body.append(this.root);
    document.body.classList.add('tour-open');
    const app = document.querySelector('#app');
    if (app) app.inert = true;
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKeydown);
    window.addEventListener('scroll', this.onViewportChange, { passive: true });
    window.addEventListener('resize', this.onViewportChange);
    window.visualViewport?.addEventListener('resize', this.onViewportChange);
    this.renderStep();
  }

  renderStep() {
    if (!this.root || !this.phase) return;
    const steps = this.phase === 'create' ? CREATE_STEPS : COLLECT_STEPS;
    const step = steps[this.index];
    if (this.phase === 'create') document.dispatchEvent(new CustomEvent('case-intake-reveal', {detail:{selector:step.selector}}));
    const last = this.index === steps.length - 1;
    const phaseName = this.phase === 'create' ? 'Create your first case' : 'Collect your evidence';
    this.root.innerHTML = `<div class="tour-fog tour-fog-top" aria-hidden="true"></div><div class="tour-fog tour-fog-left" aria-hidden="true"></div><div class="tour-fog tour-fog-right" aria-hidden="true"></div><div class="tour-fog tour-fog-bottom" aria-hidden="true"></div><div class="tour-window-shield" aria-hidden="true"></div><div class="tour-ring" aria-hidden="true"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description"><div class="tour-progress"><span>${escapeHtml(phaseName)}</span><span>${this.index + 1} / ${steps.length}</span></div><h2 id="tour-title" tabindex="-1">${escapeHtml(step.title)}</h2><p id="tour-description">${escapeHtml(step.text)}</p><div class="tour-controls"><button type="button" class="tour-skip" data-tour-action="skip">Skip tour</button><div class="tour-actions">${this.index ? '<button type="button" class="tour-back" data-tour-action="back">Back</button>' : ''}<button type="button" class="tour-next" data-tour-action="next">${last ? this.phase === 'create' ? 'Start my case' : 'Done' : 'Next'} <span aria-hidden="true">→</span></button></div></div></div>`;
    this.scheduleLayout(true);
    requestAnimationFrame(() => this.root?.querySelector('#tour-title')?.focus({ preventScroll: true }));
  }

  scheduleLayout(scrollTarget) {
    if (!this.phase) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.layout(scrollTarget));
  }

  layout(scrollTarget) {
    if (!this.root || !this.phase) return;
    const steps = this.phase === 'create' ? CREATE_STEPS : COLLECT_STEPS;
    const target = document.querySelector(steps[this.index].selector);
    const card = this.root.querySelector('.tour-card');
    if (!target || !card) return;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    if (scrollTarget) {
      const cardHeight = card.getBoundingClientRect().height;
      const visibleBottom = Math.max(100, viewportHeight - cardHeight - 28);
      const before = target.getBoundingClientRect();
      if (before.top < 18 || before.bottom > visibleBottom) {
        const desiredTop = Math.max(18, (visibleBottom - Math.min(before.height, visibleBottom)) / 2);
        window.scrollBy(0, before.top - desiredTop);
      }
    }
    const rect = target.getBoundingClientRect();
    const left = Math.max(0, Math.min(viewportWidth, rect.left - 7));
    const top = Math.max(0, Math.min(viewportHeight, rect.top - 7));
    const right = Math.max(left, Math.min(viewportWidth, rect.right + 7));
    const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom + 7));
    place(this.root.querySelector('.tour-fog-top'), 0, 0, viewportWidth, top);
    place(this.root.querySelector('.tour-fog-left'), 0, top, left, bottom - top);
    place(this.root.querySelector('.tour-fog-right'), right, top, viewportWidth - right, bottom - top);
    place(this.root.querySelector('.tour-fog-bottom'), 0, bottom, viewportWidth, viewportHeight - bottom);
    place(this.root.querySelector('.tour-window-shield'), left, top, right - left, bottom - top);
    place(this.root.querySelector('.tour-ring'), left, top, right - left, bottom - top);
  }

  handleClick(event) {
    const button = event.target.closest('[data-tour-action]');
    if (!button) return;
    const action = button.dataset.tourAction;
    if (action === 'skip') this.close();
    if (action === 'back' && this.index > 0) { this.index--; this.renderStep(); }
    if (action === 'next') {
      const steps = this.phase === 'create' ? CREATE_STEPS : COLLECT_STEPS;
      if (this.index < steps.length - 1) { this.index++; this.renderStep(); }
      else if (this.phase === 'create') this.pauseForCase();
      else this.close();
    }
  }

  handleKeydown(event) {
    if (!this.root) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...this.root.querySelectorAll('.tour-card button')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement?.id === 'tour-title')) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  pauseForCase() {
    write(sessionStorage, PENDING_KEY, '1');
    this.close({ clearPending: false, restoreFocus: false });
    document.dispatchEvent(new CustomEvent('case-intake-reveal', {detail:{selector:'#case-preview'}}));
    const file = document.querySelector('#case-preview');
    file?.scrollIntoView({ block: 'center' });
    file?.focus({ preventScroll: true });
  }

  close({ clearPending = true, restoreFocus = true } = {}) {
    if (!this.phase) return;
    if (clearPending) remove(sessionStorage, PENDING_KEY);
    cancelAnimationFrame(this.frame);
    this.root?.removeEventListener('click', this.onClick);
    this.root?.remove();
    this.root = null;
    this.phase = null;
    document.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('scroll', this.onViewportChange);
    window.removeEventListener('resize', this.onViewportChange);
    window.visualViewport?.removeEventListener('resize', this.onViewportChange);
    document.body.classList.remove('tour-open');
    const app = document.querySelector('#app');
    if (app) app.inert = false;
    if (restoreFocus) {
      const fallback = document.querySelector('[data-start-case-tour]');
      const previous = this.previousFocus;
      const target = previous?.isConnected && previous !== document.body && previous !== document.documentElement ? previous : fallback;
      target?.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }
}
