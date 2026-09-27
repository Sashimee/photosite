import { HttpException } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PaymentsRateLimitService } from './payments-rate-limit.service.js';
import { StripeConnectService } from './stripe-connect.service.js';
import { FakeStripeGateway } from './stripe/fake-stripe-gateway.js';

const VERIFIED_AT = new Date('2026-01-01T00:00:00Z');
const PHOTOGRAPHER = { id: 'user-1', roles: ['photographer'], emailVerifiedAt: VERIFIED_AT };
const UNVERIFIED_PHOTOGRAPHER = { ...PHOTOGRAPHER, emailVerifiedAt: null };
const CLIENT = { id: 'user-2', roles: ['client'], emailVerifiedAt: VERIFIED_AT };

interface ProfileRow {
  id: string;
  userId: string;
  countryCode: string;
  verificationStatus: 'verified' | 'pending' | 'unverified';
  isPublished: boolean;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
  stripePayoutsEnabled: boolean;
}

function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: 'profile-1',
    userId: 'user-1',
    countryCode: 'LU',
    verificationStatus: 'verified',
    isPublished: false,
    stripeAccountId: null,
    stripeOnboardingComplete: false,
    stripePayoutsEnabled: false,
    ...overrides,
  };
}

function setup(options: { profile?: ProfileRow | null; env?: Partial<Env> } = {}) {
  let row = options.profile === undefined ? profileRow() : options.profile;
  const tx = {
    photographerProfile: {
      updateMany: vi.fn(
        ({ where, data }: { where: { stripeAccountId: null }; data: Partial<ProfileRow> }) => {
          if (row?.stripeAccountId !== where.stripeAccountId) {
            return Promise.resolve({ count: 0 });
          }
          row = { ...row, ...data };
          return Promise.resolve({ count: 1 });
        },
      ),
      update: vi.fn(({ data }: { data: Partial<ProfileRow> }) => {
        if (!row) {
          throw new Error('no row');
        }
        row = { ...row, ...data };
        return Promise.resolve({ ...row });
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    client: {
      photographerProfile: {
        findUnique: vi.fn(() => Promise.resolve(row ? { ...row } : null)),
        findFirst: vi.fn(({ where }: { where: { stripeAccountId: string } }) =>
          Promise.resolve(row?.stripeAccountId === where.stripeAccountId ? { ...row } : null),
        ),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  };
  const gateway = new FakeStripeGateway();
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const rateLimit = {
    enforceCreateAccount: vi.fn().mockResolvedValue(undefined),
    enforceCreateAccountLink: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { log: vi.fn(), warn: vi.fn() };
  const env = { WEB_APP_URL: 'https://photoo.lu', ...options.env } as Env;
  const service = new StripeConnectService(
    prisma as unknown as PrismaService,
    gateway,
    notifications as unknown as NotificationsService,
    rateLimit as unknown as PaymentsRateLimitService,
    env,
    logger as unknown as Logger,
  );
  return {
    service,
    gateway,
    prisma,
    tx,
    notifications,
    rateLimit,
    logger,
    current: () => row,
    setRow: (next: ProfileRow) => {
      row = next;
    },
  };
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
}

describe('StripeConnectService.createAccount', () => {
  it('creates the Express account, stores its id and writes an audit row', async () => {
    const ctx = setup();
    const result = await ctx.service.createAccount(PHOTOGRAPHER, '203.0.113.9');

    expect(result).toEqual({
      status: 201,
      data: { stripeAccountId: 'acct_fake_1', onboardingComplete: false, payoutsEnabled: false },
    });
    expect(ctx.current()?.stripeAccountId).toBe('acct_fake_1');
    expect(ctx.rateLimit.enforceCreateAccount).toHaveBeenCalledWith('user-1');
    expect(ctx.tx.auditLog.create.mock.lastCall?.[0]).toMatchObject({
      data: {
        actorType: 'user',
        actorId: 'user-1',
        action: 'stripe_account.created',
        targetType: 'PhotographerProfile',
        targetId: 'profile-1',
        before: { stripeAccountId: null },
        after: { stripeAccountId: 'acct_fake_1' },
        ip: '203.0.113.9',
      },
    });
  });

  it('returns the existing account with 200 without calling Stripe again', async () => {
    const ctx = setup();
    const first = await ctx.service.createAccount(PHOTOGRAPHER, undefined);
    const createSpy = vi.spyOn(ctx.gateway, 'createConnectedAccount');
    const second = await ctx.service.createAccount(PHOTOGRAPHER, undefined);

    expect(second).toEqual({ status: 200, data: first.data });
    expect(createSpy).not.toHaveBeenCalled();
    expect(ctx.tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('keeps the stored account and warns about the orphan when a concurrent request won', async () => {
    const ctx = setup();
    vi.spyOn(ctx.gateway, 'createConnectedAccount').mockImplementationOnce(() => {
      ctx.setRow(profileRow({ stripeAccountId: 'acct_winner' }));
      return Promise.resolve({
        id: 'acct_loser',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
    });

    const result = await ctx.service.createAccount(PHOTOGRAPHER, undefined);

    expect(result).toEqual({
      status: 200,
      data: { stripeAccountId: 'acct_winner', onboardingComplete: false, payoutsEnabled: false },
    });
    expect(ctx.tx.auditLog.create).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeAccountId: 'acct_winner',
        orphanStripeAccountId: 'acct_loser',
      }),
      expect.any(String),
    );
  });

  it('rejects a user without the photographer role with 403 before touching Stripe', async () => {
    const ctx = setup();
    const createSpy = vi.spyOn(ctx.gateway, 'createConnectedAccount');
    await expectHttpError(ctx.service.createAccount(CLIENT, undefined), 403, 'FORBIDDEN');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects an unverified photographer with EMAIL_NOT_VERIFIED before any rate limit, read or Stripe call', async () => {
    const ctx = setup();
    const createSpy = vi.spyOn(ctx.gateway, 'createConnectedAccount');
    await expectHttpError(
      ctx.service.createAccount(UNVERIFIED_PHOTOGRAPHER, undefined),
      403,
      'EMAIL_NOT_VERIFIED',
    );
    expect(ctx.rateLimit.enforceCreateAccount).not.toHaveBeenCalled();
    expect(ctx.prisma.client.photographerProfile.findUnique).not.toHaveBeenCalled();
    expect(ctx.prisma.client.$transaction).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(ctx.current()?.stripeAccountId).toBeNull();
  });

  it('returns 404 when the photographer has no profile yet', async () => {
    const ctx = setup({ profile: null });
    await expectHttpError(ctx.service.createAccount(PHOTOGRAPHER, undefined), 404, 'NOT_FOUND');
  });

  it('propagates the rate limit rejection', async () => {
    const ctx = setup();
    ctx.rateLimit.enforceCreateAccount.mockRejectedValueOnce(
      new HttpException({ code: 'TOO_MANY_REQUESTS' }, 429),
    );
    await expectHttpError(
      ctx.service.createAccount(PHOTOGRAPHER, undefined),
      429,
      'TOO_MANY_REQUESTS',
    );
  });
});

describe('StripeConnectService.createAccountLink', () => {
  it('returns an onboarding url using the web app account page by default', async () => {
    const ctx = setup();
    await ctx.service.createAccount(PHOTOGRAPHER, undefined);
    const linkSpy = vi.spyOn(ctx.gateway, 'createAccountLink');

    const link = await ctx.service.createAccountLink(PHOTOGRAPHER);

    expect(link.url).toMatch(/^https:\/\/connect\.stripe\.fake\/setup\/acct_fake_1\//);
    expect(linkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct_fake_1',
        refreshUrl: 'https://photoo.lu/account',
        returnUrl: 'https://photoo.lu/account',
      }),
    );
  });

  it('uses the configured return and refresh urls and a fresh idempotency key per call', async () => {
    const ctx = setup({
      env: {
        STRIPE_CONNECT_REFRESH_URL: 'https://photoo.lu/en/account/payouts/refresh',
        STRIPE_CONNECT_RETURN_URL: 'https://photoo.lu/en/account/payouts/return',
      },
    });
    await ctx.service.createAccount(PHOTOGRAPHER, undefined);
    const linkSpy = vi.spyOn(ctx.gateway, 'createAccountLink');

    const first = await ctx.service.createAccountLink(PHOTOGRAPHER);
    const second = await ctx.service.createAccountLink(PHOTOGRAPHER);

    expect(first.url).not.toBe(second.url);
    expect(linkSpy.mock.calls[0]?.[0]).toMatchObject({
      refreshUrl: 'https://photoo.lu/en/account/payouts/refresh',
      returnUrl: 'https://photoo.lu/en/account/payouts/return',
    });
    expect(linkSpy.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      linkSpy.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it('returns 409 before an account exists', async () => {
    const ctx = setup();
    await expectHttpError(ctx.service.createAccountLink(PHOTOGRAPHER), 409, 'CONFLICT');
  });

  it('rejects an unverified photographer with EMAIL_NOT_VERIFIED before any rate limit, read or Stripe call', async () => {
    const ctx = setup({ profile: profileRow({ stripeAccountId: 'acct_existing' }) });
    const linkSpy = vi.spyOn(ctx.gateway, 'createAccountLink');
    await expectHttpError(
      ctx.service.createAccountLink(UNVERIFIED_PHOTOGRAPHER),
      403,
      'EMAIL_NOT_VERIFIED',
    );
    expect(ctx.rateLimit.enforceCreateAccountLink).not.toHaveBeenCalled();
    expect(ctx.prisma.client.photographerProfile.findUnique).not.toHaveBeenCalled();
    expect(linkSpy).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-photographer and 404 without a profile', async () => {
    await expectHttpError(setup().service.createAccountLink(CLIENT), 403, 'FORBIDDEN');
    await expectHttpError(
      setup({ profile: null }).service.createAccountLink(PHOTOGRAPHER),
      404,
      'NOT_FOUND',
    );
  });
});

describe('StripeConnectService.handleAccountUpdated', () => {
  const ENABLED = {
    id: 'acct_1',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  };

  let ctx: ReturnType<typeof setup>;

  describe('when onboarding completes', () => {
    beforeEach(() => {
      ctx = setup({ profile: profileRow({ stripeAccountId: 'acct_1' }) });
    });

    it('mirrors the flags, audits, and does not notify', async () => {
      await ctx.service.handleAccountUpdated(ENABLED);

      expect(ctx.current()).toMatchObject({
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        isPublished: false,
      });
      expect(ctx.tx.auditLog.create.mock.lastCall?.[0]).toMatchObject({
        data: {
          actorType: 'system',
          actorId: null,
          action: 'stripe_account.updated',
          targetId: 'profile-1',
          before: {
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
            stripePayoutsEnabled: false,
            isPublished: false,
          },
          after: {
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: true,
            stripePayoutsEnabled: true,
            isPublished: false,
          },
        },
      });
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });

    it('treats a replay of the same state as a no-op', async () => {
      await ctx.service.handleAccountUpdated(ENABLED);
      await ctx.service.handleAccountUpdated(ENABLED);

      expect(ctx.prisma.client.$transaction).toHaveBeenCalledOnce();
      expect(ctx.tx.auditLog.create).toHaveBeenCalledOnce();
    });

    it('requires both details submitted and charges enabled for onboarding complete', async () => {
      await ctx.service.handleAccountUpdated({ ...ENABLED, chargesEnabled: false });
      expect(ctx.current()).toMatchObject({
        stripeOnboardingComplete: false,
        stripePayoutsEnabled: true,
      });
    });
  });

  describe('when payouts get disabled on a published profile', () => {
    beforeEach(() => {
      ctx = setup({
        profile: profileRow({
          stripeAccountId: 'acct_1',
          stripeOnboardingComplete: true,
          stripePayoutsEnabled: true,
          isPublished: true,
        }),
      });
    });

    it('unpublishes, audits the unpublish, and notifies the photographer', async () => {
      await ctx.service.handleAccountUpdated({ ...ENABLED, payoutsEnabled: false });

      expect(ctx.current()).toMatchObject({ stripePayoutsEnabled: false, isPublished: false });
      expect(ctx.tx.auditLog.create.mock.lastCall?.[0]).toMatchObject({
        data: {
          before: { stripePayoutsEnabled: true, isPublished: true },
          after: { stripePayoutsEnabled: false, isPublished: false },
        },
      });
      expect(ctx.notifications.notify).toHaveBeenCalledWith('user-1', 'payouts_disabled', {});
    });

    it('notifies only once when the same disabled state is replayed', async () => {
      const disabled = { ...ENABLED, payoutsEnabled: false };
      await ctx.service.handleAccountUpdated(disabled);
      await ctx.service.handleAccountUpdated(disabled);

      expect(ctx.notifications.notify).toHaveBeenCalledOnce();
      expect(ctx.tx.auditLog.create).toHaveBeenCalledOnce();
    });

    it('keeps the profile published when only onboarding flips', async () => {
      await ctx.service.handleAccountUpdated({ ...ENABLED, detailsSubmitted: false });

      expect(ctx.current()).toMatchObject({ stripeOnboardingComplete: false, isPublished: true });
      expect(ctx.notifications.notify).not.toHaveBeenCalled();
    });
  });

  it('logs and ignores an event for an unknown account', async () => {
    ctx = setup({ profile: profileRow({ stripeAccountId: 'acct_other' }) });

    await ctx.service.handleAccountUpdated({ ...ENABLED, id: 'acct_unknown' });

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      { stripeAccountId: 'acct_unknown' },
      expect.stringContaining('unknown account'),
    );
    expect(ctx.prisma.client.$transaction).not.toHaveBeenCalled();
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });
});
