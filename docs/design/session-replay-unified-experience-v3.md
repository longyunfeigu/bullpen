# Agent Replay V3 — One Story, Three Depths

Status: product direction proposal  
Date: 2026-07-15  
Scope: Pi Home, managed agents, Claude/Codex terminals, and non-coding agents

## Decision

Replace the five peer modes A–E with one replay experience that progressively
deepens:

1. **Recap** answers “what happened and does it matter?”
2. **Explore** answers “what happened around this moment?”
3. **Verify** answers “what proves this claim and can I approve it?”

These are not separate visualizations or data stores. They are three depths of
the same selected moment. The playhead, filters, evidence selection, and source
boundaries remain stable as the user moves deeper.

The product name remains **Replay / 回顾**. “Replay” is the familiar entry
metaphor; “Recap” is the default experience inside it.

## Why the current A–E structure is not the final answer

The current implementation established the right technical foundation, but the
information architecture still exposes the design exploration to the user.

### 1. It asks users to choose a representation before they have a question

A, B, C, D, and E are designer concepts, not user intentions. A returning user
usually wants one of three things: understand the result quickly, investigate a
moment, or verify evidence. Choosing between “causal”, “spatial”, and
“documentary” creates avoidable work.

### 2. A is visually compelling but still artifact-first

The before/after stage works beautifully when a file or document changed. It is
weak for research, scheduling, communication, purchasing, monitoring, or a run
whose important result is a decision rather than a file. The default experience
must begin with the goal and outcome, then render the best available artifact.

### 3. B currently risks overstating causality

Temporal adjacency is not causality. A line between two events may mean only
“happened next”. Replay may show `requested by`, `produced`, and `verified by`
only when those relations are explicitly recorded. Everything else is related
context, not a causal claim.

### 4. C turns missing semantics into a destination

A cross-app map is valuable only when applications and resources are emitted by
MCP/provider events. For a plain terminal, a spatial graph is decorative. App
identity belongs on timeline lanes and artifact cards; it does not deserve a
peer mode when the evidence is incomplete.

### 5. D and E are useful, but they are depths, not destinations

The event list, inspector, provenance, approval record, and evidence table are
exactly what advanced users need. They should open around the currently selected
moment, without resetting the user's mental position or moving to another mode.

### 6. Numeric “confidence” is not defensible yet

Values such as 58%, 86%, or 96% currently come from product heuristics rather
than calibrated probabilities. They look precise but cannot withstand an audit.
V3 replaces them with categorical evidence levels and separately reports
measurable coverage.

### 7. Session-level capture grade hides mixed evidence

A run can contain full Pi events, observed terminal text, structured MCP calls,
and inferred narrative at the same time. One badge for the whole session can
silently upgrade weaker moments. Capture level must be shown per event and as a
segmented coverage band on the timeline.

## Product promise

> In ten seconds, understand the outcome. In sixty seconds, understand the
> story. In three interactions, reach the evidence for any claim.

This promise works for code, documents, spreadsheets, research, email,
calendars, approvals, purchasing, operations, and other agent work.

## The unified screen

### Persistent header: the session contract

The header is visible at every depth and contains:

- Original goal, not an agent-generated title alone.
- Outcome: completed, partially completed, needs attention, or stopped.
- Verification state: verified, partly verified, or not verified.
- Actual elapsed time and condensed recap length.
- Source coverage summary: Full / Structured / Observed / Missing.
- Close and Share evidence receipt.

It never shows a single synthetic confidence percentage.

### Default body: Recap

The first frame is a result card, not the first low-level event.

It answers:

- **Result** — one factual sentence about what was achieved.
- **Changed** — the three highest-impact outputs or state changes.
- **Attention** — failures, unresolved questions, risky actions, or missing
  verification.
- **Evidence coverage** — what the recorder could and could not see.

The primary action is **Play 60-second recap**. Replay does not autoplay when
opened; a user returning from a long absence first gets a stable orientation.

Below the result card, the adaptive artifact stage renders the selected moment.
The stage is not hard-coded to files:

| Evidence | Stage renderer |
| --- | --- |
| Code or file | Before/after, patch, verification result |
| Document | Version comparison with changed passages |
| Spreadsheet | Changed cells, formulas, and affected chart |
| Research/web | Source page, captured excerpt, citation, and resulting claim |
| Message/email | Draft/final state, recipients, delivery state; sensitive body redacted by policy |
| Calendar/task | Previous and new state, participants/assignees, due time |
| Approval/purchase | Request, policy/checkpoint, approver, final disposition |
| MCP/application | Tool request, normalized result, named application/resource |
| No artifact | Observable action card with result and evidence level |

### Story rail: chapters chosen by meaning

The left rail contains at most eight semantic chapters:

- Request
- Plan or approach
- Important discoveries
- Decisions and approvals
- Material changes
- Problems and recovery
- Verification
- Result

Chapters are ranked by user impact, irreversibility, risk, failure, approval,
output delta, and verification—not sampled evenly by event count.

### Evidence drawer: always contextual

The right drawer follows the selected moment. It contains:

- Observable claim.
- Evidence level and source.
- Immutable evidence references and integrity hashes when available.
- Before/after or request/result pair.
- Explicit relationship links: Requested by, Produced, Verified by.
- Redactions and missing-evidence explanation.
- Reversibility: reversible, compensating action available, or irreversible.
- Actions: open artifact, compare checkpoint, ask about this moment, export
  receipt, or roll back when the domain adapter supports it.

The drawer collapses in Recap, opens automatically in Verify, and becomes a
sheet at narrow widths.

### Bottom control: semantic timeline

The timeline keeps real timestamps but defaults to **Story time**:

- Idle gaps are folded.
- Repeated reads/searches/terminal refreshes are grouped.
- High-impact changes and decisions receive enough screen time to understand.
- Failures, approvals, irreversible actions, and verification are never skipped.
- Hovering or opening a moment always reveals actual wall-clock time.

The user can switch to **Real time**, zoom from the full run to a local window,
or play at 1×, 2×, 4×, 8×, and 16×.

The timeline has four quiet lanes rather than five modes:

1. Conversation and intent
2. Actions and applications
3. Artifacts and state changes
4. Decisions, risk, and verification

A coverage band directly under the lanes shows Full, Structured, Observed, and
Missing segments for the exact interval. This prevents a strong event from
visually upgrading the entire session.

## Three depths, one position

### Depth 1 — Recap

For the user returning after a long task. It shows the outcome card, adaptive
artifact stage, semantic chapters, evidence highlights, and condensed playback.

### Depth 2 — Explore

Triggered by expanding the timeline, opening “all events”, searching, or asking
to see surrounding context. The stage remains visible while the timeline grows
into a virtualized chronological list. Filters are questions, not data types:

- What changed?
- What decisions were made?
- What failed or was retried?
- What required approval?
- What remains unverified?
- Which application or person was involved?

The previous D event list becomes this depth. The previous C app view becomes
application lanes and filters. The previous B graph becomes explicit context
links inside the selected moment.

### Depth 3 — Verify

Triggered from a claim, risky action, approval, result, or Share receipt. The
selected moment does not change. The evidence drawer expands into a review
workspace with immutable evidence, checkpoint comparison, policy/approval
record, redactions, reversibility, and export.

The previous E audit table remains available as **All evidence**, but the normal
path begins with the claim the user was already inspecting.

## Evidence language

V3 uses levels that describe provenance, not probability:

| Level | Meaning | UI treatment |
| --- | --- | --- |
| Verified | Direct artifact/result plus a successful verification or signed receipt | Green check |
| Recorded | Structured provider, Pi, MCP, approval, or application event | Blue solid marker |
| Observed | Terminal/process/file-system observation without semantic provider confirmation | Amber outlined marker |
| Inferred | Narrative or relationship derived from recorded facts | Dashed marker with citations |
| Missing | A known interval or claim lacks sufficient evidence | Gray gap / explicit warning |

Only a measurable quantity may use a percentage, for example “82% of the run
has structured or full coverage”. The UI never calls this confidence.

## “Ask this replay”

Every selected moment offers a constrained question box. Example prompts:

- Why was this changed?
- Show only the steps that affected the customer.
- Which claims were not verified?
- What happened between the approval and the purchase?
- Did the agent retry after this failure?

Answers must cite event/evidence ids. When the ledger cannot answer, it says
“The recording cannot confirm this” instead of reconstructing hidden reasoning.
The answer is a derived narrative and is never written back as raw evidence.

## Entry points

- **Home task card:** `View recap · 48s` after completion; `Watch live` while
  running.
- **Task Room:** Replay beside Outcome and Review.
- **Changes panel:** the play button seeks to the first material change rather
  than always opening at 00:00.
- **External terminal ended toast:** View recap.
- **Approval/high-risk task:** Verify opens first, with Recap one level up.

The entry determines the initial moment and depth, not a different replay
product.

## Live behavior

During a running session, Replay becomes **Watch live**:

- The user follows the current chapter or detaches and explores history.
- New high-risk, failed, approval, and verification events create quiet markers;
  they do not steal focus while detached.
- Capture coverage is visible immediately.
- The result card remains provisional until the session closes.

## Domain-neutral event and evidence model

The existing `task_events` ledger and blob store remain the source of truth.
V3 adds optional normalized facts rather than a second replay database.

```ts
interface ReplayFact {
  id: string;
  span: { startedAt: string; endedAt?: string };
  actor: { id: string; kind: 'user' | 'agent' | 'application' | 'system' };
  action: string;
  target?: { type: string; label: string; app?: string; resource?: string };
  result?: { status: string; summary?: string };
  relations?: Array<{ type: 'requested-by' | 'produced' | 'verified-by'; id: string }>;
  risk?: 'none' | 'low' | 'medium' | 'high';
  reversibility?: 'reversible' | 'compensatable' | 'irreversible' | 'unknown';
  capture: 'full' | 'structured' | 'observed';
  evidenceRefs: string[];
}

interface ReplayEvidence {
  id: string;
  type: string;
  source: string;
  capturedAt: string;
  integrityHash?: string;
  beforeRef?: string;
  afterRef?: string;
  previewAdapter?: string;
  redactions?: Array<{ reason: string }>;
}

interface ReplayNarrative {
  id: string;
  kind: 'result' | 'chapter' | 'answer';
  text: string;
  citations: string[];
  generatedAt: string;
  model?: string;
}
```

Facts and evidence are durable. Narratives are derived, versioned, cited, and
replaceable.

## How A–E survive without becoming five modes

| Previous direction | Retained strength | New home |
| --- | --- | --- |
| A cinematic | Playback, stage, before/after, chapters | Recap default |
| B causal | Inputs, decisions, outputs, relationships | Explicit context links and timeline relations |
| C spatial | Cross-application awareness | App lanes, artifact renderer, and app filter |
| D documentary | Dense event list, filters, inspector | Explore depth |
| E audit | Evidence, approvals, checkpoints, rollback | Verify depth and evidence receipt |

No prior work is discarded. The conceptual boundaries stop being navigation.

## Visual direction

Keep Charter's current warm, calm shell and typography. The artifact stage may
remain dark when it improves document/code contrast, but the surrounding UI is
quiet and domain-neutral.

- Blue: current selection and recorded structured evidence.
- Green: verified result, never merely “agent said success”.
- Amber: observed or attention needed.
- Red: failed, denied, irreversible, or policy violation.
- Gray: missing evidence and folded idle time.

Motion is functional: playhead movement, chapter transition, artifact version
change, and drawer expansion. There are no decorative orbits, simulated rooms,
or causal lines without recorded relationships.

At 1440px the layout uses chapter rail + stage + evidence drawer. At 1024px the
chapter rail becomes a horizontal strip and the evidence drawer overlays. At
mobile width, Recap becomes a vertical result/story feed; Verify remains a
sheet. Keyboard navigation, reduced motion, high contrast, and screen-reader
announcements are first-class acceptance criteria.

## Implementation path

### Pass 1 — fix the product structure

- Replace A–E navigation with Recap, Explore, and contextual Verify depth.
- Add the session contract and result card.
- Convert numeric confidence to categorical evidence levels.
- Replace session-global grade presentation with per-event coverage segments.
- Preserve the current playhead across all depths.
- Reuse A stage, D inspector, and E evidence table components.

### Pass 2 — make it truly domain-neutral

- Introduce the artifact renderer registry.
- Ship file/code, generic document, terminal, message, web/source, spreadsheet,
  and approval renderers.
- Replace count-sampled chapters with semantic chapter ranking.
- Add question-shaped filters and virtualized long-run exploration.

### Pass 3 — trust and collaboration

- Add cited “Ask this replay”.
- Add live Watch mode.
- Add immutable shareable evidence receipts and redaction policy display.
- Add explicit relation capture from Pi, MCP, Claude/Codex structured streams,
  and application connectors.

## Acceptance criteria

1. A first-time user can state the result, important changes, and remaining risk
   after ten seconds on the opening frame.
2. A 30-minute run produces a useful recap no longer than 90 seconds without
   skipping any failure, approval, irreversible action, or verification result.
3. Any result-card claim reaches its evidence in at most three interactions.
4. No UI edge claims causality unless an explicit relationship id supports it.
5. No numeric confidence appears unless it is calibrated and defined; coverage
   percentages remain clearly labeled as coverage.
6. A mixed-capture session shows its evidence level per event and per timeline
   interval.
7. Plain Claude/Codex TUI runs never appear semantically equivalent to Pi or a
   structured provider stream.
8. The same screen successfully replays a code edit, research report,
   spreadsheet update, email/calendar workflow, and approval/purchase workflow.
9. Ten thousand events remain searchable and scrubbable without blocking the
   renderer.
10. All generated summaries and replay answers cite durable evidence and admit
    when the ledger cannot answer.

## Final product decision

The perfect direction is not A, D, E plus advanced B/C tabs. It is one story
whose depth changes with the user's question:

- **Recap is the front door.**
- **Explore is the microscope.**
- **Verify is the receipt.**

A–E become reusable visual instruments inside that journey. The evidence ledger
remains singular, and the interface never asks the user to understand the
design taxonomy that produced it.
