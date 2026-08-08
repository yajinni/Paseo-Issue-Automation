# Paseo Functional Acceptance & E2E Verification Plan

## Goal

Prove that Paseo performs its intended job reliably from repository setup through issue completion before spending significant effort on optimization, broad refactoring, or speculative hardening.

The acceptance target is behavioral, not architectural:

> Given a configured repository and an eligible GitHub issue, Paseo can discover the issue, reserve one coding slot, create exactly one attempt/workspace, run the coder, establish a PR for the exact pushed head, hand that PR through the configured review workflow, return requested fixes to coding when needed, and finish in the intended terminal state while the manager reports the same reality.

## Acceptance principles

- Exercise production modules and persisted state rather than reproducing their logic in test-only models.
- Prefer deterministic fake command/process boundaries for CI; use real GitHub/Paseo only in an explicitly opt-in disposable-repository smoke.
- Assert externally meaningful behavior and persisted state after every lifecycle boundary.
- Treat a mismatch between documented/UI behavior and backend behavior as a product bug and fix it in a focused PR.
- Keep every PR independently reviewable and require exact-head CI before merge.
- Do not broaden this phase into performance/security/style cleanup unless a finding blocks correct functional behavior.

## Functional acceptance matrix

### A. Repository readiness and setup

Acceptance criteria:

- a registered repository resolves to the expected root and GitHub identity;
- setup completion is required before issue dispatch;
- the configured base branch is the branch used for attempt creation and final freshness checks;
- required managed labels/configuration are recognized consistently by CLI, workers, API, and manager status;
- pausing issue claims prevents new attempts without corrupting existing work;
- resuming claims permits eligible work on the next scheduler turn.

### B. Single-issue golden path

Acceptance criteria:

1. one eligible open issue is discovered;
2. dependency and issue-contract checks pass;
3. one coding slot is reserved;
4. the ready label is replaced by the running state;
5. one attempt and deterministic branch are recorded;
6. one Paseo workspace is created and verified;
7. one coder agent starts in that workspace;
8. the controller waits for coder completion;
9. the controller requires a clean worktree and exact branch/PR head agreement;
10. a draft PR is created when needed and an existing matching PR is reused;
11. exact-head validation evidence is persisted;
12. the configured review workflow receives that exact head;
13. approval/fix handling is applied only to the reviewed head;
14. CI/base freshness are rechecked where required;
15. the issue reaches the configured final human-review/managed-review state;
16. the coding slot is released at the intended boundary;
17. manager/status DTOs reflect the persisted backend state.

### C. Review/fix loop

Acceptance criteria:

- a changes-requested result creates or sends exactly one repair task for the matching review request/head;
- coder completion after a repair produces a new exact head before another review is accepted;
- stale review results for older heads cannot complete the current PR;
- configured maximum review rounds are enforced;
- an approved head cannot be finalized after the branch changed;
- review queue state, issue run state, and PR labels remain consistent.

### D. Configuration behavior

Verify behavior, not only persistence, for:

- base branch;
- coder model/provider;
- reviewer model/provider;
- coder/reviewer thinking levels where applicable;
- max active coding attempts;
- issue-selection mode;
- excluded labels;
- temporary-failure retry count;
- review workflow and review-round limits;
- browser/serial PR-review enablement;
- manager/global capacity where it participates in dispatch.

Each setting must have at least one acceptance test demonstrating that changing the setting changes the relevant runtime decision.

### E. Normal operator recovery

Acceptance criteria:

- pause/resume does not lose active work;
- restart creates a fresh attempt and does not accidentally reuse unsafe state;
- recover-first reuses an existing failed attempt only when recovery proves it is safe;
- fallback from recovery to restart is explicit and recorded;
- abandon stops/archives the recorded resources and leaves a coherent terminal state;
- branch keep/delete choices behave as presented in the manager;
- a failed or interrupted agent start can be reconciled without creating duplicate agents.

### F. Realistic failure behavior

Cover the failures most likely to be encountered during normal use:

- GitHub CLI/API command failure;
- Paseo workspace creation failure;
- coder start failure and bounded retry/reconciliation;
- coder completion without clean/pushed PR evidence;
- reviewer malformed/failed result;
- CI failure;
- PR disappears or changes head while being reviewed;
- base branch advances during review;
- worker/process restart with persisted in-flight state.

For every failure assert both the displayed/persisted failure state and the normal recovery path available to the operator.

### G. Multiple work items and repositories

Acceptance criteria:

- repository max-active capacity is never exceeded;
- manager/global capacity is never exceeded when multiple repositories are enabled;
- two schedulers cannot claim the same issue simultaneously;
- one failing issue does not prevent another eligible issue from progressing when capacity permits;
- dependency-waiting issues do not consume coding slots;
- repository A state/actions cannot mutate repository B;
- serial browser review remains globally serial where configured.

## Test layers to build

### Layer 1 — lifecycle acceptance harness

Add a deterministic integration harness around production modules with fake `gh`, `git`, and `paseo` command boundaries. The first milestone is a complete single-issue lifecycle with persisted state assertions at each boundary.

The harness should record command invocations so tests can prove "exactly once" behavior for workspace creation, agent start, review submission, fix dispatch, and terminal transitions.

### Layer 2 — focused behavior acceptance tests

Add small tests for configuration decisions, recovery actions, stale-head rejection, capacity, dependency gating, and realistic failures. Fix product behavior whenever these tests expose a mismatch.

### Layer 3 — disposable-repository smoke

After deterministic acceptance is green, add an opt-in workflow/script for a disposable GitHub repository and trivial issue. It should verify real Git/GitHub integration without using production repositories. This is a release/manual gate, not a requirement for every default CI run unless its cost proves acceptable.

## PR sequence

1. **Acceptance plan and lifecycle inventory**
   - land this plan;
   - document the production lifecycle entry points and expected state boundaries discovered during implementation.

2. **Golden-path lifecycle acceptance harness**
   - create deterministic fake command boundaries;
   - exercise eligible issue -> attempt/workspace -> coder -> exact-head PR validation -> review handoff/final state;
   - assert command counts and persisted state transitions.

3. **Review/fix acceptance**
   - changes requested -> repair -> new head -> new review -> approval;
   - reject stale review/head results;
   - enforce review-round limits.

4. **Configuration behavior acceptance**
   - prove runtime decisions change with max-active, base branch, issue-selection/exclusion, retry, and review configuration.

5. **Recovery/failure acceptance**
   - restart/recover/abandon;
   - launch retry/reconciliation;
   - realistic GitHub/Paseo/reviewer/CI failures.

6. **Multi-issue/multi-repository acceptance**
   - capacity, claim exclusivity, fairness-enough progress, dependencies, repository isolation, global serial review.

7. **Disposable real-GitHub smoke**
   - opt-in real repository workflow using a trivial generated issue and deterministic coding fixture where practical.

## Merge/validation discipline

- Branch every change from the latest merged `main` unless a dependency requires a short-lived stack.
- Keep product fixes separate from unrelated cleanup.
- Inspect each PR diff before relying on CI.
- Require exact-head normal CI for every PR.
- Require any dedicated acceptance/smoke workflow relevant to that PR to pass before merge.
- Re-run the lifecycle acceptance suite after every product fix that changes dispatch, attempts, review, recovery, or persisted run state.

## Exit criteria

This phase is complete when all of the following are true:

- the deterministic single-issue golden path runs end to end against production modules;
- the changes-requested/fix/re-review path is covered;
- the primary configuration options demonstrably affect runtime behavior;
- restart/recover/abandon and common failures end in coherent recoverable states;
- multiple issues/repositories respect capacity and isolation;
- manager-visible state agrees with backend persisted state for the covered flows;
- an opt-in disposable real-GitHub smoke has a documented and executable path;
- no known functional mismatch remains open from this acceptance audit.
