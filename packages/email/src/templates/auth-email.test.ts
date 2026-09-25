import { describe, expect, it } from 'vitest';
import { renderAuthEmail } from './auth-email.js';

describe('renderAuthEmail', () => {
  it('renders a verify-email job with the raw url in text and an anchor in html', () => {
    const message = renderAuthEmail(
      {
        type: 'verify-email',
        to: 'jane@example.com',
        url: 'https://photoo.lu/en/verify-email#token=abc',
      },
      'jane@example.com',
    );
    expect(message.to).toBe('jane@example.com');
    expect(message.subject).toMatch(/Verify your/);
    expect(message.text).toContain('https://photoo.lu/en/verify-email#token=abc');
    expect(message.html).toContain(
      '<a href="https://photoo.lu/en/verify-email#token=abc">https://photoo.lu/en/verify-email#token=abc</a>',
    );
  });

  it('renders a reset-password job', () => {
    const message = renderAuthEmail(
      {
        type: 'reset-password',
        to: 'jane@example.com',
        url: 'https://photoo.lu/en/reset-password#token=abc',
      },
      'jane@example.com',
    );
    expect(message.subject).toMatch(/Reset your/);
    expect(message.text).toContain('https://photoo.lu/en/reset-password#token=abc');
  });

  it('renders an account-exists job with no url', () => {
    const message = renderAuthEmail(
      { type: 'account-exists', to: 'jane@example.com' },
      'jane@example.com',
    );
    expect(message.subject).toMatch(/tried to sign up/);
    expect(message.text).toMatch(/sign in instead/);
  });

  it('renders an account-deletion-requested job with the cancel link', () => {
    const message = renderAuthEmail(
      {
        type: 'account-deletion-requested',
        to: 'jane@example.com',
        url: 'https://photoo.lu/account/deletion/cancel/req-1#token=abc',
      },
      'jane@example.com',
    );
    expect(message.subject).toMatch(/account deletion request/);
    expect(message.text).toContain('https://photoo.lu/account/deletion/cancel/req-1#token=abc');
    expect(message.html).toContain(
      '<a href="https://photoo.lu/account/deletion/cancel/req-1#token=abc">',
    );
  });

  it('renders a data-export-ready job with the expiry date and download link', () => {
    const message = renderAuthEmail(
      {
        type: 'data-export-ready',
        to: 'jane@example.com',
        url: 'https://photoo.lu/account',
        expiresAt: '2026-01-08T00:00:00.000Z',
      },
      'jane@example.com',
    );
    expect(message.subject).toMatch(/data export is ready/);
    expect(message.text).toContain('https://photoo.lu/account');
    expect(message.text).toContain('2026-01-08T00:00:00.000Z');
    expect(message.html).toContain('<a href="https://photoo.lu/account">');
    expect(message.html).toContain('2026-01-08T00:00:00.000Z');
  });

  it('renders a data-export-failed job with the retry link', () => {
    const message = renderAuthEmail(
      {
        type: 'data-export-failed',
        to: 'jane@example.com',
        url: 'https://photoo.lu/account',
      },
      'jane@example.com',
    );
    expect(message.subject).toMatch(/data export failed/);
    expect(message.text).toContain('https://photoo.lu/account');
    expect(message.html).toContain('<a href="https://photoo.lu/account">');
  });

  it('HTML-escapes a url containing an ampersand', () => {
    const message = renderAuthEmail(
      {
        type: 'verify-email',
        to: 'jane@example.com',
        url: 'https://photoo.lu/en/verify-email?a=1&b=2',
      },
      'jane@example.com',
    );
    expect(message.html).toContain('a=1&amp;b=2');
    expect(message.html).not.toContain('a=1&b=2');
  });
});
