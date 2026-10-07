# #630 Auto-publish photographer profiles

Decision D30. Agents: api-developer (helper, verification approval), payments-engineer (Stripe `account.updated`), test-writer.

## Problem

No path sets `PhotographerProfile.isPublished = true` except the seed and the restore after a cancelled deletion. Verified photographers with payouts enabled stay invisible, so requests, quotes and products to them are rejected.

## Change

1. `apps/api/src/common/publish/`: a helper `publishIfEligible(tx, profileId)` that sets `isPublished = true` and returns true only when all of these hold:
   - `PublishPolicy.canPublish(profile)`;
   - `profile.isPublished` is false and `profile.deletedAt` is null (not taken down);
   - the user is `active` and has the `photographer` role;
   - the user has no `pending` `delete` DataRequest.
2. `admin-verification.service.ts`: approval calls the helper inside its transaction; the approval `AuditLog` row records `isPublished` before and after.
3. `stripe-connect.service.ts` (payments-engineer): `account.updated` calls the helper when payouts become enabled; the existing `stripe_account.updated` audit row's `after.isPublished` reflects it.
4. Tests: unit tests for the helper's guards; service tests for both transitions, including when not eligible (unverified, payouts off, suspended, pending deletion, taken down, role removed) and idempotent repeats.

No schema, contract or client change.
