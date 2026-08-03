export const REVIEW_MARKER_VERSION = 1;
const MARKER_PATTERN = /<!--\s*paseo-review:v1\s*([\s\S]*?)\s*-->/g;

function normalizedResult(value) {
  const result = String(value || '').trim().toLowerCase();
  if (!['changes_requested', 'approved', 'stale'].includes(result)) throw new Error(`Unsupported review result: ${result || 'missing'}`);
  return result;
}

export function parsePaseoReviewMarker(body) {
  const text = String(body || '');
  const results = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    let metadata;
    try { metadata = JSON.parse(match[1].trim()); } catch { continue; }
    try {
      const parsed = {
        version: REVIEW_MARKER_VERSION,
        reviewRequestId: String(metadata.reviewRequestId || ''),
        repository: String(metadata.repository || '').toLowerCase(),
        pullRequestNumber: Number(metadata.pullRequestNumber),
        issueNumber: Number(metadata.issueNumber),
        headSha: String(metadata.headSha || '').toLowerCase(),
        reviewRound: Number(metadata.reviewRound),
        promptVersion: Number(metadata.promptVersion),
        result: normalizedResult(metadata.result),
        marker: match[0],
        humanMarkdown: text.slice((match.index || 0) + match[0].length).trim(),
      };
      if (!parsed.reviewRequestId || !parsed.repository || !Number.isInteger(parsed.pullRequestNumber)
          || !Number.isInteger(parsed.issueNumber) || !/^[0-9a-f]{7,64}$/.test(parsed.headSha)
          || !Number.isInteger(parsed.reviewRound) || !Number.isInteger(parsed.promptVersion)) continue;
      results.push(parsed);
    } catch {}
  }
  return results;
}

export function matchingReviewResult({ comments = [], reviews = [] }, expected) {
  const reviewIds = new Set(reviews.map((item) => item.id || item.databaseId));
  const candidates = [...comments, ...reviews]
    .flatMap((item) => parsePaseoReviewMarker(item.body || item.bodyText || '').map((marker) => ({
      ...marker,
      sourceId: item.id || item.databaseId || null,
      sourceType: reviewIds.has(item.id || item.databaseId) ? 'review' : 'comment',
      createdAt: item.createdAt || item.submittedAt || null,
    })))
    .filter((result) => result.reviewRequestId === expected.reviewRequestId
      && result.repository === String(expected.repository).toLowerCase()
      && result.pullRequestNumber === Number(expected.pullRequestNumber)
      && result.issueNumber === Number(expected.issueNumber)
      && result.headSha === String(expected.headSha).toLowerCase()
      && result.promptVersion === Number(expected.promptVersion));
  return candidates.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).at(-1) || null;
}
