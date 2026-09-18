# photoo.lu build plan

Step plan for the marketplace (web + iOS/Android) connecting clients, photographers and professionals. Read `DECISIONS.md` first, then `ARCHITECTURE.md`. This plan is **not started**; nothing below is executed until Alex says so.

How to read a step:

- **ID** `<phase><lane>.<n>` – lanes are independent streams of work.
- **Agent** – the project agent in `.claude/agents/` that owns the step (`human` = Alex or a third party).
- **Effort** – S (< 1 day), M (1–3 days), L (3–7 days), XL (> 1 week), assuming one developer plus agents.
- **Blocked by** – steps that must be merged first. Steps sharing a phase and having no blocker among each other run in parallel.

Every step ends with: checks green (`pnpm lint`, `pnpm typecheck`, `pnpm test`), a Conventional Commit on a `feat/…` branch off `dev`, a PR into `dev`, `RESUME.md` updated. Reviewer agents run on every PR (`code-reviewer`, plus `security-reviewer` on auth/payments/uploads/chat, plus `compliance-reviewer` on anything touching personal data or consent).

## Phase overview

| Phase | Goal | Exit criterion |
|-------|------|----------------|
| 0 | Foundations: monorepo, CI, local dev, server, accounts, contracts | `pnpm dev` runs all apps locally; staging deploys from `dev`; API contract v0 published |
| 1 | MVP build across five parallel lanes (API, web, mobile, admin, ops) | End-to-end flow works on staging: sign up -> verified photographer -> client request -> quote -> chat -> pay -> deliver -> release |
| 2 | Launch preparation | Security + compliance reviews closed, legal texts live, apps approved in both stores, photoo.lu live with Luxembourg only |
| 3 | Increments after launch | Job board, paid listings, reviews, availability, ads automation, more locales, more countries |

Parallelism summary: Phase 0 has one blocking step (0.1) then everything else in parallel. Phase 1 lanes B, C, D build against the contract (1.0) with a mock server, so they never wait for lane A except for integration steps marked "needs A". Lane E runs continuously.

---

## Phase 0 – Foundations

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 0.1 | Monorepo scaffold: pnpm workspaces, Turborepo, TypeScript strict, shared eslint/prettier/tsconfig in `packages/config`, empty `apps/*` and `packages/*` per `ARCHITECTURE.md`, husky + lint-staged, `pnpm lint/typecheck/test/build` pipelines, update `CLAUDE.md` commands | main session | M | – |
| 0.2 | CI: GitHub Actions workflow running lint, typecheck, unit tests, build on PRs to `dev`/`main`; Turborepo remote cache optional; Dependabot config | devops-engineer | S | 0.1 |
| 0.3 | Local dev stack: `infra/docker/compose.dev.yml` with postgres+postgis, redis, MinIO (local S3), Mailpit; `.env.example` per app; seed script entry point | devops-engineer | S | 0.1 |
| 0.4 | Server audit and PaaS setup: inventory what runs on dok.seil.pro, confirm Dokploy, create `photoo-preview` project with preview compose, then `photoo-staging` and `photoo-prod` projects later, DNS for photoo.lu / api. / admin. / staging.* / footoo.bas.lu, TLS, firewall + SSH hardening per `SECURITY.md` | devops-engineer (+ human for DNS/credentials) | M | – |
| 0.5 | Dockerfiles per app (multi-stage, non-root) and a "hello" deploy of api + web + admin to staging via Dokploy webhook from `dev` | devops-engineer | M | 0.1, 0.4 |
| 0.6 | External accounts (human): Apple Developer Program, Google Play Console, Stripe (+ Connect platform approval), GA4 + GTM + Google Ads + Search Console, Brevo, object storage bucket + credentials, Sentry, AI-detection and reverse-search vendor keys, OAuth apps for Google/Apple/Facebook/Microsoft (dev + prod redirect URIs) | human | M | – |
| 0.7 | Legal kick-off (human): choose operating entity, brief a lawyer on ToS, photographer agreement, privacy policy, DPIA; ask the accountant about VAT on the fee and DAC7 | human | M | – |
| 0.8 | Brand kit (human or designer): logo, colours, type, app icons, store screenshots template | human | M | – |
| 0.9 | Prisma bootstrap in `packages/db`: datasource, PostGIS extension migration, `Country` table seeded with Luxembourg (currency EUR, VAT 17, required documents: autorisation d'établissement, VAT/TVA number, ID, proof of address), `PlatformSetting` seeded (feePercent 5, autoReleaseDays 7) | schema-migrator | S | 0.1, 0.3 |
| 0.10 | i18n foundation: `packages/i18n` with ICU catalogs for en, fr, de, pt, es (en complete, others empty with CI check for missing keys), locale list and fallback rules in `packages/shared` | i18n-maintainer | S | 0.1 |
| 0.11 | **API contract v0** (`1.0` below): zod schemas and OpenAPI for auth, profiles, products, requests, quotes, bookings, chat, uploads, verification, admin; mock server (Prism) target in `pnpm mock:api`; generated `packages/api-client` | main session + api-developer | L | 0.1, 0.9 |

Parallel groups in Phase 0: `{0.1}` -> `{0.2, 0.3, 0.9, 0.10}` -> `{0.5, 0.11}`; `{0.4, 0.6, 0.7, 0.8}` run from day one independently of code.

---

## Phase 1 – MVP

### Lane A – API and worker (`apps/api`, `apps/worker`, `packages/db`, `packages/shared`)

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 1A.1 | Schema: identity (`User`, `Account`, `Session`, `Device`, `ConsentRecord`), `AuditLog`, `Notification`; migrations + seed users per role | schema-migrator | M | 0.9 |
| 1A.2 | Auth module: Better Auth (or Passport fallback, decide here) with email + password, verification email, password reset, Google/Apple/Facebook/Microsoft, sessions for web (cookie) and mobile (bearer), role selection at sign-up, "add role" endpoint, TOTP 2FA, rate limits, lockout | api-developer | L | 1A.1, 0.11 |
| 1A.3 | Uploads module: presigned PUT/GET for S3, upload records, worker job `image.process` (sharp variants, EXIF extraction kept private, EXIF stripped on public variants), worker job `file.scan` (ClamAV) | api-developer | M | 1A.1 |
| 1A.4 | Schema + module: `PhotographerProfile`, `PortfolioImage`, `Product`, `ProductTier`, `Country` reads; public profile endpoint with geo/category search (PostGIS raw SQL), slug rules | schema-migrator then api-developer | L | 1A.1, 1A.3 |
| 1A.5 | Schema + module: `Request`, `Quote` (line items, fee helper from `packages/shared`, validity, state machine), direct quote from a `Product` + `ProductTier` | schema-migrator then api-developer | L | 1A.4 |
| 1A.6 | Chat: `Conversation`, `Message`, `Attachment`; Socket.IO gateway with Redis adapter, auth on handshake, membership checks, typing/read receipts, REST history with cursor pagination, unread counters | api-developer | L | 1A.2, 1A.3 |
| 1A.7 | Notifications: `Notification` service, email via Brevo (react-email templates, worker queue), push via Expo Push (worker queue, token management, receipts), per-user preferences | api-developer | M | 1A.2 |
| 1A.8 | Payments: Stripe Connect Express onboarding + account links + `account.updated`; `Booking` state machine; PaymentIntent creation; webhook endpoint with `StripeEvent` idempotency; `Delivery`; release job (manual accept + auto-release cron); refunds; `LedgerEntry`; receipts and fee invoice PDFs. Follows `PAYMENTS.md` exactly | payments-engineer | XL | 1A.5, 1A.7 |
| 1A.9 | Verification: `VerificationCase` + `VerificationDocument` driven by `Country.requiredDocuments`, submission flow, private encrypted bucket, admin decision endpoints, status effects on `isPublished` | api-developer | M | 1A.4, 1A.3 |
| 1A.10 | Provenance pipeline (worker): on portfolio upload run AI-generated detection API, reverse image search API, `c2pa-node` manifest read, EXIF camera/timestamp signals; compute score and verdict; `ProvenanceCheck`; admin review endpoints; vendor adapters behind an interface so vendors can be swapped (open decision O4) | api-developer | L | 1A.3, 1A.4 |
| 1A.11 | Admin API: user management (search, suspend, roles), verification queue, provenance queue, bookings/payments/disputes, reports, platform settings, audit log query; admin permission levels | api-developer | L | 1A.2, 1A.8, 1A.9, 1A.10 |
| 1A.12 | GDPR: `DataRequest` export job (zip to private bucket, expiring link), deletion + anonymisation job with retention exceptions, consent record endpoints | api-developer | M | 1A.1, 1A.3 |
| 1A.13 | Professionals: `ProfessionalProfile`, `JobOffer`, `JobApplication`, `Listing` (free plan only) endpoints | api-developer | M | 1A.2 |
| 1A.14 | API hardening pass: Helmet/CSP, CORS allow-list, request logging with redaction, health/readiness endpoints, OpenAPI regenerated, `packages/api-client` regenerated in CI | api-developer + security-reviewer | M | all 1A |

Parallel groups in lane A: `{1A.1}` -> `{1A.2, 1A.3}` -> `{1A.4, 1A.6, 1A.7, 1A.12, 1A.13}` -> `{1A.5, 1A.9, 1A.10}` -> `{1A.8}` -> `{1A.11}` -> `{1A.14}`.

### Lane B – Public web (`apps/web`)

Builds against the mock server from 0.11 until the matching lane A step lands; "needs A" marks the integration checkpoint.

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 1B.1 | App shell: Next.js App Router, Tailwind + shadcn/ui, design tokens from the brand kit, locale routing with next-intl (`/en`, `/fr`, `/de`, `/pt`, `/es`), layout, navigation, footer, error pages, Sentry | web-developer | M | 0.11, 0.10 |
| 1B.2 | Auth screens: sign-up with role choice, email verification, login, OAuth buttons, password reset, account settings (roles, locale, delete account, data export) | web-developer | M | 1B.1 (needs 1A.2) |
| 1B.3 | Photographer public profile page: SSR/ISR, portfolio grid (approved images only), products with licence tiers, links, contact/"request a quote" CTA, JSON-LD (`Person`/`LocalBusiness`, `Service`, `Offer`), OG image | web-developer | L | 1B.1 (needs 1A.4) |
| 1B.4 | Discovery: search by location (geolocation + city autocomplete), category, language, price; results with map optional; landing pages `/[locale]/photographers/[country]/[city]/[category]` for SEO and ads | web-developer | L | 1B.3 |
| 1B.5 | Client request flow: create request (category, date, location, budget, usage), my requests, quote list, compare, accept/decline | web-developer | L | 1B.2 (needs 1A.5) |
| 1B.6 | Chat UI: conversation list, thread, attachments, typing, read receipts, unread badges; Socket.IO client with reconnect | web-developer | L | 1B.2 (needs 1A.6) |
| 1B.7 | Checkout and booking: Stripe Payment Element, booking status pages, delivery acceptance, refund request, receipts download | web-developer + payments-engineer review | L | 1B.5 (needs 1A.8) |
| 1B.8 | Photographer dashboard: onboarding wizard (profile, portfolio upload with provenance status, products + tiers, verification documents per country, Stripe onboarding link), quotes inbox, bookings, earnings | web-developer | XL | 1B.2 (needs 1A.4, 1A.8, 1A.9, 1A.10) |
| 1B.9 | Professional area: company profile, post/edit job offer (free listing), applications inbox; public job board pages | web-developer | M | 1B.2 (needs 1A.13) |
| 1B.10 | Consent banner + GTM + GA4 Consent Mode v2, consent settings page, conversion events per `COMPLIANCE.md` | web-developer + compliance-reviewer | M | 1B.1 |
| 1B.11 | SEO pass: metadata per locale, hreflang, canonical, sitemap (profiles, landing pages, job offers), robots, structured data validation, Core Web Vitals budget in CI (Lighthouse CI) | seo-auditor + web-developer | M | 1B.3, 1B.4, 1B.9 |
| 1B.12 | Web e2e: Playwright flows for sign-up, request -> quote -> pay (Stripe test mode), chat, photographer onboarding | test-writer | M | 1B.7, 1B.8 |

Parallel groups in lane B: `{1B.1}` -> `{1B.2, 1B.3, 1B.10}` -> `{1B.4, 1B.5, 1B.6, 1B.8, 1B.9}` -> `{1B.7, 1B.11}` -> `{1B.12}`.

### Lane C – Mobile (`apps/mobile`)

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 1C.1 | Expo scaffold: expo-router, NativeWind, i18next with shared catalogs, secure storage, API client, Sentry, EAS project, dev builds for iOS/Android | mobile-developer | M | 0.11, 0.10 |
| 1C.2 | Auth: sign-up with role, email verification deep link, login, native Apple and Google sign-in, Facebook/Microsoft via web auth session, session handling, account settings | mobile-developer | L | 1C.1 (needs 1A.2) |
| 1C.3 | Discovery + profile: search with device location, profile screen, products/tiers, request a quote | mobile-developer | L | 1C.1 (needs 1A.4) |
| 1C.4 | Requests and quotes: create request, my requests, quotes, accept/decline | mobile-developer | M | 1C.2 (needs 1A.5) |
| 1C.5 | Chat + push: Socket.IO client, conversation UI, image/PDF attachments from camera/gallery/files, Expo push registration, notification deep links | mobile-developer | L | 1C.2 (needs 1A.6, 1A.7) |
| 1C.6 | Payments: Stripe React Native PaymentSheet with Apple Pay/Google Pay, booking screens, delivery acceptance | mobile-developer + payments-engineer review | M | 1C.4 (needs 1A.8) |
| 1C.7 | Photographer tools: portfolio upload with progress and provenance status, products/tiers, verification document capture, Stripe onboarding via in-app browser, quotes inbox | mobile-developer | L | 1C.2 (needs 1A.4, 1A.8, 1A.9) |
| 1C.8 | Analytics consent + Firebase Analytics + iOS ATT flow per `COMPLIANCE.md` | mobile-developer + compliance-reviewer | S | 1C.1 |
| 1C.9 | Store readiness: app icons, splash, privacy manifest (iOS), data safety form (Android), account deletion path in-app (store rule), screenshots, listing texts per locale, EAS Build + Submit pipelines, TestFlight / internal testing tracks | mobile-developer + devops-engineer | M | 1C.6, 1C.7 |
| 1C.10 | Mobile e2e: Maestro flows for auth, request, chat, payment (test mode) | test-writer | M | 1C.6 |

Parallel groups in lane C: `{1C.1}` -> `{1C.2, 1C.3, 1C.8}` -> `{1C.4, 1C.5, 1C.7}` -> `{1C.6}` -> `{1C.9, 1C.10}`.

### Lane D – Admin (`apps/admin`)

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 1D.1 | Admin shell: Next.js app, admin login with mandatory TOTP 2FA, permission levels, data tables, audit trail viewer | web-developer | M | 0.11 (needs 1A.2) |
| 1D.2 | Users: search, view, suspend/reactivate, roles, impersonation-free support view, GDPR request handling | web-developer | M | 1D.1 (needs 1A.11) |
| 1D.3 | Verification queue: case detail, document viewer via presigned GET, approve/reject with reason, per-country document config editor | web-developer | M | 1D.1 (needs 1A.9, 1A.11) |
| 1D.4 | Provenance queue: flagged images with scores, vendor evidence, approve/reject, bulk actions | web-developer | M | 1D.1 (needs 1A.10, 1A.11) |
| 1D.5 | Finance: bookings, ledger, refunds, transfer reversals (finance permission + 2FA re-prompt), disputes, payout status, exports (CSV) | web-developer + payments-engineer review | L | 1D.1 (needs 1A.8, 1A.11) |
| 1D.6 | Moderation: reports queue, profile/job-offer moderation, content takedown with DSA-style notices | web-developer | M | 1D.1 (needs 1A.11) |
| 1D.7 | Settings: platform fee, auto-release days, feature flags, countries enable/disable, legal text versions, email template preview | web-developer | S | 1D.1 (needs 1A.11) |
| 1D.8 | Dashboard: KPIs (sign-ups per role, requests, quotes, bookings, GMV, fee revenue, verification backlog) | web-developer | S | 1D.5 |

Parallel groups in lane D: `{1D.1}` -> `{1D.2, 1D.3, 1D.4, 1D.5, 1D.6, 1D.7}` -> `{1D.8}`.

### Lane E – Ops, quality, review (continuous)

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 1E.1 | Staging environment complete: all services, Stripe test keys, Brevo sandbox, staging buckets, seed data, Stripe CLI webhook forwarding docs | devops-engineer | M | 0.5 |
| 1E.2 | Monitoring: Sentry projects, uptime checks, log shipping, alerting to email/Telegram | devops-engineer | S | 1E.1 |
| 1E.3 | Backups: nightly encrypted pg_dump to object storage, bucket versioning, documented restore drill | devops-engineer | S | 1E.1 |
| 1E.4 | Test strategy: Vitest setup per package, integration tests for API modules with a test database, coverage thresholds in CI; add tests alongside each lane A step | test-writer | M | 0.2 |
| 1E.5 | Load test chat and API hot paths (k6) on staging; tune Redis/socket settings | devops-engineer | S | 1A.6, 1E.1 |
| 1E.6 | Security review checkpoints: after 1A.2, 1A.3, 1A.6, 1A.8, 1B.7, 1C.6, 1D.5; findings filed as GitHub issues | security-reviewer | continuous | – |
| 1E.7 | Compliance review checkpoints: after 1A.12, 1B.10, 1C.8, 1A.10 (DPIA input) | compliance-reviewer | continuous | – |
| 1E.8 | Docs sync: keep `CLAUDE.md`, `README.md`, `docs/` and agents current after each merged step | docs-sync | continuous | – |
| 1E.9 | Browser smoke test in CI: load every locale's key routes in Chromium, signed out and signed in, and fail on an uncaught error, a console error, a failed same-origin request or the error boundary. Added after three bugs reached the preview that no server-side check could see (see `docs/steps/1E.9-browser-smoke.md`) | test-writer + devops-engineer | S | 0.2, 1E.4 |

---

## Phase 2 – Launch preparation

| ID | Step | Agent | Effort | Blocked by |
|----|------|-------|--------|-----------|
| 2.1 | Full security review of the MVP against `SECURITY.md`; fix all "must" findings | security-reviewer then api/web/mobile developers | L | Phase 1 |
| 2.2 | Compliance sign-off: RoPA, DPIA, retention jobs, consent flows, legal texts wired per locale, imprint, security.txt | compliance-reviewer + human (lawyer) | M | Phase 1, 0.7 |
| 2.3 | Translations: fr, de, pt, es catalogs completed and reviewed by native speakers; legal texts per locale; switch `pnpm i18n:check` to `--strict` in CI | i18n-maintainer + human | M | Phase 1 |
| 2.4 | Production environment: prod Dokploy project, real Stripe keys, Connect platform approval, Brevo domain authentication (SPF/DKIM/DMARC), production buckets, DNS cut-over, HSTS | devops-engineer + human | M | 1E.1, 0.6 |
| 2.5 | Store submissions: App Store review, Play review, account deletion and privacy declarations, handle rejections | mobile-developer + human | M | 1C.9 |
| 2.6 | SEO launch: Search Console verification, sitemap submission, GA4/GTM production container, Ads conversion tags verified with consent, initial landing pages for Luxembourg cities and top categories | seo-auditor + human | S | 1B.11, 2.4 |
| 2.7 | Private beta with a handful of Luxembourg photographers and clients on production; fix list; go/no-go | human + all developers | M | 2.1–2.6 |
| 2.8 | Public launch: announce, enable sign-ups, monitor | human + devops-engineer | S | 2.7 |

Parallel: `{2.1, 2.2, 2.3, 2.4, 2.5, 2.6}` all at once; then `{2.7}` -> `{2.8}`.

---

## Phase 3 – Increments after launch (priority order, each is its own mini-project)

| ID | Increment | Agents | Notes |
|----|-----------|--------|-------|
| 3.1 | Reviews and ratings after released bookings | schema-migrator, api-developer, web-developer, mobile-developer | feeds SEO (`AggregateRating`) |
| 3.2 | Paid and featured listings (job board and profiles) via Stripe Checkout | payments-engineer, web-developer | `Listing` abstraction already in place |
| 3.3 | Google Ads automation: offline conversion import from `booking_paid`, Dynamic Search Ads page feed from the sitemap, per-city/category ad landing page variants, UTM attribution stored on requests | seo-auditor, api-developer | needs consent for enhanced conversions |
| 3.4 | Availability calendar and instant booking for products | api-developer, web-developer, mobile-developer | |
| 3.5 | Meilisearch for discovery, saved searches, alerts for photographers on new requests nearby | api-developer, devops-engineer | |
| 3.6 | Additional locales: Luxembourgish, Italian; per-locale legal texts | i18n-maintainer, human | |
| 3.7 | Multi-country rollout kit: enable a `Country` row, documents config, currency handling, Stripe capabilities per country, local payment methods (Payconiq/Bancontact via Stripe), localised landing pages | payments-engineer, compliance-reviewer, api-developer | "the goal is the world" |
| 3.8 | DAC7 yearly export, accounting exports, fee invoice improvements | payments-engineer, compliance-reviewer | confirm with accountant |
| 3.9 | Optional 2FA for all users, passkeys | api-developer, security-reviewer | |
| 3.10 | Photographer teams / second shooters, multi-photographer bookings (split transfers) | payments-engineer | design already allows split transfers |

---

## Parallelisation map

```
Phase 0   0.1 ──┬─ 0.2 ─┐
                ├─ 0.3 ─┼─ 0.5 ──────────────┐
                ├─ 0.9 ─┼─ 0.11 (contract) ──┤
                └─ 0.10 ┘                    │
          0.4, 0.6, 0.7, 0.8 (human/ops, day one) ─┘

Phase 1   Lane A (API)     1A.1 → {1A.2,1A.3} → {1A.4,1A.6,1A.7,1A.12,1A.13} → {1A.5,1A.9,1A.10} → 1A.8 → 1A.11 → 1A.14
          Lane B (web)     1B.1 → {1B.2,1B.3,1B.10} → {1B.4,1B.5,1B.6,1B.8,1B.9} → {1B.7,1B.11} → 1B.12
          Lane C (mobile)  1C.1 → {1C.2,1C.3,1C.8} → {1C.4,1C.5,1C.7} → 1C.6 → {1C.9,1C.10}
          Lane D (admin)   1D.1 → {1D.2..1D.7} → 1D.8
          Lane E (ops)     1E.1 → {1E.2,1E.3,1E.5}; 1E.4, 1E.6, 1E.7, 1E.8 continuous
          Lanes B, C, D start on the mock server right after 0.11; each "needs A" checkpoint swaps mock for real.

Phase 2   {2.1, 2.2, 2.3, 2.4, 2.5, 2.6} → 2.7 → 2.8
```

Recommended agent concurrency on this plan: at most one implementer per lane at a time (five implementers), plus reviewers on demand. More than one implementer inside the same app causes merge conflicts in shared files (schema, routes, navigation).

## Definition of done (every step)

1. Code matches `ARCHITECTURE.md` and the conventions in `CLAUDE.md`.
2. zod schemas and OpenAPI updated; `packages/api-client` regenerated when the API changed.
3. Tests: unit for logic, integration for API modules, e2e for user flows touched; all checks green in CI.
4. i18n: no hard-coded user-facing strings; new keys added to `en` and flagged for translation.
5. Security and compliance reviewers signed off where the lane table requires it.
6. `RESUME.md` updated, PR into `dev` opened with `Closes #<issue>`.

## Tasks only Alex can do

- 0.4 credentials for the VPS and DNS for photoo.lu.
- 0.6 all external accounts and OAuth apps (Apple sign-in needs the Apple Developer account first).
- 0.7 legal entity, lawyer, accountant (VAT on fee, DAC7).
- 0.8 brand kit.
- 2.3 native-speaker review of translations.
- 2.5 store account holder actions (agreements, tax forms, review replies).
- 2.7 recruiting beta photographers and clients.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Better Auth adapters for NestJS/Expo not mature enough | decided in 1A.2 with a time-boxed spike; fallback is Passport + custom sessions, the contract does not change |
| Stripe Connect platform approval delays | apply in 0.6 immediately; build against test mode |
| App Store rejection (thin wrapper, account deletion, sign-in rules) | native flows, in-app deletion, Apple sign-in; review checklist in 1C.9 |
| AI-detection vendors give false positives on real photos | admin review always in the loop; verdict thresholds configurable; vendor adapters swappable |
| Holding client funds looks like payment services | separate charges and transfers is Stripe's supported marketplace pattern; confirm with the lawyer in 0.7 |
| Translation debt | CI fails on missing keys; en is the source of truth; translations batched per phase |
| Solo-developer bottleneck on review | reviewer agents on every PR; merge order follows the lane groups above |
