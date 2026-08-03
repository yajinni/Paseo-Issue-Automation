# Design decisions

## Package boundary

This package coordinates GitHub issue coding through Paseo. It does not own Paseo's generic worktree setup or teardown behavior and does not require any repository-instruction filename.

## Planning boundary

A strong planning model used outside the runtime creates the master plan, complete GitHub issues, validation requirements, native dependencies, and intended parallel work.

The runtime does not reinterpret or redesign that plan.

## Issue Execution Controller

The runtime manager is called the **Issue Execution Controller**. It is deterministic code, not an AI role.

It owns dependency reconciliation, concurrency, attempt state, Coder launch, Reviewer launch, repair loops, exact-commit evidence, base freshness, conflict detection, CI state, and the transition to human review.

## Control center UI

The local browser interface is an operations control center rather than only a setup page. It separates everyday operation from installation and destructive maintenance through six explicit views: Overview, Issues, Dependencies, Activity, Settings, and Maintenance.

The overview prioritizes work requiring human attention, active executions, dependency-blocked work, controller capacity, polling, and recent activity. Issue details expose exact validation and review commits, Reviewer findings, PR and CI state, base freshness, dependencies, failure reasons, and the attempt timeline.

The UI remains framework-free. Its layout, style, browser behavior, and status model are explicit modules composed by `ui.mjs`; the runtime does not extend the page through chained string replacements or global render overrides.

Dangerous maintenance actions are separated from normal controls. High-risk cleanup uses typed confirmation, and cleanup remains limited to package-owned components.

## Permanent workspace

The installer creates one local Paseo workspace titled exactly `Issue Coding Automation`. Issue implementation workspaces remain Paseo-managed worktree workspaces.

## Branch configuration

Setup asks for one base branch. Each issue branch is created from that branch and its pull request targets the same branch.

## Dependency model

Native GitHub `blocked by` relationships are the only dependency source. The controller does not parse `Blocked by #123`, `Depends on #123`, or similar issue-body text.

Sub-issues represent hierarchy; dependencies represent execution constraints.

Relationships are preserved after satisfaction. The controller re-evaluates readiness and updates operational labels instead of deleting dependency history.

A coding dependency is satisfied by merged implementation present in the configured base branch, not by issue closure alone.

If structured native relationship data cannot be retrieved, the controller blocks execution rather than guessing that an issue has no dependencies.

## Parallel work

The controller calculates the eligible issue set from the dependency graph and starts up to `maxActive` attempts. Independent issues may run simultaneously. Downstream work becomes eligible automatically after all prerequisite merges reach the base branch.

## Reviewer isolation and audit trail

Coder and Reviewer may use the same provider and model. Independence means the Reviewer is launched as a fresh session with no shared chat history or working context from the Coder.

Reviewer verdicts and findings are stored in local attempt history and returned to the same Coder when changes are required. Every approval and changes-required verdict is also posted to the draft PR with the exact reviewed commit and review round. Reviewer findings are not posted to the planning issue.

Failure to write the PR audit comment fails the controller round rather than allowing an incomplete audit trail.

## Integration updates

The same Coder resolves ordinary merge conflicts. The controller detects stale or conflicting branches and requests a merge of the latest base into the issue branch.

Rebase and force-push are not used by the automated workflow. Every integration change invalidates previous validation and review.

## Interruption policy

The package does not silently resume interrupted runs. An interrupted attempt is abandoned and a fresh attempt starts from the issue. Activity from the old attempt is retained for visibility.

## Manual issue control

The dashboard can start a specific eligible issue, temporarily skip issues from automatic claiming, manually reconcile dependencies, pause or resume claiming, and run dispatch immediately. These controls do not change the GitHub issue's authoritative implementation contents.

## Old branch handling

Old branches are never deleted automatically. Restart offers explicit keep or delete choices. Delete is limited to the branch recorded for that issue attempt, is refused when an open PR exists, and must be verified as deleted before a fresh attempt launches.

## Activity records

Attempt state contains an append-only operational timeline for dependency transitions, starts, phase changes, validation evidence, reviews, base updates, CI, terminal states, abandonment, and human-review readiness.

The control center consolidates those records across attempts for visibility and export. Local history remains diagnostic and auditable; GitHub and Git remain authoritative for repository and pull-request state.

## Validation and GitHub checks

Every issue owns its validation instructions. The package does not configure repository-wide commands or a CI workflow name; it inspects checks attached to the exact PR head.

## Human merge boundary

The controller stops at human review. It never merges or auto-merges a pull request.

## Deferred command-wrapper decisions

Windows command-wrapper changes and their regression tests are intentionally outside this controller change. They will be addressed separately.
