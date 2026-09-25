import { Inject, Injectable } from '@nestjs/common';
import type { AdminPermission } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import {
  TWO_FACTOR_FRESH_VERIFICATION_WINDOW_MS,
  forbidden,
  requireAdminSession,
  twoFactorRequired,
} from '../../common/auth/require-admin.js';
import type { SessionContext } from '../auth/session.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface RequirePermissionOptions {
  requires2fa?: boolean;
}

// The single gate every `/admin` route calls through: admin role and a
// verified-within-12h session (requireAdminSession), the permission grant
// for the specific action, and - for routes marked `x-requires-2fa` in the
// contract - a second factor proven within the last 15 minutes rather than
// the 12h admin-session window, so a role change or a refund re-prompts.
@Injectable()
export class AdminAccessService {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // For routes that need an authenticated admin but no specific permission
  // (docs/steps/1A.11-admin-api.md: "an admin must always be able to ask
  // what they may do") - everything else goes through `requirePermission`.
  async requireSession(request: FastifyRequest): Promise<SessionContext> {
    return requireAdminSession(this.auth, request);
  }

  async requirePermission(
    request: FastifyRequest,
    permission: AdminPermission,
    options?: RequirePermissionOptions,
  ): Promise<SessionContext> {
    const session = await requireAdminSession(this.auth, request);

    if (options?.requires2fa && !this.hasFreshTwoFactor(session)) {
      throw twoFactorRequired('This action requires a freshly verified second factor');
    }

    const grant = await this.prisma.client.adminPermissionGrant.findUnique({
      where: { userId_permission: { userId: session.user.id, permission } },
    });
    if (!grant) {
      throw forbidden(`Missing the '${permission}' admin permission`);
    }

    return session;
  }

  hasFreshTwoFactor(session: SessionContext): boolean {
    const verifiedAt = session.session.twoFactorVerifiedAt;
    const verifiedAtMs = verifiedAt ? new Date(verifiedAt).getTime() : Number.NaN;
    return (
      Number.isFinite(verifiedAtMs) &&
      Date.now() - verifiedAtMs <= TWO_FACTOR_FRESH_VERIFICATION_WINDOW_MS
    );
  }

  async hasPermission(userId: string, permission: AdminPermission): Promise<boolean> {
    const grant = await this.prisma.client.adminPermissionGrant.findUnique({
      where: { userId_permission: { userId, permission } },
    });
    return grant !== null;
  }

  // The bypass for admin-protected targets (docs/steps/378-offline-data-requests.md
  // #417): a superadmin acting with a second factor verified in the last 15
  // minutes, same window `x-requires-2fa` routes enforce.
  async isSuperadminWithFreshTwoFactor(session: SessionContext): Promise<boolean> {
    if (!this.hasFreshTwoFactor(session)) {
      return false;
    }
    return this.hasPermission(session.user.id, 'superadmin');
  }
}
