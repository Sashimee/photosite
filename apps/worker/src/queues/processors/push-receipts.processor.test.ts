import { Prisma } from '@photoo/db';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createPushReceiptsProcessor } from './push-receipts.processor.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const FAKE_JOB = {} as Job;

describe('createPushReceiptsProcessor', () => {
  it('does nothing when no ticket is due', async () => {
    const getReceipts = vi.fn();
    const deviceDelete = vi.fn();

    await createPushReceiptsProcessor({
      prisma: { client: { device: { delete: deviceDelete } } },
      pushSender: { send: vi.fn(), getReceipts },
      pushTicketStore: { store: vi.fn(), takeDue: () => Promise.resolve([]), clear: vi.fn() },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(getReceipts).not.toHaveBeenCalled();
    expect(deviceDelete).not.toHaveBeenCalled();
  });

  it('deletes the device for a DeviceNotRegistered receipt, then clears the ticket', async () => {
    const deviceDelete = vi.fn(() => Promise.resolve());
    const clear = vi.fn(() => Promise.resolve());

    await createPushReceiptsProcessor({
      prisma: { client: { device: { delete: deviceDelete } } },
      pushSender: {
        send: vi.fn(),
        getReceipts: () =>
          Promise.resolve({ 'ticket-1': { ok: false, deviceNotRegistered: true } }),
      },
      pushTicketStore: {
        store: vi.fn(),
        takeDue: () => Promise.resolve([{ ticketId: 'ticket-1', deviceId: 'device-1' }]),
        clear,
      },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(deviceDelete).toHaveBeenCalledWith({ where: { id: 'device-1' } });
    expect(clear).toHaveBeenCalledWith(['ticket-1']);
  });

  it('leaves the device alone for an ok receipt', async () => {
    const deviceDelete = vi.fn(() => Promise.resolve());

    await createPushReceiptsProcessor({
      prisma: { client: { device: { delete: deviceDelete } } },
      pushSender: {
        send: vi.fn(),
        getReceipts: () =>
          Promise.resolve({ 'ticket-1': { ok: true, deviceNotRegistered: false } }),
      },
      pushTicketStore: {
        store: vi.fn(),
        takeDue: () => Promise.resolve([{ ticketId: 'ticket-1', deviceId: 'device-1' }]),
        clear: vi.fn(),
      },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(deviceDelete).not.toHaveBeenCalled();
  });

  it('does not throw when the device was already deleted', async () => {
    const deviceDelete = vi.fn(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      ),
    );

    await expect(
      createPushReceiptsProcessor({
        prisma: { client: { device: { delete: deviceDelete } } },
        pushSender: {
          send: vi.fn(),
          getReceipts: () =>
            Promise.resolve({ 'ticket-1': { ok: false, deviceNotRegistered: true } }),
        },
        pushTicketStore: {
          store: vi.fn(),
          takeDue: () => Promise.resolve([{ ticketId: 'ticket-1', deviceId: 'device-1' }]),
          clear: vi.fn(),
        },
        logger: fakeLogger(),
      })(FAKE_JOB, undefined, undefined),
    ).resolves.toBeUndefined();
  });
});
