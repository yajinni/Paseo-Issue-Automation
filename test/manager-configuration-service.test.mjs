import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { managerConfigurationApiRequest } from '../src/manager-configuration-service.mjs';
import { addRepository } from '../src/repository-registry.mjs';
import { saveSetupPage, startSetupSession } from '../src/setup-wizard/store.mjs';

function fixture(t) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'paseo-manager-config-service-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const repositoryRoot = path.join(rootDir, 'Example');
  execFileSync('git', ['init', repositoryRoot], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:yajinni/Example.git'], { cwd: repositoryRoot });
  const repository = addRepository(repositoryRoot, { rootDir });
  startSetupSession({ rootDir });
  saveSetupPage('paseo', { selections: { host: '127.0.0.1:6767' } }, { rootDir });
  saveSetupPage('repository', {
    repository: { owner: 'yajinni', name: 'Example' },
    selections: { repository: 'yajinni/Example' },
  }, { rootDir });
  return { rootDir, repository };
}

function route(repository, suffix) {
  return `/api/repositories/${encodeURIComponent(repository.id)}/configuration/${suffix}`;
}

test('manager configuration discovers the coding harness catalog through the saved Paseo connection', async (t) => {
  const { rootDir, repository } = fixture(t);
  const response = await managerConfigurationApiRequest({
    method: 'GET',
    pathname: route(repository, 'harnesses'),
  }, {
    rootDir,
    credentialStore: { read: async () => ({ password: 'secret' }) },
    paseoContextFactory: ({ host, password }) => {
      assert.equal(host, '127.0.0.1:6767');
      assert.equal(password, 'secret');
      return { command: () => ({ ok: true, stdout: '', stderr: '' }) };
    },
    catalogLoader: async () => ({
      providers: [{ id: 'opencode', label: 'OpenCode', status: 'available', models: [] }],
      errors: [],
      complete: true,
      elapsedMs: 5,
    }),
  });
  assert.equal(response.handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.body.host, '127.0.0.1:6767');
  assert.deepEqual(response.body.catalog.providers.map((item) => item.id), ['opencode']);
});

test('manager configuration exposes live ChatGPT browser prerequisites', async (t) => {
  const { rootDir, repository } = fixture(t);
  const response = await managerConfigurationApiRequest({
    method: 'GET',
    pathname: route(repository, 'chatgpt-profile'),
  }, {
    rootDir,
    chatGptPrerequisites: () => ({
      libraryInstalled: true,
      chromiumInstalled: true,
      profileExists: true,
      conversationUrl: 'https://chatgpt.com/c/example',
      state: 'verification-required',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.status.libraryInstalled, true);
  assert.equal(response.body.status.chromiumInstalled, true);
  assert.equal(response.body.status.conversationUrl, 'https://chatgpt.com/c/example');
});

test('manager configuration saves a replacement Web ChatGPT review chat', async (t) => {
  const { rootDir, repository } = fixture(t);
  let stored = null;
  const response = await managerConfigurationApiRequest({
    method: 'POST',
    pathname: route(repository, 'chatgpt-profile/chat'),
    body: { conversationUrl: 'https://chatgpt.com/c/new-review-chat' },
  }, {
    rootDir,
    saveBrowserConfig: (value) => { stored = value; return value; },
    chatGptPrerequisites: () => ({
      libraryInstalled: true,
      chromiumInstalled: true,
      profileExists: true,
      conversationUrl: stored?.globalConversationUrl || null,
      state: 'verification-required',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(stored.globalConversationUrl, 'https://chatgpt.com/c/new-review-chat');
  assert.equal(response.body.status.conversationUrl, 'https://chatgpt.com/c/new-review-chat');
});

test('manager configuration opens the ChatGPT Profile only after browser prerequisites are ready', async (t) => {
  const { rootDir, repository } = fixture(t);
  let opened = false;
  const response = await managerConfigurationApiRequest({
    method: 'POST',
    pathname: route(repository, 'chatgpt-profile/open'),
  }, {
    rootDir,
    chatGptPrerequisites: () => ({
      libraryInstalled: true,
      chromiumInstalled: true,
      profileExists: true,
      conversationUrl: 'https://chatgpt.com/c/example',
      state: 'verification-required',
    }),
    openProfile: async ({ conversationUrl }) => { opened = conversationUrl === 'https://chatgpt.com/c/example'; return { leaseId: 'lease', page: {} }; },
    focusProfile: async () => ({ focused: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(opened, true);
  assert.equal(response.body.opened, true);
});
