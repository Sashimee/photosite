import type { Readable } from 'node:stream';
import { HttpException } from '@nestjs/common';
import {
  ADMIN_BOOKING_LEDGER_LIMIT,
  ADMIN_BOOKINGS_EXPORT_COLUMNS,
  AdminBookingsExportQuerySchema,
  AdminBookingsQuerySchema,
} from '@photoo/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import {
  AdminBookingsService,
  csvCell,
  exportFilename,
  filterFingerprint,
  moneyHints,
} from './admin-bookings.service.js';
import { EMPTY_LEDGER_TOTALS } from './booking-ledger.js';

const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const CREATED = new Date('2026-10-01T09:00:00.000Z');

interface LedgerRow {
  id: string;
  bookingId: string;
  type: string;
  amountCents: number;
  currency: string;
  stripeObjectId: string;
  occurredAt: Date;
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    quoteId: ID,
    clientId: ID,
    photographerId: ID,
    scheduledAt: null,
    status: 'released',
    paymentIntentId: 'pi_1',
    chargeId: 'ch_1',
    transferId: 'tr_1',
    releaseDueAt: null,
    deliveredAt: null,
    releasedAt: CREATED,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    quote: { totalCents: 25050, currency: 'EUR' },
    photographer: {
      stripeAccountId: 'acct_1',
      stripeOnboardingComplete: true,
      stripePayoutsEnabled: false,
    },
    ...overrides,
  };
}

function ledgerRow(type: string, amountCents: number, n: number): LedgerRow {
  return {
    id: `0199${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`,
    bookingId: ID,
    type,
    amountCents,
    currency: 'EUR',
    stripeObjectId: `obj_${String(n)}`,
    occurredAt: new Date(CREATED.getTime() + n * 1000),
  };
}

function withoutBookingId<T extends { bookingId: string }>(row: T): Omit<T, 'bookingId'> {
  const copy: Partial<T> = { ...row };
  delete copy.bookingId;
  return copy as Omit<T, 'bookingId'>;
}

function setup(options: { rows?: ReturnType<typeof bookingRow>[]; ledger?: LedgerRow[] } = {}) {
  const rows = options.rows ?? [bookingRow()];
  const ledger = options.ledger ?? [];
  const disputes = [
    {
      id: ID,
      bookingId: ID,
      status: 'won',
      reason: 'fraudulent',
      resolution: 'Evidence accepted',
      amountRefundedCents: null,
      openedById: ID,
      adminId: null,
      createdAt: CREATED,
      updatedAt: new Date('2026-10-05T09:00:00.000Z'),
    },
  ];
  const client = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    auditLog: { create: vi.fn((args: unknown) => Promise.resolve(args)) },
    booking: {
      findMany: vi.fn<(args: { where: { AND: unknown[] }; take?: number }) => Promise<typeof rows>>(
        (args) => {
          const start = startAfterKeyset(rows, args.where.AND);
          return Promise.resolve(
            rows.slice(start, args.take === undefined ? undefined : start + args.take),
          );
        },
      ),
      findUnique: vi.fn(() => Promise.resolve(rows[0] ?? null)),
    },
    ledgerEntry: {
      groupBy: vi.fn((args: { where: { type: { in: string[] } } }) => {
        const sums = new Map<string, { sum: number; count: number }>();
        for (const row of ledger.filter((entry) => args.where.type.in.includes(entry.type))) {
          const current = sums.get(row.type) ?? { sum: 0, count: 0 };
          sums.set(row.type, { sum: current.sum + row.amountCents, count: current.count + 1 });
        }
        return Promise.resolve(
          [...sums].map(([type, group]) => ({
            bookingId: ID,
            type,
            _sum: { amountCents: group.sum },
            _count: { _all: group.count },
          })),
        );
      }),
      findMany: vi.fn((args: { where: { type?: string }; take?: number }) => {
        const matching = ledger.filter(
          (row) => args.where.type === undefined || row.type === args.where.type,
        );
        return Promise.resolve(
          matching.slice(0, args.take ?? matching.length).map(withoutBookingId),
        );
      }),
    },
    dispute: {
      findMany: vi.fn((args: { distinct?: string[] }) =>
        Promise.resolve(
          args.distinct
            ? disputes.map((row) => ({ bookingId: row.bookingId, status: row.status }))
            : disputes.map(withoutBookingId),
        ),
      ),
    },
  };
  const transaction = vi.fn(
    (fn: (tx: typeof client) => Promise<unknown>, options?: { isolationLevel: string }) =>
      options === undefined || options.isolationLevel === 'RepeatableRead'
        ? fn(client)
        : Promise.reject(new Error(`unexpected isolation level ${options.isolationLevel}`)),
  );
  const prisma = { client: { ...client, $transaction: transaction } } as unknown as PrismaService;
  return {
    service: new AdminBookingsService(prisma, new AdminAuditService()),
    client,
    transaction,
  };
}

// The mocked rows are already in keyset order, so continuing after a key is
// starting after that row's index.
function startAfterKeyset(rows: { id: string }[], where: unknown[]): number {
  const keyset = where
    .map((clause) => (clause as { OR?: [unknown, { id?: { gt?: string } }] }).OR?.[1]?.id?.gt)
    .findLast((id) => id !== undefined);
  return keyset === undefined ? 0 : rows.findIndex((row) => row.id === keyset) + 1;
}

function query(input: Record<string, unknown> = {}) {
  return AdminBookingsQuerySchema.parse(input);
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof HttpException)) {
    throw new Error('expected an HttpException');
  }
  return error;
}

describe('moneyHints', () => {
  const released = { ...EMPTY_LEDGER_TOTALS, transferredCents: 23797 };

  it('caps refundable at what is left on the transfer for a released booking', () => {
    expect(moneyHints('released', 25050, released)).toEqual({
      refundableCents: 23797,
      reversibleCents: 23797,
    });
  });

  it('subtracts refunds and reversals after a partial reversal', () => {
    expect(
      moneyHints('released', 25050, { ...released, refundedCents: 4000, reversedCents: 4000 }),
    ).toEqual({ refundableCents: 19797, reversibleCents: 19797 });
    expect(moneyHints('released', 25050, { ...released, reversedCents: 20000 })).toEqual({
      refundableCents: 3797,
      reversibleCents: 3797,
    });
  });

  it('is bounded by the client total when more was refunded than reversed', () => {
    expect(moneyHints('released', 25050, { ...released, refundedCents: 24000 })).toEqual({
      refundableCents: 1050,
      reversibleCents: 23797,
    });
  });

  it('is zero refundable outside released and never negative', () => {
    for (const status of ['paid_held', 'delivered', 'disputed', 'refunded'] as const) {
      expect(moneyHints(status, 25050, released).refundableCents).toBe(0);
    }
    expect(moneyHints('disputed', 25050, released).reversibleCents).toBe(23797);
    expect(
      moneyHints('released', 25050, { ...released, refundedCents: 30000, reversedCents: 30000 }),
    ).toEqual({ refundableCents: 0, reversibleCents: 0 });
  });
});

describe('filterFingerprint', () => {
  it('ignores paging and status order but not the filters', () => {
    const base = filterFingerprint(query({ status: ['released', 'disputed'] }));
    expect(filterFingerprint(query({ status: ['disputed', 'released'], limit: 5 }))).toBe(base);
    expect(filterFingerprint(query({ status: 'released' }))).not.toBe(base);
    expect(filterFingerprint(query())).not.toBe(filterFingerprint(query({ dispute: 'none' })));
  });
});

describe('AdminBookingsService.list', () => {
  it('passes every filter to the query and keeps the keyset order', async () => {
    const { service, client } = setup();

    await service.list(
      query({
        status: ['released', 'disputed'],
        createdFrom: '2026-10-01',
        createdTo: '2026-11-01',
        dispute: 'open',
      }),
    );

    expect(client.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { status: { in: ['disputed', 'released'] } },
            {
              createdAt: {
                gte: new Date('2026-10-01T00:00:00.000Z'),
                lt: new Date('2026-11-01T00:00:00.000Z'),
              },
            },
            { disputes: { some: { status: 'open' } } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('maps the any and none dispute filters', async () => {
    const { service, client } = setup();
    await service.list(query({ dispute: 'any' }));
    await service.list(query({ dispute: 'none' }));
    expect(client.booking.findMany.mock.calls.map((call) => call[0].where)).toEqual([
      { AND: [{ disputes: { some: {} } }] },
      { AND: [{ disputes: { none: {} } }] },
    ]);
  });

  it('continues with the cursor it issued for the same filters', async () => {
    const rows = [bookingRow(), bookingRow({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa7' })];
    const { service, client } = setup({ rows });
    const first = await service.list(query({ limit: 1, dispute: 'none' }));
    expect(first.nextCursor).not.toBeNull();

    await service.list(query({ limit: 1, dispute: 'none', cursor: first.nextCursor }));

    expect(client.booking.findMany.mock.calls[1]?.[0]?.where).toEqual({
      AND: [
        { disputes: { none: {} } },
        {
          OR: [{ createdAt: { lt: CREATED } }, { createdAt: CREATED, id: { gt: ID } }],
        },
      ],
    });
  });

  it('rejects a cursor issued for another filter set with 400', async () => {
    const rows = [bookingRow(), bookingRow({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa7' })];
    const { service, client } = setup({ rows });
    const first = await service.list(query({ limit: 1, dispute: 'none' }));

    const error = await rejection(
      service.list(query({ limit: 1, dispute: 'any', cursor: first.nextCursor })),
    );

    expect(error.getStatus()).toBe(400);
    expect(client.booking.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor without a filter fingerprint with 400', async () => {
    const { service } = setup();
    const legacy = Buffer.from(
      JSON.stringify({ createdAt: CREATED.toISOString(), id: ID }),
    ).toString('base64url');

    expect((await rejection(service.list(query({ cursor: legacy })))).getStatus()).toBe(400);
  });

  it('returns the money hints on every list item', async () => {
    const { service } = setup({
      ledger: [ledgerRow('charge', 25050, 1), ledgerRow('transfer', -23797, 2)],
    });
    const page = await service.list(query());
    expect(page.items[0]).toMatchObject({
      refundedCents: 0,
      reversedCents: 0,
      refundableCents: 23797,
      reversibleCents: 23797,
      disputeStatus: 'won',
    });
  });
});

describe('AdminBookingsService.get', () => {
  it('reads the detail in one repeatable-read snapshot', async () => {
    const { service, transaction } = setup();
    await service.get(ID);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('returns the ledger oldest first with signed amounts, disputes and the payout state', async () => {
    const { service } = setup({
      ledger: [
        ledgerRow('charge', 25050, 1),
        ledgerRow('transfer', -23797, 2),
        ledgerRow('platform_fee', -1253, 3),
        ledgerRow('payout', -23797, 4),
      ],
    });

    const detail = await service.get(ID);

    expect(detail.ledger.map((row) => [row.type, row.amountCents])).toEqual([
      ['charge', 25050],
      ['transfer', -23797],
      ['platform_fee', -1253],
      ['payout', -23797],
    ]);
    expect(detail.ledger[0]?.occurredAt).toBe('2026-10-01T09:00:01.000Z');
    expect(detail.ledgerTruncated).toBe(false);
    expect(detail.disputes).toEqual([
      {
        id: ID,
        status: 'won',
        reason: 'fraudulent',
        resolution: 'Evidence accepted',
        amountRefundedCents: null,
        openedById: ID,
        adminId: null,
        openedAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-05T09:00:00.000Z',
      },
    ]);
    expect(detail.payout).toEqual({
      stripeAccountId: 'acct_1',
      onboardingComplete: true,
      payoutsEnabled: false,
      entries: [expect.objectContaining({ type: 'payout', amountCents: -23797 })],
    });
  });

  it('caps the ledger and flags the truncation', async () => {
    const ledger = Array.from({ length: ADMIN_BOOKING_LEDGER_LIMIT + 5 }, (_, n) =>
      ledgerRow('refund', -1, n),
    );
    const { service } = setup({ ledger });

    const detail = await service.get(ID);

    expect(detail.ledger).toHaveLength(ADMIN_BOOKING_LEDGER_LIMIT);
    expect(detail.ledger[0]?.stripeObjectId).toBe('obj_0');
    expect(detail.ledgerTruncated).toBe(true);
    expect(detail.refundedCents).toBe(ADMIN_BOOKING_LEDGER_LIMIT + 5);
  });

  it('returns payout null when the photographer has no Connect account', async () => {
    const { service } = setup({
      rows: [
        bookingRow({
          photographer: {
            stripeAccountId: null,
            stripeOnboardingComplete: false,
            stripePayoutsEnabled: false,
          },
        }),
      ],
    });
    expect((await service.get(ID)).payout).toBeNull();
  });

  it('answers 404 for an unknown booking', async () => {
    const { service } = setup({ rows: [] });
    expect((await rejection(service.get(ID))).getStatus()).toBe(404);
  });
});

function exportQuery(input: Record<string, unknown> = {}) {
  return AdminBookingsExportQuerySchema.parse(input);
}

async function readAll(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function idAt(n: number): string {
  return `0199${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`;
}

const HEADER_LINE = `${ADMIN_BOOKINGS_EXPORT_COLUMNS.map((column) => `"${column}"`).join(',')}\r\n`;

describe('csvCell', () => {
  it('quotes every value and doubles embedded quotes', () => {
    expect(csvCell('pi_1')).toBe('"pi_1"');
    expect(csvCell('say "hi", then\r\nleave')).toBe('"say ""hi"", then\r\nleave"');
    expect(csvCell('')).toBe('""');
    expect(csvCell(null)).toBe('""');
  });

  it('prefixes a cell that a spreadsheet would read as a formula', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${lead}SUM(A1)`)).toBe(`"'${lead}SUM(A1)"`);
    }
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('12.34')).toBe('"12.34"');
    expect(csvCell('a=b')).toBe('"a=b"');
  });
});

describe('exportFilename', () => {
  it('names the created range, or all up to the export day', () => {
    const now = new Date('2026-10-07T23:59:00.000Z');
    expect(
      exportFilename(exportQuery({ createdFrom: '2026-09-01', createdTo: '2026-10-01' }), now),
    ).toBe('photoo-bookings-2026-09-01-2026-10-01.csv');
    expect(exportFilename(exportQuery({ status: 'released' }), now)).toBe(
      'photoo-bookings-all-2026-10-07.csv',
    );
  });
});

describe('AdminBookingsService.exportCsv', () => {
  const admin = { id: ID };

  it('writes the header and one quoted row per booking with decimal money', async () => {
    const { service } = setup({
      ledger: [
        ledgerRow('transfer', -23797, 1),
        ledgerRow('reversal', 4000, 2),
        ledgerRow('refund', -4000, 3),
      ],
    });

    const { filename, body } = await service.exportCsv(admin, exportQuery(), '203.0.113.9');

    expect(filename).toMatch(/^photoo-bookings-all-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await readAll(body)).toBe(
      HEADER_LINE +
        [
          ID,
          'released',
          'EUR',
          '250.50',
          '40.00',
          '40.00',
          'won',
          '2026-10-01T09:00:00.000Z',
          '2026-10-01T09:00:00.000Z',
          '',
          '',
          'pi_1',
          'ch_1',
          'tr_1',
        ]
          .map((cell) => `"${cell}"`)
          .join(',') +
        '\r\n',
    );
  });

  it('prefixes a Stripe id that starts with a formula character', async () => {
    const { service } = setup({ rows: [bookingRow({ chargeId: '=cmd|calc' })] });
    const text = await readAll((await service.exportCsv(admin, exportQuery(), null)).body);
    expect(text).toContain(`"'=cmd|calc"`);
    expect(text).not.toContain(`,"=cmd`);
  });

  it.each([
    ['JPY', 25050, '25050', 4000, '4000'],
    ['KWD', 25050, '25.050', 4005, '4.005'],
  ])(
    'writes %s money in its own minor units',
    async (currency, totalCents, total, movedCents, moved) => {
      const { service } = setup({
        rows: [bookingRow({ quote: { totalCents, currency } })],
        ledger: [
          { ...ledgerRow('reversal', movedCents, 1), currency },
          { ...ledgerRow('refund', -movedCents, 2), currency },
        ],
      });

      const text = await readAll((await service.exportCsv(admin, exportQuery(), null)).body);

      const cells = (text.split('\r\n')[1] ?? '').slice(1, -1).split('","');
      expect(cells.slice(2, 6)).toEqual([currency, total, moved, moved]);
    },
  );

  it('writes zero refunded and reversed as a zero amount in the booking currency', async () => {
    const { service } = setup({
      rows: [bookingRow({ quote: { totalCents: 100, currency: 'JPY' } })],
    });

    const text = await readAll((await service.exportCsv(admin, exportQuery(), null)).body);

    const cells = (text.split('\r\n')[1] ?? '').slice(1, -1).split('","');
    expect(cells.slice(2, 6)).toEqual(['JPY', '100', '0', '0']);
  });

  it('writes only the header row when nothing matches', async () => {
    const { service } = setup({ rows: [] });
    const text = await readAll((await service.exportCsv(admin, exportQuery(), null)).body);
    expect(text).toBe(HEADER_LINE);
  });

  it('applies the filters and the list order to every batch', async () => {
    const { service, client } = setup({ rows: [] });
    await readAll(
      (
        await service.exportCsv(
          admin,
          exportQuery({
            status: 'released',
            createdFrom: '2026-10-01',
            createdTo: '2026-11-01',
            dispute: 'none',
          }),
          null,
        )
      ).body,
    );
    expect(client.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { status: { in: ['released'] } },
            {
              createdAt: {
                gte: new Date('2026-10-01T00:00:00.000Z'),
                lt: new Date('2026-11-01T00:00:00.000Z'),
              },
            },
            { disputes: { none: {} } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 501,
      }),
    );
  });

  it('pages through keyset batches until the rows run out', async () => {
    const rows = Array.from({ length: 5 }, (_, n) => bookingRow({ id: idAt(n) }));
    const { service, client } = setup({ rows });

    const text = await readAll(
      (await service.exportCsv(admin, exportQuery(), null, { batchSize: 2, cap: 100 })).body,
    );

    const lines = text.split('\r\n').filter((line) => line !== '');
    expect(lines.slice(1).map((line) => line.slice(1, 37))).toEqual(rows.map((row) => row.id));
    expect(lines.at(-1)).not.toBe('#truncated');
    expect(client.booking.findMany).toHaveBeenCalledTimes(3);
    expect(client.booking.findMany.mock.calls[1]?.[0]?.where.AND).toEqual([
      { OR: [{ createdAt: { lt: CREATED } }, { createdAt: CREATED, id: { gt: idAt(1) } }] },
    ]);
  });

  it('stops at the cap and ends with the truncated line', async () => {
    const rows = Array.from({ length: 5 }, (_, n) => bookingRow({ id: idAt(n) }));
    const { service } = setup({ rows });

    const text = await readAll(
      (await service.exportCsv(admin, exportQuery(), null, { batchSize: 2, cap: 3 })).body,
    );

    const lines = text.split('\r\n');
    expect(lines.slice(1, 4).map((line) => line.slice(1, 37))).toEqual([idAt(0), idAt(1), idAt(2)]);
    expect(lines.slice(4)).toEqual(['#truncated', '']);
  });

  it('does not mark an export truncated when the rows end exactly at the cap', async () => {
    const rows = Array.from({ length: 3 }, (_, n) => bookingRow({ id: idAt(n) }));
    const { service } = setup({ rows });
    const text = await readAll(
      (await service.exportCsv(admin, exportQuery(), null, { batchSize: 2, cap: 3 })).body,
    );
    expect(text).not.toContain('#truncated');
    expect(text.split('\r\n')).toHaveLength(5);
  });

  it('audits the canonical filters and the cap before reading any booking', async () => {
    const { service, client } = setup();

    await service.exportCsv(
      admin,
      exportQuery({
        status: ['released', 'disputed'],
        createdFrom: '2026-10-01',
        createdTo: '2026-11-01',
      }),
      '203.0.113.9',
    );

    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'admin',
        actorId: ID,
        action: 'admin.bookings_exported',
        targetType: 'Booking',
        targetId: null,
        ip: '203.0.113.9',
        after: {
          filters: {
            status: ['disputed', 'released'],
            createdFrom: '2026-10-01',
            createdTo: '2026-11-01',
            dispute: null,
          },
          cap: 50_000,
        },
      },
    });
    expect(client.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      client.booking.findMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('fails before any byte when the first batch cannot be read', async () => {
    const { service, client } = setup();
    client.booking.findMany.mockRejectedValueOnce(new Error('database down'));
    await expect(service.exportCsv(admin, exportQuery(), null)).rejects.toThrow('database down');
  });
});
