# Setup Walkthrough Implementation Plan

**Status:** Implementation-ready planning baseline  
**Date:** 2026-08-06  
**Repository:** `yajinni/Paseo-Issue-Automation`  
**Primary architecture:** Standalone multi-repository manager  
**Planning pull request:** #61

This document converts the approved setup-walkthrough product decisions into a dependency-ordered sequence of small pull requests. It is intentionally more granular than a normal feature plan because the walkthrough crosses setup state, credentials, repository discovery, workspaces, issue scheduling, review state, installation, browser automation, and migration behavior.

The implementation should not be delivered as one large setup rewrite. Each pull request must preserve a runnable repository, contain focused tests, avoid unrelated cleanup, and be independently reviewable.

## Current implementation compared with the approved walkthrough

### Current setup architecture

- The legacy repository dashboard assumes the program starts from inside an existing Git checkout.
- Setup requirements are evaluated against that checkout and include Git, GitHub CLI, GitHub authentication, Paseo CLI, Paseo reachability, and the current `origin` remote.
- The current setup UI is assembled through server-generated HTML and several client scripts that transform existing controls after page load.
- Provider/model discovery and base-branch discovery already exist, but they are scoped to the current checkout.
- Setup requirement results are cached indefinitely unless the caller forces a refresh.
- The standalone manager already has repository-scoped API routing, status, configuration, installation, migration, worker, and PR-review-worker actions.
- The standalone manager currently registers repositories by local path. It does not guide the user through GitHub repository selection or managed cloning.
- External installation already limits tracked setup changes to the automated-coding issue template and manages labels/workspace separately.
- Setup pull-request creation already creates a separate branch, stages only allowlisted files, opens a PR against the configured base branch, pauses claims, and waits for merge plus local synchronization. It does not yet enable GitHub auto-merge.
- Native GitHub `blockedBy` relationships are already the dependency source of truth. Parent/sub-issue hierarchy is not used by the dependency evaluator.
- The current issue queue is label-only, sorts primarily by creation time, uses legacy `agent-*` labels, and moves dependency-blocked or invalid issues to `agent-blocked`.
- Current repository configuration stores one `maxReviewRounds` value, caps it at 10, and caps `maxActive` at 10.
- The current harness reviewer is already a fresh structured Reviewer session, but it does not distinguish quick review from full review.
- The current browser-review backend already supports persistent Chromium profile storage, manual login, login-redirect detection, selected-conversation verification, composer detection, serial review submission, and exact-SHA result reconciliation.

### Target architecture

- The setup walkthrough lives in the standalone manager and can start outside any repository.
- The legacy embedded dashboard remains compatibility-only and does not receive a second competing wizard.
- Setup is a resumable, explicit, server-backed state machine rather than a collection of DOM transformations.
- The wizard configures one repository per run and may be rerun for additional repositories.
- Machine-level choices and repository-level choices are stored separately.
- Passwords and authenticated browser sessions are never stored in ordinary setup JSON.
- Each page can recheck its own capabilities while preserving still-valid selections.
- Repository selection precedes cloning and workspace creation.
- Runtime behavior is migrated to the approved labels, issue modes, queue ordering, review workflows, retry limits, and merge rules before the final walkthrough enables automation.

## Architectural boundaries

### New setup-wizard module boundary

Prefer a scoped module tree rather than extending the legacy setup scripts:

```text
src/setup-wizard/
  schema.mjs
  store.mjs
  service.mjs
  api.mjs
  paseo-connection.mjs
  credential-store.mjs
  github-auth.mjs
  github-catalog.mjs
  repository-checkout.mjs
  paseo-workspace.mjs
  readiness.mjs
  ui-shell.mjs
  ui-style.mjs
  ui-script.mjs
  pages/
```

Use `test/setup-wizard/` for focused tests. Exact filenames may change when implementation begins, but the separation between state, capability adapters, orchestration, API, and UI must remain.

### Source-of-truth rules

- GitHub is the source of truth for repositories, branches, issues, PRs, checks, reviews, merge state, and native issue dependencies.
- Paseo is the source of truth for available Provider/Coding Harnesses, models, thinking levels, workspaces, and agent execution.
- Machine-local manager state is the source of truth for setup progress and repository-specific configuration.
- The installed issue template is the issue-body contract.
- The new lifecycle catalog is the source of truth for managed label names and meanings.
- A review approval is valid only for the exact PR head SHA it reviewed.

### Security rules

- Never save a Paseo password in a URL, normal configuration file, browser storage, diagnostic output, command history, log, or PR.
- Keep the daemon host/address separate from its credential.
- Pass the password to Paseo child processes through an isolated process environment, using the supported password environment contract, and redact it from every error path.
- Use an operating-system credential store when available. Fall back to memory/session-only storage and explain the limitation.
- Never expose GitHub tokens.
- Never scan the entire filesystem for repositories.
- Never use the user's normal Chrome profile for ChatGPT automation.
- Do not send paid model prompts during ordinary readiness checks.
- Do not create fake issues, fake PR reviews, or application-code changes during setup tests.

## Pull-request operating rules

Every implementation PR must:

1. Branch from the latest merged predecessor using `ai/<short-task-name>`.
2. Keep one primary concern and avoid speculative refactors.
3. Identify changed modules, state formats, routes, commands, and user workflows.
4. Include focused tests for the changed behavior.
5. Run `npm run check`, `npm test`, and `npm run pack:check` before merge, plus narrower tests during development.
6. Preserve Windows command behavior and packed-install validation.
7. Update documentation and the changelog when behavior becomes user-visible.
8. Stop rather than guess when a required Paseo or GitHub capability differs materially from the documented contract.
9. Never claim validation passed unless it actually ran on the exact PR head.

Normal change budget:

- Prefer no more than 6 production modules and 4 focused test files per PR.
- UI-page PRs may touch the wizard shell plus one page module/script/style and focused tests.
- Migration PRs may exceed this only when old and new schemas must be updated atomically.

## Dependency overview

```text
PR 00 planning (#61)
  └─ PR 01 boundaries
      ├─ PR 02 config schema
      │   ├─ PR 03 label catalog
      │   ├─ PR 04 issue-template contract
      │   ├─ PR 05 wizard progress state
      │   └─ PR 20 review configuration
      ├─ PR 06 Paseo connection context
      │   └─ PR 07 credential storage
      ├─ PR 08 GitHub auth/account
      │   └─ PR 09 repository/branch catalog
      │       └─ PR 10 managed checkout
      │           └─ PR 11 Paseo workspace readiness
      └─ PR 12 wizard shell
          ├─ PR 13 Paseo page (06,07)
          ├─ PR 14 Harness page (06)
          ├─ PR 15 GitHub page (08,09)
          ├─ PR 16 Workspace page (10,11)
          ├─ PR 17 Issues page (03,04)
          └─ PR 23 ChatGPT Profile page (20)

Runtime tracks:
  PR 18 issue eligibility and queue (02,03,04)
  PR 19 failure retry and invalid-issue lifecycle (18)
  PR 21 quick/full harness review engine (20)
  PR 22 manual review lifecycle (21)
  PR 24 Web ChatGPT review integration (21,23)
  PR 25 setup PR confirmation and auto-merge (09,10)
  PR 26 normal coding PR auto-merge and completion (21,22,24)
  PR 27 final readiness and finish/start (13–26)
  PR 28 existing-install migration (03,04,18–27)
  PR 29 end-to-end hardening and legacy cleanup (all)
```

PR #60, which changes the standalone manager CLI entrypoint, should merge before the wizard shell is finalized. If it remains open, PR 12 must rebase after it lands so launch and help documentation are not duplicated or contradicted.

---

# Detailed pull-request sequence

## PR 00 — Preserve approved product decisions

**Status:** Existing draft PR #61.

**Purpose**

- Merge the approved walkthrough documents and this implementation plan before runtime work begins.
- Make the repository, rather than chat history, the durable source of truth.

**No runtime changes.**

**Merge gate**

- Confirm the planning files distinguish approved requirements from implementation details.
- Confirm no current behavior is claimed to have changed.

---

## PR 01 — Establish scoped setup-wizard architecture guidance

**Branch:** `ai/setup-wizard-boundaries`

**Depends on:** PR 00

**Purpose**

- Add scoped contributor guidance for `src/setup-wizard/` and `test/setup-wizard/`.
- Define boundaries among state, capability adapters, service orchestration, API, and UI.
- Add empty module/test scaffolding only where needed to enforce imports and syntax checks.

**Likely files**

- `src/setup-wizard/AGENTS.md`
- `test/setup-wizard/AGENTS.md`
- one small architecture/index module
- `docs/SETUP_WALKTHROUGH_IMPLEMENTATION_PLAN.md`

**Acceptance**

- A coding agent modifying one setup area can load only the nearest relevant guidance.
- Guidance requires redaction, injected runners, deterministic tests, and no repository-global filesystem scan.
- No user-visible setup behavior changes.

**Validation**

- Syntax check of new modules.
- A focused test that verifies the public wizard module entrypoint can load.
- Full standard validation.

---

## PR 02 — Add repository configuration schema v3 and migrations

**Branch:** `ai/setup-config-v3`

**Depends on:** PR 01

**Purpose**

Replace the single legacy review/issue configuration shape with explicit fields required by the walkthrough.

**New repository configuration concepts**

- `issueSelection.mode`: `recommended-labels` or `all-open`
- `issueSelection.excludedLabels`
- `issueSelection.temporaryFailureRetries` default 3
- `maxActive` range 1–20, default 1
- `review.workflow`: `quick-manual`, `quick-web-chatgpt`, or `full-immediate`
- `review.quickMaxRounds` default 3, range 1–20
- `review.fullMaxRounds` default 3, range 1–20
- `review.autoMergeApproved` default false
- coding/review model and thinking selections retained
- selected Provider/Coding Harness recorded once
- setup-selected base branch retained

**Migration**

- Migrate config version 2 without dropping models, base branch, polling, workspace, or setup status.
- Map legacy `maxReviewRounds` to the appropriate new full-review value while defaulting quick rounds to 3.
- Preserve the legacy orchestrator field only as read compatibility until later cleanup.
- Keep claims paused if a migrated configuration cannot be interpreted safely.

**Likely files**

- `src/state.mjs`
- new `src/setup-wizard/schema.mjs`
- manager status/config adapters
- config tests

**Acceptance**

- Old config files load deterministically.
- New limits accept 20 and reject 21.
- No review workflow is silently enabled during migration.
- Saving through old manager routes does not erase new fields.

**Validation**

- Version-2-to-version-3 fixtures.
- Round-limit and concurrency boundary tests.
- Partial-update preservation tests.
- Full standard validation.

---

## PR 03 — Introduce the lifecycle-label catalog and compatibility mapping

**Branch:** `ai/paseo-label-catalog`

**Depends on:** PR 02

**Purpose**

Create one lifecycle-label catalog for installation, runtime transitions, status, repair, removal, and documentation.

**Approved catalog**

```text
paseo:ready
paseo:queued
paseo:coding
paseo:review-queued
paseo:reviewing
paseo:changes-requested
paseo:fixing
paseo:review-failed
paseo:failed
paseo:needs-attention
```

**Requirements**

- No `paseo:blocked` label.
- No completion label.
- Preserve review labels already used by the PR-review subsystem.
- Define colors and descriptions centrally.
- Record ownership without overwriting user-owned custom color/description values.
- Add a mapping from legacy `agent-ready`, `agent-running`, `agent-blocked`, `agent-failed`, and `human-review` states.
- Do not mutate live repositories in this PR.

**Likely files**

- new label catalog module
- `src/state.mjs`
- `src/install-legacy.mjs`
- `src/pr-review-store.mjs`
- snapshot/status tests

**Acceptance**

- Every runtime and installation module imports the same catalog or compatibility accessor.
- Existing review label names remain stable.
- Migration planning can distinguish dependency waiting, invalid issue content, coding failure, and human review without inventing a blocked label.

---

## PR 04 — Version the existing issue-template and validation contract

**Branch:** `ai/issue-template-contract-v2`

**Depends on:** PR 02, PR 03

**Purpose**

Update the existing package template instead of creating another format.

**Changes**

- Change template frontmatter from `agent-ready` to `paseo:ready`.
- Keep the existing sections and clarify which are required to contain meaningful content.
- Add a stable hidden template/version marker that the validator can recognize without relying only on visible prose.
- Keep native `blocked by` guidance and state that hierarchy/body references are not execution dependencies.
- Make validation return structured missing/invalid fields suitable for UI and issue comments.
- Preserve read compatibility for issues created with the old template during migration.

**Likely files**

- `templates/automated-coding-task.md`
- `src/automation.mjs` or a new issue-contract module
- installation snapshot tests
- issue validation tests

**Acceptance**

- A fully completed installed template validates.
- Empty checkboxes/comments/placeholders do not count as meaningful content.
- Old valid issues are not rejected solely because they predate the version marker during the compatibility period.
- Parser errors never execute issue-body content.

---

## PR 05 — Add resumable wizard progress state and API contracts

**Branch:** `ai/setup-wizard-state`

**Depends on:** PR 02

**Purpose**

Create a machine-local setup session that can start before a repository exists and resume after interruption.

**State requirements**

- One active setup session per walkthrough run.
- Store page completion, non-secret selections, last check summaries, selected repository identity, selected base branch, and managed checkout choice.
- Never store Paseo password, GitHub token, ChatGPT cookies, or raw credential material.
- Separate machine-level selections from repository-level configuration.
- Invalidate only selections affected by a failed recheck.
- Support cancel, resume, restart, and completed-session retention for diagnostics.

**API requirements**

- Read current session.
- Start/restart session.
- Save one page's selections.
- Recheck one page.
- Move forward/back only when page requirements permit.
- Return typed blockers rather than free-form-only errors.

**Likely files**

- `src/setup-wizard/store.mjs`
- `src/setup-wizard/schema.mjs`
- `src/setup-wizard/api.mjs`
- manager API routing
- state/API tests

**Acceptance**

- A restart resumes the last valid page without secrets.
- Corrupt setup state fails closed and can be reset without touching repository state.
- Repository A's setup session cannot leak into repository B.

---

## PR 06 — Add a Paseo connection context with host selection and redaction

**Branch:** `ai/paseo-connection-context`

**Depends on:** PR 01

**Purpose**

Replace direct ad hoc `paseo` invocations in setup discovery with a reusable connection context.

**Changes**

- Model daemon host/address separately from authentication.
- Try the saved host, standard local host, localhost equivalents, and supported container host candidates.
- Permit a manual host only after automatic discovery fails.
- Add version/capability compatibility results.
- Make every Paseo setup command receive the same host and isolated environment.
- Pass the password only through the supported process environment contract.
- Redact password values, password-bearing query strings, and authorization data from command results and errors.
- Keep compatibility probes for older Paseo releases where safe.

**Likely files**

- `src/setup-wizard/paseo-connection.mjs`
- `src/setup-discovery.mjs`
- `src/setup-requirements.mjs`
- process/redaction helpers
- fake-runner tests

**Acceptance**

- A host and password reach all Paseo checks consistently.
- No serialized result contains the password.
- Incorrect password does not clear the host.
- CLI and daemon versions are reported separately.
- No real daemon is required by default tests.

---

## PR 07 — Add secure Paseo credential storage with session fallback

**Branch:** `ai/paseo-secure-credentials`

**Depends on:** PR 05, PR 06

**Purpose**

Implement the approved **Remember this connection securely** behavior.

**Changes**

- Define a credential-store interface keyed by a non-secret daemon identity.
- Implement supported operating-system secure-store adapters after detecting available facilities.
- Add memory/session-only fallback when no secure backend is available.
- Store only the password in the secure backend; store the host in ordinary setup state.
- Add read, replace, forget, and availability/status operations.
- Apply restrictive permissions to any non-secret metadata.
- Never write a plaintext fallback file.

**Acceptance**

- Persistent mode is offered only when a secure backend passes a write/read/delete probe.
- Session fallback works and clearly reports that it will not survive restart.
- Logs and API responses expose backend status but not credential values.
- Tests use fake credential backends, not the developer's real keychain.

**Stop condition**

- If a target platform lacks a reliable secure backend that can be implemented without storing plaintext, keep that platform session-only and document it rather than weakening the rule.

---

## PR 08 — Add GitHub CLI authentication and account management service

**Branch:** `ai/github-account-setup`

**Depends on:** PR 01

**Purpose**

Move GitHub CLI checks out of repository-local setup requirements and support account workflows before a repository is selected.

**Changes**

- Detect `gh` and report version/path.
- Produce platform-aware installation guidance metadata.
- Read authenticated hosts/accounts and active account.
- Launch the browser login flow.
- Support switch account, add account, reauthenticate, and logout actions.
- Run and verify Git credential-helper setup.
- Return account identity without tokens.

**Acceptance**

- Works outside a Git repository.
- Failed/cancelled login preserves prior setup progress.
- Switching accounts invalidates only repository selections no longer accessible.
- Tests inject command runners and cover multiple authenticated accounts.

---

## PR 09 — Add GitHub repository, branch, and permission catalog

**Branch:** `ai/github-repository-catalog`

**Depends on:** PR 08

**Purpose**

Provide the server-side data needed for the repository selection page.

**Changes**

- List all repositories available through the active GitHub CLI account, with pagination.
- Include owner, visibility, archive state, default branch, update time when available, and effective permission.
- Determine whether the repository can support read, clone/fetch, branch push, PR creation, issue read/update, and label management.
- Return disabled repositories with exact reasons instead of hiding them.
- Load searchable branches after repository selection.
- Select the default branch as recommended.
- Detect organization/SSO authorization gaps and return targeted troubleshooting only when relevant.

**Acceptance**

- Owned, collaborator, and organization repositories are handled.
- Archived, empty, read-only, or insufficiently authorized repositories cannot be selected.
- Protected base branches remain selectable because work arrives through PRs.
- No repository mutation occurs.

---

## PR 10 — Add manager-controlled repository checkout discovery and cloning

**Branch:** `ai/managed-repository-checkouts`

**Depends on:** PR 09

**Purpose**

Create the automatic local clone behavior approved for the workspace step.

**Changes**

- Add a platform-appropriate manager-controlled repository root.
- Search only registered roots, Paseo-known workspaces, and the manager-controlled root.
- Normalize HTTPS/SSH GitHub remotes for identity matching.
- Validate candidate writability, remote, fetch access, selected base branch, and clean/safe use.
- Auto-select exactly one valid candidate.
- Return a choice when multiple valid clones exist.
- Ignore dirty/unsafe user clones without resetting them.
- Clone automatically when no candidate is safe.
- Register the selected checkout in the repository registry.

**Acceptance**

- No whole-disk scan.
- No user worktree reset, clean, checkout, or deletion.
- Interrupted clone is recoverable and cannot be mistaken for a valid checkout.
- Multiple clone choices include path and safety information.
- Temp-repository tests cover HTTPS/SSH normalization and dirty clone protection.

---

## PR 11 — Add Paseo workspace registration and safe worktree readiness probe

**Branch:** `ai/paseo-workspace-readiness`

**Depends on:** PR 06, PR 10

**Purpose**

Turn a selected local checkout into a verified Paseo automation workspace.

**Changes**

- Find a matching existing Paseo workspace by normalized repository path/remote.
- Create/register the permanent automation workspace when missing.
- Verify the workspace identity and selected base branch.
- Create and remove a temporary isolated worktree through Paseo or the supported Git/Paseo contract.
- Record no paid model action.
- Preserve any failed probe workspace when cleanup safety cannot be proven.

**Acceptance**

- Exactly one matching workspace is reused.
- Ambiguous/mismatched workspaces require user action.
- Probe cleanup is verified and leaves no branch/worktree when successful.
- A failed cleanup becomes a visible blocker rather than being hidden.

---

## PR 12 — Add the standalone manager setup-wizard shell

**Branch:** `ai/setup-wizard-shell`

**Depends on:** PR 05 and merged/rebased PR #60

**Purpose**

Add explicit setup routes and a progressive multi-page shell to the standalone manager.

**Changes**

- Add `/setup` and setup API routes to the manager server.
- Add page navigation, progress, Back/Continue, page-level Recheck, technical-details disclosure, and responsive styling.
- Render pages from explicit wizard state, not by transforming legacy dashboard controls.
- Redirect a first-run manager with no configured repository to the walkthrough.
- Keep the existing manager dashboard available for configured repositories.
- Support rerunning setup to add another repository.

**Acceptance**

- Direct reload of any permitted page resumes correctly.
- Browser history/back does not corrupt server state.
- Completed selections remain visible and editable.
- One failed page does not clear unrelated pages.
- Legacy embedded UI remains functional and unchanged.

---

## PR 13 — Build Page 1: Connect and Verify Paseo

**Branch:** `ai/setup-page-paseo`

**Depends on:** PR 07, PR 12

**Purpose**

Implement the approved one-page daemon, password, compatibility, and CLI flow.

**UI behavior**

- Automatic daemon discovery first.
- Manual host field only after failure.
- Password section only when required.
- Show-password control.
- Secure remember checkbox enabled when persistent secure storage exists.
- Session-only notice otherwise.
- Daemon/auth/version and CLI checks shown as a progressive checklist.
- Open Paseo, Copy instructions, Check again, and page Recheck controls.
- Continue only after all required checks pass.

**Acceptance**

- Host survives incorrect password.
- CLI recheck does not discard daemon authentication.
- Technical details never contain the password.
- Recheck reruns the approved set and preserves valid inputs.

---

## PR 14 — Build Page 2: Provider/Coding Harness and models

**Branch:** `ai/setup-page-harness`

**Depends on:** PR 06, PR 12

**Purpose**

Move existing provider/model discovery into the explicit wizard.

**UI behavior**

- Show only detected, available, ready Provider/Coding Harnesses.
- One harness applies to coding and review.
- Select coding model/thinking and review model/thinking independently.
- Preserve valid selections after Recheck.
- Show `Thinking level: None` when no option exists.
- Implement the exact no-model warning and required acknowledgment.
- Show the approved quick-versus-full review explanation.
- Do not send a model request.

**Acceptance**

- Changing harness clears only incompatible selections.
- A legitimate no-model harness can continue after acknowledgment.
- An unavailable harness cannot remain silently selected.
- Catalog timeouts show actionable errors without freezing the page.

---

## PR 15 — Build Page 3: GitHub account, repository, and base branch

**Branch:** `ai/setup-page-github`

**Depends on:** PR 09, PR 12

**Purpose**

Implement GitHub CLI setup and remote repository selection in one progressive page.

**UI behavior**

- GitHub CLI detection/install guidance.
- Browser sign-in and completion recheck.
- Active account/host row.
- Refresh repositories.
- Change account menu: switch, add, reauthenticate, logout.
- Searchable/paginated repository list with disabled reasons.
- Searchable branch selector with default recommended.
- Targeted SSO troubleshooting.
- General Recheck plus focused repository refresh.

**Acceptance**

- Account change preserves the selected repository only when still accessible.
- The selected branch is verified immediately before Continue.
- The page never displays a token.
- The target branch explanation matches future issue PR behavior.

---

## PR 16 — Build the automatic local checkout and workspace step

**Branch:** `ai/setup-page-workspace`

**Depends on:** PR 11, PR 12, PR 15

**Purpose**

Expose the automatic checkout/workspace process only when user action is needed.

**UI behavior**

- Normally show a compact progress/status row.
- Auto-select one valid clone.
- Ask the user only when multiple valid clones exist.
- Offer managed clone creation when no safe clone exists.
- Hide the default managed root unless advanced options or an error requires it.
- Show worktree probe result and cleanup status.

**Acceptance**

- Dirty user clones are identified but never altered.
- Continue requires a registered checkout and verified Paseo workspace.
- Failed clone/workspace operations are resumable.

---

## PR 17 — Build Issues Setup page and installation preview

**Branch:** `ai/setup-page-issues`

**Depends on:** PR 03, PR 04, PR 12

**Purpose**

Capture issue-selection settings and explain the managed resources that setup will install.

**UI behavior**

- Default `Recommended labels` versus `All open issues`.
- Expandable label catalog and meanings.
- Explain lowest-number-first processing with native blockers skipped temporarily.
- Explain that parent/sub-issue hierarchy does not create dependencies.
- Explain the existing automation issue template and planning-AI requirement.
- Show Advanced options during setup:
  - maximum simultaneous issues, default 1, max 20;
  - temporary retries, default 3;
  - excluded labels, default none.
- Preview missing/reused labels and template setup-PR change.

**Acceptance**

- Page saves no live labels or files yet.
- The preview distinguishes direct GitHub label creation from setup-PR file changes.
- Existing custom label colors/descriptions are not represented as automatically overwritten.

---

## PR 18 — Implement issue eligibility modes and lowest-number-first queueing

**Branch:** `ai/issue-eligibility-queue`

**Depends on:** PR 02, PR 03, PR 04

**Purpose**

Update runtime issue selection independently from the setup UI.

**Changes**

- Support `recommended-labels` and `all-open` candidate sources.
- Exclude pull requests and closed issues.
- Apply excluded-label filters.
- Validate the issue contract before launch.
- Evaluate native dependencies before launch.
- Sort eligible candidates strictly by issue number ascending.
- If the lowest candidate is blocked, continue to the next candidate.
- Do not create or apply a blocked lifecycle label.
- Preserve dependency wait details in local run/status state.
- Prevent duplicate claim of the same issue.

**Acceptance**

- A blocked #101 does not prevent eligible #102.
- When #101 becomes unblocked it is the next lowest candidate.
- Parent/sub-issue data does not affect eligibility.
- All-open mode still rejects invalid issues.
- Existing fix-job priority remains ahead of new issue claims.

---

## PR 19 — Add invalid-issue feedback and temporary-failure retry policy

**Branch:** `ai/issue-attention-retries`

**Depends on:** PR 18

**Purpose**

Implement the user-facing handling approved for invalid issues and retryable failures.

**Invalid issue behavior**

- Add `paseo:needs-attention`.
- Remove `paseo:ready` in recommended-label mode.
- Add or update one deduplicated issue comment listing missing/invalid sections.
- Recheck automatically after issue updates.
- Restore eligibility when valid, without deleting history.

**Temporary failure behavior**

- Add a typed failure classifier.
- Retry only transient provider, network, process, or GitHub availability failures.
- Default maximum 3 from configuration.
- Never retry permissions, invalid issue content, unsafe ambiguity, deterministic validation failure, or repeated merge conflicts as transient.
- On exhaustion, apply `paseo:failed` plus `paseo:needs-attention` and preserve diagnostics.

**Acceptance**

- Retries happen across normal scheduler turns, not in a tight loop.
- A corrected invalid issue can become ready without manual state deletion.
- Comments are deduplicated and do not spam on every poll.

---

## PR 20 — Add explicit PR-review workflow configuration and prompt library

**Branch:** `ai/review-workflow-config`

**Depends on:** PR 02

**Purpose**

Define the configuration and prompts before changing runtime review behavior.

**Changes**

- Add quick-review and full-review prompt templates as versioned defaults.
- Quick prompt checks issue compliance, acceptance criteria, required validation, obvious mistakes, and unrelated changes without claiming a broad architecture review.
- Full prompt includes changed files, surrounding code, regressions, affected routes/services/schemas/workflows, security/privacy, compatibility, migration safety, test sufficiency, and scope.
- Add machine-readable result fields sufficient for pass/changes/stale and concrete findings.
- Keep prompt previews copyable but not editable in initial setup.
- Add independent round settings, default 3, max 20.

**Acceptance**

- Quick and full prompts cannot be confused by the runtime.
- Every result is tied to repository, PR, issue, SHA, stage, round, and prompt version.
- Prompt tests verify required placeholders and injection-resistant framing.

---

## PR 21 — Implement quick and full Provider/Coding Harness review stages

**Branch:** `ai/harness-review-stages`

**Depends on:** PR 20

**Purpose**

Refactor the existing fresh Reviewer loop into explicit stage behavior without replacing the underlying Paseo reviewer mechanism.

**Changes**

- Add stage-aware review events and round accounting.
- `full-immediate` runs the full prompt and stops with attention after its full-round limit.
- Quick workflows run the quick prompt up to their quick-round limit.
- A quick pass advances immediately.
- Quick-round exhaustion preserves unresolved findings and advances to the configured manual or Web ChatGPT full review.
- Do not apply needs-attention solely because quick review exhausted.
- Every repair invalidates prior validation and review approval.
- Preserve exact-SHA checks and current base-branch freshness checks.

**Acceptance**

- Initial review counts as round 1.
- Limits accept 20.
- Quick findings are included in the handoff but are not treated as automatically correct by the full reviewer.
- Immediate full-review exhaustion leaves the PR open with changes-requested and needs-attention.

---

## PR 22 — Implement manual-review handoff and resume behavior

**Branch:** `ai/manual-review-lifecycle`

**Depends on:** PR 21

**Purpose**

Make `Quick review → Manual review` a complete runtime workflow.

**Changes**

- Mark the draft PR ready for review after quick review completes or exhausts.
- Post a handoff summary with validation and unresolved quick findings.
- Wait for GitHub review state or manual merge.
- `CHANGES_REQUESTED` queues fixes on the same PR branch.
- After fixes and validation, return to manual review.
- `APPROVED` marks manual review complete but does not merge automatically.
- Manual merge completes the issue even without a formal approval.
- Add auditable fallback dashboard actions: Send back for changes and Mark manual review complete.

**Acceptance**

- Automatic merge is not offered in manual mode.
- A closed, unmerged PR does not complete the issue.
- Review events for stale SHAs do not advance state.
- Human actions are recorded with actor/time/source when available.

---

## PR 23 — Build conditional ChatGPT Profile setup and readiness

**Branch:** `ai/chatgpt-profile-setup`

**Depends on:** PR 12, PR 20

**Purpose**

Reuse the existing browser backend while implementing the approved user-facing ChatGPT Profile flow.

**Changes**

- Rename user-facing dedicated-browser/profile wording to **ChatGPT Profile**.
- Check Playwright, Chromium, profile availability, and profile lease.
- Install Chromium through the existing verified operation.
- Open ChatGPT Profile for manual login.
- Mark ready only after an authenticated ChatGPT session is detected inside the profile.
- Create or choose a dedicated PR review chat.
- Store the stable conversation URL, not only a title.
- Verify the selected chat opens and contains a usable composer.
- Verify intended GitHub repository access using the review protocol's safe capability check.
- Reopen/close the profile to prove session persistence.

**Acceptance**

- Profile directory existence alone never means ready.
- An expired session changes status to Sign-in required and pauses new Web ChatGPT submissions without failing active PRs.
- No ChatGPT password is requested or stored.
- The normal UI never calls it a Chromium profile; technical details may explain implementation.

---

## PR 24 — Integrate Web ChatGPT as the full review after quick review

**Branch:** `ai/web-chatgpt-full-review`

**Depends on:** PR 21, PR 23

**Purpose**

Connect the existing serial browser-review scheduler to the new review workflow and limits.

**Changes**

- Queue Web ChatGPT only after quick review passes or exhausts.
- Include quick-review history/findings as untrusted supporting context to be independently verified.
- Use the versioned full-review prompt.
- Enforce full-review rounds default 3, max 20.
- Return changes to the existing fix-job/coding pool and same PR.
- Revalidate exact SHA after every fix.
- On full-round exhaustion, apply changes-requested and needs-attention and stop automatic fixes.
- Pause cleanly when ChatGPT Profile authentication expires.

**Acceptance**

- Browser submission remains machine-global serial across repositories.
- Quick-review rounds do not consume Web ChatGPT full-review rounds.
- A stale Web ChatGPT result is ignored and rescheduled for the current head.
- No result is accepted without the structured request identity.

---

## PR 25 — Add setup-PR target confirmation and automatic merge

**Branch:** `ai/setup-pr-auto-merge`

**Depends on:** PR 09, PR 10, PR 17

**Purpose**

Upgrade the existing reviewed setup-PR flow to the approved walkthrough behavior.

**Changes**

- Add an explicit confirmation payload with repository, selected base branch, setup branch, files, and auto-merge choice.
- Require confirmation that the setup PR targets the same branch future issue PRs target.
- Keep setup changes on a separate setup branch.
- Create/reuse labels directly through GitHub after final confirmation.
- Install/update the existing template through the setup PR.
- Enable GitHub auto-merge by default when supported.
- Never bypass checks, reviews, protections, or rulesets.
- If auto-merge cannot be enabled, leave the PR open, show the reason/action, and keep setup blocked.
- Continue existing merge reconciliation and local fast-forward verification.

**Acceptance**

- A setup PR never targets an unconfirmed branch.
- No unrelated file can enter the setup commit.
- Existing custom labels are reused without silent rewriting.
- Claims remain paused until merge, local synchronization, and installed-content verification all succeed.

---

## PR 26 — Add normal coding-PR auto-merge and merged issue completion

**Branch:** `ai/approved-pr-auto-merge`

**Depends on:** PR 21, PR 22, PR 24

**Purpose**

Implement the optional normal-PR merge behavior separately from setup-PR auto-merge.

**Changes**

- Offer auto-merge only for `full-immediate` and `quick-web-chatgpt` workflows.
- Keep it disabled by default.
- Require full approval of the exact current head, passing required checks, current base target, no unresolved findings, and recognized Paseo ownership.
- Prefer GitHub auto-merge; never bypass repository policy.
- Quick review alone cannot authorize merge.
- Manual mode never enables automatic merge.
- Ensure coding PR bodies include `Closes #<issue>`.
- After merge, verify the merge commit is present on the configured base branch before completing local state.
- A closed but unmerged PR remains incomplete/needs attention.

**Acceptance**

- A new commit invalidates approval and cancels pending merge eligibility.
- Merging closes only the explicitly linked issue.
- Issue completion reconciles correctly when GitHub closes the issue before the next poll.

---

## PR 27 — Build final summary, safe readiness checks, Finish setup, and optional start

**Branch:** `ai/setup-final-readiness`

**Depends on:** PR 13 through PR 26

**Purpose**

Complete the walkthrough and enable automation only after every selected workflow is ready.

**Summary**

Show all approved selections with links back to their pages.

**Safe checks**

- Paseo daemon/auth/CLI/version.
- Harness/models/thinking.
- GitHub CLI/auth/Git credential helper.
- Repository permissions/base branch.
- Managed checkout and synchronized remote.
- Paseo workspace and temporary worktree lifecycle.
- Labels and installed template.
- Issue query, validation, native dependency reading, exclusions, and queue order.
- Review workflow readiness.
- ChatGPT Profile/chat/GitHub access when selected.
- Setup PR merged and synchronized.

**Finish behavior**

```text
☑ Start automation after setup

[ Finish setup ]
```

- Default checked when at least one eligible issue exists.
- Default unchecked when none is eligible.
- Checked enables claims and starts the required repository workers after setup finishes.
- Unchecked saves a complete setup and leaves automation paused.
- If checked with no current eligible issue, workers wait for a future eligible issue.

**Acceptance**

- Readiness creates no fake issue, fake review, application-code change, or paid prompt.
- Any temporary branch/worktree probe is removed and verified.
- Finish is idempotent and recoverable after interruption.
- Starting workers occurs only after setup state is committed successfully.

---

## PR 28 — Migrate existing installations, labels, templates, and review state

**Branch:** `ai/setup-existing-install-migration`

**Depends on:** PR 03, PR 04, PR 18 through PR 27

**Purpose**

Provide a reviewed, fail-closed migration for repositories already managed by the current system.

**Migration scope**

- Config v2 to v3.
- Legacy issue labels and local run statuses to new lifecycle meaning.
- Existing Web ChatGPT review labels remain in place.
- Existing template ownership updated to the new expected hash only through a setup PR.
- Existing active coding attempts, open PRs, review jobs, fix jobs, skipped issues, and history preserved.
- Dependency-waiting issues move out of the invented blocked-label model while retaining local waiting state.
- Existing `human-review` issues map to the manual-review stage.
- Existing `agent-failed` maps to failed/needs-attention without losing reason.
- Existing `agent-ready` issues migrate to `paseo:ready` only when they pass the template contract.

**Safety**

- Stop coding and review workers during migration.
- Pause claims until reconciliation completes.
- Preview every label/file/state change.
- Never delete user-owned labels automatically.
- Never rewrite active PR heads or branches.
- Provide rollback guidance for machine-local state and a clear stop if ambiguous states are found.

**Acceptance**

- Fixtures model fresh install, current external install, current embedded install, pending setup PR, active coding issue, manual-review issue, and Web ChatGPT review queue.
- No active work is silently restarted or duplicated.

---

## PR 29 — Add end-to-end walkthrough tests, release hardening, and legacy setup cleanup

**Branch:** `ai/setup-walkthrough-hardening`

**Depends on:** All prior PRs

**Purpose**

Validate the integrated walkthrough and remove only the setup entry points that are now truly superseded.

**Tests**

- First run from outside a Git repository.
- Paseo auto-detect, password required, session fallback, and recheck.
- Harness with models, thinking levels, and no-model fallback.
- GitHub login/account change/repository pagination/branch selection.
- Existing clone, multiple clones, dirty clone, and managed clone.
- Workspace reuse/create/probe cleanup.
- Recommended-label and all-open issue modes.
- Blocked-lowest issue skipped for next issue.
- Invalid issue correction.
- Temporary retry exhaustion.
- Quick→manual, quick→Web ChatGPT, and immediate full review.
- Round limits at 3 and 20.
- ChatGPT Profile sign-in expiry/recovery.
- Setup PR auto-merge available/unavailable.
- Normal PR auto-merge enabled/disabled.
- Finish with automation checked/unchecked.
- Existing-install migration.
- Windows command and path behavior.
- Packed global installation.

**Cleanup**

- Keep the legacy embedded dashboard operational for compatibility.
- Remove or hide only obsolete standalone-manager setup controls that would compete with the wizard.
- Point maintenance/repair actions to the post-setup manager UI.
- Update README, standalone-manager guide, setup guide, security guidance, changelog, and CLI help.
- Document how to rerun setup for another repository.

**Release gate**

- Exact-head CI on Node 20, 22, and 24.
- Recursive syntax checks.
- Full tests.
- Package dry run.
- Windows command-shim regression.
- Clean packed-install smoke test.
- No live ChatGPT/model use in default CI.
- Optional live integration suite documented separately and disabled by default.

---

# Parallel work opportunities

The stack is ordered for safety, but some PRs can be prepared in parallel after their dependencies merge:

- PR 03, PR 04, PR 06, and PR 08 after PR 02/PR 01 as noted.
- PR 07 and PR 09 after their respective adapters.
- PR 13, PR 14, and PR 15 after the shell and backend dependencies.
- PR 18/19 can proceed independently of most page styling once schemas/contracts merge.
- PR 20/21/22 can proceed independently of checkout UI.
- PR 23 can reuse existing browser services while PR 21 is underway.

Do not stack more than two unmerged implementation PRs on the same modules. Rebase onto `main` after each predecessor merges so review comments and CI reflect the actual integration baseline.

# Planned checkpoints and questions

The product decisions are complete enough to begin. The implementation agent should ask the user only when repository inspection reveals a material choice not already approved.

Expected checkpoints:

1. **After PR 04:** Report the final template required-field rules and any compatibility concern found in real existing issues.
2. **After PR 07:** Report which secure credential backends are reliably supported on Windows, macOS, and Linux; ask only if a platform would otherwise require weakening the no-plaintext rule.
3. **After PR 12:** Show the first integrated wizard shell and navigation behavior before filling every page.
4. **After PR 20:** Show the exact quick-review and full-review default prompts before runtime activation.
5. **Before PR 28:** Present the migration preview for current installations and ask if any ambiguous legacy state cannot be mapped safely.
6. **Before PR 29 merge:** Summarize the complete walkthrough, known platform limitations, and live-integration tests not run by default.

Questions that should **not** be asked again:

- label names;
- issue processing order;
- dependency hierarchy rules;
- review defaults/maxima;
- issue concurrency/retry defaults;
- setup PR target/auto-merge behavior;
- ChatGPT Profile naming/readiness;
- final Start automation checkbox behavior;
- normal PR auto-merge default;
- manual review merge behavior.

# First implementation action

After PR #61 merges, begin with PR 01 and PR 02. Do not start by editing the current legacy setup page. The schema and module boundaries must land first so later page and runtime PRs do not create temporary incompatible state formats.