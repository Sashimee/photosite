import { describe, expect, it } from 'vitest';
import { CreateQuoteRequestSchema, LineItemSchema, QuoteSchema } from './quotes.js';

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const validLineItem = { label: 'Session', qty: 1, unitCents: 15000 };

const validQuote = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  productId: null,
  productTierId: null,
  lineItems: [validLineItem],
  subtotal: { amountCents: 15000, currency: 'EUR' },
  platformFee: { amountCents: 750, currency: 'EUR' },
  total: { amountCents: 15000, currency: 'EUR' },
  validUntil: futureDate,
  message: 'Looking forward to shooting your wedding',
  status: 'sent',
};

describe('LineItemSchema', () => {
  it('accepts a well-formed line item', () => {
    expect(LineItemSchema.safeParse(validLineItem).success).toBe(true);
  });

  it('rejects a zero quantity', () => {
    expect(LineItemSchema.safeParse({ ...validLineItem, qty: 0 }).success).toBe(false);
  });

  it('rejects a negative unitCents', () => {
    expect(LineItemSchema.safeParse({ ...validLineItem, unitCents: -1 }).success).toBe(false);
  });
});

describe('QuoteSchema', () => {
  it('accepts a well-formed quote', () => {
    expect(QuoteSchema.safeParse(validQuote).success).toBe(true);
  });

  it('rejects a request body carrying totals', () => {
    expect(QuoteSchema.safeParse({ ...validQuote, feePercent: 5 }).success).toBe(false);
  });
});

describe('CreateQuoteRequestSchema', () => {
  const forRequest = {
    requestId: validQuote.requestId,
    lineItems: [validLineItem],
    validUntil: futureDate,
  };

  const forProduct = {
    productId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    productTierId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    lineItems: [validLineItem],
    validUntil: futureDate,
  };

  it('accepts a quote for a request', () => {
    expect(CreateQuoteRequestSchema.safeParse(forRequest).success).toBe(true);
  });

  it('accepts a quote for a direct product and tier', () => {
    expect(CreateQuoteRequestSchema.safeParse(forProduct).success).toBe(true);
  });

  it('rejects a quote with neither a request nor a product', () => {
    expect(
      CreateQuoteRequestSchema.safeParse({ lineItems: [validLineItem], validUntil: futureDate })
        .success,
    ).toBe(false);
  });

  it('rejects a quote with both a request and a product', () => {
    expect(CreateQuoteRequestSchema.safeParse({ ...forRequest, ...forProduct }).success).toBe(
      false,
    );
  });

  it('rejects a productId without a productTierId', () => {
    expect(
      CreateQuoteRequestSchema.safeParse({
        productId: forProduct.productId,
        lineItems: [validLineItem],
        validUntil: futureDate,
      }).success,
    ).toBe(false);
  });

  it('rejects a request body carrying a computed subtotal', () => {
    expect(
      CreateQuoteRequestSchema.safeParse({
        ...forRequest,
        subtotalCents: 15000,
      }).success,
    ).toBe(false);
  });

  it('rejects a validUntil in the past', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    expect(
      CreateQuoteRequestSchema.safeParse({ ...forRequest, validUntil: pastDate }).success,
    ).toBe(false);
  });

  it('rejects an empty lineItems array', () => {
    expect(CreateQuoteRequestSchema.safeParse({ ...forRequest, lineItems: [] }).success).toBe(
      false,
    );
  });
});
