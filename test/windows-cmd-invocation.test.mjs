import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildWindowsCmdInvocation, run } from '../src/process.mjs';

test('Windows batch shims use call with a verbatim cmd payload', () => {
  const executable = String.raw`C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd`;
  const invocation = buildWindowsCmdInvocation(executable, ['daemon', 'status', '--json'], {
    ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
  });

  assert.equal(invocation.executable, String.raw`C:\Windows\System32\cmd.exe`);
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);
  assert.equal(
    invocation.args[4],
    String.raw`call "C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd" "daemon" "status" "--json"`.replaceAll('\\"', '"'),
  );
  assert.equal(invocation.windowsVerbatimArguments, true);
  assert.doesNotMatch(invocation.args[4], /^"/, 'the /c payload must begin with call, not a nested quote');
  assert.doesNotMatch(invocation.args[4], /\\"C:/, 'the executable quote must not become a literal backslash-quote');
});

test('the exact Paseo compatibility probe from the reported failure is preserved', () => {
  const invocation = buildWindowsCmdInvocation(
    String.raw`C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd`,
    ['ls', '-a', '-g', '--json'],
    { COMSPEC: 'cmd.exe' },
  );

  assert.equal(
    invocation.args[4],
    String.raw`call "C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd" "ls" "-a" "-g" "--json"`.replaceAll('\\"', '"'),
  );
});

test('Windows cmd invocation protects spaces in executable paths and arguments', () => {
  const invocation = buildWindowsCmdInvocation(
    String.raw`C:\Program Files\Paseo\paseo.cmd`,
    ['workspace', 'create', '--title', 'Issue Coding Automation'],
    { COMSPEC: 'cmd.exe' },
  );

  assert.equal(
    invocation.args[4],
    String.raw`call "C:\Program Files\Paseo\paseo.cmd" "workspace" "create" "--title" "Issue Coding Automation"`.replaceAll('\\"', '"'),
  );
});

test('run executes a real cmd file with spaces in its path and arguments', {
  skip: process.platform !== 'win32',
}, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paseo cmd test-'));
  const script = path.join(directory, 'fake paseo.cmd');
  try {
    writeFileSync(
      script,
      '@echo off\r\necho {"args":["%~1","%~2","%~3","%~4"]}\r\n',
      'utf8',
    );
    const result = run(script, ['workspace', 'create', '--title', 'Issue Coding Automation'], {
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ['workspace', 'create', '--title', 'Issue Coding Automation'],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
