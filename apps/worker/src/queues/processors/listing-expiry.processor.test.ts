import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createListingExpiryProcessor,
  type ExpiredJobOfferRow,
  type ListingExpiryDeps,
  type ListingExpiryTransactionClient,
} from './listing-expiry.processor.js';

const FAKE_JOB = {} as Job;

const FIXTURE_OFFER: ExpiredJobOfferRow = {
  id: '018f2e1a-0000-7000-8000-000000000010',
  professionalId: 'professional-1',
  title: 'Fixture Job Offer',
};

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function deps(overrides: { expiring?: ExpiredJobOfferRow[] } = {}) {
  const expiring = overrides.expiring ?? [];
  const auditLogCreate = vi.fn(() => Promise.resolve());
  const jobOfferUpdateManyAndReturn = vi.fn(() => Promise.resolve(expiring));

  const tx: ListingExpiryTransactionClient = {
    jobOffer: { updateManyAndReturn: jobOfferUpdateManyAndReturn },
    auditLog: { create: auditLogCreate },
  };

  const d: ListingExpiryDeps = {
    prisma: { client: { $transaction: (fn) => fn(tx) } },
    logger: fakeLogger(),
  };

  return { deps: d, tx, auditLogCreate, jobOfferUpdateManyAndReturn };
}

describe('createListingExpiryProcessor', () => {
  it('flips published, lapsed job offers to expired in one atomic update', async () => {
    const { deps: d, jobOfferUpdateManyAndReturn } = deps({ expiring: [FIXTURE_OFFER] });

    await createListingExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(jobOfferUpdateManyAndReturn).toHaveBeenCalledWith({
      where: { status: 'published', expiresAt: { lte: expect.any(Date) as Date } },
      data: { status: 'expired' },
    });
  });

  it('writes one audit log row with the count when something expired', async () => {
    const { deps: d, auditLogCreate } = deps({ expiring: [FIXTURE_OFFER] });

    await createListingExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'listing_expiry.swept',
        targetType: 'System',
        targetId: null,
        after: { expiredJobOffers: 1 },
      },
    });
  });

  it('writes no audit log row when nothing expired (idempotent re-run)', async () => {
    const { deps: d, auditLogCreate } = deps();

    await createListingExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
