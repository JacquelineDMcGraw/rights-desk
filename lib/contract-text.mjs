import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const swiftReader = fileURLToPath(new URL('../scripts/read-contract.swift', import.meta.url));
const formats = { 'application/pdf': 'pdf', 'image/jpeg': 'jpeg', 'image/png': 'png' };
const maxFileBytes = 10 * 1024 * 1024;
const maxPages = 20;
const maxTextLength = 64000;
const maxReadTime = 60000;
const maxOutputBytes = 512 * 1024;
const maxImagePixels = 40000000;
const errors = {
  CONTRACT_UNREADABLE: 'Couldn’t read text from this contract. Try a clearer copy or paste the terms yourself.',
  CONTRACT_TOO_LARGE: 'This contract is too large to read at once. Upload up to 20 pages or paste the relevant terms.',
  CONTRACT_READER_UNAVAILABLE: 'The local contract reader is unavailable. You can still paste the terms yourself.',
  CONTRACT_READ_TIMEOUT: 'Reading the contract took too long. Try a shorter copy or paste the relevant terms.',
};

function extractionError(code) {
  return Object.assign(new Error(errors[code]), { code });
}

async function run(binary, args, deadline, { native = false } = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw extractionError('CONTRACT_READ_TIMEOUT');
  const env = {
    PATH: [process.env.PATH || '/usr/bin:/bin', ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [])].join(':'),
    TMPDIR: tmpdir(),
    LC_ALL: 'C',
    ...(process.env.DEVELOPER_DIR ? { DEVELOPER_DIR: process.env.DEVELOPER_DIR } : {}),
    ...(process.env.TESSDATA_PREFIX ? { TESSDATA_PREFIX: process.env.TESSDATA_PREFIX } : {}),
  };
  try {
    const { stdout } = await execute(binary, args, {
      env, timeout: remaining, killSignal: 'SIGKILL', maxBuffer: maxOutputBytes, encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || (native && error.code === 3)) {
      throw extractionError('CONTRACT_TOO_LARGE');
    }
    if (error.killed || Date.now() >= deadline) throw extractionError('CONTRACT_READ_TIMEOUT');
    if (['ENOENT', 'EACCES'].includes(error.code) || (native && error.code === 1)) {
      throw extractionError('CONTRACT_READER_UNAVAILABLE');
    }
    throw extractionError('CONTRACT_UNREADABLE');
  }
}

async function withScratch(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'rights-desk-contract-'));
  try { return await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function nativePages(path, deadline) {
  return withScratch(async directory => {
    const output = await run('/usr/bin/swift', [
      '-module-cache-path', join(directory, 'module-cache'),
      swiftReader, path, directory, String(maxPages), String(maxTextLength),
    ], deadline, { native: true });
    const pages = JSON.parse(output);
    for (const record of pages) {
      if (!record.needsOCR) continue;
      try {
        const recognized = await recognize(join(directory, `page-${record.page}.jpg`), deadline);
        if (recognized.length > record.text.length) record.text = recognized;
      } catch (error) {
        if (!record.text || error.code !== 'CONTRACT_READER_UNAVAILABLE') throw error;
      }
    }
    return pages;
  });
}

async function recognize(path, deadline) {
  return (await run('tesseract', [path, 'stdout'], deadline)).trim();
}

async function portablePages(path, deadline) {
  const output = await run('pdftotext', ['-l', String(maxPages + 1), '-enc', 'UTF-8', path, '-'], deadline);
  const pages = output.split('\f');
  if (pages.at(-1) === '') pages.pop();
  if (pages.length > maxPages) throw extractionError('CONTRACT_TOO_LARGE');
  const records = pages.map((text, index) => ({ page: index + 1, text: text.trim() }));
  if (records.every(record => record.text.length >= 60)) return records;

  return withScratch(async directory => {
    for (const record of records) {
      if (record.text.length >= 60) continue;
      const page = String(record.page);
      const image = join(directory, 'page');
      try {
        await run('pdftoppm', ['-f', page, '-l', page, '-singlefile', '-scale-to', '2400', '-png', path, image], deadline);
        const recognized = await recognize(`${image}.png`, deadline);
        if (recognized.length > record.text.length) record.text = recognized;
      } catch (error) {
        if (!record.text || error.code !== 'CONTRACT_READER_UNAVAILABLE') throw error;
      }
    }
    return records;
  });
}

function imageDimensions(bytes, format) {
  if (format === 'png') {
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return [];
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  // The JPEG start-of-frame segment holds dimensions before pixel data is decoded.
  let index = 2;
  while (index < bytes.length && bytes[index++] === 0xff) {
    while (bytes[index] === 0xff) index++;
    const marker = bytes[index++];
    if (marker === 0xd9 || marker === 0xda || index + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(index);
    if (length < 2 || index + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      return [bytes.readUInt16BE(index + 5), bytes.readUInt16BE(index + 3)];
    }
    index += length;
  }
  return [];
}

export async function extractContractText(path, mime) {
  const format = Object.hasOwn(formats, mime) ? formats[mime] : null;
  if (!format) throw extractionError('CONTRACT_UNREADABLE');
  try {
    const file = await stat(path);
    if (!file.isFile() || !file.size) throw extractionError('CONTRACT_UNREADABLE');
    if (file.size > maxFileBytes) throw extractionError('CONTRACT_TOO_LARGE');
    const deadline = Date.now() + maxReadTime;
    let pages;
    if (format !== 'pdf') {
      const [width, height] = imageDimensions(await readFile(path), format);
      if (!width || !height) throw extractionError('CONTRACT_UNREADABLE');
      if (width * height > maxImagePixels) throw extractionError('CONTRACT_TOO_LARGE');
      pages = [{ page: 1, text: await recognize(path, deadline) }];
    } else if (process.platform === 'darwin') {
      try { pages = await nativePages(path, deadline); }
      catch (error) {
        if (error.code !== 'CONTRACT_READER_UNAVAILABLE') throw error;
      }
    }
    pages ??= await portablePages(path, deadline);
    const readable = pages.map(({ page, text }) => ({ page, text: text.replace(/\r\n?/g, '\n').replaceAll('\0', '').trim() })).filter(record => record.text);
    if (!readable.length) throw extractionError('CONTRACT_UNREADABLE');
    if (readable.reduce((total, record) => total + record.text.length, 0) > maxTextLength) {
      throw extractionError('CONTRACT_TOO_LARGE');
    }
    return readable;
  } catch (error) {
    if (Object.hasOwn(errors, error.code)) throw error;
    throw extractionError('CONTRACT_UNREADABLE');
  }
}
