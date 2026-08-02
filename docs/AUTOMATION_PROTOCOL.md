# Automation protocol

## Roles

Each claimed issue receives one thin Orchestrator, one Coder, and one fresh Reviewer session per review round. The Reviewer may use the same model as the Coder, but it must not receive the Coder's chat history or working context.

There is no Planner role and no separate CI-repair role. The same Coder owns implementation and every repair loop.

## Issue responsibility

The GitHub issue is the authoritative implementation plan. It must contain a concrete objective, required behavior, verifiable acceptance criteria, explicit validation and checks, and stop conditions.

## Starting work

Automatic polling claims eligible `agent-ready` issues except those temporarily skipped. The dashboard can also start a specific ready issue immediately.

If the normal issue branch already exists, the user chooses one of two explicit actions:

- keep it and start a numbered `-attempt-N` branch
- delete the package-recorded old branch after confirming it has no open pull request and deletion succeeds

## Interrupted attempts

The system does not reconcile, resume, or recover interrupted work. The user abandons the attempt and starts a fresh one. The old workspace is archived on a best-effort basis, the activity record is retained, and the issue is restarted from its authoritative GitHub issue.

## Completion gate

The exact final commit must have recorded passing issue-defined validation, a fresh-context Reviewer approval for the same commit, no failed or pending GitHub checks, and a draft pull request targeting the configured base branch.

The automation then applies `human-review` and prints `NEEDS HUMAN REVIEW FOR PR #<number>`.

## Prohibited actions

The automation and its agents must not merge or auto-merge, deploy, publish, modify production data, manage secrets, force-push, automatically delete remote branches, weaken checks, or broaden issue scope.
