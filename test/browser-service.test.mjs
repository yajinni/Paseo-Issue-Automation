import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserContextLaunchOptions,
  locateMessageComposer,
} from '../src/browser-service.mjs';

function missingLocator() {
  return {
    last() { return this; },
    async waitFor() { throw new Error('not found'); },
    async isEnabled() { return false; },
  };
}

test('missing ChatGPT composer produces a recoverable browser failure', async () => {
  const locator = missingLocator();
  const page = {
    getByRole() { return locator; },
    locator() { return locator; },
  };
  await assert.rejects(locateMessageComposer(page, { timeoutMs: 1 }), /composer could not be located/);
});

test('headed ChatGPT browser uses the real maximized Chromium viewport', () => {
  const options = browserContextLaunchOptions({ headless: false });
  assert.equal(options.headless, false);
  assert.equal(options.viewport, null);
  assert.ok(options.args.includes('--start-maximized'));
  assert.ok(options.args.includes('--disable-blink-features=AutomationControlled'));
});

test('headless ChatGPT checks retain a deterministic viewport', () => {
  const options = browserContextLaunchOptions({ headless: true });
  assert.equal(options.headless, true);
  assert.deepEqual(options.viewport, { width: 1440, height: 1000 });
  assert.equal(options.args.includes('--start-maximized'), false);
});
