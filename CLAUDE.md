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
- Redis 7, S3-compatible EU object storage, Stripe Connect Express, Sentry
- Hosting: VPS dok.seil.products with Dokploy/Coolify; staging from `dev`, production from `main`

## Commands

Scaffolded in step 0.1 (pnpm 12, Node 24). Run from the root:

```
pnpm install
pnpm lint           # eslint in every workspace (turbo)
pnpm i18n:check     # check catalog consistency (strict mode added in 2.3)
pnpm typecheck      # tsc --noEmit in every workspace
pnpm test           # vitest run in every workspace
pnpm build          # tsc builds to dist/
pnpm format         # prettier --write (markdown is excluded)
pnpm --filter @photoo/<name> <script>
pnpm stack:up       # docker compose: postgres+postgis, redis, minio, mailpit (127.0.0.1 only)
pnpm stack:down     # stop the local dev stack
pnpm stack:reset    # stop the local dev stack and remove its volumes
pnpm db:seed        # forwards to packages/db seed script
```

Planned, not yet present: `pnpm dev` running the apps against the stack, `pnpm mock:api` (0.11). Workspaces are named `@photoo/<dir>`. TypeScript stays on 6.0 until typescript-eslint supports 7. A husky pre-commit hook runs lint-staged.

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
