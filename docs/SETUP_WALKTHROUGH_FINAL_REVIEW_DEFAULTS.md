# Setup Walkthrough — Final Review and Merge Defaults

**Status:** Approved planning decisions  
**Date:** 2026-08-06  
**Applies to:** `docs/SETUP_WALKTHROUGH_PLAN.md` and `docs/SETUP_WALKTHROUGH_PLAN_ADDENDUM.md`

This document records the final product decisions for normal coding pull-request completion. These decisions supersede any earlier unresolved suggestions. Runtime code has not been changed yet.

## Automatic merge for normal coding pull requests

The PR Review Setup page must include:

```text
☐ Automatically merge approved pull requests when GitHub allows it
```

This option is **disabled by default**.

It is available only for workflows with a final automated full-review stage:

- immediate full pull request review through the selected Provider/Coding Harness; or
- Web ChatGPT full pull request review after quick review.

A normal coding pull request may be merged automatically only when all of the following are true:

- the configured final full-review stage approved the exact current pull-request head commit;
- all required validation and GitHub checks pass for that exact commit;
- no unresolved blocking review findings remain;
- no newer commit has invalidated the approval;
- GitHub branch protections, required reviews, rulesets, and merge requirements permit the merge;
- the pull request still targets the configured base branch;
- the pull request and branch are still recognized as Paseo-managed for the linked issue.

Never bypass GitHub protections or required checks. Quick review alone can never authorize automatic merge.

When automatic merge is enabled, prefer GitHub auto-merge so GitHub performs the merge only after repository requirements are satisfied. If auto-merge is unavailable, leave the pull request open and explain the blocker rather than bypassing repository policy.

## Manual-review workflow

When the selected workflow is **Quick review, then Manual review**:

- automatic merge is not offered;
- after quick review finishes or reaches its configured limit, preserve its findings and handoff summary;
- mark the pull request ready for human review;
- wait for normal GitHub review activity or manual merge;
- keep the coding issue workflow associated with the same pull request.

GitHub review states are the primary source of truth:

- an approved review means the human review passed, but the human still performs the merge;
- a changes-requested review returns the same pull request to the coding agent with the review findings;
- after fixes and required validation, the pull request returns to manual review;
- a manually merged pull request is detected as complete even if no explicit approved review was submitted.

The dashboard may provide fallback actions for cases where GitHub review state is insufficient:

- **Send back for changes**
- **Mark manual review complete**

These actions must be explicit and auditable. They must not silently merge the pull request.

## Issue completion

Normal coding pull requests should include a GitHub closing reference such as:

```text
Closes #123
```

After the pull request merges into the configured base branch:

- detect the merge;
- verify that the merged commit is present in the configured base branch;
- treat the linked issue as completed;
- allow GitHub to close the linked issue through the closing reference;
- reconcile controller state if GitHub closes the issue before the next polling cycle.

A closed but unmerged pull request does not complete the issue.

## Setup summary behavior

The final setup summary must show one of these outcomes:

```text
Pull request completion
Manual merge after approval
```

or:

```text
Pull request completion
Automatically merge after full approval and required checks
```

For manual-review mode, always show:

```text
Pull request completion
Human reviews and merges in GitHub
```

## Planning status

With these defaults approved, all product-level setup walkthrough decisions are complete enough to begin implementation planning. Implementation must still inspect and reconcile the current code, labels, template validation, review state, merge handling, GitHub protections, installation flow, workspace behavior, and tests before changing runtime behavior.
