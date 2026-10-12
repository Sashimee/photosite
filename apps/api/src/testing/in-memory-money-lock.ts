import type { KeyedLockResult } from '@photoo/db';
import type { BookingMoneyLockService } from '../modules/payments/booking-money-lock.service.js';

export class InMemoryMoneyLock {
  readonly held = new Set<string>();

  async tryRun<T>(bookingId: string, fn: () => Promise<T>): Promise<KeyedLockResult<T>> {
    if (this.held.has(bookingId)) {
      return { acquired: false };
    }
    this.held.add(bookingId);
    try {
      return { acquired: true, value: await fn() };
    } finally {
      this.held.delete(bookingId);
    }
  }

  asService(): BookingMoneyLockService {
    return this as unknown as BookingMoneyLockService;
  }
}
