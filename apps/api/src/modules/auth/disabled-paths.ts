// Issue #14 fix 2: defence in depth. `/v1/auth/callback/:provider` is the
// only Better Auth HTTP route we mount (oauth-callback.ts); nothing else is
// reachable via the router today. This list disables every other native
// path anyway, so a future change that re-adds a broader route (or a
// plugin update that mounts a new one under an existing prefix) does not
// silently re-expose them. It only affects the HTTP router — the
// controller's `auth.api.*` calls are unaffected.
export const DISABLED_BETTER_AUTH_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/sign-in/social',
  '/sign-out',
  '/verify-email',
  '/send-verification-email',
  '/request-password-reset',
  '/reset-password',
  '/update-user',
  '/change-password',
  '/verify-password',
  '/update-session',
  '/list-sessions',
  '/get-session',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/delete-user',
  '/error',
  '/ok',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  '/two-factor/get-totp-uri',
];
