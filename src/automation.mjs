import { LABELS, loadConfig, loadRun, loadRuntime, saveRun, saveRuntime } from './state.mjs';
import { findFirstKey, run, runJson } from './process.mjs';

const REQUIRED_SECTIONS = [
  'Objective',
  'Required behavior',
  'Acceptance criteria',
  'Validation and checks',
  'Stop conditions',
];

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

export function sectionContent(body, heading) {
  const text = String(body || '');
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  const target = headings.findIndex((match) => match[1].trim().toLowerCase() === heading.toLowerCase());
  if (target < 0) return '';
  const start = headings[target].index + headings[target][0].length;
  const end = headings[target + 1]?.index ?? text.length;
  return text.slice(start, end).trim();
}

function meaningfulSectionContent(content) {
  return String(content || '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*- \[ \]\s*$/gm, '')
    .trim();
}

export function validateIssueBody(body) {
  const missing = REQUIRED_SECTIONS.filter((heading) => {
    const content = meaningfulSectionContent(sectionContent(body, heading));
    return !content || /^(?:none|n\/a|todo|tbd)$/i.test(content);
  });
  return {
    ok: missing.length === 0,
    missing,
    reason: missing.length
      ? `Missing meaningful issue sections: ${missing.join(', ')}.`
      : null,
  };
}

export function parseDependencies(body) {
  const dependencies = new Set();
  const pattern = /^(?:Blocked by|Depends on)\s+#(\d+)\s*$/gim;
  let match;
  while ((match = pattern.exec(String(body || '')))) dependencies.add(Number(match[1]));
  return [...dependencies];
}

function labelNames(issue) {
  return new Set((issue.labels || []).map((label) => typeof label === 'string' ? label : label.name));
}

function editLabels(root, issueNumber, { add = [], remove = [] }) {
  const args = ['issue', 'edit', String(issueNumber)];
  for (const label of add) args.push('--add-label', label);
  for (const label of remove) args.push('--remove-label', label);
  run('gh', args, { cwd: root });
}

function issueList(root, label) {
  return runJson('gh', [
    'issue', 'list', '--state', 'open', '--limit', '100', '--label', label,
    '--json', 'number,title,body,labels,state,url,createdAt',
  ], { cwd: root }) || [];
}

function dependenciesClosed(root, body) {
  for (const number of parseDependencies(body)) {
    const dependency = runJson('gh', ['issue', 'view', String(number), '--json', 'number,state,url'], {
      cwd: root,
      allowFailure: true,
    });
    if (!dependency) return { ok: false, reason: `Dependency #${number} could not be retrieved.` };
    if (dependency.state !== 'CLOSED') return { ok: false, reason: `Blocked by open issue #${number}.` };
  }
  return { ok: true };
}

function branchExists(root, branch) {
  const local = run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  });
  if (local.ok) return true;
  return run('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true,
  }).ok;
}

function configuredModels(config) {
  return [
    `- Orchestrator: ${config.models.orchestrator}`,
    `- Coder: ${config.models.coder}`,
    `- Independent Reviewer: ${config.models.reviewer}`,
  ].join('\n');
}

export function buildOrchestratorPrompt({ repository, issue, branch, config }) {
  return `You are the thin Orchestrator for GitHub issue #${issue.number} in ${repository}.

The coding harness is responsible for loading and following this repository's own coding instructions. Do not assume any particular repository instruction filename or format.

Issue: ${issue.url}
Issue branch: ${branch}
Base and PR target branch: ${config.baseBranch}

Configured roles:
${configuredModels(config)}

Automation protocol:
1. The complete GitHub issue is the authoritative implementation plan. Load its title, body, comments, dependencies, links, and related pull-request context.
2. Do not add a Planner role and do not replace the issue with a new plan. Block only for a material contradiction, missing required decision, unsafe ambiguity, or unresolved dependency.
3. Stay in the Orchestrator role. Launch exactly one Coder using ${config.models.coder} and a fresh independent Reviewer using ${config.models.reviewer}. Never silently substitute models.${config.requireDifferentCoderReviewer ? ' The Coder and Reviewer must use different model selections.' : ''}
4. The same Coder owns implementation and all repair loops, including issue-defined validation failures, Reviewer findings, and code-related GitHub check failures.
5. The Coder must perform every validation and check required by the issue. The issue author owns selecting those checks. The automation does not invent repository commands.
6. After all issue-defined validation passes on an exact commit, record one validation summary:
   npx --no-install paseo-issue-automation record --issue ${issue.number} --event validation-summary --result PASS --commit <sha> --details '<summary>'
7. Launch a fresh independent Reviewer for that exact commit. The Reviewer must not edit. It checks every requirement, acceptance criterion, and validation claim. Record the result:
   npx --no-install paseo-issue-automation record --issue ${issue.number} --event review --result APPROVED|CHANGES_REQUIRED --commit <sha> --details '<findings>'
8. Reviewer findings return to the same Coder. Any code change invalidates prior validation and review. Repeat for at most ${config.maxReviewRounds} completed review rounds.
9. Push only an exact validated and approved commit. Open or update a draft PR from ${branch} into ${config.baseBranch}. Include Closes #${issue.number}, changed areas, issue-defined validation evidence, and unresolved concerns.
10. Inspect all GitHub checks attached to the exact PR head. Every reported required check must finish successfully. Do not assume a workflow name. Code failures return to the same Coder; external infrastructure failures block the issue.
11. Send a heartbeat at least every five minutes and at phase transitions:
   npx --no-install paseo-issue-automation heartbeat --issue ${issue.number} --phase <phase>
12. Use only these terminal transitions:
   npx --no-install paseo-issue-automation human-review --issue ${issue.number} --pr <number>
   npx --no-install paseo-issue-automation block --issue ${issue.number} --reason '<reason>'
   npx --no-install paseo-issue-automation fail --issue ${issue.number} --reason '<reason>'
13. Never merge or auto-merge, deploy, publish, modify production data, manage secrets, force-push, delete remote branches, weaken checks, or broaden scope.

When the PR is ready, your final message must be exactly:
NEEDS HUMAN REVIEW FOR PR #<number>`;
}

function parsePaseoIdentifiers(payload) {
  return {
    agentId: findFirstKey(payload, ['agentId', 'agent_id', 'id']),
    workspaceId: findFirstKey(payload, ['workspaceId', 'workspace_id']),
    worktreePath: findFirstKey(payload, ['worktreePath', 'worktree_path', 'cwd', 'path']),
  };
}

function blockIssue(root, issue, reason) {
  editLabels(root, issue.number, {
    add: [LABELS.blocked],
    remove: [LABELS.ready, LABELS.running, LABELS.failed, LABELS.humanReview],
  });
  run('gh', ['issue', 'comment', String(issue.number), '--body', `Automation blocked: ${reason}`], { cwd: root });
  saveRun(root, issue.number, {
    issueNumber: issue.number,
    status: LABELS.blocked,
    reason,
    updatedAt: new Date().toISOString(),
  });
}

export function dispatchOnce(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  if (!config.setupComplete) return { claimed: false, reason: 'Setup is not complete.' };
  if (!runtime.claimsEnabled) return { claimed: false, reason: 'Claims are paused.' };

  const active = issueList(root, LABELS.running).length;
  if (active >= config.maxActive) return { claimed: false, reason: 'Maximum active issue count reached.' };

  const candidates = issueList(root, LABELS.ready)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.number - b.number);

  for (const issue of candidates) {
    const labels = labelNames(issue);
    if ([LABELS.running, LABELS.blocked, LABELS.failed, LABELS.humanReview].some((label) => labels.has(label))) continue;

    const bodyValidation = validateIssueBody(issue.body);
    if (!bodyValidation.ok) {
      blockIssue(root, issue, bodyValidation.reason);
      continue;
    }
    const dependencyCheck = dependenciesClosed(root, issue.body);
    if (!dependencyCheck.ok) continue;

    const branch = `ai/issue-${issue.number}-${slugify(issue.title)}`;
    if (branchExists(root, branch) && !loadRun(root, issue.number)) {
      blockIssue(root, issue, `Branch ${branch} already exists without recoverable automation state.`);
      continue;
    }

    const repository = runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root })?.nameWithOwner;
    if (!repository) throw new Error('Could not determine the GitHub repository.');
    const prompt = buildOrchestratorPrompt({ repository, issue, branch, config });

    editLabels(root, issue.number, {
      add: [LABELS.running],
      remove: [LABELS.ready, LABELS.blocked, LABELS.failed, LABELS.humanReview],
    });

    const launched = runJson('paseo', [
      'run', '--background', '--json',
      '--provider', config.models.orchestrator,
      '--title', `Issue #${issue.number} Orchestrator`,
      '--new-workspace', 'worktree',
      '--worktree-mode', 'branch-off',
      '--new-branch', branch,
      '--base', config.baseBranch,
      prompt,
    ], { cwd: root });
    const identifiers = parsePaseoIdentifiers(launched || {});
    if (!identifiers.agentId) {
      editLabels(root, issue.number, { add: [LABELS.failed], remove: [LABELS.running] });
      throw new Error(`Paseo did not return an agent ID for issue #${issue.number}.`);
    }

    const state = saveRun(root, issue.number, {
      issueNumber: issue.number,
      issueUrl: issue.url,
      branch,
      status: LABELS.running,
      phase: 'orchestrating',
      agentId: identifiers.agentId,
      workspaceId: identifiers.workspaceId,
      worktreePath: identifiers.worktreePath,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      events: [],
    });
    return { claimed: true, issueNumber: issue.number, branch, state };
  }

  return { claimed: false, reason: 'No eligible ready issue found.' };
}

export function updateRuntimeAfterDispatch(root, result) {
  const runtime = loadRuntime(root);
  return saveRuntime(root, {
    ...runtime,
    lastDispatchAt: new Date().toISOString(),
    lastDispatchResult: result,
  });
}

export function setClaimsEnabled(root, enabled) {
  return saveRuntime(root, { ...loadRuntime(root), claimsEnabled: enabled });
}

function requireRun(root, issueNumber) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  return state;
}

export function recordEvent(root, issueNumber, event) {
  const state = requireRun(root, issueNumber);
  if (event.event === 'review') {
    const completedRounds = (state.events || []).filter((item) => item.event === 'review').length;
    const maximum = loadConfig(root).maxReviewRounds;
    if (completedRounds >= maximum) throw new Error(`Maximum review rounds (${maximum}) reached.`);
  }
  const next = {
    ...state,
    events: [...(state.events || []), { ...event, at: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
  return saveRun(root, issueNumber, next);
}

export function heartbeat(root, issueNumber, phase) {
  const state = requireRun(root, issueNumber);
  return saveRun(root, issueNumber, {
    ...state,
    phase: String(phase || state.phase || 'running'),
    heartbeatAt: new Date().toISOString(),
  });
}

function prChecksPass(root, prNumber, commit) {
  const pr = runJson('gh', [
    'pr', 'view', String(prNumber),
    '--json', 'number,isDraft,headRefOid,baseRefName,statusCheckRollup,url',
  ], { cwd: root });
  if (!pr || pr.headRefOid !== commit) throw new Error('The PR head does not match the approved commit.');
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failed = checks.filter((check) => {
    const state = String(check.conclusion || check.state || check.status || '').toUpperCase();
    return ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state);
  });
  const pending = checks.filter((check) => {
    const state = String(check.conclusion || check.state || check.status || '').toUpperCase();
    return !state || ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING'].includes(state);
  });
  if (failed.length) throw new Error('One or more GitHub checks failed on the approved commit.');
  if (pending.length) throw new Error('One or more GitHub checks are still pending on the approved commit.');
  return pr;
}

export function markHumanReview(root, issueNumber, prNumber) {
  const config = loadConfig(root);
  const state = requireRun(root, issueNumber);
  const validations = (state.events || []).filter((event) => event.event === 'validation-summary' && event.result === 'PASS');
  const reviews = (state.events || []).filter((event) => event.event === 'review' && event.result === 'APPROVED');
  const validation = validations.at(-1);
  const review = reviews.at(-1);
  if (!validation?.commit || validation.commit !== review?.commit) {
    throw new Error('Human review requires matching PASS validation and APPROVED review events for one exact commit.');
  }
  const pr = prChecksPass(root, prNumber, validation.commit);
  if (pr.baseRefName !== config.baseBranch) throw new Error(`PR must target ${config.baseBranch}.`);

  editLabels(root, issueNumber, {
    add: [LABELS.humanReview],
    remove: [LABELS.running, LABELS.ready, LABELS.blocked, LABELS.failed],
  });
  run('gh', ['issue', 'comment', String(issueNumber), '--body', `NEEDS HUMAN REVIEW FOR PR #${prNumber}`], {
    cwd: root,
  });
  return saveRun(root, issueNumber, {
    ...state,
    status: LABELS.humanReview,
    phase: 'human-review',
    prNumber: Number(prNumber),
    approvedCommit: validation.commit,
    completedAt: new Date().toISOString(),
  });
}

export function terminalState(root, issueNumber, status, reason) {
  const state = requireRun(root, issueNumber);
  const label = status === 'blocked' ? LABELS.blocked : LABELS.failed;
  editLabels(root, issueNumber, {
    add: [label],
    remove: [LABELS.running, LABELS.ready, LABELS.humanReview, status === 'blocked' ? LABELS.failed : LABELS.blocked],
  });
  run('gh', ['issue', 'comment', String(issueNumber), '--body', `Automation ${status}: ${reason}`], { cwd: root });
  return saveRun(root, issueNumber, {
    ...state,
    status: label,
    phase: status,
    reason,
    completedAt: new Date().toISOString(),
  });
}

export function automationStatus(root) {
  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  const counts = {};
  for (const [name, label] of Object.entries(LABELS)) counts[name] = issueList(root, label).length;
  return { config, runtime, counts };
}
