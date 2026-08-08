import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSmokeIssueBody, parseSmokeOptions } from '../scripts/disposable-github-smoke.mjs';

const script = fileURLToPath(new URL('../scripts/disposable-github-smoke.mjs', import.meta.url));

test('disposable smoke issue body satisfies the Paseo issue contract headings', () => {
  const body = buildSmokeIssueBody('paseo-live-smoke-123.txt', 'Paseo live smoke 123\n');
  assert.match(body, /<!-- paseo-issue-template:v2 -->/);
  assert.match(body, /## Objective/);
  assert.match(body, /## Required behavior/);
  assert.match(body, /## Acceptance criteria/);
  assert.match(body, /## Validation and checks/);
  assert.match(body, /## Stop conditions/);
  assert.match(body, /paseo-live-smoke-123\.txt/);
});

test('disposable smoke options remain explicit and bounded', () => {
  const options = parseSmokeOptions(['--root', '.', '--timeout-seconds', '90', '--poll-seconds', '2']);
  assert.equal(options.timeoutSeconds, 90);
  assert.equal(options.pollSeconds, 2);
  assert.equal(options.help, false);
});

test('disposable smoke help is safe without live opt-in or GitHub credentials', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASEO_LIVE_SMOKE=1/);
  assert.match(result.stdout, /disposable-repo/);
  assert.match(result.stdout, /does not merge or clean up/i);
});

test('disposable smoke refuses mutation without explicit opt-in before invoking GitHub', () => {
  const env = { ...process.env };
  delete env.PASEO_LIVE_SMOKE;
  delete env.PASEO_LIVE_SMOKE_REPOSITORY;
  const result = spawnSync(process.execPath, [script, '--root', process.cwd()], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing live mutation/);
});
