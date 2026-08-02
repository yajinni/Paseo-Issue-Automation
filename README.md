# Paseo Issue Automation

A repository-independent npm package that turns automation-ready GitHub issues into isolated Paseo coding work and draft pull requests.

## Guided setup

The package opens a local setup dashboard before the operating dashboard. The setup flow can:

- preview every repository file, GitHub label, Paseo workspace, and local-state location before installation
- add the automated coding issue template
- merge the `issue-coding-automation` service into `paseo.json`
- create or reuse the GitHub lifecycle labels
- create or reconnect to the permanent local Paseo workspace named **Issue Coding Automation**
- configure the base branch and Orchestrator, Coder, and Reviewer models
- run a non-destructive setup self-test
- verify setup and keep issue claims paused until explicitly resumed

The package does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

## Reversible installation

The dashboard records package ownership under the repository's Git common directory and provides separate controls for every managed component:

- remove or restore the package-created issue-template file
- remove or repair only the package-owned service in `paseo.json`, preserving unrelated settings
- remove each package-created GitHub label separately or remove all managed labels
- archive only a Paseo workspace recorded as package-created
- clear local automation configuration, run records, logs, and ownership state
- run a guided uninstall with selectable cleanup steps

Pre-existing matching files, labels, services, and workspaces are reused but are not treated as package-owned. Changed package-created files or sections are preserved until the user explicitly restores the package version. Destructive cleanup is blocked while automation issues are running. Forced label removal requires a separate confirmation because GitHub removes that label from open issues using it.

After guided cleanup, close the dashboard and run the displayed package-manager command, such as:

```bash
npm uninstall paseo-issue-automation
```

That final command removes the dependency from `package.json`, the lockfile, and `node_modules`.

## Development installation

Until the package is published to npm, install it from GitHub inside a target repository:

```bash
npm install --save-dev github:yajinni/Paseo-Issue-Automation
npx paseo-issue-automation setup
```

After setup, open the permanent **Issue Coding Automation** workspace in Paseo and start the `issue-coding-automation` service.

## Lifecycle labels

```text
agent-ready → agent-running → human-review
                         ↘ agent-blocked
                         ↘ agent-failed
```

## Commands

```bash
npx paseo-issue-automation setup
npx paseo-issue-automation start
npx paseo-issue-automation status
npx paseo-issue-automation enable
npx paseo-issue-automation disable
```

Agent-facing transition and evidence commands are documented by `paseo-issue-automation help` and injected into the Orchestrator prompt.

## Repository responsibilities

The repository's coding harness supplies and enforces its own coding instructions. The person or AI creating an automation-ready issue must include its requirements, acceptance criteria, validation and checks, dependencies, privacy constraints, and stop conditions.

See [Design decisions](docs/DESIGN_DECISIONS.md) and [Automation protocol](docs/AUTOMATION_PROTOCOL.md).
