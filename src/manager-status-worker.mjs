import { parentPort, workerData } from 'node:worker_threads';
import { managerRepositoryStatus } from './manager-status.mjs';

try {
  const status = managerRepositoryStatus(workerData.repository, {
    rootDir: workerData.rootDir,
    workerManager: { status: () => workerData.workerStatus },
    reviewWorkerManager: { status: () => workerData.reviewWorkerStatus },
  });
  parentPort.postMessage({ ok: true, status });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
