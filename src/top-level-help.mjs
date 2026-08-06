export const TOP_LEVEL_HELP = `Paseo Issue Automation

Standalone manager:
  paseo-issue-automation manager [--open]
  paseo-issue-automation repo list
  paseo-issue-automation repo add [PATH]
  paseo-issue-automation repo show ID|OWNER/REPO|PATH
  paseo-issue-automation repo remove ID|OWNER/REPO|PATH

Repository-scoped commands:
  paseo-issue-automation status [--repo ID|OWNER/REPO|PATH]
  paseo-issue-automation setup [--repo ID|OWNER/REPO|PATH]
  paseo-issue-automation enable | disable [--repo ID|OWNER/REPO|PATH]
  paseo-issue-automation start-issue --issue N [--branch-action keep|delete] [--repo SELECTOR]
  paseo-issue-automation skip-issue --issue N [--repo SELECTOR]
  paseo-issue-automation unskip-issue --issue N [--repo SELECTOR]
  paseo-issue-automation restart --issue N [--branch-action keep|delete] [--repo SELECTOR]
  paseo-issue-automation pr-review status [--repo SELECTOR]
  paseo-issue-automation browser doctor [--repo SELECTOR]

Run a repository-scoped command inside a Git repository or select a registered repository with --repo.
The standalone manager listens on 127.0.0.1:4318 by default.
`;

export function printTopLevelHelp(write = console.log) {
  write(TOP_LEVEL_HELP);
  return TOP_LEVEL_HELP;
}
