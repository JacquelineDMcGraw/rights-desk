import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { extractContractText } from './contract-text.mjs';

const execute = promisify(execFile);
const emailReader = fileURLToPath(new URL('../scripts/read-proposed-email.py', import.meta.url));
const maxFileBytes = 10 * 1024 * 1024;
const maxTextLength = 64000;
const maxHeaderBytes = 64 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal:true });
const textControls = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/;
const messages = {
  CONTRACT_UNREADABLE:'Couldn’t read the request. Try another copy or paste the proposed use.',
  CONTRACT_TOO_LARGE:'This request is too large to read. Upload a shorter copy or paste the relevant wording.',
  CONTRACT_READER_UNAVAILABLE:'The local email reader is unavailable. Upload a PDF or text copy, or paste the proposed use.',
  CONTRACT_READ_TIMEOUT:'Reading this request took too long. Try a shorter copy or paste the proposed use.',
};

function sourceError(code) {
  return Object.assign(new Error(messages[code]), { code });
}

function readText(bytes) {
  const text = utf8.decode(bytes).replace(/\r\n?|\f/g,'\n').trim();
  if (!text || textControls.test(text)) throw sourceError('CONTRACT_UNREADABLE');
  return text;
}

function hasEmailHeaders(bytes) {
  const start = bytes.subarray(0,maxHeaderBytes).toString('latin1');
  const separator = /\r?\n\r?\n/.exec(start);
  if (!separator || separator.index + separator[0].length >= bytes.length) return false;
  const header = start.slice(0,separator.index);
  const fields = header.split(/\r?\n/);
  if (/^From /i.test(fields[0])) fields.shift();
  const field = /^[!-9;-~]+:[\t\x20-\xff]*$/;
  const folded = /^[\t ][\t\x20-\xff]*$/;
  return field.test(fields[0]) && fields.every(line => field.test(line) || folded.test(line))
    && fields.some(line => /^(?:from|to|subject|date|message-id):/i.test(line));
}

export function isProposedTextAttachment(bytes, mime) {
  if (mime === 'message/rfc822') return hasEmailHeaders(bytes);
  if (mime !== 'text/plain') return false;
  try { return Boolean(readText(bytes)); }
  catch { return false; }
}

async function readEmail(path) {
  const env = {
    PATH: [process.env.PATH || '/usr/bin:/bin', ...(process.platform === 'darwin' ? ['/opt/homebrew/bin','/usr/local/bin'] : [])].join(':'),
  };
  try {
    const { stdout } = await execute('python3', ['-I','-S',emailReader,path,String(maxFileBytes),String(maxTextLength)], {
      env, timeout:10000, killSignal:'SIGKILL', maxBuffer:512 * 1024, encoding:'utf8',
    });
    return stdout;
  } catch (error) {
    if (error.code === 3 || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw sourceError('CONTRACT_TOO_LARGE');
    if (error.killed) throw sourceError('CONTRACT_READ_TIMEOUT');
    if ([1,'ENOENT','EACCES','ENOEXEC'].includes(error.code)) throw sourceError('CONTRACT_READER_UNAVAILABLE');
    throw sourceError('CONTRACT_UNREADABLE');
  }
}

export async function extractProposedSource(path, mime) {
  if (mime !== 'message/rfc822' && mime !== 'text/plain') return extractContractText(path,mime);
  try {
    const file = await stat(path);
    if (!file.isFile() || !file.size) throw sourceError('CONTRACT_UNREADABLE');
    if (file.size > maxFileBytes) throw sourceError('CONTRACT_TOO_LARGE');
    const text = mime === 'text/plain' ? readText(await readFile(path)) : (await readEmail(path)).trim();
    if (!text || textControls.test(text)) throw sourceError('CONTRACT_UNREADABLE');
    if (text.length > maxTextLength) throw sourceError('CONTRACT_TOO_LARGE');
    return [{ page:null, text }];
  } catch (error) {
    if (Object.hasOwn(messages,error.code)) throw error;
    throw sourceError('CONTRACT_UNREADABLE');
  }
}
