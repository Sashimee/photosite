import { describe, expect, it } from 'vitest';
import type { BookingAmounts } from './booking-amounts.js';
import { buildDocumentContent, type DocumentInput } from './document-content.js';

const baseAmounts: BookingAmounts = {
  currency: 'EUR',
  chargedCents: 12_345,
  refundedCents: 0,
  netPaidCents: 12_345,
  baseFeeCents: 617,
  vatOnFeeCents: 0,
  vatOnFeeRatePercent: null,
  feeCents: 617,
  transferredCents: 11_728,
  reversedCents: 0,
  payoutCents: 11_728,
};

function input(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    document: 'receipt',
    locale: 'en',
    timeZone: 'Europe/Luxembourg',
    bookingId: 'booking-1',
    issuedAt: new Date('2026-09-27T23:30:00Z'),
    amounts: baseAmounts,
    feePercent: 5,
    lineItems: [
      { label: 'Portrait session', qty: 1, unitCents: 10_000 },
      { label: 'Extra edited photo', qty: 3, unitCents: 781 },
      { label: 'Travel', qty: 1, unitCents: 2 },
    ],
    photographer: { displayName: 'Ana Lens', city: 'Esch-sur-Alzette', countryName: 'Luxembourg' },
    client: { name: 'Chris Client', email: 'chris@example.test' },
    ...overrides,
  };
}

function rowValue(content: ReturnType<typeof buildDocumentContent>, label: string): string {
  const match = content.rows.find((entry) => entry.label === label);
  if (!match) {
    throw new Error(`row "${label}" missing; rows: ${content.rows.map((r) => r.label).join(', ')}`);
  }
  return match.value;
}

describe('buildDocumentContent: receipt', () => {
  it('lists line items and the total paid, dated in the photographer time zone', () => {
    const content = buildDocumentContent(input());

    expect(content.title).toBe('Booking receipt');
    expect(content.meta).toEqual(['Booking reference: booking-1', 'Date: September 28, 2026']);
    expect(content.rows.map((entry) => [entry.label, entry.value])).toEqual([
      ['1 × Portrait session', '€100.00'],
      ['3 × Extra edited photo', '€23.43'],
      ['1 × Travel', '€0.02'],
      ['Total paid', '€123.45'],
    ]);
    expect(content.rows.at(-1)?.emphasis).toBe(true);
    expect(content.parties).toEqual([
      { heading: 'Photographer (seller)', lines: ['Ana Lens', 'Esch-sur-Alzette, Luxembourg'] },
      { heading: 'Client', lines: ['Chris Client', 'chris@example.test'] },
    ]);
  });

  it('states that the photographer, not the platform, is the seller', () => {
    const content = buildDocumentContent(input());

    expect(content.notice).toContain('Photoo is not the seller');
    expect(content.notice).toContain('responsible for issuing any invoice');
  });

  it('shows refunds and the net amount only when something was refunded', () => {
    const content = buildDocumentContent(
      input({ amounts: { ...baseAmounts, refundedCents: 2_000, netPaidCents: 10_345 } }),
    );

    expect(rowValue(content, 'Refunded to you')).toBe('-€20.00');
    expect(rowValue(content, 'Net amount paid')).toBe('€103.45');
    expect(buildDocumentContent(input()).rows.map((entry) => entry.label)).not.toContain(
      'Refunded to you',
    );
  });

  it('falls back to the email when the client has no name', () => {
    const content = buildDocumentContent(
      input({ client: { name: null, email: 'c@example.test' } }),
    );

    expect(content.parties[1]?.lines).toEqual(['c@example.test']);
  });
});

describe('buildDocumentContent: fee invoice', () => {
  it('shows the ledger fee and a payout equal to the ledger payout', () => {
    const content = buildDocumentContent(input({ document: 'fee-invoice' }));

    expect(content.title).toBe('Platform fee invoice');
    expect(content.rows.map((entry) => [entry.label, entry.value])).toEqual([
      ['Booking amount paid by the client', '€123.45'],
      ['Platform fee (5%)', '€6.17'],
      ['Total platform fee', '€6.17'],
      ['Your payout', '€117.28'],
    ]);
    expect(content.parties[1]).toEqual({
      heading: 'Issued to',
      lines: ['Ana Lens', 'Esch-sur-Alzette, Luxembourg'],
    });
  });

  it('adds a VAT-on-fee row with the country rate when the ledger fee carries VAT', () => {
    const content = buildDocumentContent(
      input({
        document: 'fee-invoice',
        amounts: {
          ...baseAmounts,
          chargedCents: 2_000,
          netPaidCents: 2_000,
          baseFeeCents: 100,
          vatOnFeeCents: 17,
          vatOnFeeRatePercent: 17,
          feeCents: 117,
          transferredCents: 1_883,
          payoutCents: 1_883,
        },
      }),
    );

    expect(rowValue(content, 'Platform fee (5%)')).toBe('€1.00');
    expect(rowValue(content, 'VAT on the platform fee (17%)')).toBe('€0.17');
    expect(rowValue(content, 'Total platform fee')).toBe('€1.17');
    expect(rowValue(content, 'Your payout')).toBe('€18.83');
  });

  it('shows a post-release reversal against the transfer', () => {
    const content = buildDocumentContent(
      input({
        document: 'fee-invoice',
        amounts: {
          ...baseAmounts,
          refundedCents: 1_000,
          netPaidCents: 11_345,
          reversedCents: 1_000,
          payoutCents: 10_728,
        },
      }),
    );

    expect(rowValue(content, 'Refunded to the client')).toBe('-€10.00');
    expect(rowValue(content, 'Transferred to you')).toBe('€117.28');
    expect(rowValue(content, 'Reversed from your transfer')).toBe('-€10.00');
    expect(rowValue(content, 'Your payout')).toBe('€107.28');
  });

  it('renders in the recipient locale with WinAnsi-safe spacing', () => {
    const content = buildDocumentContent(
      input({ document: 'fee-invoice', locale: 'fr', feePercent: 5.5 }),
    );
    const allText = [
      content.title,
      ...content.meta,
      ...content.rows.flatMap((r) => [r.label, r.value]),
    ];

    expect(content.title).not.toBe('Platform fee invoice');
    expect(content.rows.at(-1)?.value).toBe('117,28\u00a0€');
    expect(content.rows[1]?.label).toContain('5,5\u00a0%');
    expect(allText.join('')).not.toContain('\u202f');
  });
});
