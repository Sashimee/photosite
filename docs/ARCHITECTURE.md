# Architecture

Target architecture for photoo.lu. See `DECISIONS.md` for why each choice was made and `PLAN.md` for the order of work.

## Products

| Surface | Audience | Tech | Domain |
|---------|----------|------|--------|
| Public web | clients, photographers, professionals, search engines | Next.js (App Router, SSR/ISR) | photoo.lu |
| Mobile apps | clients, photographers, professionals | Expo (React Native), expo-router | App Store, Play Store |
| Admin | platform staff | Next.js, separate app | admin.photoo.lu |
| API | all clients | NestJS (Fastify), REST + OpenAPI, Socket.IO | api.photoo.lu |
| Worker | internal | NestJS standalone app, BullMQ | – |

## Monorepo layout

```
photosite/
  apps/
    web/        Next.js public site (SEO, marketing, marketplace UI)
    admin/      Next.js admin backend
    mobile/     Expo app (iOS + Android)
    api/        NestJS HTTP + WebSocket API
    worker/     NestJS standalone process: BullMQ queues (images, provenance, email, push, payouts)
  packages/
    db/         Prisma schema, migrations, seed, generated client
    shared/     zod schemas, DTO types, enums, constants, fee maths, country config types
    api-client/ typed client generated from the API's OpenAPI document (used by web, admin, mobile)
    i18n/       ICU message catalogs per locale + tooling to detect missing keys
    config/     shared eslint, prettier, tsconfig
  infra/
    docker/     Dockerfiles per app, compose for local dev (postgres, redis, minio, mailpit)
    dokploy/    service definitions / env templates for the VPS
  docs/         this folder
```

Tooling: pnpm workspaces, Turborepo, TypeScript strict, ESLint + Prettier, Vitest (unit/integration), Playwright (web e2e), Maestro (mobile e2e), Changesets not needed (single deployable).

## Core stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Language | TypeScript everywhere | strict mode, zod at every trust boundary |
| Web | Next.js, React, Tailwind CSS, shadcn/ui, next-intl | locale-prefixed routes `/en`, `/fr`, `/de`, `/pt`, `/es` |
| Mobile | Expo SDK (managed), expo-router, react-native-reusables/NativeWind, i18next + ICU | EAS Build, EAS Submit, EAS Update for OTA |
| API | NestJS + Fastify, class-less zod validation via `nestjs-zod`, Swagger/OpenAPI | versioned under `/v1` |
| Auth | Better Auth mounted in the API: email + password with verification, Google/Apple/Facebook/Microsoft, sessions, 2FA (TOTP) for admins, Expo plugin for mobile | if Better Auth's NestJS/Expo adapters prove immature at scaffold time, fall back to Passport strategies + custom session store; decide in step 1A.2 |
| Database | PostgreSQL 16 + PostGIS, Prisma | geo columns as `Unsupported("geography(Point,4326)")` with raw SQL for distance queries |
| Cache / queues / realtime | Redis 7: BullMQ, Socket.IO adapter, rate limiting | single instance on the VPS at launch |
| Storage | S3-compatible object storage (EU) | private buckets, presigned PUT/GET, public variants through a CDN-backed public bucket |
| Images | sharp in the worker | variants (thumb, medium, large, watermark), EXIF stripped on public variants, originals kept private |
| Payments | Stripe Connect Express, separate charges and transfers, Stripe React Native SDK, Stripe Elements on web | see `PAYMENTS.md` |
| Email | Brevo API, templates rendered with react-email | all transactional mail goes through the worker |
| Push | Expo Push Service | tokens per device, per-user notification preferences |
| Provenance | worker pipeline: AI-generated detection API + reverse image search API + `c2pa-node` + EXIF read | see `PLAN.md` step 1A.10 |
| Search | PostgreSQL full-text + PostGIS distance at launch; Meilisearch in Phase 3 | |
| Analytics | GTM + GA4 with Consent Mode v2 (web), Firebase Analytics (mobile) | see `COMPLIANCE.md` |
| Errors / monitoring | Sentry (web, mobile, api), Uptime Kuma or Better Stack, structured JSON logs (pino) | |
| CI/CD | GitHub Actions: lint, typecheck, test, build images to GHCR, deploy via Dokploy webhook; EAS for mobile | |

## Runtime topology on the VPS

```
Internet
  └─ Traefik (managed by Dokploy/Coolify, Let's Encrypt)
       ├─ photoo.lu          -> web (Next.js, node)
       ├─ admin.photoo.lu    -> admin (Next.js, node)   [+ IP allow-list, 2FA]
       └─ api.photoo.lu      -> api (NestJS, HTTP + WebSocket)
  worker (NestJS standalone)  -> consumes BullMQ queues
  postgres 16 + postgis        (volume, nightly pg_dump to object storage)
  redis 7                      (AOF persistence)
Object storage (Hetzner, EU)   <- presigned uploads from web/mobile, variants written by worker
Stripe, Brevo, Expo Push, provenance APIs  <- outbound only; webhooks inbound to api
```

Staging is a second Dokploy project (`staging.photoo.lu`, `api-staging`, `admin-staging`) deployed from `dev`; production deploys from `main`.

## Domain model (summary)

Full detail in `DATA-MODEL.md`.

- `User` with role flags (`client`, `photographer`, `professional`, `admin`), one role picked at sign-up.
- `PhotographerProfile`: public page (slug, bio, links to Instagram/website/others, avatar, service area as geo point + radius, categories, languages spoken), verification status, Stripe account id.
- `Product` (photographer's offer) with `ProductTier` rows for usage licences (personal, commercial, editorial, extended), each with price and deliverables.
- `Request` (client need: category, date, location, budget, description) -> `Quote` (photographer answer with line items, licence tier, validity) -> `Booking` (accepted quote, escrow state machine) -> `Delivery` -> `Payout`.
- `Conversation` / `Message` / `Attachment` for chat, scoped to a request, quote, booking or direct contact.
- `PortfolioImage` with `ProvenanceCheck` results and admin decision.
- `VerificationCase` with `VerificationDocument`s, driven by `Country.requiredDocuments`.
- `JobOffer` posted by professionals, `JobApplication` by photographers, `Listing` product abstraction for future paid listings.
- `ConsentRecord`, `AuditLog`, `Report` (abuse), `Notification`.

## Cross-cutting rules

- Contract first: every endpoint is described by zod schemas in `packages/shared` and exposed in OpenAPI; `packages/api-client` is regenerated in CI and committed.
- Every state change that touches money, verification or moderation writes an `AuditLog` row.
- All user-facing strings come from `packages/i18n`; missing keys fail CI in strict mode (enabled in phase 2.3).
- No direct object-storage access from clients; only presigned URLs with content-type and size limits.
- Country-specific behaviour (documents, VAT, currency, legal text) reads from the `Country` table, never from code branches.

## Testing

Vitest everywhere except `apps/mobile` (Jest via `jest-expo`, since Vitest doesn't run React Native). Unit and integration tests sit next to the code they test as `*.test.ts(x)`; integration suites additionally end in `*.integration.test.ts` (e.g. `apps/api/src/modules/auth/auth.integration.test.ts`) so they're easy to grep for even though the same `vitest run` picks up both.

**Env-gated integration tests.** `packages/db` and `apps/api` have suites that need a real Postgres/Redis (migrations, constraints, seed idempotency, auth flows against Better Auth). Each package exports a `requireIntegrationEnv(keys)` helper (`packages/db/src/testing/require-integration-env.ts`, `apps/api/src/testing/require-integration-env.ts`): outside CI, a missing var returns `undefined` and the suite calls `it.skip(...)` with the reason in the test name; when `CI=true`, a missing var throws instead of skipping, so a misconfigured CI job fails loudly instead of silently reporting zero integration tests. `pnpm test:integration` runs these suites locally against `pnpm stack:up` using `packages/db/.env` and `apps/api/.env`; CI runs the same suites against `postgis/postgis:16-3.5` and `redis:7-alpine` service containers (`.github/workflows/ci.yml`).

**Test-database hygiene**, enforced by review, not tooling:

- Unique data per test: build emails/identifiers with `randomUUID()` (see `uniqueEmail()` in `auth.integration.test.ts`), never a fixed string, so concurrent or repeated runs never collide.
- Each test cleans up only the rows it created (track created ids/emails and delete them in `afterAll`/`afterEach`), including rows created against a shared fixture it doesn't own — e.g. `auth.integration.test.ts` signs in as the seeded `client@photoo.test` user in two tests, which creates real `Session` rows on that user, so `afterAll` also deletes `Session` rows for that email.
- `packages/db` runs `fileParallelism: false` (`packages/db/vitest.config.ts`) because its suites call `seedDatabase()` directly against one shared `TEST_DATABASE_URL`; running files in parallel races on the same `Country`/`PlatformSetting`/seed-user rows. `apps/api` integration suites don't call `seedDatabase()` directly and use per-test unique emails, so they run with Vitest's default parallelism.
- Never `TRUNCATE`, reset, or drop the shared `photoo_test`/`photoo_shadow` databases from a test; migrations and seed run once per CI job (or once per `pnpm stack:up` locally), and tests must be safe to run repeatedly against the same, growing database.
- Rate-limit and lockout state lives in Redis, not Postgres, and isn't cleaned up by deleting rows: `auth.integration.test.ts` clears `auth:rate-limit:*` and `auth:lockout:*` keys in `beforeAll` and `afterEach` so one test's lockout never bleeds into the next.

**Coverage.** `@vitest/coverage-v8` (pinned to the same version as `vitest`, currently `5.0.1`) is enabled in-config (`test.coverage.enabled: true`) for `packages/shared`, `packages/i18n`, `packages/db`, `packages/api-client`, `apps/api` and `apps/web`; `apps/mobile` uses Jest's built-in coverage (`collectCoverage: true` in `apps/mobile/jest.config.js`). Coverage runs as part of the existing `pnpm test` (turbo `test` task) rather than a separate `test:coverage` step, so CI pays the cost of instrumentation once, not a second full test run. Coverage output (`coverage/`) is gitignored and not declared as a turbo cache output — it's a side effect of `test`, not an artifact anything downstream reads.

Each workspace's `vitest.config.ts` (or `jest.config.js`) scopes `coverage.include`/`collectCoverageFrom` to its own `src/`(and `apps/mobile`'s `app/`) so files never touched by any test count as 0% rather than being silently dropped from the denominator, then excludes:

- Generated code with no hand-written logic: `packages/db/src/generated/**` (Prisma client), `packages/api-client/src/schema.ts` (generated by `openapi-typescript`; `openapi.json` isn't TypeScript so it's never instrumented in the first place).
- CLI entry scripts that run side effects at import time and just call an already-unit-tested function: `packages/shared/src/scripts/**` (writes `openapi.json`, calls `buildOpenApiDocument`), `packages/i18n/src/scripts/**` (calls `process.exit`, calls `checkCatalogs`).
- Test-only fixtures with no branching logic of their own, as opposed to test *code* that has its own assertions and is measured normally: `apps/api/src/testing/{create-test-app,test-env,mailpit,totp}.ts`. `requireIntegrationEnv` keeps its own dedicated test and stays covered.
- Process/framework entry points that can't run under Vitest/Jest without a live server: `apps/api/src/main.ts` (calls `app.listen`; the same bootstrap pieces are exercised via `createTestApp` in every integration test), `apps/web/src/app/**` (Next.js App Router layout/page/error/not-found — async Server Components needing a live Next request; covered by Playwright e2e once 1B.12 lands, and the pure logic they call, e.g. `csp.ts`/`locale-routing.ts`, is unit-tested directly), `apps/web/src/i18n/request.ts` (wraps `next/root-params`), `apps/web/src/instrumentation*.ts` (Sentry SDK init, no logic of ours). `apps/mobile`'s `collectCoverageFrom` is scoped to `app/**` and `src/**`, which naturally excludes root tool config (`babel.config.js`, `metro.config.js`, `tailwind.config.js`, `app.config.ts`) and `jest/` test helpers without an explicit exclude list.

Thresholds are set to the coverage measured with the local stack running (`pnpm stack:up`, integration suites included), rounded down to the nearest whole percent, minus one point, so `pnpm test` only fails on a regression and a threshold only ever ratchets up as real coverage improves:

| Workspace | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `packages/shared` | 98 | 95 | 99 | 99 |
| `packages/i18n` | 93 | 89 | 99 | 93 |
| `packages/db` | 75 | 66 (CI runs the seed on a fresh database, so fewer seed branches execute than locally) | 82 | 75 |
| `packages/api-client` | 99 | 99 | 99 | 99 |
| `apps/api` | 85 | 67 | 90 | 86 |
| `apps/web` | 48 | 60 | 55 | 48 |
| `apps/mobile` (Jest) | 71 | 49 | 72 | 70 |

`packages/db` and `apps/api` thresholds assume the integration suites ran (local stack up, or CI's service containers); without `TEST_DATABASE_URL`/`REDIS_URL` those suites skip, real coverage drops, and `pnpm test` for those two workspaces will fail on thresholds even though every runnable test passed — this is deliberate: it makes "the stack isn't running" visible instead of a silent, permanently-lower bar. Use `pnpm test:integration` (or `pnpm stack:up` first) to get a passing, representative run locally.

**End-to-end (planned).** Playwright for `apps/web` lands in step 1B.12 under `apps/web/e2e/`, covering flows Vitest+jsdom can't (real Next.js Server Components, full page navigation, the App Router entry files excluded from Vitest coverage above). Maestro for `apps/mobile` lands in step 1C.10 under `apps/mobile/e2e/`, covering on-device flows Jest+jest-expo can't (native navigation, permissions, camera/upload). Neither exists yet; this section will grow with concrete conventions once those steps land.
