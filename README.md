# Paseo Issue Automation

A repository-independent npm package that turns automation-ready GitHub issues into isolated Paseo coding work and draft pull requests.

## What it installs

The guided setup dashboard can:

- add the automated coding issue template
- merge the `issue-coding-automation` service into `paseo.json`
- create the GitHub lifecycle labels
- create the permanent local Paseo workspace named **Issue Coding Automation**
- configure the base branch and Orchestrator, Coder, and Reviewer models
- verify setup and keep issue claims paused until explicitly resumed

It does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

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
