import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendControllerLog } from '../src/controller-log.mjs';
import { managerApiRequest } from '../src/manager-api.mjs';
import { managerDashboardHtml } from '../src/manager-server.mjs';
import { MANAGER_WEEKLY_LOGS_SCRIPT } from '../src/manager-weekly-logs-ui.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { appendIssueLifecycle } from '../src/state.mjs';

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-weekly-logs-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Paseo Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'paseo@example.test'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/weekly-logs.git'], { cwd: root });
  return root;
}

test('standalone manager exposes a repository Logs tab for the rolling seven-day window', () => {
  const html = managerDashboardHtml();
  assert.match(html, /data-manager-weekly-logs/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /Last 7 days/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /Rolling 7-day window/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /data-manager-view-target.*logs/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /\/api\/repositories\/.*\/logs/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /weekly-logs-query/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /weekly-logs-level/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /weekly-logs-category/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /Copy visible/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /Download JSON/);
  assert.match(MANAGER_WEEKLY_LOGS_SCRIPT, /paseo:manager-ui-ready/);
});

test('repository weekly logs API returns controller and issue lifecycle events from the last seven days only', () => {
  const root = temporaryRepository();
  const managerRoot = mkdtempSync(path.join(os.tmpdir(), 'paseo-weekly-logs-manager-'));
  try {
    const repository = addRepository(root, { rootDir: managerRoot });
    const now = Date.now();
    const recent = new Date(now - 60_000).toISOString();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    appendControllerLog(root, {
      id: 'weekly-recent-review',
      timestamp: recent,
      level: 'error',
      category: 'pr-reviews',
      action: 'submit-pr-review',
      status: 'failed',
      message: 'ChatGPT did not visibly acknowledge the submitted review prompt.',
      details: { reviewJobId: 'review-123', diagnostics: { screenshot: 'failure.png' } },
    });
    appendControllerLog(root, {
      id: 'weekly-old-review',
      timestamp: old,
      category: 'pr-reviews',
      action: 'old-review',
      message: 'This event is outside the weekly window.',
    });
    appendIssueLifecycle(root, 274, {
      id: 'weekly-recent-lifecycle',
      at: recent,
      attempt: 4,
      type: 'review-queued',
      status: 'success',
      message: 'PR #383 queued for review.',
      evidence: { prNumber: 383 },
    });
    appendIssueLifecycle(root, 274, {
      id: 'weekly-old-lifecycle',
      at: old,
      attempt: 3,
      type: 'review-queued',
      status: 'success',
      message: 'Old queued review.',
    });

    const result = managerApiRequest({
      method: 'GET',
      pathname: `/api/repositories/${repository.id}/logs`,
    }, { rootDir: managerRoot });

    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.equal(result.body.retention.days, 7);
    assert.deepEqual(new Set(result.body.categories), new Set(['issues', 'pr-reviews']));
    assert.deepEqual(new Set(result.body.events.map((event) => event.id)), new Set([
      'weekly-recent-review',
      'issue-lifecycle:weekly-recent-lifecycle',
    ]));
    const review = result.body.events.find((event) => event.id === 'weekly-recent-review');
    assert.equal(review.details.reviewJobId, 'review-123');
    assert.equal(review.details.diagnostics.screenshot, 'failure.png');
    const issue = result.body.events.find((event) => event.id === 'issue-lifecycle:weekly-recent-lifecycle');
    assert.equal(issue.details.issueNumber, 274);
    assert.equal(issue.details.evidence.prNumber, 383);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(managerRoot, { recursive: true, force: true });
  }
});
