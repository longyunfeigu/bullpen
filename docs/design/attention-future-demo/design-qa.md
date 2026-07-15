# Charter Home, Attention & Recovery Demo — Design QA

- Source visual truth:
  - `apps/desktop-renderer/src/views/HomeView.tsx` and `docs/design/home-v2-mockup.html` (shared Home Chat Session entry)
  - `/Users/edy/.codex/generated_images/019f6481-3bd5-7a91-a41d-61eb260c711b/exec-57de3c99-9b92-463b-98ce-fe91b2bbf298.png` (Attention Command)
  - `/Users/edy/.codex/generated_images/019f6481-3bd5-7a91-a41d-61eb260c711b/exec-86c8397a-992a-44f3-8a0c-8c078dbadfdd.png` (Durable Rooms)
  - `/Users/edy/.codex/generated_images/019f6481-3bd5-7a91-a41d-61eb260c711b/exec-02cdecd1-73c6-4238-bcc0-60a9148a178b.png` (Terminal Workbench)
- Implementation: `http://127.0.0.1:4173/`
- Intended comparison viewport: 1440 × 1024, light theme.
- States: five chapters across all three product directions: Home launch, exact session/attention entry, sub-agent work, scoped permission, and semantic terminal completion.
- Implementation screenshot: unavailable.

## Evidence available

- Production build passes and emits one self-contained `dist/index.html` (366.67 kB, 101.70 kB gzip).
- Server responds with HTTP 200 at the local URL.
- Four interaction tests pass: shared Home session entry, product switching, timeline seek/restart/next-attention, and scoped approval state.

## Blocker

The Browser plugin was invoked first, but no browser binding is available in this environment. Local Playwright was not used because the user has not explicitly approved that fallback.

Because the implementation cannot yet be visually captured:

- Full-view comparison evidence: blocked.
- Focused-region comparison evidence: blocked.
- Fonts and typography comparison: blocked.
- Spacing and layout rhythm comparison: blocked.
- Colors and tokens comparison: blocked.
- Image/icon fidelity comparison: blocked.
- Copy comparison: source/code inventory and interaction assertions completed; browser-rendered comparison blocked.
- Responsive and visible interaction-state inspection: blocked.

## Findings

- [P1] Browser-rendered visual evidence is missing.
  - Location: all three product directions and their five playback chapters.
  - Evidence: source visuals are available, but no implementation screenshots can be produced through the approved browser surface.
  - Impact: layout clipping, typography drift, state-transition overlap, and responsive failures cannot be ruled out.
  - Fix: with explicit fallback approval, capture 1440 × 1024 keyframes for Home and A/B/C, compare against the Home source and direction concepts, fix P0/P1/P2 issues, then repeat.

## Comparison history

- Pass 1: implementation tests and single-file build passed; screenshot comparison remains blocked because no approved browser capture path is available.

## Implementation checklist

- Capture the shared Home composer at 0, 3 and 5.5 seconds.
- Capture A at Attention, permission, and completion chapters.
- Capture B at restored/input, sub-agent, permission, and completion chapters.
- Capture C at exact attention switcher, permission, and completion chapters.
- Compare typography, grid proportions, inspector width, terminal density, state colors, icon family, and copy.
- Verify playback, pause, seek, product switch, resume, next-attention, and approve-once in the rendered page.
- Rebuild the single-file HTML and update this report.

final result: functional pass; visual comparison blocked
