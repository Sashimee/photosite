import type { Prisma } from '@photoo/db';
import { describe, expect, it, vi } from 'vitest';
import { publishIfEligible } from './publish-if-eligible.js';

interface Row {
  verificationStatus: 'verified' | 'pending' | 'unverified' | 'rejected';
  stripePayoutsEnabled: boolean;
  isPublished: boolean;
  deletedAt: Date | null;
  user: {
    status: 'active' | 'suspended' | 'deleted';
    roles: string[];
    dataRequests: { id: string }[];
  };
}

function eligibleRow(
  overrides: Partial<Omit<Row, 'user'>> & { user?: Partial<Row['user']> } = {},
): Row {
  const { user, ...rest } = overrides;
  return {
    verificationStatus: 'verified',
    stripePayoutsEnabled: true,
    isPublished: false,
    deletedAt: null,
    ...rest,
    user: { status: 'active', roles: ['client', 'photographer'], dataRequests: [], ...user },
  } satisfies Row;
}

function setup(initial: Row | null) {
  let row = initial;
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    photographerProfile: {
      findUnique: vi.fn(() => Promise.resolve(row ? structuredClone(row) : null)),
      updateMany: vi.fn(({ where }: { where: { isPublished: boolean } }) => {
        if (row?.isPublished !== where.isPublished) {
          return Promise.resolve({ count: 0 });
        }
        row = { ...row, isPublished: true };
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  return { tx, run: () => publishIfEligible(tx as unknown as Prisma.TransactionClient, 'p-1') };
}

describe('publishIfEligible', () => {
  it('publishes an eligible profile', async () => {
    const { tx, run } = setup(eligibleRow());

    expect(await run()).toBe(true);
    expect(tx.photographerProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'p-1',
          isPublished: false,
          deletedAt: null,
        }) as unknown,
        data: { isPublished: true },
      }),
    );
  });

  it('repeats every user guard of the read in the guarded write', async () => {
    const { tx, run } = setup(eligibleRow());

    await run();

    expect(tx.photographerProfile.updateMany.mock.lastCall?.[0]).toMatchObject({
      where: {
        verificationStatus: 'verified',
        stripePayoutsEnabled: true,
        user: {
          status: 'active',
          roles: { has: 'photographer' },
          dataRequests: { none: { type: 'delete', status: 'pending' } },
        },
      },
    });
  });

  it('is idempotent: the second call does nothing', async () => {
    const { tx, run } = setup(eligibleRow());

    expect(await run()).toBe(true);
    expect(await run()).toBe(false);
    expect(tx.photographerProfile.updateMany).toHaveBeenCalledTimes(1);
  });

  it('returns false when the guarded update loses a race', async () => {
    const { tx, run } = setup(eligibleRow());
    tx.photographerProfile.updateMany.mockResolvedValueOnce({ count: 0 });

    expect(await run()).toBe(false);
  });

  it.each([
    ['profile missing', null],
    ['already published', eligibleRow({ isPublished: true })],
    ['taken down', eligibleRow({ deletedAt: new Date('2026-01-01T00:00:00Z') })],
    ['not verified', eligibleRow({ verificationStatus: 'pending' })],
    ['payouts disabled', eligibleRow({ stripePayoutsEnabled: false })],
    ['user suspended', eligibleRow({ user: { status: 'suspended' } })],
    ['user deleted', eligibleRow({ user: { status: 'deleted' } })],
    ['photographer role removed', eligibleRow({ user: { roles: ['client'] } })],
    ['pending deletion request', eligibleRow({ user: { dataRequests: [{ id: 'dr-1' }] } })],
  ])('does not publish when %s', async (_name, row) => {
    const { tx, run } = setup(row);

    expect(await run()).toBe(false);
    expect(tx.photographerProfile.updateMany).not.toHaveBeenCalled();
  });
});
