import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { importManagedPullRequest } from '../src/pr-review-import.mjs';
import { enqueueManagedReview, registerManagedPullRequest } from '../src/pr-review-queue.mjs';
import { loadPrReviewStore, savePrAutomationConfig } from '../src/pr-review-store.mjs';
import { saveConfig } from '../src/state.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-pr-review-import-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  saveConfig(root, { baseBranch: 'main' });
  savePrAutomationConfig(root, { reviewQueue: { paused: true } });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pr = {
    number: 45,
    url: 'https://github.com/owner/repo/pull/45',
    state: 'OPEN',
    isCrossRepository: false,
    headRefOid: HEAD,
    headRefName: 'feature/import-me',
    headRepository: { owner: { login: 'OWNER' }, name: 'Repo' },
    baseRefName: 'main',
    closingIssuesReferences: [{ number: 101, repository: { owner: { login: 'owner' }, name: 'repo' } }],
    ...overrides,
  };
  const issue = { number: 101, url: 'https://github.com/owner/repo/issues/101', state: 'OPEN' };
  return {
    root,
    pr,
    issue,
    options: {
      repositoryReader: () => ({ nameWithOwner: 'OWNER/REPO' }),
      prReader: () => pr,
      issueReader: () => issue,
      ensureLabels: false,
      setLabels: false,
      now: 1000,
    },
  };
}

test('manual import infers one same-repository issue and records canonical provenance', (t) => {
  const { root, options } = fixture(t);
  const result = importManagedPullRequest(root, { id: 'OWNER/Repo#45' }, options);
  assert.equal(result.imported, true);
  assert.equal(result.inferredIssue, true);
  assert.equal(result.managed.id, 'owner/repo#45');
  assert.equal(result.managed.repository, 'owner/repo');
  assert.equal(result.managed.provenance.type, 'manual-import');
  assert.equal(result.managed.provenance.headSha, HEAD);
  assert.equal(result.managed.provenance.baseBranch, 'main');
  assert.equal(result.managed.baseBranch, 'main');
  assert.equal(loadPrReviewStore(root).managedPullRequests.length, 1);
});

test('repeating the exact manual import is idempotent and preserves the configured review job', (t) => {
  const { root, options } = fixture(t);
  savePrAutomationConfig(root, {
    enabled: true,
    browserReview: { enabled: true },
    reviewQueue: { paused: false },
  });
  const first = importManagedPullRequest(root, { id: 'owner/repo#45' }, options);
  const second = importManagedPullRequest(root, { id: 'OWNER/REPO#45' }, { ...options, now: 2000 });
  assert.equal(second.imported, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.managed.provenance.importedAt, first.managed.provenance.importedAt);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 1);
  const review = enqueueManagedReview(root, 'OWNER/Repo#45', { immediate: true, now: 2000 });
  assert.equal(review.id, loadPrReviewStore(root).reviewJobs[0].id);
  assert.equal(loadPrReviewStore(root).reviewJobs.length, 1);
});

test('import rejects forks, wrong bases, stale heads, missing branches, and ambiguous associations', (t) => {
  const cases = [
    { pr: { isCrossRepository: true }, message: /Fork pull requests/ },
    { pr: { headRepository: { nameWithOwner: 'other/repo' } }, message: /head repository/ },
    { pr: { baseRefName: 'develop' }, message: /targets develop/ },
    { pr: { headRefOid: 'not-a-sha' }, message: /missing or stale current head/ },
    { pr: { headRefName: '' }, message: /no current head branch/ },
    { pr: { closingIssuesReferences: [{ number: 101, repository: { nameWithOwner: 'owner/repo' } }, { number: 102, repository: { nameWithOwner: 'owner/repo' } }] }, message: /multiple associated issues/ },
  ];
  for (const item of cases) {
    const { root, options } = fixture(t, item.pr);
    assert.throws(() => importManagedPullRequest(root, { id: 'owner/repo#45' }, options), item.message);
  }
  const { root, options } = fixture(t);
  assert.throws(
    () => importManagedPullRequest(root, { id: 'owner/repo#45', headSha: 'fedcba9876543210fedcba9876543210fedcba98' }, options),
    /does not match the requested exact head/,
  );
});

test('explicit issue association is required without a safe reference and rejects a pull request masquerading as an issue', (t) => {
  const { root, options, issue } = fixture(t, { closingIssuesReferences: [] });
  assert.throws(() => importManagedPullRequest(root, { id: 'owner/repo#45' }, options), /pass --issue explicitly/);
  const result = importManagedPullRequest(root, { id: 'owner/repo#45', issueNumber: issue.number }, options);
  assert.equal(result.inferredIssue, false);

  const masquerading = fixture(t, { closingIssuesReferences: [] });
  assert.throws(
    () => importManagedPullRequest(masquerading.root, { id: 'owner/repo#45', issueNumber: 101 }, {
      ...masquerading.options,
      issueReader: () => ({ number: 101, pull_request: { url: 'https://github.com/owner/repo/pull/101' } }),
    }),
    /not an associated issue/,
  );
});

test('conflicting PR and issue ownership fails closed', (t) => {
  const first = fixture(t);
  importManagedPullRequest(first.root, { id: 'owner/repo#45' }, first.options);
  assert.throws(
    () => importManagedPullRequest(first.root, { id: 'owner/repo#46', issueNumber: 101 }, {
      ...first.options,
      prReader: () => ({ ...first.pr, number: 46, url: 'https://github.com/owner/repo/pull/46' }),
    }),
    /conflicting PR\/issue identities/,
  );
});

test('multi-process imports atomically reject two PRs claiming one issue', async (t) => {
  const { root, pr, issue } = fixture(t);
  const importerUrl = pathToFileURL(path.resolve('src/pr-review-import.mjs')).href;
  const script = `
    import { existsSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    import { importManagedPullRequest } from ${JSON.stringify(importerUrl)};

    const root = process.env.PASEO_ROOT;
    const role = process.env.PASEO_ROLE;
    const peer = role === 'a' ? 'b' : 'a';
    function waitForPeer(prefix) {
      const ready = path.join(root, prefix + '-' + role);
      const peerReady = path.join(root, prefix + '-' + peer);
      writeFileSync(ready, 'ready');
      while (!existsSync(peerReady)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }

    const number = Number(process.env.PASEO_PR);
    const snapshot = {
      number,
      url: 'https://github.com/owner/repo/pull/' + number,
      state: 'OPEN',
      isCrossRepository: false,
      headRefOid: ${JSON.stringify(HEAD)},
      headRefName: 'feature/import-' + number,
      headRepository: { nameWithOwner: 'owner/repo' },
      baseRefName: 'main',
      closingIssuesReferences: [{ number: 101, repository: { nameWithOwner: 'owner/repo' } }],
    };
    const selectedIssue = { number: 101, url: 'https://github.com/owner/repo/issues/101', state: 'OPEN' };
    try {
      const result = importManagedPullRequest(root, { id: 'owner/repo#' + number }, {
        repositoryReader: () => ({ nameWithOwner: 'owner/repo' }),
        prReader: () => snapshot,
        issueReader: () => selectedIssue,
        labelEnsurer: () => waitForPeer('.import-race-label'),
        setLabels: false,
      });
      console.log(JSON.stringify({ ok: true, id: result.managed.id }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    }
  `;
  function run(role, number) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        cwd: path.resolve('.'),
        env: { ...process.env, PASEO_ROOT: root, PASEO_ROLE: role, PASEO_PR: String(number) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  const results = await Promise.all([run('a', 45), run('b', 46)]);
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(results.filter((result) => result.code !== 0).length, 1);
  assert.match(results.find((result) => result.code !== 0).stdout, /conflicting PR\/issue identities/);
  const store = loadPrReviewStore(root);
  assert.equal(store.managedPullRequests.length, 1);
  assert.equal(store.managedPullRequests[0].issueNumber, issue.number);
  assert.ok([pr.number, 46].includes(store.managedPullRequests[0].pullRequestNumber));
});

test('one pull request cannot be reassociated with a second issue after atomic registration', (t) => {
  const { root, options, pr, issue } = fixture(t, {
    closingIssuesReferences: [
      { number: 101, repository: { nameWithOwner: 'owner/repo' } },
      { number: 102, repository: { nameWithOwner: 'owner/repo' } },
    ],
  });
  options.issueReader = (_root, _repository, issueNumber) => ({ ...issue, number: issueNumber });
  importManagedPullRequest(root, { id: 'owner/repo#45', issueNumber: issue.number }, options);
  assert.throws(
    () => importManagedPullRequest(root, { id: `owner/repo#${pr.number}`, issueNumber: 102 }, options),
    /already managed for issue #101/,
  );
  assert.equal(loadPrReviewStore(root).managedPullRequests[0].issueNumber, 101);
});

test('controller-managed PRs cannot be reclassified as manual imports', (t) => {
  const { root, options, pr, issue } = fixture(t);
  registerManagedPullRequest(root, {
    repository: 'owner/repo',
    issueNumber: issue.number,
    issueUrl: issue.url,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    branchName: pr.headRefName,
    currentHeadSha: HEAD,
  });
  assert.throws(
    () => importManagedPullRequest(root, { id: 'owner/repo#45' }, options),
    /already managed by the controller|cannot be reclassified/,
  );
});
