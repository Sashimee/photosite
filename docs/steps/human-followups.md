# Human follow-ups

Work in `docs/PLAN.md` that needs Alex. The /loop run skips these and keeps building around them. Each entry says what is needed, what it unblocks and what happens meanwhile.

Last updated: 2026-09-17.

## Open decisions (`docs/DECISIONS.md`)

| # | Needed from Alex | Unblocks | Workaround meanwhile |
|---|------------------|----------|----------------------|
| O1 | List which external accounts already exist | 0.6, 1E.1, 2.4 | Code uses env vars with local fakes (MinIO, Mailpit, Stripe test mode once keys exist) |
| O2 | Legal entity operating photoo.lu | 0.6 Stripe platform, store accounts, 0.7, DAC7 | None needed before Phase 1 payments |
| O3 | Confirm auto-release delay | 1A.8 | Seeded as `autoReleaseDays = 7` in `PlatformSetting`, editable later |
| O4 | AI detection vendor (Hive vs Sightengine) and reverse-search vendor (TinEye vs Google Vision Web Detection): pick one of each, create the accounts, provide the API keys | 1A.10 real checks (the pipeline itself is not blocked) | `docs/steps/1A.10-provenance.md`: both vendors sit behind an interface whose null implementation is selected when the key is absent. The pipeline, scoring, admin queue and status effects all work without a vendor — every image simply lands in the admin queue as `review` instead of being auto-approved |
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

## Accounts and access (2026-09-17)

| Issue | Needed from Alex | Blocks | Workaround meanwhile |
|-------|------------------|--------|----------------------|
| GitHub Actions jobs are not starting: "recent account payments have failed or your spending limit needs to be increased" | Fix billing in GitHub Settings → Billing & plans, then re-run CI on `main` (or `gh workflow run ci.yml --ref main`) | CI on every PR (no merges on green), the Deploy preview workflow (images for the migrate fix from #71 aren't built, so api and worker stay down on footoo.bas.lu) | Local root checks before opening PRs; PRs stay open until CI runs |
| The preview database is empty (`GET /v1/photographers` returns no items), so profile, search and request pages have nothing to show | Run the seed once from a host shell, per `infra/dokploy/preview/README.md` "Seed": `cd /etc/dokploy/compose/compose-index-back-end-application-k6x26o/code && docker compose -p compose-index-back-end-application-k6x26o -f infra/dokploy/preview/compose.yml --profile seed run --rm seed`. Never add `--env-file .env`: Dokploy's "Create environment file" writes the `.env` beside the compose file (`code/infra/dokploy/preview/.env`), not at the repo root. The runbook also has a direct `docker run` fallback for when that file has not been written yet — it must take its S3 keys from the **worker** container, since the api's MinIO user is scoped to `photoo-private` and the seed writes to `photoo-public`. The Dokploy API has no run-one-off-container call and SSH from the dev machine times out | Demo content on footoo.bas.lu | Local stack has seed data |
| The Dokploy API token was printed once in a tool output | Rotate it in Dokploy and replace `~/.config/dokploy/seil.token` | – | – |
| `~/.config/ghcr/read.token` is root-owned and world-readable (644), and belongs to the personal account | `chmod 600` plus chown to your user; ideally replace it with a read:packages token from a machine user and update the `ghcr-sashimee-read` registry in Dokploy | – | Works as is |
| The post-deploy browser smoke job (`deploy-preview.yml`, docs/steps/1E.9-browser-smoke.md) signs in as `client@photoo.test` against the real footoo.bas.lu, so it needs the actual `SEED_USER_PASSWORD` the preview's `seed` profile was run with (`infra/dokploy/preview/README.md` "Seed"), not the CI-only default | Add it as GitHub repo secret `PREVIEW_SEED_USER_PASSWORD` | The 4 signed-in page checks in that job; the signed-out checks and the CI `browser-smoke` job (which uses its own dev-only seed) are unaffected | Job fails loudly on the missing secret; nothing blocks on it since the job never gates the deploy |

## Provenance vendors (1A.10)

| Issue | Needed from Alex | Blocks | Workaround meanwhile |
|-------|------------------|--------|----------------------|
| Turning `PROVENANCE_ENABLED=true` sends a public portfolio image to a third-party vendor, which makes that vendor a sub-processor | A signed DPA per vendor, the vendor named in the privacy policy and in `docs/COMPLIANCE.md` sub-processors, and an EU or adequacy-decision transfer basis | Automatic AI-detection and reverse-search verdicts in any real environment | The flag stays off; only EXIF and (optionally) C2PA signals are used, and nothing leaves the worker |
| Each uploaded portfolio image costs one vendor call | Confirm the per-image price and set a monthly cap with the vendor | – | Queue concurrency is 2 and a checked image is never re-checked without an explicit admin re-check |

## Legal review (1A.12 GDPR)

| Issue | Needed from Alex | Blocks | Workaround meanwhile |
|-------|------------------|--------|----------------------|
| The 30-day deletion grace period and the retention table in `docs/COMPLIANCE.md` (10-year ledger, 5-year verification records, 90-day chat purge) are our reading of the law, not a lawyer's | Confirm the figures with the lawyer, and confirm that the self-service export may exclude verification document *bytes* (metadata included) as long as a documented manual route exists | Nothing in code — the numbers are constants in one place and a change is a one-line edit | The plan implements the current table and keeps every figure as a named constant |
| The deletion confirmation and grace-period notice must state what survives deletion and for how long | Approve the wording | Real user-facing copy | Placeholder English copy in `packages/i18n`, translations after approval |
| A subject who insists on copies of their verification documents needs a manual process (identity check before release) | Define the support process | – | Nothing is built for this in Phase 1; the export README points at support |

## Job board (1A.13)

| Issue | Needed from Alex | Blocks | Workaround meanwhile |
|-------|------------------|--------|----------------------|
| Do professionals need document-based verification like photographers (1A.9), or is a manual `verified` flag enough for launch? | A decision, with the lawyer if it touches liability for who may post work offers | Nothing — the flag ships either way | 1A.13 ships the manual admin flag and no self-service flow |
| Must a job offer carry a compensation range to be published? Pay-transparency rules are moving, and Luxembourg's position should be checked before the board is public | Confirm with the lawyer | Making the field required (a one-line contract change) | `compensation` is optional in Phase 1 |
| Job board terms: what a professional warrants when posting, and the takedown process | Folded into the Phase 2 ToS work already listed | Public launch of the board | Offers are reportable by id; moderation queue is 1A.11 |

## Payments (1A.8) — the biggest schedule risk

| Issue | Needed from Alex | Blocks | Workaround meanwhile |
|-------|------------------|--------|----------------------|
| O2: the operating legal entity, and then the Stripe platform account | Decide the entity, create the Stripe account, provide **test-mode** keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) | Every live payment path: Connect Express onboarding, real webhook signatures, 3-D Secure and Radar behaviour | `docs/steps/1A.8-payments.md`: all Stripe access goes through a `StripeGateway` interface with a deterministic fake used in tests, CI and local dev. The state machine, ledger, idempotency, refunds, release job and PDFs are all built and tested against it. The API refuses to boot in production without a real key — the fake is never a fallback |
| Once test-mode keys exist, a short live checklist has to be run | Connect Express onboarding with a test account; `stripe listen` webhook replay against a real signature; a 3-D Secure test card through the Payment Element; a partial refund; a transfer reversal | Confidence that the fake matched reality | The checklist is written down in the step plan so it is a scheduled verification, not an unknown |
| Accountant: VAT on the platform fee for Luxembourg photographers (17 %), whether the platform issues the fee invoice itself, and DAC7 applicability plus the exact seller fields to collect | Answers from the accountant | Correct invoicing and the yearly DAC7 export (Phase 3) | The shared fee helper takes a VAT-on-fee flag driven by `Country.vatRate`, defaulting to off |
| Stripe Radar rules, and whether 3-D Secure is forced on every payment | A decision once the account exists | Fraud posture at launch | Automatic payment methods decide, which is Stripe's default |

## Local environment

| Issue | Needed from Alex | Why deferred |
|-------|------------------|--------------|
| The `postgis/postgis` image installs `postgis_tiger_geocoder`, `postgis_topology` and `fuzzystrmatch` into the dev database, so `prisma migrate dev` reports drift and asks for a reset | Consent to (a) override the image's init so only `postgis` is enabled and (b) run `pnpm stack:reset` to recreate the local volumes | Destroys local data; Prisma refuses a reset from an AI agent without consent. Meanwhile migrations are generated with `prisma migrate diff` and applied with `prisma migrate deploy` |

## Security follow-ups

| Issue | Needed from Alex | Why deferred |
|-------|------------------|--------------|
| #91: before the fix, `image-process` wrote resized variants for every image upload (including `chat_attachment`/`verification_document`) to the public bucket. Local dev/test MinIO and the `photoo`/`photoo_test` Postgres databases were checked on 2026-09-17: no `Upload` row for a private purpose has a non-null `variants` column, and `photoo-public` only holds seed `avatar`/`cover`/`portfolio` keys, so nothing to clean there. `main`/`footoo.bas.lu` preview is far behind `dev` (chat API isn't deployed there yet) and its seed script never creates `chat_attachment`/`verification_document` uploads, so it almost certainly has none either — but nobody has shell/S3 access to footoo.bas.lu's MinIO to confirm | Once dev merges to main and preview redeploys with chat/verification live, spot-check the preview `photoo-public` bucket (`mc ls --recursive`) for any `chat_attachment`/`verification_document` upload's variants before real users start attaching files, and delete any found | Not exploitable today: no such uploads exist pre-fix, and the fix stops new ones |

## Credentials pending (0.6) and their placeholders

| Service | Placeholder until Alex provides it |
|---------|------------------------------------|
| Sentry | `@sentry/nextjs` is a no-op without `SENTRY_DSN`; staging/prod set `SENTRY_REQUIRED=true` so a missing DSN fails the build. On mobile, `@sentry/react-native` is only initialised in `apps/mobile/src/lib/sentry.ts` when `EXPO_PUBLIC_SENTRY_DSN` is set; `expo-doctor` prints an organization/project warning for source-map upload until Alex adds those to the EAS/Sentry config |
| Expo account + EAS project | `eas.json` and `app.config.ts` are committed (1C.1 done). `extra.eas.projectId` comes from `EAS_PROJECT_ID`, omitted when unset. Alex creates the Expo project at expo.dev, sets `EAS_PROJECT_ID` (and `EXPO_TOKEN` for CI), runs `eas init` once, then the first `eas build --profile development` for iOS/Android |
| OAuth apps (Google, Apple, Facebook, Microsoft) | 1A.2 enables a provider only when its client id/secret env vars are set; email + password works without them |
| Brevo SMTP relay credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`) and sender domain authentication (SPF/DKIM/DMARC) | Production email delivery; local dev and the preview use Mailpit instead. Part of 0.6 and 2.4 |
| `EXPO_ACCESS_TOKEN` | Optional; push notifications work without it once the Expo account exists (0.6) |
| Universal links / App Links for auth emails (1C.2) | Needs the Apple Developer and Google Play accounts: publish `apple-app-site-association` and `assetlinks.json`, then switch verification and password-reset emails to universal links. Until then the mobile app verifies with a "continue" re-check plus a pasted token, so nothing is blocked |
| `admin.photoo.lu` DNS + certificate (1D.1) | Production admin host. The preview serves the admin app under `/admin` on the existing host (same-origin with the API), so no DNS is needed to build or test it. Add the record when the real subdomain is wanted |
| Backup key pair (1E.3) | `age-keygen` locally; the **private key** goes in Alex's password manager and never on the server, the public key into the Dokploy env as `BACKUP_AGE_RECIPIENT`. A backup the compromised host can decrypt protects against disk failure only. Until it is set, the backup service refuses to run rather than writing plaintext dumps |
| Off-host backup destination for production (1E.3) | The preview writes dumps to the MinIO that shares its host with Postgres: that covers a bad migration or a dropped database, not a lost machine. Pick a second EU S3 target before production |
| Production superadmin (1A.11) | Created by a one-off script after the first production deploy, then its TOTP enrolled. There is deliberately no API endpoint that can mint a superadmin. Locally the seed grants every permission |
| Sentry DSNs for api and worker (1E.2) | Part of 0.6. Both apps currently report **nothing** when they throw. 1E.2a ships and is tested without a DSN (SDK stays uninitialised); staging and production set `SENTRY_REQUIRED=true` so a missing DSN fails the boot there |
| External uptime provider (1E.2) | A checker on `dok.seil.pro` cannot report that `dok.seil.pro` is down. Until an external check exists, the self-hosted one catches service-level failure only, and the README says so |
| Verification review standard (1D.3) | What counts as sufficient proof per document type, and what to do with a suspected forgery (refuse and record, or escalate). The queue enforces that a reason is given but cannot decide the policy; without it, reviewers invent one case by case. Belongs with the 0.7 lawyer conversation |
| Cookie inventory for the cookie policy (1B.10) | 1B.10a produces the technical list (name, purpose, lifetime, first/third party) of every cookie actually set; the lawyer turns it into the published text on the `/legal/cookies` page that #173 stubbed. Also confirm the initial `policyVersion` to seed into `PlatformSetting`, since every stored consent decision references it |
| Moderation policy and the statement of reasons (1D.6) | 1D.6a ships the notice mechanism (#191); the wording is a legal question — the DSA expects the notice to name the ground for the decision and the redress route. Belongs with the 0.7 lawyer conversation, alongside 1D.3's review standard |
| Who holds the `moderation` permission (1D.6) | The permission exists and nobody has it. A report queue with no assignee is a queue nobody empties; decide whether this is Alex alone at launch or a named second person |
| Lock-screen notification preview (1C.5) | Sender name plus message preview is the chat convention, but it makes a message readable without unlocking the phone. If that is not wanted, the change is in the server payload (1A.7), not the app. Decide before push ships |
| Push verification needs a real device and an Expo account (1C.5) | 1C.5a/b are testable without either; 1C.5c can be written but not verified, so it must not be called done on CI alone. Pair this with 1C.4's real-device check in one sitting |
| DNS + Dokploy project for `staging.photoo.lu` (1E.1) | Point the hostname at `dok.seil.pro`, create the Dokploy project and let it issue TLS. Blocking for 1E.1b |
| VPS capacity for a second full stack (1E.1) | Preview already runs twelve services including ClamAV, and #131 (worker OOM) is open. If the host is tight, the OOM killer takes a process from *either* stack and the preview looks flaky for no code reason. Confirm headroom, or choose a reduction (bigger VPS, shared ClamAV, or no ClamAV in staging at a stated cost in fidelity). Blocking for 1E.1b |
| Brevo sandbox credentials for staging (1E.1) | Staging drops Mailpit and sends over real TLS, so that the production mail path is proven somewhere before production. Without these, staging deploys but cannot send mail and email verification is untestable there |
| The launch fee percentage (1D.7) | `DEFAULT_PLATFORM_SETTINGS` and the seed both say 5 %, matching `CLAUDE.md`. Confirm 5 % is what the platform launches with before anything charges a real card: `Booking.feePercent` snapshots at creation, so changing it later does not revisit bookings already taken |
| Countries enabled at launch (1D.7) | Luxembourg first is decided; whether the neighbouring countries are open on day one is not. `Country.enabled` is the switch and 1D.7a exposes it |
| Legal text ownership (1D.7) | Publishing a legal text version through the admin screen is publishing a legal document. Confirm the lawyer's text is the source and the screen only versions it. With the 0.7 lawyer conversation |
| Do `pt` and `es` ship at launch? (1B.11) | `packages/i18n` carries five locales. hreflang advertises what exists, and advertising a locale whose catalog is largely English is worse for search than not advertising it. A content decision, not a code one |
