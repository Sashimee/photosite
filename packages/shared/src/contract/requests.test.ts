import { describe, expect, it } from 'vitest';
import {
  AddressSchema,
  CreateRequestRequestSchema,
  RequestFeedQuerySchema,
  RequestSchema,
  RequestSummarySchema,
} from './requests.js';

const validAddress = {
  line1: '10 rue de la Gare',
  city: 'Luxembourg',
  postalCode: 'L-1611',
  countryCode: 'LU',
};

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const validCreateRequest = {
  title: 'Wedding photographer needed',
  category: 'wedding',
  description: 'Looking for a wedding photographer for a full day',
  eventDate: futureDate,
  dateFlexible: false,
  location: { lat: 49.6116, lng: 6.1319 },
  address: validAddress,
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal',
};

describe('AddressSchema', () => {
  it('accepts a well-formed address', () => {
    expect(AddressSchema.safeParse(validAddress).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(AddressSchema.safeParse({ ...validAddress, state: 'x' }).success).toBe(false);
  });
});

describe('CreateRequestRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(CreateRequestRequestSchema.safeParse(validCreateRequest).success).toBe(true);
  });

  it('rejects a past eventDate', () => {
    expect(
      CreateRequestRequestSchema.safeParse({ ...validCreateRequest, eventDate: pastDate }).success,
    ).toBe(false);
  });

  it('rejects budgetMin greater than budgetMax', () => {
    expect(
      CreateRequestRequestSchema.safeParse({
        ...validCreateRequest,
        budgetMin: { amountCents: 300000, currency: 'EUR' },
      }).success,
    ).toBe(false);
  });

  it('rejects mismatched currencies between budgetMin and budgetMax', () => {
    expect(
      CreateRequestRequestSchema.safeParse({
        ...validCreateRequest,
        budgetMax: { amountCents: 200000, currency: 'USD' },
      }).success,
    ).toBe(false);
  });

  it('accepts equal budgetMin and budgetMax', () => {
    expect(
      CreateRequestRequestSchema.safeParse({
        ...validCreateRequest,
        budgetMax: validCreateRequest.budgetMin,
      }).success,
    ).toBe(true);
  });

  it('rejects a request carrying a status field', () => {
    expect(
      CreateRequestRequestSchema.safeParse({ ...validCreateRequest, status: 'open' }).success,
    ).toBe(false);
  });
});

describe('RequestSchema', () => {
  it('accepts a response with a past eventDate', () => {
    expect(
      RequestSchema.safeParse({
        id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        title: validCreateRequest.title,
        category: validCreateRequest.category,
        description: validCreateRequest.description,
        eventDate: pastDate,
        dateFlexible: false,
        location: validCreateRequest.location,
        address: validAddress,
        budgetMin: validCreateRequest.budgetMin,
        budgetMax: validCreateRequest.budgetMax,
        usage: validCreateRequest.usage,
        status: 'closed',
        expiresAt: null,
      }).success,
    ).toBe(true);
  });
});

describe('RequestSummarySchema', () => {
  const validSummary = {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    title: validCreateRequest.title,
    category: validCreateRequest.category,
    description: validCreateRequest.description,
    eventDate: futureDate,
    dateFlexible: false,
    city: validAddress.city,
    countryCode: validAddress.countryCode,
    location: validCreateRequest.location,
    budgetMin: validCreateRequest.budgetMin,
    budgetMax: validCreateRequest.budgetMax,
    usage: validCreateRequest.usage,
    status: 'open',
    expiresAt: null,
    hasQuoted: false,
  };

  it('accepts a well-formed summary', () => {
    expect(RequestSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it('rejects a summary carrying the address', () => {
    expect(RequestSummarySchema.safeParse({ ...validSummary, address: validAddress }).success).toBe(
      false,
    );
  });

  it('rejects a summary carrying the clientId', () => {
    expect(
      RequestSummarySchema.safeParse({
        ...validSummary,
        clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(false);
  });
});

describe('RequestFeedQuerySchema', () => {
  it('defaults radiusKm to 50', () => {
    expect(RequestFeedQuerySchema.parse({}).radiusKm).toBe(50);
  });

  it('accepts the radiusKm bounds', () => {
    expect(RequestFeedQuerySchema.safeParse({ radiusKm: 1 }).success).toBe(true);
    expect(RequestFeedQuerySchema.safeParse({ radiusKm: 200 }).success).toBe(true);
  });

  it('rejects radiusKm below 1', () => {
    expect(RequestFeedQuerySchema.safeParse({ radiusKm: 0 }).success).toBe(false);
  });

  it('rejects radiusKm above 200', () => {
    expect(RequestFeedQuerySchema.safeParse({ radiusKm: 201 }).success).toBe(false);
  });

  it('coerces a string radiusKm from the query string', () => {
    expect(RequestFeedQuerySchema.parse({ radiusKm: '75' }).radiusKm).toBe(75);
  });
});
