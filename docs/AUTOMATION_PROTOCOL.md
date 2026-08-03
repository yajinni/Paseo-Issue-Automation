# Automation protocol

## Roles

The runtime has one deterministic Issue Execution Controller, one Coder per issue attempt, and one fresh Reviewer session per review round.

There is no runtime Planner role and no Orchestrator AI. Planning and issue creation happen before the controller receives the issues.

## Issue responsibility

The GitHub issue is the authoritative implementation plan. It must contain a concrete objective, required behavior, verifiable acceptance criteria, explicit validation and checks, and stop conditions.

Native GitHub issue dependencies are authoritative. The legacy body syntax `Blocked by #123` and `Depends on #123` remains a compatibility fallback only.

## Dependency gate

The controller recalculates dependency readiness during each polling cycle.

A coding dependency is satisfied only when:

1. the dependency issue is closed as completed;
2. a pull request that closes it was merged into the configured base branch; and
3. the PR merge commit is present in the current remote base branch.

A closed duplicate, abandoned issue, unmerged PR, or merge into a different branch does not unlock downstream work.

The controller preserves dependency relationships after completion. It changes labels and execution state rather than erasing history.

## Starting work

Automatic polling reconciles dependency-blocked issues, then claims eligible `agent-ready` issues up to the configured maximum active count. The dashboard can also start a specific eligible issue immediately.

The controller launches the configured Coder directly in a Paseo worktree. It never launches an Orchestrator model.

If the normal issue branch already exists, the user chooses one of two explicit actions:

- keep it and start a numbered `-attempt-N` branch;
- delete the package-recorded old branch after confirming it has no open pull request and deletion succeeds.

## Coder contract

The Coder owns implementation and every repair loop. It must:

- follow the complete issue and repository instructions;
- stay within scope;
- perform every issue-defined validation;
- open or update a draft PR targeting the configured base;
- record passing validation for the exact PR head;
- merge the latest base into the issue branch when instructed;
- block rather than guess when integration requires a product or architecture decision.

## Reviewer contract

Every review round launches a fresh Reviewer session with no shared Coder chat history or working context. The Reviewer may use the same model selection as the Coder, but it must not edit.

A code change, base merge, or conflict resolution invalidates all previous validation and review evidence.

## Base and conflict gate

Before approval can advance, the controller verifies that the issue branch contains the latest configured base branch and that GitHub does not report a merge conflict.

When the branch is stale or mechanically conflicting, the controller sends the same Coder a fixed instruction to merge the latest base, resolve ordinary conflicts, rerun all validation, and update the draft PR. Automatic rebase and force-push are prohibited.

Semantic conflicts that require a product or architecture decision block the issue for a human.

## Completion gate

The exact final commit must have:

- recorded passing issue-defined validation;
- a fresh Reviewer approval for the same commit;
- the latest base branch incorporated;
- no merge conflict;
- no failed or pending GitHub checks; and
- a draft pull request targeting the configured base branch.

The controller then applies `human-review` and prints `NEEDS HUMAN REVIEW FOR PR #<number>`.

## Prohibited actions

The controller and agents must not merge or auto-merge, deploy, publish, modify production data, manage secrets, force-push, automatically delete remote branches, weaken checks, or broaden issue scope.
