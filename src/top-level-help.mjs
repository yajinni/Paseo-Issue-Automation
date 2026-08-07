export const TOP_LEVEL_HELP = `Paseo Issue Automation

Standalone manager:
  paseo-issue-automation
  paseo-issue-automation --help
  paseo-issue-automation repo list
  paseo-issue-automation repo add [PATH]
  paseo-issue-automation repo show ID|OWNER/REPO|PATH
  paseo-issue-automation repo remove ID|OWNER/REPO|PATH

Repository-scoped commands:
  paseo-issue-automation status [--repo ID|OWNER/REPO|PATH]
  paseo-issue-automation enable | disable [--repo ID|OWNER/REPO|PATH]
  paseo-issue-automation start-issue --issue N [--branch-action keep|delete] [--repo SELECTOR]
  paseo-issue-automation skip-issue --issue N [--repo SELECTOR]
  paseo-issue-automation unskip-issue --issue N [--repo SELECTOR]
  paseo-issue-automation restart --issue N [--branch-action keep|delete] [--repo SELECTOR]
  paseo-issue-automation pr-review status [--repo SELECTOR]
  paseo-issue-automation browser doctor [--repo SELECTOR]

Run paseo-issue-automation with no arguments to start the standalone manager and open its dashboard.
First run enters the standalone setup walkthrough automatically; configured managers can use Add repository via setup.
Legacy repository-local setup remains available for compatibility but is not the recommended onboarding path.
Run a repository-scoped command inside a Git repository or select a registered repository with --repo.
The standalone manager listens on 127.0.0.1:4318 by default.
`;

export function printTopLevelHelp(write = console.log) {
  write(TOP_LEVEL_HELP);
  return TOP_LEVEL_HELP;
}
