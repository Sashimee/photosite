import { formatText } from '@photoo/email';
import { getMessages } from '@photoo/i18n';
import type { BookingDocument } from '@photoo/shared';
import type { BookingAmounts } from './booking-amounts.js';

export interface DocumentParty {
  heading: string;
  lines: string[];
}

export interface DocumentRow {
  label: string;
  value: string;
  emphasis: boolean;
}

export interface DocumentContent {
  title: string;
  meta: string[];
  parties: DocumentParty[];
  rowsHeading: string | null;
  rows: DocumentRow[];
  notice: string;
  footer: string;
  pageLabel: (page: number, pages: number) => string;
}

export interface DocumentLineItem {
  label: string;
  qty: number;
  unitCents: number;
}

export interface DocumentInput {
  document: BookingDocument;
  locale: string;
  timeZone: string;
  bookingId: string;
  issuedAt: Date;
  amounts: BookingAmounts;
  feePercent: number;
  lineItems: readonly DocumentLineItem[];
  photographer: { displayName: string; city: string; countryName: string };
  client: { name: string | null; email: string };
}

// pdfkit's built-in Helvetica only covers WinAnsi; Intl emits U+202F (narrow
// no-break space) as the fr/de group and percent separator, which WinAnsi
// lacks, so it is swapped for the plain no-break space it does have.
function toWinAnsiSpacing(text: string): string {
  return text.replaceAll('\u202f', '\u00a0');
}

function moneyFormatter(locale: string, currency: string): (cents: number) => string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  return (cents) => toWinAnsiSpacing(format.format(cents / 100));
}

function percentFormatter(locale: string): (percent: number) => string {
  const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  return (percent) => toWinAnsiSpacing(format.format(percent / 100));
}

function row(label: string, value: string, emphasis = false): DocumentRow {
  return { label, value, emphasis };
}

export function buildDocumentContent(input: DocumentInput): DocumentContent {
  const messages = getMessages(input.locale);
  const t = messages.documents;
  const appName = messages.common.appName;
  const money = moneyFormatter(input.locale, input.amounts.currency);
  const percent = percentFormatter(input.locale);
  const { amounts } = input;
  const issuedOn = new Intl.DateTimeFormat(input.locale, {
    dateStyle: 'long',
    timeZone: input.timeZone,
  }).format(input.issuedAt);

  const meta = [
    formatText(t.common.reference, { reference: input.bookingId }),
    formatText(t.common.issuedOn, { date: issuedOn }),
  ];
  const photographerLines = [
    input.photographer.displayName,
    `${input.photographer.city}, ${input.photographer.countryName}`,
  ];
  const clientLines = input.client.name
    ? [input.client.name, input.client.email]
    : [input.client.email];
  const pageLabel = (page: number, pages: number): string =>
    formatText(t.common.page, { page: String(page), pages: String(pages) });

  if (input.document === 'receipt') {
    const rows = input.lineItems.map((item) =>
      row(
        formatText(t.receipt.lineItem, { qty: String(item.qty), label: item.label }),
        money(item.qty * item.unitCents),
      ),
    );
    rows.push(row(t.receipt.totalPaid, money(amounts.chargedCents), true));
    if (amounts.refundedCents > 0) {
      rows.push(row(t.receipt.refunded, money(-amounts.refundedCents)));
      rows.push(row(t.receipt.netPaid, money(amounts.netPaidCents), true));
    }
    return {
      title: t.receipt.title,
      meta,
      parties: [
        { heading: t.receipt.sellerHeading, lines: photographerLines },
        { heading: t.receipt.buyerHeading, lines: clientLines },
      ],
      rowsHeading: t.receipt.itemsHeading,
      rows,
      notice: formatText(t.receipt.sellerNotice, { appName }),
      footer: t.common.contact,
      pageLabel,
    };
  }

  const rows = [row(t.feeInvoice.bookingAmount, money(amounts.chargedCents))];
  if (amounts.refundedCents > 0) {
    rows.push(row(t.feeInvoice.refundedToClient, money(-amounts.refundedCents)));
  }
  rows.push(
    row(
      formatText(t.feeInvoice.platformFee, { percent: percent(input.feePercent) }),
      money(amounts.baseFeeCents),
    ),
  );
  if (amounts.vatOnFeeCents > 0 && amounts.vatOnFeeRatePercent !== null) {
    rows.push(
      row(
        formatText(t.feeInvoice.vatOnFee, { rate: percent(amounts.vatOnFeeRatePercent) }),
        money(amounts.vatOnFeeCents),
      ),
    );
  }
  rows.push(row(t.feeInvoice.totalFee, money(amounts.feeCents), true));
  if (amounts.reversedCents > 0) {
    rows.push(row(t.feeInvoice.transferred, money(amounts.transferredCents)));
    rows.push(row(t.feeInvoice.reversed, money(-amounts.reversedCents)));
  }
  rows.push(row(t.feeInvoice.payout, money(amounts.payoutCents), true));
  return {
    title: t.feeInvoice.title,
    meta,
    parties: [
      { heading: t.feeInvoice.issuerHeading, lines: [appName, t.common.contact] },
      { heading: t.feeInvoice.recipientHeading, lines: photographerLines },
    ],
    rowsHeading: null,
    rows,
    notice: t.feeInvoice.payoutNotice,
    footer: t.common.contact,
    pageLabel,
  };
}
