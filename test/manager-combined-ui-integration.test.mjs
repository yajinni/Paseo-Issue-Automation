import assert from 'node:assert/strict';
import test from 'node:test';
import { managerDashboardHtml } from '../src/manager-server.mjs';

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

test('combined manager dashboard keeps lifecycle and dependency-map feature stacks installed once', () => {
  const html = managerDashboardHtml();
  const assets = [
    '<script data-manager-status-events>',
    '<style data-manager-work-queue-style>',
    '<script data-manager-work-queue>',
    '<style data-manager-issue-processing-flow-style>',
    '<script data-manager-issue-processing-flow>',
    '<style data-manager-dependency-insights-style>',
    '<script data-manager-dependency-insights>',
    '<style data-manager-dependency-diagnostics-style>',
    '<script data-manager-dependency-diagnostics>',
    '<style data-manager-interaction-style>',
    '<script data-manager-interaction>',
  ];

  for (const asset of assets) {
    assert.equal(count(html, asset), 1, `${asset} should be injected exactly once`);
  }
});

test('combined manager feature scripts preserve subscriber and enhancer runtime order', () => {
  const html = managerDashboardHtml();
  const scripts = [
    '<script data-manager-status-events>',
    '<script data-manager-work-queue>',
    '<script data-manager-issue-processing-flow>',
    '<script data-manager-dependency-insights>',
    '<script data-manager-dependency-diagnostics>',
    '<script data-manager-interaction>',
  ];
  const positions = scripts.map((script) => html.indexOf(script));

  for (let index = 0; index < positions.length; index += 1) {
    assert.notEqual(positions[index], -1, `${scripts[index]} should be present`);
    if (index > 0) {
      assert.ok(
        positions[index - 1] < positions[index],
        `${scripts[index - 1]} should execute before ${scripts[index]}`,
      );
    }
  }
});
