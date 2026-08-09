import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithCodingWorkerStatus,
  MANAGER_CODING_WORKER_STATUS_SCRIPT,
  MANAGER_CODING_WORKER_STATUS_STYLE,
} from '../src/manager-coding-worker-status-ui.mjs';

test('coding worker status is normalized to Active or Idle everywhere it is surfaced', () => {
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /state === 'active' \? 'Active' : 'Idle'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /overview-recent-activity/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /overview-coding-worker/);
});

test('normal coding worker lifecycle buttons are removed while claims drive issue-processing state', () => {
  for (const action of ['worker/start', 'worker/stop', 'worker/restart']) {
    assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, new RegExp('data-action=\\"' + action.replace('/', '\\/')));
  }
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /automation\?\.claimsEnabled === true/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /stateValue\.textContent = running \? 'Running' : 'Paused'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /start\.disabled = claimsEnabled/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /pause\.disabled = !claimsEnabled/);
});

test('overview exposes Issue Claiming and PR Reviews as Enabled or Stopped icon controls', () => {
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /label: 'Issue Claiming'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /label: 'PR Reviews'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /enabled \? 'Enabled' : 'Stopped'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /button\.textContent = enabled \? '■' : '▶'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /startAction: 'resume'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /stopAction: 'pause'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /startAction: 'pr-review\/resume'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /stopAction: 'pr-review\/pause'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_STYLE, /overview-metric-action/);
});

test('overview Health reports Good or Issues Detected and opens a blocker list', () => {
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /title\.textContent = 'Health'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /healthy \? 'Good' : 'Issues Detected'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /overview-health-dialog/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /button\.textContent = '⚠'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /dialog\.showModal/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /blocker\?\.code === 'claims-paused'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /review-worker-stopped/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /setup\?\.complete !== true/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /worker\?\.lastError/);
  assert.match(MANAGER_CODING_WORKER_STATUS_STYLE, /overview-health-dialog/);
});

test('coding worker status enhancer appends after existing manager markup', () => {
  const html = enhanceManagerWithCodingWorkerStatus('<html><head></head><body><main id="manager"></main></body></html>');
  assert.match(html, /data-manager-coding-worker-status-style/);
  assert.match(html, /data-manager-coding-worker-status/);
  assert.match(html, /<main id="manager"><\/main>/);
});
