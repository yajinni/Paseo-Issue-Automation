# Design decisions

## Package boundary

This package coordinates GitHub issue coding through Paseo. It does not own Paseo's generic worktree setup or teardown behavior and does not require any repository-instruction filename.

## Permanent workspace

The installer creates one local Paseo workspace titled exactly `Issue Coding Automation`. Issue implementation workspaces remain Paseo-managed worktree workspaces.

## Branch configuration

Setup asks for one base branch. Each issue branch is created from that branch and its pull request targets the same branch.

## Reviewer isolation

Coder and Reviewer may use the same provider and model. Independence means the Reviewer is launched as a fresh session with no shared chat history or working context from the Coder.

## Controller simplicity

The package does not add controller locks or coordinate multiple simultaneously running controllers.

## Interruption policy

The package does not reconcile or resume interrupted runs. An interrupted attempt is abandoned and a fresh attempt starts from the issue. Activity from the old attempt is retained only for visibility.

## Manual issue control

The dashboard can start a specific ready issue and temporarily skip issues from automatic claiming. This does not change the GitHub issue's authoritative contents.

## Old branch handling

Old branches are never deleted automatically. Restart offers explicit keep or delete choices. Delete is limited to the branch recorded for that issue attempt, is refused when an open PR exists, and must be verified as deleted before a fresh attempt launches.

## Activity records

Attempt state contains an append-only operational timeline for starts, phase changes, validation evidence, reviews, terminal states, abandonment, and human-review readiness. It is diagnostic visibility, not recovery state.

## Validation and GitHub checks

Every issue owns its validation instructions. The package does not configure repository-wide commands or a CI workflow name; it inspects checks attached to the exact PR head.
