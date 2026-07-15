# Terminal Parallel vNext — grounded user story

Date: 2026-07-15  
Status: design proposal grounded in the current TerminalPanel, ExternalPanel and ADR-0017 implementation

## 1. Product verdict

The terminal remains the primary container. Claude Code and Codex are programs that run inside independent terminal sessions; the product must not replace them with a separate, always-visible Sessions system.

The editor remains a single focused-workspace lens. A terminal session owns its own working context and may belong to another project, task worktree or scratch directory without changing the editor focus.

The right side is one optional focus slot. Moving a session there re-parents the same xterm element and preserves the PTY, scrollback, focus and process. It does not create a second session.

## 2. Current product truths that must be preserved

1. The Bottom Panel is the default home of user terminals.
2. Multiple terminals coexist and continue running when they are not selected.
3. Starting Claude Code or Codex inside a terminal is detected in place.
4. Detection adds the CLI badge, EXT boundary, snapshot, file count and action bar; it does not move or resize the terminal.
5. Moving to the side panel is a user action. Auto-move remains an opt-in setting and is off by default.
6. The promoted side panel is 600 px by default, resizable from 480 to 900 px, and preserves at least an 80-column TUI.
7. A promoted external terminal exclusively owns the right rail. The managed Agent Panel is hidden until the terminal returns.
8. Session exit moves nothing. The terminal stays where the user placed it and gains Review and Resume states.
9. Return to dock moves the same live xterm element back to the Bottom Panel.
10. Closing a terminal with a running process requires confirmation.

## 3. vNext changes

### 3.1 Terminal working context becomes independent from editor focus

Today, ordinary terminals are created under the focused workspace and are disposed when that workspace changes. vNext makes a terminal session belong to one server-resolved working context:

- Focused workspace
- Recent project
- Task worktree
- Scratch directory

The renderer sends a project, task or scratch identity. The host resolves and validates the absolute cwd. Arbitrary renderer-provided absolute paths are not trusted.

Changing the focused editor workspace does not stop global terminal sessions. Explorer, Git and LSP remain bound to the focused workspace; the terminal manager and external-session accounting are bound to each terminal's own project context.

### 3.2 New Terminal becomes a lightweight context chooser

The quick action still creates a shell immediately in the current focused workspace.

The chevron next to New Terminal opens a sheet with:

- Type: Shell, Claude Code or Codex
- Working context: focused workspace, recent project, task worktree or scratch
- Resolved cwd
- Safety/accounting summary

Choosing Claude Code or Codex creates a normal terminal and launches the corresponding CLI command. Manual launch by typing claude or codex remains fully supported.

### 3.3 One side focus slot, with atomic swap

Only one terminal can occupy the right-side focus slot.

If the slot is empty, Move to side panel moves the selected terminal there.

If the slot is occupied, another live terminal offers Replace in side panel. One click atomically returns the current side terminal to its prior dock position and moves the requested terminal into the side slot. Both PTYs keep running throughout the swap.

This replaces the current disabled action when the side slot is taken, without introducing a second right rail or a separate session hub.

### 3.4 Parallel visibility

When Codex is in the side panel and Claude remains in the Bottom Panel:

- Both terminals are visible and live.
- The Bottom Panel terminal list shows Codex as In side panel.
- The side header shows Codex, project, cwd, EXT status and Return to dock.
- The Bottom Panel remains open whenever another terminal exists or the user pinned it.
- The editor stays focused on its current workspace.

## 4. Primary persona and goal

As a developer working across several projects, I want Claude Code and Codex to run in independent terminals with independent working directories, so I can focus one session at the side while monitoring or interacting with the other at the bottom, without changing the editor's focused project or interrupting either process.

## 5. End-to-end user stories

### US-01 — Open the terminal without making a new directory decision

**Given** the editor is focused on Charter IDE  
**When** I press Ctrl+Backquote or choose Terminal  
**Then** the Bottom Panel opens  
**And** the most recent terminal for Charter IDE is selected  
**And** no modal appears unless I explicitly open the New Terminal menu.

Health target: immediate, familiar, zero new friction.

### US-02 — Create Claude in another project

**Given** the editor remains focused on Charter IDE  
**When** I open New Terminal options  
**And** choose Claude Code and Writing launch  
**Then** a normal terminal is created with cwd ~/Documents/ai-writing  
**And** Claude Code launches inside it  
**And** the editor remains focused on Charter IDE  
**And** the terminal row visibly shows Writing launch and its cwd.

Health target: directory choice belongs to the new terminal, not the entire editor.

### US-03 — Run Codex and Claude simultaneously

**Given** Claude is running in Writing launch  
**When** I create a Codex terminal in Charter IDE  
**Then** both terminal rows show live activity  
**And** each row shows a different project and cwd  
**And** selecting one changes only the visible terminal pane  
**And** the other process continues running without losing scrollback.

Health target: parallelism is visible without creating a new global Sessions surface.

### US-04 — Detect a manually launched CLI in place

**Given** I created a normal shell terminal  
**When** I type claude or codex  
**Then** the product detects the foreground CLI  
**And** decorates the terminal with an EXT session bar, snapshot reference and live file count  
**And** does not move the terminal, resize the layout or steal focus.

Health target: weak detection signals may change decoration, never layout.

### US-05 — Move one session to the right

**Given** Codex and Claude are both running in the Bottom Panel  
**When** I choose Move to side panel on Codex  
**Then** the same Codex terminal appears in the right focus slot  
**And** its PTY, scrollback and input remain live  
**And** Claude stays in the Bottom Panel  
**And** the managed Agent Panel is temporarily hidden  
**And** the side panel starts at 600 px and can be resized between 480 and 900 px.

Health target: one deliberate placement change, no process change.

### US-06 — Replace the side session without stopping either Agent

**Given** Codex occupies the side focus slot and Claude is in the Bottom Panel  
**When** I choose Replace in side panel on Claude  
**Then** Codex returns to its previous dock position  
**And** Claude moves to the side in the same transaction  
**And** neither PTY restarts or loses scrollback  
**And** focus lands in Claude only after the swap completes.

Health target: switching attention is one action; placement remains exclusive.

### US-07 — Return the side session to the dock

**Given** a session occupies the right side  
**When** I choose Return to dock  
**Then** the same terminal returns to its previous dock order  
**And** the right focus slot closes  
**And** the managed Agent Panel returns only if it was visible before promotion.

Health target: the placement change is fully reversible.

### US-08 — Open a changed file from another project

**Given** Claude runs in Writing launch while the editor focuses Charter IDE  
**When** I click product-note.md in Claude's Session changes  
**Then** a task-scoped Peek opens for that file  
**And** the focused editor workspace does not silently switch  
**And** an explicit Open project in editor action is available if I want to change focus.

Health target: inspect first, switch project only by explicit intent.

### US-09 — End, review and resume

**Given** an external CLI session is active in either placement  
**When** the CLI exits  
**Then** the terminal stays where I placed it  
**And** its header changes to ended  
**And** Review appears with the tracked file count  
**And** Resume uses Claude Code continue or Codex resume semantics for the same project context.

Health target: lifecycle state and placement state remain independent.

### US-10 — Handle conflicts honestly

**Given** two external terminals target the same writable project tree  
**When** the second agent starts  
**Then** both may run, because these are user-controlled terminals  
**And** the product shows Same working tree: changes may overlap  
**And** it offers Launch in isolated worktree for supported Git projects  
**And** it never claims external terminal changes are isolated when they are not.

Health target: truthful safety language.

### US-11 — Close a running terminal

**Given** Claude or Codex still has a foreground process  
**When** I close its terminal  
**Then** the product explains that the process tree will be terminated  
**And** requires Kill and close confirmation  
**And** removes the session bar and side placement only after confirmation.

Health target: no accidental task termination.

### US-12 — Recover after switching editor focus or restarting

**Given** terminal sessions belong to background project contexts  
**When** I focus another project in the editor  
**Then** the terminals keep running and retain their placement  
**And** the Bottom Panel list still shows their project identities.

**When** the application restarts  
**Then** live OS processes that cannot be reattached are reported as interrupted  
**And** ended external tasks remain reviewable and resumable from their recorded cwd.

Health target: never pretend a detached process is still live.

## 6. Placement state model

| Session state | Placement | Visible actions | Layout behavior |
| --- | --- | --- | --- |
| Shell idle | Dock | Rename, split, close | No side panel |
| Agent active | Dock | Room, Move to side, close | Detection changes decoration only |
| Agent active | Side | Room, Return to dock, resize | Owns the single right rail |
| Agent active while side slot occupied | Dock | Replace in side panel | Atomic swap, no restart |
| Agent ended | Dock or Side | Review, Resume, Return if side, close | Session end never moves the terminal |
| Terminal closed | None | None | Prior Agent Panel layout is restored |

## 7. Information hierarchy

The same identity appears in three places:

1. Terminal row: Agent, task label, project, short cwd, live/ended status.
2. Session bar or side header: Agent, EXT boundary, project, full cwd, snapshot and file count.
3. Global status bar: focused editor workspace and number of live terminal contexts.

Project and cwd are always visible before a user sends input to a terminal.

## 8. Accessibility and interaction requirements

- Side splitter has a 12 px hit target, pointer capture and keyboard controls.
- Left and Right resize by 16 px; Home and End select minimum and maximum.
- All placement actions expose visible text, not icon-only controls.
- Live dots are redundant with text labels.
- Motion respects reduced-motion preferences.
- Focus returns to the terminal after mount, swap or return.
- Toasts use a polite live region and never contain the only explanation of a state.
- Terminal list rows remain keyboard navigable.

## 9. Required implementation delta

1. Replace renderer-controlled cwd creation with host-resolved working-context identity.
2. Stop disposing global terminal sessions when the focused workspace changes.
3. Bind external session accounting to each terminal's ProjectContext rather than WorkspaceHost.current.
4. Add project and cwd metadata to terminal list DTOs and renderer state.
5. Add optional launch preset for shell, Claude Code and Codex.
6. Replace the side-slot disabled state with an atomic swap operation.
7. Keep current mountTerminal substrate, resize rules, SessionBar, exclusive right-rail ownership, Review and Resume semantics.

## 10. Non-goals

- No permanent Sessions right rail.
- No transcript parsing into native chat cards.
- No product composer bridge into external CLI stdin.
- No claim that two external agents writing the same tree are isolated.
- No automatic project-focus switch when a session edits another project.
- No automatic movement on CLI detection or session exit.
