import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AccountLink,
  ConnectedAccount,
  CreateAccountLinkInput,
  CreateConnectedAccountInput,
  CreatePaymentIntentInput,
  CreateRefundInput,
  CreateTransferInput,
  GatewayEvent,
  PaymentIntent,
  Refund,
  ReverseTransferInput,
  StripeGateway,
  Transfer,
  TransferReversal,
} from './stripe-gateway.js';
import { parseGatewayEvent } from './stripe-gateway.js';

const SIGNATURE_TOLERANCE_SECONDS = 300;
const ACCOUNT_LINK_TTL_SECONDS = 300;

interface IdempotentRecord {
  fingerprint: string;
  result: unknown;
}

// Deterministic, in-memory stand-in for Stripe used by tests and local
// development with STRIPE_FAKE=true. It mirrors the behaviours callers rely on:
// idempotency keys replay the first result (and reject reuse with different
// parameters, as Stripe does) and webhook payloads carry a Stripe-format
// `t=...,v1=...` HMAC signature.
export class FakeStripeGateway implements StripeGateway {
  private readonly counters = new Map<string, number>();
  private readonly idempotency = new Map<string, IdempotentRecord>();
  private readonly accounts = new Map<string, ConnectedAccount>();
  private readonly paymentIntents = new Map<string, PaymentIntent>();
  private readonly transfers = new Map<
    string,
    Transfer & { reversedCents: number; transferGroup: string; metadata: Record<string, string> }
  >();
  private readonly refundedCents = new Map<string, number>();
  private readonly events = new Map<string, GatewayEvent>();

  constructor(
    private readonly webhookSecret: string | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
    return this.idempotent('accounts', input.idempotencyKey, input, () => {
      const account: ConnectedAccount = {
        id: this.nextId('acct_fake'),
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
      this.accounts.set(account.id, account);
      return { ...account };
    });
  }

  retrieveAccount(accountId: string): Promise<ConnectedAccount> {
    const account = this.accounts.get(accountId);
    if (!account) {
      return Promise.reject(new Error(`fake stripe: no such account ${accountId}`));
    }
    return Promise.resolve({ ...account });
  }

  createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink> {
    return this.idempotent('account_links', input.idempotencyKey, input, () => {
      this.requireAccount(input.accountId);
      const expiresAt = new Date(this.now().getTime() + ACCOUNT_LINK_TTL_SECONDS * 1000);
      return {
        url: `https://connect.stripe.fake/setup/${input.accountId}/${this.nextId('link')}`,
        expiresAt,
      };
    });
  }

  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    return this.idempotent('payment_intents', input.idempotencyKey, input, () => {
      const id = this.nextId('pi_fake');
      const intent: PaymentIntent = {
        id,
        clientSecret: `${id}_secret_fake`,
        status: 'requires_payment_method',
        amountCents: input.amountCents,
        currency: input.currency.toUpperCase(),
      };
      this.paymentIntents.set(id, intent);
      return { ...intent };
    });
  }

  retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      return Promise.reject(new Error(`fake stripe: no such payment_intent ${paymentIntentId}`));
    }
    return Promise.resolve({ ...intent });
  }

  createTransfer(input: CreateTransferInput): Promise<Transfer> {
    return this.idempotent('transfers', input.idempotencyKey, input, () => {
      this.requireAccount(input.destinationAccountId);
      const transfer: Transfer = {
        id: this.nextId('tr_fake'),
        amountCents: input.amountCents,
        currency: input.currency.toUpperCase(),
        destinationAccountId: input.destinationAccountId,
      };
      this.transfers.set(transfer.id, {
        ...transfer,
        reversedCents: 0,
        transferGroup: input.transferGroup,
        metadata: { ...input.metadata },
      });
      return transfer;
    });
  }

  findTransfer(transferGroup: string, bookingId: string): Promise<Transfer | null> {
    const matches = [...this.transfers.values()].filter(
      (transfer) =>
        transfer.transferGroup === transferGroup && transfer.metadata.bookingId === bookingId,
    );
    if (matches.length > 1) {
      return Promise.reject(
        new Error(`fake stripe: ${String(matches.length)} transfers in group ${transferGroup}`),
      );
    }
    const [match] = matches;
    if (!match) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: match.id,
      amountCents: match.amountCents,
      currency: match.currency,
      destinationAccountId: match.destinationAccountId,
    });
  }

  createRefund(input: CreateRefundInput): Promise<Refund> {
    return this.idempotent('refunds', input.idempotencyKey, input, () => {
      const intent = this.paymentIntents.get(input.paymentIntentId);
      if (!intent) {
        throw new Error(`fake stripe: no such payment_intent ${input.paymentIntentId}`);
      }
      const refunded = this.refundedCents.get(intent.id) ?? 0;
      const remaining = intent.amountCents - refunded;
      const amountCents = input.amountCents ?? remaining;
      if (amountCents <= 0 || amountCents > remaining) {
        throw new Error(`fake stripe: refund exceeds the unrefunded amount of ${intent.id}`);
      }
      this.refundedCents.set(intent.id, refunded + amountCents);
      return { id: this.nextId('re_fake'), amountCents, status: 'succeeded' };
    });
  }

  reverseTransfer(input: ReverseTransferInput): Promise<TransferReversal> {
    return this.idempotent('transfer_reversals', input.idempotencyKey, input, () => {
      const transfer = this.transfers.get(input.transferId);
      if (!transfer) {
        throw new Error(`fake stripe: no such transfer ${input.transferId}`);
      }
      const remaining = transfer.amountCents - transfer.reversedCents;
      const amountCents = input.amountCents ?? remaining;
      if (amountCents > remaining) {
        throw new Error(`fake stripe: reversal exceeds the unreversed amount of ${transfer.id}`);
      }
      transfer.reversedCents += amountCents;
      return { id: this.nextId('trr_fake'), transferId: transfer.id, amountCents };
    });
  }

  retrieveEvent(eventId: string): Promise<GatewayEvent> {
    const event = this.events.get(eventId);
    if (!event) {
      return Promise.reject(new Error(`fake stripe: no such event ${eventId}`));
    }
    return Promise.resolve(structuredClone(event));
  }

  constructWebhookEvent(rawBody: Buffer | string, signature: string): GatewayEvent {
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const parts = new Map<string, string[]>();
    for (const item of signature.split(',')) {
      const [key, value] = item.split('=', 2);
      if (key && value) {
        parts.set(key, [...(parts.get(key) ?? []), value]);
      }
    }
    const timestamp = Number(parts.get('t')?.[0]);
    const candidates = parts.get('v1') ?? [];
    if (!Number.isInteger(timestamp) || candidates.length === 0) {
      throw new Error('fake stripe: unable to extract timestamp and signatures from header');
    }
    const expected = Buffer.from(this.hmac(timestamp, payload), 'hex');
    const matches = candidates.some((candidate) => {
      const actual = Buffer.from(candidate, 'hex');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!matches) {
      throw new Error('fake stripe: no signatures found matching the expected signature');
    }
    if (Math.abs(this.nowSeconds() - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
      throw new Error('fake stripe: timestamp outside the tolerance zone');
    }
    return parseGatewayEvent(JSON.parse(payload));
  }

  signPayload(payload: string, timestamp: number = this.nowSeconds()): string {
    return `t=${String(timestamp)},v1=${this.hmac(timestamp, payload)}`;
  }

  updateAccount(
    accountId: string,
    changes: Partial<Omit<ConnectedAccount, 'id'>>,
  ): ConnectedAccount {
    const account = { ...this.requireAccount(accountId), ...changes };
    this.accounts.set(accountId, account);
    return { ...account };
  }

  emitAccountUpdated(accountId: string): GatewayEvent {
    const account = this.requireAccount(accountId);
    const event: GatewayEvent = {
      id: this.nextId('evt_fake'),
      type: 'account.updated',
      account: account.id,
      livemode: false,
      data: {
        object: {
          id: account.id,
          object: 'account',
          charges_enabled: account.chargesEnabled,
          payouts_enabled: account.payoutsEnabled,
          details_submitted: account.detailsSubmitted,
        },
      },
    };
    this.events.set(event.id, event);
    return structuredClone(event);
  }

  private requireAccount(accountId: string): ConnectedAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`fake stripe: no such account ${accountId}`);
    }
    return account;
  }

  private async idempotent<T>(
    resource: string,
    idempotencyKey: string,
    params: object,
    create: () => T,
  ): Promise<T> {
    const key = `${resource}:${idempotencyKey}`;
    const fingerprint = JSON.stringify({ ...params, idempotencyKey: undefined });
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(
          `fake stripe: idempotency key ${idempotencyKey} reused with different parameters`,
        );
      }
      return Promise.resolve(structuredClone(existing.result) as T);
    }
    const result = create();
    this.idempotency.set(key, { fingerprint, result: structuredClone(result) });
    return Promise.resolve(result);
  }

  private nextId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next)}`;
  }

  private hmac(timestamp: number, payload: string): string {
    if (this.webhookSecret === undefined) {
      throw new Error(
        'fake stripe: STRIPE_WEBHOOK_SECRET is not set, cannot sign or verify webhooks',
      );
    }
    return createHmac('sha256', this.webhookSecret)
      .update(`${String(timestamp)}.${payload}`)
      .digest('hex');
  }

  private nowSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}
