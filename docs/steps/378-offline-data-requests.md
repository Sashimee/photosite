# #378 – Log GDPR requests received off-platform

Follow-up to 1A.12 (compliance review of #358). A data subject can exercise their rights by email or through support, not only in-app. Such requests still have to meet the one-month deadline, so support must be able to record them as `DataRequest` rows that show up in the admin list with a `responseDueAt`. Agents:

- schema-migrator: the channel column.
- api-developer: contract and API.
- web-developer: the admin dialog.
- test-writer: the tests.

## Schema

- Add `enum DataRequestChannel { in_app email support }` and `DataRequest.channel DataRequestChannel @default(in_app)`.
  - Existing rows backfill to `in_app`. No index is needed.
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

`requestedAt` is set to `receivedAt`, so the existing `responseDueAt` (`gdprResponseDueAt(requestedAt, country.timezone)`) counts from the moment the request was received, not from the moment it was logged.

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
  - Because `requestedAt` is the received-at time, the grace period (and so anonymisation) ends one month after receipt. That matches the legal deadline.
- **responseDueAt for deletes.** It stays `null` for delete rows. The deletion takes effect when the row is logged, so the request is answered at creation. The one-month limit on anonymisation is enforced by the sweep, not by a support deadline.

## Admin UI

- A **Log request** button on the data-requests page opens a dialog with the following fields:
  - user: the user id, pasted from the users page;
  - type;
  - channel;
  - received at: date and time, defaulting to now.
- The dialog confirms before submitting. A delete also shows a warning that the account is deleted immediately.
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
