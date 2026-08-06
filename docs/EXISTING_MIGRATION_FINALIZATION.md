# Finalize an existing repository migration

Use this recovery path when a repository's project files were already migrated through a reviewed pull request, but machine-local Paseo state still reports **Embedded repository dependency**.

This can happen when the dependency and managed `paseo.json` service were removed outside the local controller's own migration workflow. The repository is already correct, but local ownership and setup records still describe the former embedded installation.

Do not create a second migration PR. The manager detects this state and shows **Repository files are already migrated** with a **Finalize existing migration** action.

## Before finalization

1. Update the machine-level controller to an exact reviewed commit that includes existing-migration finalization.
2. Restart the standalone manager.
3. Synchronize the repository's configured base branch locally.
4. Leave the working tree completely clean.
5. Stop the selected repository's coding worker.
6. Stop the selected repository's PR-review worker.
7. Ensure no automation issue is still running.

The manager verifies all of these conditions again before changing state.

## What the manager verifies

Finalization is available only when:

- machine-local state currently identifies the repository as embedded;
- `package.json` no longer declares `paseo-issue-automation`;
- no supported text lockfile still references `paseo-issue-automation`;
- the package-managed `issue-coding-automation` service is absent from `paseo.json`;
- a changed or user-owned service with that name is not present;
- the current branch is the configured base branch;
- the working tree is clean;
- no migration or removal PR is pending;
- no automation issue is active.

Repository status checks remain local and fast. The mutation performs a fresh GitHub active-issue check immediately before finalizing.

## What finalization changes

Finalization changes machine-local controller state only. It does not edit tracked repository files or create a pull request.

It:

- reconciles the recorded setup PR with GitHub;
- refuses to continue if that setup PR is still open, failed, or merged but unsynchronized;
- preserves a closed or superseded setup PR inside the migration audit record;
- clears only stale ownership for the removed package-managed `paseo.json` service;
- records a completed migration with source `existing-repository-state`;
- saves explicit `external-manager` controller mode;
- preserves the issue template, labels, Paseo workspace, models, configuration, skipped issues, run history, and PR-review history;
- keeps new issue claims paused;
- reruns the normal forced setup-readiness checks.

## Operator steps

Install the exact merged controller revision:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

Start or restart the manager:

```bash
paseo-issue-automation
```

Then:

1. Select the migrated repository.
2. Confirm the repository health panel says its files are already migrated.
3. Stop both repository workers if either is running.
4. Choose **Finalize existing migration**.
5. Review the refreshed setup status.
6. Resolve any remaining normal setup requirement.
7. Resume issue claims.
8. Start the coding and PR-review workers.

Finalization deliberately does not resume claims automatically.

## Julie's Dashboard

For `yajinni/JuliesDashboard`, repository PR #380 removed the floating project dependency, regenerated `package-lock.json`, and removed only the managed `issue-coding-automation` service. Setup PR #379 was closed as superseded.

After updating the machine controller, synchronize the local `rewrite/openspec-baseline` branch, open the standalone manager, select Julie's Dashboard, and choose **Finalize existing migration**. The closed #379 record is retained in the completed migration audit instead of continuing to block setup.

## Failure messages

The action fails without changing state when it cannot prove safety. The dashboard reports the exact remaining dependency, lockfile, service, branch, working-tree file, active issue, pending lifecycle PR, or setup-reconciliation condition.

Correct the named condition and retry the same action. Do not delete machine-local state to bypass ownership checks.
