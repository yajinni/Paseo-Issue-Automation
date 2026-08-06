import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { run } from '../src/process.mjs';
import { parsePorcelainStatus } from '../src/setup-pr.mjs';

test('run preserves the two Git porcelain status columns on the first line', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paseo-porcelain-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), '{"name":"example"}\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  writeFileSync(path.join(root, 'package.json'), '{"name":"changed"}\n');

  const output = run('git', ['status', '--porcelain=v1'], { cwd: root }).stdout;
  assert.equal(output.startsWith(' M package.json'), true);
  assert.deepEqual(parsePorcelainStatus(output), [{ status: ' M', path: 'package.json' }]);
});
