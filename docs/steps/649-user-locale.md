# #649 Change a user's locale after sign-up

Agents: api-developer (a), mobile-developer and web-developer (b), test-writer.

## Problem

Only `POST /v1/auth/sign-up` sets `User.locale`. Emails and push are rendered in `User.locale`, so a user who switches language in the app or on the web keeps receiving mail in the sign-up language. The mobile locale switcher from 1C.2b can't persist.

## Change

### 649a — contract and API (`feat/649-user-locale`)

1. `packages/shared/src/contract`: `PATCH /v1/me/locale` with body `{ locale: LocaleSchema }`, response `200 { user }` (the same `User` schema as `GET /v1/auth/session`), `401` unauthenticated, `400` invalid locale. Session (cookie or bearer) required; the global OriginGuard applies.
2. Regenerate `packages/api-client/openapi.json` and `src/schema.ts`.
3. `apps/api`: a handler that updates only the caller's `User.locale` and returns the session user. A locale preference is not money, verification, moderation or roles, so no `AuditLog` row. The Better Auth `/update-user` catch-all stays closed (#14).
4. Tests: contract test; API unit + integration (updates own row only, rejects unknown locale, 401 without session, returns the updated user).

### 649b — clients

1. Mobile account screen: the locale switcher calls `PATCH /v1/me/locale`, then `updateUser` and `i18next.changeLanguage`; signed-out users only switch i18next. Error copy under `mobile.account.*`.
2. Web `locale-switcher`: when signed in, persist with the same endpoint before navigating to the new locale; navigation still happens if the call fails (the URL locale wins for the page, the mail locale just stays stale).
3. Tests for both clients, including the failure path.

No schema change.
