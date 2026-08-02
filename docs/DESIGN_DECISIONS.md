# Design decisions

## Package boundary

This package coordinates GitHub issue coding through Paseo. It does not own Paseo's generic worktree setup or teardown behavior.

The coding harness is responsible for discovering and following each repository's coding instructions. This package does not require, create, modify, or explicitly tell models to read `AGENTS.md` or any other repository-instruction filename.

## Repository installation

The guided installer may add or update only:

- the npm dependency declaration and lockfile through npm
- `.github/ISSUE_TEMPLATE/automated-coding-task.md`
- the `issue-coding-automation` service entry in `paseo.json`
- the automation lifecycle labels in GitHub

Runtime configuration and run state live under the repository's common Git directory at `.git/paseo-issue-automation/` and are not committed.

## Permanent workspace

The installer creates one local Paseo workspace titled exactly:

`Issue Coding Automation`

This workspace hosts the dashboard and controller. Issue implementation workspaces remain Paseo-managed worktree workspaces created when issues are claimed.

## Branch configuration

Setup asks for one base branch. Each issue branch is created from that branch and its pull request targets the same branch. There is no separate PR target setting.

## Reviewer isolation

The Coder and Reviewer may use the same provider and model. Independence means the Reviewer is launched as a fresh session with no shared chat history or working context from the Coder. The Reviewer receives only the issue, repository state, exact commit, and evidence needed for review.

## Controller simplicity

The package does not add controller locks or attempt to coordinate multiple simultaneously running controllers. Running more than one controller is unsupported user behavior and is intentionally not handled in the first version.

## Interruption policy

The package does not reconcile or resume interrupted automation runs. If a run is interrupted, it is treated as failed or abandoned and the user starts a fresh attempt. The package does not try to infer or recover partially completed work.

## Validation

The setup wizard does not configure repository-wide validation commands. Every automation-ready issue must contain meaningful `Validation and checks` instructions. The issue author or issue-authoring AI is responsible for selecting them.

## GitHub checks

The automation does not ask for a CI workflow name. It inspects the checks attached to the exact pull-request head commit and requires all reported required checks to finish successfully.
