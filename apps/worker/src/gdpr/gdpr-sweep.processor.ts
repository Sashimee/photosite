import type { PrismaClient } from '@photoo/db';
import * as Sentry from '@sentry/node';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../common/audit-log.service.js';
import { reportSweepFailure } from '../common/monitoring/report-sweep-failure.js';
import type { JobQueueLike } from '../queues/processors/types.js';
import { anonymiseDeletions, type AnonymiseStorage } from './sweep/anonymise-deletions.js';
import { expireExports, type ExpireExportsStorage } from './sweep/expire-exports.js';
import { failStuckExports } from './sweep/fail-stuck-exports.js';
import { purgeChat, type PurgeChatStorage } from './sweep/purge-chat.js';

export interface GdprSweepDeps {
  prisma: { client: PrismaClient };
  storage: AnonymiseStorage & PurgeChatStorage & ExpireExportsStorage;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
  monitorSlug: string;
  monitorIntervalMs: number;
  emailQueue: JobQueueLike;
  webAppUrl: string;
}

// Four independent phases behind one queue rather than three near-identical
// repeatables (docs/steps/1A.12-gdpr.md "One repeatable sweep, explicit
// phases"): each phase writes its own AuditLog with counts, and a failure
// in one must not skip the others, so every phase is wrapped individually
// instead of letting one throw stop the run.
const CHECKIN_MARGIN_MINUTES = 15;

export function createGdprSweepProcessor(deps: GdprSweepDeps): Processor {
  return async () => {
    const checkInId = beginCheckIn(deps.monitorSlug, deps.monitorIntervalMs);
    let status: 'ok' | 'error' = 'error';
    try {
      const results = [
        await runPhase(
          deps.logger,
          'anonymise-deletions',
          () => anonymiseDeletions(deps),
          (result) => result.usersFailed > 0,
        ),
        await runPhase(deps.logger, 'purge-chat', () => purgeChat(deps)),
        await runPhase(deps.logger, 'expire-exports', () => expireExports(deps)),
        await runPhase(deps.logger, 'fail-stuck-exports', () => failStuckExports(deps)),
      ];
      status = results.every(Boolean) ? 'ok' : 'error';
    } finally {
      finishCheckIn(deps.monitorSlug, checkInId, status);
    }
  };
}

async function runPhase<T>(
  logger: Logger,
  name: string,
  phase: () => Promise<T>,
  isPhaseFailure?: (result: T) => boolean,
): Promise<boolean> {
  try {
    const result = await phase();
    return !(isPhaseFailure?.(result) ?? false);
  } catch (error) {
    logger.error(
      { err: error, phase: name },
      'gdpr-sweep: phase failed, continuing to the next one',
    );
    reportSweepFailure(name, error, {});
    return false;
  }
}

function beginCheckIn(monitorSlug: string, monitorIntervalMs: number): string | undefined {
  if (!Sentry.isInitialized()) {
    return undefined;
  }
  const intervalMinutes = Math.max(1, Math.ceil(monitorIntervalMs / 60_000));
  // A sweep normally finishes in seconds, so bounding maxRuntime to the full
  // interval is generous while still catching a run that never finishes.
  return Sentry.captureCheckIn(
    { monitorSlug, status: 'in_progress' },
    {
      schedule: { type: 'interval', value: intervalMinutes, unit: 'minute' },
      checkinMargin: CHECKIN_MARGIN_MINUTES,
      maxRuntime: intervalMinutes,
    },
  );
}

function finishCheckIn(
  monitorSlug: string,
  checkInId: string | undefined,
  status: 'ok' | 'error',
): void {
  if (checkInId === undefined) {
    return;
  }
  Sentry.captureCheckIn({ monitorSlug, status, checkInId });
}
