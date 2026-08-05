import { parentPort } from 'node:worker_threads';
import { collectRemoteDashboardState } from './dashboard-status-sources.mjs';

if (!parentPort) throw new Error('Dashboard status worker requires a parent port.');

parentPort.once('message', (input) => {
  try {
    const result = collectRemoteDashboardState(input.root, {
      attempts: input.attempts || [],
      baseBranch: input.baseBranch || '',
    });
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.message || error) });
  }
});
