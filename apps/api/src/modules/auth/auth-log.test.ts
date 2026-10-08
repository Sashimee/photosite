import { describe, expect, it } from 'vitest';
import { scrubAuthLogMessage } from './auth-log.js';

describe('scrubAuthLogMessage', () => {
  it('removes the email from the existing-email sign-up message', () => {
    expect(
      scrubAuthLogMessage('Sign-up attempt for existing email: jane.doe+x@example.co.uk'),
    ).toBe('Sign-up attempt for existing email: [redacted-email]');
  });

  it('redacts every email in a message', () => {
    expect(scrubAuthLogMessage('a@b.io then c@d.org')).toBe(
      '[redacted-email] then [redacted-email]',
    );
  });

  it('leaves messages without an email unchanged', () => {
    expect(scrubAuthLogMessage('Rate limit exceeded')).toBe('Rate limit exceeded');
  });
});
