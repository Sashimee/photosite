# #375 – Export ready/failed emails and admin retry

Follow-up to 1A.12 (compliance review of #358). Agents: api-developer (shared, email, worker, api), web-developer (admin button), test-writer.

## Emails

- `packages/shared/src/queues.ts`: two new `EmailJobSchema` members.
  - `data-export-ready` with `{to, url, expiresAt}`. `expiresAt` is an ISO datetime.
  - `data-export-failed` with `{to, url}`.
  - `url` is `${WEB_APP_URL}/account`. The web export UI there is tracked in #399.
  - Like the other members, they carry no locale and render in `en` for now.
- `packages/i18n/messages/en.json`: add `email.dataExportReady.{subject,body}` (body takes `{url}` and `{expiresAt}`, formatted for `Europe/Luxembourg`) and `email.dataExportFailed.{subject,body}`. Both subjects carry `{appName}` like their sibling auth emails. The failed-export body asks the user to contact support, who can retry it for them — it never claims the team has already been notified (nothing does that automatically) or tells the user to retry it themselves, because the GDPR export rate limit is 24h and a self-service retry would usually just get blocked. fr/de/pt/es stay empty until step 2.3 (docs/steps/0.10), falling back to en.
- `packages/email`: add render cases next to `account-deletion-requested` and preview fixtures. `EMAIL_TEMPLATE_NAMES` in `packages/shared/src/contract/admin.ts` gains both names, because the type assertion there requires it.
- Worker:
  - `queue-workers.service.ts` creates a `Queue(EMAIL_QUEUE_NAME)` producer and passes it to `createGdprExportProcessor`, together with `webAppUrl`.
  - The processor loads the user's email and enqueues the job after the `ready` update, and after the final-attempt `failed` update. The stuck-export sweep (`fail-stuck-exports.ts`) shares the same `notifyExportFailed` helper and emails every user it actually transitions to `failed` (guarded by the `updateMany` count, so a row already moved by something else is skipped).
  - `jobId` is deterministic (`data-export-ready-<id>`, `data-export-failed-<id>`, hyphen not colon — BullMQ 6.3.8 rejects `:` in custom jobIds), so BullMQ refuses a second enqueue while the first is still waiting, active or failed-and-retained. Both email jobs use `removeOnComplete: true`, so once one has actually sent, the jobId is free again — a later re-run of the export job for the same `dataRequestId` (e.g. a stalled-job requeue after the archive already finished) can mail the user a second time; the dedup only protects against piling up duplicate *pending* sends, not against re-running the export job after success.
  - `findNotifiableUserEmail` skips soft-deleted users (`deletedAt` set) at enqueue time only. The email queue's own processor (`email.processor.ts`) does not hold a Prisma connection and does not re-check `deletedAt`/user status when it actually sends — if a user is deleted in the window between enqueue and send, the already-queued email still goes out.
  - Enqueue happens rather than an inline send, because a retry returns early on `ready` and would lose a failed inline send.

## Admin retry

- Contract: `POST /v1/admin/data-requests/{id}/retry-export` → `201` with `AdminDataRequest` (the new row).
  - `404` if the id is unknown.
  - `409` with a distinct `code`, one of:
    - `EXPORT_NOT_FAILED` — the source is not a `failed` export.
    - `USER_SUSPENDED` / `USER_DELETED` — the source's owning user is not `active` (still in the GDPR grace period, suspended, or already anonymised).
    - `EXPORT_ALREADY_RETRIED` — this exact source has already been retried once (found via its `data_request.export_retried` audit row), so a source can only ever fan out to one retry.
    - `EXPORT_OPEN` — the user already has a pending or processing export (also the race-losing branch of a concurrent retry, caught via the `DataRequest_userId_type_open_key` partial unique index).
    - `EXPORT_ALREADY_ANSWERED` — the user already holds an unexpired `ready` export, or completed a later export, that answers the source request.
- API: `AdminDataRequestsService.retryExport(admin, id, ip)`.
  - It looks up the source export's owning user status via `repository.findUserStatus` (kept off the public DTO select so status never leaks) and rejects retries for anything but an `active` user; the status is re-read inside the transaction that creates the retry row, so a status change landing between the pre-check and the write still gets caught.
  - In one transaction it creates a new `export` DataRequest for the source's user.
  - It writes `AuditLog` `data_request.export_retried` with actorType `admin`, the target being the new row, `before: {sourceId}` and `after: {status: 'pending', userId}`.
  - After commit it enqueues the export job. If the enqueue throws, the newly-created row is marked `failed`/`enqueue_failed` via a guarded `updateMany` (only if it's still `pending`), an `AuditLog` `data_request.export_failed` row is written for it, and only then is the error rethrown — so it doesn't get stuck showing `pending` with no job behind it and no audit trail.
  - The per-user rate limit is bypassed because this is a support action.
- Regenerate `openapi.json` and the api-client.
- Admin UI: a **Retry export** button on `failed` export rows in the data-requests table, with a confirm step. On success the list refreshes.

## Tests

- Processor:
  - ready enqueues one email with `expiresAt`
  - the final failure enqueues a failed email
  - a non-final failure sends none
  - a deleted user gets none
- Email render tests for both types, plus the queue schema tests.
- Retry service/integration: 201 plus the audit row (including `userId` in `after`), 404, 409 `EXPORT_NOT_FAILED` for a non-failed source, 409 `USER_SUSPENDED` and `USER_DELETED`, 409 `EXPORT_ALREADY_RETRIED` for a second retry of the same source, 409 `EXPORT_OPEN` when one is already open (including the concurrent-retry race via the unique index), 409 `EXPORT_ALREADY_ANSWERED` when a later export already answered the request, the enqueue-failure path marking the row `failed` and writing its audit row before rethrowing, 403 for a non-admin.
- Admin button test.
