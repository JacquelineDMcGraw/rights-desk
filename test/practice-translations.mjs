import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// A deliberately small browser boundary: exercise controller decisions and
// saved drafts without a DOM library, server, model, or payment service.
const storage = new Map();
const events = [];
const originals = Object.fromEntries(['document', 'localStorage', 'requestAnimationFrame', 'CustomEvent', 'FormData']
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperties(globalThis, {
  document: { configurable: true, value: {
    addEventListener() {},
    querySelector() { return null; },
    dispatchEvent(event) { events.push(event); return true; },
  } },
  localStorage: { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  } },
  requestAnimationFrame: { configurable: true, value: callback => { callback(); return 1; } },
  CustomEvent: { configurable: true, value: class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  } },
  FormData: { configurable: true, value: class FormData {
    constructor(form) { this.fields = form.fields || {}; }
    get(key) { return this.fields[key] ?? null; }
  } },
});

try {
  const { PermissionChanges } = await import('../public/permission-changes.js');
  const calls = [];
  const notices = [];
  const offered = [];
  function controller() {
    return new PermissionChanges({
      api: async () => [],
      jsonPost: async (path, body) => {
        calls.push({ path, body: structuredClone(body) });
        if (path.endsWith('/permission-comparisons')) return {
          id: `cmp_${randomUUID()}`, createdAt: '2026-11-06T12:00:00.000Z',
          permissionText: body.permissionText, requestText: body.requestText, answers: body.answers,
          aiMode: 'ollama', status: 'ready_for_review', questions: [], findings: [], warnings: [],
          proposedChange: { purpose: 'Studio advertising', channels: 'Website and paid social ads', duration: 'Six months', territory: 'United States only' },
        };
        if (path.endsWith('/offer')) return { id: `offer_${randomUUID()}`, amount: body.amount };
        throw new Error(`Unexpected controller request: ${path}`);
      },
      render() {}, announce: message => notices.push(message),
      onOffer: (caseId, offer) => offered.push({ caseId, offer }), onCase() {},
    });
  }
  function setup({ practice = true, questions = [] } = {}) {
    const c = controller();
    const id = `case_${randomUUID()}`;
    const d = c.setPractice(id, practice);
    if (practice) c.resetPractice(d);
    else Object.assign(d, { permissionText: 'Website display permission only.', requestText: 'Studio advertising in the United States for six months.' });
    d.comparison = {
      id: `cmp_${randomUUID()}`, createdAt: '2026-11-06T12:00:00.000Z',
      permissionText: d.permissionText, requestText: d.requestText, answers: {},
      aiMode: 'ollama', status: 'ready_for_review', questions, findings: [], warnings: [],
      proposedChange: { purpose: 'Studio advertising', channels: 'Website and paid social ads', duration: 'Six months', territory: 'United States only' },
    };
    d.stage = 'report';
    return { c, d, item: { id, title: practice ? 'Translation permission' : 'A real review', workType: 'other', practice } };
  }
  function assertNeutralReviewCopy(html) {
    const visibleText = html.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(visibleText, /\b(?:practic\w*|tutorial|fictional|sample|demo)\b/i);
  }
  function click(c, d, attribute, dataset = {}) {
    const button = {
      dataset,
      hasAttribute: name => name === attribute,
      closest: selector => selector === '#permission-flow' ? { dataset: { pcCase: d.caseId } } : null,
    };
    c.handleClick({ target: { closest: selector => selector === 'button' ? button : null } });
  }
  function action(c, d, name) { click(c, d, null, { pcAction: name }); }
  function submit(c, d, id, fields) {
    const form = { id, fields, reportValidity: () => true,
      closest: selector => selector === '#permission-flow' ? { dataset: { pcCase: d.caseId } } : null };
    return c.handleSubmit({ target: form, preventDefault() {} });
  }
  function editCondition(c, d, value) {
    const field = { name: 'conditions', value, type: 'textarea',
      closest: selector => selector === '#permission-flow' ? { dataset: { pcCase: d.caseId } }
        : selector === '#permission-terms-form' ? {} : null };
    c.handleInput({ target: field });
  }
  function editRequest(c, d, value) {
    const field = { name: 'requestText', value, type: 'textarea',
      closest: selector => selector === '#permission-flow' ? { dataset: { pcCase: d.caseId } } : null };
    c.handleInput({ target: field });
  }
  function editRequestDetail(c, d, value) {
    const field = { name: 'request-detail', value, type: 'textarea',
      closest: selector => selector === '#permission-flow' ? { dataset: { pcCase: d.caseId } }
        : selector === '#permission-request-detail-form' ? {} : null };
    c.handleInput({ target: field });
  }
  function chooseRequest(c, d, use) { click(c, d, null, { pcRequestUse: use }); }
  function reviewTranslation(c, d) {
    const decision = d.practiceTranslation;
    submit(c, d, 'permission-answer-form', { answer: decision });
    assert.equal(d.stage, 'answers', 'Choosing a translation option still requires the answer-review screen');
    assert.equal(d.practiceTranslationReviewed, false);
    const answers = c.answerReview(d);
    assert.match(answers, /Save translation decision/);
    assertNeutralReviewCopy(answers);
    click(c, d, 'data-pc-apply-answers');
    assert.equal(d.stage, 'report', 'Saving the practice decision returns to the comparison');
    assert.equal(d.practiceTranslationReviewed, true);
  }

  const starter = setup({ practice: false });
  starter.d.stage = 'request';
  starter.d.requestText = '';
  const starterCalls = calls.length;
  chooseRequest(starter.c, starter.d, 'paid-social');
  assert.equal(starter.d.stage, 'request-detail');
  assert.equal(starter.d.requestText, 'The studio wants to promote the work on its website and in paid social advertisements.');
  assert.equal(starter.d.requestText.includes('six months'), false, 'Real-review starters must leave timing to the creator');
  assert.equal(starter.d.requestText.includes('United States'), false, 'Real-review starters must leave territory to the creator');
  assert.equal(starter.d.requestText.includes('Translation permission'), false, 'Real-review starters must not decide translation');
  assert.equal(starter.d.comparison.requestText, 'Studio advertising in the United States for six months.', 'Choosing a starter does not rewrite a saved comparison');
  assert.equal(calls.length, starterCalls, 'Choosing a starter does not run AI or create an offer');
  action(starter.c, starter.d, 'request');
  chooseRequest(starter.c, starter.d, 'other');
  assert.equal(starter.d.requestText, '', 'Another use clears only an untouched starter');
  assert.equal(starter.d.stage, 'request');
  assert.equal(starter.d.requestUse, '');
  chooseRequest(starter.c, starter.d, 'printed-brochure');
  assert.equal(starter.d.requestText, 'The studio wants to feature the work in a printed brochure.');
  const ownRequest = 'The studio asked to print the work in a brochure distributed at two events.';
  action(starter.c, starter.d, 'request');
  editRequest(starter.c, starter.d, ownRequest);
  chooseRequest(starter.c, starter.d, 'paid-social');
  assert.equal(starter.d.requestText, ownRequest, 'A starter choice must preserve creator-entered wording');
  action(starter.c, starter.d, 'request');
  chooseRequest(starter.c, starter.d, 'other');
  assert.equal(starter.d.requestText, ownRequest, 'Another use must preserve creator-entered wording');
  assert.equal(calls.length, starterCalls);

  const print = setup({ questions: [{ id: 'channels', prompt: 'Where may this appear?' }] });
  print.d.stage = 'request';
  const originalPermission = print.d.permissionText;
  const printCalls = calls.length;
  chooseRequest(print.c, print.d, 'printed-brochure');
  assert.equal(print.d.stage, 'request-detail');
  const brochureQuestion = print.c.render(print.item);
  assert.match(brochureQuestion, /Where will the brochure be handed out\?/);
  assertNeutralReviewCopy(brochureQuestion);
  assert.match(print.d.requestText, /^The studio wants to feature the work in a printed brochure/);
  assert.match(print.d.requestText, /six months.*United States only/);
  assert.equal(print.d.requestText.includes('paid social advertisements'), false);
  assert.equal(print.d.permissionText, originalPermission);
  assert.equal(print.d.practiceTranslation, '');
  assert.equal(print.d.practiceTranslationReviewed, false);
  assert.deepEqual(print.d.answers, {});
  assert.deepEqual(print.d.terms, {});
  assert.equal(calls.length, printCalls, 'A practice choice does not run AI or create an offer');
  assert.deepEqual(offered, []);
  const restoredPrint = controller().setPractice(print.d.caseId, true);
  assert.equal(restoredPrint.requestText, print.d.requestText, 'The chosen practice request survives a draft reload');
  print.d.stage = 'question';
  print.d.questionIndex = 1;
  const printHint = print.c.questionStep(print.d);
  assert.match(printHint, /Printed brochures distributed by the studio/);
  assert.equal(printHint.includes('paid social advertisements'), false);
  click(print.c, print.d, 'data-pc-practice-answer');
  assert.equal(print.d.answers.channels, 'Printed brochures distributed by the studio.');
  print.d.stage = 'request';
  editRequest(print.c, print.d, 'The studio wants to print and distribute 200 brochures at a local event.');
  const customPracticeRequest = print.d.requestText;
  chooseRequest(print.c, print.d, 'paid-social');
  assert.equal(print.d.requestText, customPracticeRequest, 'Practice choices replace only known sample wording');
  assert.equal(calls.length, printCalls);

  const allow = setup();
  const { c, d } = allow;
  assert.match(d.permissionText, /translations.*not part of this agreement/i);
  assert.match(d.requestText, /six months.*United States/i, 'The campaign timing and audience are supplied facts in this example');
  assert.equal(c.questionsFor(d)[0].id, 'translation');
  action(c, d, 'questions');
  const beforeReading = structuredClone(d);
  const reply = c.questionStep(d);
  assert.match(reply, /Studio reply/);
  assertNeutralReviewCopy(reply);
  assert.match(reply, /Spanish translation/);
  assert.match(reply, /Reading the reply does not grant permission/);
  assert.deepEqual(d, beforeReading, 'Reading or rendering the studio reply cannot grant permission');
  assert.equal(d.practiceTranslation, '');
  assert.equal(d.practiceTranslationReviewed, false);
  action(c, d, 'terms');
  assert.equal(d.stage, 'report', 'Terms stay gated until a translation decision is explicitly reviewed');

  action(c, d, 'questions');
  click(c, d, 'data-pc-practice-answer');
  const allowedCondition = d.practiceTranslation;
  assert.match(allowedCondition, /Only a Spanish translation/);
  assert.match(allowedCondition, /reviews and approves it in writing before publication/);
  assert.equal(d.practiceTranslationReviewed, false);
  assert.equal(d.practiceTranslationDeferred, false);
  assert.equal(d.answers.translation, undefined, 'Translation is a separate practice decision, not an AI scope answer');
  assert.equal(d.terms.conditions, undefined, 'Selecting an option does not silently approve or seed the final terms');
  assert.equal(c.questionsFor(d).some(q => q.id === 'translation'), true);
  reviewTranslation(c, d);
  assert.equal(c.questionsFor(d).some(q => q.id === 'translation'), false);
  assert.equal(calls.length, 0, 'A practice decision with no outstanding AI questions needs no network request');

  const reloaded = controller();
  const restored = reloaded.setPractice(d.caseId, true);
  assert.equal(restored.practiceTranslation, allowedCondition);
  assert.equal(restored.practiceTranslationReviewed, true);
  assert.equal(restored.practiceTranslationDeferred, false);
  assert.equal(restored.stage, 'report');
  action(reloaded, restored, 'terms');
  assert.equal(restored.stage, 'terms');
  assert.equal(restored.terms.conditions, allowedCondition, 'First entry carries the reviewed decision into additional conditions');
  assertNeutralReviewCopy(reloaded.render(allow.item));
  submit(reloaded, restored, 'permission-terms-form', { ...restored.terms, baselineConfirmed: 'on', changesReviewed: 'on' });
  assert.equal(restored.stage, 'preview');
  const firstPreview = reloaded.previewStep(restored, allow.item);
  assert.match(firstPreview, /Additional conditions/);
  assert.ok(firstPreview.includes(allowedCondition), 'The buyer preview must contain the exact reviewed translation condition');
  assert.match(firstPreview, /Permission preview · no payment/);
  assertNeutralReviewCopy(firstPreview);

  action(reloaded, restored, 'terms');
  const customCondition = 'Spanish translation only after written approval. Attribution must also remain visible.';
  editCondition(reloaded, restored, customCondition);
  action(reloaded, restored, 'report');
  action(reloaded, restored, 'terms');
  assert.equal(restored.terms.conditions, customCondition, 'Re-entering terms must not overwrite creator-edited conditions');
  submit(reloaded, restored, 'permission-terms-form', { ...restored.terms, baselineConfirmed: 'on', changesReviewed: 'on' });
  assert.ok(reloaded.previewStep(restored, allow.item).includes(customCondition));
  const callCount = calls.length;
  await reloaded.approve(restored);
  assert.equal(restored.stage, 'practice-complete');
  assert.equal(calls.length, callCount, 'Finishing practice must not create an offer, order, or payment');
  assert.deepEqual(offered, []);
  assertNeutralReviewCopy(reloaded.render(allow.item));

  const decline = setup();
  action(decline.c, decline.d, 'questions');
  click(decline.c, decline.d, 'data-pc-translation-decline');
  const declinedCondition = decline.d.practiceTranslation;
  assert.match(declinedCondition, /only in its original language/);
  assert.match(declinedCondition, /Translations are not included/);
  assert.equal(decline.d.practiceTranslationReviewed, false);
  reviewTranslation(decline.c, decline.d);
  action(decline.c, decline.d, 'terms');
  assert.equal(decline.d.terms.conditions, declinedCondition);
  assert.ok(!decline.d.terms.conditions.includes('Only a Spanish translation'), 'Declining must not retain an earlier grant');

  for (const selectBeforeSkipping of [false, true]) {
    const skipped = setup();
    action(skipped.c, skipped.d, 'questions');
    if (selectBeforeSkipping) click(skipped.c, skipped.d, 'data-pc-practice-answer');
    click(skipped.c, skipped.d, 'data-pc-question-skip');
    assert.equal(skipped.d.stage, 'answers');
    click(skipped.c, skipped.d, 'data-pc-apply-answers');
    assert.equal(skipped.d.stage, 'report');
    assert.equal(skipped.d.practiceTranslationDeferred, true);
    assert.equal(skipped.d.practiceTranslationReviewed, false, 'Leaving the question for later must remain unresolved, even after selecting a draft option');
    assert.equal(skipped.c.questionsFor(skipped.d).some(q => q.id === 'translation'), true);
    action(skipped.c, skipped.d, 'terms');
    assert.equal(skipped.d.stage, 'report');
    const recovered = controller().setPractice(skipped.d.caseId, true);
    assert.equal(recovered.practiceTranslationDeferred, true);
    assert.equal(recovered.practiceTranslationReviewed, false);
  }

  const ai = setup({ questions: [{ id: 'territory', prompt: 'Where may this appear?' }] });
  ai.c.setAnswer(ai.d, 'translation', allowedCondition);
  ai.d.answers = { territory: 'United States only', translation: 'Do not send this practice-only field', forged: 'Do not send unknown keys' };
  ai.d.stage = 'answers';
  await ai.c.compare(ai.d);
  const comparisonCall = calls.at(-1);
  assert.ok(comparisonCall.path.endsWith('/permission-comparisons'));
  assert.deepEqual(comparisonCall.body.answers, { territory: 'United States only' });
  assert.equal(comparisonCall.body.practiceTranslation, undefined);
  assert.equal(JSON.stringify(comparisonCall.body).includes(allowedCondition), false);
  assert.equal(ai.d.practiceTranslation, allowedCondition, 'A model comparison cannot drop the separately stored translation decision');

  const real = setup({ practice: false, questions: [{ id: 'territory', prompt: 'Where may this appear?' }] });
  real.d.stage = 'question';
  assert.deepEqual(real.c.questionsFor(real.d).map(q => q.id), ['territory']);
  const realQuestion = real.c.questionStep(real.d);
  assert.equal(realQuestion.includes('pc-studio-reply'), false);
  assert.equal(realQuestion.includes('data-pc-practice-answer'), false);
  assert.equal(realQuestion.includes('data-pc-translation-decline'), false);
  click(real.c, real.d, 'data-pc-practice-answer');
  click(real.c, real.d, 'data-pc-translation-decline');
  assert.equal(real.d.practiceTranslation, '', 'Practice choices cannot be applied to a real review');

  const detail = setup({ practice: false });
  const originalRequest = 'The studio asked to reuse the work in its next promotion.';
  const paidPlatforms = 'Instagram and LinkedIn.';
  const distribution = 'The Philadelphia studio and its November open house.';
  const detailCalls = calls.length;
  action(detail.c, detail.d, 'request');
  editRequest(detail.c, detail.d, originalRequest);
  chooseRequest(detail.c, detail.d, 'paid-social');
  assert.equal(detail.d.stage, 'request-detail');
  assert.equal(detail.d.requestUse, 'paid-social');
  const paidQuestion = detail.c.render(detail.item);
  assert.match(paidQuestion, /id="permission-request-detail-form"/);
  assert.match(paidQuestion, /Which platforms will run the paid ads\?/);
  assert.doesNotMatch(paidQuestion, /Where will the brochure be handed out\?/);
  editRequestDetail(detail.c, detail.d, paidPlatforms);
  action(detail.c, detail.d, 'request');
  assert.equal(detail.d.requestText, originalRequest);
  chooseRequest(detail.c, detail.d, 'printed-brochure');
  assert.equal(detail.d.stage, 'request-detail');
  assert.equal(detail.d.requestUse, 'printed-brochure');
  assert.equal(calls.length, detailCalls, 'The follow-up opens without sending the request to the server');
  const restoredDetailController = controller();
  const restoredDetail = restoredDetailController.setPractice(detail.d.caseId, false);
  assert.equal(restoredDetail.stage, 'request-detail', 'Reload returns to the follow-up question');
  assert.equal(restoredDetail.requestUse, 'printed-brochure');
  assert.equal(restoredDetail.requestDetails['paid-social'], paidPlatforms, 'Backing out of a follow-up keeps its answer');
  const printQuestion = restoredDetailController.render(detail.item);
  assert.match(printQuestion, /Where will the brochure be handed out\?/);
  assert.doesNotMatch(printQuestion, /Which platforms will run the paid ads\?|Instagram and LinkedIn/);

  await submit(restoredDetailController, restoredDetail, 'permission-request-detail-form', { 'request-detail': '' });
  assert.equal(calls.length, detailCalls + 1, 'Comparison still runs if the follow-up is blank');
  assert.equal(calls.at(-1).body.requestText, originalRequest, 'A blank print answer does not reuse the paid platforms');
  assert.equal(restoredDetail.stage, 'report');

  action(restoredDetailController, restoredDetail, 'request');
  chooseRequest(restoredDetailController, restoredDetail, 'printed-brochure');
  await submit(restoredDetailController, restoredDetail, 'permission-request-detail-form', { 'request-detail': distribution });
  assert.equal(calls.length, detailCalls + 2);
  assert.equal(calls.at(-1).body.requestText, `${originalRequest}\n\nBrochure distribution locations: ${distribution}`);
  assert.equal(restoredDetail.requestText, originalRequest, 'Comparing keeps the creator’s original request editable');
  assert.equal(restoredDetailController.sourceChanged(restoredDetail), false, 'The saved comparison includes the current follow-up');

  action(restoredDetailController, restoredDetail, 'request');
  chooseRequest(restoredDetailController, restoredDetail, 'paid-social');
  assert.match(restoredDetailController.render(detail.item), /Instagram and LinkedIn/);
  await submit(restoredDetailController, restoredDetail, 'permission-request-detail-form', { 'request-detail': paidPlatforms });
  assert.equal(calls.length, detailCalls + 3);
  assert.equal(calls.at(-1).body.requestText, `${originalRequest}\n\nPaid ad platforms: ${paidPlatforms}`);

  action(restoredDetailController, restoredDetail, 'request');
  const revisedRequest = 'The studio asked to display the work at its next exhibition.';
  editRequest(restoredDetailController, restoredDetail, revisedRequest);
  await submit(restoredDetailController, restoredDetail, 'permission-source-form', { requestText: revisedRequest });
  assert.equal(calls.length, detailCalls + 4);
  assert.equal(calls.at(-1).body.requestText, revisedRequest, 'Editing the original request deselects the old follow-up for comparison');

  console.log('Practice translations and request follow-ups passed, including explicit translation decisions, separate saved answers, optional blanks, and only the selected detail in the comparison.');
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
