# Release readiness audit — 2026-08-09

Status: **NO-GO for unattended autonomous coding until the review-workflow runtime gap is fixed and a live canary passes.**

## What is already verified

- Current `main` passes the default CI matrix on Node 20, 22, and 24, Windows command-shim coverage, and packed-install smoke.
- Issue admission is fail-closed for closed/excluded/unready/dependency-blocked/duplicate/capacity-blocked work.
- Coding completion requires a clean worktree, exact pushed branch head, a current PR, and exact-head validation evidence.
- Review/repair state preserves exact PR/head/request provenance and rejects stale review evidence.
- Post-merge issue completion requires exact approved review evidence and exact merged-head validation evidence.
- Work Queue lifecycle cards use authoritative on-demand data and no longer retain stale review/head state.
- Browser review submission has a conversation-readiness gate and fails closed on wrong URL, clipped/hidden composer, or unstable UI.
- Review queue pause/resume state and seven-day operational logs are visible in the manager.

## Blocking finding 1 — configured staged review workflows are not the controller's runtime path

The repository contains the staged review model introduced by the setup-walkthrough work:

- `harness-review-stages.mjs` defines Light/quick and Heavy/full stages, independent round limits, handoff behavior, exact-head verdict identity, and repair invalidation.
- `manual-review-lifecycle.mjs` defines Quick → Manual handoff/resume behavior.
- `web-chatgpt-full-review.mjs` defines Quick → Web ChatGPT full-review handoff and full-stage metadata.
- `review-workflow-prompts.mjs` defines the structured staged reviewer contract.

However, `controller-worker.mjs` still follows the older path:

1. if legacy PR-review automation is enabled, hand the validated PR directly to the serial browser-review queue and return;
2. otherwise run the generic legacy reviewer loop using `{ approved, findings }`;
3. finish with `markHumanReview`.

The controller does not select behavior from `config.review.workflow`, does not emit staged `harness-review` events, and does not invoke the Manual/Web handoff modules. As a result, Configuration and lifecycle UI can describe Light/Heavy/Web paths that the autonomous controller is not actually executing.

## Blocking finding 2 — approved coding-PR auto-merge is implemented as a service but not wired end to end

`approved-pr-auto-merge.mjs` correctly implements guarded opt-in eligibility and a policy-respecting `gh pr merge --auto --merge` request. Its unit tests cover exact-head approval, validation, checks, base freshness, ownership, findings, mergeability, and completion.

The current controller and staged managed-review reconciliation do not invoke that service. The legacy browser prompt can still be told to merge directly when the legacy store flag is enabled, while the newer staged Web ChatGPT full-review prompt intentionally forbids the reviewer from merging. This leaves two incompatible merge models and means the newer `review.autoMergeApproved` setting is not a complete production path.

Coding PRs are also created as drafts. Finalization must explicitly move an approved PR to ready-for-review before human handoff or local auto-merge.

## Required repair before autonomy

1. Make `config.review.workflow` authoritative at the controller boundary.
2. Implement the three configured paths end to end:
   - Heavy review immediately (`full-immediate`)
   - Light review → Manual review (`quick-manual`)
   - Light review → Web ChatGPT full review (`quick-web-chatgpt`)
3. Preserve independent quick/full round limits and exact-head repair invalidation.
4. Ensure Quick → Web ChatGPT creates staged full-review metadata before the serial browser worker runs.
5. Keep the staged browser reviewer review-only; local deterministic code owns merge authorization.
6. Wire `review.autoMergeApproved` to the guarded auto-merge service after exact-head approval/check/base gates.
7. Mark approved draft PRs ready before human review or auto-merge.
8. Ensure post-merge reconciliation completes the exact associated issue and local lifecycle.
9. Add production-boundary regression tests that prove each workflow route and repair path is actually called by the controller/reconciliation entry points, not only by isolated domain modules.

## Live release gate after repair

Before enabling unattended claims, run one controlled canary with repository concurrency = 1 and verify:

- claim → coding → draft PR → exact-head validation;
- selected staged review path actually occurs;
- at least one changes-requested → same-PR repair → new-head re-review cycle;
- stale-head review is ignored/requeued;
- required checks and base freshness gate finalization;
- approved draft PR becomes ready;
- if auto-merge is enabled, local deterministic policy requests GitHub auto-merge without bypass flags;
- merge closes/verifies only the explicitly associated issue;
- Work Queue reaches Completed and no active coding/review/fix jobs remain;
- Logs contain the complete lifecycle without secret/prompt leakage.

Only after that canary should concurrency be increased above 1.
