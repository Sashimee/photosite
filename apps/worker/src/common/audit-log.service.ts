import { Inject, Injectable } from '@nestjs/common';
import type { AuditActorType } from '@photoo/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RecordAuditLogInput {
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    const before = input.before === undefined ? {} : { before: input.before as object };
    const after = input.after === undefined ? {} : { after: input.after as object };
    await this.prisma.client.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...before,
        ...after,
      },
    });
  }
}
