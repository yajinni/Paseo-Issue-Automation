# Paseo Issue Automation

A repository-independent npm package that turns automation-ready GitHub issues into isolated Paseo coding work, persistent serial ChatGPT review, and managed pull-request follow-up.

## Architecture

Planning happens before runtime. A strong planning model creates the GitHub issues, acceptance criteria, validation requirements, and native GitHub `blocked by` relationships.

The package runtime is a deterministic **Issue Execution Controller**. It does not launch an Orchestrator AI. It:

- reads only native GitHub issue dependencies and refuses to infer dependencies from issue-body text
- validates dependency cycles and keeps unresolved issues blocked
- requires coding dependencies to have a merged PR targeting the configured base branch whose merge commit is present in that branch
- automatically rechecks dependency-blocked issues and restores `agent-ready` when every blocker is satisfied
- enforces the configured parallel coding limit
- launches Coders in isolated Paseo worktrees
- waits for issue-defined validation on an exact commit and draft PR head
- releases the coding slot as soon as a validated PR enters the separate review queue
- returns requested PR fixes to the normal coding pool without creating a replacement PR
- requires merge-based base updates rather than rebase or force-push

## Several builders, one inspector

Paseo has two independent scheduling systems:

- The **parallel coding scheduler** runs new issue work and requested-fix jobs up to the configured coding limit.
- The **serial PR-review scheduler** submits exactly one managed PR at a time through a dedicated Playwright-controlled ChatGPT profile.

Open PRs and review jobs do not consume coding slots. A PR receiving fixes uses one coding slot, while the inspector may review a different PR.

Review queue state, fix jobs, exact SHAs, prompt versions, queue ordering, retries, and transition history survive shutdowns and crashes in the package's existing atomic local state store. GitHub polling reconciles only Paseo-managed PRs; webhooks and public inbound endpoints are not required.

See [Persistent serial ChatGPT PR review automation](docs/PR_REVIEW_AUTOMATION.md).

## Playwright browser setup

`playwright-core` is an optional dependency. Chromium is installed only through an explicit command:

```bash
npx paseo-issue-automation browser setup
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

## Local control center

The package serves a local, responsive Issue Execution Controller control center. The main dashboard covers coding operations, dependencies, activity, settings, and maintenance. A dedicated **PR Reviews** page shows:

- the active inspector and waiting queue;
- managed PR, issue, SHA, review-round, fix, and reconciliation state;
- browser, authentication, and conversation health;
- review prompt and merge/closure settings;
- queue controls, manual results, closed-unmerged recovery, and persistent history.

Open it at:

```text
http://127.0.0.1:4317/pr-reviews
```

## Guided setup

The control center previews and manages the issue template, `paseo.json` service, GitHub labels, permanent **Issue Coding Automation** workspace, Coder and Reviewer model configuration, self-test, repairs, and guided uninstall.

The package does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

Existing configuration files that contain an Orchestrator model remain readable for migration compatibility, but the Issue Execution Controller never launches that model.

## Operating controls

The control center supports both automatic polling and direct issue control:

- pause or resume new coding claims without stopping already-running agents
- pause or resume the independent PR-review queue
- run dispatch or GitHub reconciliation immediately
- start a specific eligible `agent-ready` issue
- skip or unskip an issue for automatic claiming
- open a running issue's Paseo workspace
- abandon an interrupted attempt and restart fresh
- reorder or cancel queued reviews
- retry failed browser submissions
- send requested fixes into the normal coding pool
- inspect or export activity and review history

## Dependency source of truth

Use GitHub's native issue relationships for execution constraints. For example:

```bash
gh issue edit 301 --add-blocked-by 300
gh issue create --title "Integration" --blocked-by 301,302
```

Sub-issues describe hierarchy. Native `blocked by` relationships describe execution order. The relationship remains recorded after it is satisfied; the controller changes operational readiness rather than deleting history.

The installed GitHub CLI must expose native `blockedBy` relationship data. If that structured data is unavailable, the controller blocks execution rather than reading dependency-like lines from the issue body.

## Development installation

Install an explicitly reviewed commit rather than the floating default branch:

```bash
npm install --save-dev github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
npx paseo-issue-automation setup
```

## Updating the package

Choose the exact newer commit you intend to adopt, then install that immutable revision:

```bash
npm install --save-dev github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

The resulting `package.json` and lockfile changes are setup-managed files. For an already configured repository, the controller detects those changes and opens a dedicated setup PR. Review and merge that PR in GitHub; setup continues automatically after the local base branch synchronizes.

Do not use a floating `github:yajinni/Paseo-Issue-Automation` dependency in an automated repository. A floating dependency can rewrite the lockfile merely because `main` changed.

## Commands

```bash
npx paseo-issue-automation setup
npx paseo-issue-automation start
npx paseo-issue-automation status
npx paseo-issue-automation enable
npx paseo-issue-automation disable
npx paseo-issue-automation start-issue --issue 123 --branch-action keep
npx paseo-issue-automation skip-issue --issue 123
npx paseo-issue-automation unskip-issue --issue 123
npx paseo-issue-automation abandon --issue 123 --reason "Interrupted"
npx paseo-issue-automation restart --issue 123 --branch-action keep
npx paseo-issue-automation pr-review status
npx paseo-issue-automation pr-review reconcile
npx paseo-issue-automation browser doctor
```

## Release preparation

CI tests Node 20, 22, and 24, runs syntax checks, validates the npm package contents, installs the produced `.tgz` archive in a clean project, and invokes the packaged CLI. Live ChatGPT access is opt-in and excluded from the default suite.

See [Design decisions](docs/DESIGN_DECISIONS.md), [Automation protocol](docs/AUTOMATION_PROTOCOL.md), [PR review automation](docs/PR_REVIEW_AUTOMATION.md), and [Publishing](docs/PUBLISHING.md).
