import assert from 'node:assert/strict';
import test from 'node:test';
import { managerHtml } from '../src/manager-concurrency-ui.mjs';

test('manager capacity polling preserves an unsaved input edit', () => {
  const html = managerHtml();
  assert.match(html, /let managerCapacityDirty = false/);
  assert.match(html, /let managerCapacityEditVersion = 0/);
  assert.match(html, /managerCapacityDirty = true/);
  assert.match(html, /managerCapacityEditVersion \+= 1/);
  assert.match(html, /if \(input && !managerCapacityDirty\) input\.value = config\.globalMaxActive \|\| manager\.globalMaxActive \|\| 2/);
  assert.match(html, /setInterval\(\(\) => loadManagerCapacity\(\)\.catch\(\(\) => \{\}\), 15000\)/);
});

test('capacity save clears dirty state only when no newer edit occurred', () => {
  const html = managerHtml();
  assert.match(html, /const editVersionAtStart = managerCapacityEditVersion/);
  assert.match(html, /if \(managerCapacityEditVersion === editVersionAtStart\) managerCapacityDirty = false/);
  const guard = html.indexOf('if (managerCapacityEditVersion === editVersionAtStart) managerCapacityDirty = false;');
  const render = html.indexOf('renderManagerCapacity(body);', guard);
  assert.ok(guard >= 0, 'save should compare the current edit version with the submitted version');
  assert.ok(render > guard, 'saved manager facts should render after the edit-version check');
});

test('newer capacity edits remain dirty when an older save response renders', () => {
  const html = managerHtml();
  assert.doesNotMatch(html, /\n    managerCapacityDirty = false;\n    renderManagerCapacity\(body\);/);
  assert.match(html, /if \(managerCapacityEditVersion === editVersionAtStart\) managerCapacityDirty = false;\s*renderManagerCapacity\(body\);/);
});
