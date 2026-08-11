import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CONTROLLER_MODES,
  loadControllerMode,
  saveControllerMode,
  usesExternalController,
} from '../src/controller-mode.mjs';
import { LIFECYCLE_LABEL_CATALOG } from '../src/label-catalog.mjs';
import { buildSetupSnapshot } from '../src/setup-snapshot.mjs';
import {
  EXTERNAL_SETUP_COMMIT_FILES,
  SETUP_COMMIT_FILES,
  setupChangeStatus,
  setupCommitFiles,
} from '../src/setup-pr.mjs';
import { loadConfig, saveConfig, saveIntegration } from '../src/state.mjs';

function repository(name = 'repo') {
  const parent = mkdtempSync(path.join(tmpdir(), 'paseo-external-mode-'));
  const root = path.join(parent, name);
  execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  mkdirSync(path.join(root, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  writeFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'automated-coding-task.md'), 'initial\n');
  writeFileSync(path.join(root, 'package.json'), '{"name":"example"}\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(path.join(root, 'paseo.json'), '{}\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  return root;
}

test('controller mode persists outside tracked repository files', () => {
  const root = repository();
  assert.equal(loadControllerMode(root), null);
  const saved = saveControllerMode(root, CONTROLLER_MODES.external);
  assert.equal(saved.mode, CONTROLLER_MODES.external);
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.external);
  assert.equal(usesExternalController(root), true);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});

test('external mode manages only the issue template, never package or launcher files', () => {
  const root = repository();
  saveControllerMode(root, CONTROLLER_MODES.external);
  writeFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', 'automated-coding-task.md'), 'changed\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  writeFileSync(path.join(root, 'paseo.json'), '{"scripts":{"other":{}}}\n');

  assert.deepEqual(setupCommitFiles(root), [...EXTERNAL_SETUP_COMMIT_FILES]);
  assert.ok(SETUP_COMMIT_FILES.includes('package-lock.json'));
  assert.ok(!EXTERNAL_SETUP_COMMIT_FILES.includes('package-lock.json'));
  assert.ok(!EXTERNAL_SETUP_COMMIT_FILES.includes('package.json'));
  assert.ok(!EXTERNAL_SETUP_COMMIT_FILES.includes('paseo.json'));

  const external = setupChangeStatus(root);
  assert.deepEqual(external.expectedFiles, ['.github/ISSUE_TEMPLATE/automated-coding-task.md']);
  assert.deepEqual(external.unexpectedFiles, ['package-lock.json', 'paseo.json']);

  const embedded = setupChangeStatus(root, { mode: CONTROLLER_MODES.embedded });
  assert.deepEqual(embedded.expectedFiles, [
    '.github/ISSUE_TEMPLATE/automated-coding-task.md',
    'package-lock.json',
    'paseo.json',
  ]);
  assert.deepEqual(embedded.unexpectedFiles, []);
});

test('external setup is ready without a paseo.json service or npm dependency', () => {
  const root = repository();
  saveControllerMode(root, CONTROLLER_MODES.external);
  const current = loadConfig(root);
  saveConfig(root, {
    ...current,
    baseBranch: 'main',
    models: { ...current.models, coder: 'opencode/coder', reviewer: 'opencode/reviewer' },
    workspace: { id: 'workspace-one', title: 'Issue Coding Automation' },
  });
  saveIntegration(root, {
    issueTemplate: { path: '.github/ISSUE_TEMPLATE/automated-coding-task.md', createdByPackage: true },
    paseoJson: null,
    labels: Object.fromEntries(Object.keys(LIFECYCLE_LABEL_CATALOG).map((name) => [name, { createdByPackage: true }])),
    workspace: { id: 'workspace-one', createdByPackage: true },
  });
  const labels = Object.values(LIFECYCLE_LABEL_CATALOG).map(({ name, color, description }) => ({ name, color, description }));
  const requirements = {
    git: true,
    githubCli: true,
    githubAuthenticated: true,
    paseoCli: true,
    paseoReachable: true,
    remote: 'git@github.com:yajinni/example.git',
  };

  const external = buildSetupSnapshot(root, {
    requirements,
    branches: [{ name: 'main' }],
    liveState: { labels, workspace: { id: 'workspace-one', title: 'Issue Coding Automation' } },
    controllerMode: CONTROLLER_MODES.external,
  });
  assert.equal(external.checks.ready, true);
  assert.equal(external.checks.controllerReady, true);
  assert.equal(external.integration.externalController, true);
  assert.equal(external.integration.paseoService, false);
  assert.equal(external.preview.files.length, 1);
  assert.equal(external.preview.files[0].path, '.github/ISSUE_TEMPLATE/automated-coding-task.md');
  assert.equal(external.preview.packageDependency.action, 'none');
  assert.equal(external.npmUninstallCommand, null);

  const embedded = buildSetupSnapshot(root, {
    requirements,
    branches: [{ name: 'main' }],
    liveState: { labels, workspace: { id: 'workspace-one', title: 'Issue Coding Automation' } },
    controllerMode: CONTROLLER_MODES.embedded,
  });
  assert.equal(embedded.checks.ready, false);
  assert.equal(embedded.checks.controllerReady, false);
  assert.equal(embedded.preview.files.some((item) => item.path === 'paseo.json'), true);
});
