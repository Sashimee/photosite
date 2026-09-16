# Security requirements

Checklist the security-reviewer agent enforces. Every item maps to a step in `PLAN.md`; nothing ships to production with an open "must" item.

## Authentication and sessions (must)

- Passwords hashed with Argon2id; minimum length 10, checked against a breached-password list (HIBP k-anonymity) at sign-up and change.
- Email verification required before any marketplace action; verification tokens single-use, 24 h expiry, hashed at rest.
- OAuth: state + PKCE, redirect URIs allow-listed per environment; Apple sign-in on iOS via native flow, Google via native flow, Facebook/Microsoft via web flow.
- Sessions: opaque tokens stored hashed, httpOnly + Secure + SameSite=Lax cookies on web, secure storage (`expo-secure-store`) on mobile, sliding expiry, "log out everywhere".
- Admin accounts: TOTP 2FA mandatory, session lifetime 12 h, login only from admin.photoo.lu, optional IP allow-list at Traefik.
- Rate limiting (Redis) on login, sign-up, password reset, OTP, quote creation, messages, uploads; per IP and per account.
- Account lockout with exponential backoff after repeated failures; no user enumeration in error messages.

## Authorization (must)

- RBAC roles (`client`, `photographer`, `professional`, `admin`) plus resource ownership checks in every service method, never only in the controller.
- Admin permissions split: `support`, `moderator`, `finance`, `superadmin`.
- Every mutation on money, verification, moderation and roles writes `AuditLog`.

## Input and output (must)

- zod validation on every request body, query and param; unknown keys rejected.
- Prisma parameterised queries only; raw SQL for geo queries uses tagged templates.
- Output DTOs whitelisted; private fields (EXIF, documents, emails of other users) never serialised to other users.
- HTML sanitised (DOMPurify server-side) for the few rich-text fields; Markdown rendered without raw HTML.

## Uploads and storage (must)

- Presigned PUT URLs with content-type and size limits (images 25 MB, documents 15 MB), key namespaced per user, 10 min expiry.
- Worker re-validates magic bytes, re-encodes images with sharp (kills embedded payloads), strips EXIF from public variants.
- Verification documents and chat attachments in private buckets, served through short-lived presigned GET; ClamAV scan in the worker before they are viewable.
- No public listing on buckets; separate credentials for api and worker with least privilege.

## Web security (must)

- Helmet headers, strict CSP (nonce-based; GTM/GA allowed via nonce), HSTS preload, COOP/COEP where compatible, Referrer-Policy strict-origin-when-cross-origin.
- CSRF: SameSite cookies plus double-submit token on state-changing web requests; mobile uses bearer tokens without cookies.
- CORS allow-list: photoo.lu, admin.photoo.lu, staging hosts, Expo dev origin only in dev.
- Dependency scanning (Dependabot + `pnpm audit` in CI), Docker images pinned by digest, non-root containers, read-only filesystem where possible.

## Payments (must)

- Stripe webhook signature verification and idempotency (`StripeEvent` table).
- Amounts always recomputed server-side from the quote; clients never send prices.
- Refunds after release and transfer reversals restricted to `finance` admins with 2FA re-prompt.

## Realtime chat (must)

- Socket handshake authenticated with the session; a socket can only join conversations it participates in (checked in DB, cached in Redis briefly).
- Message size limits, attachment scanning, per-user message rate limit, abuse report endpoint.

## Privacy and data (must)

- PII encrypted at rest where practical (verification data fields with application-level encryption; bucket server-side encryption); database volume encrypted; backups encrypted before upload.
- Logs never contain tokens, passwords, document contents or full card data; pino redaction list maintained.
- Data export and deletion flows per `COMPLIANCE.md`.

## Infrastructure (must)

- VPS: SSH keys only, fail2ban, ufw with only 22/80/443, automatic security updates, Dokploy/Coolify admin behind strong auth.
- Secrets only in Dokploy environment variables; `.env` files gitignored; secret rotation procedure documented.
- Nightly encrypted `pg_dump` + object storage bucket versioning; restore tested quarterly.
- Sentry with PII scrubbing; uptime checks on all three hosts.

## Should

- Content Security Policy report-only phase before enforcement.
- Optional TOTP 2FA for all users.
- Bug bounty / responsible disclosure page (`/.well-known/security.txt`).
- Annual external penetration test once revenue justifies it.
