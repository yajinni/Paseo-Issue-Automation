import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerDraftPrBody, ensureDraftPr } from '../src/controller-draft-pr.mjs';

const configLoader = () => ({ baseBranch: 'main' });

test('draft PR scaffold records exact refs and changed files', () => {
  const body = controllerDraftPrBody({
    issueNumber: 274,
    baseBranch: 'main',
    baseSha: 'base123',
    branch: 'ai/issue-274-attempt-4',
    headSha: 'head456',
    changedFiles: ['src/a.mjs'],
  });
  assert.match(body, /Closes #274/);
  assert.match(body, /base123/);
  assert.match(body, /head456/);
  assert.match(body, /src\/a\.mjs/);
});

test('missing PR is created only for the exact pushed branch head', () => {
  let reads = 0;
  const calls = [];
  const state = { issueTitle: 'Issue title', branch: 'ai/issue-274-attempt-4', worktreePath: '/worktree' };
  const pr = { number: 901, url: 'pr-url', isDraft: true, headRefOid: 'head456', baseRefName: 'main' };
  const runJsonFn = () => (++reads === 1 ? [] : [pr]);
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'ls-remote') {
      const ref = args.at(-1);
      const sha = ref === 'refs/heads/main' ? 'base123' : 'head456';
      return { ok: true, stdout: `${sha}\t${ref}\n`, stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff') return { ok: true, stdout: 'src/a.mjs\n', stderr: '' };
    if (command === 'gh') return { ok: true, stdout: 'pr-url', stderr: '' };
    throw new Error('unexpected command');
  };
  const result = ensureDraftPr('/repo', 274, state, 'head456', { runner, runJsonFn, configLoader });
  assert.equal(result.created, true);
  assert.equal(result.pr.number, 901);
  const create = calls.find((call) => call.command === 'gh');
  assert.ok(create.args.includes('--draft'));
  assert.equal(create.options.cwd, '/worktree');
  assert.equal(calls.some((call) => call.command === 'git' && call.args[0] === 'push'), false);
});

test('controller pushes a changed local head when the coder left the remote branch missing', () => {
  let reads = 0;
  let branchHead = null;
  const calls = [];
  const state = { issueTitle: 'Issue title', branch: 'ai/issue-274-attempt-4', worktreePath: '/worktree' };
  const pr = { number: 901, url: 'pr-url', isDraft: true, headRefOid: 'head456', baseRefName: 'main' };
  const runJsonFn = () => (++reads === 1 ? [] : [pr]);
  const runner = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'ls-remote') {
      const ref = args.at(-1);
      if (ref === 'refs/heads/main') return { ok: true, stdout: `base123\t${ref}\n`, stderr: '' };
      return { ok: true, stdout: branchHead ? `${branchHead}\t${ref}\n` : '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'push') {
      branchHead = 'head456';
      return { ok: true, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff') return { ok: true, stdout: 'src/a.mjs\n', stderr: '' };
    if (command === 'gh') return { ok: true, stdout: 'pr-url', stderr: '' };
    throw new Error('unexpected command');
  };

  const result = ensureDraftPr('/repo', 274, state, 'head456', { runner, runJsonFn, configLoader });
  assert.equal(result.created, true);
  assert.equal(result.pr.number, 901);
  const push = calls.find((call) => call.command === 'git' && call.args[0] === 'push');
  assert.deepEqual(push.args, [
    'push', '--set-upstream', 'origin', 'HEAD:refs/heads/ai/issue-274-attempt-4',
  ]);
  assert.equal(push.options.cwd, '/worktree');
  assert.equal(push.options.allowFailure, true);
});

test('unchanged local base head is not pushed as a fake issue branch', () => {
  let pushed = false;
  let created = false;
  const state = { branch: 'ai/issue-274-attempt-4', worktreePath: '/worktree' };
  const runner = (command, args) => {
    if (command === 'git' && args[0] === 'ls-remote') {
      const ref = args.at(-1);
      if (ref === 'refs/heads/main') return { ok: true, stdout: `head456\t${ref}\n`, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'push') pushed = true;
    if (command === 'gh') created = true;
    return { ok: true, stdout: '', stderr: '' };
  };

  assert.throws(
    () => ensureDraftPr('/repo', 274, state, 'head456', { runner, runJsonFn: () => [], configLoader }),
    (error) => error.code === 'CODER_BRANCH_NOT_PUSHED',
  );
  assert.equal(pushed, false);
  assert.equal(created, false);
});

test('stale remote head fails closed when the controller non-force push cannot advance it', () => {
  let created = false;
  let pushed = false;
  const state = { branch: 'ai/issue-274-attempt-4', worktreePath: '/worktree' };
  const runner = (command, args) => {
    if (command === 'git' && args[0] === 'ls-remote') {
      const ref = args.at(-1);
      if (ref === 'refs/heads/main') return { ok: true, stdout: `base123\t${ref}\n`, stderr: '' };
      return { ok: true, stdout: `oldhead\t${ref}\n`, stderr: '' };
    }
    if (command === 'git' && args[0] === 'push') {
      pushed = true;
      return { ok: false, stdout: '', stderr: 'rejected (non-fast-forward)' };
    }
    if (command === 'gh') created = true;
    return { ok: true, stdout: '', stderr: '' };
  };
  assert.throws(
    () => ensureDraftPr('/repo', 274, state, 'newhead', { runner, runJsonFn: () => [], configLoader }),
    (error) => error.code === 'CODER_BRANCH_NOT_PUSHED' && /non-fast-forward/.test(error.message),
  );
  assert.equal(pushed, true);
  assert.equal(created, false);
});
