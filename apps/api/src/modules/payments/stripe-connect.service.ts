import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { StripeAccountLinkResponseSchema, StripeAccountResponseSchema } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
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

interface SessionUser {
  id: string;
  roles: string[];
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

  async handleAccountUpdated(account: ConnectedAccount): Promise<void> {
    const profile = await this.prisma.client.photographerProfile.findFirst({
      where: { stripeAccountId: account.id },
    });
    if (!profile) {
      this.logger.warn(
        { stripeAccountId: account.id },
        'stripe connect: account.updated for an unknown account, ignoring',
      );
      return;
    }

    const onboardingComplete = account.detailsSubmitted && account.chargesEnabled;
    const payoutsEnabled = account.payoutsEnabled;
    if (
      profile.stripeOnboardingComplete === onboardingComplete &&
      profile.stripePayoutsEnabled === payoutsEnabled
    ) {
      return;
    }

    const unpublished = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.photographerProfile.update({
        where: { id: profile.id },
        data: {
          stripeOnboardingComplete: onboardingComplete,
          stripePayoutsEnabled: payoutsEnabled,
        },
      });
      const mustUnpublish = updated.isPublished && !PublishPolicy.canPublish(updated);
      if (mustUnpublish) {
        await tx.photographerProfile.update({
          where: { id: profile.id },
          data: { isPublished: false },
        });
      }
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
            isPublished: mustUnpublish ? false : updated.isPublished,
          },
          ip: null,
        },
      });
      return mustUnpublish;
    });

    this.logger.log(
      {
        photographerProfileId: profile.id,
        stripeAccountId: account.id,
        onboardingComplete,
        payoutsEnabled,
        unpublished,
      },
      'stripe connect: account state mirrored',
    );

    if (profile.stripePayoutsEnabled && !payoutsEnabled) {
      await this.notifications.notify(profile.userId, 'payouts_disabled', {});
    }
  }
}
