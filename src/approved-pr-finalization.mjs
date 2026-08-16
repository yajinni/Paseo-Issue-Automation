import { markHumanReview } from './automation.mjs';
import {
  approvedPullRequestMergeEligibility,
  requestApprovedPullRequestAutoMerge,
} from './approved-pr-auto-merge.mjs';
import { PASEO_LABELS } from './label-catalog.mjs';
import { managerPrHealthSnapshot } from './pr-review-github.mjs';
import {
  appendHistory,
  clone,
  findManaged,
  loadPrReviewStore,
  managedPullRequestId,
  mutatePrReviewStore,
  nowIso,
  transitionManaged,
} from './pr-review-store.mjs';
import { run } from './process.mjs';
import { appendIssueLifecycle, loadConfig, loadRun, saveRun } from './state.mjs';

const FINALIZATION_REQUEST_PREFIX = 'approved-finalization:';

function text(value) {
  return String(value ?? '').trim();
}

function normalizedHead(value) {
  return text(value).toLowerCase();
}

function checkState(check) {
  return String(check?.conclusion || check?.state || check?.status || '').toUpperCase();
}

function checksPassed(pr = {}) {
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  return checks.every((check) => {
    const state = checkState(check);
    return state && !['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'REQUESTED', 'WAITING', 'UNKNOWN'].includes(state);
  });
}

function latestValidationForHead(state, headSha) {
  const expected = normalizedHead(headSha);
  return [...(state?.events || [])]
    .reverse()
    .find((event) => event.event === 'validation-summary'
      && event.result === 'PASS'
      && normalizedHead(event.commit) === expected) || null;
}

function exactApprovedRunReview(state, headSha) {
  const expected = normalizedHead(headSha);
  return [...(state?.events || [])]
    .reverse()
    .find((event) => {
      if (event.event === 'harness-review') {
        return event.stage === 'full'
          && event.result === 'pass'
          && normalizedHead(event.headSha) === expected;
      }
      return event.event === 'review'
        && event.result === 'APPROVED'
        && normalizedHead(event.commit) === expected
        && ['browser-review', 'manual-review', 'harness-review-compat'].includes(event.source);
    }) || null;
}

function manualMergeActsAsApproval(state, headSha) {
  const expected = normalizedHead(headSha);
  return state?.reviewRuntimeStage === 'full-manual'
    && state?.phase === 'manual-review-merged-pending-finalization'
    && normalizedHead(state.reviewExpectedHeadSha) === expected
    && Boolean(latestValidationForHead(state, expected));
}

function finalizationRequestId(managedId, headSha, source) {
  return `${FINALIZATION_REQUEST_PREFIX}${source}:${managedId}:${normalizedHead(headSha)}`;
}

function storedExactApproval(store, managed, headSha) {
  const expected = normalizedHead(headSha);
  if (normalizedHead(managed.lastCompletedReviewSha) !== expected || !managed.lastProcessedReviewRequestId) return false;
  return store.reviewJobs.some((job) => job.managedPullRequestId === managed.id
    && job.state === 'completed'
    && job.result === 'approved'
    && job.reviewRequestId === managed.lastProcessedReviewRequestId
    && normalizedHead(job.headSha) === expected);
}

export function ensureManagedApprovedFinalization(root, {
  repository,
  issueNumber,
  issueUrl = null,
  pullRequest,
  state,
  headSha,
  approvalSource = 'full-review',
  validation = null,
} = {}) {
  const head = normalizedHead(headSha || pullRequest?.headRefOid);
  if (!/^[0-9a-f]{7,64}$/.test(head)) throw new Error('Approved finalization requires an exact PR head SHA.');
  const prNumber = Number(pullRequest?.number || state?.prNumber);
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error('Approved finalization requires a pull request number.');
  const repo = text(repository);
  if (!repo) throw new Error('Approved finalization requires a repository identity.');

  return mutatePrReviewStore(root, (store) => {
    const id = managedPullRequestId(repo, prNumber);
    const at = nowIso();
    let managed = findManaged(store, id);
    if (!managed) {
      managed = {
        id,
        repository: repo,
        issueNumber: Number(issueNumber),
        issueUrl,
        pullRequestNumber: prNumber,
        pullRequestUrl: text(pullRequest?.url || state?.prUrl),
        branchName: text(state?.branch || pullRequest?.headRefName),
        worktreePath: state?.worktreePath || null,
        workspaceId: state?.workspaceId || null,
        coderAgentId: state?.coderAgentId || state?.agentId || null,
        currentHeadSha: head,
        lastSubmittedReviewSha: null,
        lastCompletedReviewSha: null,
        lastValidatedReviewSha: normalizedHead(validation?.commit || validation?.headSha) === head ? head : null,
        reviewRound: 1,
        reviewPromptVersion: store.config.browserReview.reviewPromptVersion,
        reviewState: 'ready_to_merge',
        queuePosition: null,
        priority: 0,
        activeReviewRequestId: null,
        lastReviewCommentId: null,
        lastProcessedReviewRequestId: null,
        conversationUrlOverride: null,
        createdAt: at,
        updatedAt: at,
        lastReconciledAt: null,
        lastActivityAt: at,
        lastError: null,
        issueClosurePending: false,
        lifecycleCompletionPending: false,
        reviewEvidenceMissing: false,
        diagnosticScreenshot: null,
      };
      store.managedPullRequests.push(managed);
      appendHistory(store, {
        entityType: 'managed_pull_request',
        entityId: managed.id,
        previousState: null,
        newState: 'ready_to_merge',
        reason: `Approved exact head ${head} entered deterministic finalization.`,
        actor: 'approved-finalization',
        sha: head,
        timestamp: at,
      });
    } else {
      managed.issueNumber = Number(issueNumber || managed.issueNumber);
      managed.issueUrl = issueUrl || managed.issueUrl;
      managed.pullRequestUrl = text(pullRequest?.url || managed.pullRequestUrl);
      managed.branchName = text(state?.branch || pullRequest?.headRefName || managed.branchName);
      managed.worktreePath = state?.worktreePath || managed.worktreePath;
      managed.workspaceId = state?.workspaceId || managed.workspaceId;
      managed.coderAgentId = state?.coderAgentId || state?.agentId || managed.coderAgentId;
      managed.currentHeadSha = head;
      if (normalizedHead(validation?.commit || validation?.headSha) === head) managed.lastValidatedReviewSha = head;
      managed.updatedAt = at;
      managed.lastActivityAt = at;
    }

    if (!storedExactApproval(store, managed, head)) {
      const reviewRequestId = finalizationRequestId(managed.id, head, approvalSource);
      const existing = store.reviewJobs.find((job) => job.reviewRequestId === reviewRequestId);
      if (!existing) {
        store.reviewJobs.push({
          id: reviewRequestId,
          managedPullRequestId: managed.id,
          repository: managed.repository,
          pullRequestNumber: managed.pullRequestNumber,
          headSha: head,
          promptVersion: managed.reviewPromptVersion,
          reviewRound: managed.reviewRound,
          reviewRequestId,
          state: 'completed',
          queuePosition: 0,
          priority: managed.priority || 0,
          dueAt: at,
          attempts: 0,
          conversationUrlOverride: null,
          conversationUrlUsed: null,
          submittedAt: at,
          completedAt: at,
          result: 'approved',
          resultSourceId: null,
          lastError: null,
          diagnosticScreenshot: null,
          createdAt: at,
          updatedAt: at,
        });
        appendHistory(store, {
          entityType: 'review_job',
          entityId: reviewRequestId,
          previousState: null,
          newState: 'completed',
          reason: `Imported authoritative ${approvalSource} approval for deterministic merge reconciliation.`,
          actor: 'approved-finalization',
          sha: head,
          timestamp: at,
        });
      }
      managed.lastCompletedReviewSha = head;
      managed.lastProcessedReviewRequestId = reviewRequestId;
      managed.activeReviewRequestId = null;
    }

    managed.queuePosition = null;
    managed.lastError = null;
    if (!['merged', 'closed_unmerged'].includes(managed.reviewState) && managed.reviewState !== 'ready_to_merge') {
      transitionManaged(store, managed, 'ready_to_merge', {
        reason: `Exact-head approval from ${approvalSource} is ready for deterministic finalization.`,
        actor: 'approved-finalization',
        sha: head,
        at,
      });
    }
    return clone(managed);
  });
}

export function repositoryAutoMergeCapability(root, repository, { runner = run } = {}) {
  const repo = text(repository);
  if (!repo) return { known: false, enabled: false, reason: 'Repository identity is missing.' };
  const result = runner('gh', ['api', `repos/${repo}`, '--jq', '.allow_auto_merge'], {
    cwd: root,
    allowFailure: true,
  });
  if (!result?.ok) {
    return {
      known: false,
      enabled: false,
      reason: text(result?.stderr || result?.stdout) || 'Could not read the repository auto-merge setting.',
    };
  }
  const value = text(result.stdout).toLowerCase();
  if (!['true', 'false'].includes(value)) {
    return { known: false, enabled: false, reason: `Unexpected repository auto-merge setting: ${value || '(empty)'}.` };
  }
  return { known: true, enabled: value === 'true', reason: value === 'true' ? null : 'GitHub repository auto-merge is disabled.' };
}

export function approvedFinalizationOwnership(state = {}, pullRequest = {}, headSha = '') {
  const head = normalizedHead(headSha || pullRequest.headRefOid);
  const branch = text(state.branch || state.branchName);
  const prBranch = text(pullRequest.headRefName || branch);
  return Boolean(branch && prBranch && branch === prBranch
    && head
    && normalizedHead(pullRequest.headRefOid) === head);
}

function ensureReady(root, pullRequest, { runner = run, required = true } = {}) {
  if (pullRequest?.isDraft !== true) return { changed: false, ready: true };
  const result = runner('gh', ['pr', 'ready', String(pullRequest.number)], { cwd: root, allowFailure: true });
  if (!result?.ok) {
    const reason = text(result?.stderr || result?.stdout) || `Could not mark PR #${pullRequest.number} ready for finalization.`;
    if (required) throw new Error(reason);
    return { changed: false, ready: false, reason };
  }
  return { changed: true, ready: true };
}

function humanReviewAlreadyMarked(state, pullRequestNumber, headSha) {
  return state?.phase === 'human-review'
    && Number(state.prNumber) === Number(pullRequestNumber)
    && normalizedHead(state.approvedCommit) === normalizedHead(headSha);
}

function updateRun(root, issueNumber, patch, activity = null) {
  const state = loadRun(root, issueNumber);
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const at = nowIso();
  return saveRun(root, issueNumber, {
    ...state,
    ...patch,
    updatedAt: at,
    heartbeatAt: at,
    activity: activity
      ? [...(state.activity || []), { type: activity.type, at, details: activity.details || '' }]
      : state.activity || [],
  });
}

function routeToHumanReview(root, issueNumber, pullRequestNumber, headSha, reason, { humanFinalizer = markHumanReview } = {}) {
  let state = loadRun(root, issueNumber);
  if (humanReviewAlreadyMarked(state, pullRequestNumber, headSha)) {
    return { mode: 'human-review', unchanged: true, reason: state.reason || reason || null };
  }
  if (reason) {
    state = updateRun(root, issueNumber, { reason }, {
      type: 'auto-merge-unavailable',
      details: reason,
    });
  }
  const saved = humanFinalizer(root, issueNumber, pullRequestNumber);
  return { mode: 'human-review', state: saved, reason: reason || null };
}

function releaseCodingSlotForMerge(root, issueNumber, { runner = run } = {}) {
  const result = runner('gh', [
    'issue', 'edit', String(issueNumber),
    '--remove-label', PASEO_LABELS.coding,
    '--add-label', PASEO_LABELS.reviewQueued,
  ], { cwd: root, allowFailure: true });
  if (!result?.ok) throw new Error(text(result?.stderr || result?.stdout) || `Could not release the coding slot for issue #${issueNumber}.`);
}

function humanFallback(root, issueNumber, pr, head, reason, managed, eligibility, options, extras = {}) {
  const settled = humanReviewAlreadyMarked(loadRun(root, issueNumber), pr.number, head);
  if (settled) {
    return {
      ...routeToHumanReview(root, issueNumber, pr.number, head, reason, options),
      managed,
      eligibility,
      readiness: { changed: false, ready: pr?.isDraft !== true, skipped: true },
      ...extras,
    };
  }
  const readiness = ensureReady(root, pr, { ...options, required: false });
  const readinessReason = readiness.ready
    ? reason
    : [reason, `PR remains draft: ${readiness.reason}`].filter(Boolean).join(' ');
  return {
    ...routeToHumanReview(root, issueNumber, pr.number, head, readinessReason || null, options),
    managed,
    eligibility,
    readiness,
    ...extras,
  };
}

export function finalizeApprovedPullRequest(root, {
  repository,
  issueNumber,
  issueUrl = null,
  pullRequest,
  state = loadRun(root, issueNumber),
  findings = [],
  unresolvedFindings = false,
  approvalSource = 'full-review',
  paseoOwned = approvedFinalizationOwnership(state, pullRequest, pullRequest?.headRefOid),
} = {}, options = {}) {
  if (!state) throw new Error(`No automation state exists for issue #${issueNumber}.`);
  const config = options.config || loadConfig(root);
  const pr = pullRequest || managerPrHealthSnapshot(root, state.prNumber);
  if (!pr) throw new Error('Could not read the approved pull request for finalization.');
  const head = normalizedHead(pr.headRefOid);
  const approval = exactApprovedRunReview(state, head);
  const validation = latestValidationForHead(state, head);
  if (!approval) throw new Error(`No authoritative exact-head approval exists for ${head}.`);
  if (!validation) throw new Error(`No passing exact-head validation exists for ${head}.`);

  const managed = ensureManagedApprovedFinalization(root, {
    repository,
    issueNumber,
    issueUrl,
    pullRequest: pr,
    state,
    headSha: head,
    approvalSource,
  });

  const normalizedPr = {
    number: Number(pr.number),
    issueNumber: Number(issueNumber),
    headSha: head,
    baseBranch: text(pr.baseRefName),
    checksPassed: checksPassed(pr),
    mergeable: String(pr.mergeable || '').toUpperCase() === 'MERGEABLE',
    conflicted: pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY',
    state: String(pr.state || 'OPEN').toLowerCase(),
  };
  const eligibility = approvedPullRequestMergeEligibility({
    config,
    pullRequest: normalizedPr,
    review: {
      approved: true,
      approvedHeadSha: head,
      findings: Array.isArray(findings) ? findings : [],
      unresolvedFindings: unresolvedFindings === true,
    },
    validation: { passed: true, headSha: head },
    currentBaseBranch: text(config.baseBranch),
    paseoOwned,
  });

  if (config.review?.workflow === 'quick-manual' || config.review?.autoMergeApproved !== true) {
    return humanFallback(root, issueNumber, pr, head, null, managed, eligibility, options);
  }
  if (!eligibility.eligible) {
    const reason = `Automatic merge was not authorized: ${eligibility.reasons.join(', ')}.`;
    return humanFallback(root, issueNumber, pr, head, reason, managed, eligibility, options, {
      autoMergeUnavailable: true,
    });
  }

  const currentState = loadRun(root, issueNumber);
  if (currentState?.phase === 'auto-merge-requested'
      && normalizedHead(currentState.approvedCommit) === head
      && Number(currentState.prNumber) === Number(pr.number)) {
    return { mode: 'auto-merge', requested: true, unchanged: true, managed, eligibility };
  }

  const capability = repositoryAutoMergeCapability(root, repository, options);
  if (!capability.known || !capability.enabled) {
    const reason = capability.reason || 'GitHub repository auto-merge is unavailable.';
    return humanFallback(root, issueNumber, pr, head, reason, managed, eligibility, options, {
      capability,
      autoMergeUnavailable: true,
    });
  }

  ensureReady(root, pr, { ...options, required: true });
  const request = (options.autoMergeRequester || requestApprovedPullRequestAutoMerge)(root, {
    config,
    pullRequest: normalizedPr,
    review: {
      approved: true,
      approvedHeadSha: head,
      findings: Array.isArray(findings) ? findings : [],
      unresolvedFindings: unresolvedFindings === true,
    },
    validation: { passed: true, headSha: head },
    currentBaseBranch: text(config.baseBranch),
    paseoOwned,
  }, options);
  if (!request.enabled) {
    const reason = request.reason || 'GitHub did not enable automatic merge.';
    return humanFallback(root, issueNumber, pr, head, reason, managed, eligibility, options, {
      capability,
      request,
      autoMergeUnavailable: true,
    });
  }

  releaseCodingSlotForMerge(root, issueNumber, options);
  const saved = updateRun(root, issueNumber, {
    status: PASEO_LABELS.reviewQueued,
    phase: 'auto-merge-requested',
    reason: null,
    approvedCommit: head,
    prNumber: Number(pr.number),
    prUrl: pr.url || state.prUrl || null,
    completedAt: null,
    controllerPid: null,
  }, {
    type: 'auto-merge-requested',
    details: `GitHub auto-merge was requested for PR #${pr.number} at exact approved head ${head}.`,
  });
  appendIssueLifecycle(root, issueNumber, {
    attempt: saved.attempt,
    type: 'auto-merge-requested',
    status: 'success',
    source: 'controller',
    message: `PR #${pr.number} is approved at ${head}; GitHub policy now owns the merge timing.`,
    evidence: { pullRequestNumber: pr.number, headSha: head, workflow: config.review?.workflow },
  });
  return {
    mode: 'auto-merge',
    requested: true,
    enabled: true,
    state: saved,
    managed,
    eligibility,
    capability,
    request,
  };
}

export function prepareManagedFinalizationEvidence(root) {
  const store = loadPrReviewStore(root);
  const prepared = [];
  for (const managed of store.managedPullRequests) {
    if (['merged', 'closed_unmerged'].includes(managed.reviewState)) continue;
    const state = loadRun(root, managed.issueNumber);
    if (!state) continue;
    const head = normalizedHead(managed.currentHeadSha);
    const approval = exactApprovedRunReview(state, head);
    const manualMerge = manualMergeActsAsApproval(state, head);
    if (!approval && !manualMerge) continue;
    prepared.push(ensureManagedApprovedFinalization(root, {
      repository: managed.repository,
      issueNumber: managed.issueNumber,
      issueUrl: managed.issueUrl,
      pullRequest: {
        number: managed.pullRequestNumber,
        url: managed.pullRequestUrl,
        headRefOid: head,
        headRefName: managed.branchName,
      },
      state,
      headSha: head,
      approvalSource: manualMerge ? 'manual-merge' : (state.reviewRuntimeStage === 'full-manual' ? 'manual-review' : 'full-review'),
    }));
  }
  return prepared;
}
