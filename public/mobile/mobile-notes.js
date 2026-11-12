(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const show = (id, visible) => { $(id).hidden = !visible; };
  const maxTranscript = 8000;
  const pending = new Map();
  const requestTimeouts = { importAudio: 10 * 60_000, downloadLanguage: 15 * 60_000, transcribe: 10 * 60_000 };
  let requestNumber = 0;
  let writeQueue = Promise.resolve();
  let draftTimer = 0;
  let busy = '';
  let screen = '';
  let setupReturn = 'notes';
  let setupVisit = 0;
  let setupLanguage = '';
  let downloadPending = false;
  let languageState = 'loading';
  let languages = [];
  let preferredLanguage = '';
  let audioPlaying = '';
  let appInfo = {};
  let state = { version: 1, setupDismissed: false, languageId: '', notes: [], draft: null };

  function transport() {
    return window.webkit?.messageHandlers?.rightsDesk || window.RightsDeskBridge;
  }

  function native(action, data = {}, onProgress) {
    return new Promise((resolve, reject) => {
      const bridge = transport();
      if (!bridge) {
        reject(new Error('Open the Rights Desk phone app to use offline IP notes.'));
        return;
      }
      const id = String(++requestNumber);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('This is taking longer than expected. Please try again.'));
      }, requestTimeouts[action] || 30_000);
      pending.set(id, { resolve, reject, timer, onProgress });
      try {
        bridge.postMessage(JSON.stringify({ id, action, data }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  window.rightsDeskNativeReceive = payload => {
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { return; }
    }
    if (!payload || typeof payload !== 'object') return;
    const request = pending.get(String(payload.id));
    if (!request) return;
    if (typeof payload.progress === 'string') {
      request.onProgress?.(payload.progress);
      return;
    }
    pending.delete(String(payload.id));
    clearTimeout(request.timer);
    if (payload.ok === true) request.resolve(payload.data);
    else request.reject(new Error(typeof payload.error === 'string' ? payload.error : 'Couldn’t complete this action.'));
  };

  window.rightsDeskNativeAudioEnded = audioId => {
    if (audioPlaying !== audioId) return;
    audioPlaying = '';
    updateControls();
    if (screen === 'editor' && $('feedback-text').textContent === 'Playing recording.') message('Playback finished.');
  };

  function message(text = '', error = false, location = 'screen') {
    const inline = location === 'transcription' && screen === 'editor';
    const visibleStatus = $(inline ? 'transcription-feedback' : 'feedback-text');
    visibleStatus.textContent = text;
    visibleStatus.classList.toggle('error', error);
    show('feedback', Boolean(text) && !inline);
    show('transcription-feedback', Boolean(text) && inline);
    $('announcement').textContent = error ? '' : text;
    $('alert').textContent = error ? text : '';
  }

  function focusOn(id) {
    const element = $(id);
    if (!element) return;
    element.scrollIntoView({ block: 'nearest' });
    element.focus({ preventScroll: true });
  }

  function validateState(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Couldn’t read your saved notes.');
    if (!Object.keys(saved).length) return state;
    const validNote = note => note && typeof note.id === 'string' && typeof note.title === 'string'
      && typeof note.transcript === 'string' && typeof note.createdAt === 'string'
      && (note.audio === null || (typeof note.audio?.id === 'string' && typeof note.audio.name === 'string'));
    if (saved.version !== 1 || !Array.isArray(saved.notes) || !saved.notes.every(validNote)
      || (saved.draft && !validNote(saved.draft))) throw new Error('Couldn’t read your saved notes.');
    return {
      version: 1,
      setupDismissed: saved.setupDismissed === true,
      languageId: typeof saved.languageId === 'string' ? saved.languageId : '',
      notes: saved.notes,
      draft: saved.draft || null,
    };
  }

  function writeState(next) {
    const snapshot = JSON.parse(JSON.stringify(next));
    const queued = writeQueue.catch(() => {}).then(() => native('writeState', snapshot));
    writeQueue = queued;
    return queued;
  }

  function cancelDraftTimer() {
    clearTimeout(draftTimer);
    draftTimer = 0;
  }

  function flushDraft() {
    cancelDraftTimer();
    if (!state.draft) return Promise.resolve();
    return writeState(state);
  }

  function flushBackgroundDraft() {
    flushDraft().catch(error => message(`Couldn’t save the draft yet. ${error.message}`, true));
  }

  function queueDraft() {
    cancelDraftTimer();
    draftTimer = setTimeout(flushBackgroundDraft, 450);
  }

  function setBusy(action) {
    busy = action;
    updateControls();
  }

  function updateControls() {
    const locked = Boolean(busy);
    for (const id of ['language-settings', 'skip-setup', 'import-memo', 'write-note', 'resume-draft', 'back-to-notes', 'play-audio', 'stop-audio', 'transcribe', 'change-language', 'confirm-transcribe', 'cancel-transcribe', 'copy-transcript', 'save-note', 'discard-draft', 'confirm-discard', 'cancel-discard']) {
      $(id).disabled = locked;
    }
    $('import-memo').textContent = busy === 'import' ? 'Opening Files…' : 'Import a memo';
    $('save-note').textContent = busy === 'save' ? 'Saving note…' : 'Save private note';
    $('note-title').readOnly = locked;
    $('transcript').readOnly = locked;
    $('note-editor').setAttribute('aria-busy', String(locked));
    for (const button of $('saved-notes').querySelectorAll('button')) button.disabled = locked || Boolean(state.draft);
    updateEditorLanguage();
    updateSetup();
  }

  function selectedEditorLanguage() {
    return languages.find(language => language.id === state.languageId)
      || languages.find(language => language.id === preferredLanguage)
      || languages[0];
  }

  function updateEditorLanguage() {
    const language = selectedEditorLanguage();
    const limit = appInfo.maxTranscriptionMinutes;
    const timeLimit = Number.isFinite(limit) && limit > 0 ? ` Up to ${limit} minutes per transcript.` : '';
    if (language) {
      $('transcription-language').textContent = language.installed
        ? `${language.label} is ready offline.${timeLimit}`
        : `${language.label} needs a download before transcription.${timeLimit}`;
    } else {
      $('transcription-language').textContent = languageState === 'loading'
        ? 'Checking offline transcription…'
        : 'Offline transcription is unavailable right now. You can still type or paste the words below.';
    }
    $('transcribe').textContent = busy === 'transcribe' ? 'Transcribing…' : 'Transcribe on this phone';
    $('transcribe').disabled = Boolean(busy) || !language;
    $('change-language').textContent = language?.installed ? 'Change language' : 'Language setup';
    $('stop-audio').disabled = Boolean(busy) || audioPlaying !== state.draft?.audio?.id;
  }

  function updateSetup() {
    const language = languages.find(item => item.id === setupLanguage);
    $('language').disabled = downloadPending || Boolean(busy);
    $('download-language').disabled = !language || downloadPending || Boolean(busy) || languageState === 'loading';
    $('download-language').textContent = downloadPending ? 'Downloading language…' : language?.installed ? 'Use this language' : 'Download language';
    $('retry-languages').disabled = Boolean(busy) || languageState === 'loading';
    show('retry-languages', languageState === 'error');
    const size = appInfo.languageDownloadBytes;
    const sizeLabel = Number.isFinite(size) && size > 0 ? ` About ${Math.ceil(size / 1_000_000)} MB.` : '';
    if (downloadPending) $('language-status').textContent = 'You can continue while the language downloads.';
    else if (languageState === 'loading') $('language-status').textContent = 'Checking available languages…';
    else if (languageState === 'error') $('language-status').textContent = 'Couldn’t check languages. Try again or skip setup.';
    else if (!language) $('language-status').textContent = 'Offline transcription is unavailable on this device. You can still save notes.';
    else $('language-status').textContent = language.installed ? 'Ready to use offline.' : `Download needed.${sizeLabel}`;
  }

  function updateLanguageOptions() {
    const current = languages.find(language => language.id === setupLanguage) || selectedEditorLanguage();
    setupLanguage = current?.id || '';
    const options = languages.map(language => {
      const option = document.createElement('option');
      option.value = language.id;
      option.textContent = language.installed ? `${language.label} (downloaded)` : language.label;
      return option;
    });
    $('language').replaceChildren(...options);
    $('language').value = setupLanguage;
    show('language-field', Boolean(languages.length));
    updateControls();
  }

  async function refreshLanguages() {
    languageState = 'loading';
    updateControls();
    try {
      const result = await native('getLanguages');
      languages = (Array.isArray(result?.languages) ? result.languages : [])
        .filter(language => language && typeof language.id === 'string' && typeof language.label === 'string');
      preferredLanguage = typeof result?.preferredLanguage === 'string' ? result.preferredLanguage : '';
      languageState = 'ready';
    } catch {
      languageState = 'error';
    } finally {
      updateLanguageOptions();
    }
  }

  async function loadAppInfo() {
    try {
      appInfo = await native('getAppInfo') || {};
      if (appInfo.websiteUrl) {
        const website = new URL(appInfo.websiteUrl);
        if (website.protocol === 'https:' && !website.username && !website.password) {
          $('web-desk-link').href = website.href;
          show('web-desk-link', true);
        }
      }
    } catch { /* Some app builds only expose offline notes. */ }
    updateControls();
  }

  function renderNotes() {
    const library = $('saved-notes');
    library.replaceChildren();
    show('resume-actions', Boolean(state.draft));
    show('new-note-actions', !state.draft);
    show('import-help', !state.draft);
    show('watch-help', !state.draft && Boolean(window.webkit?.messageHandlers?.rightsDesk));
    $('resume-title').textContent = state.draft ? `Draft: ${state.draft.title.trim() || 'Untitled note'}` : '';
    if (!state.notes.length) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = 'Your saved notes will appear here.';
      library.append(empty);
      return;
    }
    for (const note of state.notes) {
      const card = $('note-card-template').content.cloneNode(true);
      const title = card.querySelector('h3');
      title.id = `saved-${note.id}`;
      title.textContent = note.title;
      const date = card.querySelector('time');
      date.dateTime = note.createdAt;
      const created = new Date(note.createdAt);
      date.textContent = Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString(undefined, { dateStyle: 'medium' });
      const filename = card.querySelector('.ip-note-filename');
      filename.hidden = !note.audio;
      filename.textContent = note.audio?.name || '';
      const transcript = card.querySelector('.ip-note-text');
      transcript.hidden = !note.transcript;
      transcript.textContent = note.transcript;
      const open = card.querySelector('button');
      open.setAttribute('aria-label', `Open note: ${note.title}`);
      open.disabled = Boolean(state.draft);
      open.addEventListener('click', () => openSaved(note));
      library.append(card);
    }
  }

  function updateTranscriptField() {
    const length = $('transcript').value.length;
    const hasAudio = Boolean(state.draft?.audio);
    $('transcript-help').textContent = length > maxTranscript
      ? `Shorten the transcript to 8,000 characters to save. It currently has ${length.toLocaleString()} characters.`
      : hasAudio ? 'Edit the text before saving. You can save the recording on its own.' : 'Add the words you want to remember.';
    show('copy-transcript', Boolean($('transcript').value.trim()));
  }

  function renderEditor() {
    const draft = state.draft;
    $('editor-heading').textContent = draft.audio ? 'Review your memo' : 'Write your note';
    $('note-title').value = draft.title;
    $('transcript').value = draft.transcript;
    $('transcript-label').textContent = draft.audio ? 'Transcript' : 'Note text';
    $('transcript').placeholder = draft.audio ? 'Review or type the words here' : 'Write your note here';
    $('recording-name').textContent = draft.audio?.name || '';
    show('recording', Boolean(draft.audio));
    show('replace-confirm', false);
    show('discard-confirm', false);
    updateTranscriptField();
  }

  function showScreen(next, focus) {
    screen = next;
    if (next === 'notes') renderNotes();
    if (next === 'editor') renderEditor();
    show('setup-screen', next === 'setup');
    show('notes-screen', next === 'notes');
    show('editor-screen', next === 'editor');
    show('language-settings', next !== 'setup');
    show('notes-footer', true);
    updateControls();
    if (focus) focusOn(focus);
  }

  function openSetup() {
    setupReturn = screen === 'editor' ? 'editor' : 'notes';
    setupVisit++;
    setupLanguage = selectedEditorLanguage()?.id || '';
    updateLanguageOptions();
    message();
    showScreen('setup', 'setup-heading');
    if (languageState === 'error') refreshLanguages();
  }

  async function finishSetup(languageId) {
    if (busy || screen !== 'setup') return;
    cancelDraftTimer();
    setBusy('setup');
    try {
      const next = { ...state, setupDismissed: true, languageId: languageId || state.languageId };
      await writeState(next);
      state = next;
      showScreen(setupReturn, setupReturn === 'editor' ? 'editor-heading' : 'notes-heading');
      message(languageId ? 'Offline transcription is ready.' : 'You can set up offline transcription later.');
    } catch (error) {
      message(`Couldn’t save language setup. ${error.message}`, true);
    } finally {
      setBusy('');
    }
  }

  async function downloadLanguage() {
    const language = languages.find(item => item.id === setupLanguage);
    if (!language || busy || downloadPending) return;
    if (language.installed) {
      await finishSetup(language.id);
      return;
    }
    const visit = setupVisit;
    const stillHere = () => screen === 'setup' && setupVisit === visit;
    downloadPending = true;
    updateControls();
    message('Downloading the language model…');
    try {
      await native('downloadLanguage', { languageId: language.id }, progress => { if (stillHere()) message(progress); });
      languages = languages.map(item => item.id === language.id ? { ...item, installed: true } : item);
      updateLanguageOptions();
      if (stillHere()) await finishSetup(language.id);
      await refreshLanguages();
    } catch (error) {
      if (stillHere()) message(error.message, true);
    } finally {
      downloadPending = false;
      updateControls();
    }
  }

  function newDraft(audio) {
    const suffix = crypto.getRandomValues(new Uint32Array(2)).join('-');
    const title = audio?.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || '';
    return { id: `note-${Date.now()}-${suffix}`, title, transcript: '', createdAt: new Date().toISOString(), audio };
  }

  async function importMemo() {
    if (busy || state.draft) return;
    setBusy('import');
    message();
    try {
      const file = await native('importAudio', {}, progress => message(progress));
      if (file?.cancelled) return;
      if (typeof file?.id !== 'string' || typeof file.name !== 'string') throw new Error('Couldn’t open this recording.');
      state.draft = newDraft({ id: file.id, name: file.name });
      showScreen('editor', 'editor-heading');
      message('Recording imported. You can transcribe it now or save it for later.');
      await flushDraft();
    } catch (error) {
      message(error.message, true);
    } finally {
      setBusy('');
    }
  }

  function startWriting() {
    if (busy || state.draft) return;
    state.draft = newDraft(null);
    message();
    showScreen('editor', 'note-title');
  }

  function openSaved(note) {
    if (busy || state.draft) return;
    state.draft = { ...note };
    message();
    showScreen('editor', 'editor-heading');
  }

  async function runTranscription(replace = false) {
    const audio = state.draft?.audio;
    if (!audio || busy) return;
    const language = selectedEditorLanguage();
    if (!language?.installed) {
      openSetup();
      return;
    }
    if (!replace && state.draft.transcript.trim()) {
      show('replace-confirm', true);
      focusOn('confirm-transcribe');
      return;
    }
    show('replace-confirm', false);
    setBusy('transcribe');
    message('Transcribing on this phone…', false, 'transcription');
    let failed = false;
    try {
      const result = await native('transcribe', { audioId: audio.id, languageId: language.id }, progress => message(progress, false, 'transcription'));
      if (typeof result?.transcript !== 'string' || !result.transcript.trim()) throw new Error('No speech was recognized. Check the recording and the spoken language.');
      state.draft.transcript = result.transcript.trim();
      $('transcript').value = state.draft.transcript;
      updateTranscriptField();
      await flushDraft();
      message('Transcript ready. Review the wording before saving.', false, 'transcription');
      focusOn('transcript');
    } catch (error) {
      failed = true;
      message(error.message, true, 'transcription');
    } finally {
      setBusy('');
      if (failed) {
        $('transcribe').focus({ preventScroll: true });
        $('transcription-feedback').scrollIntoView({ block: 'nearest' });
      }
    }
  }

  async function stopAudio() {
    if (!audioPlaying) return;
    await native('stopAudio', { audioId: audioPlaying });
    audioPlaying = '';
    updateControls();
  }

  async function playback(action) {
    const audio = state.draft?.audio;
    if (!audio || busy) return;
    setBusy('playback');
    try {
      if (action === 'stop') {
        await stopAudio();
        message('Playback stopped.');
      } else {
        await native('playAudio', { audioId: audio.id });
        audioPlaying = audio.id;
        message('Playing recording.');
      }
    } catch (error) {
      message(error.message, true);
    } finally {
      setBusy('');
    }
  }

  async function backToNotes() {
    if (busy) return;
    setBusy('back');
    try {
      await stopAudio().catch(() => {});
      const draft = state.draft;
      const saved = state.notes.find(note => note.id === draft?.id);
      const hasEdits = saved
        ? draft.title !== saved.title || draft.transcript !== saved.transcript
        : Boolean(draft?.audio || draft?.title.trim() || draft?.transcript.trim());
      if (hasEdits) await flushDraft();
      else {
        cancelDraftTimer();
        const next = { ...state, draft: null };
        await writeState(next);
        state = next;
      }
      showScreen('notes', 'saved-heading');
      message();
    } catch (error) {
      message(error.message, true);
    } finally {
      setBusy('');
    }
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!state.draft || busy) return;
    const title = $('note-title').value.trim();
    const transcript = $('transcript').value.trim();
    if (!title) { message('Give your note a title before saving.', true); focusOn('note-title'); return; }
    if (!state.draft.audio && !transcript) { message('Add some note text before saving.', true); focusOn('transcript'); return; }
    if (transcript.length > maxTranscript) { message('Shorten the transcript to 8,000 characters to save.', true); focusOn('transcript'); return; }
    const saved = { ...state.draft, title, transcript };
    const existing = state.notes.some(note => note.id === saved.id);
    const notes = existing ? state.notes.map(note => note.id === saved.id ? saved : note) : [saved, ...state.notes];
    const next = { ...state, notes, draft: null };
    cancelDraftTimer();
    setBusy('save');
    try {
      await stopAudio().catch(() => {});
      await writeState(next);
      state = next;
      showScreen('notes', `saved-${saved.id}`);
      message('Private note saved on this device.');
    } catch (error) {
      message(`Couldn’t save this note. ${error.message}`, true);
    } finally {
      setBusy('');
    }
  }

  async function discardDraft() {
    if (!state.draft || busy) return;
    const draft = state.draft;
    const next = { ...state, draft: null };
    cancelDraftTimer();
    setBusy('discard');
    try {
      await stopAudio().catch(() => {});
      await writeState(next);
      state = next;
      if (draft.audio && !state.notes.some(note => note.audio?.id === draft.audio.id)) {
        native('deleteAudio', { audioId: draft.audio.id }).catch(() => {});
      }
      showScreen('notes', 'saved-heading');
      message('Draft discarded.');
    } catch (error) {
      message(`Couldn’t discard the draft. ${error.message}`, true);
    } finally {
      setBusy('');
    }
  }

  async function copyText() {
    const field = $('transcript');
    const text = field.value.trim();
    if (!text) return;
    try {
      if (appInfo.platform === 'ios' || appInfo.platform === 'android') await native('copyText', { text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        field.focus();
        field.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      }
      message('Text copied.');
    } catch {
      field.focus();
      field.select();
      message('Use your phone’s text selection menu to copy the selected words.');
    }
  }

  async function initialize() {
    show('initial-actions', false);
    if (!transport()) {
      message('Open the Rights Desk phone app to use offline IP notes.');
      return;
    }
    message('Opening your notes…');
    try {
      state = validateState(await native('readState'));
      message();
      showScreen(state.setupDismissed ? (state.draft ? 'editor' : 'notes') : 'setup');
      if (!state.setupDismissed) setupReturn = state.draft ? 'editor' : 'notes';
      refreshLanguages();
      loadAppInfo();
    } catch (error) {
      message(error.message, true);
      show('initial-actions', true);
    }
  }

  $('language-settings').addEventListener('click', openSetup);
  $('web-desk-link').addEventListener('click', event => {
    event.preventDefault();
    native('openWebsite').catch(error => message(error.message, true));
  });
  $('language').addEventListener('change', event => { setupLanguage = event.target.value; updateSetup(); });
  $('retry-languages').addEventListener('click', refreshLanguages);
  $('download-language').addEventListener('click', downloadLanguage);
  $('skip-setup').addEventListener('click', () => finishSetup());
  $('retry-open').addEventListener('click', initialize);
  $('import-memo').addEventListener('click', importMemo);
  $('write-note').addEventListener('click', startWriting);
  $('resume-draft').addEventListener('click', () => { message(); showScreen('editor', 'editor-heading'); });
  $('back-to-notes').addEventListener('click', backToNotes);
  $('note-title').addEventListener('input', event => { state.draft.title = event.target.value; queueDraft(); });
  $('transcript').addEventListener('input', event => { state.draft.transcript = event.target.value; updateTranscriptField(); queueDraft(); });
  $('note-editor').addEventListener('submit', saveNote);
  $('transcribe').addEventListener('click', () => runTranscription());
  $('confirm-transcribe').addEventListener('click', () => runTranscription(true));
  $('cancel-transcribe').addEventListener('click', () => { show('replace-confirm', false); focusOn('transcribe'); });
  $('change-language').addEventListener('click', openSetup);
  $('play-audio').addEventListener('click', () => playback('play'));
  $('stop-audio').addEventListener('click', () => playback('stop'));
  $('copy-transcript').addEventListener('click', copyText);
  $('discard-draft').addEventListener('click', () => {
    const isSaved = state.notes.some(note => note.id === state.draft?.id);
    $('discard-message').textContent = isSaved ? 'Discard these edits and keep your saved note?' : 'Discard this draft?';
    show('discard-confirm', true);
    focusOn('confirm-discard');
  });
  $('confirm-discard').addEventListener('click', discardDraft);
  $('cancel-discard').addEventListener('click', () => { show('discard-confirm', false); focusOn('discard-draft'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && draftTimer) flushBackgroundDraft(); });
  initialize();
})();
