import assert from 'node:assert/strict';
import test from 'node:test';
import { setupWizardHtml } from '../../src/setup-wizard/ui.mjs';

test('Paseo page exposes progressive discovery, authentication, and recovery controls', () => {
  const html = setupWizardHtml({ requestedPage: 'paseo' });

  assert.match(html, /\/api\/setup\/paseo\/status/);
  assert.match(html, /\/api\/setup\/paseo\/connect/);
  assert.match(html, /\/api\/setup\/paseo\/recheck/);
  assert.match(html, /Automatic discovery/);
  assert.match(html, /Paseo host/);
  assert.match(html, /Paseo password/);
  assert.match(html, /Show password/);
  assert.match(html, /Remember securely on this machine/);
  assert.match(html, /session only/);
  assert.match(html, /Open Paseo/);
  assert.match(html, /Copy install instructions/);
  assert.match(html, /Copy start instructions/);
  assert.match(html, /Check again/);
  assert.match(html, /id="recheck"/);
});

test('Paseo page keeps password handling outside ordinary setup-session persistence', () => {
  const html = setupWizardHtml({ requestedPage: 'paseo' });
  const connectSection = html.slice(html.indexOf('async function connectPaseo'));

  assert.match(connectSection, /\/api\/setup\/paseo\/connect/);
  assert.doesNotMatch(connectSection, /\/api\/setup\/session\/page[^]*password/);
  assert.match(html, /technicalDetails/);
});
