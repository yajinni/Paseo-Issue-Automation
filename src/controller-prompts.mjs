function configuredModels(config) {
  return [
    `- Coder: ${config.models.coder}`,
    `- Independent Reviewer: ${config.models.reviewer}`,
  ].join('\n');
}

export function buildCoderPrompt({ repository, issue, branch, config }) {
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
5. Create or update a draft pull request from ${branch} into ${config.baseBranch}. Include Closes #${issue.number}, changed areas, validation evidence, and unresolved concerns.
6. After validation passes for the exact PR head, record it:
   npx --no-install paseo-issue-automation record --issue ${issue.number} --event validation-summary --result PASS --commit <sha> --details '<summary>'
7. Send a heartbeat at phase transitions:
   npx --no-install paseo-issue-automation heartbeat --issue ${issue.number} --phase <phase>
8. If blocked, record the terminal state:
   npx --no-install paseo-issue-automation block --issue ${issue.number} --reason '<reason>'
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

export function buildRepairPrompt({ issueNumber, findings }) {
  return `Independent review for issue #${issueNumber} requires changes:\n\n${findings}\n\nAddress only these findings within the approved issue scope. Rerun every issue-required validation, update the existing draft PR, and record a new validation-summary event for the new exact PR head. Do not reuse the previous validation or review.`;
}

export function buildBaseUpdatePrompt({ issueNumber, baseBranch, reason }) {
  return `Issue #${issueNumber} must be updated from origin/${baseBranch} before final review. Reason: ${reason}\n\nFetch the latest base, merge origin/${baseBranch} into the issue branch, and resolve ordinary conflicts without broadening scope. Do not rebase or force-push. If the conflict requires a product or architectural decision, block the issue instead. After any code change, rerun every required validation, update the draft PR, and record a new validation-summary event for the new exact PR head.`;
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
