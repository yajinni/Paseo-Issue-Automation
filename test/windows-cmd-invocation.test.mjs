import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildWindowsCmdInvocation,
  materializePaseoOutputSchemaArgs,
  run,
} from '../src/process.mjs';

const structuredSchema = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
    headSha: { type: 'string', pattern: '^[0-9a-fA-F]{7,64}$' },
  },
});

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

test('inline Paseo output schema is materialized exactly and cleanup is idempotent', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paseo schema materialize-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const prepared = materializePaseoOutputSchemaArgs(
    ['run', '--output-schema', structuredSchema, 'review this pull request'],
    { tempRoot: directory },
  );

  assert.ok(prepared.schemaPath);
  assert.equal(path.isAbsolute(prepared.schemaPath), true);
  assert.equal(prepared.args[2], prepared.schemaPath);
  assert.notEqual(prepared.args[2], structuredSchema);
  assert.equal(readFileSync(prepared.schemaPath, 'utf8'), structuredSchema);
  assert.equal(prepared.args.at(-1), 'review this pull request');

  prepared.cleanup();
  assert.equal(existsSync(prepared.schemaPath), false);
  prepared.cleanup();
});

test('existing output schema file arguments are left untouched', () => {
  const args = ['run', '--output-schema', 'schema.json', 'review this pull request'];
  const prepared = materializePaseoOutputSchemaArgs(args);
  assert.equal(prepared.schemaPath, null);
  assert.deepEqual(prepared.args, args);
  prepared.cleanup();
});

test('Windows cmd payload receives the schema path instead of inline JSON', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paseo schema command-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const prepared = materializePaseoOutputSchemaArgs(
    ['run', '--output-schema', structuredSchema, 'review this pull request'],
    { tempRoot: directory },
  );
  try {
    const invocation = buildWindowsCmdInvocation(
      String.raw`C:\Program Files\Paseo\paseo.cmd`,
      prepared.args,
      { COMSPEC: 'cmd.exe' },
    );
    assert.ok(invocation.args[4].includes(prepared.schemaPath));
    assert.equal(invocation.args[4].includes(structuredSchema), false);
    assert.equal(readFileSync(prepared.schemaPath, 'utf8'), structuredSchema);
  } finally {
    prepared.cleanup();
  }
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

test('Windows paseo run transports inline output schema through a temporary file', {
  skip: process.platform !== 'win32',
}, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paseo schema live cmd-'));
  const bin = path.join(directory, 'bin');
  const capture = path.join(directory, 'captured-schema.json');
  const script = path.join(bin, 'paseo.cmd');
  mkdirSync(bin, { recursive: true });
  try {
    writeFileSync(
      script,
      '@echo off\r\ncopy /y "%~3" "%PASEO_SCHEMA_CAPTURE%" >nul\r\necho {"ok":true}\r\n',
      'utf8',
    );
    const inheritedPath = process.env.Path || process.env.PATH || '';
    const env = {
      ...process.env,
      Path: `${bin}${path.delimiter}${inheritedPath}`,
      PATH: `${bin}${path.delimiter}${inheritedPath}`,
      PASEO_SCHEMA_CAPTURE: capture,
    };
    const result = run('paseo', ['run', '--output-schema', structuredSchema, 'review this pull request'], {
      env,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true);
    assert.equal(readFileSync(capture, 'utf8'), structuredSchema);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});