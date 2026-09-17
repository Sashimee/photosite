# photosite (photoo.lu)

Marketplace connecting clients, photographers and professionals: web (photoo.lu), iOS and Android apps, admin backend. Luxembourg first, worldwide later. The platform takes a 5 % fee on bookings.

Status: **in execution** (Phase 0). Read `docs/PLAN.md` before doing any work; per-step subplans live in `docs/steps/`.

## Docs

- `docs/PLAN.md` – phased step plan with parallel lanes and agent assignment. Source of truth for what to build next.
- `docs/DECISIONS.md` – decisions log and open questions. Change a decision here first.
- `docs/ARCHITECTURE.md` – stack, monorepo layout, runtime topology, cross-cutting rules.
- `docs/DATA-MODEL.md` – entities and invariants for the Prisma schema.
- `docs/PAYMENTS.md` – Stripe Connect flow (escrow-style release, fee, webhooks).
- `docs/SECURITY.md` – must/should checklist enforced by the security-reviewer agent.
- `docs/COMPLIANCE.md` – GDPR, consent, GA4 Consent Mode, retention, DSA, DAC7.

## Stack (decided, see docs/DECISIONS.md)

pnpm + Turborepo monorepo, TypeScript strict everywhere.

- `apps/web` Next.js (App Router, next-intl, Tailwind, shadcn/ui) – public site, SEO
- `apps/admin` Next.js – admin backend on admin.photoo.lu, 2FA mandatory
- `apps/mobile` Expo (React Native, expo-router, NativeWind, i18next) – App Store + Play Store via EAS
- `apps/api` NestJS (Fastify) – REST + OpenAPI, Socket.IO chat, Better Auth (fallback Passport)
- `apps/worker` NestJS standalone – BullMQ jobs: images (sharp), provenance (AI detection, reverse search, C2PA, EXIF), email (Brevo), push (Expo), payouts/release, GDPR exports
- `packages/db` Prisma + PostgreSQL 16 + PostGIS; `packages/shared` zod schemas/enums/fee helper; `packages/api-client` generated from OpenAPI; `packages/i18n` ICU catalogs (en, fr, de, pt, es); `packages/config` eslint/tsconfig
- Redis 7, S3-compatible EU object storage, ClamAV (upload virus scanning), Stripe Connect Express, Sentry
- Hosting: VPS dok.seil.pro with Dokploy; preview (noindex) at footoo.bas.lu from `main`, staging from `dev`, production from `main` (later phases)

## Commands

Scaffolded in step 0.1 (pnpm 12, Node 24). Run from the root:

```
pnpm install
pnpm lint           # eslint in every workspace (turbo)
pnpm i18n:check     # check catalog consistency (strict mode added in 2.3)
pnpm typecheck      # tsc --noEmit in every workspace
pnpm test           # vitest run in every workspace (apps/mobile uses jest-expo instead)
pnpm test:integration  # runs the db/api/worker integration suites against the running local stack (pnpm stack:up); doesn't start the stack itself
pnpm build          # tsc builds to dist/ (apps/web builds to .next/ via next build); apps/mobile has no build script, native builds go through EAS
pnpm format         # prettier --write (markdown is excluded)
pnpm mock:api       # serve packages/api-client/openapi.json with Prism (Docker image) on 127.0.0.1:4010
pnpm --filter @photoo/shared openapi:generate       # zod contract -> packages/api-client/openapi.json
pnpm --filter @photoo/api-client generate           # openapi.json -> typed client (src/schema.ts)
pnpm --filter @photoo/api-client generate:check     # fail if the typed client is stale
pnpm --filter @photoo/web dev       # Next.js dev server on :3000, against NEXT_PUBLIC_API_URL (mock or api)
pnpm --filter @photoo/api dev       # NestJS (Fastify) API on PORT (default 4000), watches src/ and restarts
pnpm --filter @photoo/mobile start  # Expo dev server against EXPO_PUBLIC_API_URL (mock or api); --ios/--android/--web variants
pnpm --filter @photoo/<name> <script>
pnpm stack:up       # docker compose: postgres+postgis, redis, minio, mailpit, clamav (127.0.0.1 only)
pnpm stack:down     # stop the local dev stack
pnpm stack:reset    # stop the local dev stack and remove its volumes
pnpm db:seed        # forwards to packages/db seed script
docker build -f infra/docker/api.Dockerfile -t photosite-api:dev .
docker build -f infra/docker/worker.Dockerfile -t photosite-worker:dev .
docker build -f infra/docker/web.Dockerfile -t photosite-web:dev .
```

Preview (Phase 0.5): Dockerfiles in `infra/docker/`, compose and runbook in `infra/dokploy/preview/`. Deploy via GitHub Actions workflow `.github/workflows/deploy-preview.yml` to GHCR, then Dokploy webhook.

Planned, not yet present: `pnpm dev` running every app against the stack at once. Workspaces are named `@photoo/<dir>`. TypeScript stays on 6.0 until typescript-eslint supports 7. A husky pre-commit hook runs lint-staged. `apps/mobile` native builds/submits run through EAS (`eas.json`); `eas init`, `eas build`, `eas submit` need an Expo account login and `EAS_PROJECT_ID` (see `docs/steps/human-followups.md`).

Update this section when scripts change (docs-sync agent).

## Conventions

- Branch flow: `feature -> dev -> main`. PRs target `dev`. Branch names `feat/<slug>`, `fix/<slug>`, `chore/<slug>` with issue number when there is one.
- Conventional Commits; one logical change per commit.
- Work tracked in GitHub Issues; security findings labelled `security`, compliance gaps `compliance`.
- `RESUME.md` holds session working state and is gitignored.
- Contract first: zod schemas in `packages/shared` and OpenAPI change before clients; `packages/api-client` is generated, never hand-edited.
- Money is integer cents + ISO currency; fee maths only through the shared helper.
- Every mutation on money, verification, moderation or roles writes `AuditLog`.
- Country-specific behaviour comes from the `Country` table, never from code branches.
- All user-facing text comes from `packages/i18n`; `en` is the source of truth.
- Only the schema-migrator agent edits `schema.prisma`; only the payments-engineer agent edits Stripe code.

## Agents (`.claude/agents/`)

| Agent | Job | Model |
|-------|-----|-------|
| api-developer | NestJS API/worker modules | sonnet |
| payments-engineer | Stripe Connect flows and payment UI review | opus |
| schema-migrator | Prisma schema, migrations, seed | sonnet |
| web-developer | Next.js web and admin apps | sonnet |
| mobile-developer | Expo app and store readiness | sonnet |
| devops-engineer | Docker, CI/CD, Dokploy, backups, monitoring, EAS | sonnet |
| test-writer | Vitest, Playwright, Maestro tests | sonnet |
| check-runner | runs all checks, reports failures | haiku |
| code-reviewer | PR review for correctness and conventions | opus |
| security-reviewer | audit against docs/SECURITY.md | opus |
| compliance-reviewer | audit against docs/COMPLIANCE.md | opus |
| seo-auditor | metadata, structured data, sitemaps, CWV, ads readiness | sonnet |
| i18n-maintainer | catalog sync and draft translations | haiku |
| docs-sync | keeps CLAUDE.md, README, RESUME, docs, agents current | haiku |

Delegate a step to the agent named in `docs/PLAN.md`; do not spawn agents for work no agent covers.
