/**
 * Evidence inspection for Rights Desk.
 *
 * This module records limited, reviewable signals. EXIF is editable, Content
 * Credentials describe signed claims rather than human authorship, and a
 * visual model cannot reliably determine whether an image was generated.
 * Callers must never treat `needs_review` as an automated authenticity verdict.
 *
 * `declaration.serverReview` is reserved for a decision loaded by the server
 * from its own reviewer records. Never copy that field from an upload request.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { basename, delimiter, extname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXIF_TIMEOUT_MS = 8_000;
const C2PA_TIMEOUT_MS = 12_000;
const VISION_TIMEOUT_MS = 14_000;
const MAX_IMAGE_BYTES_FOR_VISION = 12 * 1024 * 1024;
const RAW_EXTENSIONS = new Set([
  '.3fr', '.arw', '.cr2', '.cr3', '.dng', '.erf', '.iiq', '.k25',
  '.kdc', '.mef', '.mos', '.mrw', '.nef', '.nrw', '.orf', '.pef',
  '.raf', '.raw', '.rw2', '.sr2', '.srf', '.srw', '.x3f',
]);

function signal(code, label, detail, level = 'information') {
  return { code, label, detail, level };
}

async function findTool(name) {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...String(process.env.PATH || '').split(delimiter).filter(Boolean).map((dir) => join(dir, name)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* try next location */ }
  }
  return null;
}

async function runTool(binary, args, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    // Do not return arguments, file paths, or raw tool output to the UI.
    return {
      ok: false,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
      timedOut: error.killed === true || error.code === 'ETIMEDOUT',
    };
  }
}

async function assertImageFile(path, label) {
  if (typeof path !== 'string' || !path) {
    throw new TypeError(`${label} must be a nonempty file path`);
  }
  let file;
  try { file = await stat(path); } catch {
    throw new TypeError(`${label} must point to a readable file`);
  }
  if (!file.isFile() || file.size === 0) {
    throw new TypeError(`${label} must be a nonempty regular file`);
  }
  return file;
}

function field(metadata, name) {
  const key = Object.keys(metadata || {}).find((item) => item.split(':').at(-1) === name);
  return key ? metadata[key] : undefined;
}

async function readExif(binary, path) {
  if (!binary) return { state: 'unavailable', metadata: null };
  const result = await runTool(binary, [
    '-json', '-G1', '-n', '-Make', '-Model', '-DateTimeOriginal',
    '-CreateDate', '-Software', '-FileType', '-ImageWidth', '-ImageHeight',
    '-DigitalSourceType', path,
  ], EXIF_TIMEOUT_MS);
  if (!result.ok) return { state: result.timedOut ? 'timeout' : 'error', metadata: null };
  try {
    const parsed = JSON.parse(result.stdout);
    return { state: 'checked', metadata: Array.isArray(parsed) ? parsed[0] || {} : {} };
  } catch {
    return { state: 'error', metadata: null };
  }
}

function visit(value, onPair, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 16) return;
  for (const [key, child] of Object.entries(value)) {
    onPair(key, child);
    if (child && typeof child === 'object') visit(child, onPair, depth + 1);
  }
}

function inspectManifest(report) {
  if (!report || typeof report !== 'object') return null;
  const active = report.active_manifest || report.activeManifest;
  const manifests = report.manifests;
  const manifest = typeof active === 'string'
    ? manifests?.[active]
    : (active && typeof active === 'object' ? active : null);
  if (!manifest) return null;

  let aiSourceRecorded = false;
  let captureRecorded = false;
  let validationProblem = false;
  const sourceTypeValues = [];
  const actions = [];

  visit(manifest, (key, value) => {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z]/g, '');
    if (normalizedKey === 'digitalsourcetype' && typeof value === 'string') {
      sourceTypeValues.push(value.toLowerCase());
    }
    if (normalizedKey === 'action' && typeof value === 'string') {
      actions.push(value.toLowerCase());
    }
  });

  aiSourceRecorded = sourceTypeValues.some((value) =>
    /trainedalgorithmicmedia|algorithmicmedia|generativeai|aigenerated/.test(value),
  ) || actions.some((value) => /generated|ai[-_.]?edit/.test(value));

  captureRecorded = sourceTypeValues.some((value) => /digitalcapture/.test(value))
    || actions.some((value) => /c2pa\.captur/.test(value));

  const validation = report.validation_status || report.validationStatus || [];
  if (Array.isArray(validation) && validation.length > 0) validationProblem = true;
  // Some c2patool versions expose failed checks under validation_results.
  const results = report.validation_results || report.validationResults;
  visit(results, (key, value) => {
    if ((key === 'status' || key === 'code') && typeof value === 'string'
      && /fail|error|invalid|tamper/i.test(value)) validationProblem = true;
    if (key === 'success' && value === false) validationProblem = true;
  });

  return { aiSourceRecorded, captureRecorded, validationProblem };
}

async function readC2pa(binary, path) {
  if (!binary) return { state: 'unavailable', evidence: null };
  const result = await runTool(binary, [path], C2PA_TIMEOUT_MS);
  const output = `${result.stdout}\n${result.stderr}`;
  if (/No claim found/i.test(output)) return { state: 'no_claim', evidence: null };
  if (!result.ok) return { state: result.timedOut ? 'timeout' : 'error', evidence: null };
  try {
    const report = JSON.parse(result.stdout);
    const evidence = inspectManifest(report);
    return { state: evidence ? 'checked' : 'no_claim', evidence };
  } catch {
    return { state: 'error', evidence: null };
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function declaredAiUse(declaration) {
  const values = [
    declaration?.aiUsed,
    declaration?.generativeAiUsed,
    declaration?.usesAI,
    declaration?.aiUse,
    declaration?.origin,
    declaration?.claim,
  ];
  return values.some((value) => value === true
    || (typeof value === 'string' && /^(yes|used|generated|ai[_ -]?generated|ai[_ -]?assisted)$/i.test(value.trim())));
}

function explicitNoAi(declaration) {
  const values = [declaration?.aiUsed, declaration?.generativeAiUsed, declaration?.usesAI, declaration?.aiUse, declaration?.claim];
  return values.some((value) => value === false
    || (typeof value === 'string' && /^(no|none|camera|camera[_ -]?only)$/i.test(value.trim())));
}

function cleanedNote(value) {
  return String(value || '').replaceAll(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 350);
}

async function optionalVisionReview(path, fileSize) {
  if (fileSize > MAX_IMAGE_BYTES_FOR_VISION) {
    return { state: 'skipped', note: 'Visual review skipped because the preview exceeds the local model size limit.' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const tagsResponse = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
      if (!tagsResponse.ok) return { state: 'unavailable', note: 'Local visual reviewer is unavailable.' };
      const tags = await tagsResponse.json();
      const installed = Array.isArray(tags.models) && tags.models.some((item) =>
        String(item.name || item.model || '').startsWith('gemma3:4b'));
      if (!installed) return { state: 'unavailable', note: 'The local gemma3:4b visual reviewer is not installed.' };

      const image = (await readFile(path)).toString('base64');
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gemma3:4b',
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          images: [image],
          prompt: 'Review this image only for visible details a human provenance reviewer may want to inspect. Do not decide whether it is AI-generated or authentic; pixels cannot establish that. Return JSON with one concise "note" (maximum 180 characters) and one concise "question" (maximum 130 characters). Do not identify people, infer sensitive attributes, or claim camera provenance.',
        }),
      });
      if (!response.ok) return { state: 'error', note: 'Local visual reviewer could not complete the review.' };
      const result = await response.json();
      let answer;
      try { answer = JSON.parse(result.response || '{}'); } catch { answer = {}; }
      const note = cleanedNote(answer.note);
      const question = cleanedNote(answer.question);
      if (!note && !question) return { state: 'error', note: 'Local visual reviewer returned no usable note.' };
      return {
        state: 'checked',
        note: `Visual model suggestion only: ${note || 'Inspect the image manually.'}`,
        question: question || undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { state: 'unavailable', note: 'Local visual reviewer is unavailable.' };
  }
}

/** Inspect an uploaded preview and optional source original. */
export async function inspectEvidence({ previewPath, sourcePath, declaration = {} } = {}) {
  const previewFile = await assertImageFile(previewPath, 'previewPath');
  const sourceFile = sourcePath ? await assertImageFile(sourcePath, 'sourcePath') : null;
  const [exifBinary, c2paBinary] = await Promise.all([findTool('exiftool'), findTool('c2patool')]);
  const [previewExif, sourceExif, previewC2pa, sourceC2pa, aiReview] = await Promise.all([
    readExif(exifBinary, previewPath),
    sourcePath ? readExif(exifBinary, sourcePath) : Promise.resolve(null),
    readC2pa(c2paBinary, previewPath),
    sourcePath ? readC2pa(c2paBinary, sourcePath) : Promise.resolve(null),
    optionalVisionReview(previewPath, previewFile.size),
  ]);

  const signals = [];
  const c2paItems = [previewC2pa, sourceC2pa].filter(Boolean);
  const c2paEvidence = c2paItems.map((item) => item.evidence).filter(Boolean);
  const aiRecorded = c2paEvidence.some((item) => item.aiSourceRecorded);
  const captured = c2paEvidence.some((item) => item.captureRecorded);
  const validationProblem = c2paEvidence.some((item) => item.validationProblem);
  const claimedAi = declaredAiUse(declaration);

  if (claimedAi) {
    signals.push(signal('ai_self_disclosed', 'AI use disclosed',
      'The uploader disclosed AI use. This is a declaration, not independent verification.', 'information'));
  } else if (explicitNoAi(declaration)) {
    signals.push(signal('no_ai_self_declared', 'No AI use declared',
      'The uploader declared no AI use. That declaration has not been verified.', 'caution'));
  }

  if (c2paEvidence.length > 0) {
    signals.push(signal('content_credentials', 'Content Credentials present',
      'A signed provenance record is present. It records claims and does not establish human authorship.',
      validationProblem ? 'caution' : 'supporting'));
  } else if (c2paItems.every((item) => item.state === 'no_claim')) {
    signals.push(signal('no_content_credentials', 'No Content Credentials found',
      'No embedded Content Credentials were found in the submitted files.', 'information'));
  }
  if (validationProblem) {
    signals.push(signal('content_credentials_warning', 'Credential validation needs review',
      'The provenance tool reported a validation problem. A reviewer should inspect the original report.', 'caution'));
  }
  if (captured) {
    signals.push(signal('capture_recorded', 'Capture action recorded',
      'Content Credentials record a digital capture action. A reviewer must still assess the full editing chain.', 'supporting'));
  }
  if (aiRecorded) {
    signals.push(signal('ai_source_recorded', 'AI source recorded',
      'Content Credentials record algorithmic or generative media in the provenance chain.', 'caution'));
  }

  const sourceMeta = sourceExif?.metadata;
  const previewMeta = previewExif.metadata;
  const cameraMake = field(sourceMeta, 'Make') || field(previewMeta, 'Make');
  const cameraModel = field(sourceMeta, 'Model') || field(previewMeta, 'Model');
  const captureDate = field(sourceMeta, 'DateTimeOriginal') || field(previewMeta, 'DateTimeOriginal');
  const hasCameraExif = Boolean(cameraMake && cameraModel && captureDate);
  if (hasCameraExif) {
    signals.push(signal('camera_exif', 'Camera metadata present',
      'Camera make, model, and capture time fields are present. EXIF fields can be edited.', 'supporting'));
  }
  if (sourcePath) {
    const rawLike = RAW_EXTENSIONS.has(extname(basename(sourcePath)).toLowerCase());
    signals.push(signal('source_submitted', rawLike ? 'RAW source supplied' : 'Source file supplied',
      rawLike ? 'A RAW-format source was supplied for human review. File extension alone does not prove origin.'
        : 'A source file was supplied for human review. Its relationship to the preview must be assessed.', 'supporting'));
    const [sourceHash, previewHash] = await Promise.all([sha256(sourcePath), sha256(previewPath)]);
    if (sourceHash === previewHash) {
      signals.push(signal('identical_files', 'Source matches preview byte for byte',
        'The supplied source and preview are identical; this does not establish an editing history.', 'information'));
    } else if (sourceMeta && previewMeta) {
      const sourceDate = field(sourceMeta, 'DateTimeOriginal');
      const previewDate = field(previewMeta, 'DateTimeOriginal');
      const sourceModel = field(sourceMeta, 'Model');
      const previewModel = field(previewMeta, 'Model');
      if ((sourceDate && previewDate && sourceDate !== previewDate)
        || (sourceModel && previewModel && sourceModel !== previewModel)) {
        signals.push(signal('metadata_mismatch', 'Source and preview metadata differ',
          'Capture time or camera model fields differ between files. A reviewer should check why.', 'caution'));
      }
    }
  }

  const recordedAndUndisclosed = aiRecorded && !claimedAi;
  if (recordedAndUndisclosed) {
    signals.push(signal('ai_disclosure_mismatch', 'AI disclosure needs clarification',
      'The recorded AI source is not reflected in the uploader declaration.', 'caution'));
  }

  let status;
  let summary;
  if (claimedAi) {
    status = 'ai_disclosed';
    summary = 'AI use is disclosed. The provenance evidence and permitted license terms still need human review.';
  } else if (aiRecorded) {
    status = 'needs_review';
    summary = 'Content Credentials record an AI source, but the uploader has not disclosed it. Clarification is required before licensing.';
  } else if (validationProblem || sourcePath || captured || hasCameraExif) {
    status = 'needs_review';
    summary = 'Capture evidence is available for review. Rights Desk has not verified human authorship.';
  } else {
    status = 'unverified';
    summary = 'There is not enough origin evidence to document this as a camera capture.';
  }

  // The server must load this from a trusted reviewer record; never accept it
  // from an untrusted upload body. An approval still does not prove authorship.
  const serverReview = declaration?.serverReview;
  if (status === 'needs_review' && sourcePath && !validationProblem
    && serverReview?.decision === 'documented_capture'
    && typeof serverReview?.reviewerId === 'string' && serverReview.reviewerId.trim()) {
    status = 'documented_capture';
    summary = 'A reviewer approved the submitted capture evidence. This documents the review, not absolute proof of human authorship.';
    signals.push(signal('human_review', 'Human review completed',
      'A reviewer approved the evidence for the documented capture label.', 'supporting'));
  }

  return {
    status,
    summary,
    signals,
    aiReview,
    tools: {
      c2pa: c2paBinary ? (c2paItems.some((item) => item.state === 'error' || item.state === 'timeout')
        ? 'error' : 'available') : 'unavailable',
      exif: exifBinary ? ([previewExif, sourceExif].filter(Boolean).some((item) => item.state === 'error' || item.state === 'timeout')
        ? 'error' : 'available') : 'unavailable',
      vision: aiReview.state,
    },
  };
}
