# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design direction

- The accepted source is `../session-replay-five-directions-concept.png` for Charter's visual language plus `../session-replay-unified-experience-v3.md` for the product structure.
- A–E are not user-facing modes. The prototype uses one story with three progressive depths: Recap, Explore, and Verify.
- Playback position and selected evidence must persist when switching depths.
- The default frame begins with outcome, important changes, attention, and evidence coverage; playback starts only when requested.
- Confidence is categorical (Verified, Recorded, Observed, Inferred, Missing). Do not invent numeric confidence percentages.
- The interface must demonstrate non-coding agent work and domain-adaptive artifact rendering.
