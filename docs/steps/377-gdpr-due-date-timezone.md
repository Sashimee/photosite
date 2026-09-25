# 377 – GDPR response deadline in the country's timezone

Issue: #377. Agents: schema-migrator (Country.timezone), api-developer (shared helper + admin service), then test-writer. Reviews: code-reviewer, compliance-reviewer (Art. 12(3) deadline).

## Problem

`gdprResponseDueAt` in `packages/shared/src/contract/gdpr.ts` adds one calendar month in UTC. Around local midnight, and when the end-of-month clamp applies, the UTC result can land a day later than the same calculation in the user's local calendar. For example, a request at 2026-01-31 00:30 CET is 2026-01-30 23:30 UTC. The UTC deadline is then 2026-02-28 23:30 UTC, which is 2026-03-01 in Luxembourg. The local deadline is 2026-02-28 00:30 CET. The deadline we show must never be later than the legal one.

## Fix

- **Schema.** Add `Country.timezone` as a non-null IANA zone name, such as `Europe/Luxembourg`.
  - The migration backfills existing rows. LU gets `Europe/Luxembourg`.
  - The column has no lasting default. A new country has to state its zone.
  - The seed sets it for LU and backfills an existing row, the same way it already backfills `requiredDocuments`.
  - Update docs/DATA-MODEL.md.
  - The zone comes from the `Country` table and is never hardcoded (CLAUDE.md).
- **Helper.** The signature becomes `gdprResponseDueAt(requestedAt: Date, timeZone: string): Date`.
  - Do the calendar-month addition twice: once in UTC (the current logic) and once in the given zone's wall-clock time. The zone calculation uses `Intl.DateTimeFormat` with no new dependency and handles a DST gap or overlap.
  - Return the earlier of the two results.
  - An invalid zone throws. It must not fall back to UTC silently.
- **Callers.** In `apps/api/src/modules/admin/admin-data-requests.service.ts`, select `user.country.timezone` and pass it to every call.
  - Keep the contract descriptions in `packages/shared/src/contract/admin.ts` accurate. Regenerate openapi and api-client if the text changes.

## Tests

- **Shared unit:**
  - The existing UTC cases keep their results with `Europe/Luxembourg` wherever the two calculations agree.
  - Just after local midnight, where the local date differs from the UTC date:
    - 2026-03-01 00:30 CET gives the earlier of the two results.
    - 2026-01-31 00:30 CET gives 2026-02-28 00:30 CET, not the UTC result.
  - A DST transition inside the month.
  - A leap-year clamp.
  - An invalid zone throws.
  - The result is never later than the UTC calculation.
- **API integration:** `responseDueAt` and `answeredLate` use the user's country timezone.
