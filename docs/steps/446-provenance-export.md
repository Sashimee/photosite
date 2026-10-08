# #446 Provenance in the GDPR export

Agents: api-developer (worker export), test-writer, compliance-reviewer.

The Art. 15 self-service export leaves provenance out entirely. `PortfolioImageExportRow` (`apps/worker/src/gdpr/export/collect.ts`) has no provenance field, so a photographer's export doesn't show what the API already shows them: the verdict, when the check ran, and the statement of reasons for a rejection.

## Scope

Export exactly what the photographer already sees through `PortfolioImageProvenanceSchema` (`packages/shared/src/contract/provenance.ts`), plus `reviewedAt`. That timestamp tells the subject whether a human reviewed the automated result, which matters for Art. 22.

- `provenance: { verdict, checkedAt (createdAt), reviewedAt, decisionReason, decisionReasonText } | null` on each `PortfolioImageExportRow`.
- **Still withheld:** `score`, `aiScore`, `aiVendor`, `reverseMatches`, `c2paValid`, `exifCamera`, `exifCapturedAt`, `note`, `reviewedByAdminId` and `raw`. Whether Art. 15(4) and anti-evasion allow withholding them is the open lawyer question in `docs/steps/human-followups.md` ("Art. 15(4)"). The comment above `collectExportData` should say which provenance fields are exported and which are withheld pending that answer.
- The export README (`readme.ts`), if it describes the portfolio file, mentions the provenance field in one line.

No schema, contract or API change.

## Tasks (api-developer, `fix/446-provenance-export`)

1. Select the fields above in the portfolio query in `collect.ts`, and map them with ISO dates, matching the rest of that row.
2. Update the comment and the README line.
3. Tests:
   - Unit or integration, matching the existing export tests: an image with a check exports the five fields.
   - None of the withheld fields appears anywhere in the row, which guards against a future `select` widening.
   - An image without a check exports `provenance: null`.
4. Update `docs/COMPLIANCE.md`, wherever it describes export contents, to list provenance (verdict, decision and reasons; scores, vendors and matches withheld pending the lawyer).
