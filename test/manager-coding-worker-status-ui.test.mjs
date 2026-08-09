import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enhanceManagerWithCodingWorkerStatus,
  MANAGER_CODING_WORKER_STATUS_SCRIPT,
} from '../src/manager-coding-worker-status-ui.mjs';

test('coding worker status is normalized to Active or Idle everywhere it is surfaced', () => {
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /state === 'active' \? 'Active' : 'Idle'/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /overview-recent-activity/);
  assert.match(MANAGER_CODING_WORKER_STATUS_SCRIPT, /overview-coding-worker/);
  assert.doesNotMatch(MANAGER_CODING_WORKER_STATUS_SCRIPT, /Stopped/);
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

test('coding worker status enhancer appends after existing manager markup', () => {
  const html = enhanceManagerWithCodingWorkerStatus('<html><body><main id="manager"></main></body></html>');
  assert.match(html, /data-manager-coding-worker-status/);
  assert.match(html, /<main id="manager"><\/main>/);
});
