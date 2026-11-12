const STORAGE_KEY = 'rights-desk-theme-v1';
const DEFAULT_THEME = 'graffiti';

const PALETTES = [
  { id: 'graffiti', name: 'Graffiti', description: 'Chalk and neon on asphalt · dark', browserColor: '#121214', swatches: ['#121214', '#1c1c21', '#f8f9fa', '#00f5d4', '#ffe600', '#ff2a85', '#ff6b00'] },
  { id: 'sky', name: 'Sky', description: 'Navy, ice blue and bright accents · light', browserColor: '#142f53', swatches: ['#142f53', '#edf5fd', '#5ed9ee', '#f7cfe1', '#fff0b6'] },
  { id: 'caramellatte', name: 'Caramel Latte', description: 'Warm cream and caramel · light', browserColor: '#fff7ed', swatches: ['oklch(98% 0.016 73.684)', 'oklch(90% 0.076 70.697)', 'oklch(46.44% 0.111 37.85)', '#000'] },
  { id: 'sage', name: 'Sage', description: 'Soft cream and evergreen · light', browserColor: '#fbfaf6', swatches: ['#fbfaf6', '#d2dece', '#865231', '#23392e'] },
  { id: 'midnight', name: 'Midnight', description: 'Warm charcoal and golden light · dark', browserColor: '#2b2825', swatches: ['#2b2825', '#51493f', '#ffc887', '#f2d5a4'] },
  { id: 'highcontrast', name: 'High Contrast', description: 'Black, white and clear outlines · light', browserColor: '#ffffff', swatches: ['#ffffff', '#f4f4f4', '#003d99', '#000000'] },
];

function paletteFor(value) {
  return PALETTES.find(palette => palette.id === value) || PALETTES[0];
}

function savedTheme() {
  try { return paletteFor(localStorage.getItem(STORAGE_KEY)).id; }
  catch { return DEFAULT_THEME; }
}

export class AppearanceSettings {
  constructor({ onClose } = {}) {
    this.dialog = null;
    this.previousFocus = null;
    this.onClose = onClose;
    this.theme = savedTheme();
    this.apply(this.theme);
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      this.apply(savedTheme());
      this.updateControls(`${paletteFor(this.theme).name} is now selected.`);
    });
  }

  get isOpen() { return Boolean(this.dialog?.open); }

  apply(value) {
    const palette = paletteFor(value);
    this.theme = palette.id;
    document.documentElement.dataset.theme = palette.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.browserColor);
  }

  select(value) {
    this.apply(value);
    let saved = true;
    try { localStorage.setItem(STORAGE_KEY, this.theme); }
    catch { saved = false; }
    const name = paletteFor(this.theme).name;
    this.updateControls(saved ? `${name} saved for this browser.` : `${name} applied for this visit. Browser storage is unavailable.`);
  }

  ensureDialog() {
    if (this.dialog) return;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'appearance-settings';
    this.dialog.className = 'settings-dialog';
    this.dialog.setAttribute('aria-labelledby', 'settings-title');
    this.dialog.setAttribute('aria-describedby', 'settings-description');
    this.dialog.innerHTML = `<div class="settings-header"><div><p class="settings-eyebrow">Make yourself comfortable</p><h2 id="settings-title">Settings</h2></div><button type="button" class="settings-close" data-close-settings aria-label="Close settings"><span aria-hidden="true">×</span></button></div><div class="settings-content"><p id="settings-description">Choose the colors that feel right for you. Your preference stays on this browser.</p><fieldset class="palette-fieldset"><legend>Color palette</legend><div class="palette-options">${PALETTES.map(palette => `<label class="palette-choice"><input type="radio" name="rights-desk-palette" value="${palette.id}"/><span class="palette-copy"><span class="palette-heading"><strong>${palette.name}</strong><span class="palette-selected" aria-hidden="true">Selected</span></span><span class="palette-description">${palette.description}</span><span class="palette-swatches" aria-hidden="true">${palette.swatches.map(color => `<span style="background:${color}"></span>`).join('')}</span></span></label>`).join('')}</div></fieldset><p class="settings-status" data-settings-status role="status" aria-live="polite" aria-atomic="true"></p></div><div class="settings-footer"><button type="button" class="settings-reset" data-reset-theme>Use default palette</button><button type="button" class="settings-done" data-close-settings>Done</button></div>`;
    document.body.append(this.dialog);
    this.dialog.addEventListener('change', event => {
      if (event.target.matches('input[name="rights-desk-palette"]')) this.select(event.target.value);
    });
    this.dialog.addEventListener('click', event => {
      if (event.target.closest('[data-close-settings]')) this.dialog.close();
      else if (event.target.closest('[data-reset-theme]')) this.select(DEFAULT_THEME);
      else if (event.target === this.dialog) {
        const rect = this.dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.dialog.close();
      }
    });
    this.dialog.addEventListener('close', () => {
      document.body.classList.remove('settings-open');
      const previous = this.previousFocus;
      const target = previous?.isConnected && previous !== document.body ? previous : document.querySelector('[data-open-settings]');
      target?.focus({ preventScroll: true });
      this.previousFocus = null;
      this.onClose?.();
    });
  }

  updateControls(message) {
    if (!this.dialog) return;
    for (const input of this.dialog.querySelectorAll('input[name="rights-desk-palette"]')) input.checked = input.value === this.theme;
    this.dialog.querySelector('[data-settings-status]').textContent = message;
  }

  open(trigger) {
    // The tour already owns keyboard focus until it is dismissed.
    if (document.querySelector('#case-tour') || this.isOpen) return;
    this.ensureDialog();
    this.previousFocus = trigger || document.activeElement;
    this.updateControls(`${paletteFor(this.theme).name} is selected. Changes save automatically.`);
    this.dialog.showModal();
    document.body.classList.add('settings-open');
    this.dialog.querySelector('input:checked')?.focus({ preventScroll: true });
  }
}
