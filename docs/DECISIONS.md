# Decisions log

Decisions taken with Alex on 2026-09-16 before any code was written. Change a decision here first, then update the docs and agents that depend on it.

| # | Topic | Decision | Alternatives rejected | Why |
|---|-------|----------|-----------------------|-----|
| D1 | Web + mobile stack | TypeScript monorepo (pnpm + Turborepo): Next.js web, Expo (React Native) mobile | Flutter mobile; SvelteKit + Capacitor; Next.js PWA wrapper | SEO needs SSR; stores need real native apps; one language and shared packages keep a small team fast |
| D2 | Backend | Dedicated NestJS API (Fastify adapter), PostgreSQL + Prisma, Redis, BullMQ workers | tRPC inside Next.js; Supabase | Mobile + web clients, WebSocket chat, Stripe webhooks and background jobs need a real service, not route handlers |
| D3 | Payments | Stripe Connect, Express accounts, platform fee 5 % | Mollie Connect; Adyen for Platforms | Best marketplace tooling, mobile SDKs, KYC and payouts for Luxembourg and later worldwide |
| D4 | Money flow | Escrow-style: client pays full quote on acceptance, funds released to photographer on delivery confirmation (auto-release after a grace period) | Deposit + balance; pay on invoice | Protects both sides, makes the 5 % fee unavoidable, supports disputes |
| D5 | OAuth providers | Google, Apple, Facebook, Microsoft, plus email + password with verification | – | Apple is mandatory on iOS once any social login exists |
| D6 | Languages at launch | English (default), French, German, Portuguese, Spanish; Luxembourgish and Italian as follow-up locales | English only | Luxembourg's largest communities; i18n from day one is far cheaper than retrofitting |
| D7 | Portfolio provenance | AI-generated detection + reverse image search + C2PA content credentials + EXIF signals, scored and sent to admin review | AI detection only | Catches both generated images and stolen work; never auto-bans, admin decides |
| D8 | Job board | Free listings at launch, built on a "listing product" abstraction so paid/featured listings can be enabled later | Free forever; paid from day one; commission on hire | Lead generator now, revenue later without a rewrite |
| D9 | Hosting | VPS dok.seil.products with Dokploy/Coolify already installed; Docker images per service; Traefik TLS from the PaaS | Bare Docker Compose; managed cloud | Reuse what is there; the PaaS handles TLS, env vars, deploy hooks |
| D10 | Storage | S3-compatible object storage in the EU (Hetzner Object Storage first choice; Scaleway or Cloudflare R2 acceptable) | MinIO on the VPS; VPS disk | Keeps the VPS small, cheap egress, easy backups and CDN |
| D11 | Email | Brevo (EU) for transactional email | Resend; Postmark; self-hosted SMTP | EU hosting, GDPR posture, free tier, marketing email later |
| D12 | Scope | Phased: MVP launch, then increments | Everything before launch | Real users in Luxembourg sooner; job board and ads automation follow |
| D13 | Roles | One role chosen at sign-up (client, photographer, professional); more roles can be added later on the same account | Fixed single role | A client may become a photographer; avoids duplicate accounts |
| D14 | Photographer verification | Country-specific document upload + manual admin review; Stripe Connect KYC handles identity and payouts separately | Stripe Identity; self-declaration | Luxembourg needs an autorisation d'établissement and VAT number check that only a human can judge at this stage |
| D15 | Chat | Self-hosted Socket.IO gateway in the API, Redis adapter, messages in PostgreSQL, attachments in object storage | Stream Chat; Sendbird | Full data control, no per-user fee |
| D16 | Admin backend | Separate Next.js app `apps/admin` on admin.photoo.lu, mandatory 2FA, RBAC | Route group inside the public web app | Separate origin and bundle shrink the attack surface |
| D17 | Analytics | GA4 through Google Tag Manager with Consent Mode v2 behind a self-built consent banner; Firebase Analytics on mobile behind explicit consent and iOS ATT | Third-party CMP | Full control of consent records, no vendor fee |
| D18 | Country model | `Country` configuration table (currency, VAT rate, required verification documents, legal texts). Luxembourg only enabled at launch | Hard-coded Luxembourg | "Luxembourg now, world later" without a rewrite |

## Open decisions (need Alex)

| # | Topic | Options | Needed by |
|---|-------|---------|-----------|
| O1 | External accounts | Which of Apple Developer, Google Play Console, Stripe, GA4/Ads/Search Console, Brevo, Hetzner, Hive/TinEye already exist | Phase 0 |
| O2 | Company entity | Which legal entity operates photoo.lu (needed for Stripe platform, App Store, DAC7 reporting, ToS) | Phase 0 |
| O3 | Auto-release delay | Days after delivery before escrow auto-releases (proposal: 7) | Phase 1, payments |
| O4 | AI detection vendor | Hive vs Sightengine for AI-generated detection; TinEye vs Google Vision Web Detection for reverse search | Phase 1, provenance |
| O5 | Brand / design | Logo, colours, typography for web, app and store listings | Phase 1, web design system |
