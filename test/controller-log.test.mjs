import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendControllerLog,
  controllerLogStatus,
  listControllerLogs,
  sanitizeLogDetails,
} from '../src/controller-log.mjs';
import {
  describeApiAction,
  logApiActionFailed,
  logApiActionStarted,
  logApiActionSucceeded,
} from '../src/server-action-log.mjs';
import { appendIssueLifecycle, statePaths } from '../src/state.mjs';

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-controller-log-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Paseo Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'paseo@example.test'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'Initial'], { cwd: root, stdio: 'ignore' });
  return root;
}

test('controller logs are append-only, newest-first, filterable, and redact sensitive fields', () => {
  const root = temporaryRepository();
  try {
    appendControllerLog(root, {
      id: 'first',
      timestamp: '2026-08-05T00:00:00.000Z',
      category: 'setup',
      action: 'install',
      message: 'Installed components.',
      details: { token: 'secret-token', nested: { password: 'secret-password', visible: 'kept' } },
    });
    appendControllerLog(root, {
      id: 'second',
      timestamp: '2026-08-05T00:01:00.000Z',
      level: 'warn',
      category: 'issues',
      action: 'blocked',
      status: 'waiting',
      message: 'Issue #12 is blocked.',
      details: { issueNumber: 12 },
    });
    appendControllerLog(root, {
      id: 'third',
      timestamp: '2026-08-05T00:02:00.000Z',
      level: 'error',
      category: 'pr-reviews',
      action: 'submit-review',
      status: 'failed',
      message: 'PR #7 review failed.',
      details: { pullRequestNumber: 7 },
    });

    const all = listControllerLogs(root, { limit: 20 });
    assert.deepEqual(all.events.map((event) => event.id), ['third', 'second', 'first']);
    assert.equal(all.events.at(-1).details.token, '[REDACTED]');
    assert.equal(all.events.at(-1).details.nested.password, '[REDACTED]');
    assert.equal(all.events.at(-1).details.nested.visible, 'kept');
    assert.deepEqual(all.categories, ['issues', 'pr-reviews', 'setup']);

    assert.deepEqual(listControllerLogs(root, { level: 'error' }).events.map((event) => event.id), ['third']);
    assert.deepEqual(listControllerLogs(root, { category: 'issues' }).events.map((event) => event.id), ['second']);
    assert.deepEqual(listControllerLogs(root, { query: 'issue #12' }).events.map((event) => event.id), ['second']);
    assert.deepEqual(listControllerLogs(root, { before: '2026-08-05T00:02:00.000Z' }).events.map((event) => event.id), ['second', 'first']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seven-day log queries merge issue lifecycle with controller events and exclude older history', () => {
  const root = temporaryRepository();
  try {
    appendControllerLog(root, {
      id: 'old-controller',
      timestamp: '2026-08-01T12:00:00.000Z',
      category: 'pr-reviews',
      action: 'old-review',
      message: 'Old review event.',
    });
    appendControllerLog(root, {
      id: 'recent-controller',
      timestamp: '2026-08-07T12:00:00.000Z',
      level: 'error',
      category: 'pr-reviews',
      action: 'submit-review',
      status: 'failed',
      message: 'Recent browser review failure.',
      details: { diagnostics: { screenshot: 'review-failed.png' } },
    });
    appendIssueLifecycle(root, 274, {
      id: 'old-lifecycle',
      at: '2026-08-01T13:00:00.000Z',
      attempt: 3,
      type: 'review-queued',
      status: 'success',
      message: 'Old lifecycle event.',
    });
    appendIssueLifecycle(root, 274, {
      id: 'recent-lifecycle',
      at: '2026-08-07T13:00:00.000Z',
      attempt: 4,
      type: 'review-queued',
      status: 'success',
      message: 'Queued current PR review.',
      evidence: { prNumber: 383 },
    });

    const weekly = listControllerLogs(root, { since: '2026-08-02T00:00:00.000Z', limit: 50 });
    assert.deepEqual(weekly.events.map((event) => event.id), [
      'issue-lifecycle:recent-lifecycle',
      'recent-controller',
    ]);
    assert.equal(weekly.events[0].category, 'issues');
    assert.equal(weekly.events[0].details.issueNumber, 274);
    assert.equal(weekly.events[0].details.evidence.prNumber, 383);
    assert.equal(weekly.events[1].details.diagnostics.screenshot, 'review-failed.png');
    assert.deepEqual(weekly.categories, ['issues', 'pr-reviews']);
    assert.equal(weekly.retention.days, 7);
    assert.equal(controllerLogStatus(root).retentionDays, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('controller logs live outside clearable controller ownership state', () => {
  const root = temporaryRepository();
  try {
    appendControllerLog(root, { action: 'test', message: 'test' });
    const status = controllerLogStatus(root);
    assert.equal(status.available, true);
    assert.equal(status.files.length, 1);
    assert.notEqual(status.directory, statePaths(root).root);
    assert.equal(path.dirname(status.directory), path.dirname(statePaths(root).root));
    assert.equal(path.basename(status.directory), 'paseo-issue-automation-logs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('log sanitization handles errors, cycles, depth, and long strings safely', () => {
  const value = { authorization: 'Bearer secret', error: new Error('boom') };
  value.self = value;
  const sanitized = sanitizeLogDetails(value);
  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.error.message, 'boom');
  assert.equal(sanitized.self, '[Circular reference]');
  assert.equal(sanitizeLogDetails('x'.repeat(3_000)).length, 2_001);
});

test('API action logging records safe request metadata without browser destinations or findings', () => {
  const root = temporaryRepository();
  try {
    const browser = describeApiAction('/api/pr-reviews/browser/open', {
      url: 'https://chatgpt.com/c/private',
      token: 'private-token',
    });
    assert.equal(browser.category, 'browser');
    assert.deepEqual(browser.details, {});

    const manual = describeApiAction('/api/pr-reviews/manual-result', {
      managedPullRequestId: 'owner/repo#7',
      result: 'changes_requested',
      findings: 'private code details',
    });
    assert.equal(manual.details.managedPullRequestId, 'owner/repo#7');
    assert.equal(manual.details.reviewResult, 'changes_requested');
    assert.equal(manual.details.findings, undefined);

    logApiActionStarted(root, '/api/start-issue', { issueNumber: 12 });
    logApiActionSucceeded(root, '/api/start-issue', { issueNumber: 12 }, { started: true, issueNumber: 12 }, Date.now());
    logApiActionFailed(root, '/api/start-issue', { issueNumber: 13 }, new Error('failed safely'), Date.now());
    const logs = listControllerLogs(root, { category: 'issues' }).events;
    assert.deepEqual(logs.map((event) => event.status), ['failed', 'success', 'started']);
    assert.equal(logs[0].details.error.message, 'failed safely');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
