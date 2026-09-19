import { describe, expect, it, vi } from 'vitest';
import { anonymiseDeletions } from './anonymise-deletions.js';

interface FakeUpload {
  id: string;
  objectKey: string;
  purpose: string;
  variants: Record<string, string> | null;
}

function fakePrisma(options: {
  due: { id: string; userId: string }[];
  failUserId?: string;
  uploads?: FakeUpload[];
}) {
  const dataRequestUpdate = vi.fn(() => Promise.resolve());
  const userUpdate = vi.fn((args: { where: { id: string } }) => {
    if (args.where.id === options.failUserId) {
      return Promise.reject(new Error('user row vanished'));
    }
    return Promise.resolve();
  });
  const zero = () => Promise.resolve({ count: 0 });

  const client = {
    dataRequest: { findMany: vi.fn(() => Promise.resolve(options.due)), update: dataRequestUpdate },
    photographerProfile: { findUnique: vi.fn(() => Promise.resolve(null)) },
    portfolioImage: { findMany: vi.fn(() => Promise.resolve([])), deleteMany: zero },
    product: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    session: { deleteMany: zero },
    device: { deleteMany: zero },
    account: { deleteMany: zero },
    twoFactor: { deleteMany: zero },
    notification: { deleteMany: zero },
    notificationPreference: { deleteMany: zero },
    upload: { findMany: vi.fn(() => Promise.resolve(options.uploads ?? [])), deleteMany: zero },
    user: { update: userUpdate },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };

  return { client, dataRequestUpdate, userUpdate };
}

describe('anonymiseDeletions', () => {
  it('logs and continues when a stray upload object cannot be deleted', async () => {
    const { client } = fakePrisma({
      due: [{ id: 'req-ok', userId: 'user-ok' }],
      uploads: [{ id: 'up-1', objectKey: 'k/1', purpose: 'avatar', variants: null }],
    });
    const auditRecord = vi.fn(() => Promise.resolve());
    const loggerWarn = vi.fn();

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.reject(new Error('s3 unavailable'))),
      },
      auditLog: { record: auditRecord },
      logger: { log: vi.fn(), warn: loggerWarn, error: vi.fn() } as never,
    });

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ dataRequestId: 'req-ok' }),
      expect.any(String),
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
  });

  it('deletes a portfolio/avatar/cover upload public variant object too', async () => {
    const { client } = fakePrisma({
      due: [{ id: 'req-ok', userId: 'user-ok' }],
      uploads: [
        { id: 'up-1', objectKey: 'k/1', purpose: 'portfolio', variants: { thumb_webp: 'v/1' } },
      ],
    });
    const deleteObject = vi.fn(() => Promise.resolve());

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: { config: { privateBucket: 'private', publicBucket: 'public' }, deleteObject },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(deleteObject).toHaveBeenCalledWith('private', 'k/1');
    expect(deleteObject).toHaveBeenCalledWith('public', 'v/1');
  });

  it('anonymises the other rows when one fails, and counts both outcomes', async () => {
    const { client, dataRequestUpdate } = fakePrisma({
      due: [
        { id: 'req-ok', userId: 'user-ok' },
        { id: 'req-fail', userId: 'user-fail' },
      ],
      failUserId: 'user-fail',
    });
    const auditRecord = vi.fn(() => Promise.resolve());
    const loggerError = vi.fn();

    const result = await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: auditRecord },
      logger: { log: vi.fn(), warn: vi.fn(), error: loggerError } as never,
    });

    expect(result.usersAnonymised).toBe(1);
    expect(result.usersFailed).toBe(1);
    expect(dataRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'req-ok' },
      data: { status: 'completed', completedAt: expect.any(Date) as Date },
    });
    expect(dataRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-fail' } }),
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ dataRequestId: 'req-fail' }),
      expect.any(String),
    );
  });
});
