import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadRun, runFile } from '../src/state.mjs';

const PROMPT_SENTINEL = 'LEGACY REVIEW PROMPT SHOULD BE MIGRATED ON READ';
const LEGACY_FAILURE = `paseo run --provider fixture/reviewer --output-schema {"type":"object"} ${PROMPT_SENTINEL} failed: {"error":{"code":"INVALID_OUTPUT_SCHEMA","message":"Failed to parse output schema JSON","details":"Unterminated string in JSON at position 855"}}`;

test('loadRun rewrites legacy prompt-bearing failure fields before returning them', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-run-state-migration-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const file = runFile(root, 239);
  writeFileSync(file, `${JSON.stringify({
    issueNumber: 239,
    attempt: 1,
    status: 'paseo:failed',
    phase: 'failed',
    reason: 'Review retry exhausted.',
    restartPreviousReason: LEGACY_FAILURE,
    activity: [{ type: 'old-review-failed', details: LEGACY_FAILURE }],
  }, null, 2)}\n`, 'utf8');
  assert.match(readFileSync(file, 'utf8'), new RegExp(PROMPT_SENTINEL));

  const loaded = loadRun(root, 239);
  assert.match(loaded.restartPreviousReason, /INVALID_OUTPUT_SCHEMA/);
  assert.match(loaded.restartPreviousReason, /position 855/);
  assert.doesNotMatch(loaded.restartPreviousReason, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(loaded.activity[0].details, new RegExp(PROMPT_SENTINEL));

  const migrated = readFileSync(file, 'utf8');
  assert.doesNotMatch(migrated, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(migrated, /output-schema/);
  assert.doesNotMatch(migrated, /fixture\/reviewer/);
  assert.match(migrated, /INVALID_OUTPUT_SCHEMA/);
});
