import assert from 'node:assert/strict';
import test from 'node:test';
import { prReviewCommand } from '../src/cli.mjs';

test('CLI import and register commands forward public identity and validation options', async () => {
  let received;
  const importer = (root, input) => {
    received = { root, input };
    return { imported: true };
  };
  const result = await prReviewCommand('/repo', {
    _: ['pr-review', 'register'],
    id: 'owner/repo#45',
    issue: '101',
    head: '0123456789abcdef0123456789abcdef01234567',
  }, { importer });
  assert.deepEqual(received, {
    root: '/repo',
    input: {
      id: 'owner/repo#45',
      issueNumber: '101',
      headSha: '0123456789abcdef0123456789abcdef01234567',
    },
  });
  assert.deepEqual(result, { imported: true });
});
