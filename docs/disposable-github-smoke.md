# Disposable real-GitHub smoke

This is the opt-in live boundary for the functional-acceptance phase. It exercises real Git, GitHub, Paseo workspace/coder execution, draft-PR creation, the independent reviewer, exact-head validation, and final human-review state in a repository that is safe to mutate.

It is intentionally **not** part of default CI because it consumes real GitHub and Paseo/provider resources.

## Safety requirements

Use a repository created specifically for smoke testing. Do not point this command at a production or development repository you care about.

Before running:

1. Clone the disposable repository locally and make sure its worktree is clean.
2. Run Paseo setup for that repository and confirm setup is complete.
3. Configure a working coder provider/model and reviewer provider/model.
4. Disable managed/browser PR review for this smoke. The smoke deliberately exercises the controller's direct independent-review path and expects the terminal state to be `human-review`.
5. Confirm the managed `paseo:ready` label exists.
6. Confirm `gh` is authenticated for the disposable repository and the `paseo` CLI/provider used by the automation is available.
7. Set `PASEO_LIVE_SMOKE_REPOSITORY` to the exact `owner/repo` identity of the disposable repository.

The runner has a second explicit mutation gate, `PASEO_LIVE_SMOKE=1`. It also resolves the actual repository through `gh repo view` and refuses to proceed if it does not exactly match `PASEO_LIVE_SMOKE_REPOSITORY`.

## Run

From the Paseo Issue Automation source checkout:

```bash
PASEO_LIVE_SMOKE=1 \
PASEO_LIVE_SMOKE_REPOSITORY=owner/disposable-repo \
node scripts/disposable-github-smoke.mjs \
  --root /absolute/path/to/disposable-repo
```

Optional controls:

```text
--timeout-seconds N   Maximum lifecycle wait; default 1200 seconds
--poll-seconds N      Status poll interval; default 5 seconds
--help                Print usage without touching GitHub
```

## What the runner does

The runner:

1. proves the supplied root is the Git root and its GitHub identity exactly matches the explicit disposable-repository opt-in;
2. refuses a dirty worktree;
3. reads the real Paseo status/configuration and requires setup completion plus the direct-review path;
4. creates a new `paseo:ready` issue using the production issue-contract headings;
5. asks the coder to create one uniquely named text file with exact contents and no unrelated edits;
6. dispatches that exact issue through `start-issue`;
7. waits for the persisted attempt to reach `human-review`, failing immediately on failed/blocked/abandoned terminal states;
8. reads the raw persisted run state and the real GitHub PR;
9. verifies the PR is draft, targets the configured base branch, and its exact GitHub head SHA equals Paseo's persisted approved commit.

On success it prints JSON containing the issue, PR, branch, approved commit, base branch, and generated artifact name.

## Cleanup

The runner deliberately does **not** merge, close, or delete anything. This preserves the issue and draft PR for inspection after the smoke.

After inspection, manually close the disposable PR/issue and delete its issue branch/workspace as appropriate, or discard the entire disposable repository.

## Expected result

A successful run is the live release/manual gate for the same lifecycle already exercised deterministically in CI. Failure should be treated as a product/integration finding: preserve the generated issue/PR and Paseo state, fix the mismatch in a focused PR, then repeat the disposable smoke.