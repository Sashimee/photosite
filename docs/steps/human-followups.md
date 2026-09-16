# Human follow-ups

Work in `docs/PLAN.md` that needs Alex. The /loop run skips these and keeps building around them. Each entry says what is needed, what it unblocks and what happens meanwhile.

Last updated: 2026-09-16.

## Open decisions (`docs/DECISIONS.md`)

| # | Needed from Alex | Unblocks | Workaround meanwhile |
|---|------------------|----------|----------------------|
| O1 | List which external accounts already exist | 0.6, 1E.1, 2.4 | Code uses env vars with local fakes (MinIO, Mailpit, Stripe test mode once keys exist) |
| O2 | Legal entity operating photoo.lu | 0.6 Stripe platform, store accounts, 0.7, DAC7 | None needed before Phase 1 payments |
| O3 | Confirm auto-release delay | 1A.8 | Seeded as `autoReleaseDays = 7` in `PlatformSetting`, editable later |
| O4 | AI detection and reverse-search vendors | 1A.10 | Vendor adapters behind an interface with a fake adapter in tests |
| O5 | Brand kit | 1B.1 design tokens, 1C.9 store assets | Neutral shadcn/ui tokens, swapped when 0.8 lands |

## Human-only plan steps

| Step | What Alex does | Unblocks |
|------|----------------|----------|
| 0.4 | Give SSH access to dok.seil.products (or confirm Dokploy vs Coolify), create DNS records for photoo.lu, api., admin., staging.* | 0.5 deploys, 1E.1 staging. devops-engineer can prepare the audit checklist and firewall/SSH hardening scripts beforehand |
| 0.6 | Create accounts: Apple Developer, Google Play Console, Stripe + Connect, GA4/GTM/Ads/Search Console, Brevo, EU object storage, Sentry, AI-detection and reverse-search vendors, OAuth apps (Google, Apple, Facebook, Microsoft) | 1A.2 OAuth, 1A.7 email, 1A.8 payments, 1C.9 stores |
| 0.7 | Choose entity, brief a lawyer (ToS, photographer agreement, privacy policy, DPIA), ask the accountant about VAT on the fee and DAC7 | 2.2 compliance sign-off |
| 0.8 | Logo, colours, type, app icons, store screenshot template | O5 |

## Local environment

| Issue | Needed from Alex | Why deferred |
|-------|------------------|--------------|
| The `postgis/postgis` image installs `postgis_tiger_geocoder`, `postgis_topology` and `fuzzystrmatch` into the dev database, so `prisma migrate dev` reports drift and asks for a reset | Consent to (a) override the image's init so only `postgis` is enabled and (b) run `pnpm stack:reset` to recreate the local volumes | Destroys local data; Prisma refuses a reset from an AI agent without consent. Meanwhile migrations are generated with `prisma migrate diff` and applied with `prisma migrate deploy` |
