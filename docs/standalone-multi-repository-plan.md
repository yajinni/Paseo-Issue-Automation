# Standalone Multi-Repository Manager Plan

## Objective

Convert Paseo Issue Automation from a controller installed as an application dependency in one repository into one standalone manager that can register, configure, install, monitor, and operate multiple repositories independently.

The manager must support frequent controller updates without modifying any managed repository's `package.json`, lockfile, or setup state. Each registered repository must retain isolated issue execution, pull-request review, setup, workspace, model, pause/resume, and activity state.

## Non-negotiable invariants

- Existing single-repository commands continue to work during migration.
- A failure or setup blocker in one repository must not disable another repository.
- Repository state remains isolated by repository identity and Git common directory.
- The standalone registry contains paths and display metadata only; secrets remain in their existing protected locations.
- Registering or selecting a repository must not mutate that repository.
- Installing repository integration remains an explicit action.
- Removing a repository from the manager must not uninstall its labels, templates, workspaces, or local state.
- Repository mutations continue through reviewed pull requests; the manager must not push directly to protected base branches.
- No package update may be mislabeled as initial setup.
- Every unavailable or paused state must expose a concrete repository-specific reason and recovery action.

## Target architecture

### Standalone manager

One installed copy owns:

- a machine-local repository registry;
- one HTTP dashboard and API;
- manager-level concurrency and health;
- one worker lifecycle per enabled repository;
- shared provider and browser resource coordination;
- controller version and update information.

### Registered repository

Each repository owns:

- GitHub issue labels and issue template;
- base branch and model configuration;
- enabled/paused state;
- Paseo workspace identity;
- issue run records and attempt history;
- PR-review configuration and queue state;
- setup and integration status;
- repository-specific activity and errors.

Existing state under `<git-common-dir>/paseo-issue-automation` remains authoritative initially. Later schema changes must be versioned and migratable.

### Machine-local registry

The registry lives outside managed repositories. Its location is resolved in this order:

1. `PASEO_ISSUE_AUTOMATION_HOME`;
2. `%LOCALAPPDATA%\Paseo Issue Automation` on Windows;
3. `$XDG_CONFIG_HOME/paseo-issue-automation`;
4. `~/.config/paseo-issue-automation`.

Each entry contains a stable ID, display name, canonical local path, remote URL, inferred `owner/repository`, and timestamps. Adding the same Git root twice is idempotent.

## PR sequence

### PR 1 — Standalone repository registry

Scope:

- Add versioned machine-local registry storage.
- Validate repository paths through `git rev-parse --show-toplevel`.
- Infer GitHub identity from the `origin` remote when possible.
- Add `repo add`, `repo list`, `repo show`, and `repo remove` commands.
- Preserve all existing commands and single-repository behavior.

Validation:

- Registry path resolution on supported platforms.
- Atomic writes and deterministic ordering.
- Stable IDs and duplicate registration behavior.
- Lookup and removal by ID, GitHub name, or path.
- Invalid repository rejection.

### PR 2 — Explicit repository context

Scope:

- Add a repository-context resolver accepting registry ID, GitHub name, or local path.
- Add a common `--repo` option for non-server commands.
- Keep current-working-directory fallback for backward compatibility.
- Remove direct `repositoryRoot()` calls from command dispatch where practical.
- Pass an explicit root into status, setup, issue, review, browser, and maintenance operations.

Success criteria:

- Commands can operate on a registered repository while launched from any directory.
- Commands without `--repo` behave exactly as before.
- An unknown or inaccessible repository returns a specific error without touching another repository.

### PR 3 — Multi-repository API and selector

Scope:

- Add manager endpoints to list, add, inspect, and remove registrations.
- Require repository identity on repository-scoped API requests.
- Add a persistent repository selector to the dashboard shell.
- Include active repository name, path, remote, base branch, and automation status on every view.
- Namespace client-side caches and polling state by repository ID.

Suggested routes:

- `GET /api/repositories`
- `POST /api/repositories`
- `GET /api/repositories/:id`
- `DELETE /api/repositories/:id`
- `GET /api/repositories/:id/status`
- repository-scoped actions beneath `/api/repositories/:id/...`

Compatibility:

- Legacy unscoped endpoints temporarily target the repository from which the server was launched and return deprecation metadata.

### PR 4 — Independent worker lifecycle

Scope:

- Replace singleton setup, dispatch, status, and review timers with repository-keyed worker maps.
- Start workers only for registered repositories that are configured and enabled.
- Add per-repository start, stop, pause, resume, and restart operations.
- Add a manager-level maximum active-agent limit in addition to each repository's `maxActive`.
- Ensure a crash, timeout, lease, or setup failure is contained to its repository.

Validation:

- Two repositories can poll independently.
- Pausing one does not pause the other.
- Duplicate workers cannot start for the same repository.
- Removing a registration stops its manager workers but does not alter repository integration.
- Shared browser and provider resources continue to obey global serialization rules.

### PR 5 — External controller installation mode

Scope:

- Stop requiring `paseo-issue-automation` in each managed repository's dependencies.
- Run the manager from its standalone installation or source checkout.
- Remove `package.json` and lockfiles from repository integration ownership.
- Replace the repository-local `npx --no-install` service with a manager registration or external launcher strategy.
- Detect and explain legacy embedded installations.

Required behavior:

- Updating the controller never modifies a managed repository.
- Ordinary manager startup never invokes a package manager in a managed repository.
- The manager displays its own source/version separately from repository integration status.

### PR 6 — Repository integration lifecycle

Scope:

- Add repository-specific install, repair, inspect, and uninstall actions.
- Install only the issue template, labels, workspace references, and strictly necessary repository configuration.
- Generate clearly named integration PRs only when tracked repository files genuinely need changes.
- Do not classify package or lockfile drift as setup.
- Preserve user-owned labels and files.

Dashboard requirements:

- Show every proposed file before creating an integration PR.
- Show the exact PR number, state, changed files, and next action.
- Distinguish initial installation, repair, migration, and optional update work.

### PR 7 — Legacy migration

Scope:

- Detect the current embedded dependency installation.
- Register the current repository automatically only after explicit confirmation or an explicit migration command.
- Preserve `.git/paseo-issue-automation` state, runs, skipped issues, setup records, and PR-review queues.
- Remove the embedded package and matching lockfile entry through a clearly named migration PR.
- Replace or remove the legacy `paseo.json` service without disrupting active work.
- Provide rollback instructions.

Safety gates:

- Refuse migration while coding agents or fix jobs are actively mutating the repository.
- Snapshot machine-local state before schema changes.
- Do not delete legacy state until the standalone manager has loaded and validated it.

### PR 8 — Repository-specific blockers and operational polish

Scope:

- Replace generic states such as `Issues Processing unavailable` with concrete reasons.
- Add a repository overview showing enabled state, setup readiness, open integration PR, dirty files, provider status, worker status, active runs, and next action.
- Add manager overview counts across repositories without mixing their state.
- Add explicit controller update information that never changes repository readiness.
- Improve logs so every event carries repository ID, name, and root.

Examples:

- `Julie’s Dashboard is paused because integration PR #379 is open.`
- `Paseo Issue Automation is enabled and has no eligible issues.`
- `Repository path is unavailable: C:\...\Project.`
- `Manager is updated; no repository files were changed.`

## Testing strategy

Every PR must include focused unit tests and run the repository's standard validation:

- `npm run check`
- `npm test`
- `npm run pack:check`

Changed-area tests must cover:

- Windows and POSIX path behavior;
- registry corruption and missing paths;
- repository identity collisions;
- API cross-repository isolation;
- independent worker enable/disable state;
- manager and per-repository concurrency limits;
- migration rollback and interrupted migration;
- legacy command compatibility;
- exact user-facing blocker messages.

No PR should claim local validation passed unless it was actually run. GitHub Actions must pass on the exact PR head before merge.

## Change budget and sequencing rules

- Keep each PR focused on one architectural boundary.
- Do not combine the registry, server routing, worker rewrite, and migration in one PR.
- Preserve old behavior behind compatibility adapters until the replacement is covered by tests.
- Avoid repository-state schema changes before the registry and explicit context are stable.
- Do not remove the embedded dependency from Julie’s Dashboard until external launch and migration are proven.
- Do not automatically merge generated integration or migration PRs.

## Rollout order for Julie’s Dashboard

1. Complete and merge registry and context support.
2. Register Julie’s Dashboard in the standalone manager.
3. Verify read-only status and issue discovery against the existing state.
4. Enable one repository worker and compare behavior with the legacy launcher.
5. Stop the legacy launcher.
6. Run the explicit embedded-to-standalone migration.
7. Merge the migration PR after validation.
8. Confirm controller updates no longer change Julie’s Dashboard's lockfile or setup state.
9. Register a second repository and verify full isolation.

## Completion criteria

The project is complete when one standalone manager can operate at least two repositories concurrently, each repository can be installed and configured independently, controller updates never modify managed repositories, repository failures remain isolated, legacy state is preserved, and every paused or unavailable condition is explained directly in the dashboard with a concrete recovery action.
