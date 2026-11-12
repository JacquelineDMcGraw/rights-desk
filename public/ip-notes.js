const NOTES_URL = '/api/ip-notes';
const AUDIO_LIMIT = 20 * 1024 * 1024;
const TRANSCRIPT_LIMIT = 8000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const noteUrl = id => `${NOTES_URL}/${encodeURIComponent(id)}`;
const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' });

export class IpNotes {
  constructor({ api, announce }) {
    this.api = api;
    this.announce = announce;
    this.notes = [];
    this.campaigns = [];
    this.campaignId = '';
    this.needsLoad = true;
    this.loading = false;
    this.loadVersion = 0;
    this.error = '';
    this.saving = false;
    this.pendingWrites = 0;
    this.transcriptEdits = new Map();
  }

  enter(campaignId = '') {
    this.campaignId = campaignId;
    this.needsLoad = true;
  }

  mount() {
    const library = document.querySelector('[data-ip-notes-library]');
    if (library) {
      library.onclick ??= event => {
        const button = event.target.closest('[data-ip-note-transcript-action]');
        if (button) this.transcriptAction(button);
      };
      library.oninput ??= event => {
        if (event.target.name !== 'transcript') return;
        const edit = this.transcriptEdits.get(event.target.form.dataset.ipNoteTranscriptForm);
        if (edit) edit.draft = event.target.value;
      };
      library.onsubmit ??= event => {
        if (!event.target.matches('[data-ip-note-transcript-form]')) return;
        event.preventDefault();
        this.saveTranscript(event.target);
      };
    }
    if (this.needsLoad && !this.pendingWrites) this.load();
  }

  async load() {
    const version = ++this.loadVersion;
    this.needsLoad = false;
    this.loading = true;
    this.error = '';
    this.updateLibrary();
    this.updateSaveButton();
    try {
      const data = await this.api(NOTES_URL);
      if (version !== this.loadVersion) return;
      this.notes = data.notes;
      this.campaigns = data.campaigns;
      const select = document.querySelector('#ip-note-campaign');
      if (select) select.innerHTML = this.campaignOptions(select.value || this.campaignId);
    } catch (error) {
      if (version === this.loadVersion) this.error = error.message;
    } finally {
      if (version === this.loadVersion) {
        this.loading = false;
        this.updateLibrary();
        this.updateSaveButton();
      }
    }
  }

  campaignOptions(selected = '') {
    const option = ({ id, title }) => `<option value="${escapeHtml(id)}" ${selected === id ? 'selected' : ''}>${escapeHtml(title)}</option>`;
    const groups = [['case','Private cases'],['listing','Studio listings']].map(([kind, label]) => {
      const choices = this.campaigns.filter(campaign => campaign.kind === kind);
      return choices.length ? `<optgroup label="${label}">${choices.map(option).join('')}</optgroup>` : '';
    });
    return `<option value="">Save for a future campaign</option>${groups.join('')}`;
  }

  render() {
    const back = this.campaignId
      ? `<button type="button" class="back" data-ip-notes-back="${escapeHtml(this.campaignId)}">← Back to campaign</button>`
      : '<button type="button" class="back" data-tab="protect">← Back to My desk</button>';
    return `<section class="page-title page-pad ip-notes-heading">
      ${back}<h1 id="ip-notes-heading" tabindex="-1">IP <em>notes.</em></h1>
      <p class="lede">Keep ideas, dates, and spoken notes private. Attach a note to a campaign now or save it for later.</p>
      <button type="button" class="tour-launch" data-start-ip-notes-tour>Tour IP notes ↗</button>
    </section>
    <section class="page-pad form-section" aria-labelledby="ip-notes-new">
      <h2 id="ip-notes-new">Add a note</h2>
      <form class="surface form-stack" id="ip-note-form">
        <div class="field"><label for="ip-note-title">Note title *</label><input id="ip-note-title" name="title" maxlength="120" placeholder="What will help you find it?" required/></div>
        <div class="field"><label for="ip-note-audio">Voice recording</label><input id="ip-note-audio" name="audio" type="file" accept=".m4a,audio/mp4,audio/x-m4a" aria-describedby="ip-note-audio-help"/><small id="ip-note-audio-help">Choose a Voice Memos .m4a file up to 20 MB. Add a recording, a written note, or both.</small></div>
        <details class="ip-notes-watch-help"><summary>Import an Apple Watch recording</summary><ol class="helper"><li>Record the note in Voice Memos on your Apple Watch.</li><li>On iPhone, open Voice Memos → Watch Recordings. Share the recording and choose <strong>Save to Files</strong>.</li><li>Return here, choose the file, and save your note.</li><li>If the recording offers <strong>Copy Transcript</strong> in the Voice Memos menu, copy the text. In <strong>Saved notes</strong>, tap <strong>Paste transcript</strong> on the recording.</li></ol></details>
        <div class="field"><label for="ip-note-text">Written note</label><textarea id="ip-note-text" name="text" maxlength="8000" rows="3" placeholder="Add the details you want to remember"></textarea></div>
        <div class="field"><label for="ip-note-campaign">Campaign</label><select id="ip-note-campaign" name="campaignId" ${this.loading || this.needsLoad ? 'disabled' : ''}>${this.campaignOptions(this.campaignId)}</select><small>Unassigned notes stay in your inbox until you choose a campaign.</small></div>
        <button type="submit" class="button dark full" id="ip-note-save" ${this.saveDisabled ? 'disabled' : ''}>${this.saving ? 'Saving note…' : 'Save private note'}</button>
      </form>
    </section>
    <section class="page-pad form-section" aria-labelledby="ip-notes-saved">
      <div class="section-heading"><h2 id="ip-notes-saved">Saved notes</h2></div>
      <div data-ip-notes-library>${this.renderLibrary()}</div>
    </section>`;
  }

  renderLibrary() {
    if (this.loading || this.needsLoad) return '<p class="helper" role="status">Loading your notes…</p>';
    if (this.error) return `<div class="status-box error"><strong>Couldn’t load IP notes</strong>${escapeHtml(this.error)}</div><button type="button" class="button outline pc-space" data-ip-notes-retry>Try again</button>`;
    if (!this.notes.length) return '<div class="empty-state"><h3>Your notes will be here.</h3><p>Save an idea today and attach it when your campaign is ready.</p></div>';
    const notes = this.campaignId
      ? [...this.notes.filter(note => note.campaignId === this.campaignId), ...this.notes.filter(note => note.campaignId !== this.campaignId)]
      : this.notes;
    return `<div class="ip-notes-list">${notes.map(note => this.renderNote(note)).join('')}</div>`;
  }

  renderNote(note) {
    const id = escapeHtml(note.id);
    const campaign = this.campaigns.find(item => item.id === note.campaignId);
    return `<article class="surface ip-note-card">
      <div><h3 class="serif" id="ip-note-heading-${id}" tabindex="-1">${escapeHtml(note.title)}</h3>
      <p class="helper"><time datetime="${escapeHtml(note.createdAt)}">${escapeHtml(formatDate.format(new Date(note.createdAt)))}</time> · <span data-ip-note-campaign-label>${escapeHtml(campaign?.title || 'Unassigned')}</span></p></div>
      ${note.text ? `<p class="ip-note-text">${escapeHtml(note.text)}</p>` : ''}
      ${note.audio ? `<div><p class="helper ip-note-filename">${escapeHtml(note.audio.filename)}</p><audio controls preload="none" src="${noteUrl(note.id)}/audio" aria-label="Play voice note ${escapeHtml(note.title)}"></audio></div>` : ''}
      ${note.audio ? `<section class="ip-note-transcript" id="ip-note-transcript-${id}" data-ip-note-transcript="${id}" aria-labelledby="ip-note-transcript-heading-${id}">${this.renderTranscript(note)}</section>` : ''}
      <form class="ip-note-assignment" data-ip-note-assignment="${id}">
        <div class="field"><label for="ip-note-assignment-${id}">Campaign</label><select id="ip-note-assignment-${id}" name="campaignId">${this.campaignOptions(note.campaignId)}</select></div>
        <button type="submit" class="button outline full">Update campaign</button>
      </form>
    </article>`;
  }

  renderTranscript(note) {
    const id = escapeHtml(note.id);
    const edit = this.transcriptEdits.get(note.id);
    const saving = edit?.busy === 'saving';
    const heading = `<h4 id="ip-note-transcript-heading-${id}">Transcript</h4>`;
    const error = edit?.error ? `<p class="status-box error" role="alert">${escapeHtml(edit.error)}</p>` : '';
    if (edit?.draft !== undefined) return `${heading}${error}
      <form class="ip-note-transcript-form" data-ip-note-transcript-form="${id}">
        <div class="field"><label for="ip-note-transcript-text-${id}">Transcript text</label><textarea id="ip-note-transcript-text-${id}" name="transcript" maxlength="${TRANSCRIPT_LIMIT}" rows="4" placeholder="Paste the text you copied" aria-describedby="ip-note-transcript-help-${id}" required ${saving ? 'readonly' : ''}>${escapeHtml(edit.draft)}</textarea><small id="ip-note-transcript-help-${id}">${note.transcript ? 'Review the text before saving.' : 'Touch and hold in the field and choose Paste. Review the text before saving.'}</small></div>
        <button type="submit" class="button dark full" ${saving ? 'disabled' : ''}>${saving ? 'Saving transcript…' : 'Save transcript'}</button>
        <button type="button" class="button outline full" data-ip-note-transcript-action="cancel" ${saving ? 'disabled' : ''}>Cancel</button>
      </form>`;
    if (note.transcript) return `${heading}<p class="ip-note-text">${escapeHtml(note.transcript)}</p><button type="button" class="button outline full" data-ip-note-transcript-action="edit">Edit transcript</button>`;
    return `${heading}<p class="helper">Copy the text from Voice Memos or an on-device transcription app on your iPhone.</p><button type="button" class="button outline full" data-ip-note-transcript-action="edit">Paste transcript</button>`;
  }

  updateTranscript(id, focusSelector) {
    const note = this.notes.find(item => item.id === id);
    const section = document.getElementById(`ip-note-transcript-${id}`);
    if (!note || !section) return;
    const moveFocus = focusSelector && (section.contains(document.activeElement) || document.activeElement === document.body);
    section.innerHTML = this.renderTranscript(note);
    if (moveFocus) section.querySelector(focusSelector)?.focus({ preventScroll:true });
  }

  transcriptAction(button) {
    const id = button.closest('[data-ip-note-transcript]').dataset.ipNoteTranscript;
    const note = this.notes.find(item => item.id === id);
    const action = button.dataset.ipNoteTranscriptAction;
    if (!note?.audio || this.transcriptEdits.get(id)?.busy) return;
    if (action === 'cancel') {
      this.transcriptEdits.delete(id);
      this.updateTranscript(id, '[data-ip-note-transcript-action]');
      return;
    }
    if (action === 'edit') {
      this.transcriptEdits.set(id, { draft:note.transcript || '' });
      this.updateTranscript(id, 'textarea');
    }
  }

  async saveTranscript(form) {
    const id = form.dataset.ipNoteTranscriptForm;
    const edit = this.transcriptEdits.get(id);
    if (!edit || edit.busy) return;
    const draft = form.elements.transcript.value;
    const transcript = draft.trim();
    if (!transcript) {
      this.transcriptEdits.set(id, { draft, error:'Enter transcript text before saving.' });
      this.updateTranscript(id, 'textarea');
      return;
    }
    this.transcriptEdits.set(id, { draft, busy:'saving' });
    this.pendingWrites += 1;
    this.updateTranscript(id);
    try {
      const { note } = await this.api(noteUrl(id), {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ transcript }),
      });
      this.notes = this.notes.map(item => item.id === id ? { ...item, transcript:note.transcript } : item);
      this.transcriptEdits.delete(id);
      this.updateTranscript(id, '[data-ip-note-transcript-action]');
      if (document.getElementById(`ip-note-transcript-${id}`)) this.announce('Transcript saved.');
    } catch (error) {
      this.transcriptEdits.set(id, { draft, error:error.message });
      this.updateTranscript(id, 'textarea');
    } finally {
      this.pendingWrites -= 1;
      if (document.querySelector('#ip-note-form')) this.mount();
    }
  }

  updateLibrary() {
    const library = document.querySelector('[data-ip-notes-library]');
    if (library) library.innerHTML = this.renderLibrary();
  }

  get saveDisabled() { return this.needsLoad || this.loading || this.saving || Boolean(this.error); }

  updateSaveButton() {
    const button = document.querySelector('#ip-note-save');
    if (!button) return;
    document.querySelector('#ip-note-campaign').disabled = this.needsLoad || this.loading;
    button.disabled = this.saveDisabled;
    button.textContent = this.saving ? 'Saving note…' : 'Save private note';
  }

  async save(form) {
    if (this.saveDisabled) return;
    const data = new FormData(form);
    const audioSize = data.get('audio')?.size || 0;
    if (!audioSize) data.delete('audio');
    if (!audioSize && !String(data.get('text')).trim()) {
      this.announce('Choose a recording or write a note first.', true);
      form.querySelector('#ip-note-audio')?.focus();
      return;
    }
    if (audioSize > AUDIO_LIMIT) {
      this.announce('Choose a voice recording up to 20 MB.', true);
      form.querySelector('#ip-note-audio')?.focus();
      return;
    }
    this.saving = true;
    this.pendingWrites += 1;
    this.updateSaveButton();
    try {
      const { note } = await this.api(NOTES_URL, { method:'POST', body:data });
      this.notes.unshift(note);
      if (!form.isConnected) return;
      form.reset();
      this.updateLibrary();
      document.getElementById(`ip-note-heading-${note.id}`)?.focus();
      this.announce(note.campaignId ? 'Note saved to your campaign.' : 'Note saved for a future campaign.');
    } catch (error) {
      if (form.isConnected) this.announce(error.message, true);
    } finally {
      this.saving = false;
      this.pendingWrites -= 1;
      this.updateSaveButton();
      if (document.querySelector('#ip-note-form')) this.mount();
    }
  }

  async assign(form) {
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const select = form.elements.campaignId;
    button.disabled = true;
    select.disabled = true;
    this.pendingWrites += 1;
    try {
      const { note } = await this.api(noteUrl(form.dataset.ipNoteAssignment), {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ campaignId:select.value || null }),
      });
      this.notes = this.notes.map(item => item.id === note.id ? { ...item, campaignId:note.campaignId } : item);
      if (!form.isConnected) return;
      const label = form.closest('.ip-note-card').querySelector('[data-ip-note-campaign-label]');
      label.textContent = this.campaigns.find(item => item.id === note.campaignId)?.title || 'Unassigned';
      this.announce(note.campaignId ? 'Campaign updated.' : 'Note is ready for a future campaign.');
    } catch (error) {
      if (form.isConnected) this.announce(error.message, true);
    } finally {
      this.pendingWrites -= 1;
      select.disabled = false;
      button.disabled = false;
      if (document.querySelector('#ip-note-form')) this.mount();
    }
  }
}
