import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

/** Content-addressed blob storage for baselines and large outputs (CHG-011, §11.3). */
export class BlobStore {
  constructor(private readonly dir: string) {}

  private pathFor(hash: string): string {
    return join(this.dir, hash.slice(0, 2), hash);
  }

  async put(content: Buffer): Promise<{ hash: string; size: number }> {
    const hash = createHash('sha256').update(content).digest('hex');
    const target = this.pathFor(hash);
    try {
      await fs.access(target);
      return { hash, size: content.length }; // dedup hit
    } catch {
      // continue to write
    }
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, target);
    return { hash, size: content.length };
  }

  async get(hash: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(hash));
    } catch {
      return null;
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      await fs.access(this.pathFor(hash));
      return true;
    } catch {
      return false;
    }
  }
}
