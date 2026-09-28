import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';

const addBulk = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function FakeQueue() {
    return { addBulk, close: vi.fn() };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function FakeRedis() {
    return { disconnect: vi.fn() };
  }),
}));

import { BookingDocumentsQueueService } from './booking-documents-queue.service.js';

const CONFIG = { REDIS_URL: 'redis://localhost:6379' } as unknown as Env;
const BOOKING_ID = '0192f7a0-0000-7000-8000-000000000001';

describe('BookingDocumentsQueueService', () => {
  beforeEach(() => {
    addBulk.mockClear();
  });

  it('enqueues the receipt and the fee invoice under deterministic job ids', async () => {
    await new BookingDocumentsQueueService(CONFIG).enqueue(BOOKING_ID);

    expect(addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: { bookingId: BOOKING_ID, document: 'receipt' },
        opts: expect.objectContaining({ jobId: `receipt-${BOOKING_ID}` }) as unknown,
      }),
      expect.objectContaining({
        data: { bookingId: BOOKING_ID, document: 'fee-invoice' },
        opts: expect.objectContaining({ jobId: `fee-invoice-${BOOKING_ID}` }) as unknown,
      }),
    ]);
  });

  it('enqueues only the requested document', async () => {
    await new BookingDocumentsQueueService(CONFIG).enqueue(BOOKING_ID, ['fee-invoice']);

    const [jobs] = addBulk.mock.calls[0] as [{ data: unknown }[]];
    expect(jobs.map((job) => job.data)).toEqual([
      { bookingId: BOOKING_ID, document: 'fee-invoice' },
    ]);
  });

  it('rejects a malformed booking id before touching Redis', async () => {
    await expect(new BookingDocumentsQueueService(CONFIG).enqueue('not-a-uuid')).rejects.toThrow();
    expect(addBulk).not.toHaveBeenCalled();
  });
});
