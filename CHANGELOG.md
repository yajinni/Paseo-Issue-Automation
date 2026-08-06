# Changelog

## 0.1.0 - Unreleased

- Replace the per-issue Orchestrator AI with a deterministic Issue Execution Controller.
- Use native GitHub issue relationships as the exclusive dependency source; dependency-like issue-body text is ignored.
- Reconcile blocked issues automatically and unlock them only after prerequisite implementation reaches the configured base branch.
- Separate user-configured parallel coding capacity from a persistent serial ChatGPT PR-review queue.
- Release coding slots when validated PRs enter review; return requested fixes to the normal coding pool and existing PR branch.
- Persist managed PRs, review jobs, fix jobs, queue ordering, exact SHAs, prompt versions, retries, leases, and transition history.
- Deduplicate review submissions by repository, PR number, head SHA, and prompt version; debounce rapid pushes and supersede stale jobs.
- Add managed-PR-only GitHub reconciliation and restart recovery for offline comments, new SHAs, merges, closures, interrupted submissions, and interrupted fixes.
- Add versioned structured GitHub review-result markers and review-state labels.
- Add an optional Playwright subsystem with explicit Chromium installation, a dedicated machine-local ChatGPT profile, owner-only storage, profile locking, diagnostics, and browser setup/doctor/test/reset/uninstall commands.
- Add a machine-global serial-review lease so projects sharing one browser profile cannot submit simultaneously.
- Add explicit merge and issue-closure permissions, exact-head requirements, and closed-without-merge operator handling.
- Add a dedicated PR review dashboard for queue state, managed PRs, browser health, conversation configuration, merge settings, recovery actions, and audit history.
- Preserve the existing deterministic internal Reviewer workflow when browser PR reviews are disabled.
- Require merge-based base updates, exact-commit revalidation, and human review when automatic merge is disabled.
- Add dependency-cycle and execution-wave validation.
- Replace the injected setup dashboard extensions with a unified responsive control center for overview, issue execution, dependency waves, activity, settings, and maintenance.
- Preserve guided setup, reversible installation, manual issue controls, fresh-attempt restarts, activity history, and package release checks.
- Create one worktree workspace per issue attempt, retry failed agent creation in that recorded workspace, stop after three failed agent starts or three failed reconciliation checks, surface the exact failure, and archive only workspaces proven to contain no agents.
- Add a versioned machine-local repository registry with standalone add, list, show, and remove commands as the first step toward one manager controlling multiple isolated repositories.
- Add explicit `--repo` selection for existing commands while preserving current-directory fallback for legacy workflows.
- Add tested repository-registry HTTP request handling and repository-scoped API path resolution before server integration.
- Add a standalone read-only repository manager server with repository registration, selection, isolated status inspection, and no dependency on the current working directory.
