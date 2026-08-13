import assert from 'node:assert/strict';
import {
  existsSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildWindowsCmdInvocation,
  buildWindowsPaseoDirectInvocation,
  materializePaseoOutputSchemaArgs,
  materializePaseoPromptArgs,
  run,
} from '../src/process.mjs';
import { REVIEW_WORKFLOW_OUTPUT_SCHEMA } from '../src/review-workflow-prompts.mjs';

const structuredSchema = REVIEW_WORKFLOW_OUTPUT_SCHEMA;

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

test('Windows paseo run transports the exact managed-review schema through a temporary file', {
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

test('Windows paseo run removes the temporary schema after a failed reviewer invocation', {
  skip: process.platform !== 'win32',
}, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paseo schema failed cmd-'));
  const bin = path.join(directory, 'bin');
  const capture = path.join(directory, 'captured-schema.json');
  const pathCapture = path.join(directory, 'schema-path.txt');
  const script = path.join(bin, 'paseo.cmd');
  mkdirSync(bin, { recursive: true });
  try {
    writeFileSync(
      script,
      '@echo off\r\ncopy /y "%~3" "%PASEO_SCHEMA_CAPTURE%" >nul\r\n> "%PASEO_SCHEMA_PATH_CAPTURE%" echo %~3\r\necho reviewer failed 1>&2\r\nexit /b 7\r\n',
      'utf8',
    );
    const inheritedPath = process.env.Path || process.env.PATH || '';
    const env = {
      ...process.env,
      Path: `${bin}${path.delimiter}${inheritedPath}`,
      PATH: `${bin}${path.delimiter}${inheritedPath}`,
      PASEO_SCHEMA_CAPTURE: capture,
      PASEO_SCHEMA_PATH_CAPTURE: pathCapture,
    };

    assert.throws(
      () => run('paseo', ['run', '--output-schema', structuredSchema, 'review this pull request'], {
        env,
        timeoutMs: 5_000,
      }),
      /reviewer failed/,
    );
    const temporarySchemaPath = readFileSync(pathCapture, 'utf8').trim();
    assert.equal(readFileSync(capture, 'utf8'), structuredSchema);
    assert.equal(existsSync(temporarySchemaPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function desktopFixture(t, prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const resources = path.join(root, 'Paseo Resources With Spaces');
  const bin = path.join(resources, 'bin');
  const unpackedRunner = path.join(resources, 'app.asar.unpacked', 'dist', 'daemon', 'node-entrypoint-runner.js');
  const archive = path.join(resources, 'app.asar');
  const paseoShim = path.join(bin, 'paseo.cmd');
  const paseoExecutable = path.join(root, 'Paseo.exe');
  mkdirSync(path.dirname(unpackedRunner), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(paseoShim, '@echo off\r\nexit /b 1\r\n', 'utf8');
  writeFileSync(archive, 'fixture archive', 'utf8');
  writeFileSync(
    unpackedRunner,
    [
      'const [, entry, mode, cliEntry, ...args] = process.argv;',
      'if (entry !== process.argv[1] || mode !== "node-script" || !cliEntry) process.exit(2);',
      'process.stdout.write(JSON.stringify({ args, env: { electron: process.env.ELECTRON_RUN_AS_NODE, cli: process.env.PASEO_CLI } }));',
    ].join('\n'),
    'utf8',
  );
  copyFileSync(process.execPath, paseoExecutable);
  const inheritedPath = process.env.Path || process.env.PATH || '';
  const env = {
    ...process.env,
    Path: `${bin}${path.delimiter}${inheritedPath}`,
    PATH: `${bin}${path.delimiter}${inheritedPath}`,
    USERPROFILE: root,
    HOME: root,
    HOMEDRIVE: '',
    HOMEPATH: '',
    LOCALAPPDATA: path.join(root, 'local app data'),
    APPDATA: path.join(root, 'app data'),
    ProgramFiles: path.join(root, 'program files'),
    ProgramW6432: path.join(root, 'program w6432'),
    'ProgramFiles(x86)': path.join(root, 'program files x86'),
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, bin, paseoShim, paseoExecutable, unpackedRunner, archive, env };
}

test('actual Windows paseo run path preserves every prompt line and hash', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = desktopFixture(t, 'paseo run multiline-');
  const prompt = 'quotes "double" and \'single\'\npercent %PATH%\r\nUnicode: café 漢字\nspaces and & | < > ^ !';
  const result = run('paseo', [
    'run', '--background', '--json', '--provider', 'fixture/provider',
    '--title', 'Issue #299 Coder', '--workspace', 'wks_test', prompt,
  ], { env: fixture.env, timeoutMs: 5_000 });
  const received = JSON.parse(result.stdout).args.at(-1);
  assert.equal(received, prompt);
  assert.equal(received.length, prompt.length);
  assert.equal(digest(received), digest(prompt));
  const direct = buildWindowsPaseoDirectInvocation(fixture.paseoShim, [
    'run', '--background', '--json', prompt,
  ], { env: fixture.env });
  assert.equal(direct.executable, fixture.paseoExecutable);
  assert.equal(direct.args.at(-1), prompt);
  assert.equal(direct.windowsVerbatimArguments, false);
});

function sendFixture(t, prefix, exitCode = 0) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const bin = path.join(root, 'bin with spaces');
  const capture = path.join(root, 'received prompt.txt');
  const pathCapture = path.join(root, 'prompt path.txt');
  const shim = path.join(bin, 'paseo.cmd');
  mkdirSync(bin, { recursive: true });
  writeFileSync(shim, [
    '@echo off',
    `copy /y "%~5" "%PASEO_PROMPT_CAPTURE%" >nul`,
    `> "%PASEO_PROMPT_PATH_CAPTURE%" echo %~5`,
    exitCode ? 'exit /b 7' : 'echo {"sent":true}',
  ].join('\r\n') + '\r\n', 'utf8');
  const inheritedPath = process.env.Path || process.env.PATH || '';
  const env = {
    ...process.env,
    Path: `${bin}${path.delimiter}${inheritedPath}`,
    PATH: `${bin}${path.delimiter}${inheritedPath}`,
    PASEO_PROMPT_CAPTURE: capture,
    PASEO_PROMPT_PATH_CAPTURE: pathCapture,
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, bin, shim, capture, pathCapture, env };
}

for (const [label, prompt] of [
  ['LF', 'one\ntwo\nquotes "x" %VALUE% café & | < > ^'],
  ['CRLF', 'one\r\ntwo\r\nquotes "x" %VALUE% café & | < > ^'],
]) {
  test(`actual Windows paseo send path preserves ${label} prompt bytes and cleans up`, {
    skip: process.platform !== 'win32',
  }, (t) => {
    const fixture = sendFixture(t, `paseo send ${label.toLowerCase()}-`);
    const result = run('paseo', ['send', 'agent_test', '--no-wait', prompt], {
      env: fixture.env,
      timeoutMs: 5_000,
    });
    const received = readFileSync(fixture.capture, 'utf8');
    assert.equal(result.ok, true);
    assert.equal(received, prompt);
    assert.equal(received.length, prompt.length);
    assert.equal(digest(received), digest(prompt));
    const temporaryPromptPath = readFileSync(fixture.pathCapture, 'utf8').trim();
    assert.equal(existsSync(temporaryPromptPath), false);
  });
}

test('actual Windows paseo send path cleans up the prompt file after failure', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = sendFixture(t, 'paseo send failure-', 7);
  assert.throws(() => run('paseo', ['send', 'agent_test', '--no-wait', 'line one\nline two'], {
    env: fixture.env,
    timeoutMs: 5_000,
  }), /exit 7/);
  const temporaryPromptPath = readFileSync(fixture.pathCapture, 'utf8').trim();
  assert.equal(existsSync(temporaryPromptPath), false);
});

test('Windows multiline paseo run fails closed when the direct desktop transport is unavailable', {
  skip: process.platform !== 'win32',
}, (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'paseo run unsafe-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'paseo.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
  const inheritedPath = process.env.Path || process.env.PATH || '';
  const env = {
    ...process.env,
    Path: `${bin}${path.delimiter}${inheritedPath}`,
    PATH: `${bin}${path.delimiter}${inheritedPath}`,
    USERPROFILE: root,
    HOME: root,
    HOMEDRIVE: '',
    HOMEPATH: '',
    LOCALAPPDATA: path.join(root, 'local app data'),
    APPDATA: path.join(root, 'app data'),
    ProgramFiles: path.join(root, 'program files'),
    ProgramW6432: path.join(root, 'program w6432'),
    'ProgramFiles(x86)': path.join(root, 'program files x86'),
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => run('paseo', ['run', 'line one\nline two'], { env, timeoutMs: 5_000 }), /refusing unsafe cmd\.exe fallback/);
});

test('prompt-file materialization is skipped outside Windows and preserves existing file options', () => {
  const args = ['send', 'agent', '--prompt-file', 'prompt.txt'];
  const prepared = materializePaseoPromptArgs(args, { platform: 'linux' });
  assert.deepEqual(prepared.args, args);
  assert.equal(prepared.promptPath, null);
  prepared.cleanup();
});

test('Windows multiline send fails closed when the prompt argument cannot be identified', () => {
  assert.throws(
    () => materializePaseoPromptArgs(['send', 'agent', '--unexpected', 'line one\nline two'], { platform: 'win32' }),
    /could not be identified for safe prompt-file transport/,
  );
});

test('Windows multiline run does not replace a custom resolved Paseo command with another candidate', () => {
  const custom = String.raw`C:\custom\paseo.cmd`;
  const bundled = String.raw`C:\Users\Julie\AppData\Local\Programs\Paseo\resources\bin\paseo.cmd`;
  const invocation = buildWindowsPaseoDirectInvocation(custom, ['run', 'line one\nline two'], {
    env: {
      USERPROFILE: String.raw`C:\Users\Julie`,
      LOCALAPPDATA: String.raw`C:\Users\Julie\AppData\Local`,
      APPDATA: String.raw`C:\Users\Julie\AppData\Roaming`,
      Path: '',
    },
    existsSync: (candidate) => candidate === bundled,
  });
  assert.equal(invocation, null);
});
