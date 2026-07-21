import { describe, expect, it } from 'vitest';
import { FileContextRefsSchema, MAX_FILE_CONTEXT_IMAGES } from '@pi-ide/ipc-contracts';
import { contextFilesBlock, splitCharterRefs } from './charterRefs.js';

describe('splitCharterRefs', () => {
  it('promotes image refs to schema-valid fileRefs and keeps the rest textual', () => {
    const { fileRefs, textRefs } = splitCharterRefs([
      'assets/screenshots/Clipboard 2026-07-21 at 08.23.27.png',
      'src/index.ts',
      'docs/shot.JPEG',
    ]);
    expect(fileRefs.map((ref) => ref.path)).toEqual([
      'assets/screenshots/Clipboard 2026-07-21 at 08.23.27.png',
      'docs/shot.JPEG',
    ]);
    expect(fileRefs.map((ref) => ref.name)).toEqual([
      'Clipboard 2026-07-21 at 08.23.27.png',
      'shot.JPEG',
    ]);
    expect(fileRefs.every((ref) => ref.kind === 'image')).toBe(true);
    expect(textRefs).toEqual(['src/index.ts']);
    // The promoted refs must survive the wire contract as-is.
    expect(FileContextRefsSchema.safeParse(fileRefs).success).toBe(true);
  });

  it('overflows beyond the per-message image cap back into text refs', () => {
    const refs = Array.from({ length: MAX_FILE_CONTEXT_IMAGES + 2 }, (_, i) => `shots/${i}.png`);
    const { fileRefs, textRefs } = splitCharterRefs(refs);
    expect(fileRefs).toHaveLength(MAX_FILE_CONTEXT_IMAGES);
    expect(textRefs).toEqual([
      `shots/${MAX_FILE_CONTEXT_IMAGES}.png`,
      `shots/${MAX_FILE_CONTEXT_IMAGES + 1}.png`,
    ]);
  });

  it('leaves non-image and empty inputs untouched', () => {
    expect(splitCharterRefs([])).toEqual({ fileRefs: [], textRefs: [] });
    const { fileRefs, textRefs } = splitCharterRefs(['README.md', 'src/app.pngx']);
    expect(fileRefs).toEqual([]);
    expect(textRefs).toEqual(['README.md', 'src/app.pngx']);
  });
});

describe('contextFilesBlock', () => {
  it('renders the @-list block, or nothing for no refs', () => {
    expect(contextFilesBlock([])).toBe('');
    expect(contextFilesBlock(['a.md', 'b/c.png'])).toBe('\n\nContext files:\n- @a.md\n- @b/c.png');
  });
});
