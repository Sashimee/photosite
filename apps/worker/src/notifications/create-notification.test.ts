import { describe, expect, it, vi } from 'vitest';
import { createNotification } from './create-notification.js';

describe('createNotification', () => {
  it('resolves channels from preferences, creates the row and enqueues with jobId = notificationId', async () => {
    const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(() =>
      Promise.resolve({ id: 'notification-1' }),
    );
    const findMany = vi.fn(() =>
      Promise.resolve([{ type: 'quote_expired', channel: 'email' as const, enabled: false }]),
    );
    const add = vi.fn<
      (name: string, data: unknown, opts?: Record<string, unknown>) => Promise<void>
    >(() => Promise.resolve());

    await createNotification(
      {
        prisma: { client: { notification: { create }, notificationPreference: { findMany } } },
        notifyQueue: { add },
      },
      'user-1',
      'quote_expired',
      { quoteId: 'quote-1' },
    );

    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'user-1', type: 'quote_expired' } });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'quote_expired',
        payload: { quoteId: 'quote-1' },
        channels: ['push', 'in_app'],
      },
    });
    expect(add).toHaveBeenCalledWith(
      'notify',
      { notificationId: 'notification-1' },
      expect.objectContaining({ jobId: 'notification-1' }),
    );
  });

  it('defaults to every channel on when there are no preference rows', async () => {
    const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(() =>
      Promise.resolve({ id: 'notification-1' }),
    );

    await createNotification(
      {
        prisma: {
          client: {
            notification: { create },
            notificationPreference: { findMany: () => Promise.resolve([]) },
          },
        },
        notifyQueue: {
          add: vi.fn<
            (name: string, data: unknown, opts?: Record<string, unknown>) => Promise<void>
          >(() => Promise.resolve()),
        },
      },
      'user-1',
      'quote_received',
      { quoteId: 'quote-1' },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channels: ['email', 'push', 'in_app'] }) as unknown,
      }) as unknown,
    );
  });
});
