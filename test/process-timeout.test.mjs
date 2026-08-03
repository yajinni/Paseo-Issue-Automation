import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from '../src/process.mjs';

test('external commands time out instead of hanging indefinitely', () => {
  const result = run(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
    allowFailure: true,
    timeoutMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.timeoutMs, 50);
});

test('command timeout errors expose structured timeout metadata', () => {
  assert.throws(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
    timeoutMs: 50,
  }), (error) => {
    assert.equal(error.timedOut, true);
    assert.equal(error.timeoutMs, 50);
    assert.match(error.message, /timed out after 50ms/);
    return true;
  });
});
