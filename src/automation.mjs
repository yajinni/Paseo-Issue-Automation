import { LABELS, loadConfig, loadRun, loadRuntime, saveRun, saveRuntime } from './state.mjs';
import { run, runJson } from './process.mjs';

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
