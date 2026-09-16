import { describe, expect, it } from 'vitest';
import { createApiClient } from './index.js';

describe('createApiClient', () => {
  it('builds a client bound to the given base URL', () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010' });
    expect(client).toBeDefined();
  });

  it('accepts a typed sign-up call and rejects a malformed body at compile time', () => {
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:4010' });
    expect(client).toBeDefined();

    const validCall: Parameters<typeof client.POST> = [
      '/v1/auth/sign-up',
      {
        body: {
          email: 'client@example.com',
          password: 'correct horse battery staple',
          roles: ['client'],
          locale: 'en',
        },
      },
    ];

    const invalidCall: Parameters<typeof client.POST> = [
      '/v1/auth/sign-up',
      {
        body: {
          email: 'client@example.com',
          password: 'correct horse battery staple',
          // @ts-expect-error roles must be an array of signup-eligible role strings, not numbers
          roles: [1],
          locale: 'en',
        },
      },
    ];

    expect(validCall[0]).toBe('/v1/auth/sign-up');
    expect(invalidCall[0]).toBe('/v1/auth/sign-up');
  });
});
