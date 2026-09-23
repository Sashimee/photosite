import { HttpException } from '@nestjs/common';
import { EMAIL_NOT_VERIFIED_ERROR_CODE } from '@photoo/shared';

// docs/SECURITY.md: "Email verification required before any marketplace
// action". Called first, before any role check or rate-limit spend, on
// every action `requiresVerifiedEmail(true)` marks in the contract
// (packages/shared/src/contract), so an unverified caller never burns a
// rate-limit budget just to be told no.
export function requireVerifiedEmail(user: { emailVerifiedAt?: string | Date | null }): void {
  if (!user.emailVerifiedAt) {
    throw new HttpException(
      {
        code: EMAIL_NOT_VERIFIED_ERROR_CODE,
        message: 'Verify your email address before doing this',
      },
      403,
    );
  }
}
