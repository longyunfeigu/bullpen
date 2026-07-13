import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Marker file → badge, first match wins (PIVOT-018 project-type badges). */
const MARKERS: Array<[string, string]> = [
  ['package.json', 'node'],
  ['pyproject.toml', 'py'],
  ['requirements.txt', 'py'],
  ['Cargo.toml', 'rust'],
  ['go.mod', 'go'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['Gemfile', 'ruby'],
  ['index.html', 'web'],
];

/** Cheap, synchronous project-type detection; null when nothing matches. */
export function detectProjectKind(root: string): string | null {
  try {
    for (const [marker, kind] of MARKERS) {
      if (existsSync(join(root, marker))) return kind;
    }
  } catch {
    // unreadable dir — no badge
  }
  return null;
}
