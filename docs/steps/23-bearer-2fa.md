# #23 Two-factor auth for bearer-only clients

Agents: api-developer (a), mobile-developer (b), test-writer, security-reviewer.

## Problem

1. `POST /v1/auth/sign-in` answers `{ twoFactorRequired: true }` and carries the pending challenge only in the `better-auth.two_factor` cookie. The mobile app is bearer-only (`credentials: 'omit'`), so it never holds that cookie; if it echoed it, `OriginGuard` would treat the request as cookie-authenticated and reject it for the missing `Origin` (403). A mobile user with TOTP enabled cannot sign in.
2. `POST /v1/auth/totp/verify` rotates the session on first verification. The new token is only in `Set-Cookie` / the `set-auth-token` header, never in the body, so a bearer client is signed out right after enabling 2FA (old bearer → 401). This is why 1C.2b deferred TOTP enrolment on mobile.

Web works and must keep working unchanged: the challenge, 5 attempts per challenge, lockout after 10 failures, single-use backup codes.

## Change

### 23a — contract and API (`fix/23-bearer-2fa`)

1. `packages/shared/src/contract/auth.ts`:
   - `TwoFactorRequiredResponseSchema` gains `challengeToken: string` — the opaque, signed value of the two-factor cookie. It is short-lived and only useful together with a valid TOTP or backup code, under the existing per-challenge and per-account limits.
   - `SignInTotpRequestSchema` gains optional `challengeToken`.
   - `TotpResponseSchema` gains optional `session: AuthSessionSchema`, present when verification rotated the session.
   - Regenerate `packages/api-client` (openapi.json + schema.ts).
2. `apps/api` `auth.controller.ts`:
   - `sign-in`: read the two-factor cookie value from the Better Auth response and return it as `challengeToken`. Web keeps getting the cookie too.
   - `sign-in/totp`: when `challengeToken` is present, build the headers passed to `verifyTOTP` / `verifyBackupCode` with that value as the two-factor cookie, ignoring any request cookie for it. The request itself carries no `Cookie`, so `OriginGuard` correctly treats it as bearer-style. A request with neither token nor cookie fails as today (401).
   - `totp/verify`: when `set-auth-token` is present, also return `session: { token, expiresAt }` in the body, matching what sign-in already returns for the session.
3. Tests: controller unit tests and `auth.integration.test.ts` for the bearer flow end to end — sign-in → `challengeToken` → `sign-in/totp` with no cookie and no Origin → 200 with a working bearer; bad code still counts toward the 5-attempt and lockout limits; a tampered or expired `challengeToken` → 401; enabling TOTP with a bearer returns a `session` whose token passes `GET /v1/auth/session`. The existing web cookie-path tests stay green.

### 23b — mobile challenge (`fix/23-bearer-2fa`)

`app/(auth)/sign-in` keeps `challengeToken` from the 2FA response in memory only (never SecureStore) and passes it to the two-factor screen, which sends it with the code or backup code. Tests for the happy path and for an expired challenge (back to sign-in with an error).

### Follow-up — mobile TOTP settings (separate step, after 23a merges)

The 1C.2b tasks deferred on this issue: enrol (secret + backup codes shown once, "I stored these" confirmation), verify (store the rotated `session` from the response), disable. Tracked in its own issue.

## Out of scope

No schema change. No change to the web client. Admin stays cookie-only.
