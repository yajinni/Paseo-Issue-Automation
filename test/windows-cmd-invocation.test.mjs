import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowsCmdInvocation } from '../src/process.mjs';

test('Windows cmd shims receive the outer quote pair required by cmd /s /c', () => {
  const executable = String.raw`C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd`;
  const invocation = buildWindowsCmdInvocation(executable, ['daemon', 'status', '--json'], {
    ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
  });

  assert.equal(invocation.executable, String.raw`C:\Windows\System32\cmd.exe`);
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);
  assert.equal(
    invocation.args[4],
    String.raw`""C:\Users\Yajinni\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd" "daemon" "status" "--json""`.replaceAll('\\"', '"'),
  );
  assert.doesNotMatch(invocation.args[4], /\\"C:/, 'the executable quote must not be escaped into a literal backslash-quote');
});

test('Windows cmd invocation protects spaces in executable paths and arguments', () => {
  const invocation = buildWindowsCmdInvocation(
    String.raw`C:\Program Files\Paseo\paseo.cmd`,
    ['workspace', 'create', '--title', 'Issue Coding Automation'],
    { COMSPEC: 'cmd.exe' },
  );

  assert.equal(
    invocation.args[4],
    String.raw`""C:\Program Files\Paseo\paseo.cmd" "workspace" "create" "--title" "Issue Coding Automation""`.replaceAll('\\"', '"'),
  );
});
