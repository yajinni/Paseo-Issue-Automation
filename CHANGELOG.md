# Changelog

## 0.1.0 - Unreleased

- Replace the per-issue Orchestrator AI with a deterministic Issue Execution Controller.
- Use native GitHub issue relationships as the exclusive dependency source; dependency-like issue-body text is ignored.
- Reconcile blocked issues automatically and unlock them only after prerequisite implementation reaches the configured base branch.
- Launch Coders directly, run fresh structured Reviewer sessions, and return review or CI findings to the same Coder.
- Require merge-based base updates, exact-commit revalidation, and human-only final merging.
- Add dependency-cycle and execution-wave validation.
- Guided setup, reversible installation, manual issue controls, fresh-attempt restarts, activity history, and package release checks.
