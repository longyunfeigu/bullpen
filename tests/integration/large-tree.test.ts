import { describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { createLargeTreeFixture } from '@pi-ide/test-fixtures';
import { listDirectory } from '@pi-ide/workspace-service';

describe('large workspace lazy listing (WS-005/WS-016)', () => {
  it('lists the root of a 10k-file tree lazily and fast', async () => {
    const root = createLargeTreeFixture({ files: 10_000, dirs: 100 });
    try {
      const start = performance.now();
      const rootEntries = await listDirectory(root, '', { showIgnored: false, extraIgnores: [] });
      const oneDir = await listDirectory(root, 'module-000', {
        showIgnored: false,
        extraIgnores: [],
      });
      const elapsed = performance.now() - start;
      expect(rootEntries.length).toBe(101); // 100 dirs + package.json
      expect(oneDir.length).toBe(100);
      expect(elapsed).toBeLessThan(2000); // lazy: two directory levels only
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
