import { describe, expect, it } from '@jest/globals';

import { conversationHrefFromPushData } from './notification-links';

const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('conversationHrefFromPushData', () => {
  it('maps the server web path to the locale-less mobile route', () => {
    expect(conversationHrefFromPushData({ url: `/fr/messages/${ID}` })).toBe(`/messages/${ID}`);
  });

  it.each([
    ['missing data', undefined],
    ['null data', null],
    ['a non-string url', { url: 42 }],
    ['an absolute url', { url: `https://evil.example/en/messages/${ID}` }],
    ['an unsupported locale', { url: `/xx/messages/${ID}` }],
    ['another section', { url: `/en/account/verification` }],
    ['a non-uuid id', { url: '/en/messages/../../admin' }],
    ['a trailing path', { url: `/en/messages/${ID}/extra` }],
    ['a query string', { url: `/en/messages/${ID}?next=/x` }],
  ])('rejects %s', (_label, data) => {
    expect(conversationHrefFromPushData(data)).toBeNull();
  });
});
