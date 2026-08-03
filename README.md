# Paseo Issue Automation

A repository-independent npm package that turns automation-ready GitHub issues into isolated Paseo coding work and draft pull requests.

## Architecture

Planning happens before runtime. A strong planning model creates the GitHub issues, acceptance criteria, validation requirements, and native GitHub `blocked by` relationships.

The package runtime is a deterministic **Issue Execution Controller**. It does not launch an Orchestrator AI. It:

- reads only native GitHub issue dependencies and refuses to infer dependencies from issue-body text
- validates dependency cycles and keeps unresolved issues blocked
- requires coding dependencies to have a merged PR targeting the configured base branch whose merge commit is present in that branch
- automatically rechecks dependency-blocked issues and restores `agent-ready` when every blocker is satisfied
- enforces the configured parallel issue limit
- launches one Coder in an isolated Paseo worktree
- waits for issue-defined validation on an exact commit and draft PR head
- launches a fresh independent Reviewer session in the same workspace
- posts every Reviewer verdict and finding to the draft PR with the exact reviewed commit and review round
- returns Reviewer and CI findings to the same Coder
- requires the issue branch to contain the latest base branch, using merge-based updates rather than rebase or force-push
- stops at `human-review`; it never merges or auto-merges

## Local control center

The package serves a local, responsive Issue Execution Controller control center. The browser UI is framework-free and is composed directly from explicit layout, style, behavior, and status-model modules rather than HTML string-patching layers.

The control center has six views:

- **Overview** — controller health, capacity, next poll, latest dispatch result, human-review inbox, active execution, dependency queue, and recent activity
- **Issues** — filterable execution board for ready, running, blocked, failed, and human-review issues
- **Dependencies** — calculated execution waves, dependency API health, cycles, unresolved graph nodes, and a blocked-by/blocking map
- **Activity** — consolidated controller, Coder, Reviewer, validation, CI, and lifecycle history with copy/download controls
- **Settings** — requirements, Coder and Reviewer models, base branch, polling/concurrency/review limits, installation preview, repairs, and self-test
- **Maintenance** — package-owned state, lifecycle-label cleanup, workspace removal, and guided uninstall separated from everyday operations

Each issue can be opened in a detail dialog showing its dependencies, branch, workspace, exact validated commit, exact reviewed commit, Reviewer findings, PR metadata, CI checks, base freshness, block/failure reason, and attempt timeline.

Destructive actions use explicit dialogs, and higher-risk cleanup requires typed confirmation. Setup and maintenance remain reversible and limited to package-owned components.

## Guided setup

The control center previews and manages the issue template, `paseo.json` service, GitHub labels, permanent **Issue Coding Automation** workspace, Coder and Reviewer model configuration, self-test, repairs, and guided uninstall.

The package does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

Existing configuration files that contain an Orchestrator model remain readable for migration compatibility, but the Issue Execution Controller never launches that model.

## Operating controls

The control center supports both automatic polling and direct issue control:

- pause or resume new claims without stopping already-running agents
- run dispatch immediately or manually reconcile native dependencies
- start a specific eligible `agent-ready` issue
- skip or unskip an issue for automatic claiming
- open a running issue's Paseo workspace
- abandon an interrupted attempt without trying to recover it
- restart as a completely fresh attempt
- keep an old branch and use `-attempt-N`, or explicitly delete the package-recorded branch after safety checks
- inspect or export the activity history

Coder and Reviewer may use the same model. Reviewer independence means a fresh session with no shared Coder chat history or working context.

Each Reviewer round creates a top-level draft-PR audit comment containing the issue number, PR number, exact commit SHA, review round, verdict, and findings. Both approvals and requested changes remain visible on the PR. Failure to write the audit comment stops that controller round.

## Dependency source of truth

Use GitHub's native issue relationships for execution constraints. For example:

```bash
gh issue edit 301 --add-blocked-by 300
gh issue create --title "Integration" --blocked-by 301,302
```

Sub-issues describe hierarchy. Native `blocked by` relationships describe execution order. The relationship remains recorded after it is satisfied; the controller changes operational readiness rather than deleting history.

The installed GitHub CLI must expose native `blockedBy` relationship data. If that structured data is unavailable, the controller blocks execution rather than reading dependency-like lines from the issue body.

## Interruption policy

Interrupted work is not silently recovered. The user abandons the attempt and starts a fresh one. Old branches are never deleted automatically.

## Development installation

```bash
npm install --save-dev github:yajinni/Paseo-Issue-Automation
npx paseo-issue-automation setup
```

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
```

## Release preparation

CI tests Node 20, 22, and 24, runs syntax checks, validates the npm package contents, installs the produced `.tgz` archive in a clean project, and invokes the packaged CLI. Tagged `v*` releases can publish through the included npm-provenance workflow after `NPM_TOKEN` is configured.

See [Design decisions](docs/DESIGN_DECISIONS.md), [Automation protocol](docs/AUTOMATION_PROTOCOL.md), and [Publishing](docs/PUBLISHING.md).
