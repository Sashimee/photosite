import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANONYMISATION_FAILURE_REASON, anonymiseDeletions } from './anonymise-deletions.js';

vi.mock('@sentry/node', () => ({
  isInitialized: vi.fn(() => true),
  captureException: vi.fn(),
}));

interface FakeUpload {
  id: string;
  objectKey: string;
  purpose: string;
  variants: Record<string, string> | null;
}

function fakePrisma(options: {
  due: { id: string; userId: string }[];
  failUserId?: string;
  failFailureReasonWriteForRequestId?: string;
  uploads?: FakeUpload[];
  photographerProfile?: { id: string } | null;
  professionalProfile?: { id: string } | null;
}) {
  const dataRequestUpdate = vi.fn(() => Promise.resolve());
  const dataRequestUpdateMany = vi.fn((args: { where: { id: string; status: string } }) => {
    if (options.failFailureReasonWriteForRequestId === args.where.id) {
      return Promise.reject(new Error('db unavailable'));
    }
    return Promise.resolve();
  });
  const userUpdate = vi.fn((args: { where: { id: string } }) => {
    if (args.where.id === options.failUserId) {
      return Promise.reject(new Error('user row vanished'));
    }
    return Promise.resolve();
  });
  const zero = () => Promise.resolve({ count: 0 });
  const photographerProfileUpdate = vi.fn(() => Promise.resolve());
  const professionalProfileUpdate = vi.fn(() => Promise.resolve());
  const jobApplicationUpdateMany = vi.fn(() => Promise.resolve({ count: 2 }));

  const client = {
    dataRequest: {
      findMany: vi.fn(() => Promise.resolve(options.due)),
      update: dataRequestUpdate,
      updateMany: dataRequestUpdateMany,
    },
    photographerProfile: {
      findUnique: vi.fn(() => Promise.resolve(options.photographerProfile ?? null)),
      update: photographerProfileUpdate,
    },
    professionalProfile: {
      findUnique: vi.fn(() => Promise.resolve(options.professionalProfile ?? null)),
      update: professionalProfileUpdate,
    },
    jobApplication: { updateMany: jobApplicationUpdateMany },
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

  return {
    client,
    dataRequestUpdate,
    dataRequestUpdateMany,
    userUpdate,
    photographerProfileUpdate,
    professionalProfileUpdate,
    jobApplicationUpdateMany,
  };
}

describe('anonymiseDeletions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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
      data: { status: 'completed', completedAt: expect.any(Date) as Date, failureReason: null },
    });
    expect(dataRequestUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-fail' },
        data: expect.objectContaining({ status: 'completed' }) as object,
      }),
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ dataRequestId: 'req-fail' }),
      expect.any(String),
    );
  });

  it('records a stable failureReason and keeps the request pending when anonymiseOne fails', async () => {
    const { client, dataRequestUpdateMany } = fakePrisma({
      due: [{ id: 'req-fail', userId: 'user-fail' }],
      failUserId: 'user-fail',
    });

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(dataRequestUpdateMany).toHaveBeenCalledWith({
      where: { id: 'req-fail', status: 'pending' },
      data: { failureReason: ANONYMISATION_FAILURE_REASON },
    });
  });

  it('only flags the request as failed if it is still pending, so an audit-log throw after a successful commit cannot overwrite a completed row', async () => {
    const { client, dataRequestUpdateMany } = fakePrisma({
      due: [{ id: 'req-ok', userId: 'user-ok' }],
    });
    const auditRecord = vi.fn(() => Promise.reject(new Error('audit log unavailable')));

    const result = await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: auditRecord },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(result.usersFailed).toBe(1);
    expect(dataRequestUpdateMany).toHaveBeenCalledWith({
      where: { id: 'req-ok', status: 'pending' },
      data: { failureReason: ANONYMISATION_FAILURE_REASON },
    });
  });

  it('does not stop the sweep when the failureReason write itself fails', async () => {
    const { client, dataRequestUpdate } = fakePrisma({
      due: [
        { id: 'req-fail', userId: 'user-fail' },
        { id: 'req-ok', userId: 'user-ok' },
      ],
      failUserId: 'user-fail',
      failFailureReasonWriteForRequestId: 'req-fail',
    });
    const loggerError = vi.fn();

    const result = await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: loggerError } as never,
    });

    expect(result.usersAnonymised).toBe(1);
    expect(result.usersFailed).toBe(1);
    expect(dataRequestUpdate).toHaveBeenCalledWith({
      where: { id: 'req-ok' },
      data: { status: 'completed', completedAt: expect.any(Date) as Date, failureReason: null },
    });
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ dataRequestId: 'req-fail' }),
      expect.stringContaining('failureReason'),
    );
  });

  it('reports the failure to Sentry tagged with the gdpr phase, without the user id', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.captureException).mockClear();
    const { client } = fakePrisma({
      due: [{ id: 'req-fail', userId: 'user-fail' }],
      failUserId: 'user-fail',
    });

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, context] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      unknown,
      { tags: Record<string, unknown>; extra: Record<string, unknown> },
    ];
    expect(context.tags).toEqual({ gdpr_phase: 'anonymise-deletions' });
    expect(context.extra).toEqual({ dataRequestId: 'req-fail' });
  });

  it('replaces displayName and slug, and anonymises job applications when a photographer profile exists', async () => {
    const { client, photographerProfileUpdate, jobApplicationUpdateMany } = fakePrisma({
      due: [{ id: 'req-ok', userId: 'user-ok' }],
      photographerProfile: { id: 'profile-1' },
    });

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(photographerProfileUpdate).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: {
        slug: 'deleted-profile-1',
        displayName: 'Deleted user',
        headline: null,
        bio: {},
        links: [],
        languages: [],
      },
    });
    expect(jobApplicationUpdateMany).toHaveBeenCalledWith({
      where: { photographerId: 'profile-1' },
      data: { message: '', portfolioLink: null },
    });
  });

  it('derives the anonymised slug from the profile id, so two erased photographers never collide', async () => {
    const first = fakePrisma({
      due: [{ id: 'req-a', userId: 'user-a' }],
      photographerProfile: { id: 'profile-a' },
    });
    const second = fakePrisma({
      due: [{ id: 'req-b', userId: 'user-b' }],
      photographerProfile: { id: 'profile-b' },
    });

    for (const fixture of [first, second]) {
      await anonymiseDeletions({
        prisma: { client: fixture.client } as never,
        storage: {
          config: { privateBucket: 'private', publicBucket: 'public' },
          deleteObject: vi.fn(() => Promise.resolve()),
        },
        auditLog: { record: vi.fn(() => Promise.resolve()) },
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      });
    }

    expect(first.photographerProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'profile-a' },
        data: expect.objectContaining({ slug: 'deleted-profile-a' }) as object,
      }),
    );
    expect(second.photographerProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'profile-b' },
        data: expect.objectContaining({ slug: 'deleted-profile-b' }) as object,
      }),
    );
  });

  it('replaces companyName and nulls website/vatNumber when a professional profile exists', async () => {
    const { client, professionalProfileUpdate } = fakePrisma({
      due: [{ id: 'req-ok', userId: 'user-ok' }],
      professionalProfile: { id: 'company-1' },
    });

    await anonymiseDeletions({
      prisma: { client } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: vi.fn(() => Promise.resolve()) },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(professionalProfileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { companyName: 'Deleted company', website: null, vatNumber: null },
    });
  });
});
