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
});

test('stale remote head is recoverable coder handoff failure, not PR creation', () => {
  let created = false;
  const state = { branch: 'ai/issue-274-attempt-4', worktreePath: '/worktree' };
  const runner = (command, args) => {
    if (command === 'git' && args[0] === 'ls-remote') {
      const ref = args.at(-1);
      return { ok: true, stdout: `oldhead\t${ref}\n`, stderr: '' };
    }
    if (command === 'gh') created = true;
    return { ok: true, stdout: '', stderr: '' };
  };
  assert.throws(
    () => ensureDraftPr('/repo', 274, state, 'newhead', { runner, runJsonFn: () => [], configLoader }),
    (error) => error.code === 'CODER_BRANCH_NOT_PUSHED',
  );
  assert.equal(created, false);
});
