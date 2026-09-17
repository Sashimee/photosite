# Compliance: GDPR/RGPD, consent, analytics, platform obligations

photoo.lu is a Luxembourg platform (supervisory authority: CNPD). This document lists what the product must do; legal texts themselves come from a lawyer (Phase 0 human task).

## Roles and processors

- Controller: the operating entity (open decision O2).
- Processors with DPA to sign or accept: Stripe (payments, KYC), Brevo (email), Hetzner or chosen object storage (files), Sentry (errors), Google (GA4/GTM, Ads, Firebase, OAuth), Apple/Microsoft/Facebook (OAuth), AI-detection and reverse-search vendors (portfolio images), Expo (push), the VPS provider.
- Records of processing activities (RoPA) kept in `docs/legal/ropa.md` (created in Phase 2).

## Lawful bases

| Processing | Basis |
|-----------|-------|
| Account, bookings, chat, payments | contract |
| Photographer verification documents | legal obligation / legitimate interest (platform trust), retained only while the account is active + statutory period |
| Provenance checks on portfolio images (sending images to third-party APIs) | legitimate interest, disclosed in the photographer terms; DPIA required (automated assessment with admin review, so no solely automated decision) |
| Analytics (GA4), ads measurement | consent |
| Marketing email | consent (separate checkbox) |
| Fraud prevention, security logs | legitimate interest |

## Consent management

- Self-built consent banner in `apps/web` and consent screen in `apps/mobile`; categories: necessary (always on), analytics, ads/marketing.
- Web: Google Tag Manager loaded with **Consent Mode v2** defaults denied (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`); GA4 and Ads tags fire only after `update` to granted. Consent choice stored in a first-party cookie and, for logged-in users, in `ConsentRecord` with policy version.
- Mobile: Firebase Analytics disabled at start; enabled after consent; iOS App Tracking Transparency prompt shown only if ads attribution is used.
- Consent can be changed any time from the footer / settings; withdrawal stops tags immediately.
- GA4 configured with EU data settings, no Google Signals until reviewed, IP anonymisation is default in GA4.

## Data subject rights

- Self-service export (`DataRequest.type = export`): worker builds a zip (profile, requests, quotes, bookings, messages, consents) within 30 days, usually minutes; download link expires in 7 days.
- Self-service deletion: account soft-deleted immediately, PII anonymised after 30 days grace, except data that must be kept (invoices/ledger 10 years under Luxembourg accounting law, verification records as required, dispute records).
- Rectification through profile settings; admin can correct on request with audit log.

## Retention

| Data | Retention |
|------|-----------|
| Ledger, receipts, fee invoices | 10 years |
| Verification documents | account lifetime + 5 years, then deleted; encrypted at rest |
| Chat messages and attachments | account lifetime; deleted 90 days after account deletion |
| Provenance vendor results | as long as the image is on the platform |
| Server logs | 30 days |
| Consent records | 5 years after last update |
| Notifications (in-app/email/push records) | 12 months, deleted by the worker's `notifications-cleanup` job |

## Platform-specific obligations

- **DAC7**: yearly reporting of sellers' income to the Luxembourg tax authority; collect required seller identifiers in `VerificationCase`. Confirm scope with the accountant before launch.
- **Digital Services Act**: notice-and-action for illegal content (`Report` entity, admin queue), transparent terms, contact point. Small platform obligations apply from day one.
- **Consumer law**: clients are consumers; pre-contract information, right of withdrawal rules for services with a fixed date, complaint handling described in the ToS.
- **E-commerce law (Luxembourg)**: imprint/legal notice with company details on the site and app.
- **Cookie law (ePrivacy)**: covered by the consent banner above.

## Legal texts to publish (Phase 2, human)

Terms of service (clients), photographer agreement (including provenance checks and fee), professional job-board terms, privacy policy (per locale), cookie policy, imprint, DPIA record for provenance checks and verification documents.

## Analytics and Google Ads readiness (SEO lane)

- GTM container with GA4 configuration, conversion events: `sign_up`, `request_created`, `quote_sent`, `booking_paid` (value = subtotal), `profile_published`, `job_offer_published`.
- Google Ads conversion tags fed by GTM; enhanced conversions only after consent; offline conversion import from `booking_paid` via Ads API in Phase 3.
- Dynamic landing pages for ads: `/[locale]/photographers/[country]/[city]/[category]` with ISR, structured data and UTM-aware CTAs; sitemap includes them for Dynamic Search Ads page feeds.
