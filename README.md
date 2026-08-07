# Paseo Issue Automation

A repository-independent controller that turns automation-ready GitHub issues into isolated Paseo coding work, staged pull-request review, and managed follow-up.

## Recommended architecture

Run one **standalone manager** for the machine and let its setup walkthrough add repositories. Each repository retains isolated configuration, issue state, run history, PR-review state, and ownership records. The manager provides:

- independent coding and PR-review workers per repository;
- a manager-wide coding limit with fair scheduling;
- one machine-global serial ChatGPT Profile lease when Web ChatGPT review is selected;
- external repository installation without a project dependency, lockfile entry, repository `node_modules`, or `paseo.json` service;
- reviewed migration paths for older installations;
- repository-specific blockers and ownership-safe repair/removal.

See [Standalone setup walkthrough](docs/SETUP_WIZARD.md) and [Standalone multi-repository manager](docs/STANDALONE_MANAGER.md).

## Install and run

Install an explicitly reviewed immutable commit at machine scope:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

Then run:

```bash
paseo-issue-automation --help
paseo-issue-automation
```

The bare command starts the manager and opens `http://127.0.0.1:4318`. It can be run from outside a Git repository. On first run, when no repository has completed setup, the manager opens the setup walkthrough automatically.

The walkthrough discovers/validates Paseo, Provider/Coding Harness models, GitHub account/repository/base branch, a safe checkout, the permanent Paseo workspace, issue policy, review workflow, and final readiness. It can clone the selected repository into the manager-owned repository area when no safe checkout exists. You do not need to pre-register or pre-clone a repository for the normal first-run path.

For an already configured manager, use **Add repository via setup** to run the walkthrough for another repository. Manual `repo add` remains available as an operator/compatibility command, not the preferred onboarding path.

## Setup security model

The walkthrough is server-backed and resumable. Ordinary setup state never stores passwords, GitHub tokens, ChatGPT cookies, Authorization values, API keys, or raw credentials.

Paseo passwords use the secure credential abstraction when a supported persistent backend passes its probe, otherwise session-only memory is used. GitHub authentication is delegated to GitHub CLI. ChatGPT Profile uses a dedicated Playwright profile and manual sign-in; Paseo never asks for a ChatGPT password.

Readiness does not create fake issues/reviews, change application code, or send paid model prompts. Temporary worktree probes must be removed and verified before readiness can pass. The manager binds to localhost by default.

See [Standalone setup walkthrough](docs/SETUP_WIZARD.md) for the full security and recovery contract.

## Issue execution architecture

Planning happens before runtime. The runtime is a deterministic **Issue Execution Controller**. It:

- reads only native GitHub `blocked by` relationships for execution dependencies and refuses to infer dependencies from issue-body text;
- validates the required issue-body contract before claiming work;
- considers eligible issues strictly by issue number, lowest first;
- temporarily skips a dependency-blocked lower-number issue so the next eligible issue can run;
- automatically rechecks dependency waiting and corrected invalid issues;
- uses `paseo:ready` for the current recommended-label flow while retaining migration compatibility for legacy `agent-ready`;
- enforces repository and manager-wide parallel coding limits;
- launches coding in isolated Paseo worktrees;
- waits for issue-defined validation on an exact commit and PR head;
- returns requested PR fixes to the normal coding pool without creating a replacement PR;
- requires merge-based base updates rather than rebase or force-push.

Parent/sub-issue relationships describe hierarchy, not execution order. Dependency-like body text is never treated as an execution dependency.

## Review workflows

Setup exposes three explicit review workflows:

- **Quick → Manual** — quick review followed by human handoff; automatic merge is unavailable.
- **Quick → Web ChatGPT** — quick review followed by full Web ChatGPT review through the serial ChatGPT Profile lease.
- **Full review immediately** — starts with the full Provider/Coding Harness review.

Quick and full round limits are independent, default to 3, and may be configured up to 20. Automated review results are bound to repository, issue, PR, exact head SHA, stage, round, and prompt version. A new PR head invalidates prior review/validation approval.

Normal coding-PR automatic merge is disabled by default. When explicitly enabled for a supported workflow, Paseo requests GitHub auto-merge only after exact-head review and validation succeed. GitHub checks, reviews, protections, and rulesets remain authoritative; Paseo does not bypass them.

Review labels are:

```text
paseo:review-queued
paseo:reviewing
paseo:changes-requested
paseo:fixing
paseo:review-failed
```

See [Persistent PR review automation](docs/PR_REVIEW_AUTOMATION.md).

## External repository installation

The standalone walkthrough uses external-manager installation for new repositories. It manages only:

- `.github/ISSUE_TEMPLATE/automated-coding-task.md`;
- lifecycle labels;
- the permanent Paseo automation workspace;
- machine-local controller state.

It does not add Paseo Issue Automation to `package.json`, any lockfile, repository `node_modules`, or `paseo.json`.

Managed issue-template changes use the reviewed setup-PR flow. Setup-PR auto-merge is requested only through normal GitHub policy; if it is unavailable or blocked, setup remains paused until the PR is resolved and the selected base branch synchronizes locally.

## Existing-install migration

Repositories already managed by the old lifecycle use a preview-first, fail-closed state migration. It normalizes supported v2 configuration to v3, maps legacy issue lifecycle assignments, retains native dependency-wait state locally, preserves active coding attempts/open PRs/review jobs/fix jobs/skipped issues/history, and leaves current Web ChatGPT review state intact.

Migration stops on ambiguous legacy state, stops coding/review workers, pauses claims, never rewrites existing PR heads/branches, never deletes user-owned label definitions, and routes managed issue-template updates through a reviewed setup PR.

Older **embedded** repositories that still declare the package dependency and package-managed `issue-coding-automation` service also use the manager's reviewed controller migration PR. That flow removes only the managed dependency/service changes and switches to external mode after merge and local synchronization.

## Manager controls after setup

The normal manager UI, not an incomplete setup step, is the maintenance surface. For the selected repository it supports:

- start, stop, and restart coding/review workers;
- pause/resume new claims and run one scheduling turn;
- repository health and exact blockers;
- issue restart/skip/unskip/abandon actions;
- setup/migration/removal reconciliation;
- ownership-safe repair and reviewed removal.

The manager-wide coding limit bounds active coding/fix work across repositories. PR review does not consume coding slots.

## Legacy per-repository control center

The embedded repository-local dashboard remains available for compatibility:

```bash
paseo-issue-automation start --repo OWNER/REPOSITORY
```

It listens on `127.0.0.1:4317`. New repositories should use the standalone walkthrough rather than install the controller into every project.

## Commands

```bash
paseo-issue-automation
paseo-issue-automation --help
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

## Update the standalone manager

Install the next reviewed exact commit globally and restart the manager:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<new-approved-commit-sha>
```

Ordinary controller updates do not change managed repository manifests or lockfiles in external mode.

## Release validation

Required CI tests Node 20, 22, and 24, recursively syntax-checks package modules, runs the full deterministic suite, validates npm package contents, installs the produced archive into a clean project, invokes the packaged CLI, and runs the Windows command-shim regression.

Default CI does **not** sign in to ChatGPT or send paid model prompts. Optional real-service verification is documented separately in [Live integration tests](docs/LIVE_INTEGRATION_TESTS.md) and is disabled by default.

See [Standalone setup walkthrough](docs/SETUP_WIZARD.md), [Standalone manager](docs/STANDALONE_MANAGER.md), [Design decisions](docs/DESIGN_DECISIONS.md), [Automation protocol](docs/AUTOMATION_PROTOCOL.md), [PR review automation](docs/PR_REVIEW_AUTOMATION.md), and [Publishing](docs/PUBLISHING.md).
