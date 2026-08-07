# Optional live integration tests

Default CI is deliberately deterministic and offline with respect to paid models and ChatGPT. It uses synthetic credentials, fake command adapters, temporary Git repositories, and local HTTP tests. It must not sign in to a real ChatGPT account, send a model prompt, mutate a real repository, or consume a paid provider request.

Before a release that changes external-service behavior, an operator may separately run the checks below against a disposable GitHub repository and non-production Paseo workspace. These checks are manual/opt-in and are **not** a required default CI job.

## Safety requirements

Use a disposable repository that contains no secrets or production data. Do not paste tokens/passwords into logs or issue bodies. Keep the manager bound to localhost. Confirm the selected GitHub account and repository before every mutation. Stop if a preview names an unexpected repository, base branch, file, label, workspace, or pull request.

## Suggested live matrix

1. Start `paseo-issue-automation` outside a Git repository and verify first-run redirect to the standalone walkthrough.
2. Verify Paseo auto-detection. If the test daemon requires a password, verify wrong-password recovery and secure/session-only credential behavior.
3. Verify Provider/Coding Harness discovery, independent coding/review model choices, thinking levels, and a legitimate no-model harness when available.
4. Verify GitHub account switching, paginated repository discovery, branch discovery, and the selected account's effective capabilities.
5. Verify one safe existing clone, multiple safe clones requiring selection, a dirty clone that remains untouched, and a manager-owned clone.
6. Verify permanent workspace reuse/create and temporary worktree probe cleanup.
7. Verify Recommended labels and All open issues against disposable issues, including a lower-number issue blocked by a native GitHub dependency.
8. Correct an intentionally invalid disposable issue and verify it re-enters eligibility without deleting its history.
9. Exercise one temporary-failure retry path with a controlled disposable failure rather than an uncontrolled network interruption.
10. Verify Quick → Manual. If ChatGPT Profile testing is approved for the account, separately verify Quick → Web ChatGPT and session-expiry recovery. Do not share the ChatGPT profile with ordinary browsing.
11. Verify setup-PR auto-merge both where repository policy permits it and where policy leaves the PR pending for manual completion.
12. Verify normal coding-PR auto-merge enabled/disabled against repository protections without bypass flags.
13. Verify Finish setup with immediate automation both checked and unchecked.
14. On a disposable legacy fixture, preview existing-install migration before Apply and verify active state/history is not duplicated or restarted.

## Evidence to retain

Record the package commit SHA, OS, Node version, Paseo CLI/daemon versions, GitHub CLI version, selected review workflow, and pass/fail outcome. Retain PR/issue numbers only for the disposable repository. Do not retain passwords, tokens, cookies, Authorization headers, browser storage, or copied ChatGPT session data.

Any live failure should be reproduced with a deterministic fake-backed regression test before changing default CI. A live test result alone is not sufficient evidence to weaken a fail-closed check.
