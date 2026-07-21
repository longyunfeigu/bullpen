import { MAX_FILE_CONTEXT_IMAGES, type FileContextRefDto } from '@pi-ide/ipc-contracts';

/**
 * ADR-0039 am.1 — Home-charter context refs, split for a managed Pi session.
 * A path flattened into goal text is invisible to the model (Pi tools read
 * text only), so image refs must ride `task.start` fileRefs, which the host
 * resolves into prompt image bytes (ADR-0024). Non-images stay textual, as do
 * images beyond the per-message cap — never silently dropped. External CLI
 * charters keep the all-textual `@ref` form (their own tools read images).
 */

/** Mirrors ATTACHMENT_IMAGE_MIMES (file-context.ts) as path extensions. */
const IMAGE_REF_PATTERN = /\.(png|jpe?g|gif|webp|bmp)$/iu;

export function splitCharterRefs(refs: readonly string[]): {
  fileRefs: FileContextRefDto[];
  textRefs: string[];
} {
  const imagePaths = refs
    .filter((ref) => IMAGE_REF_PATTERN.test(ref))
    .slice(0, MAX_FILE_CONTEXT_IMAGES);
  const promoted = new Set(imagePaths);
  return {
    fileRefs: imagePaths.map((path) => ({
      id: crypto.randomUUID(),
      kind: 'image',
      path,
      name: path.split('/').pop() || path,
    })),
    textRefs: refs.filter((ref) => !promoted.has(ref)),
  };
}

/** The `Context files:` goal-text block (empty string when no refs). */
export function contextFilesBlock(refs: readonly string[]): string {
  if (refs.length === 0) return '';
  return `\n\nContext files:\n${refs.map((ref) => `- @${ref}`).join('\n')}`;
}
