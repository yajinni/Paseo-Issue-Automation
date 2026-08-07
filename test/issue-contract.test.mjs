import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  detectIssueTemplateVersion,
  ISSUE_TEMPLATE_VERSION,
  issueTemplateMarker,
  validateIssueBody,
} from '../src/issue-contract.mjs';

function validBody({ marker = true } = {}) {
  return `${marker ? `${issueTemplateMarker()}\n\n` : ''}## Objective\nShip a safe change\n\n## Required behavior\nChange the behavior deterministically\n\n## Acceptance criteria\n- [ ] Observable behavior is correct\n\n## Validation and checks\n- [ ] Run focused tests\n\n## Stop conditions\nStop if credentials would be exposed`;
}

test('installed template carries the v2 marker and paseo ready label', () => {
  const template = readFileSync(path.resolve('templates/automated-coding-task.md'), 'utf8');
  assert.match(template, /labels: "paseo:ready"/);
  assert.match(template, new RegExp(`paseo-issue-template:v${ISSUE_TEMPLATE_VERSION}`));
  assert.equal(detectIssueTemplateVersion(template), 2);
  assert.match(template, /Parent\/sub-issue hierarchy and dependency-like body references are not execution dependencies/);
});

test('v2 issue validation returns structured missing and invalid fields', () => {
  const body = validBody()
    .replace('Ship a safe change', '<!-- Required objective -->')
    .replace('- [ ] Run focused tests', '- [ ]');
  const result = validateIssueBody(body);
  assert.equal(result.ok, false);
  assert.equal(result.templateVersion, 2);
  assert.equal(result.legacyCompatible, false);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.invalidFields.map((entry) => [entry.field, entry.code]), [
    ['Objective', 'empty-section'],
    ['Validation and checks', 'empty-section'],
  ]);
  assert.deepEqual(result.missing, ['Objective', 'Validation and checks']);
});

test('pre-v2 valid issues remain accepted during the compatibility period', () => {
  const result = validateIssueBody(validBody({ marker: false }));
  assert.equal(result.ok, true);
  assert.equal(result.templateVersion, null);
  assert.equal(result.legacyCompatible, true);
});

test('newer unknown template versions fail closed without interpreting body content', () => {
  const body = validBody().replace(issueTemplateMarker(), '<!-- paseo-issue-template:v999 -->');
  const result = validateIssueBody(body);
  assert.equal(result.ok, false);
  assert.equal(result.templateVersion, 999);
  assert.deepEqual(result.invalidFields.map((entry) => entry.code), ['unsupported-template-version']);
});

test('comments, empty checkboxes, and placeholder-only required sections are not meaningful content', () => {
  for (const replacement of ['<!-- placeholder -->', '- [ ]', 'TODO', 'TBD', 'Add details here.']) {
    const result = validateIssueBody(validBody().replace('Ship a safe change', replacement));
    assert.equal(result.ok, false, replacement);
    assert.ok(result.invalidFields.some((entry) => entry.field === 'Objective'));
  }
});
