# Agent Replay V3 — Design QA

## Comparison target

- Source visual truth: `../session-replay-five-directions-concept.png`
- Product structure: `../session-replay-unified-experience-v3.md`
- Browser-rendered implementation: `qa/preview-recap.png`
- Combined comparison input: `qa/preview-comparison.png`
- Additional states: `qa/preview-explore.png`, `qa/preview-verify.png`, `qa/preview-tablet.png`, `qa/preview-mobile.png`
- Native viewport: 1672 × 941 CSS pixels, matching the source visual truth.
- Responsive viewports: 1024 × 768 and 390 × 844 CSS pixels.
- Primary state: market-research scenario, Recap depth, final event, light theme.

## Full-view comparison evidence

`qa/preview-comparison.png` places the source concept board and final browser capture in the same comparison image. The implementation preserves the source's warm neutral shell, dark artifact stage, blue active state, compact evidence rail, sparse shadows, dense professional typography and bottom playback controls while consolidating the five concept directions into one coherent workspace.

Specific comparison points:

1. The source's low-friction Replay entry becomes the default Recap depth with one prominent playback action.
2. The source's dark before/after or artifact canvas becomes one domain-adaptive stage for documents, spreadsheets, email, browser research, calendar, approvals and terminal observations.
3. The source's evidence inspector becomes a persistent claim drawer with capture level, direct evidence, integrity, source, reversibility and explicit relations.
4. The source's linear transport becomes a four-lane semantic timeline plus Story/Real time projections and a coverage band.
5. The source's blue selection, green success and amber risk signals map directly to the implementation tokens without adding an unrelated palette.
6. The A–E panels become Recap, Explore and Verify depth navigation while the selected event and playhead remain shared.

## Focused region comparison evidence

The focused section at the bottom of `qa/preview-comparison.png` compares source direction A with the rendered Recap hierarchy. It makes the stage-to-evidence ratio, primary playback action, timeline prominence, compact control density, border treatment and active-state color legible enough to judge. Separate focused crops were not needed after this pass because the implementation screenshot is at the source's native viewport and the full-resolution Recap, Explore and Verify captures retain readable typography and controls.

## Findings

No actionable P0, P1 or P2 findings remain.

- Fonts and typography: Inter/Source Serif/DM Mono preserve the source's sans/serif/monospace hierarchy, compact labels, stronger artifact titles and fixed-width evidence metadata. Long event and source labels truncate instead of changing row height.
- Spacing and layout rhythm: the result contract, three-column Recap workspace, evidence rail and 126px timeline fit the 1672 × 941 source viewport without overlap. Tablet collapses the evidence rail; mobile presents a horizontal chapter strip and keeps Verify evidence reachable below the stage.
- Colors and tokens: warm whites, dark teal-black stage, blue active controls, green verified states, amber observed/risk states and violet inferred states remain restrained and semantically consistent.
- Image quality and asset fidelity: this product screen needs no photographic or illustrative asset. All controls use Phosphor icons; no emoji, text-glyph icon, handcrafted SVG or placeholder image replaces a source asset.
- Copy and content: the implementation uses realistic app-specific Chinese/English mixed content for research, onboarding and purchase approval. Evidence language distinguishes Verified, Recorded, Observed, Inferred and Missing, and never exposes invented hidden reasoning.
- Interaction and accessibility: playback, scrub, event stepping, speed, Story/Real time, depth switching, task switching, search, filters, evidence links, Ask Replay, export/share toasts and keyboard navigation work. Focus outlines, semantic labels and reduced-motion support are present.
- Responsiveness: no horizontal page overflow occurred at 1672 × 941, 1024 × 768 or 390 × 844. Persistent bottom controls remain visible, and the mobile Verify receipt and question input remain reachable.

## Above-the-fold copy differences

The source concept uses short English task labels and separate A–E panels. The implementation intentionally adds a Chinese session contract—original goal, result, verification and evidence coverage—plus result/important changes/attention. This is required by the approved V3 information architecture and makes the mock standalone for a broader non-coding Agent audience; it is not fidelity drift.

## Intentional deviations

- The global product sidebar in the concept board is omitted because this prototype represents Replay opened inside the existing Pi Agent shell, not a second application shell.
- A–E are not exposed as five competing modes. Recap, Explore and Verify are progressive depths over one event/evidence ledger.
- Thumbnail filmstrips and a spatial app map are replaced by a semantic chapter rail and adaptive artifact stage; their value survives without forcing a coding-specific or video-editor metaphor.
- The default scenario uses a 32-minute actual session compressed into a 58-second recap rather than the concept board's 38-second demo.

## Comparison history

1. Initial visual pass — blocked by P0 workspace collapse.
   - Finding: Header and session contract were nested inside one grid child while the page grid reserved two separate rows, collapsing the main workspace and assigning the timeline to the wrong row.
   - Fix: introduced an explicit `header-stack` with matching internal rows and reduced the page grid to three direct-child rows across desktop, tablet and mobile.
   - Post-fix visual evidence: `qa/preview-recap.png`, `qa/preview-explore.png` and `qa/preview-verify.png` show the full stage, evidence rail and persistent timeline within one viewport.
2. Responsive verification pass — blocked by P2 evidence reachability.
   - Finding: the sub-940px rule hid Verify's evidence side, so a mobile user could enter Verify but not reach the receipt or Ask Replay input.
   - Fix: restored the Verify side as a stacked, scrollable section at 680px and below while keeping Recap and Explore compact.
   - Post-fix visual evidence: `qa/preview-mobile.png` shows the stable mobile Recap state; the browser QA additionally enters Verify and asserts that both the evidence receipt and question input are visible.
3. Final same-state comparison — passed.
   - Rebuilt the production bundle, recaptured the implementation at 1672 × 941, regenerated the combined full/focused comparison, reran responsive interaction checks and rechecked console health.

## Primary interactions tested

- Start and pause the 58-second recap.
- Open Explore and filter to events that are not directly verified.
- Open Verify, inspect the evidence receipt and submit an Ask Replay question.
- Switch from market research to purchase approval without changing the underlying depth model.
- Switch the timeline from Story time to Real time.
- Confirm tablet and mobile layouts do not overflow horizontally.
- Confirm the mobile Verify receipt and evidence question input are reachable.

Console errors checked: yes. The browser QA collected `console.error` and `pageerror` events and asserted an empty list.

## Implementation checklist

- [x] Preserve the accepted visual language at the source viewport.
- [x] Implement one shared event/evidence ledger with three progressive depths.
- [x] Demonstrate multiple non-coding Agent domains.
- [x] Make playback, search, filtering, verification and evidence questions interactive.
- [x] Keep mobile verification evidence reachable.
- [x] Rebuild and rerun browser QA after every P0/P1/P2 fix.

final result: passed

