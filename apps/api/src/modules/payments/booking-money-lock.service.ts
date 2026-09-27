import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { createKeyedLock, type KeyedLock, type KeyedLockResult } from '@photoo/db';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../../config/env.js';

export function bookingMoneyLockKey(bookingId: string): string {
  return `booking-money:${bookingId}`;
}

// Refunds, transfer reversals and release each plan under a row lock, call
// Stripe outside any transaction, then record under a second row lock. The
// per-booking advisory lock spans all three steps so two of them can never
// both plan against the same ledger totals.
@Injectable()
export class BookingMoneyLockService implements OnApplicationShutdown {
  private readonly lock: KeyedLock;

  constructor(@Inject(APP_CONFIG) config: Env, @Inject(Logger) logger: Logger) {
    this.lock = createKeyedLock(config.DATABASE_URL, {
      maxConnections: 5,
      onIdleClientError: (error) => {
        logger.warn({ err: error }, 'booking money lock: idle connection failed');
      },
    });
  }

  tryRun<T>(bookingId: string, fn: () => Promise<T>): Promise<KeyedLockResult<T>> {
    return this.lock.tryRun(bookingMoneyLockKey(bookingId), fn);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.lock.end();
  }
}
