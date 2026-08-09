function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function eventHead(event = {}) {
  return firstString(event.headSha, event.commit);
}

function sameSha(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function byUpdatedAt(records = []) {
  return [...records].sort((left, right) => String(
    right?.updatedAt || right?.completedAt || right?.submittedAt || right?.createdAt || right?.at || '',
  ).localeCompare(String(
    left?.updatedAt || left?.completedAt || left?.submittedAt || left?.createdAt || left?.at || '',
  )));
}

function currentManaged(run = {}, store = null) {
  if (!store) return null;
  const issueNumber = firstNumber(run.issueNumber, run.issue?.number);
  const prNumber = firstNumber(run.prNumber, run.pullRequestNumber, run.pullRequest?.number);
  return byUpdatedAt((store.managedPullRequests || []).filter((managed) => (
    Number(managed?.issueNumber) === issueNumber
    && (!prNumber || Number(managed?.pullRequestNumber) === prNumber)
  )))[0] || null;
}

function currentReviewJob(store, managed, currentHeadSha) {
  if (!store || !managed) return null;
  const jobs = (store.reviewJobs || []).filter((job) => String(job?.managedPullRequestId) === String(managed.id));
  if (!currentHeadSha) return byUpdatedAt(jobs)[0] || null;
  return byUpdatedAt(jobs.filter((job) => sameSha(job.headSha, currentHeadSha)))[0] || null;
}

function normalizedFinding(finding = {}) {
  const severity = String(finding.severity || '').toLowerCase() === 'non-blocking' ? 'non-blocking' : 'blocking';
  const message = String(finding.message || '').trim();
  if (!message) return null;
  return {
    severity,
    message,
    file: finding.file == null ? null : String(finding.file),
    line: Number.isInteger(Number(finding.line)) ? Number(finding.line) : null,
    requiredChange: finding.requiredChange == null ? null : String(finding.requiredChange),
    requiredTest: finding.requiredTest == null ? null : String(finding.requiredTest),
  };
}

function findingsFrom(event) {
  return (Array.isArray(event?.findings) ? event.findings : [])
    .map(normalizedFinding)
    .filter(Boolean);
}

function findingCounts(findings) {
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const nonBlocking = findings.filter((finding) => finding.severity === 'non-blocking').length;
  return { blocking, nonBlocking, total: blocking + nonBlocking };
}

function exactReviewEvent(run = {}, currentHeadSha) {
  const candidates = (run.events || []).filter((event) => ['harness-review', 'review'].includes(String(event?.event || '')));
  const exact = currentHeadSha ? candidates.filter((event) => sameSha(eventHead(event), currentHeadSha)) : candidates;
  return byUpdatedAt(exact)[0] || null;
}

function latestHandoff(run = {}) {
  return byUpdatedAt((run.events || []).filter((event) => String(event?.event || '') === 'harness-review-handoff'))[0] || null;
}

function reviewType(run, event, job, config) {
  const runtime = String(run.reviewRuntimeStage || '');
  const workflow = String(config?.review?.workflow || '');
  const web = runtime === 'full-web-chatgpt'
    || Boolean(job?.conversationUrlUsed || job?.conversationUrlOverride)
    || (workflow === 'quick-web-chatgpt' && event?.stage === 'full');
  if (web) return { type: 'web-chatgpt', label: 'Web ChatGPT Review' };
  if (event?.stage === 'full' || runtime === 'full-immediate' || workflow === 'full-immediate') {
    return { type: 'heavy', label: 'Heavy Review' };
  }
  return { type: 'light', label: 'Light Review' };
}

function reviewLimit(type, config) {
  if (type === 'light') return config?.review?.quickMaxRounds ?? null;
  return config?.review?.fullMaxRounds ?? config?.maxReviewRounds ?? null;
}

function reviewRound(type, event, job, managed) {
  if (Number.isInteger(Number(event?.round)) && Number(event.round) > 0) return Number(event.round);
  if (Number.isInteger(Number(job?.reviewRound)) && Number(job.reviewRound) > 0) return Number(job.reviewRound);
  if (Number.isInteger(Number(managed?.reviewRound)) && Number(managed.reviewRound) > 0) return Number(managed.reviewRound);
  return null;
}

function eventResult(event, job) {
  const raw = firstString(event?.result, job?.result);
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value === 'pass' || value === 'approved') return 'Approved';
  if (value === 'changes' || value === 'changes_requested' || value === 'changes_required') return 'Changes requested';
  if (value === 'stale') return 'Stale';
  return raw;
}

function handoffEvidence(run) {
  const handoff = latestHandoff(run);
  if (!handoff) return null;
  const findings = (Array.isArray(handoff.unresolvedFindings) ? handoff.unresolvedFindings : [])
    .map(normalizedFinding)
    .filter(Boolean);
  return {
    from: firstString(handoff.from),
    to: firstString(handoff.to),
    at: firstString(handoff.at),
    unresolvedFindings: findings,
    unresolvedCount: findings.length,
  };
}

export function reviewEvidenceForRun(run = {}, store = null, config = {}) {
  const managed = currentManaged(run, store);
  const currentHeadSha = firstString(managed?.currentHeadSha, run.currentHeadSha, run.prHeadSha);
  const job = currentReviewJob(store, managed, currentHeadSha);
  const event = exactReviewEvent(run, currentHeadSha);
  const identity = reviewType(run, event, job, config);
  const findings = findingsFrom(event);
  const counts = findingCounts(findings);
  const structured = String(event?.event || '') === 'harness-review';
  const conversationUrl = firstString(job?.conversationUrlUsed, job?.conversationUrlOverride, managed?.conversationUrlOverride);
  const summary = firstString(event?.summary, structured ? null : event?.details);
  const stage = firstString(event?.stage) || (identity.type === 'light' ? 'quick' : 'full');
  const round = reviewRound(identity.type, event, job, managed);

  return {
    ...identity,
    stage,
    round,
    limit: reviewLimit(identity.type, config),
    result: eventResult(event, job),
    exactHeadSha: firstString(eventHead(event), job?.headSha, currentHeadSha),
    currentHeadSha,
    headMatchesCurrent: currentHeadSha && firstString(eventHead(event), job?.headSha)
      ? sameSha(firstString(eventHead(event), job?.headSha), currentHeadSha)
      : null,
    requestedAt: firstString(job?.createdAt, job?.dueAt),
    submittedAt: firstString(job?.submittedAt),
    completedAt: firstString(event?.at, job?.completedAt),
    lastActivityAt: firstString(managed?.lastActivityAt, job?.updatedAt, event?.at),
    jobId: firstString(job?.id),
    reviewRequestId: firstString(job?.reviewRequestId, managed?.activeReviewRequestId, managed?.lastProcessedReviewRequestId),
    promptVersion: Number(event?.promptVersion || job?.promptVersion || managed?.reviewPromptVersion) || null,
    resultSourceId: job?.resultSourceId ?? managed?.lastReviewCommentId ?? null,
    queuePosition: job?.queuePosition ?? managed?.queuePosition ?? null,
    attempts: Number.isInteger(Number(job?.attempts)) ? Number(job.attempts) : null,
    jobState: firstString(job?.state),
    managedState: firstString(managed?.reviewState),
    conversationUrl,
    conversationSource: identity.type === 'web-chatgpt' ? 'Web ChatGPT (Browser)' : null,
    summary,
    structuredFindings: structured,
    findings,
    findingCounts: counts,
    handoff: handoffEvidence(run),
  };
}

export function managerReviewEvidenceSummary(runs = [], store = null, config = {}) {
  const byIssue = {};
  for (const run of runs || []) {
    const issueNumber = firstNumber(run?.issueNumber, run?.issue?.number);
    const prNumber = firstNumber(run?.prNumber, run?.pullRequestNumber, run?.pullRequest?.number);
    if (!issueNumber || !prNumber) continue;
    byIssue[String(issueNumber)] = reviewEvidenceForRun(run, store, config);
  }
  return { byIssue };
}
