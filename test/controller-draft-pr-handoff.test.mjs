import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROLLER_HANDOFF_END,
  CONTROLLER_HANDOFF_START,
  controllerDraftPrBody,
  refreshControllerDraftPrHandoff,
  refreshControllerDraftPrHandoffBody,
} from '../src/controller-draft-pr.mjs';

const branch = 'ai/issue-239-canary-verify-managed-autonomous-coding-lifecycl';
const initialHead = '797229072404fc772fed10606ab7eda3097141e2';
const currentHead = '1a3097b84539f48eb0b793cb1183916ea6613b94';
const repairedHead = '2b4198c95649f58fc1c804dc2294a27fb7724ca5';

test('controller-created draft body marks immutable initial head and refreshable current head', () => {
  const body = controllerDraftPrBody({
    issueNumber: 239,
    baseBranch: 'main',
    baseSha: 'cbf54274adf972b450a8cc7b6733872b0cb8162e',
    branch,
    headSha: initialHead,
    changedFiles: ['docs/autonomous-release-canary.md'],
  });

  assert.match(body, /Closes #239/);
  assert.ok(body.includes(CONTROLLER_HANDOFF_START));
  assert.ok(body.includes(CONTROLLER_HANDOFF_END));
  assert.match(body, new RegExp(`Initial handoff head: .*${initialHead}`));
  assert.match(body, new RegExp(`Current head: .*${initialHead}`));
});

test('legacy controller handoff is upgraded without rewriting closing or manual content', () => {
  const legacy = `Closes #239\n\n## Controller-created draft handoff\n\nPaseo Issue Automation created this draft PR.\n\n- Issue: #239\n- Base: \`main\` @ \`base123\`\n- Head: \`${branch}\` @ \`${initialHead}\`\n\n## Changed files\n\n- \`docs/autonomous-release-canary.md\`\n\n## Operator notes\n\nKeep this manual note.\n`;
  const refreshed = refreshControllerDraftPrHandoffBody(legacy, { branch, currentHeadSha: currentHead });

  assert.match(refreshed, /Closes #239/);
  assert.match(refreshed, new RegExp(`Initial handoff head: .*${initialHead}`));
  assert.match(refreshed, new RegExp(`Current head: .*${currentHead}`));
  assert.match(refreshed, /Keep this manual note\./);
  assert.doesNotMatch(refreshed, /^- Head:/m);
});

test('base freshness update then review repair keep initial evidence while advancing current head twice', () => {
  const body = controllerDraftPrBody({
    issueNumber: 239,
    baseBranch: 'main',
    baseSha: 'base123',
    branch,
    headSha: initialHead,
    changedFiles: ['docs/autonomous-release-canary.md'],
  });
  const withManual = `${body}\n## Manual context\n\nDo not remove this.\n`;
  const afterBaseUpdate = refreshControllerDraftPrHandoffBody(withManual, {
    branch,
    currentHeadSha: currentHead,
  });
  const afterReviewRepair = refreshControllerDraftPrHandoffBody(afterBaseUpdate, {
    branch,
    currentHeadSha: repairedHead,
  });

  assert.match(afterReviewRepair, new RegExp(`Initial handoff head: .*${initialHead}`));
  assert.match(afterReviewRepair, new RegExp(`Current head: .*${repairedHead}`));
  assert.doesNotMatch(afterReviewRepair, new RegExp(`Current head: .*${initialHead}`));
  assert.doesNotMatch(afterReviewRepair, new RegExp(`Current head: .*${currentHead}`));
  assert.match(afterReviewRepair, /Do not remove this\./);
  assert.match(afterReviewRepair, /Closes #239/);
});

test('controller refresh edits only a recognized controller handoff PR body', () => {
  const legacy = `Closes #239\n\n## Controller-created draft handoff\n\n- Head: \`${branch}\` @ \`${initialHead}\`\n\n## Notes\nmanual\n`;
  const calls = [];
  const result = refreshControllerDraftPrHandoff('/repo', {
    branch,
    worktreePath: '/worktree',
  }, {
    number: 246,
    body: legacy,
  }, currentHead, {
    runner(command, args, options) {
      calls.push({ command, args, options });
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.updated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'edit', '246']);
  assert.equal(calls[0].args[3], '--body');
  assert.match(calls[0].args[4], new RegExp(`Current head: .*${currentHead}`));
  assert.match(calls[0].args[4], /Closes #239/);
  assert.match(calls[0].args[4], /manual/);
  assert.equal(calls[0].options.cwd, '/worktree');
});

test('controller handoff edit failure fails closed', () => {
  const legacy = `Closes #239\n\n## Controller-created draft handoff\n\n- Head: \`${branch}\` @ \`${initialHead}\`\n`;
  assert.throws(
    () => refreshControllerDraftPrHandoff('/repo', {
      branch,
      worktreePath: '/worktree',
    }, {
      number: 246,
      body: legacy,
    }, currentHead, {
      runner() {
        return { ok: false, stdout: '', stderr: 'permission denied' };
      },
    }),
    (error) => error.code === 'CONTROLLER_PR_HANDOFF_UPDATE_FAILED' && /permission denied/.test(error.message),
  );
});

test('non-controller PR bodies are left untouched', () => {
  const body = 'Closes #239\n\n## Summary\nmanual PR body\n';
  assert.equal(refreshControllerDraftPrHandoffBody(body, { branch, currentHeadSha: currentHead }), body);
});
