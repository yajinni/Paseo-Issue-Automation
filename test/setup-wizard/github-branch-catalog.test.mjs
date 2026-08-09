import assert from 'node:assert/strict';
import test from 'node:test';
import { listAllGitHubBranches } from '../../src/setup-wizard/github-repositories.mjs';

function result(data) {
  return { ok: true, exitCode: 0, stdout: JSON.stringify(data), stderr: '' };
}

function branchPage(nodes, pageInfo) {
  return {
    data: {
      repository: {
        defaultBranchRef: { name: 'main' },
        refs: { nodes, pageInfo },
      },
    },
  };
}

test('shared GitHub branch discovery follows every page and preserves the default recommendation', () => {
  const pages = [
    branchPage([{ name: 'feature/one', target: { oid: '111' } }], { hasNextPage: true, endCursor: 'next' }),
    branchPage([{ name: 'main', target: { oid: '222' } }], { hasNextPage: false, endCursor: null }),
  ];
  const calls = [];
  const catalog = listAllGitHubBranches('acme/project', {
    host: 'github.example.com',
    pageSize: 1,
    runner(_command, args) {
      calls.push([...args]);
      return result(pages.shift());
    },
  });

  assert.equal(catalog.ok, true);
  assert.equal(catalog.repository, 'acme/project');
  assert.equal(catalog.recommended, 'main');
  assert.deepEqual(catalog.branches.map((branch) => branch.name), ['feature/one', 'main']);
  assert.equal(catalog.branches.find((branch) => branch.name === 'main').recommended, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('github.example.com'));
  assert.ok(calls[1].includes('after=next'));
});
