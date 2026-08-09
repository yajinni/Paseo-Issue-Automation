import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForConversationReady } from '../src/browser-service.mjs';

function fakeComposer(sequence = []) {
  let sample = 0;
  const current = () => sequence[Math.min(sample, sequence.length - 1)] || {};
  return {
    async waitFor() {},
    async isEnabled() { return current().enabled !== false; },
    async isVisible() { return current().visible !== false; },
    async isEditable() { return current().editable !== false; },
    async scrollIntoViewIfNeeded() {},
    async boundingBox() {
      const value = current().box || { x: 20, y: 700, width: 900, height: 54 };
      sample += 1;
      return value;
    },
  };
}

function fakePage({
  url = 'https://chatgpt.com/c/abc123',
  readyState = 'complete',
  composerSequence = [],
  viewport = { width: 1200, height: 900 },
} = {}) {
  const composer = fakeComposer(composerSequence);
  let waits = 0;
  return {
    url() { return url; },
    async waitForFunction() {
      if (!['interactive', 'complete'].includes(readyState)) throw new Error('not ready');
    },
    async evaluate() { return { readyState, ...viewport }; },
    async waitForTimeout() { waits += 1; },
    getByRole() { return { last: () => composer }; },
    locator() { return { last: () => composer }; },
    waits() { return waits; },
  };
}

test('conversation readiness waits for a stable usable composer before returning', async () => {
  const page = fakePage({
    composerSequence: [
      { box: { x: 20, y: 700, width: 900, height: 54 } },
      { box: { x: 20, y: 680, width: 900, height: 54 } },
      { box: { x: 20, y: 680, width: 900, height: 54 } },
      { box: { x: 20, y: 680, width: 900, height: 54 } },
      { box: { x: 20, y: 680, width: 900, height: 54 } },
    ],
  });

  const composer = await waitForConversationReady(page, 'https://chatgpt.com/c/abc123', {
    timeoutMs: 5_000,
    stableSamples: 3,
    pollMs: 1,
  });

  assert.ok(composer);
  assert.ok(page.waits() >= 3);
});

test('conversation readiness refuses a composer outside the visible browser viewport', async () => {
  const page = fakePage({
    composerSequence: Array.from({ length: 20 }, () => ({
      box: { x: 20, y: 920, width: 900, height: 54 },
    })),
    viewport: { width: 1200, height: 900 },
  });

  await assert.rejects(
    waitForConversationReady(page, 'https://chatgpt.com/c/abc123', {
      timeoutMs: 20,
      stableSamples: 2,
      pollMs: 1,
    }),
    /usable message composer inside the visible browser viewport/i,
  );
});

test('conversation readiness fails closed if ChatGPT leaves the configured conversation', async () => {
  const page = fakePage({ url: 'https://chatgpt.com/' });
  await assert.rejects(
    waitForConversationReady(page, 'https://chatgpt.com/c/abc123', { timeoutMs: 20, pollMs: 1 }),
    /redirected to login or home/i,
  );
});
