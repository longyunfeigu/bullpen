import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Small TypeScript project fixture used across E2E suites. */
export function createTsSmallFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-ide-fixture-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-ts-small',
        version: '1.0.0',
        private: true,
        scripts: { test: 'node run-tests.mjs', lint: "echo 'lint ok'" },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, 'src/index.ts'),
    `import { add } from './util';\n\nexport function main(): number {\n  return add(2, 3);\n}\n`,
  );
  writeFileSync(
    join(root, 'src/util.ts'),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n`,
  );
  writeFileSync(
    join(root, 'run-tests.mjs'),
    `const ok = 2 + 3 === 5;\nconsole.log(ok ? 'PASS add' : 'FAIL add');\nprocess.exit(ok ? 0 : 1);\n`,
  );
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nSmall TS project for E2E.\n');
  return root;
}

/** ts-small fixture with an initialized git repository and one commit. */
export function createGitFixture(): string {
  const root = createTsSmallFixture();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
  return root;
}
