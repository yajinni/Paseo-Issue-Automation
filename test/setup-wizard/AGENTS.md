# Setup Wizard Test Instructions

These instructions apply to every test under `test/setup-wizard/`.

## Test style

Use Node's built-in `node:test` and strict assertions unless the repository adopts a different standard explicitly.

Prefer deterministic unit and contract tests with:

- injected command runners;
- fake clocks and stable timestamps;
- temporary directories and temporary Git repositories;
- fake credential-store implementations;
- fake GitHub, Paseo, and browser capability results;
- generated-page or client-script behavior tests for UI contracts.

Default tests must not require:

- a real Paseo daemon;
- a real GitHub login or token;
- a real operating-system keychain entry;
- a real ChatGPT account;
- a paid model request;
- an internet connection.

## Security assertions

Tests that touch connection or authentication behavior must assert that:

- passwords are absent from serialized setup state;
- passwords are absent from command arguments, logs, errors, and API responses;
- password-bearing URLs are redacted;
- tokens and browser cookies are not exposed;
- session-only fallback never writes a plaintext credential file.

Use obviously synthetic credential values and remove all temporary state during cleanup.

## Repository safety assertions

Repository/workspace tests must cover:

- normalized HTTPS and SSH remote matching;
- no whole-filesystem scanning;
- preservation of dirty user worktrees;
- refusal to stage unrelated setup files;
- exact selected-base-branch targeting;
- temporary branch/worktree cleanup verification;
- recoverable behavior when cleanup cannot be proven.

Never point tests at a developer's real repository or home-directory checkout.

## Workflow coverage

When the relevant behavior exists, include focused coverage for:

- page recheck preserving valid selections;
- one repository's state not leaking into another;
- recommended-label and all-open issue modes;
- strict lowest-issue-number scheduling;
- skipping native dependency-blocked issues without inventing hierarchy dependencies;
- quick-review exhaustion handing off rather than blocking;
- exact-SHA review and merge guards;
- ChatGPT Profile authentication expiry and recovery;
- setup completion with automation start checked and unchecked.

## Validation commands

Run the narrowest changed-area tests during development, then run:

```bash
npm run check
npm test
npm run pack:check
```

Record failures honestly. Do not replace a missing live integration test with a claim that the external service was verified.