# #378 – Log GDPR requests received off-platform

Follow-up to 1A.12 (compliance review of #358). A data subject can exercise their rights by email or through support, not only in-app. Such requests still have to meet the one-month deadline, so support must be able to record them as `DataRequest` rows that show up in the admin list with a `responseDueAt`. Agents:

- schema-migrator: the channel column.
- api-developer: contract and API.
- web-developer: the admin dialog.
- test-writer: the tests.

## Schema

- Add `enum DataRequestChannel { in_app email support }` and `DataRequest.channel DataRequestChannel @default(in_app)`.
  - Existing rows backfill to `in_app`. No index is needed.
- Add `DataRequest.receivedAt DateTime @default(now())`: when the data subject made the request. Existing rows backfill to `requestedAt`. It drives the Art. 12(3) deadline only (#416).
- Update `docs/DATA-MODEL.md` to match.

## Contract

- `packages/shared/src/contract/gdpr.ts`:
  - add `DATA_REQUEST_CHANNELS`;
  - add `channel` to `DataRequestSchema`, so both the user and admin DTOs carry it.
- `packages/shared/src/contract/admin.ts`:
  - add `channel` as an optional filter on `AdminDataRequestsQuerySchema`;
  - add `AdminLogDataRequestBodySchema` = `{ userId: uuid, type: 'export'|'delete', channel: 'email'|'support', receivedAt: ISO datetime }`.
    - `in_app` is rejected, because an in-app request is created by the user.
- New path: `POST /v1/admin/data-requests`, with `adminOperation('support')`.
  - `201` returns the created `AdminDataRequest`.
  - `400` if the body is invalid, or `receivedAt` is in the future (1 min clock skew allowed), or more than 30 days in the past. An older request is already overdue and needs a human, not a backdated row.
  - `404` if the user id is unknown.
  - `409`, with a distinct `code`, if one of these holds:
    - `EXPORT_OPEN` or `DELETE_OPEN`: an open request of that type already exists. This is also the race-losing branch, via the `DataRequest_userId_type_open_key` partial unique index.
    - `USER_SUSPENDED` or `USER_DELETED`: the user is not `active`.
    - `BLOCKING_OBLIGATIONS`: a delete is blocked by the same obligations as self-service, from `assertNoBlockingObligations`.
- Regenerate `openapi.json` and the api-client.

## API

The endpoint lives on `AdminDataRequestsController` and follows the `retry-export` pattern:

1. `requirePermission(request, 'support')`.
2. The admin mutation rate limit.
3. `AdminDataRequestsService.logOffline(admin, body, ip)`.

`requestedAt` is always the server's `now()` when the row is logged. `receivedAt` stores the body's value, and `responseDueAt` is computed as `gdprResponseDueAt(receivedAt, country.timezone)`, so the deadline counts from receipt. Self-service rows set both to `now()`. `requestedAt` must never be backdated. The deletion sweep counts the grace period from it, and decision 1A.12 says the grace period is never shortened (#416).

Guards (#417, security review):

- Refuse a target that is the actor, with 403 `PROTECTED_TARGET`; this never has an exception, not even for a superadmin with 2FA. A target that has the admin role or holds any `AdminPermissionGrant` is refused the same way, but a superadmin actor with fresh 2FA may act on that target. Both checks run again inside the export/delete transaction against a fresh read of the target, so a role or grant change landing between the pre-check and the write can't slip through.
- The delete route requires fresh 2FA, enforced in the controller as `requirePermission(request, 'support', { requires2fa: body.type === 'delete' })`. Since the requirement depends on the request body, there's no per-route `x-requires-2fa` contract flag for it — the route description in `admin.ts` documents the behaviour in prose instead. The admin API client already redirects to reverify on a 403 `TWO_FACTOR_REQUIRED`. The delete path also uses a stricter per-admin rate limit than the other admin mutations.
- `assertNoBlockingObligations` runs inside the deletion transaction. A CONFLICT from the unique index is re-mapped to the open-request or user-status code.
- Post-commit side effects (email, socket disconnect) are caught and logged. They don't turn a committed deletion into a 500.

- **Export.**
  1. In one transaction, re-check that the user is `active`.
  2. Create the row as `pending` with the given channel.
  3. Write `AuditLog` `data_request.logged_offline` with actorType `admin`, the target being the row, and `after: {type, channel, receivedAt, userId}`.
  4. After commit, enqueue the export job. If the enqueue fails, handle it exactly like `retryExport` does: mark the row `failed`/`enqueue_failed`, write the audit row, then rethrow.
  5. The per-user 24h export limit is bypassed, because this is a support action.
- **Delete.** This must apply the same immediate effects as the self-service delete. The worker sweep (`apps/worker/src/gdpr/sweep/anonymise-deletions.ts`) anonymises every `pending` delete row whose `requestedAt` is past the 30-day grace period. A "tracked only" row would therefore anonymise an account that was never soft-deleted, and the grace period would never have been visible to the user.
  - Extract the deletion transaction body from `DataRequestsService.createDeletion` into a shared helper in `apps/api/src/modules/gdpr/`. The helper covers:
    - user → `deleted`;
    - revoking sessions and devices;
    - unpublishing the profile;
    - cancelling or withdrawing requests, quotes, job offers and applications.
  - Self-service and admin both call that helper. The admin path writes `data_request.logged_offline` instead of `data_request.deletion_requested`, with the same `before`/`after` shape plus `channel` and `receivedAt`.
  - After commit, the admin path also disconnects the chat socket and sends the deletion email, as self-service does.
  - The grace period runs a full 30 days from logging, so the email's "30 days to cancel" stays true. Whether a soft-delete answers the request within one month is a question for the lawyer (#411).
- **responseDueAt for deletes.** It stays `null` for delete rows. The deletion takes effect when the row is logged, so the request is answered at creation. The one-month limit on anonymisation is enforced by the sweep, not by a support deadline.

## Admin UI

- A **Log request** button on the data-requests page opens a dialog with the following fields:
  - user: the user id, pasted from the users page;
  - type;
  - channel;
  - received at: date and time, defaulting to now.
- After the user id is entered, the dialog looks up the account and shows its masked email and name (#418). A delete needs an explicit second confirm step styled as destructive. Its warning says the account is closed now, the user is emailed a cancel link, and the account is anonymised after 30 days.
- The `received at` input is bounded by `min` (now − 30 days) and `max` (now), in the admin's local timezone, and is sent as UTC.
- `TWO_FACTOR_REQUIRED` gets its own message and is not swallowed. `BLOCKING_OBLIGATIONS` shows one message per `details.reason`. The loggable channels are derived from `DATA_REQUEST_CHANNELS`.
- Each 409 `code` is mapped to its own message, and the list refreshes on success.
- A **Channel** column and filter are added to the table.
- All strings live in `packages/i18n` (en).

## Needs Alex / the lawyer

Support must verify the requester's identity before logging a request, above all a delete. The verification procedure is a legal and process question. It goes in `docs/steps/human-followups.md`, and the code does not enforce it.

## Tests

- **Contract:** the body schema accepts and rejects the right channels and `receivedAt` bounds.
- **API integration, export:**
  - the created row, its AuditLog, the enqueue, and `responseDueAt` counted from `receivedAt`;
  - a 409 for each code, a 404 for an unknown user, and a 403 without the `support` permission;
  - a failed enqueue marks the row failed.
- **API integration, delete:**
  - the user is soft-deleted and the sessions are gone;
  - the AuditLog records the channel;
  - the self-service delete still behaves the same, as a regression check.
- **Admin UI:** the dialog validates, submits, maps errors, and shows the delete warning; the table renders the channel.
