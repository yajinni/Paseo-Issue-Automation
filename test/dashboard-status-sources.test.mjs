import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRemoteDashboardState,
  inspectBaseFreshness,
  inspectPullRequest,
} from '../src/dashboard-status-sources.mjs';

test('remote status collector uses one issue-list request and isolates active PR failures', () => {
  const calls = [];
  const result = collectRemoteDashboardState('/repo', {
    baseBranch: 'main',
    attempts: [
      { issueNumber: 10, status: 'agent-running', prNumber: 20, branch: 'ai/ten' },
      { issueNumber: 11, status: 'human-review', prNumber: 21, branch: 'ai/eleven' },
      { issueNumber: 12, status: 'agent-ready', branch: 'ai/twelve' },
    ],
    jsonRunner(command, args) {
      calls.push([command, ...args]);
      if (args[0] === 'issue') return [{ number: 10, labels: [] }];
      if (args.includes('21')) throw new Error('temporary PR lookup failure');
      return { number: 20, headRefOid: 'abc', statusCheckRollup: [] };
    },
    runner() { return { ok: true }; },
  });

  assert.equal(calls.filter((call) => call[1] === 'issue').length, 1);
  assert.equal(calls.filter((call) => call[1] === 'pr').length, 2);
  assert.equal(result.repository.available, true);
  assert.equal(result.attemptHealth['10'].pr.number, 20);
  assert.match(result.attemptHealth['11'].error, /temporary PR lookup failure/);
  assert.equal(result.attemptHealth['12'], undefined);
});

test('pull request and base collectors expose explicit command boundaries', () => {
  let prInvocation = null;
  const pr = inspectPullRequest('/repo', { prNumber: 42 }, {
    jsonRunner(command, args, options) {
      prInvocation = { command, args, options };
      return { number: 42, headRefOid: 'head', statusCheckRollup: [] };
    },
  });
  assert.equal(pr.number, 42);
  assert.equal(prInvocation.command, 'gh');
  assert.deepEqual(prInvocation.args.slice(0, 3), ['pr', 'view', '42']);

  let gitInvocation = null;
  const freshness = inspectBaseFreshness('/repo', { worktreePath: '/worktree', branch: 'ai/task' }, 'main', {
    runner(command, args, options) {
      gitInvocation = { command, args, options };
      return { ok: true };
    },
  });
  assert.equal(freshness.state, 'current');
  assert.equal(gitInvocation.command, 'git');
  assert.deepEqual(gitInvocation.args, ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD']);
  assert.equal(gitInvocation.options.cwd, '/worktree');
});
