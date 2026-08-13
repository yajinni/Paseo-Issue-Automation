import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sectionContent, slugify, validateIssueBody } from '../src/automation.mjs';
import {
  installIssueTemplate,
  installPaseoService,
  removeIssueTemplate,
  removePaseoIntegration,
} from '../src/install.mjs';
import { validateConfig, WORKSPACE_TITLE } from '../src/state.mjs';

test('workspace title is stable', () => {
  assert.equal(WORKSPACE_TITLE, 'Issue Coding Automation');
});

test('configuration uses one base branch and allows the same coder and reviewer model', () => {
  const config = validateConfig({
    baseBranch: 'main',
    models: { orchestrator: 'opencode/model-a', coder: 'opencode/model-b', reviewer: 'opencode/model-b' },
  });
  assert.equal(config.baseBranch, 'main');
  assert.equal(config.models.coder, config.models.reviewer);
});

test('issue validation requires issue-owned checks', () => {
  const body = `## Objective\nShip it\n## Required behavior\nChange it\n## Acceptance criteria\n- [ ] Works\n## Validation and checks\n- [ ] Run focused test\n## Stop conditions\nBlock on ambiguity`;
  assert.equal(validateIssueBody(body).ok, true);
  assert.equal(sectionContent(body, 'Validation and checks'), '- [ ] Run focused test');
  assert.equal(validateIssueBody(body.replace('- [ ] Run focused test', '')).ok, false);
  const placeholdersOnly = body.replace('- [ ] Run focused test', '<!-- Add a check. -->\n- [ ]');
  assert.equal(validateIssueBody(placeholdersOnly).ok, false);
});

test('branch slug is deterministic', () => {
  assert.equal(slugify('Fix login / redirect!'), 'fix-login-redirect');
});

test('branch slug trims separators introduced by the length limit', () => {
  const title = 'Make Overview Start/Stop controls authoritative for Issue Claiming and PR Reviews';
  assert.equal(slugify(title), 'make-overview-start-stop-controls-authoritative');
  assert.equal(slugify(title).length, 47);
  assert.doesNotMatch(slugify(title), /^-|-$|--/);
});

function temporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-issue-automation-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('package-created issue template can be safely removed', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const installed = installIssueTemplate(root);
  assert.equal(installed.created, true);
  assert.equal(existsSync(installed.path), true);

  removeIssueTemplate(root);
  assert.equal(existsSync(installed.path), false);
});

test('changed package-created issue template is preserved', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const installed = installIssueTemplate(root);
  writeFileSync(installed.path, `${readFileSync(installed.path, 'utf8')}\ncustom change\n`);
  assert.throws(() => removeIssueTemplate(root), /changed since installation/);
  assert.equal(existsSync(installed.path), true);
});

test('removing a paseo.json addition preserves unrelated settings', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'paseo.json');
  writeFileSync(file, `${JSON.stringify({ setup: { command: 'example' } }, null, 2)}\n`);

  const installed = installPaseoService(root);
  assert.equal(installed.modified, true);
  removePaseoIntegration(root);

  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { setup: { command: 'example' } });
});

test('package-created paseo.json is removed when it contains only the managed service', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const installed = installPaseoService(root);
  assert.equal(installed.created, true);
  const removed = removePaseoIntegration(root);
  assert.equal(removed.removedFile, true);
  assert.equal(existsSync(installed.path), false);
});
