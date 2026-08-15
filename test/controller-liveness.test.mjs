import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerProcessIsLiveForRun } from '../src/controller-liveness.mjs';

const root = 'C:\\repo';
const commandLine = `"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\controller-worker.mjs" "${root}" "239" "3"`;

function live(overrides = {}, command = commandLine) {
  return controllerProcessIsLiveForRun(root, {
    issueNumber: 239,
    attempt: 3,
    controllerPid: 54748,
    ...overrides,
  }, {
    platform: 'win32',
    processAlive: () => true,
    commandLineReader: () => command,
  });
}

test('exact controller worker command line is live for the recorded attempt', () => {
  assert.equal(live(), true);
});

test('missing OS process is not live even when a persisted PID is positive', () => {
  assert.equal(controllerProcessIsLiveForRun(root, { issueNumber: 239, attempt: 3, controllerPid: 54748 }, {
    platform: 'win32',
    processAlive: () => false,
    commandLineReader: () => commandLine,
  }), false);
});

test('PID reuse by an unrelated process is not controller evidence', () => {
  assert.equal(live({}, '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile'), false);
});

test('controller from another repository is not owned by the recorded run', () => {
  assert.equal(live({}, '"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\controller-worker.mjs" "C:\\other-repo" "239" "3"'), false);
});

test('controller for another issue is not owned by the recorded run', () => {
  assert.equal(live({}, `"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\controller-worker.mjs" "${root}" "275" "3"`), false);
});

test('controller for another attempt is not owned by the recorded run', () => {
  assert.equal(live({}, `"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\controller-worker.mjs" "${root}" "239" "2"`), false);
});

test('recovery controller workers use the same ownership check', () => {
  assert.equal(live({}, `"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\recovery-controller-worker.mjs" "${root}" "239" "3"`), true);
});

test('legacy controller command lines remain identifiable without an attempt token', () => {
  assert.equal(live({}, `"C:\\Program Files\\nodejs\\node.exe" "C:\\package\\src\\controller-worker.mjs" "${root}" "239"`), true);
});
