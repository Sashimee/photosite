# #375 – Export ready/failed emails and admin retry

Follow-up to 1A.12 (compliance review of #358). Agents: api-developer (shared, email, worker, api), web-developer (admin button), test-writer.

## Emails

- `packages/shared/src/queues.ts`: two new `EmailJobSchema` members.
  - `data-export-ready` with `{to, url, expiresAt}`. `expiresAt` is an ISO datetime.
  - `data-export-failed` with `{to, url}`.
  - `url` is `${WEB_APP_URL}/account`. The web export UI there is tracked in #399.
  - Like the other members, they carry no locale and render in `en` for now.
- `packages/i18n/messages/en.json`: add `email.dataExportReady.{subject,body}` (body takes `{url}` and `{expiresAt}`) and `email.dataExportFailed.{subject,body}`. fr/de/pt/es stay empty until step 2.3 (docs/steps/0.10), falling back to en.
- `packages/email`: add render cases next to `account-deletion-requested` and preview fixtures. `EMAIL_TEMPLATE_NAMES` in `packages/shared/src/contract/admin.ts` gains both names, because the type assertion there requires it.
- Worker:
  - `queue-workers.service.ts` creates a `Queue(EMAIL_QUEUE_NAME)` producer and passes it to `createGdprExportProcessor`, together with `webAppUrl`.
  - The processor loads the user's email and enqueues the job after the `ready` update, and after the final-attempt `failed` update.
  - `jobId` is deterministic (`data-export-ready:<id>`, `data-export-failed:<id>`), so a retried job never mails twice.
  - A soft-deleted or anonymised user gets no email.
  - Enqueue happens rather than an inline send, because a retry returns early on `ready` and would lose a failed inline send.

## Admin retry

- Contract: `POST /v1/admin/data-requests/{id}/retry-export` → `201` with `AdminDataRequest` (the new row).
  - `404` if the id is unknown.
  - `409` if the source is not a `failed` export, or if the user already has a pending/processing export.
- API: `AdminDataRequestsService.retryExport(adminId, id)`.
  - In one transaction it creates a new `export` DataRequest for the source's user.
  - It writes `AuditLog` `data_request.export_retried` with actorType `admin`, the target being the new row and `before: {sourceId}`.
  - After commit it enqueues the export job.
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
- Retry service/integration: 201 plus the audit row, 404, 409 for a non-failed source, 409 when one is already open, 403 for a non-admin.
- Admin button test.
