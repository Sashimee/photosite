import { Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';

export interface RecordAdminAuditInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

// Takes the transaction client rather than holding its own `PrismaService`,
// so it is structurally impossible to write an admin audit row outside the
// transaction that made the change it describes (docs/steps/1A.11-admin-api.md):
// a row can never survive a rollback of the change it documents. Callers
// pass redacted `before`/`after` projections, never a whole Prisma row, so a
// password hash or a verification document key can never end up here.
@Injectable()
export class AdminAuditService {
  async record(tx: Prisma.TransactionClient, input: RecordAdminAuditInput): Promise<void> {
    const before = input.before === undefined ? {} : { before: input.before as object };
    const after = input.after === undefined ? {} : { after: input.after as object };
    await tx.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ip: input.ip ?? null,
        ...before,
        ...after,
      },
    });
  }
}
