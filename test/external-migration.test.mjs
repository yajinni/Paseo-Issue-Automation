import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CONTROLLER_MODES, loadControllerMode, saveControllerMode } from '../src/controller-mode.mjs';
import {
  AUTOMATION_PACKAGE_NAME,
  createExternalMigrationPullRequest,
  dependencyLocation,
  loadExternalMigration,
  packageManagerRemoval,
  reconcileExternalMigration,
  removeManagedPaseoServiceFile,
  saveExternalMigration,
} from '../src/external-migration.mjs';
import { PASEO_SERVICE, PASEO_SERVICE_NAME } from '../src/install-legacy.mjs';
import { saveSetupPullRequest } from '../src/setup-pr.mjs';
import {
  loadConfig,
  loadIntegration,
  saveConfig,
  saveIntegration,
} from '../src/state.mjs';

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-external-migration-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  return root;
}

function embeddedRepository() {
  const root = repository();
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'example',
    dependencies: { [AUTOMATION_PACKAGE_NAME]: 'github:yajinni/Paseo-Issue-Automation' },
  }, null, 2) + '\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(path.join(root, 'paseo.json'), JSON.stringify({
    scripts: {
      other: { type: 'service', command: 'node other.mjs' },
      [PASEO_SERVICE_NAME]: PASEO_SERVICE,
    },
  }, null, 2) + '\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'embedded'], { cwd: root, stdio: 'ignore' });
  saveControllerMode(root, CONTROLLER_MODES.embedded);
  saveIntegration(root, {
    issueTemplate: { createdByPackage: true },
    paseoJson: {
      path: 'paseo.json',
      createdByPackage: false,
      serviceAddedByPackage: true,
      serviceName: PASEO_SERVICE_NAME,
    },
    labels: {},
    workspace: null,
  });
  const config = loadConfig(root);
  saveConfig(root, { ...config, baseBranch: 'main' });
  return root;
}

test('dependency location and package-manager removal are deterministic', () => {
  const root = repository();
  const manifest = {
    packageManager: 'pnpm@10.0.0',
    devDependencies: { [AUTOMATION_PACKAGE_NAME]: 'github:example/repo' },
  };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  assert.deepEqual(dependencyLocation(manifest), {
    section: 'devDependencies',
    specifier: 'github:example/repo',
  });
  assert.deepEqual(packageManagerRemoval(root, manifest), {
    manager: 'pnpm',
    command: 'pnpm',
    args: ['remove', AUTOMATION_PACKAGE_NAME],
  });

  writeFileSync(path.join(root, 'package.json'), '{"name":"example"}');
  writeFileSync(path.join(root, 'yarn.lock'), '');
  assert.equal(packageManagerRemoval(root).manager, 'yarn');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  assert.throws(() => packageManagerRemoval(root), /multiple lockfile families/);
});

test('migration removes only the package-managed paseo service', () => {
  const root = embeddedRepository();
  const result = removeManagedPaseoServiceFile(root);
  assert.equal(result.removedFile, false);
  const paseo = JSON.parse(readFileSync(path.join(root, 'paseo.json'), 'utf8'));
  assert.equal(paseo.scripts[PASEO_SERVICE_NAME], undefined);
  assert.deepEqual(paseo.scripts.other, { type: 'service', command: 'node other.mjs' });
  assert.equal(loadIntegration(root).paseoJson.serviceAddedByPackage, true, 'state changes only after merged migration synchronization');
});

test('migration refuses to compete with an unresolved setup PR', () => {
  const root = embeddedRepository();
  saveSetupPullRequest(root, {
    number: 379,
    state: 'open',
    syncedAt: null,
  });
  assert.throws(
    () => createExternalMigrationPullRequest(root),
    /Resolve setup PR #379/,
  );
  assert.equal(loadExternalMigration(root), null);
});

test('merged migration finalizes external mode only after local synchronization', () => {
  const root = embeddedRepository();
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  delete manifest.dependencies[AUTOMATION_PACKAGE_NAME];
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const paseo = JSON.parse(readFileSync(path.join(root, 'paseo.json'), 'utf8'));
  delete paseo.scripts[PASEO_SERVICE_NAME];
  writeFileSync(path.join(root, 'paseo.json'), JSON.stringify(paseo, null, 2) + '\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'merged migration'], { cwd: root, stdio: 'ignore' });
  saveExternalMigration(root, {
    number: 44,
    url: 'https://github.com/yajinni/example/pull/44',
    branch: 'ai/migrate-paseo-to-standalone-manager',
    baseBranch: 'main',
    state: 'open',
    syncedAt: null,
  });

  const runner = (command, args) => {
    if (command === 'git' && args[0] === 'status') return { ok: true, stdout: '', stderr: '' };
    if (command === 'git' && args[0] === 'branch') return { ok: true, stdout: 'main', stderr: '' };
    if (command === 'git' && args[0] === 'pull') return { ok: true, stdout: 'Already up to date.', stderr: '' };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  const result = reconcileExternalMigration(root, {
    runner,
    jsonRunner: () => ({
      number: 44,
      url: 'https://github.com/yajinni/example/pull/44',
      state: 'MERGED',
      mergedAt: '2026-08-06T12:00:00Z',
      headRefName: 'ai/migrate-paseo-to-standalone-manager',
      headRefOid: 'abc123',
      baseRefName: 'main',
    }),
  });
  assert.equal(result.completed, true);
  assert.equal(loadControllerMode(root), CONTROLLER_MODES.external);
  assert.equal(loadIntegration(root).paseoJson, null);
  assert.ok(result.migration.syncedAt);
});
