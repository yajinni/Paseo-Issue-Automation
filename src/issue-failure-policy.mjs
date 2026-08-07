const TRANSIENT_TYPES = new Set(['provider', 'network', 'process', 'github-availability']);
const PERMANENT_TYPES = new Set(['permission', 'invalid-issue', 'unsafe-ambiguity', 'validation', 'merge-conflict', 'unknown']);

function normalizedText(error) {
  return [error?.message, error?.stderr, error?.stdout, error?.code].filter(Boolean).join(' ').toLowerCase();
}

export function classifyIssueFailure(error) {
  const explicit = String(error?.failureType || '').trim().toLowerCase();
  if (TRANSIENT_TYPES.has(explicit)) return { type: explicit, transient: true, reason: String(error?.message || explicit) };
  if (PERMANENT_TYPES.has(explicit)) return { type: explicit, transient: false, reason: String(error?.message || explicit) };

  const text = normalizedText(error);
  if (/permission|forbidden|unauthorized|authentication|not authorized|access denied|http\s*40[13]\b/.test(text)) {
    return { type: 'permission', transient: false, reason: String(error?.message || error) };
  }
  if (/missing meaningful|required section|must contain meaningful|issue template|invalid issue|excluded label|not labeled paseo:ready/.test(text)) {
    return { type: 'invalid-issue', transient: false, reason: String(error?.message || error) };
  }
  if (/ambiguous|unexpected agent|identity mismatch|unsafe|cannot prove|could not prove|operator action is required/.test(text)) {
    return { type: 'unsafe-ambiguity', transient: false, reason: String(error?.message || error) };
  }
  if (/merge conflict|conflicting|merge-state.*dirty|repeated.*conflict/.test(text)) {
    return { type: 'merge-conflict', transient: false, reason: String(error?.message || error) };
  }
  if (/validation.*fail|test.*fail|lint.*fail|syntax.*fail|deterministic/.test(text)) {
    return { type: 'validation', transient: false, reason: String(error?.message || error) };
  }

  if (/econnreset|econnrefused|enetunreach|ehostunreach|eai_again|socket hang up|network|dns|tls handshake|connection reset/.test(text)) {
    return { type: 'network', transient: true, reason: String(error?.message || error) };
  }
  if (/github.*(?:unavailable|outage|temporar)|api.*(?:50[0234]|unavailable)|http\s*50[0234]\b|secondary rate limit|rate limit.*retry|service unavailable/.test(text)) {
    return { type: 'github-availability', transient: true, reason: String(error?.message || error) };
  }
  if (/provider.*(?:unavailable|overloaded|timeout|temporar)|model.*(?:unavailable|overloaded)|capacity|too many requests|http\s*429\b/.test(text)) {
    return { type: 'provider', transient: true, reason: String(error?.message || error) };
  }
  if (/etimedout|timed out|eagain|enomem|spawn.*(?:failed|error)|process.*(?:temporar|unavailable)/.test(text)) {
    return { type: 'process', transient: true, reason: String(error?.message || error) };
  }
  return { type: 'unknown', transient: false, reason: String(error?.message || error || 'Unknown failure') };
}

export function temporaryFailureLimit(config = {}) {
  const value = Number(config?.issueSelection?.temporaryFailureRetries ?? 3);
  return Number.isInteger(value) && value >= 0 ? value : 3;
}

export function issueFailureRetryDecision(error, config = {}, state = {}) {
  const classification = classifyIssueFailure(error);
  const maximum = temporaryFailureLimit(config);
  const previous = Math.max(0, Number(state?.temporaryFailureCount || 0));
  const attempt = previous + 1;
  if (!classification.transient) {
    return { ...classification, retry: false, exhausted: false, attempt: previous, maximum };
  }
  return {
    ...classification,
    retry: attempt <= maximum,
    exhausted: attempt > maximum,
    attempt,
    maximum,
  };
}
