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
  it('renders a short title/body with no amount or message text, plus a deep link url', () => {
    const push = renderNotifyPush('quote_received', PAYLOAD, 'en', 'https://photoo.lu');
    expect(push.title).toBe('New quote');
    expect(push.body).toBe('Jane Doe sent you a quote');
    expect(push.body).not.toMatch(/150000|1500|EUR|€/);
    expect(push.body).not.toContain('Wedding at the castle');
    expect(push.url).toBe('https://photoo.lu/en/quotes/quote-1');
  });

  it('falls back to a generic counterpart name when absent', () => {
    const push = renderNotifyPush(
      'quote_expired',
      { quoteId: 'quote-1' },
      'en',
      'https://photoo.lu',
    );
    expect(push.body).toContain('Someone');
  });

  it('renders every notification type without throwing', () => {
    const types = [
      'quote_received',
      'quote_accepted',
      'quote_declined',
      'quote_withdrawn',
      'quote_expired',
    ] as const;
    for (const type of types) {
      expect(() => renderNotifyPush(type, PAYLOAD, 'en', 'https://photoo.lu')).not.toThrow();
    }
  });

  it('throws when the payload has no quoteId', () => {
    expect(() =>
      renderNotifyPush(
        'quote_received',
        { ...PAYLOAD, quoteId: undefined },
        'en',
        'https://photoo.lu',
      ),
    ).toThrow(/quoteId/);
  });
});
