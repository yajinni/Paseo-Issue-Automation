# Standalone multi-repository manager

The standalone manager runs Paseo Issue Automation once for the machine and manages multiple Git repositories. Each repository keeps isolated configuration, run history, issue state, PR-review state, and ownership records. Coding workers run independently, while a manager-wide coding limit and fair scheduling prevent one busy repository from consuming every slot. Web ChatGPT review, when selected, shares one machine-global serial ChatGPT Profile lease.

The manager listens only on `127.0.0.1` by default. It does not require a public webhook or inbound internet endpoint.

For normal onboarding, follow [Standalone setup walkthrough](SETUP_WIZARD.md). The operator/maintenance details below describe what happens after setup and the compatibility paths retained for existing installations.

## 1. Install an exact controller revision

### Install for standalone manager

Install a reviewed immutable commit at machine scope:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

Confirm the command is available and start the manager:

```bash
paseo-issue-automation --help
paseo-issue-automation
```

The bare command starts the standalone manager and opens its dashboard. It works outside a Git repository. On first run, if no repository has completed setup, the manager redirects to `/setup` and opens the standalone walkthrough. The global package is the controller installation; new managed repositories do not need `paseo-issue-automation` in `package.json`, a lockfile entry, repository `node_modules`, or a `paseo.json` service.

Default dashboard:

```text
http://127.0.0.1:4318
```

## 2. Add repositories through setup

The walkthrough is the preferred way to add a repository. It can authenticate GitHub CLI, discover repositories/branches, reuse a safe clone or make a manager-owned clone, register the checkout, create/reuse the permanent Paseo workspace, configure issue/review policy, and complete readiness.

After the first repository is configured, choose **Add repository via setup** in the manager dashboard to add another repository. Setup sessions are isolated: selecting another repository requires a new/restarted setup session rather than mutating the identity of an in-progress session.

Manual registry commands remain available for operator recovery and compatibility:

```bash
paseo-issue-automation repo add /path/to/repository
paseo-issue-automation repo list
paseo-issue-automation repo show OWNER/REPOSITORY
```

Registration itself does not modify repository files.

## 3. Final readiness and worker start

The final walkthrough page rechecks every prerequisite and any setup PR. **Finish setup** commits durable setup state before workers are started.

If **Start automation after setup** is selected, claims and repository workers are started only after that durable commit succeeds. If startup fails, completed setup remains recoverable and claims return to paused. With the checkbox cleared, setup completes with automation paused.

After setup, ordinary worker/maintenance actions belong in the manager dashboard rather than in the wizard.

## 4. External repository installation

The walkthrough uses external-manager installation for new repositories. External installation manages only:

- `.github/ISSUE_TEMPLATE/automated-coding-task.md`;
- lifecycle labels;
- the permanent Paseo automation workspace;
- machine-local controller state.

It does not add a project dependency, change a package lockfile, require repository `node_modules`, or add the `issue-coding-automation` service to `paseo.json`.

Managed template file changes use a reviewed setup PR. Missing managed lifecycle labels can be created after explicit setup confirmation. Existing same-name labels are reused without silently replacing user customization.

Setup PRs target the same selected base branch as future coding PRs. Automatic merge is requested only through normal GitHub policy and never bypasses checks, reviews, branch protections, or rulesets.

## 5. Migrate an embedded repository

An embedded repository declares `paseo-issue-automation` in its project manifest and normally has a package-managed `issue-coding-automation` service in `paseo.json`.

Before controller migration:

- resolve any open setup PR or merged setup PR that has not synchronized locally;
- stop the repository coding and PR-review workers;
- switch to the configured base branch;
- leave the working tree clean;
- configure Git `user.name` and `user.email`.

Choose **Create migration PR** in the manager. The migration workflow:

- creates a dedicated branch and reviewed PR;
- removes `paseo-issue-automation` using the repository's declared/detected package manager;
- updates `package.json` and the matching lockfile;
- removes only the package-managed Paseo service, preserving unrelated `paseo.json` content;
- preserves the issue template, labels, workspace, configuration, run history, and PR-review history;
- pauses new issue claims while the PR is pending;
- keeps controller mode embedded until GitHub reports the PR merged and the local base branch fast-forwards successfully;
- switches to external mode only after verifying the dependency and managed service are gone.

A migration PR that is open, merged but unsynchronized, closed, or failed appears as a repository-specific blocker with its PR number, link, synchronization error, and next action.

Existing repositories may also require the lifecycle/config migration described in [Standalone setup walkthrough](SETUP_WIZARD.md). That migration is preview-first, preserves active work/review history, stops on ambiguous legacy state, and never rewrites existing PR heads or branches.

## 6. Run repository workers

The coding worker and PR-review worker are independent for each repository.

- **Start worker** enables periodic coding dispatch for the selected repository.
- **Start PR-review worker** enables review scheduling and reconciliation for the selected repository.
- **Resume claims** permits new coding issues to be claimed.
- **Run now** performs one immediate repository scheduling turn.

The manager-wide coding limit bounds total active coding/fix work. Each fair scheduling turn can claim at most one issue for a repository, and pending repositories rotate after the last repository served.

Web ChatGPT submissions remain serial across repositories through the machine-global ChatGPT Profile lease. Provider/Coding Harness review does not require that browser lease.

## 7. Repair an external installation

Stop both repository workers, then choose **Repair managed components**.

Repair operates only on components recorded as manager-owned:

- a manager-owned issue template may be restored to expected content;
- a manager-owned lifecycle label may be recreated or corrected;
- a missing manager-owned workspace may be recreated;
- user-owned labels/workspaces are reused but not overwritten as owned resources.

Repository file changes use the normal reviewed setup-PR workflow. Repair never adds the package dependency or `paseo.json` service back to an external repository.

## 8. Remove an external installation

Stop both repository workers and ensure no automation issue is running. Choose **Create removal PR**.

The removal workflow:

1. verifies that the issue template is recorded as package-created and still matches its installed hash;
2. creates a reviewed PR that removes only that managed repository file;
3. pauses issue claims while the PR is pending;
4. waits for merge and local base-branch synchronization;
5. verifies the managed repository file is gone;
6. removes only labels recorded as package-created;
7. archives only the workspace recorded as package-created;
8. clears controller mode after every cleanup step succeeds.

Modified or user-owned files, labels, and workspaces are never deleted automatically. A partial cleanup remains recoverable through **Reconcile removal PR**.

Removing a repository from the manager registry is different: registry removal stops its manager workers and forgets the registry entry, but does not delete repository files or controller state.

## 9. Repository-specific commands

Commands may run from inside the repository or use a registered selector:

```bash
paseo-issue-automation status --repo OWNER/REPOSITORY
paseo-issue-automation enable --repo OWNER/REPOSITORY
paseo-issue-automation disable --repo OWNER/REPOSITORY
paseo-issue-automation start-issue --issue 123 --repo OWNER/REPOSITORY
paseo-issue-automation pr-review status --repo OWNER/REPOSITORY
```

Selectors may be a registry ID, `OWNER/REPOSITORY`, or a registered local path.

## 10. Update the machine controller

Install the next reviewed exact commit globally:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<new-approved-commit-sha>
```

Restart the manager process after the global update. Ordinary controller updates do not change managed repository manifests or lockfiles in external mode.

Review release notes and run repository-specific repair only when a release explicitly changes a managed repository component.

## Legacy embedded dashboard

The repository-local embedded dashboard remains operational for compatibility. It is not the preferred setup surface for new standalone-manager installations. Do not remove it merely because the standalone walkthrough exists.

## Recovery principles

The manager fails closed when it cannot prove safety. Its dashboard names the selected repository and, when relevant, the PR number, URL, affected files, local synchronization error, worker error, or capacity reason.

Common recovery actions are:

- return to the relevant setup page and use **Recheck** while setup is incomplete;
- merge/reconcile an open setup, migration, or removal PR;
- switch to the configured base branch with a clean working tree;
- resume claims after setup/migration is reconciled;
- start/restart one repository worker;
- repair only manager-owned components.

Do not delete machine-local state merely to bypass a blocker. Ownership and migration records are what prevent the manager from overwriting user-owned resources or duplicating active work.

Default CI is offline with respect to paid models and ChatGPT sign-in. Optional real-service verification is documented in [Live integration tests](LIVE_INTEGRATION_TESTS.md).
