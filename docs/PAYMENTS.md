# Payments

Stripe Connect design for photoo.lu. Platform fee: 5 % of the quote subtotal (configurable in `PlatformSetting.feePercent`).

## Accounts

- Platform Stripe account owned by the operating entity (open decision O2 in `DECISIONS.md`).
- Each photographer gets a **Connect Express** account created during onboarding (`stripe.accounts.create({ type: 'express', country, capabilities: card_payments + transfers })`) and completes Stripe-hosted onboarding (`accountLinks`). Stripe runs KYC and handles payouts to the photographer's bank.
- `PhotographerProfile.stripePayoutsEnabled` mirrors the `account.updated` webhook; a profile cannot be published without it.

## Booking money flow (separate charges and transfers)

1. **Quote accepted** – API creates a `PaymentIntent` on the platform account for `totalCents` with `transfer_group = booking_<id>`, `metadata.bookingId`, automatic payment methods (cards, Apple Pay, Google Pay, Bancontact, SEPA later). Web uses Stripe Elements Payment Element, mobile uses the Stripe React Native PaymentSheet. Booking status `pending_payment`.
2. **payment_intent.succeeded** webhook – booking becomes `paid_held`; `LedgerEntry(charge)` written; client and photographer notified; funds sit on the platform balance.
3. **Delivery** – photographer marks delivered (`delivered`); `releaseDueAt = now + autoReleaseDays` (proposal 7 days, open decision O3).
4. **Release** – client accepts, or the worker's release job fires at `releaseDueAt`. API creates a `Transfer` to the connected account for `subtotalCents - platformFeeCents` with `source_transaction = chargeId` and the same `transfer_group`. `LedgerEntry(transfer)` + `LedgerEntry(platform_fee)`. Booking `released`.
5. **Refunds**
   - *Before release* – full or partial `refunds.create` against the PaymentIntent, from the platform balance only (the connected account is never touched); `LedgerEntry(refund)`; a full refund moves the booking to `refunded`.
   - *After release* – admin app only, `finance` permission plus a fresh 2FA check (`POST /v1/admin/bookings/{id}/refund`). One call does both steps: it first reverses the same amount from the photographer's transfer (`transfers.createReversal`, `LedgerEntry(reversal)`, audit `booking.refund_reversal` with the admin's reason), then refunds the client (`LedgerEntry(refund)`, audit `booking.admin_refund`). The amount is capped at `min(total − refunded, transferred − reversed)`, so a refund after release can never exceed what is left on the transfer (422 before any Stripe call otherwise). If the refund fails after the reversal, a retry with the same amount resumes with the refund instead of reversing twice. The booking becomes `refunded` once the transfer is fully reversed or the client fully refunded.
   - *Standalone transfer reversal* – `POST /v1/admin/bookings/{id}/reverse-transfer`, same permission and 2FA, for chargeback recovery: after a lost dispute the client's money is already gone, so the platform pulls whatever is left on the transfer back from the photographer without refunding anyone. Allowed on `released` bookings and on `disputed` ones that were released; the booking keeps its status.
   - Both admin calls take the ledger sum the admin saw (`expectedRefundedCents` / `expectedReversedCents`) and answer 409 `LEDGER_CHANGED` before any Stripe call when it has moved. The admin detail view returns `refundableCents` / `reversibleCents` computed by the API from the ledger; the admin app does no money maths.
   - Other 409s on the admin calls carry a distinct code: `BOOKING_BUSY` while another refund, reversal or the release holds the booking's money lock (retry shortly; the client refund path answers the same code), `BOOKING_STATE` with `details.status` when the booking's state does not allow the action, and `PENDING_REVERSAL_MISMATCH` with `details.pendingCents` when a reversal is waiting for its refund and the admin asked for a different amount (retrying with `pendingCents` completes it).
   - Refund, reverse-transfer and the bookings export share a per-admin money budget, `admin:mutation:money`, of 5 requests per 10 minutes, on top of the general admin mutation limit; past it the API answers 429 `TOO_MANY_REQUESTS` with `details.retryAfterSeconds`.
   - *Export* – `GET /v1/admin/bookings/export.csv` takes the list filters (`status`, `createdFrom`/`createdTo`, `dispute`), needs `finance` plus a fresh 2FA check and writes one `admin.bookings_exported` audit row (filters and cap, no row data) before streaming. Rows are read in keyset batches of 500 in list order, ids only, money as decimal major units; at most 50 000 rows, and a capped file ends with a `#truncated` line. Every cell is quoted and formula-leading cells are prefixed with `'`.
6. **Payouts** – Stripe pays the connected account on its default schedule; the platform never touches bank details.

Why separate charges and transfers instead of destination charges: funds must be holdable until delivery, refunds before release must not touch the photographer's balance, and one booking may later split between several photographers.

Constraints to respect:
- Transfers with `source_transaction` must happen within Stripe's window for the charge; the auto-release job guarantees release well within it. If a dispute keeps a booking open longer, the admin resolves it manually.
- Currency at launch: EUR only. `Country.currency` drives future currencies; cross-currency transfers are out of scope until Phase 3.
- Stripe Radar rules enabled; 3-D Secure enforced by automatic payment methods.

## Webhooks

Endpoint `POST /v1/stripe/webhook` in the API, signature verified, idempotent by `event.id` (stored in `StripeEvent` table), processed inline for state changes and enqueued for side effects (email, push). Events handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `transfer.created`, `transfer.reversed`, `account.updated`, `payout.paid`, `payout.failed`, `checkout.session.completed` (listings, Phase 3).

## Fees, tax and invoices

- The platform fee is the platform's revenue; VAT on the fee for Luxembourg photographers (17 %) is a question for the accountant (open decision O2). The fee helper in `packages/shared` supports a VAT-on-fee flag.
- The photographer is the seller of the service; the platform generates a **booking receipt** for the client and a **fee invoice** for the photographer (PDF via the worker, stored in object storage). Photographers' own invoicing obligations remain theirs; the receipt states this.
- **DAC7**: as an EU platform operator paying sellers, photoo.lu must collect seller data (name, address, TIN/VAT, bank identifier via Stripe) and report yearly. The `VerificationCase` captures the fields; a yearly export job is planned in Phase 3. Confirm applicability with the accountant before launch.

## Mobile store rules

Bookings are real-world services, so Apple and Google allow external payment (Stripe) instead of in-app purchase. Paid listings for professionals (Phase 3) are also services rendered outside the app; re-check the store guidelines at that time.

## Testing

- Stripe test mode with Connect test accounts and the Stripe CLI for webhook replay in local dev and CI.
- Integration tests cover: accept -> pay -> deliver -> release, accept -> pay -> refund, dispute path, webhook replay/idempotency, fee rounding (banker's rounding is not used; round half up on cents).
