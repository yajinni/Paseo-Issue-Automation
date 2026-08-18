import { loadConfig } from './state.mjs';
import { runJson } from './process.mjs';
import { managedPrSnapshot, PR_REVIEW_LABELS, ensurePrReviewLabels, setPrReviewLabels } from './pr-review-github.mjs';
import {
  appendHistory,
  findManaged,
  loadPrReviewStore,
  managedPullRequestId,
  mutatePrReviewStore,
  nowIso,
  transitionManaged,
} from './pr-review-store.mjs';
import { enqueueManagedReview, registerManagedPullRequest } from './pr-review-queue.mjs';
import {
  createHarnessReviewEvent,
  nextReviewRound,
  reviewStageDecision,
} from './harness-review-stages.mjs';
import {
  REVIEW_STAGES,
  REVIEW_WORKFLOW_OUTPUT_SCHEMA,
  REVIEW_WORKFLOW_PROMPT_VERSION,
  renderReviewWorkflowPrompt,
} from './review-workflow-prompts.mjs';
import { queueWebChatGptFullReview } from './web-chatgpt-full-review.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY_SELECTOR = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
  return number;
}

export function repositoryIdentity(value) {
  const match = text(value).match(REPOSITORY_SELECTOR);
  if (!match) throw new Error('Repository must use the OWNER/REPOSITORY form.');
  return `${match[1]}/${match[2]}`.toLowerCase();
}

function repositoryFromSnapshot(value) {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object') return '';
  if (value.nameWithOwner) return text(value.nameWithOwner);
  if (value.repository) return repositoryFromSnapshot(value.repository);
  const owner = text(value.owner?.login || value.owner?.name || value.owner?.loginName);
  const name = text(value.name);
  return owner && name ? `${owner}/${name}` : '';
}

function repositoryFromIssueSnapshot(issue) {
  const direct = repositoryFromSnapshot(issue?.repository);
  if (direct) return direct;
  for (const value of [issue?.repository_url, issue?.html_url]) {
    const match = text(value).match(/\/repos\/([^/]+\/[^/]+)(?:\/|$)/i)
      || text(value).match(/github\.com\/([^/]+\/[^/]+)(?:\/|$)/i);
    if (match) return match[1];
  }
  return '';
}

export function parseManagedPullRequestId(value) {
  const match = text(value).match(/^(.+)#([1-9][0-9]*)$/);
  if (!match) throw new Error('Pull request identity must use OWNER/REPOSITORY#PR form.');
  return {
    repository: repositoryIdentity(match[1]),
    pullRequestNumber: positiveInteger(match[2], 'Pull request number'),
  };
}

function defaultRepositoryReader(root) {
  return runJson('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: root, allowFailure: true });
}

function defaultIssueReader(root, repository, issueNumber) {
  return runJson('gh', ['api', `repos/${repository}/issues/${issueNumber}`], { cwd: root, allowFailure: true });
}

function issueReferences(pr, repository) {
  const references = Array.isArray(pr?.closingIssuesReferences) ? pr.closingIssuesReferences : [];
  return references.map((reference) => {
    const number = positiveInteger(reference?.number, 'Associated issue number');
    const referenceRepository = repositoryFromSnapshot(reference?.repository);
    if (!referenceRepository || repositoryIdentity(referenceRepository) !== repository) {
      throw new Error(`Pull request #${pr.number} has an associated issue outside ${repository}.`);
    }
    return number;
  });
}

function selectIssueNumber(pr, repository, requestedIssueNumber) {
  const references = issueReferences(pr, repository);
  if (requestedIssueNumber !== undefined && requestedIssueNumber !== null && requestedIssueNumber !== '') {
    const issueNumber = positiveInteger(requestedIssueNumber, 'Issue number');
    if (references.length && !references.includes(issueNumber)) {
      throw new Error(`Pull request #${pr.number} is associated with issue(s) #${references.join(', #')}, not #${issueNumber}.`);
    }
    return { issueNumber, inferred: false };
  }
  const unique = [...new Set(references)];
  if (unique.length === 1) return { issueNumber: unique[0], inferred: true };
  if (!unique.length) throw new Error('The pull request has no safely provable associated issue; pass --issue explicitly.');
  throw new Error(`The pull request has multiple associated issues (#${unique.join(', #')}); pass --issue explicitly.`);
}

function validatePullRequest(pr, repository, pullRequestNumber, baseBranch, expectedHeadSha) {
  if (!pr || Number(pr.number) !== pullRequestNumber) throw new Error(`Pull request #${pullRequestNumber} could not be read from ${repository}.`);
  if (String(pr.state).toUpperCase() !== 'OPEN') throw new Error(`Pull request #${pullRequestNumber} is not open.`);
  if (pr.isCrossRepository !== false) throw new Error(`Pull request #${pullRequestNumber} is not proven to be from ${repository}. Fork pull requests cannot be imported.`);
  const headRepository = repositoryFromSnapshot(pr.headRepository);
  if (!headRepository || repositoryIdentity(headRepository) !== repository) {
    throw new Error(`Pull request #${pullRequestNumber} head repository does not match ${repository}.`);
  }
  if (text(pr.baseRefName) !== baseBranch) throw new Error(`Pull request #${pullRequestNumber} targets ${text(pr.baseRefName) || '(missing)'}, not configured base ${baseBranch}.`);
  const headSha = text(pr.headRefOid).toLowerCase();
  if (!FULL_SHA.test(headSha)) throw new Error(`Pull request #${pullRequestNumber} has missing or stale current head SHA evidence.`);
  const headBranch = text(pr.headRefName);
  if (!headBranch) throw new Error(`Pull request #${pullRequestNumber} has no current head branch evidence.`);
  if (expectedHeadSha && expectedHeadSha.toLowerCase() !== headSha) {
    throw new Error(`Pull request #${pullRequestNumber} head ${headSha} does not match the requested exact head ${expectedHeadSha}.`);
  }
  if (!text(pr.url)) throw new Error(`Pull request #${pullRequestNumber} has no canonical GitHub URL.`);
  return { headSha, headBranch };
}

function validateAssociatedIssue(issue, repository, issueNumber) {
  if (!issue || Number(issue.number) !== issueNumber) throw new Error(`Associated issue #${issueNumber} could not be read from the configured repository.`);
  if (issue.pull_request) throw new Error(`#${issueNumber} is a pull request, not an associated issue.`);
  const issueRepository = repositoryFromIssueSnapshot(issue);
  if (issueRepository && repositoryIdentity(issueRepository) !== repository) {
    throw new Error(`Associated issue #${issueNumber} is outside ${repository}.`);
  }
}

function existingConflict(store, repository, issueNumber, managedId) {
  return store.managedPullRequests.find((record) => (
    record.id !== managedId
      && text(record.repository).toLowerCase() === repository
      && Number(record.issueNumber) === issueNumber
  )) || null;
}

export function importManagedPullRequest(root, input = {}, options = {}) {
  const parsed = input.id ? parseManagedPullRequestId(input.id) : {
    repository: repositoryIdentity(input.repository),
    pullRequestNumber: positiveInteger(input.pullRequestNumber, 'Pull request number'),
  };
  if (input.pullRequestNumber !== undefined && Number(input.pullRequestNumber) !== parsed.pullRequestNumber) {
    throw new Error('The pull request identity and pullRequestNumber do not match.');
  }

  const configuredRepository = repositoryIdentity(
    input.repository || repositoryFromSnapshot((options.repositoryReader || defaultRepositoryReader)(root)),
  );
  if (parsed.repository !== configuredRepository) {
    throw new Error(`Unsupported repository selector ${parsed.repository}; this controller is scoped to ${configuredRepository}.`);
  }

  const config = (options.configLoader || loadConfig)(root);
  const baseBranch = text(config.baseBranch);
  if (!baseBranch) throw new Error('A configured base branch is required before importing a pull request.');

  const pr = (options.prReader || managedPrSnapshot)(root, parsed.pullRequestNumber);
  const expectedHeadSha = input.headSha || input.head ? text(input.headSha || input.head) : null;
  if (expectedHeadSha && !FULL_SHA.test(expectedHeadSha)) throw new Error('Expected head SHA must be the full 40-character commit SHA.');
  const head = validatePullRequest(pr, configuredRepository, parsed.pullRequestNumber, baseBranch, expectedHeadSha);
  const selectedIssue = selectIssueNumber(pr, configuredRepository, input.issueNumber);
  const issue = (options.issueReader || defaultIssueReader)(root, configuredRepository, selectedIssue.issueNumber);
  validateAssociatedIssue(issue, configuredRepository, selectedIssue.issueNumber);

  const at = nowIso(options.now || Date.now());
  const provenance = {
    type: 'manual-import',
    importedAt: at,
    repository: configuredRepository,
    pullRequestNumber: parsed.pullRequestNumber,
    pullRequestUrl: text(pr.url),
    issueNumber: selectedIssue.issueNumber,
    headSha: head.headSha,
    headBranch: head.headBranch,
    baseBranch,
  };
  if (options.ensureLabels !== false) (options.labelEnsurer || ensurePrReviewLabels)(root);
  let existingAtLock = false;
  const registered = (options.registrar || registerManagedPullRequest)(root, {
    repository: configuredRepository,
    issueNumber: selectedIssue.issueNumber,
    issueUrl: issue.html_url || issue.url || null,
    pullRequestNumber: parsed.pullRequestNumber,
    pullRequestUrl: pr.url,
    branchName: head.headBranch,
    baseBranch,
    currentHeadSha: head.headSha,
    provenance,
  }, {
    now: options.now,
    skipQueue: config.review?.workflow === 'quick-web-chatgpt',
    prepare({ store, id, managed, input: registrationInput }) {
      existingAtLock = Boolean(managed);
      if (managed && Number(managed.issueNumber) !== selectedIssue.issueNumber) {
        throw new Error(`Pull request #${parsed.pullRequestNumber} is already managed for issue #${managed.issueNumber}; it cannot also be associated with #${selectedIssue.issueNumber}.`);
      }
      const issueConflict = existingConflict(store, configuredRepository, selectedIssue.issueNumber, id);
      if (issueConflict) {
        throw new Error(`Issue #${selectedIssue.issueNumber} is already managed by pull request #${issueConflict.pullRequestNumber}; conflicting PR/issue identities are not allowed.`);
      }
      if (managed?.provenance?.type && managed.provenance.type !== 'manual-import') {
        throw new Error(`Pull request #${parsed.pullRequestNumber} is already managed with ${managed.provenance.type} provenance.`);
      }
      if (managed && !managed.provenance) {
        throw new Error(`Pull request #${parsed.pullRequestNumber} is already managed by the controller; it cannot be reclassified as a manual import.`);
      }
      return {
        ...registrationInput,
        provenance: {
          ...registrationInput.provenance,
          importedAt: managed?.provenance?.importedAt || at,
        },
      };
    },
  });

  if (options.setLabels !== false && registered.managed.reviewState === 'queued') {
    (options.labelSetter || setPrReviewLabels)(root, parsed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.queued],
      remove: [PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.changesRequested, PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.failed],
    });
  }
  return {
    imported: !existingAtLock,
    idempotent: existingAtLock,
    inferredIssue: selectedIssue.inferred,
    validation: {
      repository: configuredRepository,
      pullRequestNumber: parsed.pullRequestNumber,
      issueNumber: selectedIssue.issueNumber,
      baseBranch,
      headBranch: head.headBranch,
      headSha: head.headSha,
    },
    managed: registered.managed,
    reviewJob: registered.reviewJob,
  };
}

function compactChecks(pr = {}) {
  return (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []).map((check) => ({
    name: check.name || check.context || check.workflowName || 'check',
    state: check.conclusion || check.state || check.status || 'UNKNOWN',
  }));
}

function importedLightPrompt({ managed, issue, pr, round, config }) {
  return renderReviewWorkflowPrompt({
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    headSha: managed.currentHeadSha,
    stage: REVIEW_STAGES.quick,
    round,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
    issueContext: [
      `Issue #${issue.number}: ${issue.title || ''}`,
      issue.body || '',
    ].filter(Boolean).join('\n\n'),
    changeContext: [
      `Review the exact pull request #${pr.number} at ${managed.currentHeadSha}.`,
      `The pull request targets ${pr.baseRefName || config.baseBranch}.`,
      'Use the connected GitHub tools to inspect the exact diff and relevant surrounding code.',
    ].join('\n'),
    validationContext: JSON.stringify({
      exactHead: managed.currentHeadSha,
      githubChecks: compactChecks(pr),
    }),
    quickFindings: '',
  });
}

function defaultImportedLightRunner(command, args, runnerOptions) {
  return runJson(command, args, runnerOptions);
}

function supersedeImportedFullJobs(store, managed, reason, at) {
  for (const job of store.reviewJobs.filter((candidate) => candidate.managedPullRequestId === managed.id
    && ['queued', 'submitting', 'awaiting_result'].includes(candidate.state))) {
    const previous = job.state;
    job.state = 'superseded';
    job.completedAt = at;
    job.updatedAt = at;
    job.lastError = reason;
    appendHistory(store, {
      entityType: 'review_job', entityId: job.id, previousState: previous, newState: 'superseded',
      reason, actor: 'review-reconciliation', sha: job.headSha, timestamp: at,
    });
    if (store.runtime.activeReviewJobId === job.id) store.runtime.activeReviewJobId = null;
  }
}

function recordImportedLightEvent(root, managedId, event, decision) {
  return mutatePrReviewStore(root, (store) => {
    const managed = findManaged(store, managedId);
    if (!managed) throw new Error(`Managed PR ${managedId} was not found.`);
    const at = new Date().toISOString();
    managed.stagedReviewEvents = [...(managed.stagedReviewEvents || []), {
      ...event,
      decision: decision.action,
    }].slice(-100);
    managed.updatedAt = at;
    if (decision.action === 'stale') {
      const reason = 'The imported PR head changed during the Light review; the next Light review must use the new exact head.';
      supersedeImportedFullJobs(store, managed, reason, at);
      managed.activeReviewRequestId = null;
      managed.queuePosition = null;
      transitionManaged(store, managed, 'queued', {
        reason,
        actor: 'review-reconciliation',
        sha: event.headSha,
        error: reason,
        at,
      });
    } else if (decision.action === 'repair') {
      const reason = event.summary || 'The imported PR Light review requested changes; no Full review was queued.';
      supersedeImportedFullJobs(store, managed, reason, at);
      managed.activeReviewRequestId = null;
      managed.queuePosition = null;
      transitionManaged(store, managed, 'changes_requested', {
        reason,
        actor: 'review-reconciliation',
        sha: event.headSha,
        error: reason,
        at,
      });
    }
    return managed;
  });
}

function importedLightRepairPending(events, headSha) {
  return events.some((event) => event?.stage === REVIEW_STAGES.quick
    && event?.result === 'changes'
    && event?.decision === 'repair'
    && String(event.headSha || '').toLowerCase() === String(headSha || '').toLowerCase());
}

function canonicalManagedPullRequestId(value) {
  const parsed = parseManagedPullRequestId(value);
  return managedPullRequestId(parsed.repository, parsed.pullRequestNumber);
}

function currentImportedHead(snapshot, expectedHead) {
  return snapshot
    && String(snapshot.state || '').toUpperCase() === 'OPEN'
    && String(snapshot.headRefOid || '').toLowerCase() === String(expectedHead || '').toLowerCase()
    ? expectedHead
    : null;
}

export function importedStagedReviewRequired(root, managedId, config = loadConfig(root)) {
  const managed = findManaged(loadPrReviewStore(root), canonicalManagedPullRequestId(managedId));
  return Boolean(
    managed?.provenance?.type === 'manual-import'
      && config.review?.workflow === 'quick-web-chatgpt',
  );
}

export function reviewImportedPullRequestNow(root, managedId, {
  config = loadConfig(root),
  snapshotReader = managedPrSnapshot,
  issueReader,
  lightRunner = defaultImportedLightRunner,
  labelSetter = setPrReviewLabels,
  conversationUrlOverride = null,
  now = Date.now(),
} = {}) {
  const canonicalId = canonicalManagedPullRequestId(managedId);
  const store = loadPrReviewStore(root);
  const managed = findManaged(store, canonicalId);
  if (!managed?.provenance || managed.provenance.type !== 'manual-import'
      || config.review?.workflow !== 'quick-web-chatgpt') return null;

  const initial = snapshotReader(root, managed.pullRequestNumber);
  const expectedHead = String(initial?.headRefOid || managed.currentHeadSha || '').toLowerCase();
  if (!initial || String(initial.state || '').toUpperCase() !== 'OPEN' || !expectedHead
      || expectedHead !== String(managed.currentHeadSha || '').toLowerCase()) {
    throw new Error('Imported staged review requires an open PR whose current head exactly matches the managed head.');
  }
  const issue = issueReader
    ? issueReader(root, managed.issueNumber)
    : runJson('gh', ['issue', 'view', String(managed.issueNumber), '--json', 'number,url,title,body,comments'], { cwd: root });
  if (!issue || Number(issue.number) !== Number(managed.issueNumber)) {
    throw new Error(`Could not load associated issue #${managed.issueNumber} for imported staged review.`);
  }

  const events = Array.isArray(managed.stagedReviewEvents) ? managed.stagedReviewEvents : [];
  if (importedLightRepairPending(events, expectedHead)) {
    throw new Error('Imported Light review requires a new exact PR head after changes were requested.');
  }
  const round = nextReviewRound({ events }, REVIEW_STAGES.quick);
  const expected = {
    repository: managed.repository,
    pullRequestNumber: managed.pullRequestNumber,
    issueNumber: managed.issueNumber,
    headSha: expectedHead,
    stage: REVIEW_STAGES.quick,
    round,
    promptVersion: REVIEW_WORKFLOW_PROMPT_VERSION,
  };
  const args = [
    'run', '--provider', String(config.models?.reviewer || ''),
    ...(config.models?.reviewerThinking ? ['--thinking', String(config.models.reviewerThinking)] : []),
    '--cwd', root,
    '--title', `Issue #${managed.issueNumber} Imported Light Reviewer`,
    '--output-schema', REVIEW_WORKFLOW_OUTPUT_SCHEMA,
    importedLightPrompt({ managed: { ...managed, currentHeadSha: expectedHead }, issue, pr: initial, round, config }),
  ];
  const verdict = lightRunner('paseo', args, { cwd: root });
  if (!verdict || typeof verdict !== 'object') throw new Error('Imported Light reviewer did not return a structured verdict.');

  const latest = snapshotReader(root, managed.pullRequestNumber);
  const currentHead = currentImportedHead(latest, expectedHead);
  const event = currentHead === expectedHead
    ? createHarnessReviewEvent(verdict, expected)
    : createHarnessReviewEvent({
      result: 'stale',
      summary: 'The imported pull-request head changed before the Light verdict could be accepted.',
      findings: [],
    }, expected);
  const decision = reviewStageDecision({ config, state: { events }, stage: REVIEW_STAGES.quick, verdict: event });
  const importedDecision = event.result === 'changes' && decision.action === 'handoff'
    ? { ...decision, action: 'repair', exhausted: true }
    : decision;
  recordImportedLightEvent(root, canonicalId, event, importedDecision);
  if (event.result === 'changes') {
    labelSetter(root, managed.pullRequestNumber, {
      add: [PR_REVIEW_LABELS.changesRequested],
      remove: [PR_REVIEW_LABELS.queued, PR_REVIEW_LABELS.reviewing, PR_REVIEW_LABELS.fixing, PR_REVIEW_LABELS.failed],
    });
  }
  if (!['quick-passed', 'handoff'].includes(importedDecision.action)) {
    return {
      staged: true,
      lightReview: { event, decision: importedDecision },
      reviewJob: null,
      metadata: null,
      managed: findManaged(loadPrReviewStore(root), canonicalId),
    };
  }

  const current = snapshotReader(root, managed.pullRequestNumber);
  if (currentImportedHead(current, expectedHead) !== expectedHead) {
    const stale = createHarnessReviewEvent({
      result: 'stale',
      summary: 'The imported pull-request head changed before the Full review was queued.',
      findings: [],
    }, expected);
    const staleDecision = reviewStageDecision({ config, state: { events: [...events, event] }, stage: REVIEW_STAGES.quick, verdict: stale });
    recordImportedLightEvent(root, canonicalId, stale, staleDecision);
    return {
      staged: true,
      lightReview: { event: stale, decision: staleDecision },
      reviewJob: null,
      metadata: null,
      managed: findManaged(loadPrReviewStore(root), canonicalId),
    };
  }
  const queued = queueWebChatGptFullReview(root, canonicalId, {
    quickOutcome: decision,
    quickFindings: event.findings,
    reviewEvents: [...events, event],
    config,
    headSha: expectedHead,
    conversationUrlOverride,
    immediate: true,
    now,
  });
  if (queued.stale) {
    const stale = createHarnessReviewEvent({
      result: 'stale',
      summary: 'The managed pull-request head changed before the Full review could be queued.',
      findings: [],
    }, expected);
    const staleDecision = reviewStageDecision({ config, state: { events: [...events, event] }, stage: REVIEW_STAGES.quick, verdict: stale });
    recordImportedLightEvent(root, canonicalId, stale, staleDecision);
    return {
      staged: true,
      lightReview: { event: stale, decision: staleDecision },
      reviewJob: null,
      metadata: null,
      managed: findManaged(loadPrReviewStore(root), canonicalId),
    };
  }
  return {
    staged: true,
    lightReview: { event, decision },
    reviewJob: queued.job,
    metadata: queued.metadata,
    managed: findManaged(loadPrReviewStore(root), canonicalId),
  };
}

export function reviewManagedNow(root, managedId, options = {}) {
  const canonicalId = canonicalManagedPullRequestId(managedId);
  const imported = reviewImportedPullRequestNow(root, canonicalId, options);
  return imported || enqueueManagedReview(root, canonicalId, options);
}
