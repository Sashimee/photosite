import type { PrismaClient } from '@photoo/db';
import { calculatePlatformFee, type BookingDocument, type ReceiptPdfJob } from '@photoo/shared';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PutObjectInput } from '../storage/storage.service.js';
import { createReceiptPdfProcessor, type ReceiptPdfDeps } from './receipt-pdf.processor.js';

const BOOKING_ID = '0192f7a0-0000-7000-8000-000000000001';
const FEE = calculatePlatformFee(12_345, 5);

interface FakeLedgerRow {
  type: string;
  amountCents: number;
  currency: string;
}

function releasedLedger(): FakeLedgerRow[] {
  return [
    { type: 'charge', amountCents: 12_345, currency: 'eur' },
    { type: 'transfer', amountCents: -(12_345 - FEE), currency: 'eur' },
    { type: 'platform_fee', amountCents: -FEE, currency: 'eur' },
  ];
}

function fakeBooking(
  overrides: { releasedAt?: Date | null; ledgerEntries?: FakeLedgerRow[] } = {},
) {
  return {
    id: BOOKING_ID,
    releasedAt: new Date('2026-09-20T10:00:00Z'),
    quote: {
      lineItems: [{ label: 'Portrait session', qty: 1, unitCents: 12_345 }],
      subtotalCents: 12_345,
      totalCents: 12_345,
      feePercent: { toString: () => '5' },
      currency: 'eur',
    },
    ledgerEntries: releasedLedger(),
    client: { name: 'Chris Client', email: 'chris@example.test', locale: 'en' },
    photographer: {
      displayName: 'Ana Lens',
      city: 'Luxembourg',
      country: {
        name: 'Luxembourg',
        vatRate: { toString: () => '17' },
        timezone: 'Europe/Luxembourg',
      },
      user: { locale: 'de' },
    },
    ...overrides,
  };
}

function fakeJob(document: BookingDocument): Job<ReceiptPdfJob> {
  return { data: { bookingId: BOOKING_ID, document } } as unknown as Job<ReceiptPdfJob>;
}

function setup(
  options: { existing?: boolean; booking?: ReturnType<typeof fakeBooking> | null } = {},
) {
  const puts: PutObjectInput[] = [];
  const headObject = vi.fn(() => Promise.resolve(options.existing ? { sizeBytes: 10 } : null));
  const findUnique = vi.fn(() =>
    Promise.resolve(options.booking === undefined ? fakeBooking() : options.booking),
  );
  const record = vi.fn(() => Promise.resolve());
  const warn = vi.fn();
  const deps: ReceiptPdfDeps = {
    prisma: { client: { booking: { findUnique } } as unknown as PrismaClient },
    storage: {
      config: { privateBucket: 'private' },
      headObject,
      putObject: (input) => {
        puts.push(input);
        return Promise.resolve();
      },
    },
    auditLog: { record },
    logger: { log: vi.fn(), warn, error: vi.fn() } as unknown as Logger,
  };
  return { deps, puts, headObject, findUnique, record, warn };
}

describe('receipt-pdf processor', () => {
  it.each([
    ['receipt', 'booking.receipt_generated'],
    ['fee-invoice', 'booking.fee_invoice_generated'],
  ] as const)('renders the %s into the private bucket and audits it', async (document, action) => {
    const { deps, puts, headObject, record } = setup();

    await createReceiptPdfProcessor(deps)(fakeJob(document));

    const key = `bookings/${BOOKING_ID}/${document}.pdf`;
    expect(headObject).toHaveBeenCalledWith('private', key);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ bucket: 'private', key, contentType: 'application/pdf' });
    expect(puts[0]?.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(record).toHaveBeenCalledWith({
      actorType: 'system',
      actorId: null,
      action,
      targetType: 'Booking',
      targetId: BOOKING_ID,
      after: expect.objectContaining({
        key,
        chargedCents: 12_345,
        feeCents: FEE,
        payoutCents: 12_345 - FEE,
      }) as unknown,
    });
  });

  it('never overwrites a document that already exists', async () => {
    const { deps, puts, findUnique, record } = setup({ existing: true });

    await createReceiptPdfProcessor(deps)(fakeJob('receipt'));

    expect(findUnique).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('skips a booking that has not been released', async () => {
    const { deps, puts, warn } = setup({ booking: fakeBooking({ releasedAt: null }) });

    await createReceiptPdfProcessor(deps)(fakeJob('fee-invoice'));

    expect(puts).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      { bookingId: BOOKING_ID, document: 'fee-invoice' },
      'receipt-pdf: booking not released, skipping',
    );
  });

  it('skips a booking that no longer exists', async () => {
    const { deps, puts } = setup({ booking: null });

    await createReceiptPdfProcessor(deps)(fakeJob('receipt'));

    expect(puts).toHaveLength(0);
  });

  it('throws, so BullMQ retries, while a post-release refund is half written', async () => {
    const { deps, puts, record } = setup({
      booking: fakeBooking({
        ledgerEntries: [
          ...releasedLedger(),
          { type: 'reversal', amountCents: 1_000, currency: 'eur' },
        ],
      }),
    });

    await expect(createReceiptPdfProcessor(deps)(fakeJob('fee-invoice'))).rejects.toThrow();
    expect(puts).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a malformed job before touching storage', async () => {
    const { deps, headObject } = setup();
    const job = {
      data: { bookingId: BOOKING_ID, document: 'invoice' },
    } as unknown as Job<ReceiptPdfJob>;

    await expect(createReceiptPdfProcessor(deps)(job)).rejects.toThrow();
    expect(headObject).not.toHaveBeenCalled();
  });
});
