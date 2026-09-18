import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './scrub-event.js';

describe('scrubEvent', () => {
  it('drops the request body entirely', () => {
    const event: ErrorEvent = { type: undefined, request: { data: { password: 'hunter2' } } };
    expect(scrubEvent(event).request?.data).toBeUndefined();
  });

  it('redacts authorization, cookie and set-cookie headers', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        headers: { Authorization: 'Bearer secret-token', 'Set-Cookie': 'session=abc' },
      },
    };
    const scrubbed = scrubEvent(event).request?.headers as Record<string, string>;
    expect(scrubbed.Authorization).toBe('[Redacted]');
    expect(scrubbed['Set-Cookie']).toBe('[Redacted]');
  });

  it('redacts token/password/secret-shaped keys in extra', () => {
    const event: ErrorEvent = { type: undefined, extra: { apiToken: 'abc', jobId: 'kept' } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.extra?.apiToken).toBe('[Redacted]');
    expect(scrubbed.extra?.jobId).toBe('kept');
  });

  it('leaves an event with no request, extra, contexts or breadcrumbs untouched', () => {
    const event: ErrorEvent = { type: undefined, message: 'plain event' };
    expect(scrubEvent(event)).toEqual({ type: undefined, message: 'plain event' });
  });
});
