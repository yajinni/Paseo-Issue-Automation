import assert from 'node:assert/strict';
import test from 'node:test';
import { locateMessageComposer } from '../src/browser-service.mjs';

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
