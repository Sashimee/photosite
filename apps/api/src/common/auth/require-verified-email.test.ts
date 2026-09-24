import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireVerifiedEmail } from './require-verified-email.js';

describe('requireVerifiedEmail', () => {
  it('does not throw when the email is verified', () => {
    expect(() => {
      requireVerifiedEmail({ emailVerifiedAt: new Date().toISOString() });
    }).not.toThrow();
  });

  it('throws a 403 with EMAIL_NOT_VERIFIED when emailVerifiedAt is null', () => {
    try {
      requireVerifiedEmail({ emailVerifiedAt: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
  });

  it('throws when emailVerifiedAt is missing', () => {
    expect(() => {
      requireVerifiedEmail({});
    }).toThrow(HttpException);
  });
});
