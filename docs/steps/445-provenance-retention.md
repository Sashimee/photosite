# #445 Provenance retention

Agents: api-developer (worker sweep), test-writer, compliance-reviewer.

`docs/steps/1A.10-provenance.md` (Retention) says a `ProvenanceCheck` is deleted with its `PortfolioImage`, and the `raw` vendor payload of a passed check is cleared after 90 days. Neither happens:

- A photographer deleting an image only sets `PortfolioImage.deletedAt`, so the `onDelete: Cascade` never fires. `raw`, `reverseMatches`, `exifCamera`, `exifCapturedAt`, the verdict and the admin note stay until the account is anonymised.
- No job clears `raw`.
- `docs/COMPLIANCE.md` still says "as long as the image is on the platform".

This must land before `PROVENANCE_ENABLED=true`. Today `raw` is always null.

## Tasks (api-developer, `fix/445-provenance-retention`)

1. **Worker sweep** `provenance-retention`, modelled on the existing sweeps in `apps/worker/src/gdpr/sweep/` (same scheduling, locking, logging and batch pattern):
   1. Delete `ProvenanceCheck` rows whose `PortfolioImage.deletedAt` is set, unless the image is still evidence for open moderation. That covers an open `Report` targeting the image or its profile, and an open dispute, if either model can reference it; check the schema. Rows that are kept are swept on a later run once the hold ends.
   2. Set `raw` to JSON null on checks with verdict `pass` whose `updatedAt` (or `createdAt` if `updatedAt` moves on review) is older than 90 days.
   3. Both run in bounded batches. Neither writes `AuditLog`, because this is retention and not moderation. Log only counts.
2. **No API or schema change.** The soft delete stays as it is, so a report filed shortly after deletion can still hold the evidence.
3. **Docs.** Change the `docs/COMPLIANCE.md` retention row to: "deleted once the image is deleted (held while an open report or dispute concerns it); a passed check's raw vendor payload is cleared after 90 days". Point `docs/steps/1A.10-provenance.md` Retention at the sweep.
4. **Tests.**
   - Unit tests for the selection logic.
   - Integration tests:
     - The check of a deleted image is removed.
     - A live image keeps its check.
     - A deleted image under an open report keeps its check.
     - `raw` of a pass older than 90 days is cleared.
     - `raw` of a newer pass, and of a `review` or `fail` check, is kept.
     - A second run is a no-op.

## Out of scope

#446 (provenance in the GDPR export) and its Art. 15(4) lawyer question.
