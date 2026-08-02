# Automation protocol

## Roles

Each claimed issue receives:

1. one thin Orchestrator
2. one Coder
3. one fresh independent Reviewer per review round

There is no Planner role and no separate CI-repair role. The same Coder owns implementation and every repair loop.

## Issue responsibility

The GitHub issue is the authoritative implementation plan. It must contain a concrete objective, required behavior, verifiable acceptance criteria, explicit validation and checks, and stop conditions.

The automation blocks issues that omit those sections rather than guessing repository-specific commands or requirements.

## Completion gate

The exact final commit must have:

- a recorded passing summary for every issue-defined validation and check
- an independent Reviewer approval for the same commit
- no failed or pending GitHub checks attached to that pull-request head
- a draft pull request targeting the configured base branch

The automation then applies `human-review` and prints:

`NEEDS HUMAN REVIEW FOR PR #<number>`

## Prohibited actions

The automation and its agents must not merge or auto-merge, deploy, publish, modify production data, manage secrets, force-push, delete remote branches, weaken checks, or broaden issue scope.
