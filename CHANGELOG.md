# Changelog

## 0.1.0 - Unreleased

- Replace the per-issue Orchestrator AI with a deterministic Issue Execution Controller.
- Use native GitHub issue relationships as the exclusive dependency source; dependency-like issue-body text is ignored.
- Reconcile blocked issues automatically and unlock them only after prerequisite implementation reaches the configured base branch.
- Launch Coders directly, run fresh structured Reviewer sessions, and return review or CI findings to the same Coder.
- Post every Reviewer approval or changes-required verdict to the draft PR with the exact reviewed commit, review round, and findings.
- Require merge-based base updates, exact-commit revalidation, and human-only final merging.
- Add dependency-cycle and execution-wave validation.
- Replace the injected setup dashboard extensions with a unified responsive control center for overview, issue execution, dependency waves, activity, settings, and maintenance.
- Add a human-review inbox, controller health and capacity, last/next polling details, rich issue dialogs, PR and CI visibility, exact validation/review evidence, Reviewer findings, base freshness, and consolidated activity export.
- Separate destructive maintenance from normal operations and use explicit or typed-confirmation dialogs for risky actions.
- Preserve guided setup, reversible installation, manual issue controls, fresh-attempt restarts, activity history, and package release checks.
