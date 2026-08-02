import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  installIssueTemplate,
  installPaseoService,
  installationPreview,
  npmUninstallCommand,
  removeIssueTemplate,
  removePaseoIntegration,
} from '../src/install.mjs';
import { loadIntegration } from '../src/state.mjs';

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-issue-automation-life-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('integration state tracks labels and workspace ownership fields', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadIntegration(root).labels, {});
  assert.equal(loadIntegration(root).workspace, null);
});

test('preview describes create versus modify operations', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const preview = installationPreview(root);
  assert.equal(preview.files[0].action, 'create');
  assert.equal(preview.files[1].action, 'create');
  assert.match(preview.paseoWorkspace.title, /Issue Coding Automation/);
});

test('package-created files remain individually reversible', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const template = installIssueTemplate(root);
  const paseo = installPaseoService(root);
  assert.equal(existsSync(template.path), true);
  assert.equal(existsSync(paseo.path), true);
  removeIssueTemplate(root);
  removePaseoIntegration(root);
  assert.equal(existsSync(template.path), false);
  assert.equal(existsSync(paseo.path), false);
});

test('paseo cleanup removes only the managed service', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'paseo.json');
  writeFileSync(file, JSON.stringify({ scripts: { app: { command: 'npm start' } }, keep: true }));
  installPaseoService(root);
  removePaseoIntegration(root);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    scripts: { app: { command: 'npm start' } },
    keep: true,
  });
});

test('package removal command follows the repository package manager', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(npmUninstallCommand(root), 'npm uninstall paseo-issue-automation');
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  assert.equal(npmUninstallCommand(root), 'pnpm remove -D paseo-issue-automation');
});
