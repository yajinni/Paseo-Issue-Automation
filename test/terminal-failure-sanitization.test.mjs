import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
import { terminalState } from '../src/automation.mjs';
import { loadRun, saveRun } from '../src/state.mjs';

const PROMPT_SENTINEL = 'FULL TERMINAL REVIEW PROMPT MUST NEVER BE DURABLE';
const LEGACY_FAILURE = `paseo run --provider fixture/reviewer --workspace wks_old --output-schema {"type":"object"} ${PROMPT_SENTINEL} failed: {"error":{"code":"INVALID_OUTPUT_SCHEMA","message":"Failed to parse output schema JSON","details":"Unterminated string in JSON at position 855"}}`;

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo-terminal-safety-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('terminal state sanitizes persisted reason and GitHub failure comment before dispatch', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = repository(t);
  const bin = path.join(root, 'bin');
  const capture = path.join(root, 'gh-args.txt');
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$PASEO_GH_CAPTURE"\n', 'utf8');
  chmodSync(gh, 0o755);

  saveRun(root, 239, {
    issueNumber: 239,
    attempt: 1,
    status: 'agent-running',
    phase: 'reviewing-light',
    activity: [],
    events: [],
  });

  const oldPath = process.env.PATH;
  const oldCapture = process.env.PASEO_GH_CAPTURE;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  process.env.PASEO_GH_CAPTURE = capture;
  try {
    const saved = terminalState(root, 239, 'blocked', LEGACY_FAILURE);
    assert.match(saved.reason, /^Paseo run failed:/);
    assert.match(saved.reason, /INVALID_OUTPUT_SCHEMA/);
    assert.match(saved.reason, /position 855/);
    assert.doesNotMatch(saved.reason, new RegExp(PROMPT_SENTINEL));
    assert.doesNotMatch(saved.reason, /output-schema/);

    const persisted = loadRun(root, 239);
    assert.equal(persisted.reason, saved.reason);
    const ghArgs = readFileSync(capture, 'utf8');
    assert.match(ghArgs, /Automation blocked: Paseo run failed:/);
    assert.match(ghArgs, /INVALID_OUTPUT_SCHEMA/);
    assert.doesNotMatch(ghArgs, new RegExp(PROMPT_SENTINEL));
    assert.doesNotMatch(ghArgs, /output-schema/);
    assert.doesNotMatch(ghArgs, /fixture\/reviewer/);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldCapture === undefined) delete process.env.PASEO_GH_CAPTURE;
    else process.env.PASEO_GH_CAPTURE = oldCapture;
  }
});
