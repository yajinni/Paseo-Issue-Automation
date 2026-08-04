import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { repositoryDiscoveryAvailable } from '../src/server.mjs';

test('repository discovery is available before setup completion', () => {
  const snapshot = {
    config: { setupComplete: false },
    checks: { ready: false },
    requirements: {
      git: true,
      githubAuthenticated: true,
      remote: 'https://github.com/example/project.git',
    },
  };
  assert.equal(repositoryDiscoveryAvailable(snapshot), true);
});

test('repository discovery still requires a working authenticated remote', () => {
  const base = {
    requirements: {
      git: true,
      githubAuthenticated: true,
      remote: 'https://github.com/example/project.git',
    },
  };
  assert.equal(repositoryDiscoveryAvailable({ requirements: { ...base.requirements, git: false } }), false);
  assert.equal(repositoryDiscoveryAvailable({ requirements: { ...base.requirements, githubAuthenticated: false } }), false);
  assert.equal(repositoryDiscoveryAvailable({ requirements: { ...base.requirements, remote: null } }), false);
});

test('manual run-now HTTP action is not exposed', () => {
  const serverSource = readFileSync(fileURLToPath(new URL('../src/server.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(serverSource, /\/api\/run-now/);
});
