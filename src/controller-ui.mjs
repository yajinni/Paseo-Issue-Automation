export function applyIssueExecutionControllerUi(html) {
  return String(html)
    .replace(
      '<label>Orchestrator model<input id="orchestrator" placeholder="provider/model"></label>',
      '<input id="orchestrator" type="hidden" aria-hidden="true">',
    )
    .replace(
      'The base branch creates issue branches and is also their PR target. Task-specific checks come from each issue.',
      'The deterministic Issue Execution Controller schedules dependencies, launches Coders and fresh Reviewers, and stops at human review. The base branch creates issue branches and is also their PR target.',
    )
    .replace(
      '<h2>Controller</h2>',
      '<h2>Issue Execution Controller</h2>',
    );
}
