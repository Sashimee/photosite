# Human follow-ups

Work in `docs/PLAN.md` that needs Alex. The /loop run skips these and keeps building around them. Each entry says what is needed, what it unblocks and what happens meanwhile.

Last updated: 2026-09-17.

## Open decisions (`docs/DECISIONS.md`)

| # | Needed from Alex | Unblocks | Workaround meanwhile |
|---|------------------|----------|----------------------|
| O1 | List which external accounts already exist | 0.6, 1E.1, 2.4 | Code uses env vars with local fakes (MinIO, Mailpit, Stripe test mode once keys exist) |
| O2 | Legal entity operating photoo.lu | 0.6 Stripe platform, store accounts, 0.7, DAC7 | None needed before Phase 1 payments |
| O3 | Confirm auto-release delay | 1A.8 | Seeded as `autoReleaseDays = 7` in `PlatformSetting`, editable later |
| O4 | AI detection and reverse-search vendors | 1A.10 | Vendor adapters behind an interface with a fake adapter in tests |
| O5 | Brand kit | 1B.1 design tokens, 1C.9 store assets | Neutral tokens in `apps/web/src/styles/tokens.css` and a text wordmark; swap that one file when 0.8 lands. `apps/mobile/tailwind.config.js` mirrors the same neutral scale as sRGB hex (NativeWind cannot resolve `oklch()`); update it alongside. `apps/mobile/assets/icon.png` and `splash.png` are plain solid-colour placeholders generated locally; replace with real app icon/splash art in 1C.9 |

## Human-only plan steps

| Step | What Alex does | Unblocks |
|------|----------------|----------|
| 0.5b | Preview on `footoo.bas.lu` (Dokploy at `dok.seil.pro`), runbook in `infra/dokploy/preview/README.md`: create Dokploy project `photoo-preview` with the compose service from `infra/dokploy/preview/compose.yml` on `main`; set env secrets there (generate `AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`, Postgres/Redis/MinIO passwords); enable its deploy webhook and add it as GitHub repo secret `DOKPLOY_PREVIEW_WEBHOOK_URL`; add a GHCR pull credential in Dokploy (read-only token from a dedicated machine user; keep the packages private, the migrate image contains source); confirm Dokploy's Traefik doesn't set `forwardedHeaders.insecure` and its entrypoints are named `web`/`websecure`. Later: DNS `s3.footoo.bas.lu` for browser uploads, and SMTP credentials (e.g. Brevo) so preview mail reaches real inboxes instead of the internal Mailpit. Optional: a Dokploy API token as GitHub secret for deploy status, SSH from the workstation (port 22 timed out on 2026-09-17), DNS for `admin.footoo.bas.lu` once `apps/admin` serves (1D.1) | First preview deploy; until then images build on `main` and the deploy job fails loudly on the missing webhook secret |
| 0.4 | Real launch hosting: DNS for photoo.lu, api., admin., staging.* on `dok.seil.pro`. Size the production ClamAV service: clamd needs ~1.5 GB RAM for signatures and freshclam needs outbound access to `database.clamav.net` through the firewall | 1E.1 staging, 2.4 production. The preview (0.5b) runs on `footoo.bas.lu` meanwhile |
| 0.6 | Create accounts: Apple Developer, Google Play Console, Stripe + Connect, GA4/GTM/Ads/Search Console, Brevo, EU object storage, Sentry, AI-detection and reverse-search vendors, OAuth apps (Google, Apple, Facebook, Microsoft) | 1A.2 OAuth, 1A.7 email, 1A.8 payments, 1C.9 stores |
| 0.7 | Choose entity, brief a lawyer (ToS, photographer agreement, privacy policy, DPIA), ask the accountant about VAT on the fee and DAC7 | 2.2 compliance sign-off |
| 0.8 | Logo, colours, type, app icons, store screenshot template | O5 |
| 1E.1 | Configure the production `photoo-public` bucket's read policy (anonymous/CDN `s3:GetObject` only, no `ListBucket`) with the EU object storage provider at deploy time; dev MinIO uses a custom bucket policy for this (`infra/docker/compose.dev.yml`) but production is provider-specific | 1E.1 staging/prod public image serving |

## Local environment

| Issue | Needed from Alex | Why deferred |
|-------|------------------|--------------|
| The `postgis/postgis` image installs `postgis_tiger_geocoder`, `postgis_topology` and `fuzzystrmatch` into the dev database, so `prisma migrate dev` reports drift and asks for a reset | Consent to (a) override the image's init so only `postgis` is enabled and (b) run `pnpm stack:reset` to recreate the local volumes | Destroys local data; Prisma refuses a reset from an AI agent without consent. Meanwhile migrations are generated with `prisma migrate diff` and applied with `prisma migrate deploy` |

## Credentials pending (0.6) and their placeholders

| Service | Placeholder until Alex provides it |
|---------|------------------------------------|
| Sentry | `@sentry/nextjs` is a no-op without `SENTRY_DSN`; staging/prod set `SENTRY_REQUIRED=true` so a missing DSN fails the build. On mobile, `@sentry/react-native` is only initialised in `apps/mobile/src/lib/sentry.ts` when `EXPO_PUBLIC_SENTRY_DSN` is set; `expo-doctor` prints an organization/project warning for source-map upload until Alex adds those to the EAS/Sentry config |
| Expo account + EAS project | `eas.json` and `app.config.ts` are committed (1C.1 done). `extra.eas.projectId` comes from `EAS_PROJECT_ID`, omitted when unset. Alex creates the Expo project at expo.dev, sets `EAS_PROJECT_ID` (and `EXPO_TOKEN` for CI), runs `eas init` once, then the first `eas build --profile development` for iOS/Android |
| OAuth apps (Google, Apple, Facebook, Microsoft) | 1A.2 enables a provider only when its client id/secret env vars are set; email + password works without them |
| Brevo SMTP relay credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) and sender domain authentication (SPF/DKIM/DMARC) | Production email delivery; local dev and the preview use Mailpit instead. Part of 0.6 and 2.4 |
| `EXPO_ACCESS_TOKEN` | Optional; push notifications work without it once the Expo account exists (0.6) |
