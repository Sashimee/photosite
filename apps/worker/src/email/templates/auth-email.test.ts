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
    expect(message.html).toContain('https://photoo.lu/en/verify-email#token=abc');
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
