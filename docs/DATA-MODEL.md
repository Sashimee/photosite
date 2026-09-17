# Data model

Entity outline for the Prisma schema in `packages/db`. Field lists are the minimum; the schema-migrator agent adds timestamps (`createdAt`, `updatedAt`), soft-delete (`deletedAt`) where noted, and indexes.

## Identity and roles

- **User** – id, email (unique, citext), emailVerifiedAt, name (nullable display name, required by Better Auth, defaulted from the email local part at sign-up, editable later), locale, country, roles (`client`, `photographer`, `professional`, `admin` as a set), status (`active`, `suspended`, `deleted`), twoFactorEnabled, lastLoginAt, deletedAt.
- **Account** – OAuth links (provider, providerAccountId, tokens) – shape dictated by the auth library. The Argon2id password hash for email+password sign-in lives on the credential row (`providerId = 'credential'`, `accountId = user.id`) in `Account.password`, not on `User`, per D20 (Better Auth verifies logins against this row).
- **Session** – token hash, userId, device info, ip, expiresAt.
- **Verification** – Better Auth email verification / password reset tokens: identifier, value (hash, never the raw token), expiresAt.
- **TwoFactor** – Better Auth two-factor plugin: userId, secret and backupCodes encrypted at rest (AES-256-GCM, key from `AUTH_ENCRYPTION_KEY`), verified, failedVerificationCount, lockedUntil.
- **Device** – userId, expoPushToken, platform, lastSeenAt.
- **ConsentRecord** – userId or anonymousId, purpose (`analytics`, `ads`, `marketing`), granted, version of the policy, ip, userAgent, recordedAt. Append-only.

## Uploads

- **Upload** – ownerId (User), purpose (`UPLOAD_PURPOSES`: `portfolio`, `avatar`, `cover`, `chat_attachment`, `verification_document`, `delivery_file`), status (`pending_upload`, `uploaded`, `scanning`, `clean`, `infected`, `failed`, `processed`), mimeType, declaredSizeBytes, actualSizeBytes (nullable until the object is confirmed), width and height (nullable ints, set by the worker's `image-process` job once processed), objectKey (private bucket, unique), variants (JSON of public keys, populated once processed), exif (JSON, private), virusScanStatus mirroring shared `VIRUS_SCAN_STATUSES`, expiresAt. Generic upload record; `Attachment`, `VerificationDocument`, `PortfolioImage` and `Delivery` files reference an `Upload` by id once 1A.3b lands.

## Photographer

- **PhotographerProfile** – userId (1:1), slug (unique), displayName, headline, bio (per locale JSON), avatarUploadId and coverUploadId (nullable, reference `Upload` in place of raw keys), links (JSON: instagram, website, behance, other[]), categories[] (enum: wedding, portrait, event, product, real-estate, corporate, …), languages[], location (geography Point), serviceRadiusKm, city, countryCode, verificationStatus (`unverified`, `pending`, `verified`, `rejected`), stripeAccountId, stripeOnboardingComplete, stripePayoutsEnabled, ratingAvg, ratingCount, isPublished, deletedAt.
- **PortfolioImage** – profileId, uploadId (unique, references `Upload` in place of raw keys; `Upload.exif` and processed variants stay on the `Upload` row), width and height (copied from the `Upload` once processed), order, status (`processing`, `pending_review`, `approved`, `flagged`, `rejected`), deletedAt.
- **ProvenanceCheck** – portfolioImageId, aiScore, aiVendor, reverseMatches (JSON), c2paValid, exifCamera, exifCapturedAt, score, verdict (`pass`, `review`, `fail`), reviewedByAdminId, reviewedAt, note.
- **Product** – profileId, title (per locale JSON), description (per locale JSON, nullable), category, durationMinutes, deliverables (JSON), basePriceCents, currency, isActive, order, deletedAt.
- **ProductTier** – productId, usage (`personal`, `commercial`, `editorial`, `extended`), priceCents, description, licenceText version.
- **Availability** (Phase 3) – profileId, weekly rules, blocked dates.

## Verification

- **Country** – code (PK), name, enabled, currency, vatRate, requiredDocuments (JSON list: key, label per locale, description, accepted types), legalTexts (JSON), defaultLocale.
- **VerificationCase** – userId, countryCode, status (`draft`, `submitted`, `in_review`, `approved`, `rejected`, `expired`), businessName, vatNumber, businessRegistrationNumber, submittedAt, decidedAt, decidedByAdminId, rejectionReason.
- **VerificationDocument** – caseId, documentKey (from Country.requiredDocuments), storageKey (private bucket, server-side encrypted), mime, size, virusScanStatus, uploadedAt.

## Marketplace

- **Request** – clientId, title, category, description, eventDate, dateFlexible, location (geography Point), address (structured, visible only to the owning client and later the booked photographer), city and countryCode (copied out of `address` so the photographer feed can filter without reading it), budgetMinCents, budgetMaxCents, currency, usage (licence intent), status (`open`, `quoted`, `booked`, `closed`, `cancelled`), expiresAt (earlier of `eventDate` and `createdAt + 60 days`), deletedAt.
- **Quote** – requestId (nullable for direct product bookings; a quote always has a requestId or a productId), photographerId (references `PhotographerProfile`, not `User`, so a quote survives the photographer's profile identity changing shape), clientId, productId (nullable), productTierId (nullable; hard-deleted and recreated when a photographer edits their tiers, so this can go null on an existing quote), lineItems (JSON: label, qty, unitCents), subtotalCents, platformFeeCents, totalCents, feePercent (snapshot of `PlatformSetting('feePercent')` at creation time, so later fee changes never rewrite sent quotes), licenceUsage (snapshot of the licence usage the client agreed to — the request's `usage` for a request quote, the tier's `usage` for a direct quote — since `productTierId` can be nulled out later), licenceTextVersion (the tier's licence text version for a direct quote, null for a request quote), currency, validUntil, message, status (`draft`, `sent`, `accepted`, `declined`, `expired`, `withdrawn`).
- **Booking** – quoteId (1:1), clientId, photographerId, scheduledAt, location, status (state machine: `pending_payment`, `paid_held`, `in_progress`, `delivered`, `released`, `refunded`, `disputed`, `cancelled`), paymentIntentId, chargeId, transferId, releaseDueAt, deliveredAt, releasedAt, cancelledAt, cancellationReason.
- **Delivery** – bookingId, message, fileKeys (JSON) or external link, deliveredAt, acceptedAt.
- **Review** (Phase 3) – bookingId, authorId, targetId, rating, text, status.
- **Dispute** – bookingId, openedById, reason, status, resolution, adminId, amountRefundedCents.
- **LedgerEntry** – bookingId, type (`charge`, `platform_fee`, `transfer`, `refund`, `reversal`, `payout`), amountCents, currency, stripeObjectId, occurredAt. Append-only source of truth for reconciliation.

## Messaging

- **Conversation** – type (`request`, `quote`, `booking`, `direct`), subjectId (nullable; the id of the request/quote/booking the conversation is about, null for `direct`), lastMessageAt. Unique on `(type, subjectId)`, so creating the quote conversation twice for the same quote is a no-op at the database level. `request` and `direct` aren't creatable in the MVP (docs/steps/1A.6-chat.md); `booking` reuses the quote's conversation rather than creating a new row.
- **ConversationParticipant** – conversationId, userId, lastReadAt (nullable), archivedAt (nullable), joinedAt. Unique on `(conversationId, userId)`. Replaces `Conversation.participantIds[]`, `Conversation.archivedBy[]` and `Message.readBy`: membership, unread counts (`messages.createdAt > lastReadAt` and sender ≠ me) and archive state become indexed row lookups instead of JSON/array scans.
- **Message** – conversationId, senderId, body (nullable once soft-deleted; 1–4000 chars trimmed, plain text only), editedAt (always null in the MVP), deletedAt (soft delete by the sender within 15 minutes of sending; body is blanked, clients render "message deleted"). A message needs a body or at least one attachment.
- **MessageAttachment** – messageId, uploadId (references `Upload`, purpose `chat_attachment`; unique, since an upload attaches to at most one message). Replaces the standalone `Attachment` entity: an upload must be `clean` or `processed` before it can be attached, and the uploader must be the message's sender.

## Professionals and job board

- **ProfessionalProfile** – userId (1:1), companyName, website, vatNumber, logoKey, verified (manual flag).
- **JobOffer** – professionalId, title, description, category, location, remote, startDate, endDate, compensation (JSON), status (`draft`, `published`, `closed`, `expired`), listingId, publishedAt, expiresAt.
- **JobApplication** – jobOfferId, photographerId, message, portfolioLink, status.
- **Listing** – ownerId, kind (`job_offer`, `featured_profile`, …), plan (`free`, `paid`, `featured`), priceCents, paidAt, stripeCheckoutSessionId, expiresAt. Free at launch; paid plans switched on in Phase 3.

## Platform

- **Notification** – userId, type, payload (JSON), channels (email/push/in-app, chosen at creation after preferences), emailSentAt, pushSentAt (nullable, set by the worker's per-channel processor once delivered, so a retry never double-sends), readAt.
- **NotificationPreference** – userId, type, channel, enabled. Unique on `(userId, type, channel)`; a missing row means the type/channel defaults to on. `in_app` can't be disabled (enforced by the API, not the schema).
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
- `Upload.objectKey` and `Upload.exif` are never serialised to clients; only processed `variants` keys and status fields are.
- An `Upload` is only downloadable once `virusScanStatus = clean`.
- Uploads still `pending_upload` or `uploaded` past `expiresAt` are abandoned and removed by the worker's cleanup job.
- `Request.budgetMinCents <= budgetMaxCents` (CHECK constraint).
- `Quote.totalCents = subtotalCents` and both are non-negative, along with `platformFeeCents` (CHECK constraints); the platform fee is deducted from the photographer's payout at release, never added on top of what the client pays.
- At most one `sent` Quote per `(requestId, photographerId)` (partial unique index), so concurrent quote sends can't both win.
- `Quote.requestId IS NOT NULL OR Quote.productId IS NOT NULL` (CHECK constraint): every quote is either for a request or built from a product.
- The `notify-sweep` job's query (`channels` wants a channel AND that channel's sent-at is still null AND `createdAt` older than the sweep window) is served by a partial index on rows where `emailSentAt IS NULL OR pushSentAt IS NULL`, since that predicate is implied by the per-channel condition for either channel; the query still filters `channels` and the specific sent-at column, but only against the already-narrow set of undelivered rows.
- Deleting a `Conversation` cascades to its `ConversationParticipant` and `Message` rows; deleting a `Message` cascades to its `MessageAttachment` rows. `MessageAttachment.uploadId` is `Restrict`: an `Upload` still attached to a message can't be deleted.
- `Message.body IS NOT NULL OR EXISTS (attachments)` at creation time (application-enforced, not a CHECK constraint, since the attachment count is a join): a message needs a body or at least one attachment, capped at 10 attachments.
