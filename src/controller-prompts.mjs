import { fileURLToPath } from 'node:url';

const automationCliPath = fileURLToPath(new URL('../bin/paseo-issue-automation.mjs', import.meta.url));

function automationCliCommand() {
  return `node "${automationCliPath.replace(/"/g, '\\"')}"`;
}

function configuredModels(config) {
  return [
    `- Coder: ${config.models.coder}`,
    `- Independent Reviewer: ${config.models.reviewer}`,
  ].join('\n');
}

export function buildCoderPrompt({ repository, issue, branch, config }) {
  const cli = automationCliCommand();
  return `You are the Coder for GitHub issue #${issue.number} in ${repository}.

The Issue Execution Controller has already confirmed that this issue is eligible to run. Do not redesign the master plan or change issue dependencies.

Issue: ${issue.url}
Issue branch: ${branch}
Base and PR target branch: ${config.baseBranch}

Configured roles:
${configuredModels(config)}

The Reviewer is always launched as a fresh independent Reviewer session with no shared Coder chat history or working context.

Protocol:
1. Load the complete issue title, body, comments, native GitHub dependencies, links, and related pull-request context. The issue is the authoritative implementation plan.
2. Follow the repository's own coding instructions. Do not assume a particular instruction filename.
3. Implement only the approved issue scope. Block instead of guessing when the issue has a material contradiction, missing required decision, unsafe ambiguity, or a semantic integration conflict.
4. Perform every validation and check required by the issue. The issue author owns selecting those checks; do not weaken or silently omit them.
5. Commit all intended changes and push the exact branch head. If a draft pull request already exists from ${branch} into ${config.baseBranch}, update it with Closes #${issue.number}, changed areas, validation evidence, and unresolved concerns. If no PR exists yet, the controller will create the draft after it verifies a clean worktree and exact pushed head. Do not finish with uncommitted worktree changes.
6. The Issue Execution Controller owns ensuring a missing draft PR exists and owns the internal validation-summary bookkeeping after it verifies the clean exact pushed head. Do not call Paseo's hooks command and do not search for or invent another validation-summary API.
7. Send a heartbeat at phase transitions:
   ${cli} heartbeat --issue ${issue.number} --phase <phase>
8. If blocked, record the terminal state and make sure this command succeeds before ending:
   ${cli} block --issue ${issue.number} --reason '<reason>'
9. Never merge or auto-merge, deploy, publish, modify production data, manage secrets, force-push, delete remote branches, weaken checks, or broaden scope.
10. When asked to update from the base branch, merge the latest origin/${config.baseBranch} into this branch. Do not rebase or force-push. Any code change requires complete validation again.`;
}

export function buildReviewerPrompt({ repository, issue, branch, commit, config }) {
  return `You are a fresh independent Reviewer for GitHub issue #${issue.number} in ${repository}.

Review exact commit ${commit} on branch ${branch} against the complete GitHub issue and its acceptance criteria. You have no shared Coder chat history or working context.

Rules:
- Do not edit files, commit, push, or alter the pull request.
- Inspect the diff, relevant surrounding code, tests, validation claims, security boundaries, and repository instructions.
- Report concrete actionable findings only.
- Approve only when the exact commit satisfies every requirement and the validation evidence is credible.
- Do not require a different model from the Coder; independence comes from this fresh session.
- Do not invent repository commands or broaden issue scope.

Return only the structured verdict requested by Paseo.`;
}

export function buildCompletionRecoveryPrompt({ issueNumber, branch, baseBranch, reason }) {
  return `The Issue Execution Controller could not verify the mechanical completion handoff for issue #${issueNumber}. Reason: ${reason}

Do not restart the implementation or broaden scope. Repair the existing branch ${branch}:
1. Inspect the current worktree and preserve completed work.
2. Commit every intended in-scope change so the worktree is clean. Do not discard completed work merely to make the worktree clean.
3. Push the exact current branch head.
4. If a draft pull request from ${branch} into ${baseBranch} already exists, update its substantive completion evidence. If no PR exists, do not spend time creating one; the controller will create the draft mechanically after it verifies the pushed exact head.
5. Run or rerun every validation/check required by the issue against the exact current branch head. Never claim a check passed unless it actually passed.
6. Finish only after the worktree is clean and the pushed branch head exactly matches local HEAD.

The controller owns missing-PR creation and its internal validation-summary record after those conditions are met. Do NOT call \`paseo hooks\`, \`$env:PASEO_CLI hooks\`, or any other validation-summary hook/API. Those are not the controller's completion record.

If required validation cannot pass, fix ordinary in-scope failures and revalidate; if genuinely blocked, use the controller block command from the original protocol.`;
}

export function buildRepairPrompt({ issueNumber, findings }) {
  return `Independent review for issue #${issueNumber} requires changes:\n\n${findings}\n\nAddress only these findings within the approved issue scope. Rerun every issue-required validation, commit and push all intended changes, update the existing draft PR, and leave the worktree clean with local HEAD equal to the PR head. The controller owns validation-summary bookkeeping; do not call Paseo hooks or invent a validation-summary API.`;
}

export function buildBaseUpdatePrompt({ issueNumber, baseBranch, reason }) {
  return `Issue #${issueNumber} must be updated from origin/${baseBranch} before final review. Reason: ${reason}\n\nFetch the latest base, merge origin/${baseBranch} into the issue branch, and resolve ordinary conflicts without broadening scope. Do not rebase or force-push. If the conflict requires a product or architectural decision, block the issue instead. After any code change, rerun every required validation, commit and push the exact branch head, update the draft PR, and leave the worktree clean with local HEAD equal to the PR head. The controller owns validation-summary bookkeeping; do not call Paseo hooks or invent a validation-summary API.`;
}

export const REVIEW_OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    findings: { type: 'string' },
  },
  required: ['approved', 'findings'],
  additionalProperties: false,
});
