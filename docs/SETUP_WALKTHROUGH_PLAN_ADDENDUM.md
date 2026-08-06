# Setup Walkthrough Plan — Finalized Decisions Addendum

**Status:** Approved planning decisions  
**Date:** 2026-08-06  
**Applies to:** `docs/SETUP_WALKTHROUGH_PLAN.md`

This addendum records decisions finalized after the main setup walkthrough planning document was created. These decisions supersede any matching item under **Decisions still to finalize** in the main document. Runtime code has not been changed yet.

## Review-round defaults and limits

Use the same range for every automated review-round selector:

| Review stage | Default | Maximum |
|---|---:|---:|
| Quick review | 3 rounds | 20 rounds |
| Immediate full pull request review | 3 rounds | 20 rounds |
| Web ChatGPT full pull request review | 3 rounds | 20 rounds |

The initial review counts as the first round.

Quick review remains a preliminary stage. If the maximum quick-review rounds are exhausted and the quick reviewer still reports unresolved findings, preserve those findings and continue to the selected full-review stage:

- manual pull request review; or
- Web ChatGPT full pull request review.

Do not stop the workflow or apply `paseo:needs-attention` solely because the quick-review limit was reached.

Immediate full review and Web ChatGPT full review are final automated review stages. If either reaches its configured limit with blocking findings still unresolved:

- stop automated correction rounds;
- leave the pull request open;
- apply `paseo:changes-requested`;
- apply `paseo:needs-attention`;
- add a clear pull request comment explaining that the full-review limit was reached.

## Advanced Issues Setup settings

These settings must be visible during the setup walkthrough inside an expanded or collapsible **Advanced options** area.

### Maximum simultaneous issues

- Default: `1`
- Maximum allowed value: `20`

The user may choose any supported value from 1 through 20. The scheduler still selects runnable issues in lowest-issue-number order while respecting native GitHub blockers and the configured concurrency limit.

### Automatic temporary-failure retries

- Default: `3`

Automatic retries apply only to failures classified as temporary or retryable, such as transient provider, network, process, or GitHub availability failures.

Permanent or safety-related failures must not be repeatedly retried. Examples include missing permissions, invalid issue content, unresolved repository configuration, unsafe ambiguity, or repeated deterministic validation failure.

### Excluded labels

The optional excluded-label selector remains available during setup.

- Default: no excluded labels
- An excluded label prevents an otherwise eligible issue from being claimed.
- This is especially useful when the user chooses **All open issues**.

## Existing automation issue template

The repository already contains the package-managed issue template at:

```text
templates/automated-coding-task.md
```

Do not design or install a separate competing template. The setup walkthrough must install this existing package template into the selected repository as:

```text
.github/ISSUE_TEMPLATE/automated-coding-task.md
```

The existing template currently contains these sections:

- Objective
- Current behavior
- Required behavior
- Scope
- Out of scope
- Implementation direction
- Expected affected areas
- Dependencies
- Privacy and security
- Acceptance criteria
- Validation and checks
- Documentation
- Stop conditions

The template already tells issue authors to use GitHub native `blocked by` relationships and states that dependency-like body text is not read by the controller.

When implementation begins, reconcile the existing template with the newly approved lifecycle labels. In particular, its current frontmatter uses `agent-ready`; the new workflow plans to use `paseo:ready`. Update the template, validator, installation logic, documentation, tests, and migration behavior consistently rather than introducing a second template format.

The Issues Setup page must tell the user that this template will be installed and that planning AIs must follow it. Issues that do not satisfy the installed template will not be accepted for coding automation.

## Setup pull request target

Repository-managed setup files must be installed through a setup pull request rather than written directly to the selected base branch.

Before creating the setup pull request, show an explicit confirmation containing:

- selected repository;
- selected base branch;
- setup branch that will be created;
- files the setup pull request will add or update;
- whether automatic merge will be enabled.

The user must confirm that the setup pull request will **target the same selected base branch that future issue branches and pull requests will use**.

The setup pull request is created from a separate setup branch. It is not pushed directly onto the selected base branch.

Recommended confirmation wording:

> **Confirm setup pull request target**  
> Paseo will create a setup pull request targeting `[selected base branch]`. This is also the branch future automated issue work will start from and target.

## Automatic setup-PR merge

Automatic merge is the default behavior for the setup pull request.

Expected flow:

1. Create the setup branch from the latest selected base branch.
2. Add or update only the repository-managed setup files.
3. Open the setup pull request targeting the selected base branch.
4. Enable GitHub auto-merge when the repository supports it.
5. Wait for required checks, reviews, and branch protections to be satisfied.
6. Merge automatically when GitHub reports that the pull request is eligible.
7. Synchronize the local selected base branch after merge.
8. Verify the installed template and repository setup before enabling issue claims.

Do not bypass branch protection, required checks, required reviews, or repository rules.

If GitHub auto-merge is unavailable or cannot be enabled:

- keep the setup pull request open;
- explain what prevents automatic merge;
- provide an **Open setup pull request** action;
- pause setup completion and issue claims until the pull request is merged and the local base branch is synchronized.

Recommended user-facing option:

```text
☑ Automatically merge the setup pull request when GitHub allows it
```

This option is enabled by default.

## Labels versus repository files

- Create missing lifecycle labels directly through the GitHub API after final confirmation.
- Reuse matching existing labels without silently overwriting customized colors or descriptions.
- Install or update the automation issue template through the reviewed setup pull request.
- Any additional repository-managed files discovered during implementation should use the same setup-PR path unless they are machine-local configuration that does not belong in the repository.

## Planning items resolved by this addendum

The following items from the main document are now resolved:

- review-round defaults and maximum values;
- maximum simultaneous issues;
- default temporary-failure retry count;
- visibility of advanced Issues Setup options during setup;
- use of the repository’s existing automation issue template;
- setup pull request targeting the selected base branch;
- automatic setup-PR merge behavior.

The local clone/workspace flow and final readiness/first-run behavior still require continued planning.