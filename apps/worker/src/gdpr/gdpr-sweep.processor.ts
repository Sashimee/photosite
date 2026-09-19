import type { PrismaClient } from '@photoo/db';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../common/audit-log.service.js';
import { anonymiseDeletions, type AnonymiseStorage } from './sweep/anonymise-deletions.js';
import { expireExports, type ExpireExportsStorage } from './sweep/expire-exports.js';
import { failStuckExports } from './sweep/fail-stuck-exports.js';
import { purgeChat, type PurgeChatStorage } from './sweep/purge-chat.js';

export interface GdprSweepDeps {
  prisma: { client: PrismaClient };
  storage: AnonymiseStorage & PurgeChatStorage & ExpireExportsStorage;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
}

// Four independent phases behind one queue rather than three near-identical
// repeatables (docs/steps/1A.12-gdpr.md "One repeatable sweep, explicit
// phases"): each phase writes its own AuditLog with counts, and a failure
// in one must not skip the others, so every phase is wrapped individually
// instead of letting one throw stop the run.
export function createGdprSweepProcessor(deps: GdprSweepDeps): Processor {
  return async () => {
    await runPhase(deps.logger, 'anonymise-deletions', () => anonymiseDeletions(deps));
    await runPhase(deps.logger, 'purge-chat', () => purgeChat(deps));
    await runPhase(deps.logger, 'expire-exports', () => expireExports(deps));
    await runPhase(deps.logger, 'fail-stuck-exports', () => failStuckExports(deps));
  };
}

async function runPhase(
  logger: Logger,
  name: string,
  phase: () => Promise<unknown>,
): Promise<void> {
  try {
    await phase();
  } catch (error) {
    logger.error(
      { err: error, phase: name },
      'gdpr-sweep: phase failed, continuing to the next one',
    );
  }
}
