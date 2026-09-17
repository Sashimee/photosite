import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface ShutdownLogger {
  warn: (payload: Record<string, unknown>, message: string) => void;
}

// Worker.close() stops new jobs and waits for the active one to finish;
// timeoutMs only bounds that wait so shutdown can't hang forever.
export async function shutdownWorkers(
  workers: readonly Worker[],
  connections: readonly Redis[],
  timeoutMs: number,
  logger: ShutdownLogger,
): Promise<void> {
  const drained = Promise.all(workers.map((worker) => worker.close())).then(() => true as const);
  const finished = await Promise.race([drained, delay(timeoutMs).then(() => false as const)]);

  if (!finished) {
    logger.warn({ timeoutMs }, 'graceful shutdown timed out waiting for active jobs');
  }

  for (const connection of connections) {
    connection.disconnect();
  }
}
