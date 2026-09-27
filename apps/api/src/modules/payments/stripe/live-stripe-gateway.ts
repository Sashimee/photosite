import type { Logger } from 'nestjs-pino';
import type Stripe from 'stripe';
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

function toConnectedAccount(account: Stripe.Account): ConnectedAccount {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

function toPaymentIntent(intent: Stripe.PaymentIntent): PaymentIntent {
  if (intent.client_secret === null) {
    throw new Error(`stripe gateway: PaymentIntent ${intent.id} has no client secret`);
  }
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    amountCents: intent.amount,
    currency: intent.currency.toUpperCase(),
  };
}

function toGatewayEvent(event: Stripe.Event): GatewayEvent {
  return {
    id: event.id,
    type: event.type,
    ...(event.account ? { account: event.account } : {}),
    livemode: event.livemode,
    data: { object: event.data.object as unknown as Record<string, unknown> },
  };
}

function idOf(value: string | { id: string } | null): string {
  if (value === null) {
    throw new Error('stripe gateway: expected an expandable id, got null');
  }
  return typeof value === 'string' ? value : value.id;
}

export class LiveStripeGateway implements StripeGateway {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string | undefined,
    private readonly logger: Logger,
  ) {}

  async createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
    const account = await this.stripe.accounts.create(
      {
        type: 'express',
        country: input.country,
        ...(input.email ? { email: input.email } : {}),
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    this.logger.log({ stripeAccountId: account.id }, 'stripe: connected account created');
    return toConnectedAccount(account);
  }

  async retrieveAccount(accountId: string): Promise<ConnectedAccount> {
    return toConnectedAccount(await this.stripe.accounts.retrieve(accountId));
  }

  async createAccountLink(input: CreateAccountLinkInput): Promise<AccountLink> {
    const link = await this.stripe.accountLinks.create(
      {
        account: input.accountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: 'account_onboarding',
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        transfer_group: input.transferGroup,
        automatic_payment_methods: { enabled: true },
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    this.logger.log({ paymentIntentId: intent.id }, 'stripe: payment intent created');
    return toPaymentIntent(intent);
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    return toPaymentIntent(await this.stripe.paymentIntents.retrieve(paymentIntentId));
  }

  async createTransfer(input: CreateTransferInput): Promise<Transfer> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId,
        source_transaction: input.sourceTransactionId,
        transfer_group: input.transferGroup,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    this.logger.log({ transferId: transfer.id }, 'stripe: transfer created');
    return {
      id: transfer.id,
      amountCents: transfer.amount,
      currency: transfer.currency.toUpperCase(),
      destinationAccountId: idOf(transfer.destination),
    };
  }

  async createRefund(input: CreateRefundInput): Promise<Refund> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        ...(input.amountCents === undefined ? {} : { amount: input.amountCents }),
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    this.logger.log({ refundId: refund.id }, 'stripe: refund created');
    return { id: refund.id, amountCents: refund.amount, status: refund.status };
  }

  async reverseTransfer(input: ReverseTransferInput): Promise<TransferReversal> {
    const reversal = await this.stripe.transfers.createReversal(
      input.transferId,
      {
        ...(input.amountCents === undefined ? {} : { amount: input.amountCents }),
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    this.logger.log(
      { transferReversalId: reversal.id, transferId: input.transferId },
      'stripe: transfer reversed',
    );
    return { id: reversal.id, transferId: idOf(reversal.transfer), amountCents: reversal.amount };
  }

  async retrieveEvent(eventId: string): Promise<GatewayEvent> {
    return toGatewayEvent(await this.stripe.events.retrieve(eventId));
  }

  constructWebhookEvent(rawBody: Buffer | string, signature: string): GatewayEvent {
    if (this.webhookSecret === undefined) {
      throw new Error('stripe gateway: STRIPE_WEBHOOK_SECRET is not set, cannot verify webhooks');
    }
    return toGatewayEvent(
      this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret),
    );
  }
}
