import type { NotificationPayload } from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import { buildNotificationPath, renderNotifyEmail } from './notify-email.js';

const PAYLOAD: NotificationPayload = {
  quoteId: 'quote-1',
  requestId: 'request-1',
  requestTitle: 'Wedding at the castle',
  total: { amountCents: 150000, currency: 'EUR' },
  counterpartName: 'Jane Doe',
};

describe('buildNotificationPath', () => {
  it('builds a locale-prefixed quote deep link from ids only', () => {
    expect(buildNotificationPath('fr', 'quote-1')).toBe('/fr/quotes/quote-1');
  });
});

describe('renderNotifyEmail', () => {
  it('renders quote_received with the request title, total and a List-Unsubscribe header', () => {
    const message = renderNotifyEmail(
      'quote_received',
      PAYLOAD,
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.to).toBe('jane@example.com');
    expect(message.subject).toContain('Jane Doe');
    expect(message.text).toContain('Wedding at the castle');
    expect(message.text).toContain('https://photoo.lu/en/quotes/quote-1');
    expect(message.text).toContain('account/notifications');
    expect(message.headers?.['List-Unsubscribe']).toMatch(
      /^<https:\/\/photoo\.lu\/en\/account\/notifications>$/,
    );
  });

  it('HTML-escapes the counterpart name and request title', () => {
    const message = renderNotifyEmail(
      'quote_received',
      { ...PAYLOAD, counterpartName: '<b>Evil</b>', requestTitle: 'Tom & Jerry' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    expect(message.html).not.toContain('<b>Evil</b>');
    expect(message.html).toContain('Tom &amp; Jerry');
  });

  it('falls back to a generic counterpart and request label when absent', () => {
    const message = renderNotifyEmail(
      'quote_expired',
      { quoteId: 'quote-1' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.text).toContain('Someone');
    expect(message.text).toContain('your booking');
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
      expect(() =>
        renderNotifyEmail(type, PAYLOAD, 'en', 'jane@example.com', 'https://photoo.lu'),
      ).not.toThrow();
    }
  });

  it('renders in the recipient locale, falling back to en for an unsupported locale key lookup', () => {
    const message = renderNotifyEmail(
      'quote_received',
      PAYLOAD,
      'fr',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.text).toContain('https://photoo.lu/fr/quotes/quote-1');
  });

  it('throws when the payload has no quoteId', () => {
    expect(() =>
      renderNotifyEmail(
        'quote_received',
        { ...PAYLOAD, quoteId: undefined },
        'en',
        'jane@example.com',
        'https://photoo.lu',
      ),
    ).toThrow(/quoteId/);
  });
});
