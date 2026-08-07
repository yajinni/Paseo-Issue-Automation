# Setup Wizard Source Instructions

These instructions apply to every file under `src/setup-wizard/`.

## Required context

Before changing setup-wizard code, read:

- `docs/SETUP_WALKTHROUGH_PLAN.md`
- `docs/SETUP_WALKTHROUGH_PLAN_ADDENDUM.md`
- `docs/SETUP_WALKTHROUGH_FINAL_REVIEW_DEFAULTS.md`
- `docs/SETUP_WALKTHROUGH_IMPLEMENTATION_PLAN.md`

Treat the approved product decisions in those files as requirements. Do not reopen settled choices unless the current implementation exposes a material contradiction that cannot be resolved safely.

## Architecture boundary

The setup walkthrough belongs to the standalone multi-repository manager. Do not add another walkthrough to the legacy repository-local dashboard or extend the legacy setup experience through additional DOM string replacement.

Keep these concerns separate:

- schema and validation;
- resumable wizard state;
- external capability adapters for Paseo and GitHub;
- secure credential storage;
- repository checkout and Paseo workspace handling;
- readiness orchestration;
- manager API routes;
- server-rendered wizard shell and page-specific client behavior.

A UI page must call a typed server API. It must not execute Git, GitHub CLI, Paseo, filesystem, credential-store, or browser commands directly.

## State and repository isolation

- Machine-level setup progress must remain outside managed repositories.
- Repository configuration and existing controller history must stay isolated by registered repository root.
- Never use a prior or currently selected repository as an implicit fallback for another repository.
- Rechecking one page may invalidate only selections that depend on the changed capability.
- Persist no secret, token, password, ChatGPT cookie, or browser credential in wizard JSON.
- Keep the Paseo daemon host separate from its password.

## Security and privacy

- Never place the Paseo password in a URL, command argument, log, diagnostic, API response, browser storage, or ordinary config file.
- Pass secrets to child processes only through the approved isolated environment and redact every error path.
- Never expose GitHub tokens.
- Never automate the user's normal Chrome profile. Use the package-managed ChatGPT Profile only.
- Do not scan the whole filesystem for repositories. Search only explicitly approved roots.
- Do not reset, clean, switch, delete, or otherwise modify a dirty user checkout to make setup pass.
- Do not send a paid model request during normal discovery or readiness checks.
- Do not create fake issues, fake reviews, or application-code changes for setup testing.

## External command adapters

Wrap external commands behind small functions with injected runners. Return structured results containing:

- success/failure state;
- stable reason or blocker code;
- safe user-facing message;
- redacted technical details;
- recovery actions when known.

Do not make UI code parse arbitrary stderr. Do not treat command exit success alone as proof that the intended state exists; verify the resulting state when practical.

## Progressive walkthrough behavior

- Each page performs its own initial check.
- Each page exposes a page-level Recheck action.
- Preserve still-valid selections after recheck.
- Keep technical details collapsed unless required for recovery.
- Continue is allowed only when the page's requirements and confirmations pass.
- A failed later page must not erase completed earlier pages.
- Setup can be rerun for another repository.

## Change discipline

- Prefer one setup concern per pull request.
- Avoid unrelated cleanup in legacy setup, manager, installation, scheduler, or PR-review modules.
- When a shared module must change, document every affected route, worker, state format, and migration path.
- Preserve compatibility until a dedicated migration PR removes it.
- Never make direct repository-file changes when the approved workflow requires a reviewed setup PR.

## Required validation

For every code change, run focused tests for the changed setup area plus:

```bash
npm run check
npm test
npm run pack:check
```

Do not claim any command passed unless it ran on the exact commit. Preserve Windows command-shim and clean packed-install coverage.

## Stop conditions

Stop and surface the blocker instead of guessing when:

- the installed Paseo CLI does not expose the required host/auth/capability contract;
- a secure credential backend would require plaintext persistence;
- a repository or branch lacks required permissions;
- local clone identity is ambiguous;
- a worktree or setup-PR cleanup cannot be proven safe;
- existing installation state cannot be migrated without risking active work or user-owned resources;
- an approved walkthrough decision conflicts materially with current platform behavior.