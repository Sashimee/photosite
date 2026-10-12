import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { HANDLED_EVENT_TYPES, StripeWebhookService } from './stripe-webhook.service.js';

// Younger events may still be mid-transaction in the request that received
// them; older ones are past Stripe's own retry horizon and need a human.
export const STUCK_EVENT_MIN_AGE_MS = 5 * 60 * 1000;
export const STUCK_EVENT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const SWEEP_BATCH_SIZE = 100;
// Dispute events were stored unhandled before their handlers existed, so any
// age is picked up; a dispute stays actionable long after Stripe stops retrying.
export const BACKFILLED_EVENT_TYPES = ['charge.dispute.created', 'charge.dispute.closed'] as const;

export interface SweepResult {
  attempted: number;
  processed: number;
  deferred: number;
  failed: number;
}

@Injectable()
export class StripeEventSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StripeWebhookService) private readonly webhooks: StripeWebhookService,
    @Inject(APP_CONFIG) private readonly env: Env,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.env.STRIPE_EVENT_SWEEP_INTERVAL_MS;
    if (interval === 0) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runScheduled();
    }, interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const stuck = await this.prisma.client.stripeEvent.findMany({
      where: {
        processedAt: null,
        receivedAt: { lt: new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS) },
        OR: [
          {
            type: { in: [...HANDLED_EVENT_TYPES] },
            receivedAt: { gt: new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS) },
          },
          { type: { in: [...BACKFILLED_EVENT_TYPES] } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: SWEEP_BATCH_SIZE,
      select: { id: true, type: true },
    });
    const result: SweepResult = {
      attempted: stuck.length,
      processed: 0,
      deferred: 0,
      failed: 0,
    };
    for (const event of stuck) {
      try {
        const status = await this.webhooks.reprocess(event.id);
        if (status !== 'skipped') {
          result[status] += 1;
        }
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          { stripeEventId: event.id, type: event.type, err: error },
          'stripe event sweep: reprocessing failed',
        );
      }
    }
    if (stuck.length > 0) {
      this.logger.log(result, 'stripe event sweep: finished');
    }
    return result;
  }

  private async runScheduled(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error({ err: error }, 'stripe event sweep: run failed');
    } finally {
      this.running = false;
    }
  }
}
