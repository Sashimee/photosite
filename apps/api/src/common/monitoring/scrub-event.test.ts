import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './scrub-event.js';

describe('scrubEvent', () => {
  it('drops the request body entirely', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: { data: { email: 'user@example.com', password: 'hunter2' } },
    };
    expect(scrubEvent(event).request?.data).toBeUndefined();
  });

  it('redacts authorization, cookie and set-cookie headers', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        headers: {
          Authorization: 'Bearer secret-token',
          Cookie: 'session=abc',
          'Set-Cookie': 'session=abc; HttpOnly',
          'x-request-id': 'req-1',
        },
      },
    };
    const scrubbed = scrubEvent(event).request?.headers as Record<string, string>;
    expect(scrubbed.Authorization).toBe('[Redacted]');
    expect(scrubbed.Cookie).toBe('[Redacted]');
    expect(scrubbed['Set-Cookie']).toBe('[Redacted]');
    expect(scrubbed['x-request-id']).toBe('req-1');
  });

  it('redacts token/password/secret-shaped keys in extra and contexts', () => {
    const event: ErrorEvent = {
      type: undefined,
      extra: { apiToken: 'abc', userId: 'kept' },
      contexts: { auth: { clientSecret: 'xyz', flow: 'kept' } },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.extra?.apiToken).toBe('[Redacted]');
    expect(scrubbed.extra?.userId).toBe('kept');
    expect((scrubbed.contexts?.auth as Record<string, unknown>).clientSecret).toBe('[Redacted]');
    expect((scrubbed.contexts?.auth as Record<string, unknown>).flow).toBe('kept');
  });

  it('redacts sensitive keys inside breadcrumb data', () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [{ message: 'auth', data: { password: 'hunter2', step: 'login' } }],
    };
    const scrubbed = scrubEvent(event).breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(scrubbed.password).toBe('[Redacted]');
    expect(scrubbed.step).toBe('login');
  });

  it('leaves an event with no request, extra, contexts or breadcrumbs untouched', () => {
    const event: ErrorEvent = { type: undefined, message: 'plain event' };
    expect(scrubEvent(event)).toEqual({ type: undefined, message: 'plain event' });
  });
});
