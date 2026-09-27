# #276 — Quote payout preview

Goal: before sending a quote, the photographer sees subtotal, platform fee and payout, all computed server-side. Must land before 1A.8c.

## Contract (packages/shared)

- `QuotePreviewRequestSchema`: `{ lineItems }`, strict, same `lineItems` validation as `CreateQuoteRequestSchema`.
- `QuotePreviewSchema`: `{ subtotal, platformFee, total }` as the existing money shape (integer cents + ISO currency). No `feePercent` in the response.
- Regenerate `packages/api-client/openapi.json` and `src/schema.ts`.

## API (apps/api, api-developer)

- `POST /v1/quotes/preview`, same guards and photographer checks as `POST /v1/quotes`, no persistence, no AuditLog (nothing mutates).
- Reuse `QuotesService.computeTotals()`; no new fee arithmetic, no cache on `PlatformSettingsService` (#193).
- Tests: happy path matches create's totals for the same line items; caller without a photographer profile 404 (matches create); zero total and over-max total 422 (same as create); invalid line items 400; nothing written.

## Web (apps/web, web-developer)

- `send-quote-dialog.tsx`: on entering the review step call the preview and render Total / Platform fee / Your payout, the same breakdown as the quote detail page. Loading and error states; send stays possible if the preview fails.
- No fee rate or fee arithmetic in the browser. Strings in `packages/i18n` (en source, drafts for fr/de/pt/es).

## Reviews

payments-engineer on the fee path, code-reviewer on the diff.
