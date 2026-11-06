import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = () => ({
  version: 1,
  uploads: {},
  listings: {},
  cases: {},
  quotes: {},
  orders: {},
  licenses: {},
});

/** A small, single-process JSON store. Mutations are serialized and atomically renamed. */
export class Store {
  #path;
  #state;
  #queue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async init() {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'));
      if (parsed.version !== 1 || !['uploads', 'listings', 'quotes', 'orders', 'licenses'].every(key => parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key]))) {
        throw new Error('Unsupported or invalid Rights Desk data file');
      }
      // Additive v1 migration for private creator investigations.
      if (parsed.cases === undefined) {
        parsed.cases = {};
        await this.#write(parsed);
      } else if (!parsed.cases || typeof parsed.cases !== 'object' || Array.isArray(parsed.cases)) {
        throw new Error('Unsupported or invalid Rights Desk cases data');
      }
      this.#state = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#state = EMPTY();
      await this.#write(this.#state);
    }
  }

  snapshot() {
    if (!this.#state) throw new Error('Store has not been initialized');
    return structuredClone(this.#state);
  }

  async update(mutator) {
    const job = this.#queue.then(async () => {
      const next = this.snapshot();
      const result = await mutator(next);
      await this.#write(next);
      this.#state = next;
      return result;
    });
    this.#queue = job.catch(() => {});
    return job;
  }

  async #write(state) {
    const temp = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, this.#path);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
