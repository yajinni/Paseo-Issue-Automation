# Manager UI hardening review — complete

The focused manager UI review and hardening series is complete through PR #156. This document records what shipped, the regression layers that now protect it, and the opt-in browser smoke procedure for future releases or major manager UI changes.

## Completed implementation

### Configuration composition and navigation

- Configuration uses the six setup-aligned tabs as its sole configuration navigation surface.
- Transient setup-link cards are no longer produced, and the obsolete `removeSetupLinkCards()` consumer is removed.
- Integration and Maintenance content is folded into the appropriate Configuration tabs.
- Legacy `?view=integration` and `?view=maintenance` URLs normalize with `replaceState` rather than creating browser-history loops.
- Configuration drafts survive refreshes, unrelated actions, in-flight saves, save ordering, and repository switches.

Relevant PRs: #134, #141, #143, #149.

### Work Queue interactions

- The Work Queue details drawer is an accessible modal dialog with focus containment and Escape handling.
- Focus restoration survives live queue-row replacement.
- Live status refresh preserves drawer focus, scroll position, and Recover/Fresh branch selection.
- Recover and Abandon use the shared manager confirmation system rather than native browser dialogs.
- Dangerous actions fail closed if the shared confirmation layer is unavailable.

Relevant PRs: #135, #153.

### Manager status architecture

- Every manager status consumer now registers through `window.addManagerStatusListener(...)`.
- Navigation, Work Queue, Automation/Reviews, Configuration integration, Configuration tabs, Issues/PR Reviews, and Issue Processing no longer assign `window.renderStatus`.
- The temporary renderer-capture compatibility layer and all capture boundaries are removed.
- The status hub keeps one base renderer plus failure-isolated direct listeners.
- Stale repository status payloads are rejected before UI consumers see them.
- Cross-repository late action results are repaired or cleared, and completion feedback explicitly identifies the previously selected repository.

Relevant PRs: #136, #142, #144, #145, #147–#154.

### Async state and refresh correctness

- Issue workload requests deduplicate in-flight calls, use bounded caching, and schedule a deferred refresh so cached plans cannot remain stale indefinitely.
- Manager-wide capacity edits survive polling, in-flight saves, and stale response ordering.
- Lightweight 202 actions trigger the repository-status synchronization they require.
- Configuration saves are single-flight and preserve edits made while Save is active.

Relevant PRs: #137–#141.

## Regression coverage

### Default CI

The normal GitHub Actions matrix remains dependency-light and runs without installing package dependencies before `npm test`.

Coverage now includes:

- focused UI/module contracts for each changed manager surface;
- executable status-hub VM tests for listener delivery, unsubscribe, reentrancy, stale repository rejection, late action repair, and listener failure isolation;
- composed dashboard contracts requiring one status hub, zero capture markers, the seven direct status consumers in production order, six Configuration tabs, no obsolete setup-card path, and interaction polish last;
- executable composition coverage that loads the real status hub plus all seven real consumer scripts and proves one status dispatch reaches every registered consumer exactly once;
- Node 20, 22, and 24 tests/checks/package dry-runs;
- Windows command-shim regression and syntax checks;
- packed-install validation including the published Playwright dependency.

Relevant PRs: #154, #155.

### Opt-in browser smoke

`test/manager-browser-smoke.test.mjs` provides a deterministic Playwright smoke harness around the real generated `managerDashboardHtml()` using in-memory Repo A / Repo B API responses. It does not touch a real repository, GitHub account, or Paseo daemon.

The harness covers:

- unsaved Configuration edits surviving an in-flight Refresh;
- newer edits surviving an older Configuration Save response;
- a Repo A action completing after the UI has switched to Repo B;
- Work Queue drawer branch choice, focus, and visibility across a live status refresh;
- legacy Integration URL normalization and absence of obsolete setup-link cards.

The browser launch is intentionally **not** part of default CI because the source-test matrix does not install dependencies or browser binaries. The test file itself is discovered and skipped successfully in default CI; Playwright is dynamically imported only when the smoke is enabled.

To run the browser smoke from a source checkout:

```bash
npm install
npx playwright install chromium
PASEO_BROWSER_SMOKE=1 node --test test/manager-browser-smoke.test.mjs
```

On Windows PowerShell:

```powershell
npm install
npx playwright install chromium
$env:PASEO_BROWSER_SMOKE='1'
node --test test/manager-browser-smoke.test.mjs
```

Relevant PR: #156.

## Recommended future use

Run the default CI suite for every manager change. Run the opt-in browser smoke before releases that materially change manager navigation, Configuration save/refresh behavior, repository switching, Work Queue drawer behavior, or status/action lifecycle handling.

If browser smoke becomes a frequent release gate, consider adding a dedicated Playwright workflow rather than adding browser installation cost to every normal Node matrix job.

## Review status

**The manager UI review/hardening phase is complete.** Future manager UI work should be tracked as new feature, UX, performance, or bug-fix work rather than as unfinished items from this review.

One repository-hygiene item is outside the code review itself: the superseded `cleanup/remove-obsolete-setup-card-consumer` branch may be deleted when branch-deletion tooling is available. Its intended code cleanup shipped in #149.
