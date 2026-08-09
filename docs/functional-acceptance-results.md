# Paseo Functional Acceptance Results

## Status

**Deterministic functional acceptance: PASS / COMPLETE**

The functional-acceptance phase defined in `docs/functional-acceptance-plan.md` has deterministic coverage for the intended production lifecycle, review and repair behavior, configuration decisions, recovery controls, realistic failure handling, capacity, and repository isolation.

The opt-in disposable real-GitHub/Paseo smoke is also implemented and documented in `docs/disposable-github-smoke.md` and `scripts/disposable-github-smoke.mjs`. That live provider-backed smoke was **not executed from the acceptance-audit environment** because it requires an intentionally disposable repository plus the operator's authenticated GitHub/Paseo/provider environment. It remains the release/manual gate for validating those external credentials and services.

As of 2026-08-08, no known functional mismatch remains open from the acceptance scope.

## Final deterministic CI baseline

The last behavior-bearing acceptance PR before this closeout document was PR #181, `Verify abandon and branch-delete operator controls`.

Exact tested head:

`90a3297997e717c45e1faa5975964f98eea3a1ce`

GitHub Actions run:

`31285102393` (CI run #719)

All required jobs passed:

- Node 20: `npm test`, `npm run check`, `npm pack --dry-run`
- Node 22: `npm test`, `npm run check`, `npm pack --dry-run`
- Node 24: `npm test`, `npm run check`, `npm pack --dry-run`
- packed archive: build, clean install, packaged CLI invocation
- Windows: cmd-shim regression plus syntax checks

PR #181 was then squash-merged as `38e4c98b35f3619a250f8bc8e0240281982a192a`.

## Acceptance evidence map

### A. Repository readiness and setup

Covered behavior includes repository-root/identity scoping, setup gating, base-branch configuration, claims pause/resume, worker lifecycle, and safe setup recovery.

Representative passing tests include:

- `registered repository context can be selected from any directory`
- `start issue processing enables claims and starts the repository worker as one action`
- `pause issue processing pauses claims and stops the repository worker as one action`
- `worker startup failure is recoverable and returns automation to paused state`
- `manager status exposes setup schema v3 configuration for post-setup editing`

### B. Single-issue golden path

PR #160 added the production-path lifecycle harness. It exercises the real dispatch and detached controller with deterministic command boundaries and a real temporary Git repository/worktree.

The core acceptance test proves one eligible issue reaches exact-head human review through:

1. issue validation and claim;
2. one deterministic attempt and workspace;
3. one coder launch;
4. committed and pushed issue work;
5. one draft PR for the exact remote head;
6. exact-head validation;
7. fresh independent review;
8. final `human-review` state.

The test also records command counts so duplicate workspace, coder, or PR creation fails the contract.

### C. Review and repair loop

PR #162 added the changes-requested repair lifecycle. A stale reviewed head cannot be reused: the same coder repairs the same branch/PR, a new head is pushed, validation is rerun for that new head, and a fresh independent review is required.

Representative passing tests include:

- `functional acceptance: requested review changes repair the same PR and require approval of the new exact head`
- `functional acceptance: an externally advanced PR head invalidates approval and requires fresh exact-head validation and review`
- `a new PR head invalidates review, validation, and pending merge eligibility`
- `every repair invalidates prior validation and review approval before the next round`
- review-round limit and exhaustion tests for the configured workflows

### D. Configuration changes runtime behavior

Acceptance covers runtime decisions rather than configuration serialization alone.

Examples include:

- PR #163 fixed saved coder/reviewer thinking settings so actual `paseo run` commands receive the selected thinking option.
- PR #164 verifies those configured thinking selections through the production lifecycle command boundary.
- issue-selection tests change eligibility between recommended-label and all-open modes;
- excluded-label tests prevent matching issues from entering the runnable queue;
- transient retry tests enforce the configured retry maximum;
- review workflow and round-limit tests alter runtime review stages and exhaustion behavior;
- repository and manager/global capacity tests alter dispatch decisions.

Representative passing tests include:

- `configured thinking levels are applied to each Paseo agent role`
- `candidate source switches between recommended labels and all open issues while retaining rollout compatibility`
- `all-open mode excludes configured labels, closed issues, pull requests, invalid contracts, and duplicate claims`
- `retry count uses configured maximum across scheduler turns`
- `manager config API reads and saves the global coding limit`
- `global capacity prevents independently timed workers from over-dispatching`

### E. Normal operator recovery

Recover-first, fresh restart, abandon, and branch handling now have direct production-behavior evidence.

PR #174 provides the process-level recover-first restart acceptance. The acceptance work around it exposed and fixed two lost-update races in PRs #175 and #176. PR #178 aligned the coder's runtime instructions with the supported recover-first policy.

PR #181 directly exercises production `abandonAttempt()` and branch deletion safety with a real temporary Git repository and bare origin. It proves:

- abandon stops the recorded coder;
- abandon archives the recorded workspace;
- abandoned state is persisted coherently;
- abandon does not delete the issue branch;
- explicit branch deletion refuses a recorded branch with an open PR;
- safe deletion removes only the recorded old branch;
- an unrelated local/remote branch is preserved;
- the fresh attempt is numbered and prior attempt history is retained.

Representative passing tests also include:

- `failed attempt recovery reuses the same workspace, branch, attempt, and coder`
- `a failed attempt gets only one recover-first restart before fresh fallback`
- `delete-branch restart explicitly bypasses recovery`
- `unsafe recorded workspace falls back without sending the old coder`
- `restart worker safely reuses one failed attempt without creating a duplicate workspace`

### F. Realistic failure behavior

The acceptance suite exercises failure at the normal external/process boundaries and requires fail-closed state plus a coherent next action.

Covered cases include:

- incomplete coder completion evidence with one bounded same-attempt recovery (PR #165);
- persistent incomplete completion evidence failing closed after that one recovery (PR #166);
- failed CI repaired on the same PR, followed by fresh exact-head validation and review (PR #167);
- base branch advancement after approval requiring a same-PR base merge and new exact-head approval (PR #168);
- persisted in-flight recovery through a real detached controller restart (PR #174);
- GitHub notification failure after controller failure, with local terminal state remaining authoritative (PR #177);
- failed or malformed independent reviewer results;
- command and agent timeouts;
- launch retry/reconciliation and ambiguous workspace-agent state.

Representative passing tests include:

- `functional acceptance: incomplete coder completion evidence recovers once on the same attempt and reaches human review`
- `functional acceptance: persistent incomplete completion evidence fails closed after the single recovery attempt`
- `functional acceptance: failed CI repairs the same PR and requires fresh validation and review on the new head`
- `functional acceptance: a base advance after approval forces a same-PR base merge and fresh exact-head review`
- `controller fails closed when the independent reviewer subprocess fails`
- `controller fails closed when reviewer returns JSON without the required verdict`
- `terminal failure persists locally even when GitHub notifications fail`
- `external commands time out instead of hanging indefinitely`

### G. Multiple work items and repositories

The existing scheduler/manager suite supplies the multi-item and multi-repository acceptance evidence without duplicating the controller golden-path tests.

Representative passing tests include:

- `execution waves preserve parallel work`
- `one polling cycle fills all currently available execution slots`
- `batch dispatch never exceeds the configured maximum`
- `blocked lowest-number candidate does not prevent the next eligible issue`
- `durable lease prevents simultaneous workers and can be renewed`
- `manager API scopes coding and PR review workers to one repository`
- `repository workers start once and dispatch only their own roots`
- `stopping, refreshing, and closing workers remain repository isolated`
- `review scheduler and reconciliation failures remain repository isolated`
- `global capacity prevents independently timed workers from over-dispatching`
- `pending repositories rotate fairly as global slots become available`
- `serial queue claims one due review and paused queue claims none`

### Manager-visible state agrees with persisted state

The Work Queue and manager status tests are built from recorded lifecycle/run evidence rather than a parallel invented state machine.

Representative passing tests include:

- `work queue exposes current lifecycle state and useful issue/PR identity`
- `work queue prefers durable lifecycle records and exposes structured evidence`
- `review detail preserves exact-head, stage, round, validation, and approval identity`
- `queue timeline combines recorded activity, review events, and prior attempts newest first`
- `manager status exposes setup schema v3 configuration for post-setup editing`

## Product findings discovered and fixed by acceptance

The acceptance phase found several real mismatches that were fixed in focused PRs rather than weakening the acceptance contracts.

1. **Linked-worktree base freshness fetch — PR #161**
   - `git fetch --prune origin +main:refs/remotes/origin/main` could fetch and then remove the same remote-tracking ref in a linked worktree.
   - Fixed by fetching from the fully qualified source ref `refs/heads/<base>`.

2. **Thinking configuration was not applied at runtime — PR #163**
   - coder/reviewer thinking selections were saved and validated but omitted from real agent launches.
   - Fixed by wiring the saved selections into the actual Paseo run arguments.

3. **Restart worker lost-update race — PR #175**
   - a restart worker could overwrite a newer controller terminal state after spawning the detached recovery controller.
   - Fixed by removing the stale post-controller state rewrite and clearing restart ownership before controller execution can advance state.

4. **Recover-first controller PID lost-update race — PR #176**
   - the recovery helper could overwrite a fast controller terminal write while recording the child PID.
   - Fixed with a startup ownership handshake so the resumed controller begins only after the parent has safely registered it.

5. **GitHub notification failure could erase terminal reality — PR #177**
   - terminal state was persisted after GitHub label/comment notification work, so a notification failure could leave a dead controller recorded as active.
   - Fixed by persisting authoritative terminal state first, clearing the controller PID, and treating notification failures as secondary diagnostics.

6. **Coder recovery instructions contradicted recover-first behavior — PR #178**
   - the launch prompt still told coders that interrupted work could never be recovered.
   - Fixed at the runtime launch boundary so only controller-authorized in-place recovery is permitted and duplicate workspaces/branches/coders remain forbidden.

The phase also exposed one **test-infrastructure** issue rather than a product defect:

- **Detached-controller acceptance cleanup — PR #180**
  - slower CI runtimes could finish functional assertions while detached controller descendants were still releasing temporary repository files.
  - the fixtures now retain the exact dispatch PID, stop the detached process group, await bounded shutdown, and only then remove their temporary repositories.

## Disposable real-GitHub/Paseo smoke

PR #179 added the release/manual smoke gate:

- `scripts/disposable-github-smoke.mjs`
- `docs/disposable-github-smoke.md`
- `test/disposable-github-smoke-script.test.mjs`

The runner is intentionally guarded. It requires both `PASEO_LIVE_SMOKE=1` and an exact `PASEO_LIVE_SMOKE_REPOSITORY=owner/repo`, verifies the actual repository identity, refuses a dirty worktree, creates a real trivial issue, dispatches the normal lifecycle, and verifies that the final draft PR head equals the persisted approved commit on the configured base branch.

It intentionally leaves the generated issue and PR intact for inspection and does not merge or clean them up automatically.

The runner's safety/help/issue-contract behavior is covered by default CI. The credentialed live smoke itself was not executed during this audit and should be run from `docs/disposable-github-smoke.md` before a release/publish when a disposable repository and valid provider credentials are available.

## Exit-criteria conclusion

All acceptance-plan exit criteria now have either deterministic production-path evidence or, for the external live boundary, a merged documented executable manual smoke path:

- deterministic golden path: **pass**;
- changes-requested repair/re-review: **pass**;
- primary runtime configuration behavior: **pass**;
- restart/recover/abandon and common failure handling: **pass**;
- multi-issue/multi-repository capacity and isolation: **pass**;
- manager-visible versus persisted state: **pass**;
- disposable real-GitHub smoke path: **implemented and documented**;
- known acceptance-scope functional mismatches: **none open**.

Broad performance work, broad security hardening, speculative edge cases, and unrelated refactoring remain outside this acceptance phase exactly as defined by the plan.