import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  playwrightCommand,
  playwrightInstallArgs,
} from '../src/browser-service.mjs';

test('Playwright is a required project dependency', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.dependencies.playwright, '^1.61.1');
  assert.equal(packageJson.optionalDependencies, undefined);
});

test('Chromium installation uses Playwright standard commands', () => {
  assert.equal(playwrightCommand('win32'), 'npx.cmd');
  assert.equal(playwrightCommand('darwin'), 'npx');
  assert.equal(playwrightCommand('linux'), 'npx');
  assert.deepEqual(playwrightInstallArgs('win32'), ['playwright', 'install', 'chromium']);
  assert.deepEqual(playwrightInstallArgs('darwin'), ['playwright', 'install', 'chromium']);
  assert.deepEqual(playwrightInstallArgs('linux'), ['playwright', 'install', '--with-deps', 'chromium']);
});

test('browser service does not resolve Playwright internal CLI files', () => {
  const source = readFileSync(new URL('../src/browser-service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /playwright-core/);
  assert.doesNotMatch(source, /require\.resolve\(['"]playwright[^'"]*\/cli/);
  assert.match(source, /import\('playwright'\)/);
  assert.match(source, /\['playwright', 'install', '--with-deps', 'chromium'\]/);
});
