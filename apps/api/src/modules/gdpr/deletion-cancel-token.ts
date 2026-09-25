import { createHmac, timingSafeEqual } from 'node:crypto';

// A soft-deleted account has no session and cannot sign in again to get one
// (docs/steps/1A.12-gdpr.md "Cancellable during the grace period"), so the
// cancel link mailed at deletion time carries this token instead. It is an
// HMAC over the row's own identity rather than a stored secret (no schema
// change: only the schema-migrator agent edits schema.prisma) and carries no
// expiry of its own: `DataRequestsService.cancel` only accepts it while
// `status = 'pending'` and the request is inside
// `GDPR_DELETION_GRACE_PERIOD_MS`, so it stops working once the grace period
// ends (even if the sweep has not anonymised the account yet), and using it
// once flips that status, making a second use a no-op.
// The purpose label keeps this token from ever being interchangeable with
// another HMAC over the same secret: `AUTH_SECRET` is also Better Auth's
// signing key, and a bare pair of ids is exactly the input some future
// feature would reach for. Changing the label invalidates outstanding links,
// so it is versioned rather than edited in place.
const TOKEN_PURPOSE = 'deletion-cancel:v1';

export function signDeletionCancelToken(
  secret: string,
  dataRequestId: string,
  userId: string,
): string {
  return createHmac('sha256', secret)
    .update(`${TOKEN_PURPOSE}:${dataRequestId}:${userId}`)
    .digest('hex');
}

export function verifyDeletionCancelToken(
  secret: string,
  dataRequestId: string,
  userId: string,
  token: string,
): boolean {
  const expected = Buffer.from(signDeletionCancelToken(secret, dataRequestId, userId), 'hex');
  const supplied = Buffer.from(token, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
