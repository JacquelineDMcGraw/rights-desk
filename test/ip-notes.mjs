import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A short, silent AAC recording in an M4A container.
const recording = Buffer.from(
  'AAAAIGZ0eXBNNEEgAAACAE00QSBpc282aXNvbWlzbzIAAAKpbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAAAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAat0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAEBAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAFHbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAfQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHNvdW4AAAAAAAAAAAAAAABTb3VuZEhhbmRsZXIAAAAA8m1pbmYAAAAQc21oZAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAtnN0YmwAAABqc3RzZAAAAAAAAAABAAAAWm1wNGEAAAAAAAAAAQAAAAAAAAAAAAEAEAAAAAAfQAAAAAAANmVzZHMAAAAAA4CAgCUAAQAEgICAF0AVAAAAAAC7gAAAu4AFgICABRWIVuUABoCAgAECAAAAEHN0dHMAAAAAAAAAAAAAABBzdHNjAAAAAAAAAAAAAAAUc3RzegAAAAAAAAAAAAAAAAAAABBzdGNvAAAAAAAAAAAAAAAobXZleAAAACB0cmV4AAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDEAAAB8bW9vZgAAABBtZmhkAAAAAAAAAAEAAABkdHJhZgAAACR0ZmhkAAAAOQAAAAEAAAAAAAACyQAABAAAAAAVAgAAAAAAABR0ZmR0AQAAAAAAAAAAAAAAAAAAJHRydW4AAAMBAAAAAgAAAIQAAAQAAAAAFQAAAeAAAAAEAAAAIW1kYXTeAgBMYXZjNjIuMjguMTAxAAIwQA4BGCAHAAAAQ21mcmEAAAArdGZyYQEAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAALJAQEBAAAAEG1mcm8AAAAAAAAAQw==',
  'base64',
);

const owner = randomUUID();
const other = randomUUID();
const ownedCase = { id: `case_${randomUUID()}`, title: 'A private review', sessionId: owner };
const practiceCase = { id: `case_${randomUUID()}`, title: 'An example', sessionId: owner, practice: true };
const foreignCase = { id: `case_${randomUUID()}`, title: 'Another creator’s review', sessionId: other };
const ownedListing = { id: `img_${randomUUID()}`, title: 'A public listing', sessionId: owner, createdAt: new Date().toISOString() };
const foreignListing = { id: `img_${randomUUID()}`, title: 'Another creator’s listing', sessionId: other, createdAt: new Date().toISOString() };
const dataDir = await mkdtemp(join(tmpdir(), 'rights-desk-ip-notes-test-'));
const port = 56100 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const storePath = join(dataDir, 'store.json');
await writeFile(storePath, JSON.stringify({
  version: 1,
  cases: { [ownedCase.id]: ownedCase, [practiceCase.id]: practiceCase, [foreignCase.id]: foreignCase },
  listings: { [ownedListing.id]: ownedListing, [foreignListing.id]: foreignListing },
  uploads: {}, quotes: {}, orders: {}, licenses: {},
}));

const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), RIGHTS_DESK_KEYCHAIN: '0', RIGHTS_DESK_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErrors = '';
server.stderr.on('data', chunk => { serverErrors += chunk; });

function call(path, { sid = owner, method = 'GET', body, headers = {} } = {}) {
  return fetch(base + path, {
    method, body, headers: { cookie: `rd_session=${sid}`, ...headers },
    signal: AbortSignal.timeout(5000),
  });
}

function noteForm({ campaignId, text, audio } = {}) {
  const form = new FormData();
  form.set('title', 'Private licensing idea');
  if (campaignId !== undefined) form.set('campaignId', campaignId);
  if (text !== undefined) form.set('text', text);
  if (audio) form.set('audio', new Blob([audio], { type: 'application/octet-stream' }), 'Watch note.M4A');
  return form;
}

function createNote(fields, sid) {
  return call('/api/ip-notes', { sid, method: 'POST', body: noteForm(fields) });
}

function attachNote(id, campaignId, { sid, origin } = {}) {
  return call(`/api/ip-notes/${id}`, {
    sid, method: 'PATCH', body: JSON.stringify({ campaignId }),
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  });
}

try {
  let initial;
  for (let attempt = 0; attempt < 80 && !initial; attempt++) {
    try { initial = await call('/api/ip-notes'); }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(initial?.status, 200, serverErrors);
  assert.deepEqual(await initial.json(), {
    notes: [],
    campaigns: [
      { id: ownedCase.id, title: ownedCase.title, kind: 'case' },
      { id: ownedListing.id, title: ownedListing.title, kind: 'listing' },
    ],
  });
  assert.equal((await createNote()).status, 400);
  assert.equal((await createNote({ audio: Buffer.from('Renamed text') })).status, 415);
  for (const campaign of [practiceCase, foreignCase, foreignListing]) {
    assert.equal((await createNote({ campaignId: campaign.id, text: 'Private draft' })).status, 404);
  }

  const writtenNote = 'Ask before offering paid use.';
  const imported = await createNote({ audio: recording, text: writtenNote });
  assert.equal(imported.status, 201);
  const { note } = await imported.json();
  assert.deepEqual(note.audio, { filename: 'Watch note.m4a', contentType: 'audio/mp4', size: recording.length });
  assert.equal(note.campaignId, null);
  assert.equal(note.text, writtenNote);
  assert.equal(note.transcript, '');
  assert.equal(Object.hasOwn(note, 'sessionId'), false);

  const audioPath = `/api/ip-notes/${note.id}/audio`;
  assert.equal((await call(audioPath, { sid: other, headers: { range: 'bytes=0-1' } })).status, 404);
  const complete = await call(audioPath);
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get('cache-control'), 'private, no-store');
  assert.equal(complete.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await complete.arrayBuffer()), recording);
  const range = await call(audioPath, { headers: { range: 'bytes=0-1' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-1/${recording.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), recording.subarray(0, 2));
  assert.equal((await call(audioPath, { headers: { range: 'bytes=99999-' } })).status, 416);
  const head = await call(audioPath, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(recording.length));

  const reviewedTranscript = 'Save this idea for the next campaign.';
  const transcriptUpdate = {
    method: 'PATCH', body: JSON.stringify({ transcript: reviewedTranscript }),
    headers: { 'content-type': 'application/json' },
  };
  const notePath = `/api/ip-notes/${note.id}`;
  assert.equal((await call(notePath, { ...transcriptUpdate, sid: other })).status, 404);
  assert.equal((await call(notePath, { ...transcriptUpdate, headers: { ...transcriptUpdate.headers, origin: 'https://outside.example' } })).status, 403);
  const reviewed = await call(notePath, transcriptUpdate);
  assert.equal(reviewed.status, 200);
  const { note: editedNote } = await reviewed.json();
  assert.equal(editedNote.transcript, reviewedTranscript);
  assert.equal(editedNote.text, writtenNote);
  assert.deepEqual(editedNote.audio, note.audio);

  assert.equal((await attachNote(note.id, ownedListing.id, { sid: other })).status, 404);
  assert.equal((await attachNote(note.id, ownedListing.id, { origin: 'https://outside.example' })).status, 403);
  assert.equal((await attachNote(note.id, foreignListing.id)).status, 404);
  assert.equal((await attachNote(note.id, foreignCase.id)).status, 404);
  for (const campaignId of [ownedCase.id, ownedListing.id, null]) {
    const linked = await attachNote(note.id, campaignId);
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).note.campaignId, campaignId);
    const inbox = await call('/api/ip-notes');
    assert.equal((await inbox.json()).notes.find(item => item.id === note.id).campaignId, campaignId);
  }

  const textOnly = await createNote({ campaignId: ownedListing.id, text: 'Private transcript' });
  assert.equal(textOnly.status, 201);
  const { note: textNote } = await textOnly.json();
  assert.equal(textNote.audio, null);
  assert.equal((await call(`/api/ip-notes/${textNote.id}`, transcriptUpdate)).status, 404);
  assert.equal(textNote.campaignId, ownedListing.id);
  assert.equal((await call(`/api/ip-notes/${textNote.id}/audio`)).status, 404);
  assert.deepEqual((await (await call('/api/ip-notes', { sid: other })).json()).notes, []);
  const listings = await (await call('/api/listings', { sid: other })).text();
  assert.ok(listings.includes(ownedListing.title));
  assert.ok(!listings.includes(textNote.id) && !listings.includes(textNote.text));
  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(persisted.ipNotes[note.id].campaignId, null);
  assert.equal(persisted.ipNotes[note.id].text, writtenNote);
  assert.equal(persisted.ipNotes[note.id].transcript, reviewedTranscript);
  assert.equal(persisted.ipNotes[textNote.id].campaignId, ownedListing.id);
  console.log('Private IP notes integration passed.');
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
}
