# ADR-0020 — Coordinated application skins

Date: 2026-07-15 · Status: ACCEPTED  
Relates to: APP-006, ED-015, TERM-002, PIVOT-024

## Context

Charter previously had one Studio visual language with light, dark and system
brightness choices. Changing brightness recolored the shell, but typography,
icon geometry, Monaco syntax colors, rich-editor code and xterm remained one
design. The product now keeps Studio and adds three recognizable skins:

- Studio — the original warm-gray and ink visual language;
- Terminal — phosphor green on charcoal;
- Archive — cream paper with terracotta;
- Index — black and white with signal red.

The existing APP-006 brightness preference and user settings must remain valid.

## Decision

1. Persist `general.skin = studio | terminal | archive | index` independently from
   `general.theme = light | dark | system`. This produces four coordinated
   skins with light and dark variants instead of replacing APP-006. Existing
   settings without `skin` resolve to `studio`, preserving the previous visual
   language exactly; no database migration is required.
2. One `data-skin` + `data-theme` pair on the document root selects the token
   contract. Each skin owns application/surface/state colors, UI/display/mono
   font stacks, radii, shadows, focus color and icon stroke geometry.
3. Icons keep one accessible SVG metaphor inventory. CSS changes their weight,
   caps, joins and glow as a family, avoiding three divergent icon component
   trees.
4. Monaco has eight named themes. Studio retains the original native VS token
   language while the other skins use per-token rules and editor chrome colors.
   The rich Markdown Prism surface follows the same semantic syntax palette.
   xterm has six ANSI palettes and updates existing terminal instances live.
5. A custom editor font remains an explicit user override. The historical
   default font value follows the selected skin so code typography participates
   in the switch without discarding user preferences.
6. Settings exposes code-native miniature previews; command palette and native
   application menu expose direct skin commands. Switching is immediate and
   persisted through the existing validated SettingsService path.

## Alternatives considered

- Replace light/dark/system with three fixed themes: rejected because it breaks
  APP-006 and removes system-following behavior.
- Color tokens only: rejected because it does not satisfy the requested type,
  icon, Monaco, Prism and terminal changes.
- Four separate component trees or raster mockups: rejected because behavior
  and accessibility would drift between skins.
- Download web fonts: rejected to preserve offline startup, CSP simplicity and
  package size. The stacks use platform fonts with deterministic fallbacks.

## Data, security and rollback

The new setting is non-sensitive and stays in `settings.json`. It adds no IPC
surface, dependency, remote asset or executable capability. Rollback is the
removal of `general.skin` plus the coordinated theme definitions; older setting
files remain readable because parsing is lenient and defaulted.

## Verification

- Settings resolution unit tests cover all four values, defaulting and invalid
  fallback.
- Electron E2E covers live switching and restart persistence.
- Production build and TypeScript/boundary checks pass.
- 1440×900 editor screenshots cover each natural skin; a 1024×640 Settings
  screenshot verifies all preview cards fit with no horizontal overflow.
- Renderer console/page errors are empty in the isolated visual QA fixture.
