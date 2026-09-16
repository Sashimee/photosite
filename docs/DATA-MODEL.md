# Data model

Entity outline for the Prisma schema in `packages/db`. Field lists are the minimum; the schema-migrator agent adds timestamps (`createdAt`, `updatedAt`), soft-delete (`deletedAt`) where noted, and indexes.

## Identity and roles

- **User** – id, email (unique, citext), emailVerifiedAt, locale, country, roles (`client`, `photographer`, `professional`, `admin` as a set), status (`active`, `suspended`, `deleted`), twoFactorEnabled, lastLoginAt, deletedAt.
- **Account** – OAuth links (provider, providerAccountId, tokens) – shape dictated by the auth library. The Argon2id password hash for email+password sign-in lives on the credential row (`providerId = 'credential'`, `accountId = user.id`) in `Account.password`, not on `User`, per D20 (Better Auth verifies logins against this row).
- **Session** – token hash, userId, device info, ip, expiresAt.
- **Device** – userId, expoPushToken, platform, lastSeenAt.
- **ConsentRecord** – userId or anonymousId, purpose (`analytics`, `ads`, `marketing`), granted, version of the policy, ip, userAgent, recordedAt. Append-only.

## Photographer

- **PhotographerProfile** – userId (1:1), slug (unique), displayName, headline, bio (per locale JSON), avatarKey, coverKey, links (JSON: instagram, website, behance, other[]), categories[] (enum: wedding, portrait, event, product, real-estate, corporate, …), languages[], location (geography Point), serviceRadiusKm, city, countryCode, verificationStatus (`unverified`, `pending`, `verified`, `rejected`), stripeAccountId, stripeOnboardingComplete, stripePayoutsEnabled, ratingAvg, ratingCount, isPublished, deletedAt.
- **PortfolioImage** – profileId, originalKey, variants (JSON), width, height, exif (JSON, private), c2paManifest (JSON, nullable), order, status (`processing`, `pending_review`, `approved`, `flagged`, `rejected`), deletedAt.
- **ProvenanceCheck** – portfolioImageId, aiScore, aiVendor, reverseMatches (JSON), c2paValid, exifCamera, exifCapturedAt, score, verdict (`pass`, `review`, `fail`), reviewedByAdminId, reviewedAt, note.
- **Product** – profileId, title (per locale), description, category, durationMinutes, deliverables (JSON), basePriceCents, currency, isActive, order.
- **ProductTier** – productId, usage (`personal`, `commercial`, `editorial`, `extended`), priceCents, description, licenceText version.
- **Availability** (Phase 3) – profileId, weekly rules, blocked dates.

## Verification

- **Country** – code (PK), name, enabled, currency, vatRate, requiredDocuments (JSON list: key, label per locale, description, accepted types), legalTexts (JSON), defaultLocale.
- **VerificationCase** – userId, countryCode, status (`draft`, `submitted`, `in_review`, `approved`, `rejected`, `expired`), businessName, vatNumber, businessRegistrationNumber, submittedAt, decidedAt, decidedByAdminId, rejectionReason.
- **VerificationDocument** – caseId, documentKey (from Country.requiredDocuments), storageKey (private bucket, server-side encrypted), mime, size, virusScanStatus, uploadedAt.

## Marketplace

- **Request** – clientId, title, category, description, eventDate, dateFlexible, location (geography Point), address (structured), budgetMinCents, budgetMaxCents, currency, usage (licence intent), status (`open`, `quoted`, `booked`, `closed`, `cancelled`), expiresAt, deletedAt.
- **Quote** – requestId (nullable for direct product bookings), photographerId, clientId, productId (nullable), productTierId (nullable), lineItems (JSON: label, qty, unitCents), subtotalCents, platformFeeCents, totalCents, currency, validUntil, message, status (`draft`, `sent`, `accepted`, `declined`, `expired`, `withdrawn`).
- **Booking** – quoteId (1:1), clientId, photographerId, scheduledAt, location, status (state machine: `pending_payment`, `paid_held`, `in_progress`, `delivered`, `released`, `refunded`, `disputed`, `cancelled`), paymentIntentId, chargeId, transferId, releaseDueAt, deliveredAt, releasedAt, cancelledAt, cancellationReason.
- **Delivery** – bookingId, message, fileKeys (JSON) or external link, deliveredAt, acceptedAt.
- **Review** (Phase 3) – bookingId, authorId, targetId, rating, text, status.
- **Dispute** – bookingId, openedById, reason, status, resolution, adminId, amountRefundedCents.
- **LedgerEntry** – bookingId, type (`charge`, `platform_fee`, `transfer`, `refund`, `reversal`, `payout`), amountCents, currency, stripeObjectId, occurredAt. Append-only source of truth for reconciliation.

## Messaging

- **Conversation** – type (`request`, `quote`, `booking`, `direct`), subjectId, participantIds[], lastMessageAt, archivedBy[].
- **Message** – conversationId, senderId, body, attachments (JSON of `Attachment` ids), readBy (JSON), editedAt, deletedAt.
- **Attachment** – uploaderId, storageKey, mime, size, virusScanStatus, kind (`image`, `pdf`, `other`).

## Professionals and job board

- **ProfessionalProfile** – userId (1:1), companyName, website, vatNumber, logoKey, verified (manual flag).
- **JobOffer** – professionalId, title, description, category, location, remote, startDate, endDate, compensation (JSON), status (`draft`, `published`, `closed`, `expired`), listingId, publishedAt, expiresAt.
- **JobApplication** – jobOfferId, photographerId, message, portfolioLink, status.
- **Listing** – ownerId, kind (`job_offer`, `featured_profile`, …), plan (`free`, `paid`, `featured`), priceCents, paidAt, stripeCheckoutSessionId, expiresAt. Free at launch; paid plans switched on in Phase 3.

## Platform

- **Notification** – userId, type, payload (JSON), channels sent (email/push/in-app), readAt.
- **Report** – reporterId, targetType, targetId, reason, status, adminId, resolution.
- **AuditLog** – actorId (user or admin or system), action, targetType, targetId, before (JSON), after (JSON), ip, occurredAt. Append-only.
- **PlatformSetting** – key, value (JSON), updatedByAdminId. Holds fee percentage (default 5), auto-release days, feature flags.
- **DataRequest** – userId, type (`export`, `delete`), status, requestedAt, completedAt, exportKey.

## Key invariants

- `Quote.platformFeeCents = round(subtotalCents * feePercent / 100)` computed by `packages/shared` fee helper, never by clients.
- A `Booking` only moves to `released` through the worker's release job after `Delivery.acceptedAt` is set or `releaseDueAt` passes.
- `PortfolioImage.status = approved` is required before an image appears on a public profile.
- `PhotographerProfile.isPublished` requires `verificationStatus = verified` and `stripePayoutsEnabled = true`.
- All money fields are integer cents plus an ISO currency code.
