import { Inject, Injectable } from '@nestjs/common';
import type { AdminMeSchema } from '@photoo/shared';
import type { z } from 'zod';
import {
  TWO_FACTOR_FRESH_VERIFICATION_WINDOW_MS,
  TWO_FACTOR_VERIFICATION_WINDOW_MS,
} from '../../common/auth/require-admin.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SessionContext } from '../auth/session.js';

type AdminMeDto = z.infer<typeof AdminMeSchema>;

function expiryFrom(verifiedAt: string | Date | null | undefined, windowMs: number): string | null {
  if (!verifiedAt) {
    return null;
  }
  return new Date(new Date(verifiedAt).getTime() + windowMs).toISOString();
}

@Injectable()
export class AdminMeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(session: SessionContext): Promise<AdminMeDto> {
    const grants = await this.prisma.client.adminPermissionGrant.findMany({
      where: { userId: session.user.id },
      select: { permission: true },
      orderBy: { permission: 'asc' },
    });

    const verifiedAt = session.session.twoFactorVerifiedAt;

    return {
      permissions: grants.map((grant) => grant.permission),
      sessionExpiresAt: expiryFrom(verifiedAt, TWO_FACTOR_VERIFICATION_WINDOW_MS),
      twoFactorFreshUntil: expiryFrom(verifiedAt, TWO_FACTOR_FRESH_VERIFICATION_WINDOW_MS),
    };
  }
}
