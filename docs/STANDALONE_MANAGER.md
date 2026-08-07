# Standalone multi-repository manager

The standalone manager runs Paseo Issue Automation once for the machine and manages multiple registered Git repositories. Each repository keeps isolated configuration, run history, issue state, PR-review state, and ownership records. Coding workers run independently, while a manager-wide coding limit and round-robin scheduling prevent one busy repository from consuming every slot. PR-review workers remain repository-scoped and share one machine-global serial ChatGPT browser lease.

The manager listens only on `127.0.0.1` by default. It does not require a public webhook or inbound internet endpoint.

## 1. Install an exact controller revision

Install a reviewed immutable commit at machine scope:

```bash
npm install --global github:yajinni/Paseo-Issue-Automation#<approved-commit-sha>
```

Confirm the command is available:

```bash
paseo-issue-automation --help
```

The global package is the controller installation. Managed repositories do not need `paseo-issue-automation` in `package.json`, a lockfile entry, `node_modules`, or a `paseo.json` service.

## 2. Register repositories

Register a repository by path:

```bash
paseo-issue-automation repo add /path/to/repository
```

On Windows:

```powershell
paseo-issue-automation repo add C:\path\to\repository
```

Inspect the registry:

```bash
paseo-issue-automation repo list
paseo-issue-automation repo show OWNER/REPOSITORY
```

Registration records the normalized local path and GitHub identity in machine-local manager state. It does not modify repository files.

## 3. Start the manager

```bash
paseo-issue-automation
```

The bare command starts the standalone manager and opens its dashboard in the browser.

Default dashboard:

```text
http://127.0.0.1:4318
```

Select a registered repository before using repository controls. Every API action resolves the selected registry entry to one validated repository root.

## 4. Install a fresh repository for external management

For a repository that has never used the embedded package installation:

1. Stop that repository's coding and PR-review workers.
2. Select the repository in the manager.
3. Choose **Install for standalone manager**.
4. Review and merge any setup PR that the manager creates.
5. Allow the local configured base branch to fast-forward.
6. Configure the base branch, Coder model, Reviewer model, limits, and PR-review settings.
7. Resume issue claims and start the repository workers.

External installation manages only:

- `.github/ISSUE_TEMPLATE/automated-coding-task.md`;
- lifecycle labels;
- the permanent Paseo automation workspace;
- machine-local controller state.

It does not add a project dependency, change a package lockfile, require repository `node_modules`, or add the `issue-coding-automation` service to `paseo.json`.

## 5. Migrate an embedded repository

An embedded repository declares `paseo-issue-automation` in its project manifest and normally has a package-managed `issue-coding-automation` service in `paseo.json`.

Before migration:

- resolve any open setup PR or merged setup PR that has not synchronized locally;
- stop the repository coding and PR-review workers;
- switch to the configured base branch;
- leave the working tree clean;
- configure Git `user.name` and `user.email`.

Choose **Create migration PR** in the manager. The migration workflow:

- creates a dedicated branch and reviewed PR;
- removes `paseo-issue-automation` using the repository's declared or detected package manager;
- updates `package.json` and the matching lockfile;
- removes only the package-managed Paseo service, preserving unrelated `paseo.json` content;
- preserves the issue template, labels, workspace, configuration, run history, and PR-review history;
- pauses new issue claims while the PR is pending;
- keeps controller mode embedded until GitHub reports the PR merged and the local base branch fast-forwards successfully;
- switches to external mode only after verifying the dependency and managed service are gone.

A migration PR that is open, merged but unsynchronized, closed, or failed appears as a repository-specific blocker with its PR number, link, synchronization error, and next action.

## 6. Run repository workers

The coding worker and PR-review worker are independent for each repository.

- **Start worker** enables periodic coding dispatch for the selected repository.
- **Start PR-review worker** enables review scheduling and reconciliation for the selected repository.
- **Resume claims** permits new coding issues to be claimed.
- **Run now** performs one immediate repository scheduling turn.

The manager-wide coding limit bounds the total active coding and fix work across all repositories. Each fair scheduling turn can claim at most one issue for a repository, and pending repositories rotate after the last repository served.

The machine-global ChatGPT browser lease permits only one active browser review submission at a time across all repositories.

## 7. Repair an external installation

Stop both repository workers, then choose **Repair managed components**.

Repair operates only on components recorded as manager-owned:

- a manager-owned issue template may be restored to expected content;
- a manager-owned lifecycle label may be recreated or corrected;
- a missing manager-owned workspace may be recreated;
- user-owned labels and workspaces are reused but not overwritten as owned resources.

Repository file changes use the normal reviewed setup-PR workflow. Repair never adds the package dependency or `paseo.json` service back to an external repository.

## 8. Remove an external installation

Stop both repository workers and ensure no automation issue is running. Choose **Create removal PR**.

The removal workflow:

1. verifies that the issue template is recorded as package-created and still matches its installed hash;
2. creates a dedicated **Remove Paseo repository integration** PR that removes only that repository file;
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

## Recovery principles

The manager fails closed when it cannot prove safety. Its dashboard names the exact selected repository and, when relevant, the PR number, URL, affected files, local synchronization error, worker error, or capacity reason.

Common recovery actions are:

- merge an open setup, migration, or removal PR;
- switch to the configured base branch with a clean working tree;
- retry migration or removal synchronization;
- resume issue claims;
- start or restart one repository worker;
- repair only manager-owned components.

Do not delete machine-local state merely to bypass a blocker. Ownership records are what prevent the manager from overwriting or deleting user-owned resources.
