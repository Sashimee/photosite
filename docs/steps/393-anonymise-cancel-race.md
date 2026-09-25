# 393 – GDPR sweep vs. deletion-cancel race

Issue: #393. Agent: api-developer (worker), then test-writer. Reviews: code-reviewer, compliance-reviewer (personal data).

## Problem

`anonymiseOne` in `apps/worker/src/gdpr/sweep/anonymise-deletions.ts` marks the DataRequest `completed` without re-checking its status. A cancel that commits between the sweep's `findMany` and its transaction leaves the user active, but the sweep still anonymises them and overwrites `cancelled` with `completed`.

## Fix

- The first statement in the sweep transaction is a guarded claim: `tx.dataRequest.updateMany({ where: { id, status: 'pending', requestedAt: { lte: cutoff } }, data: { status: 'completed', completedAt, failureReason: null } })`.
- On `count === 0`, return without anonymising, deleting storage or writing the audit record.
- `cutoff` is computed once in `anonymiseDeletions` and passed in.
- The trailing unconditional `update` goes away.
- A skipped request counts as neither anonymised nor failed. It gets a separate `usersSkipped` count in the sweep result, if the result shape allows it.
- Postgres row locks plus the re-check under READ COMMITTED serialise this against the API cancel, which uses the mirror guard `requestedAt > cutoff`.

## Tests

- **Unit:** the claim returns count 0, so nothing is anonymised, no storage is deleted and no audit record is written.
- **Integration:** the request is cancelled after `findMany`. Simulate this by flipping the status before the sweep runs. The user stays active and the status stays `cancelled`.
- **Integration:** the happy path still completes.
