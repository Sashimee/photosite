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
5. **Refund before release** – full or partial `refunds.create` against the PaymentIntent; booking `refunded`/`disputed` resolution; ledger updated. After release, a refund requires a `transfer reversal` first; only admins can do this from the admin app.
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
