import { describe, expect, it } from 'vitest';
import { createApiClient } from './index.js';

const stubFetch: typeof globalThis.fetch = () =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));

describe('createApiClient', () => {
  it('builds a client bound to the given base URL', () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010' });
    expect(client).toBeDefined();
  });

  it('accepts a typed sign-up call and rejects a malformed body at compile time', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response: validResponse } = await client.POST('/v1/auth/sign-up', {
      body: {
        email: 'client@example.com',
        password: 'correct horse battery staple',
        roles: ['client'],
        locale: 'en',
      },
    });

    await client.POST('/v1/auth/sign-up', {
      body: {
        email: 'client@example.com',
        password: 'correct horse battery staple',
        // @ts-expect-error roles must be an array of signup-eligible role strings, not numbers
        roles: [1],
        locale: 'en',
      },
    });

    expect(validResponse.ok).toBe(true);
  });

  it('accepts a typed photographer search call and rejects a malformed limit', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.GET('/v1/photographers', {
      params: { query: { city: 'Luxembourg', limit: 20 } },
    });

    await client.GET('/v1/photographers', {
      // @ts-expect-error limit must be a number, not a string
      params: { query: { limit: 'twenty' } },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed product create call and rejects a fee field', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });
    const tiers = [
      {
        usage: 'personal' as const,
        price: { amountCents: 150000, currency: 'EUR' },
        description: 'Personal use',
        licenceTextVersion: 'v1',
      },
    ];

    const { response } = await client.POST('/v1/me/products', {
      body: {
        title: { en: 'Wedding package' },
        description: { en: 'Full day coverage' },
        category: 'wedding',
        durationMinutes: 480,
        deliverables: { photos: 200, editedPhotos: 80, turnaroundDays: 14, onlineGallery: true },
        basePrice: { amountCents: 150000, currency: 'EUR' },
        tiers,
      },
    });

    await client.POST('/v1/me/products', {
      body: {
        title: { en: 'Wedding package' },
        description: { en: 'Full day coverage' },
        category: 'wedding',
        durationMinutes: 480,
        deliverables: { photos: 200, editedPhotos: 80, turnaroundDays: 14, onlineGallery: true },
        basePrice: { amountCents: 150000, currency: 'EUR' },
        tiers,
        // @ts-expect-error request bodies never accept a platform fee
        platformFeeCents: 0,
      },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed request create call and rejects a malformed budget', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });
    const requestBody = {
      title: 'Wedding photographer needed',
      category: 'wedding' as const,
      description: 'Looking for a wedding photographer',
      eventDate: '2027-06-01T10:00:00.000Z',
      dateFlexible: false,
      location: { lat: 49.6116, lng: 6.1319 },
      address: {
        line1: '10 rue de la Gare',
        city: 'Luxembourg',
        postalCode: 'L-1611',
        countryCode: 'LU',
      },
      budgetMin: { amountCents: 100000, currency: 'EUR' },
      budgetMax: { amountCents: 200000, currency: 'EUR' },
      usage: 'personal' as const,
    };

    const { response } = await client.POST('/v1/requests', { body: requestBody });

    await client.POST('/v1/requests', {
      body: {
        ...requestBody,
        // @ts-expect-error budgetMin must be a Money object, not a bare number
        budgetMin: 100000,
      },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed quote create call and rejects a malformed line item', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });
    const quoteBody = {
      requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      lineItems: [{ label: 'Session', qty: 1, unitCents: 15000 }],
      validUntil: '2027-06-01T10:00:00.000Z',
    };

    const { response } = await client.POST('/v1/quotes', { body: quoteBody });

    await client.POST('/v1/quotes', {
      body: {
        ...quoteBody,
        // @ts-expect-error qty must be a number, not a string
        lineItems: [{ label: 'Session', qty: 'one', unitCents: 15000 }],
      },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed booking list call and rejects a malformed limit', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.GET('/v1/bookings', { params: { query: { limit: 20 } } });

    await client.GET('/v1/bookings', {
      // @ts-expect-error limit must be a number, not a string
      params: { query: { limit: 'twenty' } },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed upload create call and rejects a malformed sizeBytes', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.POST('/v1/uploads', {
      body: { purpose: 'portfolio', mimeType: 'image/jpeg', sizeBytes: 1024 },
    });

    await client.POST('/v1/uploads', {
      body: {
        purpose: 'portfolio',
        mimeType: 'image/jpeg',
        // @ts-expect-error sizeBytes must be a number, not a string
        sizeBytes: 'huge',
      },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed conversation list call', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.GET('/v1/conversations', {
      params: { query: { limit: 20 } },
    });

    await client.GET('/v1/conversations', {
      // @ts-expect-error limit must be a number, not a string
      params: { query: { limit: 'twenty' } },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed send message call and rejects a malformed attachmentIds', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.POST('/v1/conversations/{id}/messages', {
      params: { path: { id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' } },
      body: { body: 'Hello there' },
    });

    await client.POST('/v1/conversations/{id}/messages', {
      params: { path: { id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' } },
      // @ts-expect-error attachmentIds must be an array of strings, not numbers
      body: { attachmentIds: [1, 2] },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed admin user search call', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.GET('/v1/admin/users', {
      params: { query: { limit: 20 } },
    });

    await client.GET('/v1/admin/users', {
      // @ts-expect-error role must be one of the known user roles
      params: { query: { role: 'moderator' } },
    });

    expect(response.ok).toBe(true);
  });

  it('accepts a typed data request create call and rejects an unknown type', async () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010', fetch: stubFetch });

    const { response } = await client.POST('/v1/me/data-requests', {
      body: { type: 'export' },
    });

    await client.POST('/v1/me/data-requests', {
      // @ts-expect-error type must be "export" or "delete"
      body: { type: 'anonymize' },
    });

    expect(response.ok).toBe(true);
  });
});
