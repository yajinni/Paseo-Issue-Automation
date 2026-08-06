# Paseo Issue Automation

A repository-independent controller that turns automation-ready GitHub issues into isolated Paseo coding work, persistent serial ChatGPT review, and managed pull-request follow-up.

## Recommended architecture

Run one **standalone manager** for the machine and register every repository it should control. Each repository retains isolated configuration, issue state, run history, PR-review state, and ownership records. The manager provides:

- independent coding and PR-review workers for each registered repository;
- a manager-wide coding limit and fair round-robin scheduling;
- one machine-global serial ChatGPT browser lease;
- external repository installation without a project dependency, lockfile entry, repository `node_modules`, or `paseo.json` service;
- a reviewed migration path for older embedded installations;
- repository-specific blockers that name the exact repository, PR, files, error, and recovery action;
- ownership-safe repair and reviewed removal.

See [Standalone multi-repository manager](docs/STANDALONE_MANAGER.md).

## Issue execution architecture

Planning happens before runtime. A strong planning model creates the GitHub issues, acceptance criteria, validation requirements, and native GitHub `blocked by` relationships.

The package runtime is a deterministic **Issue Execution Controller**. It does not launch an Orchestrator AI. It:

- reads only native GitHub issue dependencies and refuses to infer dependencies from issue-body text;
- validates dependency cycles and keeps unresolved issues blocked;
- requires coding dependencies to have a merged PR targeting the configured base branch whose merge commit is present in that branch;
- automatically rechecks dependency-blocked issues and restores `agent-ready` when every blocker is satisfied;
- enforces repository and manager-wide parallel coding limits;
- launches Coders in isolated Paseo worktrees;
- waits for issue-defined validation on an exact commit and draft PR head;
- releases the coding slot as soon as a validated PR enters the separate review queue;
- returns requested PR fixes to the normal coding pool without creating a replacement PR;
- requires merge-based base updates rather than rebase or force-push.

## Several builders, one inspector

Paseo has two independent scheduling systems:

- The **parallel coding scheduler** runs new issue work and requested-fix jobs up to the configured coding limit.
- The **serial PR-review scheduler** submits exactly one managed PR at a time through a dedicated Playwright-controlled ChatGPT profile.

Open PRs and review jobs do not consume coding slots. A PR receiving fixes uses one coding slot, while the inspector may review a different PR.

Review queue state, fix jobs, exact SHAs, prompt versions, queue ordering, retries, and transition history survive shutdowns and crashes in the package's atomic local state store. GitHub polling reconciles only Paseo-managed PRs; webhooks and public inbound endpoints are not required.

See [Persistent serial ChatGPT PR review automation](docs/PR_REVIEW_AUTOMATION.md).

## Install the standalone manager

Install an explicitly reviewed immutable commit at machine scope:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

Verify the CLI, register a repository, and start the manager:

```bash
paseo-issue-automation help
paseo-issue-automation repo add /path/to/repository
paseo-issue-automation manager --open
```

The standalone dashboard listens on:

```text
http://127.0.0.1:4318
```

It binds to localhost by default and does not require a public inbound endpoint.

## External repository installation

Select a registered repository in the manager and choose **Install for standalone manager**. External installation manages only:

- `.github/ISSUE_TEMPLATE/automated-coding-task.md`;
- lifecycle labels;
- the permanent Paseo automation workspace;
- machine-local controller state.

It does not add Paseo Issue Automation to `package.json`, any lockfile, repository `node_modules`, or `paseo.json`.

If repository file installation creates a setup PR, review and merge it. Setup remains paused until the local configured base branch synchronizes.

## Embedded installation migration

Older repositories may contain a project dependency and a package-managed `issue-coding-automation` service. The manager's **Create migration PR** action:

- removes the dependency with the repository's package manager;
- updates the matching lockfile;
- removes only the package-managed service from `paseo.json`;
- preserves unrelated repository content and all controller history;
- keeps claims paused while the PR is open or merged but unsynchronized;
- switches to external mode only after merge and successful local fast-forward.

Do not start migration while a setup PR is unresolved. The dashboard displays the exact blocking PR and next action.

## External repair and removal

**Repair managed components** changes only resources recorded as manager-owned. Repository file repair uses the normal setup-PR workflow.

**Create removal PR** removes only the unchanged package-created issue template through a reviewed PR. Managed labels and the managed Paseo workspace are removed only after merge and local synchronization. Modified or user-owned resources are never deleted automatically.

## Playwright browser setup

Playwright is a package dependency, but Chromium installation remains an explicit operator action:

```bash
paseo-issue-automation browser setup --repo OWNER/REPOSITORY
```

Individual commands include:

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

Paseo creates a dedicated machine-local browser profile outside the repository. The user logs in manually; Paseo never stores a ChatGPT password or automates the user's normal browser profile.

## PR review results

Paseo does not scrape ChatGPT's answer. The versioned review prompt directs ChatGPT to use connected GitHub tools and publish a structured marker plus human-readable findings on the PR. Paseo validates the review request ID, repository, PR, issue, exact SHA, and prompt version before processing the result.

Review labels are:

```text
paseo:review-queued
paseo:reviewing
paseo:changes-requested
paseo:fixing
paseo:review-failed
```

Automatic merge and issue-closure fallback are disabled by default and require explicit project settings.

## Manager controls

For the selected repository, the manager supports:

- start, stop, and restart of the coding worker;
- start, stop, and restart of the PR-review worker;
- pause or resume new coding claims without stopping already-running agents;
- run one scheduling turn immediately;
- reconcile GitHub dependencies;
- configure base branch, models, polling, limits, and review rounds;
- start, skip, unskip, restart, or abandon a specific issue;
- install, migrate, repair, remove, and reconcile repository integration;
- inspect repository-specific health and exact blockers.

The manager-wide capacity setting limits total coding and requested-fix work across all running repositories. PR reviews do not consume coding slots.

## Legacy per-repository control center

The legacy embedded server remains available for compatibility:

```bash
paseo-issue-automation start --repo OWNER/REPOSITORY
```

Its repository-local dashboard listens on `127.0.0.1:4317`. New installations should use the standalone manager instead of adding the package to every repository.

The package does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

Existing configuration files that contain an Orchestrator model remain readable for migration compatibility, but the Issue Execution Controller never launches that model.

## Dependency source of truth

Use GitHub's native issue relationships for execution constraints. For example:

```bash
gh issue edit 301 --add-blocked-by 300
gh issue create --title "Integration" --blocked-by 301,302
```

Sub-issues describe hierarchy. Native `blocked by` relationships describe execution order. The relationship remains recorded after it is satisfied; the controller changes operational readiness rather than deleting history.

The installed GitHub CLI must expose native `blockedBy` relationship data. If that structured data is unavailable, the controller blocks execution rather than reading dependency-like lines from the issue body.

## Update the standalone manager

Choose the exact newer commit you intend to adopt and update the machine installation:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<new-approved-commit-sha>
```

Restart the manager process afterward. In external mode, ordinary controller updates do not modify managed repository manifests or lockfiles.

A floating Git dependency is unsafe for an embedded automated repository because a package installation can rewrite its lockfile merely because `main` changed. Migrate embedded repositories instead of continuing floating project dependencies.

## Commands

```bash
paseo-issue-automation help
paseo-issue-automation manager --open
paseo-issue-automation repo list
paseo-issue-automation repo add /path/to/repository
paseo-issue-automation repo show OWNER/REPOSITORY
paseo-issue-automation repo remove OWNER/REPOSITORY
paseo-issue-automation status --repo OWNER/REPOSITORY
paseo-issue-automation enable --repo OWNER/REPOSITORY
paseo-issue-automation disable --repo OWNER/REPOSITORY
paseo-issue-automation start-issue --issue 123 --branch-action keep --repo OWNER/REPOSITORY
paseo-issue-automation skip-issue --issue 123 --repo OWNER/REPOSITORY
paseo-issue-automation unskip-issue --issue 123 --repo OWNER/REPOSITORY
paseo-issue-automation abandon --issue 123 --reason "Interrupted" --repo OWNER/REPOSITORY
paseo-issue-automation restart --issue 123 --branch-action keep --repo OWNER/REPOSITORY
paseo-issue-automation pr-review status --repo OWNER/REPOSITORY
paseo-issue-automation pr-review reconcile --repo OWNER/REPOSITORY
paseo-issue-automation browser doctor --repo OWNER/REPOSITORY
```

## Release validation

CI tests Node 20, 22, and 24, recursively syntax-checks package modules, validates npm package contents, installs the produced `.tgz` archive in a clean project, invokes the packaged CLI, and runs the Windows command-shim regression. Live ChatGPT access is opt-in and excluded from the default suite.

See [Standalone manager](docs/STANDALONE_MANAGER.md), [Design decisions](docs/DESIGN_DECISIONS.md), [Automation protocol](docs/AUTOMATION_PROTOCOL.md), [PR review automation](docs/PR_REVIEW_AUTOMATION.md), and [Publishing](docs/PUBLISHING.md).
