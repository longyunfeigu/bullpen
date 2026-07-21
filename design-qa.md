# Skills Main Page — Design QA

- Accepted concept: `docs/design/skills-main-usage-mockup.html`
- Reference captures: `/tmp/skills-multi-agent-mockup-qa/01-desktop-grouped.png`, `/tmp/skills-multi-agent-mockup-qa/06-narrow.png`
- Electron captures: `/tmp/skills-main-implementation-qa/01-desktop-main.png`, `/tmp/skills-main-implementation-qa/02-desktop-drawer.png`, `/tmp/skills-main-implementation-qa/03-narrow-main.png`
- Selection-fix captures: `/tmp/skills-selection-qa/01-desktop-mixed-selection.png`, `/tmp/skills-selection-qa/02-narrow-mixed-selection.png`
- Validation surface: packaged-mode Electron app launched through `tests/e2e/helpers/launch.ts`
- Viewports: 1440 × 1000 and 980 × 760

## Comparison

1. Page identity and hierarchy match: persistent activity rail, contextual Skills rail at desktop, compact rail at narrow width, page heading, metrics, evidence, controls, grouped table.
2. Density and geometry match: 274 px Skills rail at desktop, 44 px compact rail at narrow width, 1120 px maximum content column, 58 px rows, 520 px management drawer.
3. Typography and tokens use Charter's existing display/UI/mono fonts, colors, borders, radii, shadows, and Agent colors rather than introducing a parallel design system.
4. The primary flow is functional: Skills navigation, status and Agent filters, search, sorting, drawer scope, per-Agent enable/disable, recoverable deletion, and built-in locking.
5. The accepted responsive hierarchy is preserved. The first pass left a blank 230 px contextual panel at 980 px and hid status navigation; both were corrected before the final capture.
6. The management drawer now exposes a native checkbox on every mutable installed copy. Agent scope tabs select a set as a shortcut, while mixed enabled/disabled selections expose separate Enable, Disable, and Delete actions.
7. The requested `Future adapters / Kimi-ready` row and duplicate `Sources & trust` rail shortcut are absent from the final Electron captures.

## Copy diff

- The accepted mock's Chinese explanatory sentence is rendered in production English to match the rest of Charter's current UI language.
- `Run a skill` is retained as the main-page primary action; importing and source trust remain in Settings → Skill Sources.
- Codex evidence is explicitly labelled `activation`, not exact invocation, because Codex does not expose a verified per-Skill invocation event.

## Interaction and runtime checks

- Page is non-blank and has the expected `Skills` H1.
- No Vite/framework overlay was present.
- No page errors or console errors were recorded in desktop, drawer, or narrow states.
- The real Electron flow verified grouped Pi/Claude/Codex copies, a Claude-only disable, deletion to OS Trash, and protected Codex `.system` behavior.
- The drawer regression flow verified direct checkbox selection, scope shortcuts, mixed-state Enable/Disable availability, disabled built-in checkboxes, and the two requested rail removals.
- A regression test verifies that an untrusted Charter source does not make a natively available Claude/Codex copy appear off.

## Result

final result: passed
