# Code Context Mockups · Design QA

- Source visual truth: `/var/folders/23/z96fd00x791_2j0k757hsnjw0000gn/T/codex-clipboard-IE9T7I.png`
- Phase 1 implementation: `phase-1.html`
- Unified implementation: `unified.html`
- Electron renders:
  - `/tmp/charter-code-context-mock-phase1-selection-1440.png`
  - `/tmp/charter-code-context-mock-phase1-attached-1440.png`
  - `/tmp/charter-code-context-mock-phase1-sent-1440.png`
  - `/tmp/charter-code-context-mock-unified-file-1440.png`
  - `/tmp/charter-code-context-mock-unified-editor-1440.png`
  - `/tmp/charter-code-context-mock-unified-search-1440.png`
  - `/tmp/charter-code-context-mock-phase1-narrow-900.png`
  - `/tmp/charter-code-context-mock-unified-editor-narrow-900.png`
- Focused comparison: `/tmp/charter-code-context-source-vs-phase1.png`
- Viewports: 1440 × 900 and 900 × 760
- States: selection, Composer attachment, timeline evidence, File Peek, expanded Editor, search results
- Browser/runtime: repository Playwright Electron helper with isolated user data

## Full-view comparison evidence

The 1440 × 900 Phase 1 render preserves the current three-region Session shell: one Session Rail, one conversation ledger, and one right-side tool canvas. The supplied Diff reference and the Phase 1 tool-panel crop were placed side by side in `/tmp/charter-code-context-source-vs-phase1.png` before judging fidelity.

The focused comparison confirms the same tab order, file summary, changed-file row, inline hunk anatomy, line-number column, green changed-line treatment, cream Archive palette, verification block, and relative visual density. The new blue text selection and anchored “添加到上下文” action are deliberate feature additions.

## Focused region comparison evidence

- Diff selection: text-only blue selection leaves line numbers and diff markers readable.
- Selection action: anchored below the selected range and flips to a green “已在上下文” state in the unified mock.
- Composer: structured references sit above user prose and remain removable and expandable.
- Timeline: the sent message preserves the exact path, version, line range, and code snapshot.
- Expanded Editor: the tool canvas grows while the Session Rail and conversation remain visible; no second Activity Bar, Explorer, or Agent Panel is introduced.
- Search results: the same reference treatment is used instead of a search-specific attachment UI.

## Required fidelity surfaces

- Fonts and typography: Archive serif UI and Menlo-family code typography match the supplied product state. Control text has explicit sizing and does not rely on browser defaults.
- Spacing and layout rhythm: panel borders, tab height, file rows, hunk bands, composer geometry, and 14px-class radii follow the existing Charter system. The mock control bar is outside the product frame.
- Colors and visual tokens: palette values are taken directly from the current Archive light tokens; diff, selection, success, warning, border, and muted states remain semantically distinct.
- Image quality and asset fidelity: no raster imagery or custom illustration is required for this product surface. UI is code-native and no placeholder imagery is present.
- Copy and content: existing Diff labels and sample file content are preserved. New copy is limited to the requested code-context workflow and source provenance.

## Interaction and responsive checks

- Phase 1: selection → add context → Composer focus → send → timeline evidence passed.
- Unified: File Peek → expanded Editor → search results retained three refs in one draft; remove/re-add and send passed.
- Search refresh action responds and duplicate source context is visibly identified.
- Electron page errors: none.
- Electron console errors: none.
- 900px document width: no horizontal page overflow in Phase 1 or expanded Editor state.

## Comparison history

1. Initial functional capture was blocked because production Electron CSP correctly rejected inline JavaScript. Scripts were moved to same-origin external files; the complete interaction path then passed.
2. Initial narrow layout exceeded 900px by its minimum grid widths. The rail and conversation minima were reduced while preserving a 400–430px code surface. Post-fix document width is at most 900px.
3. The initial sent-state screenshot caught the 180ms entry transition mid-frame. Capture now waits for the transition, and the final timeline evidence is fully legible.

## Findings

No actionable P0, P1, or P2 differences remain for the requested mock scope.

The dark bar above the app is an intentional P3 mock-only scene switcher. It is explicitly labeled as non-product chrome and must not be implemented in Charter.

## Above-the-fold copy diff

Existing product copy and order are preserved for `File`, `Diff`, `Preview`, `Terminal`, `Review`, the changed-file summary, and the file path. Intentional additions are `添加到上下文`, source/version/line provenance, and the three mock-only scene labels.

## Final result

final result: passed
