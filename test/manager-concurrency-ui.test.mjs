import assert from 'node:assert/strict';
import test from 'node:test';
import { managerHtml } from '../src/manager-concurrency-ui.mjs';

test('manager capacity polling preserves an unsaved input edit', () => {
  const html = managerHtml();
  assert.match(html, /let managerCapacityDirty = false/);
  assert.match(html, /addEventListener\('input', \(\) => \{ managerCapacityDirty = true; \}\)/);
  assert.match(html, /if \(input && !managerCapacityDirty\) input\.value = config\.globalMaxActive \|\| manager\.globalMaxActive \|\| 2/);
  assert.match(html, /setInterval\(\(\) => loadManagerCapacity\(\)\.catch\(\(\) => \{\}\), 15000\)/);
});

test('successful capacity save clears dirty state before applying the saved response', () => {
  const html = managerHtml();
  const clear = html.indexOf('managerCapacityDirty = false;', html.indexOf("'/api/manager/config'"));
  const render = html.indexOf('renderManagerCapacity(body);', clear);
  assert.ok(clear >= 0, 'save should clear the dirty state');
  assert.ok(render > clear, 'saved response should render after clearing dirty state');
});
