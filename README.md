# Paseo Issue Automation

A repository-independent npm package that turns automation-ready GitHub issues into isolated Paseo coding work and draft pull requests.

## Guided setup

The package opens a local setup dashboard before the operating dashboard. It previews and manages the issue template, `paseo.json` service, GitHub labels, permanent **Issue Coding Automation** workspace, model configuration, self-test, repairs, and guided uninstall.

The package does not configure Paseo worktree setup or teardown, create repository coding instructions, require `AGENTS.md`, select validation commands, or assume a CI workflow name.

## Operating dashboard

The operating dashboard supports both automatic polling and direct issue control:

- start a specific `agent-ready` issue immediately
- skip or unskip an issue for automatic claiming
- see phase, branch, attempt number, timestamps, heartbeat, review round, workspace, and PR
- abandon an interrupted attempt without trying to recover it
- restart as a completely fresh attempt
- keep an old branch and use `-attempt-N`, or explicitly delete the package-recorded branch after safety checks
- copy the activity timeline or download its JSON

Coder and Reviewer may use the same model. Reviewer independence means a fresh session with no shared Coder chat history or working context.

## Interruption policy

There is no reconciliation, resume, or automatic recovery. Interrupted work is abandoned and restarted from the issue as a fresh attempt. Old branches are never deleted automatically.

## Reversible installation

The dashboard records package ownership under the repository's Git common directory and provides separate controls for every managed component. Pre-existing matching components are reused but never treated as package-owned.

## Development installation

```bash
npm install --save-dev github:yajinni/Paseo-Issue-Automation
npx paseo-issue-automation setup
```

## Commands

```bash
npx paseo-issue-automation setup
npx paseo-issue-automation start
npx paseo-issue-automation status
npx paseo-issue-automation enable
npx paseo-issue-automation disable
npx paseo-issue-automation start-issue --issue 123 --branch-action keep
npx paseo-issue-automation skip-issue --issue 123
npx paseo-issue-automation unskip-issue --issue 123
npx paseo-issue-automation abandon --issue 123 --reason "Interrupted"
npx paseo-issue-automation restart --issue 123 --branch-action keep
```

## Release preparation

CI tests Node 20, 22, and 24, runs syntax checks, validates the npm package contents, installs the produced `.tgz` archive in a clean project, and invokes the packaged CLI. Tagged `v*` releases can publish through the included npm-provenance workflow after `NPM_TOKEN` is configured.

See [Design decisions](docs/DESIGN_DECISIONS.md), [Automation protocol](docs/AUTOMATION_PROTOCOL.md), and [Publishing](docs/PUBLISHING.md).
