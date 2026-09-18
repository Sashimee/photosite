import { Inject, Injectable } from '@nestjs/common';
import type { AdminPermission } from '@photoo/shared';
import type { Prisma } from '@photoo/db';
import { forbidden } from '../../common/auth/require-admin.js';
import { AdminAuditService } from './admin-audit.service.js';

// No `/admin` route exposes this (docs/steps/1A.11-admin-api.md: "there is
// deliberately no bootstrap endpoint" for the first superadmin, and the
// human follow-up has the team deciding permissions before launch). This
// exists so that decision - only `superadmin` grants or revokes, and never
// for the granter's own account - is enforced in one place rather than
// re-derived by the seed script and any future admin UI that needs it.
@Injectable()
export class AdminPermissionsService {
  constructor(@Inject(AdminAuditService) private readonly auditService: AdminAuditService) {}

  async grant(
    tx: Prisma.TransactionClient,
    granterId: string,
    targetUserId: string,
    permission: AdminPermission,
    ip: string | null,
  ): Promise<void> {
    await this.assertCanManage(tx, granterId, targetUserId);

    await tx.adminPermissionGrant.upsert({
      where: { userId_permission: { userId: targetUserId, permission } },
      create: { userId: targetUserId, permission, grantedByAdminId: granterId },
      update: {},
    });

    await this.auditService.record(tx, {
      actorId: granterId,
      action: 'admin_permission.granted',
      targetType: 'User',
      targetId: targetUserId,
      after: { permission },
      ip,
    });
  }

  async revoke(
    tx: Prisma.TransactionClient,
    granterId: string,
    targetUserId: string,
    permission: AdminPermission,
    ip: string | null,
  ): Promise<void> {
    await this.assertCanManage(tx, granterId, targetUserId);

    await tx.adminPermissionGrant.deleteMany({ where: { userId: targetUserId, permission } });

    await this.auditService.record(tx, {
      actorId: granterId,
      action: 'admin_permission.revoked',
      targetType: 'User',
      targetId: targetUserId,
      before: { permission },
      ip,
    });
  }

  private async assertCanManage(
    tx: Prisma.TransactionClient,
    granterId: string,
    targetUserId: string,
  ): Promise<void> {
    if (granterId === targetUserId) {
      throw forbidden('An admin cannot grant or revoke their own permissions');
    }
    const granterIsSuperadmin = await tx.adminPermissionGrant.findUnique({
      where: { userId_permission: { userId: granterId, permission: 'superadmin' } },
    });
    if (!granterIsSuperadmin) {
      throw forbidden('The superadmin permission is required to manage admin permissions');
    }
  }
}
