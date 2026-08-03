import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReviewPrompt, reviewDedupeKey } from '../src/review-prompt.mjs';

test('review prompt is exact-SHA, versioned, and requires a structured GitHub result', () => {
  const prompt = renderReviewPrompt({
    reviewRequestId: 'paseo-review-1', repository: 'owner/repo', pullRequestNumber: 45,
    pullRequestUrl: 'https://github.com/owner/repo/pull/45', issueNumber: 101,
    issueUrl: 'https://github.com/owner/repo/issues/101', headSha: 'abcdef123', reviewRound: 2,
    reviewPromptVersion: 1, allowChatGPTMerge: false,
  });
  assert.match(prompt, /Head SHA to review: abcdef123/);
  assert.match(prompt, /<!-- paseo-review:v1/);
  assert.match(prompt, /current head SHA still equals abcdef123/);
  assert.match(prompt, /automatic merge is disabled/i);
});

test('deduplication key includes repository, PR, SHA, and prompt version', () => {
  assert.notEqual(
    reviewDedupeKey({ repository: 'owner/repo', pullRequestNumber: 1, headSha: 'abcdef1', reviewPromptVersion: 1 }),
    reviewDedupeKey({ repository: 'owner/repo', pullRequestNumber: 1, headSha: 'abcdef2', reviewPromptVersion: 1 }),
  );
});
