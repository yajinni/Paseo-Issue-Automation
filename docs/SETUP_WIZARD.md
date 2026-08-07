# Standalone setup walkthrough

The standalone manager is the recommended setup path for new repositories. Run the bare command from any directory, including outside a Git repository:

```bash
paseo-issue-automation
```

On first run, if no registered repository has completed setup, the manager opens `/setup`. For an already configured manager, use **Add repository via setup** in the manager dashboard to rerun the walkthrough for another repository.

The walkthrough is resumable and machine-local. It does not require an existing repository checkout before it starts.

## Walkthrough order

1. **Paseo** — discover the Paseo daemon, verify CLI/daemon compatibility, and authenticate when the daemon requires a password.
2. **Provider / Coding Harness** — choose the harness used for coding and review, then choose coding/review models and thinking levels independently.
3. **GitHub repository** — verify GitHub CLI authentication, choose an account, repository, and base branch, and verify required repository capabilities.
4. **Checkout** — reuse one safe existing checkout or create a manager-owned clone. Dirty or otherwise unsafe user clones are shown but never modified automatically.
5. **Workspace** — reuse/create the permanent Paseo workspace and prove isolated-worktree creation and cleanup without launching a model.
6. **Issues** — choose Recommended labels or All open issues, concurrency/retry limits, exclusions, and preview lifecycle-label/template installation changes.
7. **Review** — choose Quick → Manual, Quick → Web ChatGPT, or Full review immediately; configure independent quick/full limits. ChatGPT Profile setup appears only when Web ChatGPT review is selected.
8. **Final readiness** — recheck all prerequisites, reconcile any setup PR, review the complete selection summary, and finish setup. Starting automation immediately is optional.

Back and Recheck preserve valid selections. Failed rechecks invalidate only the affected readiness gate. Forward navigation remains server-gated.

## Secrets and security boundaries

Ordinary setup JSON never stores passwords, tokens, cookies, authorization headers, API keys, or raw credentials.

- A Paseo daemon password is passed only through the connection credential abstraction. Persistent storage is offered only when a secure backend passes its write/read/delete probe; otherwise the credential remains session-only.
- GitHub authentication uses GitHub CLI. Paseo does not request or persist the GitHub token in setup state.
- ChatGPT Profile uses a dedicated Playwright profile and manual sign-in. Paseo does not ask for or store a ChatGPT password.
- Readiness checks do not create fake GitHub issues or fake reviews, do not change application code, and do not send paid model prompts.
- Temporary worktree probes must be removed and their cleanup verified before readiness can pass.
- The standalone manager binds to localhost by default.

Do not put secrets into issue bodies, repository configuration, setup-session fields, screenshots, or diagnostics.

## Repository changes and setup PRs

The preferred external-manager installation does not add `paseo-issue-automation` to a managed repository's `package.json`, lockfile, `node_modules`, or `paseo.json` service configuration.

Missing managed lifecycle labels are created through GitHub after explicit confirmation. Existing labels with the same names are reused without silently replacing custom colors/descriptions. Managed issue-template file changes use the reviewed setup-PR flow and target the same selected base branch as future issue PRs.

Setup-PR automatic merge is requested through normal GitHub policy. It never bypasses required checks, reviews, branch protections, or rulesets. If auto-merge is unavailable, setup remains paused until the PR is resolved and the configured base branch synchronizes locally.

## Issue and dependency behavior

Recommended-label mode uses `paseo:ready`; migrated legacy `agent-ready` remains readable during rollout. All-open mode evaluates every open issue against the same contract and exclusion rules.

Eligible issues are considered by issue number, lowest first. Native GitHub `blocked by` relationships are the only execution dependencies. A blocked low-number issue is temporarily skipped so the next eligible issue can run; when its dependencies clear it returns to normal ordering. Parent/sub-issue relationships and dependency-like body text are not execution dependencies.

Invalid issues receive needs-attention feedback and are rechecked on later scheduling turns. Temporary infrastructure/provider failures use bounded later-turn retries rather than a tight retry loop.

## Review behavior

Quick and full review rounds are independent. The default is 3 rounds for each stage and each limit may be configured up to 20.

- **Quick → Manual** hands the exact-head PR to a person after quick review passes or reaches its handoff limit. Automatic merge is unavailable in this mode.
- **Quick → Web ChatGPT** performs quick review first, then serializes full review through the machine-global ChatGPT Profile lease.
- **Full review immediately** skips the quick stage and uses the configured full reviewer from round 1.

Every automated review result is bound to repository, issue, PR, exact head SHA, stage, round, and prompt version. A new head invalidates old approval/validation state.

Normal coding-PR automatic merge is disabled by default. When explicitly enabled for a supported workflow, Paseo only requests GitHub auto-merge after exact-head review and validation pass; GitHub protections remain authoritative.

## Finish setup

Final readiness fails closed when a required page or reconciliation check is not successful. **Finish setup** commits durable setup state first. Only afterward, if **Start automation after setup** is selected, claims are enabled and the repository coding/review workers start.

If worker startup fails, completed setup remains recoverable and claims return to paused. Finishing with the checkbox cleared leaves setup complete with automation paused.

## Existing installations

Existing installations use the preview-first migration flow before resuming claims. Migration normalizes supported v2 configuration to v3, maps legacy issue lifecycle assignments, retains native dependency-wait state locally, preserves active coding/review work and history, and keeps existing Web ChatGPT review state.

Migration stops on ambiguous legacy state. Coding/review workers are stopped and claims are paused during apply. User-owned repository label definitions are never deleted automatically. Managed issue-template ownership/content updates remain behind the reviewed setup-PR flow. Existing PR heads and branches are never rewritten.

Embedded installations that still contain the project dependency/service must also use the existing reviewed controller migration flow described in [Standalone multi-repository manager](STANDALONE_MANAGER.md).

## Recovery

Use **Recheck** after correcting an authentication, repository-capability, clone, workspace, issue, review-profile, setup-PR, or readiness blocker. Do not delete machine-local state to bypass a safety check.

Maintenance after setup belongs in the normal manager UI: repository health, worker controls, pause/resume, repair, embedded-controller migration, removal, and reconciliation should not be performed by restarting an incomplete wizard step.

For optional real-service verification beyond default CI, see [Live integration tests](LIVE_INTEGRATION_TESTS.md).
