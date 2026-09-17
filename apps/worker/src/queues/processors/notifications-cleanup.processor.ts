import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';

export interface NotificationsCleanupDeps {
  prisma: {
    client: {
      notification: {
        deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
      };
    };
  };
  logger: Logger;
}

// Retention: 12 months (docs/COMPLIANCE.md "Retention").
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export function createNotificationsCleanupProcessor(deps: NotificationsCleanupDeps): Processor {
  return async () => {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const result = await deps.prisma.client.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    deps.logger.log(
      { count: result.count },
      'notifications-cleanup: deleted expired notifications',
    );
  };
}
