# Persistent serial ChatGPT PR review automation

## ELI5

> Paseo has several builders but one inspector. Builders can work on many issues at once. Finished PRs wait in one review line. ChatGPT checks one PR at a time. Good PRs are merged and their issues are verified closed. PRs needing work receive a label and detailed comment, then go back to an available builder.

## Architecture

The Issue Execution Controller runs two independent schedulers:

1. **Parallel coding scheduler**
   - Starts new issue implementations and requested-fix jobs.
   - Uses the user-configured coding concurrency.
   - A requested-fix job uses one coding slot.
   - Open PRs, queued reviews, and the active browser review use no coding slot.
   - Fix jobs update the existing branch and PR.

2. **Serial PR-review scheduler**
   - Submits exactly one review prompt at a time across projects sharing the dedicated browser profile.
   - Uses a machine-global review lease and a dedicated browser-profile lease.
   - Persists review jobs, ordering, attempts, prompt versions, reviewed SHAs, and errors.
   - Does not use GitHub webhooks or a public inbound endpoint.

When a Coder creates a draft PR and records validation for its exact head, Paseo registers the managed PR, releases the coding slot, and adds a persistent review job. The coding scheduler may immediately start another issue.

## Registering an existing pull request

An already-open pull request can be registered without creating an issue run, coder workspace, controller state, or Issue Claiming state:

```bash
npx paseo-issue-automation pr-review import --id OWNER/REPOSITORY#PR [--issue N] [--head FULL_HEAD_SHA]
```

The repository selector must match the configured checkout. Registration fails closed unless the pull request is open, non-fork, same-repository, targets the configured base branch, and has a current full head SHA and branch. Paseo infers one same-repository closing issue only when the association is unambiguous; otherwise pass `--issue N`. The selected issue must be an issue rather than another pull request. Forks, cross-repository references, wrong bases, stale or mismatched heads, unsupported selectors, and conflicting PR/issue ownership are rejected.

The repository-scoped API is `POST /api/repositories/{repository-selector}/pr-reviews/import` with `{ "pullRequestNumber": PR, "issueNumber": N, "headSha": "FULL_HEAD_SHA" }`. The repository-local API is `POST /api/pr-reviews/import` with `id: "OWNER/REPOSITORY#PR"` and the same optional fields.

Successful imports are idempotent by canonical repository and pull-request identity and persist `manual-import` provenance containing the exact PR, issue, base, branch, and head. This registration foundation intentionally does not execute imported reviews: `pr-review review-now` fails closed with an incomplete-capability error and creates no review job or legacy worker selection. Controller-created managed PR registration and review behavior are unchanged.

## Persistent state

Repository-specific state uses the package's existing atomic JSON storage beneath the repository's Git common directory:

```text
<git-common-dir>/paseo-issue-automation/pr-review.json
<git-common-dir>/paseo-issue-automation/pr-review.lock
```

The file contains:

- managed PR records;
- serial review jobs;
- coding fix jobs;
- queue ordering and active-job identifiers;
- review and reconciliation configuration;
- state-transition history;
- submitted, completed, and current SHAs;
- prompt versions, request IDs, retries, and errors.

Writes use an owner-only lock file and atomic replacement. The local store is authoritative. GitHub labels communicate state and support reconciliation.

No database migration is required for this implementation because the existing repository already uses durable atomic JSON state and no database or general job-queue framework exists to extend. The PR-review store is versioned for future migrations.

## Review identity and deduplication

A review job is uniquely identified by:

```text
repository + PR number + head SHA + review prompt version
```

Paseo does not submit that identity twice unless the prior submission failed and an explicit or bounded retry is allowed. When several commits arrive quickly, older queued jobs become `superseded` and only the latest SHA is reviewed after the configured debounce.

## GitHub reconciliation

Paseo records PR creation and coding completion directly because it controls the coding workflow. It polls only its persisted managed PRs to reconcile external changes such as:

- labels;
- PR comments and review submissions;
- current head SHA;
- merge or close state;
- review decision;
- CI/check status included in the PR snapshot;
- associated issue state when merge completion is verified.

The active interval defaults to 45 seconds, with a longer idle interval. Both are configurable. No unrelated repositories or unknown PRs are scanned.

## Review-result protocol

ChatGPT writes the result to GitHub rather than Paseo scraping the ChatGPT response. A machine-readable marker accompanies human-readable findings:

```html
<!-- paseo-review:v1
{"reviewRequestId":"...","repository":"owner/repo","pullRequestNumber":45,"issueNumber":101,"headSha":"abc123","reviewRound":2,"promptVersion":1,"result":"changes_requested"}
-->
```

Paseo validates the repository, PR, issue, request ID, prompt version, and reviewed SHA. A changes-requested result also requires the `paseo:changes-requested` label. Stale or already-processed results do not create fix jobs.

## Requested fixes

A valid changes-requested result creates a fix job in the normal coding queue. The Coder receives the complete findings and these non-negotiable instructions:

```text
Update the existing PR branch.
Do not create a new branch or PR.
Resolve the listed review findings.
Add or update tests.
Run changed-area validation.
Push the fixes to the existing branch.
Report the new head SHA to Paseo.
```

After the Coder finishes, Paseo verifies that the existing PR is still open and its head changed. It then increments the review round, clears fixing/change labels, adds `paseo:review-queued`, and queues only the new SHA. The coding slot is released.

## GitHub labels

Paseo creates or reuses:

```text
paseo:review-queued
paseo:reviewing
paseo:changes-requested
paseo:fixing
paseo:review-failed
```

Typical transitions:

```text
PR created or updated → paseo:review-queued
submission begins → paseo:reviewing
changes required → paseo:changes-requested
fix Coder begins → paseo:fixing
new SHA pushed → paseo:review-queued
review passes → merge or human review, depending on configuration
```

## Playwright installation

`playwright-core` is an optional dependency. Normal package installation does not download Chromium. Use an explicit command:

```bash
npx paseo-issue-automation browser install
```

On a new Linux machine, install operating-system dependencies and Chromium:

```bash
npx paseo-issue-automation browser install --deps
```

Operating-system dependency installation may require elevated privileges. Paseo reports the underlying Playwright error rather than attempting privilege escalation silently.

Complete guided setup:

```bash
npx paseo-issue-automation browser setup
```

Available commands:

```text
browser setup
browser install
browser login
browser configure
browser doctor
browser test
browser debug
browser reset
browser uninstall
```

A real ChatGPT browser test is opt-in and is not part of the default automated test suite.

## Dedicated browser profile

Paseo never automates the user's normal browser profile. It creates a persistent profile beneath the operating system's application-data directory:

- Linux: `${XDG_DATA_HOME:-~/.local/share}/paseo/pr-review/chatgpt-profile`
- macOS: `~/Library/Application Support/paseo/pr-review/chatgpt-profile`
- Windows: `%LOCALAPPDATA%\paseo\pr-review\chatgpt-profile`

Directories use owner-only permissions where supported. Paseo does not store the ChatGPT password. The user logs in manually. Cookies remain inside the dedicated profile and are never committed, uploaded, printed, or included in diagnostics.

A durable browser lock prevents two Playwright processes from using the profile. A second global lease prevents separate Paseo projects from simultaneously claiming the one ChatGPT inspector.

## Login and conversation selection

```bash
npx paseo-issue-automation browser login
npx paseo-issue-automation browser configure --scope global
npx paseo-issue-automation browser configure --scope project
```

The dashboard also supports:

- launching the dedicated browser;
- using its current conversation for the project or global default;
- pasting a project conversation URL;
- testing the destination;
- optionally sending a harmless test prompt;
- changing future review destinations.

Resolution order:

```text
one-time PR review override
→ project conversation
→ global default conversation
```

Each submitted review stores the conversation URL actually used. Changing project settings affects future submissions, not historical records.

## URL safety

Saved destinations must:

- use HTTPS;
- use an explicitly supported ChatGPT host;
- contain no embedded credentials;
- identify a specific conversation;
- open the expected conversation after redirects;
- expose a usable semantic message composer.

Tracking query parameters and fragments are removed. Paseo stops on login, home, unexpected-conversation, or missing-composer redirects. PR information is never submitted after a destination mismatch.

## Merge and issue closure permissions

Automatic merge is disabled by default. Enable it only with explicit project configuration. When disabled, an approved result transitions to human review.

When ChatGPT merge is enabled, the prompt requires an exact-head recheck and an expected-head guard where supported. Regardless of who performs the merge, Paseo independently reconciles the persisted managed PR by its recorded PR number and verifies the exact merged head has both PASS validation evidence and APPROVED review evidence.

After that evidence is established, Paseo verifies the explicitly associated issue. If GitHub already closed it, Paseo records the local issue run completed. If the issue is still open but the merged PR has an unambiguous closing association such as `Closes #N`, `Fixes #N`, or `Resolves #N`, Paseo closes that exact issue and reads it back before recording completion. This is required for non-default integration branches, where GitHub may merge the PR without applying the closing keyword to the issue. The legacy `allowPaseoIssueClosureFallback` setting is retained in stored configuration for compatibility but no longer gates this safe post-merge completion path.

If the association is missing or ambiguous, Paseo does not close anything and keeps post-merge completion pending for operator attention. If the closure request cannot be confirmed by readback, reconciliation retries instead of recording a false terminal state. A PR closed without merge becomes `closed_unmerged` and never closes or completes the issue automatically.

## Restart recovery

On startup Paseo:

1. loads persistent coding and PR-review state;
2. clears the in-memory active-review pointer;
3. returns interrupted browser submissions to the queue;
4. marks interrupted fix workers recoverable;
5. reconciles every nonterminal managed PR;
6. detects new SHAs, review results, merges, closures, and offline changes;
7. resumes at most one serial review;
8. resumes coding up to the configured parallel limit.

Leases expire and can be recovered after crashes. Duplicate review identities remain deduplicated across restarts.

## Dashboard

Open the Issue Execution Controller and choose **PR Reviews**, or browse directly to:

```text
http://127.0.0.1:4317/pr-reviews
```

The page shows:

- active inspector;
- waiting queue in order;
- managed PR state, current and reviewed SHAs, round, issue, branch, and fix state;
- browser, authentication, conversation, and reconciliation health;
- project settings and merge permissions;
- persistent transition history;
- errors and diagnostic screenshot filenames;
- queue, retry, pause, resume, manual-result, fix-dispatch, and closed-unmerged controls.

Review ordering does not alter issue-coding priority.

## Troubleshooting

Run:

```bash
npx paseo-issue-automation browser doctor
npx paseo-issue-automation pr-review status
npx paseo-issue-automation pr-review reconcile
```

Common failures:

- **Playwright missing:** reinstall optional dependencies, then run `browser install`.
- **Chromium missing:** run `browser install`.
- **Linux libraries missing:** run `browser install --deps`; elevated privileges may be required.
- **Authentication unverified:** run `browser login`.
- **Unexpected conversation:** configure the exact conversation again.
- **Composer missing:** open `browser debug`, inspect the page, and retry after ChatGPT is usable.
- **Repeated submission failure:** inspect the dashboard error and sanitized diagnostic screenshot; the job pauses after bounded retries.
- **PR closed without merge:** choose an explicit operator action in the dashboard.

## Reset and uninstall

Reset only the dedicated profile:

```bash
npx paseo-issue-automation browser reset
```

Remove Playwright browser binaries and machine-local browser state:

```bash
npx paseo-issue-automation browser uninstall
```

These commands do not uninstall Paseo Issue Automation or delete repository code. They refuse to run while the browser profile is leased.

## Security summary

- no ChatGPT passwords are stored;
- browser cookies stay in the dedicated profile;
- profile and state files are owner-only where supported;
- diagnostics contain sanitized URL origin/path and error text, never cookies or page storage;
- prompt templates cannot execute dashboard JavaScript;
- GitHub and ChatGPT destinations are validated;
- process arguments are passed as arrays rather than shell-concatenated commands;
- automatic merge requires explicit configuration;
- automatic post-merge issue closure requires exact PASS + APPROVED evidence and an explicit association to that exact issue;
- final state is independently reconciled from GitHub.
