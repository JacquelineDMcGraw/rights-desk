import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const USER_AGENT = 'RightsDeskHackathon/0.1 (local creator research; public API requests)';
const MAX_CANDIDATES_PER_QUERY = 4;
const MAX_CANDIDATES_PER_SOURCE = 8;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const API_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 6500;

const SOURCES = [
  { name: 'Openverse', api: 'https://api.openverse.org/v1/', description: 'Open-licensed images indexed by Openverse' },
  { name: 'Wikimedia Commons', api: 'https://commons.wikimedia.org/w/api.php', description: 'Files and metadata on Wikimedia Commons' },
  { name: 'Library of Congress', api: 'https://www.loc.gov/apis/', description: 'Digitized photos in the Library of Congress catalog' },
];

function safeHttps(value, allowedHosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (allowedHosts && !allowedHosts.includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function plain(value, max = 200) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot|lt|gt);/gi, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[entity.toLowerCase()] || ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

function storyKeywords(story) {
  const stop = new Set(['about', 'after', 'along', 'also', 'been', 'before', 'from', 'have', 'into', 'just', 'like', 'near', 'only', 'over', 'that', 'them', 'then', 'there', 'these', 'this', 'through', 'under', 'very', 'when', 'where', 'which', 'while', 'with', 'your', 'photo', 'image', 'picture', 'someone', 'using', 'used', 'without', 'copyright', 'licensed', 'license', 'website']);
  const words = String(story || '').replace(/https?:\/\/\S+|\b\S+@\S+\b/g, ' ').toLowerCase().match(/[a-z]{4,}/g) || [];
  return [...new Set(words.filter(word => !stop.has(word)))].slice(0, 7).join(' ').slice(0, 80);
}

async function localVisualCaption(previewPath) {
  try {
    const tagsResponse = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1200) });
    if (!tagsResponse.ok) return null;
    const tags = await tagsResponse.json();
    if (!Array.isArray(tags.models) || !tags.models.some(item => String(item.name || item.model || '').startsWith('gemma3:4b'))) return null;
    const bytes = await readFile(previewPath);
    if (bytes.length > 12 * 1024 * 1024) return null;
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        model: 'gemma3:4b', stream: false, format: 'json', options: { temperature: 0 },
        images: [bytes.toString('base64')],
        prompt: 'Describe only plainly visible, non-personal scene details for a public image catalog keyword search. Do not identify or describe people, faces, sensitive traits, text, or ownership. Return JSON with one field "terms" containing 4 to 8 short nouns and adjectives, at most 70 characters.',
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const parsed = JSON.parse(result.response || '{}');
    const terms = plain(parsed.terms, 80).toLowerCase().replace(/[^a-z ,]/g, ' ').replace(/\s+/g, ' ').trim();
    return terms || null;
  } catch { return null; }
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function fetchBounded(url, { allowedHosts, maxBytes, timeoutMs, fetchImpl = fetch }) {
  const allowed = safeHttps(url, allowedHosts);
  if (!allowed) throw new Error('Source URL was outside the supported public provider');
  const response = await fetchImpl(allowed, {
    headers: { accept: maxBytes === MAX_IMAGE_BYTES ? 'image/jpeg,image/png,image/webp' : 'application/json', 'user-agent': USER_AGENT },
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Public source response exceeded size limit');
  if (!response.body) throw new Error('Public source returned an empty response');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('Public source response exceeded size limit');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts, size);
}

async function fetchJson(url, host, fetchImpl) {
  const bytes = await fetchBounded(url, { allowedHosts: [host], maxBytes: 750_000, timeoutMs: API_TIMEOUT_MS, fetchImpl });
  return JSON.parse(bytes.toString('utf8'));
}

function openverseCandidates(data) {
  if (!Array.isArray(data?.results)) throw new Error('Openverse returned an unexpected search response');
  return data.results.slice(0, MAX_CANDIDATES_PER_QUERY).flatMap(item => {
    if (!/^[a-f0-9-]{36}$/i.test(item.id || '')) return [];
    const pageUrl = safeHttps(item.foreign_landing_url) || `https://openverse.org/image/${item.id}`;
    return [{
      id: `openverse:${item.id}`, source: 'Openverse', title: plain(item.title) || 'Untitled image',
      creator: plain(item.creator, 120) || null, license: plain([item.license, item.license_version].filter(Boolean).join(' '), 80) || 'See source',
      pageUrl, thumbnailUrl: `https://api.openverse.org/v1/images/${item.id}/thumb/`,
      thumbnailHosts: ['api.openverse.org'],
    }];
  });
}

function commonsCandidates(data) {
  const pages = data?.query?.pages;
  if (!Array.isArray(pages)) throw new Error('Wikimedia Commons returned an unexpected search response');
  return pages.slice(0, MAX_CANDIDATES_PER_QUERY).flatMap(page => {
    const info = page.imageinfo?.[0];
    const thumbnailUrl = safeHttps(info?.thumburl, ['upload.wikimedia.org', 'thumb.wikimedia.org']);
    if (!thumbnailUrl || !String(page.title || '').startsWith('File:')) return [];
    const meta = info.extmetadata || {};
    return [{
      id: `commons:${page.pageid}`, source: 'Wikimedia Commons',
      title: plain(page.title.replace(/^File:/, ''), 200), creator: plain(meta.Artist?.value, 120) || null,
      license: plain(meta.LicenseShortName?.value || meta.UsageTerms?.value, 80) || 'See source',
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`,
      thumbnailUrl, thumbnailHosts: ['upload.wikimedia.org', 'thumb.wikimedia.org'],
    }];
  });
}

function locCandidates(data) {
  if (!Array.isArray(data?.results)) throw new Error('Library of Congress returned an unexpected search response');
  return data.results.slice(0, MAX_CANDIDATES_PER_QUERY).flatMap((item, index) => {
    let imageUrl = Array.isArray(item.image_url) ? item.image_url.at(-1) : item.image_url;
    if (typeof imageUrl === 'string' && imageUrl.startsWith('http://')) imageUrl = `https://${imageUrl.slice(7)}`;
    const thumbnailUrl = safeHttps(imageUrl, ['tile.loc.gov', 'www.loc.gov']);
    const pageUrl = safeHttps(item.id?.replace(/^http:/, 'https:'), ['www.loc.gov', 'loc.gov']);
    if (!thumbnailUrl || !pageUrl) return [];
    const creator = Array.isArray(item.contributor) ? item.contributor.join(', ') : item.contributor;
    return [{
      id: `loc:${plain(item.id, 150) || index}`, source: 'Library of Congress',
      title: plain(item.title) || 'Untitled collection item', creator: plain(creator, 120) || null,
      license: 'See item rights and access', pageUrl, thumbnailUrl, thumbnailHosts: ['tile.loc.gov', 'www.loc.gov'],
    }];
  });
}

async function retrieve(source, query, fetchImpl) {
  if (source.name === 'Openverse') {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.search = new URLSearchParams({ q: query, page_size: String(MAX_CANDIDATES_PER_QUERY), page: '1' }).toString();
    return openverseCandidates(await fetchJson(url.href, 'api.openverse.org', fetchImpl));
  }
  if (source.name === 'Wikimedia Commons') {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: String(MAX_CANDIDATES_PER_QUERY), prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '256' }).toString();
    const data = await fetchJson(url.href, 'commons.wikimedia.org', fetchImpl);
    if (!data.query && !data.error) return [];
    if (data.error) throw new Error('Wikimedia Commons declined this search');
    return commonsCandidates(data);
  }
  const url = new URL('https://www.loc.gov/photos/');
  url.search = new URLSearchParams({ fo: 'json', q: query, c: String(MAX_CANDIDATES_PER_QUERY) }).toString();
  return locCandidates(await fetchJson(url.href, 'www.loc.gov', fetchImpl));
}

/** Converts supported raster bytes into a tiny RGB signature using the installed ImageMagick CLI. */
export async function fingerprintImage(bytes, timeoutMs = IMAGE_TIMEOUT_MS) {
  const type = imageType(bytes);
  if (!type) throw new Error('Only JPEG, PNG, and WebP previews can be compared');
  const args = ['-limit', 'memory', '64MiB', '-limit', 'map', '128MiB', '-limit', 'disk', '0', `${type}:-`, '-auto-orient', '-thumbnail', '16x16!', '-colorspace', 'sRGB', '-depth', '8', 'rgb:-'];
  const pixels = await new Promise((resolve, reject) => {
    const child = spawn('magick', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    let count = 0;
    let error = '';
    let done = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const finish = (failure, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (failure) reject(failure); else resolve(value);
    };
    child.on('error', () => finish(new Error('ImageMagick is unavailable for visual comparison')));
    child.stderr.on('data', chunk => { error += String(chunk).slice(0, 300); });
    child.stdout.on('data', chunk => {
      count += chunk.length;
      if (count > 1024) child.kill('SIGKILL');
      else output.push(chunk);
    });
    child.on('close', code => {
      const value = Buffer.concat(output);
      if (code !== 0 || value.length !== 768) finish(new Error(`Image comparison could not decode thumbnail${error ? `: ${plain(error, 120)}` : ''}`));
      else finish(null, value);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
  return pixels;
}

function luminance(pixels, x, y) {
  const offset = (y * 16 + x) * 3;
  return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
}

/** A bounded visual score, not a probability of copying or an ownership judgment. */
export function compareFingerprints(left, right) {
  if (left.length !== 768 || right.length !== 768) throw new Error('Invalid image fingerprint');
  let bitsEqual = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = luminance(left, x * 2, y * 2) > luminance(left, x * 2 + 1, y * 2);
      const b = luminance(right, x * 2, y * 2) > luminance(right, x * 2 + 1, y * 2);
      if (a === b) bitsEqual++;
    }
  }
  let rgbDifference = 0;
  for (let i = 0; i < left.length; i++) rgbDifference += Math.abs(left[i] - right[i]);
  const colorScore = 1 - rgbDifference / (left.length * 255);
  return Math.round((0.65 * bitsEqual / 64 + 0.35 * colorScore) * 100);
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

export async function searchPublicCollections({ previewPath, title, story = '', fetchImpl = fetch }) {
  const searchedAt = new Date().toISOString();
  const query = plain(title, 120);
  const limitations = [
    'This is a keyword search of three public catalogs followed by thumbnail comparison of a small result sample. It is not an exhaustive reverse-image search.',
    'A visual lead does not establish who owns a work, whether it was licensed, or whether a use infringes rights.',
    'The uploaded image stays on the local Rights Desk server and is processed by the local model when available. Only short text search terms are sent to public catalogs.',
    'A clean image of the work compares better than a screenshot with page controls; crops, watermarks, and heavy edits can be missed.',
  ];
  let reference;
  try { reference = await fingerprintImage(await readFile(previewPath), 10_000); }
  catch (error) {
    return {
      status: 'unavailable', searchedAt, query, queries: [query], querySources: { title: query }, summary: 'Visual comparison is unavailable for this image on this server.',
      coverage: SOURCES.map(source => ({ source: source.name, status: 'skipped', count: 0, retrieved: 0, compared: 0, detail: 'Image comparison could not start.' })),
      matches: [], limitations: [...limitations, plain(error.message, 160)],
    };
  }
  const caption = await localVisualCaption(previewPath);
  const derived = caption || storyKeywords(story);
  const queries = [...new Set([query, derived].filter(Boolean))].slice(0, 2);
  const querySources = { title: query, ...(caption ? { localVisualCaption: caption } : derived ? { storyKeywords: derived } : {}) };
  if (derived && !caption) limitations.push('A short keyword extract from the private case description was sent to the public catalogs. Review the returned search terms before sharing this case.');
  if (caption) limitations.push('Scene terms came from a local visual model; the original image was not sent to public catalogs. The model’s terms may be inaccurate.');
  const retrieved = await Promise.all(SOURCES.map(async source => {
    const results = await Promise.all(queries.map(async term => {
      try { return { term, candidates: await retrieve(source, term, fetchImpl) }; }
      catch (error) { return { term, candidates: [], error: plain(error.message, 160) }; }
    }));
    const unique = new Map();
    for (const entry of results) for (const candidate of entry.candidates) {
      if (!unique.has(candidate.id)) unique.set(candidate.id, { ...candidate, foundBy: entry.term });
    }
    return { source, candidates: [...unique.values()].slice(0, MAX_CANDIDATES_PER_SOURCE), errors: results.filter(entry => entry.error).map(entry => `${entry.term}: ${entry.error}`), succeeded: results.some(entry => !entry.error) };
  }));
  const coverage = retrieved.map(({ source, candidates, errors, succeeded }) => ({
    source: source.name, status: !succeeded ? 'failed' : errors.length ? 'partial' : 'searched', count: 0, retrieved: candidates.length, compared: 0, thumbnailErrors: 0,
    detail: errors.length ? `${source.description}; ${errors.join('; ').slice(0, 180)}` : `${source.description}; first ${MAX_CANDIDATES_PER_SOURCE} keyword results at most.`, apiUrl: source.api,
  }));
  const candidates = retrieved.flatMap(entry => entry.candidates);
  const compared = await mapLimit(candidates, 4, async candidate => {
    const row = coverage.find(item => item.source === candidate.source);
    try {
      const bytes = await fetchBounded(candidate.thumbnailUrl, { allowedHosts: candidate.thumbnailHosts, maxBytes: MAX_IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, fetchImpl });
      const fingerprint = await fingerprintImage(bytes);
      row.compared++;
      const score = compareFingerprints(reference, fingerprint);
      if (score < 82) return null;
      row.count++;
      const level = score >= 92 ? 'strong_visual_lead' : 'possible_visual_lead';
      return {
        id: candidate.id, source: candidate.source, title: candidate.title, creator: candidate.creator,
        license: candidate.license, pageUrl: candidate.pageUrl, thumbnailUrl: candidate.thumbnailUrl,
        similarity: { score, method: '16×16 thumbnail color and difference hash', level },
        evidence: [
          `Found via public catalog keyword search: “${candidate.foundBy}”.`,
          `Preview and remote thumbnail scored ${score}/100 in a small-image visual comparison.`,
          'Review the source page, license terms, upload date, and your original files before drawing a conclusion.',
        ],
      };
    } catch { row.thumbnailErrors++; return null; }
  });
  for (const row of coverage) {
    if (row.thumbnailErrors > 0 && row.status === 'searched') row.status = 'partial';
    if (row.thumbnailErrors > 0) row.detail += ` ${row.thumbnailErrors} thumbnail${row.thumbnailErrors === 1 ? '' : 's'} could not be compared.`;
  }
  const matches = compared.filter(Boolean).sort((a, b) => b.similarity.score - a.similarity.score).slice(0, 15);
  const failures = coverage.filter(item => item.status === 'failed').length;
  const status = failures === SOURCES.length ? 'unavailable' : coverage.some(item => item.status !== 'searched') ? 'partial' : 'complete';
  const summary = matches.length
    ? `${matches.length} visual lead${matches.length === 1 ? '' : 's'} in sampled public catalog results. Verify every lead before taking action.`
    : status === 'unavailable'
      ? 'The public catalogs could not be searched. No conclusion can be drawn from this attempt.'
      : status === 'partial'
        ? 'No visual leads appeared among candidates compared so far; some searches or thumbnails could not be checked.'
        : 'No visual leads appeared in the sampled results. This does not rule out use elsewhere.';
  return { status, searchedAt, query, queries, querySources, summary, coverage, matches, limitations };
}
