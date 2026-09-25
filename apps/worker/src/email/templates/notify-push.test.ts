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
      'verification_approved',
      'verification_rejected',
    ] as const;
    for (const type of types) {
      expect(() => renderNotifyPush(type, PAYLOAD, 'en')).not.toThrow();
    }
  });

  it('renders every job application notification type without throwing', () => {
    const types = ['job_application_received', 'job_application_status_changed'] as const;
    for (const type of types) {
      expect(() => renderNotifyPush(type, { jobOfferId: 'job-offer-1' }, 'en')).not.toThrow();
    }
  });

  it('renders verification_rejected without leaking the reason into the push body', () => {
    const push = renderNotifyPush(
      'verification_rejected',
      { reason: 'Business registration document is illegible' },
      'en',
    );
    expect(push.title).toBe('Verification rejected');
    expect(push.body).not.toContain('illegible');
    expect(push.url).toBe('/en/account/verification');
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

  it('renders job_application_received with the job offer title', () => {
    const push = renderNotifyPush(
      'job_application_received',
      { jobOfferId: 'job-offer-1', jobOfferTitle: 'Wedding photographer needed' },
      'en',
    );
    expect(push.title).toBe('New application');
    expect(push.body).toContain('Wedding photographer needed');
    expect(push.url).toBe('/en/account/job-offers/job-offer-1/applications');
  });

  it('falls back to a generic job offer label for job_application_status_changed when absent', () => {
    const push = renderNotifyPush(
      'job_application_status_changed',
      { jobOfferId: 'job-offer-1' },
      'en',
    );
    expect(push.body).toContain('the job offer');
    expect(push.url).toBe('/en/account/job-applications');
  });

  it('throws when a job application notification has no jobOfferId', () => {
    expect(() => renderNotifyPush('job_application_received', {}, 'en')).toThrow(/jobOfferId/);
  });

  it('renders report_decision and moderation_action with a notifications deep link and no reason text', () => {
    const reportPush = renderNotifyPush(
      'report_decision',
      { reason: 'Confirmed AI-generated, image removed', moderationOutcome: 'takedown' },
      'en',
    );
    expect(reportPush.title).toContain('removed');
    expect(reportPush.body).not.toContain('AI-generated');
    expect(reportPush.url).toBe('/en/account/notifications');

    const ownerPush = renderNotifyPush(
      'moderation_action',
      { reason: 'Confirmed AI-generated, image removed', moderationOutcome: 'takedown' },
      'en',
    );
    expect(ownerPush.title).toBe('Your content was removed');
    expect(ownerPush.url).toBe('/en/account/notifications');
  });

  it('renders every moderation outcome without throwing', () => {
    const outcomes = ['resolved', 'dismissed', 'takedown', 'restored'] as const;
    for (const type of ['report_decision', 'moderation_action'] as const) {
      for (const moderationOutcome of outcomes) {
        expect(() =>
          renderNotifyPush(type, { reason: 'Reviewed', moderationOutcome }, 'en'),
        ).not.toThrow();
      }
    }
  });

  it('throws when a moderation notice payload has no moderationOutcome', () => {
    expect(() => renderNotifyPush('report_decision', { reason: 'Reviewed' }, 'en')).toThrow(
      /moderationOutcome/,
    );
  });
});
