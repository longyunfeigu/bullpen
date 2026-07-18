import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FILE_CONTEXT_IMAGES,
  MAX_FILE_CONTEXT_REFS,
  type FileContextRefDto,
} from '@pi-ide/ipc-contracts';
import { useDraftStore } from './draftStore.js';

function ref(overrides: Partial<FileContextRefDto> = {}): FileContextRefDto {
  return {
    id: `ref-${Math.random().toString(36).slice(2)}`,
    kind: 'file',
    path: 'src/main.ts',
    name: 'main.ts',
    ...overrides,
  };
}

describe('draftStore fileRefs (ADR-0024)', () => {
  beforeEach(() => {
    useDraftStore.getState().clearFileRefs('t1');
  });

  it('adds, dedupes by path, and removes', () => {
    const store = useDraftStore.getState();
    expect(store.addFileRef('t1', ref({ id: 'a' }))).toBe('added');
    expect(store.addFileRef('t1', ref({ id: 'b' }))).toBe('duplicate');
    expect(useDraftStore.getState().fileRefs.t1).toHaveLength(1);
    useDraftStore.getState().removeFileRef('t1', 'a');
    expect(useDraftStore.getState().fileRefs.t1).toHaveLength(0);
  });

  it('dedupes attachment refs by attachmentId', () => {
    const store = useDraftStore.getState();
    const image = ref({
      kind: 'image',
      path: undefined,
      attachmentId: 'att-1',
      name: 'shot.png',
    });
    expect(store.addFileRef('t1', image)).toBe('added');
    expect(store.addFileRef('t1', { ...image, id: 'other' })).toBe('duplicate');
  });

  it('enforces the total and image caps', () => {
    const store = useDraftStore.getState();
    for (let i = 0; i < MAX_FILE_CONTEXT_IMAGES; i += 1) {
      expect(
        store.addFileRef('t1', ref({ kind: 'image', path: `assets/${i}.png`, name: `${i}.png` })),
      ).toBe('added');
    }
    expect(
      store.addFileRef('t1', ref({ kind: 'image', path: 'assets/extra.png', name: 'extra.png' })),
    ).toBe('image-limit');
    for (let i = MAX_FILE_CONTEXT_IMAGES; i < MAX_FILE_CONTEXT_REFS; i += 1) {
      expect(store.addFileRef('t1', ref({ path: `src/f${i}.ts`, name: `f${i}.ts` }))).toBe('added');
    }
    expect(store.addFileRef('t1', ref({ path: 'src/one-too-many.ts' }))).toBe('limit');
  });
});
