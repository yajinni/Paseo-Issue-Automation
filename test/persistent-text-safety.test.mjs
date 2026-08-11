import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendControllerLog,
  controllerLogStatus,
  listControllerLogs,
} from '../src/controller-log.mjs';
import {
  safeCommandErrorArgs,
  safeCommandErrorLabel,
  sanitizeDurableText,
  sanitizeRunStateForPersistence,
} from '../src/persistent-text-safety.mjs';
import { run } from '../src/process.mjs';
import { loadRun, runFile, saveRun } from '../src/state.mjs';

const PROMPT_SENTINEL = 'FULL REVIEW PROMPT MUST NEVER BE DURABLE';
const SCHEMA_SENTINEL = '{"type":"object","properties":{"summary":{"type":"string"}}}';
const PARSE_DETAIL = 'Unterminated string in JSON at position 855 (line 1 column 856)';
const LEGACY_FAILURE = `paseo run --provider fixture/reviewer --workspace wks_49e6c624fad052b4 --output-schema ${SCHEMA_SENTINEL} ${PROMPT_SENTINEL} failed: {"error":{"code":"INVALID_OUTPUT_SCHEMA","message":"Failed to parse output schema JSON","details":"${PARSE_DETAIL}"}}`;

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-persistent-text-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('legacy Paseo run failures keep useful parse evidence but remove command schema and prompt', () => {
  const sanitized = sanitizeDurableText(LEGACY_FAILURE);
  assert.match(sanitized, /^Paseo run failed:/);
  assert.match(sanitized, /INVALID_OUTPUT_SCHEMA/);
  assert.match(sanitized, /Failed to parse output schema JSON/);
  assert.match(sanitized, /position 855/);
  assert.doesNotMatch(sanitized, /fixture\/reviewer/);
  assert.doesNotMatch(sanitized, /output-schema/);
  assert.doesNotMatch(sanitized, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(sanitized, /properties/);
});

test('normal durable reasons are unchanged', () => {
  const reason = 'GitHub reports merge conflicts with the current base branch.';
  assert.equal(sanitizeDurableText(reason), reason);
});

test('Paseo agent command error metadata exposes only the subcommand', () => {
  const args = ['run', '--provider', 'fixture/reviewer', '--output-schema', SCHEMA_SENTINEL, PROMPT_SENTINEL];
  assert.equal(safeCommandErrorLabel('paseo', args), 'paseo run');
  assert.deepEqual(safeCommandErrorArgs('paseo', args), ['run']);
  assert.equal(safeCommandErrorLabel('git', ['status', '--short']), 'git status --short');
  assert.deepEqual(safeCommandErrorArgs('git', ['status', '--short']), ['status', '--short']);
});

test('run state persistence scrubs legacy prompt-bearing fields and nested lifecycle text', (t) => {
  const root = repository(t);
  const saved = saveRun(root, 239, {
    issueNumber: 239,
    attempt: 1,
    status: 'paseo:failed',
    phase: 'failed',
    reason: LEGACY_FAILURE,
    restartPreviousReason: `Restart failed: ${LEGACY_FAILURE}`,
    activity: [{ type: 'review-failed', details: LEGACY_FAILURE }],
    events: [{ event: 'review-runtime-failure', details: LEGACY_FAILURE }],
  });

  for (const value of [
    saved.reason,
    saved.restartPreviousReason,
    saved.activity[0].details,
    saved.events[0].details,
  ]) {
    assert.match(value, /INVALID_OUTPUT_SCHEMA/);
    assert.match(value, /position 855/);
    assert.doesNotMatch(value, new RegExp(PROMPT_SENTINEL));
    assert.doesNotMatch(value, /output-schema/);
  }

  const raw = readFileSync(runFile(root, 239), 'utf8');
  assert.doesNotMatch(raw, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(raw, /fixture\/reviewer/);
  assert.doesNotMatch(raw, /output-schema/);
  assert.match(raw, /INVALID_OUTPUT_SCHEMA/);
  assert.deepEqual(loadRun(root, 239), saved);
});

test('run state sanitizer does not rewrite unrelated activity and event text', () => {
  const state = {
    reason: 'ordinary failure',
    restartPreviousReason: 'ordinary previous failure',
    activity: [{ type: 'ci-failed', details: 'test (22): FAILURE' }],
    events: [{ event: 'review', summary: 'Reviewer requested one code change.' }],
  };
  assert.deepEqual(sanitizeRunStateForPersistence(state), state);
});

test('controller logs sanitize new and historical prompt-bearing free-form strings', (t) => {
  const root = repository(t);
  const fresh = appendControllerLog(root, {
    id: 'fresh-prompt-bearing',
    timestamp: '2026-08-11T05:00:00.000Z',
    level: 'error',
    category: 'issues',
    action: 'review-failed',
    status: 'failed',
    message: LEGACY_FAILURE,
    details: { reason: LEGACY_FAILURE },
  });
  assert.doesNotMatch(fresh.message, new RegExp(PROMPT_SENTINEL));
  assert.match(fresh.message, /INVALID_OUTPUT_SCHEMA/);
  assert.doesNotMatch(fresh.details.reason, new RegExp(PROMPT_SENTINEL));

  const historical = {
    id: 'historical-prompt-bearing',
    timestamp: '2026-08-11T04:59:00.000Z',
    level: 'error',
    category: 'issues',
    action: 'old-review-failed',
    status: 'failed',
    source: 'automation',
    message: LEGACY_FAILURE,
    details: { reason: LEGACY_FAILURE },
  };
  const file = path.join(controllerLogStatus(root).directory, 'events.jsonl');
  appendFileSync(file, `${JSON.stringify(historical)}\n`, 'utf8');

  const listed = listControllerLogs(root, { limit: 20 }).events;
  const old = listed.find((event) => event.id === historical.id);
  assert.ok(old);
  assert.match(old.message, /INVALID_OUTPUT_SCHEMA/);
  assert.match(old.details.reason, /position 855/);
  assert.doesNotMatch(old.message, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(old.details.reason, new RegExp(PROMPT_SENTINEL));
});

test('real Paseo run failure does not echo prompt or schema through Error.message or Error.args', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = repository(t);
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const paseo = path.join(bin, 'paseo');
  writeFileSync(paseo, '#!/bin/sh\necho synthetic reviewer failure 1>&2\nexit 7\n', 'utf8');
  chmodSync(paseo, 0o755);

  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
  let caught = null;
  try {
    run('paseo', ['run', '--provider', 'fixture/reviewer', '--output-schema', SCHEMA_SENTINEL, PROMPT_SENTINEL], {
      cwd: root,
      env,
      timeoutMs: 5_000,
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.message, 'Paseo run failed: synthetic reviewer failure');
  assert.deepEqual(caught.args, ['run']);
  assert.equal(caught.stderr, 'synthetic reviewer failure');
  assert.doesNotMatch(caught.message, new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(JSON.stringify(caught.args), new RegExp(PROMPT_SENTINEL));
  assert.doesNotMatch(caught.message, /output-schema/);
});
