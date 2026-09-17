import { describe, expect, it, vi } from 'vitest';
import { AuditLogService } from './audit-log.service.js';

function fakePrisma() {
  const create = vi.fn().mockResolvedValue(undefined);
  return { client: { auditLog: { create } }, create };
}

describe('AuditLogService', () => {
  it('writes before and after when both are given', async () => {
    const { client, create } = fakePrisma();
    const service = new AuditLogService({ client } as never);

    await service.record({
      actorType: 'system',
      actorId: null,
      action: 'upload.infected',
      targetType: 'Upload',
      targetId: 'upload-1',
      before: { status: 'scanning' },
      after: { status: 'infected' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'upload.infected',
        targetType: 'Upload',
        targetId: 'upload-1',
        before: { status: 'scanning' },
        after: { status: 'infected' },
      },
    });
  });

  it('omits before/after entirely when neither is given', async () => {
    const { client, create } = fakePrisma();
    const service = new AuditLogService({ client } as never);

    await service.record({
      actorType: 'system',
      actorId: null,
      action: 'upload.infected',
      targetType: 'Upload',
      targetId: 'upload-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'upload.infected',
        targetType: 'Upload',
        targetId: 'upload-1',
      },
    });
  });
});
