import type { NotificationPayload } from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import { renderNotifyPush } from './notify-push.js';

const PAYLOAD: NotificationPayload = {
  quoteId: 'quote-1',
  total: { amountCents: 150000, currency: 'EUR' },
  counterpartName: 'Jane Doe',
  requestTitle: 'Wedding at the castle',
};

describe('renderNotifyPush', () => {
  it('renders a short title/body with no amount or message text, plus a deep link path (not an absolute url)', () => {
    const push = renderNotifyPush('quote_received', PAYLOAD, 'en');
    expect(push.title).toBe('New quote');
    expect(push.body).toBe('Jane Doe sent you a quote');
    expect(push.body).not.toMatch(/150000|1500|EUR|€/);
    expect(push.body).not.toContain('Wedding at the castle');
    expect(push.url).toBe('/en/quotes/quote-1');
  });

  it('falls back to a generic counterpart name for a client-facing type when absent', () => {
    const push = renderNotifyPush('quote_expired', { quoteId: 'quote-1' }, 'en');
    expect(push.body).toContain('Someone');
  });

  it('falls back to "A client" for a photographer-facing type when counterpartName is absent (S6)', () => {
    const push = renderNotifyPush('quote_accepted', { quoteId: 'quote-1' }, 'en');
    expect(push.body).toContain('A client');
  });

  it('renders every quote notification type without throwing', () => {
    const types = [
      'quote_received',
      'quote_accepted',
      'quote_declined',
      'quote_withdrawn',
      'quote_expired',
    ] as const;
    for (const type of types) {
      expect(() => renderNotifyPush(type, PAYLOAD, 'en')).not.toThrow();
    }
  });

  it('throws when the payload has no quoteId', () => {
    expect(() =>
      renderNotifyPush('quote_received', { ...PAYLOAD, quoteId: undefined }, 'en'),
    ).toThrow(/quoteId/);
  });

  it('renders message_received with a conversation deep link and no body text', () => {
    const push = renderNotifyPush(
      'message_received',
      { conversationId: 'conversation-1', counterpartName: 'Jane Doe' },
      'en',
    );
    expect(push.title).toBe('New message');
    expect(push.body).toBe('Jane Doe sent you a message');
    expect(push.url).toBe('/en/messages/conversation-1');
  });

  it('falls back to "A client" for message_received when counterpartName is absent (S6)', () => {
    const push = renderNotifyPush('message_received', { conversationId: 'conversation-1' }, 'en');
    expect(push.body).toContain('A client');
  });

  it('throws when a message_received payload has no conversationId', () => {
    expect(() => renderNotifyPush('message_received', {}, 'en')).toThrow(/conversationId/);
  });
});
