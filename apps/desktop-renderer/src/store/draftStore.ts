import { create } from 'zustand';

/**
 * Per-task reply drafts (ADR-0014, PIVOT-036): session-scoped, shared by the
 * Task Room composer and the Editor agent panel so a half-typed reply survives
 * room → Editor → room round-trips. Never persisted to disk.
 */
interface DraftStore {
  drafts: Record<string, string>;
  terminalRefs: Record<string, TerminalOutputRef[]>;
  /** ADR-0022 am.2: one pending preview selection per task (replace on re-pick). */
  previewRefs: Record<string, PreviewFeedbackRef>;
  setDraft(taskId: string, text: string): void;
  clearDraft(taskId: string): void;
  addTerminalRef(taskId: string, ref: TerminalOutputRef): void;
  removeTerminalRef(taskId: string, refId: string): void;
  clearTerminalRefs(taskId: string): void;
  setPreviewRef(taskId: string, ref: PreviewFeedbackRef): void;
  clearPreviewRef(taskId: string): void;
}

export interface TerminalOutputRef {
  id: string;
  title: string;
  text: string;
  cwd: string;
  contextLabel: string;
  lineCount: number;
}

/** A picked element / drawn region from the live preview, waiting in the
 * composer (ADR-0022 am.2). `dataBase64` is null when capture failed —
 * feedback then travels text-only. */
export interface PreviewFeedbackRef {
  id: string;
  dataBase64: string | null;
  thumbDataUrl: string;
  pageUrl: string;
  rect: { x: number; y: number; width: number; height: number };
  selector: string | null;
}

export const useDraftStore = create<DraftStore>((set, get) => ({
  drafts: {},
  terminalRefs: {},
  previewRefs: {},
  setDraft(taskId, text) {
    set({ drafts: { ...get().drafts, [taskId]: text } });
  },
  clearDraft(taskId) {
    const drafts = { ...get().drafts };
    delete drafts[taskId];
    set({ drafts });
  },
  addTerminalRef(taskId, ref) {
    const current = get().terminalRefs[taskId] ?? [];
    set({ terminalRefs: { ...get().terminalRefs, [taskId]: [...current, ref].slice(-4) } });
  },
  removeTerminalRef(taskId, refId) {
    set({
      terminalRefs: {
        ...get().terminalRefs,
        [taskId]: (get().terminalRefs[taskId] ?? []).filter((ref) => ref.id !== refId),
      },
    });
  },
  clearTerminalRefs(taskId) {
    const terminalRefs = { ...get().terminalRefs };
    delete terminalRefs[taskId];
    set({ terminalRefs });
  },
  setPreviewRef(taskId, ref) {
    set({ previewRefs: { ...get().previewRefs, [taskId]: ref } });
  },
  clearPreviewRef(taskId) {
    const previewRefs = { ...get().previewRefs };
    delete previewRefs[taskId];
    set({ previewRefs });
  },
}));
