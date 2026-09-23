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

  it('falls back to "A client" for a photographer-facing type when counterpartName is absent (S6)', () => {
    const message = renderNotifyEmail(
      'quote_accepted',
      { quoteId: 'quote-1' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.text).toContain('A client');
    expect(message.text).not.toContain('Someone');
  });

  it('renders a real <a href> link for the quote url and the preferences url, with escaped attribute values', () => {
    const message = renderNotifyEmail(
      'quote_received',
      { ...PAYLOAD, requestTitle: 'Tom & Jerry' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.html).toContain('<a href="https://photoo.lu/en/quotes/quote-1">');
    expect(message.html).toContain('<a href="https://photoo.lu/en/account/notifications">');
  });

  it('renders every quote notification type without throwing', () => {
    const types = [
      'quote_received',
      'quote_accepted',
      'quote_declined',
      'quote_withdrawn',
      'quote_expired',
      'verification_approved',
      'verification_rejected',
    ] as const;
    for (const type of types) {
      expect(() =>
        renderNotifyEmail(type, PAYLOAD, 'en', 'jane@example.com', 'https://photoo.lu'),
      ).not.toThrow();
    }
  });

  it('renders every job application notification type without throwing', () => {
    const types = ['job_application_received', 'job_application_status_changed'] as const;
    for (const type of types) {
      expect(() =>
        renderNotifyEmail(
          type,
          { jobOfferId: 'job-offer-1' },
          'en',
          'jane@example.com',
          'https://photoo.lu',
        ),
      ).not.toThrow();
    }
  });

  it('renders message_received with a conversation deep link', () => {
    const message = renderNotifyEmail(
      'message_received',
      { conversationId: 'conversation-1', counterpartName: 'Jane Doe' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.subject).toContain('Jane Doe');
    expect(message.text).toContain('https://photoo.lu/en/messages/conversation-1');
  });

  it('falls back to "A client" for message_received when counterpartName is absent (S6)', () => {
    const message = renderNotifyEmail(
      'message_received',
      { conversationId: 'conversation-1' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.text).toContain('A client');
  });

  it('throws when a message_received payload has no conversationId', () => {
    expect(() =>
      renderNotifyEmail('message_received', {}, 'en', 'jane@example.com', 'https://photoo.lu'),
    ).toThrow(/conversationId/);
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

  it('renders verification_approved with an account deep link and no quoteId required', () => {
    const message = renderNotifyEmail(
      'verification_approved',
      {},
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.subject).toContain('approved');
    expect(message.text).toContain('https://photoo.lu/en/account/verification');
  });

  it('renders verification_rejected without leaking the reason into the email body', () => {
    const message = renderNotifyEmail(
      'verification_rejected',
      { reason: 'Business registration document is illegible' },
      'en',
      'jane@example.com',
      'https://photoo.lu',
    );
    expect(message.subject).toContain('rejected');
    expect(message.text).not.toContain('illegible');
    expect(message.text).toContain('https://photoo.lu/en/account/verification');
  });

  it('renders job_application_received with the job offer title and applications deep link', () => {
    const message = renderNotifyEmail(
      'job_application_received',
      {
        jobOfferId: 'job-offer-1',
        jobOfferTitle: 'Wedding photographer needed',
        counterpartName: 'Jane Doe',
      },
      'en',
      'company@example.com',
      'https://photoo.lu',
    );
    expect(message.subject).toContain('Jane Doe');
    expect(message.text).toContain('Wedding photographer needed');
    expect(message.text).toContain('https://photoo.lu/en/job-offers/job-offer-1/applications');
  });

  it('renders job_application_status_changed with a fallback job offer title when absent', () => {
    const message = renderNotifyEmail(
      'job_application_status_changed',
      { jobOfferId: 'job-offer-1' },
      'en',
      'photographer@example.com',
      'https://photoo.lu',
    );
    expect(message.text).toContain('the job offer');
    expect(message.text).toContain('https://photoo.lu/en/job-offers/job-offer-1/applications');
  });

  it('throws when a job application notification has no jobOfferId', () => {
    expect(() =>
      renderNotifyEmail(
        'job_application_received',
        {},
        'en',
        'company@example.com',
        'https://photoo.lu',
      ),
    ).toThrow(/jobOfferId/);
  });
});
