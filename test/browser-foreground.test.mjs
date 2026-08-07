import assert from 'node:assert/strict';
import test from 'node:test';
import { bringBrowserToForeground } from '../src/browser-foreground.mjs';

test('foreground helper activates the Playwright tab and requests window focus', async () => {
  let brought = 0;
  let evaluated = 0;
  const page = {
    async bringToFront() { brought += 1; },
    async evaluate() { evaluated += 1; },
  };
  const result = await bringBrowserToForeground(page, { platform: 'linux' });
  assert.equal(brought, 1);
  assert.equal(evaluated, 1);
  assert.deepEqual(result, { tabFocused: true, windowFocusRequested: true, osActivated: null });
});

test('foreground helper asks Windows to activate the Chromium browser process', async () => {
  const calls = [];
  let detached = false;
  const cdp = {
    async send(method) {
      assert.equal(method, 'SystemInfo.getProcessInfo');
      return { processInfo: [{ type: 'renderer', id: 11 }, { type: 'browser', id: 4242 }] };
    },
    async detach() { detached = true; },
  };
  const page = {
    async bringToFront() {},
    async evaluate() {},
    context() { return { async newCDPSession(input) { assert.equal(input, page); return cdp; } }; },
  };
  const result = await bringBrowserToForeground(page, {
    platform: 'win32',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, error: null };
    },
  });
  assert.equal(detached, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.match(calls[0].args.join(' '), /AppActivate\(4242\)/);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(result.osActivated, true);
});

test('foreground helper is best effort and does not fail login when focus activation fails', async () => {
  const page = {
    async bringToFront() { throw new Error('focus denied'); },
    async evaluate() { throw new Error('window focus denied'); },
    context() { return { async newCDPSession() { throw new Error('cdp unavailable'); } }; },
  };
  const result = await bringBrowserToForeground(page, { platform: 'win32' });
  assert.deepEqual(result, { tabFocused: false, windowFocusRequested: false, osActivated: null });
});
