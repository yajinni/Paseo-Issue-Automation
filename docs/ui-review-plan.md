# Manager UI hardening plan

This document tracks the final follow-up work from the manager UI review after PRs #134–#144.

## Completed review work

- Configuration uses the six setup-aligned tabs as its sole navigation surface; transient setup-link cards are no longer produced.
- Work Queue details use an accessible modal drawer with focus containment, live-refresh-safe focus restoration, and shared confirmations for dangerous actions.
- The manager status hub isolates status consumers, rejects stale repository payloads, and protects cross-repository action/status races.
- Issue workload refreshes are deduplicated without allowing the plan to remain stale indefinitely.
- Manager capacity and repository Configuration edits survive polling, in-flight requests, save ordering, and repository switches.
- Lightweight manager actions trigger the status synchronization they require.
- Legacy Integration and Maintenance URLs normalize to Configuration without creating browser-history loops.

## Remaining implementation sequence

### 1. Repository-scoped action feedback

Status: **in progress**

- Make completion feedback explicit when an action finishes after the user switches repositories.
- Keep accepted-status restoration and stale action-result clearing unchanged.
- Cover both cross-repository and same-repository completion behavior in the status-hub VM tests.

### 2. Direct manager status subscriptions

Status: **planned**

- Migrate remaining UI enhancers from assigning `window.renderStatus` to `window.addManagerStatusListener(...)`.
- Remove each `data-manager-status-capture` boundary as its consumer is migrated.
- Split the migration into reviewable batches rather than one large UI rewrite.
- After the last consumer moves, delete `captureManagerStatusRenderer()` and the legacy captured-renderer compatibility path from the status hub.
- Keep one composed dashboard contract proving the status hub loads before subscribers and interaction polish remains last.

### 3. Remove obsolete Configuration setup-card cleanup

Status: **planned**

- Delete `removeSetupLinkCards()` and its build/tab-change calls now that no enhancer produces `.manager-config-step-link` cards.
- Invert the old regression assertion so the obsolete selector and cleanup helper cannot be reintroduced.
- Remove the unused cleanup branch after the code lands when branch-deletion tooling is available.

### 4. Strengthen composed manager regression coverage

Status: **planned**

- Extend `managerDashboardHtml()` composition coverage beyond script-order strings to exercise lifecycle behavior in an executable Node harness where practical.
- Verify the final Configuration surface contains the six expected setup-aligned tabs and no obsolete setup-card path.
- Verify one representative status update reaches every registered manager status consumer exactly once.
- Verify repository switching rejects stale status/action output without suppressing the newly selected repository.

A mandatory Playwright browser test is intentionally not part of the default CI plan yet: the current test matrix does not install browser binaries. Browser smoke coverage should stay opt-in unless the project deliberately accepts the additional CI installation/runtime cost.

### 5. Browser-level smoke scenarios

Status: **planned / opt-in**

Exercise these scenarios against a running manager using the existing Playwright dependency or a manual browser session:

- switch repositories while Refresh, status, action, and Configuration-save requests are in flight;
- begin editing Configuration before an already-running Refresh/action response returns;
- edit again while Configuration Save is active;
- keep Issues open across multiple background refresh cycles;
- keep the Work Queue drawer open across live status updates;
- use Back/Forward through legacy Integration/Maintenance URLs;
- Start/Recover/restart lightweight actions and verify the follow-up status synchronization;
- confirm a late action from another repository cannot look like it completed for the currently selected repository.

## Merge discipline

- Keep each PR focused and independently reviewable.
- Merge parent/infrastructure PRs before starting dependent cleanup when practical.
- Require exact-head GitHub Actions success for every PR.
- Re-check mergeability and composed-manager behavior after each merge because these enhancers share one generated manager document.
