# #394 Deletion cancel: stable 409 codes and web cancel page

Issue: #394 (compliance). Branch: `fix/394-deletion-cancel-codes`.

## Scope

1. API + contract: `POST /v1/me/data-requests/{id}/cancel` 409s carry stable codes
   - `NOT_DELETION`: the request is not a deletion request
   - `GRACE_PERIOD_ENDED`: pending, but the 30-day grace period is over
   - `NOT_PENDING`: already cancelled/completed/processing
   Documented in the contract path description (same pattern as `packages/shared/src/contract/admin.ts`), openapi + api-client regenerated.
2. Web: `apps/web/src/app/[locale]/account/deletion/cancel/[id]` reads `#token=` from the fragment (never sent to the server logs as a query), calls cancel (session if present, else token), shows a localised outcome per code (success, 401/invalid link, 404, each 409 code, generic).
3. Web: enable the deletion button in `account/danger-zone.tsx` (confirm dialog, `POST /v1/me/data-requests` with `type: 'delete'`, then sign-out/redirect as the soft-deleted account loses its session).

## Out of scope

- Mobile in-app deletion (Apple 5.1.1(v)): follow-up issue.

## Agents

api-developer (1), web-developer (2, 3), test-writer, check-runner, code-reviewer, compliance-reviewer + security-reviewer (token handling, personal data).
