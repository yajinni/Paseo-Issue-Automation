# Standalone Manager UI Redesign Plan

## Goal

Make the standalone manager the canonical day-to-day Paseo Issue Automation UI, using the same visual language as the setup walkthrough and a left-sidebar application layout. Preserve server-owned state, lifecycle semantics, repository isolation, review safety, and existing action behavior while progressively improving information architecture and interaction feedback.

The embedded repository-local dashboard remains compatibility-only during this work. Useful ideas may be reused, but obsolete lifecycle labels or status semantics must not be copied into the standalone manager.

## Design principles

1. **One visual system.** Setup and manager share colors, spacing, buttons, form controls, cards, status states, focus treatment, and motion rules.
2. **Repository context is always visible.** The selected repository and Add repository via setup action live at the top of the sidebar.
3. **Navigation reflects operator tasks.** Overview, Work Queue, Automation, Reviews, Configuration, Integration, Maintenance, and Manager Settings each have a clear purpose.
4. **Server state remains authoritative.** UI navigation, badges, controls, and optimistic feedback never invent successful backend state.
5. **Long-running work is obvious.** Any action that remains active for roughly one second gets explicit progress feedback; its initiating control immediately enters a busy state.
6. **Danger is progressively disclosed.** Removal, migration adoption, destructive maintenance, and manual registration do not compete visually with normal operations.
7. **Technical detail is available, not dominant.** Raw JSON, paths, hashes, and diagnostic detail live behind disclosures or detail drawers unless directly actionable.
8. **Current lifecycle only.** User-visible queue/review states derive from the current `paseo:*` lifecycle and native GitHub dependency data. Do not reintroduce retired `agent-*`, `automation-blocked`, or other legacy label models.
9. **Accessible by construction.** Keyboard navigation, visible focus, semantic labels, modal focus management, reduced motion, and responsive behavior are acceptance criteria.

## Target information architecture

### Sidebar

Repository context:
- Paseo Issue Automation brand
- active repository selector
- Add repository via setup

Repository views:
- Overview
- Work Queue
- Automation
- Reviews
- Configuration
- Integration
- Maintenance

Manager view:
- Manager Settings

Sidebar badges are data-driven only:
- Work Queue: active/waiting count when useful
- Reviews: actionable review count
- Maintenance: attention indicator

On narrow screens the sidebar becomes a menu/drawer and content remains the primary viewport.

### Overview

Purpose: answer “is automation healthy and what needs me?” without scanning diagnostic panels.

Show:
- selected repository and base branch
- issue-processing readiness
- claims state
- coding worker state
- PR-review worker state
- active work count
- needs-attention count
- primary blocker/recovery action
- concise active-work preview
- concise recent-activity preview
- last-updated indicator

Do not show the full configuration form, installation controls, raw dispatch JSON, or destructive maintenance actions here.

### Work Queue

Purpose: show the actual issue/PR automation pipeline.

Use current lifecycle concepts such as:
- Ready
- Queued
- Coding
- Review queued
- Reviewing
- Changes requested
- Fixing
- Review failed
- Failed
- Needs attention

Each item should expose, when available:
- issue number and title
- current automation stage
- pull request number/link
- exact current head SHA in details
- elapsed/current-round information
- dependency wait/blocker
- next expected action
- validation/review summary

Selecting an item opens a detail drawer/panel with timeline/history, review/fix rounds, blockers, technical identity, and issue-specific actions.

Manual Start, Skip, Unskip, Restart, and Abandon move from a generic issue-number form to the relevant queue item. Advanced/manual entry may remain behind an explicit advanced control if needed for recovery.

### Automation

Purpose: operate repository automation itself.

Separate cards for:
- Claims: enabled/paused, Resume/Pause
- Coding worker: state, Start/Stop/Restart, polling/last tick/error
- PR-review worker: state, Start/Stop/Restart, last tick/reconciliation/error
- Scheduling: Run now, repository maximum active issues, capacity-wait reason

Manager-global capacity does not live here.

### Reviews

Purpose: make PR review lifecycle visible instead of hiding it among worker facts.

Show:
- configured workflow
- review worker health
- active/queued reviews
- quick/full review stage
- current/max round
- exact-head identity
- changes-requested/fix state
- manual-review handoff state
- Web ChatGPT / ChatGPT Profile readiness when the workflow uses it
- actionable PR links

### Configuration

Purpose: edit normal post-setup repository settings safely.

Group controls into setup-style cards:
- Repository/runtime: base branch, polling interval
- Provider/Coding Harness
- Coding model and thinking level
- Review model and thinking level
- Issue processing: mode, max active, retries, excluded labels
- Review workflow: workflow, quick/full round limits, coding-PR auto-merge

Requirements:
- inline validation
- clear unsaved state
- sticky save bar only after changes
- server response decides success
- automatic merge remains unavailable for Quick → Manual

### Integration

Purpose: show how the selected repository is connected to the standalone manager.

Show:
- controller mode
- setup completion
- Paseo workspace
- managed lifecycle labels
- issue-template status
- setup PR state/link
- embedded-to-external migration state/link
- expected/unrelated repository changes
- installation/migration/reconciliation actions

Workers-running constraints remain enforced exactly as today.

### Maintenance

Purpose: diagnose and safely recover/remove manager-owned integration.

Show:
- repository health/blockers
- structured recovery actions
- repair state
- removal PR state
- reconciliation state
- advanced diagnostics/technical details
- destructive removal controls behind explicit warning treatment

### Manager Settings

Purpose: make machine/manager-global settings visibly distinct from repository settings.

Show:
- global maximum active coding jobs
- active/available capacity
- running repository workers
- waiting repositories
- last served repository
- manager capacity errors

## Shared interaction patterns

### Progress and busy state

- The clicked button changes immediately: `Restarting…`, `Reconciling…`, `Installing…`, etc.
- If the operation remains active for about one second, show the shared progress surface.
- Preserve known checking/waiting states; do not invent successful intermediate checks.
- Completion feedback uses a normal success/error summary.
- Raw response data is available under Technical details.

### Confirmation

Replace browser-native `confirm()` for product actions with an application modal that states:
- action name
- selected repository
- what will change
- what will not change
- worker/claims implications
- whether a PR will be created

High-risk destructive actions may require typed confirmation.

### Freshness

- Show `Last updated` on status-oriented views.
- Background refresh should update content without stealing focus or resetting the selected view.
- Manual Refresh remains available.

### Navigation and URLs

- Selected view must survive refresh and browser back/forward.
- Use a stable query parameter or equivalent route representation (for example `?view=reviews`).
- Unknown view values fail safely to Overview.

## PR sequence

### PR 1 — UI foundation and shared design system

Scope:
- add shared color/design tokens based on setup
- add reusable UI composition helpers
- apply the shared visual foundation to configured manager and setup surfaces
- add this plan and focused foundation tests
- do not move controls or change backend behavior

Acceptance:
- manager uses the setup color/button/card/form language
- setup retains its existing appearance and behavior
- shared theme has one canonical definition
- current configured manager routes/actions remain intact
- full repository CI passes at exact head

### PR 2 — Sidebar application shell

Scope:
- create explicit standalone manager shell/view composition instead of growing the page through UI-layer string replacement
- add left sidebar and mobile navigation
- move repository selector and Add repository via setup into sidebar
- add deep-linkable views: Overview, Work Queue, Automation, Reviews, Configuration, Integration, Maintenance, Manager Settings
- relocate current panels without changing action contracts

Acceptance:
- every existing manager control is reachable
- browser back/forward and refresh preserve selected view
- repository selection remains persistent and repository-scoped
- narrow-screen navigation works by keyboard/touch
- no obsolete embedded lifecycle terms introduced

### PR 3 — Overview redesign

Scope:
- keep the existing operational summary model
- add primary recovery action, active-work preview, recent activity preview, attention badges, last-updated state
- remove redundant detailed cards from Overview

Acceptance:
- operator can identify health/blocker/current work without opening another view
- detailed health remains in Maintenance
- Overview uses only server-backed state

### PR 4 — Work Queue and item detail

Scope:
- add a manager queue/status DTO/API based on current runs, PR/review/fix state, and native dependency information
- add filters/search/current lifecycle labels
- add issue/PR detail drawer with timeline and technical identity
- relocate manual issue actions to item-specific controls

Acceptance:
- queue does not infer dependencies from body prose
- lifecycle names match current manager semantics
- exact-head review identity is visible in details where applicable
- current manual action behavior is preserved

### PR 5 — Automation and Reviews

Scope:
- separate claims, coding worker, review worker, and scheduling cards
- expose review stage/round/PR progress
- expose ChatGPT Profile state only when relevant
- move global capacity to Manager Settings

Acceptance:
- coding and review worker state/actions are clearly distinct
- Quick → Manual never exposes automatic coding-PR merge
- Web ChatGPT remains machine-global serialized and does not store passwords

### PR 6 — Configuration, Integration, and Maintenance

Scope:
- group v3 configuration using setup-style cards
- add inline validation/dirty state/sticky save
- create dedicated integration/migration presentation
- reorganize health, repair, removal, reconciliation, and technical detail

Acceptance:
- all current v3 fields remain editable with current limits/defaults
- migration/removal safety gates remain fail-closed
- unrelated user files/labels remain protected by existing ownership rules

### PR 7 — Interaction polish and accessibility

Scope:
- generalize >1s progress feedback to manager actions
- button-level busy states
- application confirmation and typed-confirmation modals
- success/error notices and technical-detail disclosures
- remove raw JSON as primary result UI
- focus handling, keyboard navigation, reduced motion, responsive cleanup

Acceptance:
- slow actions always provide visible feedback
- destructive operations clearly communicate consequences
- keyboard-only flow covers sidebar, drawers, modals, and primary actions
- reduced-motion preference is respected
- full exact-head CI and final UI regression suite pass

## Validation strategy for every PR

- focused HTML/composition/UI tests for the changed surface
- service/API tests when a DTO or endpoint changes
- preserve setup regression coverage
- run repository `npm test`
- run `npm run check`
- run `npm pack --dry-run`
- validate packed-install and Windows command checks through GitHub Actions
- inspect exact-head workflow jobs and unresolved PR review threads before merge
- merge only the reviewed exact head; then start the next branch from the new `main`
