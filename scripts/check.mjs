import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server.mjs'];
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.(m?js)$/.test(entry.name)) files.push(path);
  }
}
for (const directory of ['lib', 'public', 'scripts', 'test']) await collect(directory);
for (const path of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, path)], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr || result.error?.message);
    process.exit(1);
  }
}
console.log(`JavaScript syntax checked: ${files.length} files.`);
