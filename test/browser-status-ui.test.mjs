import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_STATUS_UI_SCRIPT,
  browserSetupState,
} from '../src/browser-status-ui-script.mjs';
import { dashboardHtml } from '../src/ui.mjs';

test('browser setup state reports five explicit readiness requirements', () => {
  const state = browserSetupState({
    browser: {
      library: { installed: true },
      profile: {
        browserInstalledAt: '2026-08-05T01:00:00.000Z',
        lastAuthenticatedAt: '2026-08-05T01:10:00.000Z',
        locked: false,
      },
      config: {
        lastConversationUrl: 'https://chatgpt.com/c/project-chat',
      },
    },
    config: {
      browserReview: {
        projectConversationUrl: 'https://chatgpt.com/c/project-chat',
      },
    },
  });

  assert.equal(state.completed, 5);
  assert.equal(state.total, 5);
  assert.equal(state.percent, 100);
  assert.equal(state.profileLockLabel, 'Available');
  assert.deepEqual(state.rows.map((row) => row.label), [
    'Playwright Library',
    'Chromium Browser',
    'ChatGPT Authentication',
    'GPT Chat Selected',
    'Browser Verification',
  ]);
  assert.deepEqual(state.rows.map((row) => row.status), [
    'Installed',
    'Installed',
    'Signed In',
    'Selected',
    'Verified',
  ]);
});

test('browser setup state distinguishes missing, pending, and live lock states', () => {
  const state = browserSetupState({
    browser: {
      library: { installed: true },
      profile: { locked: true },
      config: {},
    },
    config: { browserReview: { projectConversationUrl: null } },
  });

  assert.equal(state.completed, 1);
  assert.equal(state.percent, 20);
  assert.equal(state.profileLockLabel, 'In Use');
  assert.equal(state.rows.find((row) => row.key === 'chromium').status, 'Not Installed');
  assert.equal(state.rows.find((row) => row.key === 'authentication').status, 'Not Signed In');
  assert.equal(state.rows.find((row) => row.key === 'conversation').status, 'Not Selected');
  assert.equal(state.rows.find((row) => row.key === 'verification').status, 'Not Tested');
});

test('browser verification is tied to the currently selected project chat', () => {
  const state = browserSetupState({
    browser: {
      library: { installed: true },
      profile: {
        browserInstalledAt: '2026-08-05T01:00:00.000Z',
        lastAuthenticatedAt: '2026-08-05T01:10:00.000Z',
      },
      config: {
        lastConversationUrl: 'https://chatgpt.com/c/previous-chat',
      },
    },
    config: {
      browserReview: {
        projectConversationUrl: 'https://chatgpt.com/c/new-chat',
      },
    },
  });

  assert.equal(state.completed, 4);
  assert.equal(state.percent, 80);
  assert.equal(state.rows.find((row) => row.key === 'verification').status, 'Ready to Test');
});

test('dashboard installs the mockup-based dedicated browser card and approved actions', () => {
  const html = dashboardHtml();
  assert.match(html, /Browser setup progress:/);
  assert.match(html, /Playwright Library/);
  assert.match(html, /Chromium Browser/);
  assert.match(html, /ChatGPT Authentication/);
  assert.match(html, /GPT Chat Selected/);
  assert.match(html, /Browser Verification/);
  assert.match(html, /Reset ChatGPT Credentials/);
  assert.match(html, /Use Current Conversation/);
  assert.match(html, /browser-action-grid/);
  assert.match(html, /dedicated-browser-card/);
});

test('dedicated browser runtime card removes secondary test and close controls', () => {
  assert.doesNotMatch(BROWSER_STATUS_UI_SCRIPT, /Send harmless test/);
  assert.doesNotMatch(BROWSER_STATUS_UI_SCRIPT, /Close browser/);
  assert.match(BROWSER_STATUS_UI_SCRIPT, /Test Destination/);
  assert.match(BROWSER_STATUS_UI_SCRIPT, /Uninstall Browser/);
});
