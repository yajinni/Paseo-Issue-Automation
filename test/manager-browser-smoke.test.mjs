import assert from 'node:assert/strict';
import test from 'node:test';
import { managerDashboardHtml } from '../src/manager-server.mjs';

const enabled = process.env.PASEO_BROWSER_SMOKE === '1';
const ORIGIN = 'http://paseo.test';

function workItem(repositoryId) {
  const issueNumber = repositoryId === 'repo-a' ? 101 : 201;
  return {
    issueNumber,
    title: 'Synthetic browser smoke issue',
    issueUrl: `https://example.test/${repositoryId}/issues/${issueNumber}`,
    branch: `paseo/issue-${issueNumber}`,
    attempt: 1,
    stage: 'failed',
    stageLabel: 'Failed',
    nextAction: 'Recover',
    lifecycleLabel: 'Failed',
    phase: 'coding',
    workspaceId: `workspace-${repositoryId}`,
    startedAt: null,
    updatedAt: null,
    reason: 'Synthetic smoke failure',
    pullRequest: null,
    timeline: [],
    review: null,
  };
}

function statusFor(repositoryId) {
  const name = repositoryId === 'repo-a' ? 'Repo A' : 'Repo B';
  const item = workItem(repositoryId);
  return {
    repository: {
      id: repositoryId,
      repository: name,
      name,
      path: `/tmp/${repositoryId}`,
      remote: `https://example.test/${repositoryId}.git`,
      branch: 'main',
    },
    stateDirectory: `/tmp/state/${repositoryId}`,
    setup: {
      complete: true,
      baseBranch: 'main',
      workspaceId: `workspace-${repositoryId}`,
      managedLabelCount: 2,
      issueTemplateManaged: true,
      externalController: true,
      embeddedController: false,
      repositoryChanges: { managedFiles: [], expectedFiles: [], unexpectedFiles: [] },
      migration: { state: 'complete' },
    },
    capabilities: { installationActions: true, backgroundWorkers: true },
    configuration: {
      codingHarness: 'opencode',
      issueSelection: { mode: 'recommended-labels', temporaryFailureRetries: 3, excludedLabels: [] },
      review: { workflow: 'quick-manual', quickMaxRounds: 3, fullMaxRounds: 3, autoMergeApproved: false },
    },
    automation: {
      claimsEnabled: true,
      activeRunCount: 0,
      runCount: 1,
      maxActive: 2,
      pollIntervalSeconds: 120,
      maxReviewRounds: 3,
      lastDispatchAt: null,
      lastDispatchResult: null,
      statusCounts: { failed: 1 },
      skippedIssueNumbers: [],
    },
    worker: {
      running: true,
      intervalSeconds: 120,
      lastTickAt: null,
      lastScheduleReason: null,
      lastError: null,
      capacityError: null,
    },
    reviewWorker: {
      running: false,
      lastReviewTickAt: null,
      lastReviewError: null,
      lastReconciliationAt: null,
      lastReconciliationError: null,
      reviewTicking: false,
      reconciling: false,
    },
    models: {
      coder: 'test/coder',
      coderThinking: 'medium',
      reviewer: 'test/reviewer',
      reviewerThinking: 'high',
    },
    workQueue: {
      items: [item],
      counts: { failed: 1 },
      total: 1,
      active: 0,
      attention: 1,
    },
    blockers: [],
    operational: { issueProcessing: 'Ready', prReviews: 'Ready', blockingCount: 0 },
    maintenance: { removal: { state: 'Not started' } },
    chatGptProfile: { required: false, ready: true, known: true, summary: 'Not required', blockers: [] },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeManagerApi() {
  const statuses = new Map([
    ['repo-a', statusFor('repo-a')],
    ['repo-b', statusFor('repo-b')],
  ]);
  const delays = new Map();

  function armDelay(method, pathname) {
    const key = `${method.toUpperCase()} ${pathname}`;
    const seen = deferred();
    const release = deferred();
    const done = deferred();
    const entry = { seen, release, done };
    const queue = delays.get(key) || [];
    queue.push(entry);
    delays.set(key, queue);
    return {
      seen: seen.promise,
      done: done.promise,
      release: () => release.resolve(),
    };
  }

  function takeDelay(method, pathname) {
    const key = `${method.toUpperCase()} ${pathname}`;
    const queue = delays.get(key);
    if (!queue?.length) return null;
    const entry = queue.shift();
    if (!queue.length) delays.delete(key);
    return entry;
  }

  function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  }

  async function routeHandler(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (request.isNavigationRequest() && url.origin === ORIGIN && url.pathname === '/') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: managerDashboardHtml() });
      return;
    }

    const delay = takeDelay(method, url.pathname);
    if (delay) {
      delay.seen.resolve();
      await delay.release.promise;
    }

    try {
      if (method === 'GET' && url.pathname === '/api/repositories') {
        await json(route, {
          repositories: [
            { id: 'repo-a', repository: 'Repo A', name: 'Repo A' },
            { id: 'repo-b', repository: 'Repo B', name: 'Repo B' },
          ],
        });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/manager/status') {
        await json(route, {
          config: { globalMaxActive: 2 },
          manager: { active: 0, available: 2, runningWorkerCount: 0, pendingRepositoryIds: [], lastServedRepositoryId: null, errors: [] },
        });
        return;
      }

      const match = url.pathname.match(/^\/api\/repositories\/([^/]+)\/(.+)$/);
      if (!match) {
        await json(route, { error: `Unhandled smoke API path: ${method} ${url.pathname}` }, 404);
        return;
      }
      const repositoryId = decodeURIComponent(match[1]);
      const action = match[2];
      const current = statuses.get(repositoryId);
      if (!current) {
        await json(route, { error: 'Unknown synthetic repository.' }, 404);
        return;
      }

      if (method === 'GET' && action === 'status') {
        await json(route, { status: clone(current) });
        return;
      }
      if (method === 'GET' && action === 'configuration/paseo-connection') {
        await json(route, {
          status: {
            ok: true,
            host: '127.0.0.1:6767',
            source: 'browser-smoke',
            cli: { ok: true, path: 'paseo' },
            daemon: { reachable: true, version: 'smoke' },
            authentication: { required: false, ok: true },
            compatibility: { ok: true },
          },
        });
        return;
      }
      if (method === 'GET' && action === 'configuration/harnesses') {
        await json(route, { host: '127.0.0.1:6767', catalog: { providers: [{ id: 'opencode', label: 'OpenCode' }] } });
        return;
      }
      if (method === 'GET' && action === 'configuration/chatgpt-profile') {
        await json(route, { status: { libraryInstalled: true, chromiumInstalled: true, conversationUrl: null } });
        return;
      }
      if (method === 'GET' && action === 'issues-plan') {
        const item = workItem(repositoryId);
        await json(route, {
          issuePlan: {
            available: true,
            total: 1,
            active: 0,
            eligible: 0,
            blocked: 0,
            skipped: 0,
            items: [{ ...item, statusId: 'failed', status: 'Failed', processingOrder: null, dependencies: [], labels: [] }],
          },
        });
        return;
      }
      if (method === 'POST' && action === 'config') {
        const payload = request.postDataJSON();
        current.setup.baseBranch = payload.baseBranch;
        current.configuration.codingHarness = payload.codingHarness;
        current.configuration.issueSelection = clone(payload.issueSelection);
        current.configuration.review = clone(payload.review);
        current.models = { ...current.models, ...clone(payload.models) };
        current.automation.pollIntervalSeconds = payload.pollIntervalSeconds;
        current.automation.maxActive = payload.maxActive;
        await json(route, { status: clone(current), result: { saved: true } });
        return;
      }
      if (method === 'POST' && action === 'run-now') {
        await json(route, { result: { ok: true } }, 202);
        return;
      }

      await json(route, { result: { ok: true }, status: clone(current) });
    } finally {
      delay?.done.resolve();
    }
  }

  return { statuses, armDelay, routeHandler };
}

async function launchBrowser() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Manager browser smoke requires Playwright and a local Chromium binary. Install package dependencies and run \`npx playwright install chromium\` before setting PASEO_BROWSER_SMOKE=1.\n${error.message}`);
  }
}

test('manager browser smoke covers refresh save repository-switch drawer and legacy-history races', { skip: !enabled, timeout: 60_000 }, async () => {
  const browser = await launchBrowser();
  const api = fakeManagerApi();
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => api.routeHandler(route));

  try {
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.getElementById('manager-current-repository')?.textContent.includes('Repo A'));

    await page.locator('[data-manager-view-target="configuration"]').click();
    await page.locator('.manager-config-tab[data-config-tab="repository"]').click();
    const baseBranch = page.locator('#base-branch');
    await baseBranch.fill('draft-refresh');

    const refreshDelay = api.armDelay('GET', '/api/repositories/repo-a/status');
    await page.locator('#refresh-button').click();
    await refreshDelay.seen;
    refreshDelay.release();
    await refreshDelay.done;
    await page.waitForTimeout(50);
    assert.equal(await baseBranch.inputValue(), 'draft-refresh', 'Refresh must preserve the same-repository draft');

    const saveDelay = api.armDelay('POST', '/api/repositories/repo-a/config');
    await page.locator('#manager-config-save').click();
    await saveDelay.seen;
    await baseBranch.fill('draft-newer');
    saveDelay.release();
    await saveDelay.done;
    await page.locator('.manager-toast.success').last().waitFor();
    assert.equal(await baseBranch.inputValue(), 'draft-newer', 'newer edits typed during Save must survive the older save response');
    assert.equal(await page.locator('#manager-config-save').isEnabled(), true, 'newer edit should remain dirty and saveable');

    const actionDelay = api.armDelay('POST', '/api/repositories/repo-a/run-now');
    const lateAction = page.evaluate(() => window.postRepositoryAction('run-now'));
    await actionDelay.seen;
    await page.locator('#repository-select').selectOption('repo-b');
    await page.waitForFunction(() => document.getElementById('manager-current-repository')?.textContent.includes('Repo B'));
    actionDelay.release();
    const actionBody = await lateAction;
    assert.match(actionBody.result.message, /previously selected repository/i);
    await page.waitForFunction(() => [...document.querySelectorAll('.manager-toast.success')].some((item) => /previously selected repository/i.test(item.textContent)));

    await page.locator('[data-manager-view-target="work-queue"]').click();
    await page.locator('[data-work-details="true"]').first().click();
    const branchChoice = page.locator('#work-detail-branch-action');
    await branchChoice.selectOption('delete');
    await branchChoice.focus();
    const updatedRepoB = clone(api.statuses.get('repo-b'));
    updatedRepoB.workQueue.items[0].reason = 'Updated while drawer remained open';
    await page.evaluate((status) => window.renderStatus(status), updatedRepoB);
    assert.equal(await branchChoice.inputValue(), 'delete');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'work-detail-branch-action');
    assert.equal(await page.locator('#work-detail-drawer').isVisible(), true);

    await page.goto(`${ORIGIN}/?view=integration`);
    await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'configuration');
    assert.equal(await page.locator('.manager-config-tab[aria-selected="true"]').getAttribute('data-config-tab'), 'repository');
    assert.equal(await page.locator('.manager-config-step-link').count(), 0);
  } finally {
    await browser.close();
  }
});
