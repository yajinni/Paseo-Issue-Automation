# Manager UI hardening review — complete

The focused manager UI review and hardening series is complete through PR #158. This document records what shipped, the regression layers that now protect it, and the browser smoke procedure for future releases or major manager UI changes.

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

### Browser smoke

`test/manager-browser-smoke.test.mjs` provides deterministic Playwright coverage around the real generated `managerDashboardHtml()` using in-memory Repo A / Repo B API responses. It does not touch a real repository, GitHub account, or Paseo daemon.

The browser suite covers:

- unsaved Configuration edits surviving an in-flight Refresh;
- an edit begun after an already-running status request surviving that older response;
- newer edits surviving an older Configuration Save response;
- a Repo A status response arriving after Repo B becomes active without repainting Repo B;
- a Repo A Configuration save finishing after Repo B becomes active without repainting Repo B;
- a Repo A action completing after the UI has switched to Repo B with repository-scoped feedback;
- `pr-review/resume`, `restart-issue`, and `review-worker/restart` repository-scoped actions each causing the required follow-up status refresh;
- repeated Issues status updates remaining inside the 15-second issue-plan cache and producing one deferred refresh per cache cycle rather than immediate duplicates;
- Work Queue drawer branch choice, focus, and visibility surviving a live status refresh;
- Back/Forward normalization through legacy Integration and Maintenance history entries;
- absence of obsolete Configuration setup-link cards.

PR #158 added `.github/workflows/manager-browser-smoke.yml`. The dedicated workflow:

- runs automatically on pull requests only when the smoke harness or its workflow changes;
- installs package dependencies and Chromium, then runs the smoke with `PASEO_BROWSER_SMOKE=1`;
- is also available through `workflow_dispatch` for release/manual validation after merge;
- does not add browser installation cost to the normal CI matrix.

The full browser suite was executed on PR #158 after Chromium installation: **2 tests passed, 0 failed**. The original cross-module race/focus test completed in about 2 seconds, and the extended lifecycle/cache/history test completed in about 31 seconds, including two real 15-second issue-plan cache windows.

The smoke test remains discovered and skipped by normal dependency-free `npm test`. Playwright is dynamically imported only when browser smoke is enabled.

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

Relevant PRs: #156, #158.

## Recommended future use

Run the default CI suite for every manager change. Run the dedicated Manager browser smoke workflow before releases that materially change manager navigation, Configuration save/refresh behavior, repository switching, Work Queue drawer behavior, issue-plan refresh behavior, or status/action lifecycle handling.

Keep the browser workflow separate from the normal matrix unless browser-level validation becomes valuable enough on every manager PR to justify dependency and Chromium installation cost.

## Review status

**The manager UI review/hardening phase is complete.** Future manager UI work should be tracked as new feature, UX, performance, or bug-fix work rather than as unfinished items from this review.

One repository-hygiene item is outside the code review itself: the superseded `cleanup/remove-obsolete-setup-card-consumer` branch may be deleted when branch-deletion tooling is available. Its intended code cleanup shipped in #149.
