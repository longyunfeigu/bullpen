# Agent Replay V3 interactive mock

A complete interactive prototype for a unified Agent Replay experience. It treats the original A–E directions as projections of one evidence ledger and exposes three progressive depths:

- **Recap** — result-first, low-friction playback.
- **Explore** — event search, question-shaped filters, surrounding context.
- **Verify** — claim/evidence inspection, receipts, provenance and boundaries.

The task menu includes three non-coding scenarios: market research, employee onboarding and purchase approval.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` unless Vite reports another port.

## Build and QA

```bash
npm run build
npm run qa
```

The QA flow expects a Chromium browser installed for Playwright. It validates core interactions, desktop/tablet/mobile overflow, the evidence question flow and console health, then refreshes the visual evidence in `qa/`.

## Interaction map

- Start, pause, scrub, step and change playback speed from the persistent semantic timeline.
- Switch between story time and real elapsed time.
- Keep the same selected event while moving between Recap, Explore and Verify.
- Search or filter events by user questions.
- Inspect direct evidence, integrity hash, source, reversibility and explicit relations.
- Ask Replay a question; answers stay bounded to captured evidence.
- Switch scenarios from the task title menu.

