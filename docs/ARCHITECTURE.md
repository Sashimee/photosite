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
