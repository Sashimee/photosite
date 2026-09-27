import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';

const queueAdd = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function FakeQueue() {
    return { add: queueAdd, close: vi.fn() };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function FakeRedis() {
    return { disconnect: vi.fn() };
  }),
}));

import { ProvenanceCheckQueueService } from './provenance-check-queue.service.js';

const CONFIG = { REDIS_URL: 'redis://localhost:6379' } as unknown as Env;
const PORTFOLIO_IMAGE_ID = '22222222-2222-4222-8222-222222222222';

describe('ProvenanceCheckQueueService', () => {
  beforeEach(() => {
    queueAdd.mockClear();
  });

  it('enqueues a non-forced check under the portfolioImageId', async () => {
    const service = new ProvenanceCheckQueueService(CONFIG);

    await service.enqueue({ portfolioImageId: PORTFOLIO_IMAGE_ID, force: false });

    expect(queueAdd).toHaveBeenCalledWith(
      'provenance-check',
      { portfolioImageId: PORTFOLIO_IMAGE_ID, force: false },
      expect.objectContaining({ jobId: PORTFOLIO_IMAGE_ID }),
    );
  });

  it('uses a distinct, timestamped jobId for a forced recheck', async () => {
    const service = new ProvenanceCheckQueueService(CONFIG);

    await service.enqueue({ portfolioImageId: PORTFOLIO_IMAGE_ID, force: true });

    const [, , options] = queueAdd.mock.calls[0] as [unknown, unknown, { jobId: string }];
    expect(options.jobId).not.toBe(PORTFOLIO_IMAGE_ID);
    expect(options.jobId).toMatch(new RegExp(`^${PORTFOLIO_IMAGE_ID}:recheck:\\d+$`));
  });

  it('gives two forced rechecks different jobIds', async () => {
    const service = new ProvenanceCheckQueueService(CONFIG);

    await service.enqueue({ portfolioImageId: PORTFOLIO_IMAGE_ID, force: true });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.enqueue({ portfolioImageId: PORTFOLIO_IMAGE_ID, force: true });

    const firstJobId = (queueAdd.mock.calls[0] as [unknown, unknown, { jobId: string }])[2].jobId;
    const secondJobId = (queueAdd.mock.calls[1] as [unknown, unknown, { jobId: string }])[2].jobId;
    expect(firstJobId).not.toBe(secondJobId);
  });
});
