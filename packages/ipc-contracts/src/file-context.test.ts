import { describe, expect, it } from 'vitest';
import {
  FileContextRefSchema,
  FileContextRefsSchema,
  MAX_FILE_CONTEXT_IMAGES,
  MAX_FILE_CONTEXT_REFS,
  fileRefsForEventPayload,
  formatPromptWithFileContext,
  type FileContextRefDto,
} from './file-context.js';

function fileRef(overrides: Partial<FileContextRefDto> = {}): FileContextRefDto {
  return {
    id: 'ref-1',
    kind: 'file',
    path: 'src/cart/checkout.ts',
    name: 'checkout.ts',
    ...overrides,
  };
}

describe('FileContextRefSchema', () => {
  it('accepts a path ref and an attachment image ref', () => {
    expect(FileContextRefSchema.safeParse(fileRef()).success).toBe(true);
    expect(
      FileContextRefSchema.safeParse(
        fileRef({ kind: 'image', path: undefined, attachmentId: 'a1b2c3d4', name: 'shot.png' }),
      ).success,
    ).toBe(true);
  });

  it('requires exactly one of path / attachmentId', () => {
    expect(FileContextRefSchema.safeParse(fileRef({ path: undefined })).success).toBe(false);
    expect(
      FileContextRefSchema.safeParse(fileRef({ kind: 'image', attachmentId: 'x1y2z3w4' })).success,
    ).toBe(false);
  });

  it('restricts attachment refs to images (phase 1)', () => {
    expect(
      FileContextRefSchema.safeParse(
        fileRef({ kind: 'file', path: undefined, attachmentId: 'a1b2c3d4' }),
      ).success,
    ).toBe(false);
  });
});

describe('FileContextRefsSchema', () => {
  it('caps the total reference count', () => {
    const refs = Array.from({ length: MAX_FILE_CONTEXT_REFS + 1 }, (_, i) =>
      fileRef({ id: `ref-${i}`, path: `src/f${i}.ts` }),
    );
    expect(FileContextRefsSchema.safeParse(refs).success).toBe(false);
    expect(FileContextRefsSchema.safeParse(refs.slice(0, MAX_FILE_CONTEXT_REFS)).success).toBe(
      true,
    );
  });

  it('caps image references separately', () => {
    const images = Array.from({ length: MAX_FILE_CONTEXT_IMAGES + 1 }, (_, i) =>
      fileRef({ id: `img-${i}`, kind: 'image', path: `assets/${i}.png`, name: `${i}.png` }),
    );
    expect(FileContextRefsSchema.safeParse(images).success).toBe(false);
  });

  it('defaults to an empty list', () => {
    expect(FileContextRefsSchema.parse(undefined)).toEqual([]);
  });
});

describe('formatPromptWithFileContext', () => {
  it('returns the text untouched without refs', () => {
    expect(formatPromptWithFileContext('hello', [])).toBe('hello');
  });

  it('appends one <ref> entry per reference with kind and provenance', () => {
    const prompt = formatPromptWithFileContext('fix the button', [
      fileRef(),
      fileRef({ id: 'ref-2', kind: 'folder', path: 'public/styles', name: 'styles' }),
      fileRef({
        id: 'ref-3',
        kind: 'image',
        path: undefined,
        attachmentId: 'a1b2c3d4',
        name: 'design.png',
      }),
    ]);
    expect(prompt.startsWith('fix the button\n<file_context>')).toBe(true);
    expect(prompt).toContain('<ref index="1" kind="file" path="src/cart/checkout.ts" />');
    expect(prompt).toContain('<ref index="2" kind="folder" path="public/styles" />');
    expect(prompt).toContain(
      '<ref index="3" kind="image" name="design.png" source="attachment" />',
    );
    expect(prompt.trimEnd().endsWith('</file_context>')).toBe(true);
  });

  it('escapes XML-hostile characters in paths and names', () => {
    const prompt = formatPromptWithFileContext('x', [
      fileRef({ path: 'a"b<c>&d.ts', name: 'a"b<c>&d.ts' }),
    ]);
    expect(prompt).toContain('path="a&quot;b&lt;c&gt;&amp;d.ts"');
    expect(prompt).not.toContain('a"b<c>');
  });
});

describe('fileRefsForEventPayload', () => {
  it('drops ids and attachment ids but keeps chips data', () => {
    const payload = fileRefsForEventPayload([
      fileRef({ sizeBytes: 2048 }),
      fileRef({
        id: 'ref-2',
        kind: 'image',
        path: undefined,
        attachmentId: 'secret-id',
        name: 'shot.png',
        thumbDataUrl: 'data:image/png;base64,dGh1bWI=',
      }),
    ]);
    expect(payload).toEqual([
      { kind: 'file', name: 'checkout.ts', path: 'src/cart/checkout.ts', sizeBytes: 2048 },
      { kind: 'image', name: 'shot.png', thumbDataUrl: 'data:image/png;base64,dGh1bWI=' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('secret-id');
  });
});
