import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  installIssueTemplate,
  normalizeIssueTemplate,
  removeIssueTemplate,
  templateMatchesExpected,
} from '../src/install-legacy.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('issue template fingerprints treat LF and CRLF content as equivalent', () => {
  const expected = normalizeIssueTemplate('---\nname: Example\n---\n\n## Objective\n');
  const expectedSha = sha256(expected);
  const crlf = expected.replaceAll('\n', '\r\n');

  assert.equal(templateMatchesExpected(expected, expectedSha), true);
  assert.equal(templateMatchesExpected(crlf, expectedSha), true);
  assert.equal(templateMatchesExpected(`${crlf}changed\r\n`, expectedSha), false);
});

test('package-created issue templates remain removable after line-ending conversion', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-template-fingerprint-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const installed = installIssueTemplate(root);
  const current = readFileSync(installed.path, 'utf8');
  writeFileSync(installed.path, current.replaceAll('\n', '\r\n'));

  assert.doesNotThrow(() => removeIssueTemplate(root));
});
