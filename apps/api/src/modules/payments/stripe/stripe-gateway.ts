import { z } from 'zod';

export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

export interface ConnectedAccount {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface CreateConnectedAccountInput {
  country: string;
  email?: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface CreateAccountLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  idempotencyKey: string;
}

export interface AccountLink {
  url: string;
  expiresAt: Date;
}

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: string;
  transferGroup: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  status: string;
  amountCents: number;
  currency: string;
}

export interface CreateTransferInput {
  amountCents: number;
  currency: string;
  destinationAccountId: string;
  sourceTransactionId: string;
  transferGroup: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface Transfer {
  id: string;
  amountCents: number;
  currency: string;
  destinationAccountId: string;
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amountCents?: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface Refund {
  id: string;
  amountCents: number;
  status: string | null;
}

export interface ReverseTransferInput {
  transferId: string;
  amountCents?: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface TransferReversal {
  id: string;
  transferId: string;
  amountCents: number;
}

export interface GatewayEvent {
  id: string;
  type: string;
  account?: string | undefined;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

// Both the live and the fake implementation sit behind this so services never
// import the Stripe SDK; every creating call carries an idempotency key built
// from our own ids, so a retried request can never charge or pay out twice.
export interface StripeGateway {
  createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount>;
  createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink>;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;
  createTransfer(input: CreateTransferInput): Promise<Transfer>;
  createRefund(input: CreateRefundInput): Promise<Refund>;
  reverseTransfer(input: ReverseTransferInput): Promise<TransferReversal>;
  retrieveEvent(eventId: string): Promise<GatewayEvent>;
  constructWebhookEvent(rawBody: Buffer | string, signature: string): GatewayEvent;
}

const StripeAccountObjectSchema = z.object({
  id: z.string().startsWith('acct_'),
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
});

export function parseConnectedAccount(object: unknown): ConnectedAccount {
  const parsed = StripeAccountObjectSchema.parse(object);
  return {
    id: parsed.id,
    chargesEnabled: parsed.charges_enabled,
    payoutsEnabled: parsed.payouts_enabled,
    detailsSubmitted: parsed.details_submitted,
  };
}
