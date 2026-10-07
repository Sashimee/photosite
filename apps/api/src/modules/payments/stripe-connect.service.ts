import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import type { StripeAccountLinkResponseSchema, StripeAccountResponseSchema } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { requireVerifiedEmail } from '../../common/auth/require-verified-email.js';
import { publishIfEligible } from '../../common/publish/publish-if-eligible.js';
import { PublishPolicy } from '../../common/publish/publish-policy.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';
import {
  STRIPE_GATEWAY,
  type ConnectedAccount,
  type StripeGateway,
} from './stripe/stripe-gateway.js';

export type AfterCommit = () => Promise<void>;

const NOTHING_AFTER_COMMIT: AfterCommit = () => Promise.resolve();

interface SessionUser {
  id: string;
  roles: string[];
  emailVerifiedAt?: string | Date | null;
}

type StripeAccountDto = z.infer<typeof StripeAccountResponseSchema>;
type StripeAccountLinkDto = z.infer<typeof StripeAccountLinkResponseSchema>;

export interface CreateAccountResult {
  status: 200 | 201;
  data: StripeAccountDto;
}

interface StripeProfileFields {
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
  stripePayoutsEnabled: boolean;
}

function notFound(): HttpException {
  return new HttpException(
    { code: 'NOT_FOUND', message: 'Create your photographer profile first' },
    404,
  );
}

function toDto(profile: StripeProfileFields & { stripeAccountId: string }): StripeAccountDto {
  return {
    stripeAccountId: profile.stripeAccountId,
    onboardingComplete: profile.stripeOnboardingComplete,
    payoutsEnabled: profile.stripePayoutsEnabled,
  };
}

function hasAccount(
  profile: StripeProfileFields,
): profile is StripeProfileFields & { stripeAccountId: string } {
  return profile.stripeAccountId !== null;
}

@Injectable()
export class StripeConnectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PaymentsRateLimitService) private readonly rateLimit: PaymentsRateLimitService,
    @Inject(APP_CONFIG) private readonly env: Env,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async createAccount(user: SessionUser, ip: string | undefined): Promise<CreateAccountResult> {
    requireVerifiedEmail(user);
    requireRole(user, 'photographer');
    await this.rateLimit.enforceCreateAccount(user.id);

    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw notFound();
    }
    if (hasAccount(profile)) {
      return { status: 200, data: toDto(profile) };
    }

    // Keyed on the profile, not the request: two concurrent or retried calls
    // get the same Express account back from Stripe instead of two accounts.
    const account = await this.gateway.createConnectedAccount({
      country: profile.countryCode,
      metadata: { photographerProfileId: profile.id, userId: user.id },
      idempotencyKey: `photographer_${profile.id}_connect_account`,
    });

    const stored = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.photographerProfile.updateMany({
        where: { id: profile.id, stripeAccountId: null },
        data: { stripeAccountId: account.id },
      });
      if (result.count === 0) {
        return false;
      }
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'stripe_account.created',
          targetType: 'PhotographerProfile',
          targetId: profile.id,
          before: { stripeAccountId: null },
          after: { stripeAccountId: account.id },
          ip: ip ?? null,
        },
      });
      return true;
    });

    if (!stored) {
      const current = await this.prisma.client.photographerProfile.findUnique({
        where: { id: profile.id },
      });
      if (!current) {
        throw notFound();
      }
      if (!hasAccount(current)) {
        throw new Error(
          `stripe connect: profile ${profile.id} lost its stripeAccountId during creation`,
        );
      }
      if (current.stripeAccountId !== account.id) {
        this.logger.warn(
          {
            photographerProfileId: profile.id,
            stripeAccountId: current.stripeAccountId,
            orphanStripeAccountId: account.id,
          },
          'stripe connect: concurrent account creation left an unused Express account',
        );
      }
      return { status: 200, data: toDto(current) };
    }

    this.logger.log(
      { photographerProfileId: profile.id, stripeAccountId: account.id },
      'stripe connect: express account created',
    );
    return {
      status: 201,
      data: {
        stripeAccountId: account.id,
        onboardingComplete: profile.stripeOnboardingComplete,
        payoutsEnabled: profile.stripePayoutsEnabled,
      },
    };
  }

  async createAccountLink(user: SessionUser): Promise<StripeAccountLinkDto> {
    requireVerifiedEmail(user);
    requireRole(user, 'photographer');
    await this.rateLimit.enforceCreateAccountLink(user.id);

    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw notFound();
    }
    if (!hasAccount(profile)) {
      throw new HttpException(
        {
          code: 'CONFLICT',
          message: 'Create a payout account first (POST /v1/me/stripe/account)',
        },
        409,
      );
    }

    // Account links are single-use and short-lived, so every request needs a
    // fresh one; the random suffix keeps the key unique per request.
    const link = await this.gateway.createAccountLink({
      accountId: profile.stripeAccountId,
      refreshUrl: this.env.STRIPE_CONNECT_REFRESH_URL ?? `${this.env.WEB_APP_URL}/account`,
      returnUrl: this.env.STRIPE_CONNECT_RETURN_URL ?? `${this.env.WEB_APP_URL}/account`,
      idempotencyKey: `photographer_${profile.id}_account_link_${randomUUID()}`,
    });
    return { url: link.url };
  }

  // Webhook payloads can arrive out of order and replays carry an old
  // snapshot, so account state is always re-read from Stripe before mirroring.
  async fetchAccount(accountId: string): Promise<ConnectedAccount> {
    return this.gateway.retrieveAccount(accountId);
  }

  async handleAccountUpdated(accountId: string): Promise<void> {
    const account = await this.fetchAccount(accountId);
    const afterCommit = await this.prisma.client.$transaction((tx) =>
      this.applyAccountUpdated(tx, account),
    );
    await afterCommit();
  }

  // Runs inside the caller's transaction so the webhook can record the
  // StripeEvent and the mirrored state atomically; the returned callback holds
  // the side effects that must only happen once that transaction commits.
  // `account` must come from fetchAccount, not from the event payload.
  async applyAccountUpdated(
    tx: Prisma.TransactionClient,
    account: ConnectedAccount,
  ): Promise<AfterCommit> {
    // The row lock serialises concurrent account.updated handlers, so the
    // before/after comparison below reads committed state.
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "PhotographerProfile" WHERE "stripeAccountId" = ${account.id}
      ORDER BY id FOR UPDATE`;
    if (!locked) {
      this.logger.warn(
        { stripeAccountId: account.id },
        'stripe connect: account.updated for an unknown account, ignoring',
      );
      return NOTHING_AFTER_COMMIT;
    }
    const profile = await tx.photographerProfile.findUniqueOrThrow({ where: { id: locked.id } });

    const onboardingComplete = account.detailsSubmitted && account.chargesEnabled;
    const payoutsEnabled = account.payoutsEnabled;
    if (
      profile.stripeOnboardingComplete === onboardingComplete &&
      profile.stripePayoutsEnabled === payoutsEnabled
    ) {
      return NOTHING_AFTER_COMMIT;
    }

    const updated = await tx.photographerProfile.update({
      where: { id: profile.id },
      data: {
        stripeOnboardingComplete: onboardingComplete,
        stripePayoutsEnabled: payoutsEnabled,
      },
    });
    const unpublished = updated.isPublished && !PublishPolicy.canPublish(updated);
    if (unpublished) {
      await tx.photographerProfile.update({
        where: { id: profile.id },
        data: { isPublished: false },
      });
    }
    const published = payoutsEnabled && (await publishIfEligible(tx, profile.id));
    const isPublished = published || (updated.isPublished && !unpublished);
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'stripe_account.updated',
        targetType: 'PhotographerProfile',
        targetId: profile.id,
        before: {
          stripeAccountId: account.id,
          stripeOnboardingComplete: profile.stripeOnboardingComplete,
          stripePayoutsEnabled: profile.stripePayoutsEnabled,
          isPublished: profile.isPublished,
        },
        after: {
          stripeAccountId: account.id,
          stripeOnboardingComplete: onboardingComplete,
          stripePayoutsEnabled: payoutsEnabled,
          isPublished,
        },
        ip: null,
      },
    });
    const notificationId =
      profile.stripePayoutsEnabled && !payoutsEnabled
        ? await this.notifications.createNotification(tx, profile.userId, 'payouts_disabled', {})
        : null;

    return async () => {
      this.logger.log(
        {
          photographerProfileId: profile.id,
          stripeAccountId: account.id,
          onboardingComplete,
          payoutsEnabled,
          published,
          unpublished,
          notificationId,
        },
        'stripe connect: account state mirrored',
      );
      if (notificationId) {
        await this.notifications.enqueue(notificationId);
      }
    };
  }
}
