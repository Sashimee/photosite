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

  async requirePermission(
    request: FastifyRequest,
    permission: AdminPermission,
    options?: RequirePermissionOptions,
  ): Promise<SessionContext> {
    const session = await requireAdminSession(this.auth, request);

    if (options?.requires2fa) {
      const verifiedAt = session.session.twoFactorVerifiedAt;
      const verifiedAtMs = verifiedAt ? new Date(verifiedAt).getTime() : Number.NaN;
      if (
        !Number.isFinite(verifiedAtMs) ||
        Date.now() - verifiedAtMs > TWO_FACTOR_FRESH_VERIFICATION_WINDOW_MS
      ) {
        throw twoFactorRequired('This action requires a freshly verified second factor');
      }
    }

    const grant = await this.prisma.client.adminPermissionGrant.findUnique({
      where: { userId_permission: { userId: session.user.id, permission } },
    });
    if (!grant) {
      throw forbidden(`Missing the '${permission}' admin permission`);
    }

    return session;
  }
}
