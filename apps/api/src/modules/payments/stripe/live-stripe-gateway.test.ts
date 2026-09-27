import type { Logger } from 'nestjs-pino';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { LiveStripeGateway } from './live-stripe-gateway.js';

function stripeMock() {
  return {
    accounts: {
      create: vi.fn().mockResolvedValue({
        id: 'acct_1',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        email: 'never-logged@example.com',
      }),
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({
        url: 'https://connect.stripe.com/setup/x',
        expires_at: 1_800_000_000,
      }),
    },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret_x',
        status: 'requires_payment_method',
        amount: 10_500,
        currency: 'eur',
      }),
      retrieve: vi.fn().mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret_x',
        status: 'requires_action',
        amount: 10_500,
        currency: 'eur',
      }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({
        id: 'tr_1',
        amount: 10_000,
        currency: 'eur',
        destination: { id: 'acct_1' },
      }),
      createReversal: vi.fn().mockResolvedValue({ id: 'trr_1', transfer: 'tr_1', amount: 500 }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({ id: 're_1', amount: 10_500, status: 'succeeded' }),
    },
    events: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'evt_1',
        type: 'account.updated',
        account: 'acct_1',
        livemode: false,
        data: { object: { id: 'acct_1' } },
      }),
    },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue({
        id: 'evt_2',
        type: 'payment_intent.succeeded',
        account: null,
        livemode: false,
        data: { object: { id: 'pi_1' } },
      }),
    },
  };
}

function build(options: { webhookSecret?: string } = { webhookSecret: 'whsec_unit' }) {
  const stripe = stripeMock();
  const logger = { log: vi.fn() } as unknown as Logger & { log: ReturnType<typeof vi.fn> };
  const gateway = new LiveStripeGateway(stripe as unknown as Stripe, options.webhookSecret, logger);
  return { stripe, logger, gateway };
}

describe('LiveStripeGateway', () => {
  it('creates an Express account with the idempotency key and logs only the id', async () => {
    const { stripe, logger, gateway } = build();
    const account = await gateway.createConnectedAccount({
      country: 'LU',
      metadata: { photographerProfileId: 'p1' },
      idempotencyKey: 'photographer_p1_connect_account',
    });
    expect(account).toEqual({
      id: 'acct_1',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', country: 'LU' }),
      { idempotencyKey: 'photographer_p1_connect_account' },
    );
    expect(stripe.accounts.create.mock.calls[0]?.[0]).not.toHaveProperty('email');
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('never-logged');
  });

  it('creates an onboarding account link', async () => {
    const { stripe, gateway } = build();
    const link = await gateway.createAccountLink({
      accountId: 'acct_1',
      refreshUrl: 'https://photoo.lu/en/account',
      returnUrl: 'https://photoo.lu/en/account',
      idempotencyKey: 'link-key',
    });
    expect(link).toEqual({
      url: 'https://connect.stripe.com/setup/x',
      expiresAt: new Date(1_800_000_000 * 1000),
    });
    expect(stripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_1', type: 'account_onboarding' }),
      { idempotencyKey: 'link-key' },
    );
  });

  it('creates a payment intent on the platform with a lower-case currency', async () => {
    const { stripe, gateway } = build();
    const intent = await gateway.createPaymentIntent({
      amountCents: 10_500,
      currency: 'EUR',
      transferGroup: 'booking_1',
      metadata: {},
      idempotencyKey: 'booking_1_pi',
    });
    expect(intent).toEqual({
      id: 'pi_1',
      clientSecret: 'pi_1_secret_x',
      status: 'requires_payment_method',
      amountCents: 10_500,
      currency: 'EUR',
    });
    const call = stripe.paymentIntents.create.mock.calls[0] as unknown[] | undefined;
    const params = call?.[0];
    const options = call?.[1];
    expect(params).toMatchObject({ amount: 10_500, currency: 'eur', transfer_group: 'booking_1' });
    expect(params).not.toHaveProperty('transfer_data');
    expect(params).not.toHaveProperty('on_behalf_of');
    expect(options).toEqual({ idempotencyKey: 'booking_1_pi' });
  });

  it('throws when a payment intent comes back without a client secret', async () => {
    const { stripe, gateway } = build();
    stripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_2',
      client_secret: null,
      status: 'requires_payment_method',
      amount: 1,
      currency: 'eur',
    });
    await expect(
      gateway.createPaymentIntent({
        amountCents: 1,
        currency: 'EUR',
        transferGroup: 'g',
        metadata: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/pi_2 has no client secret/);
  });

  it('retrieves an existing payment intent by id', async () => {
    const { stripe, gateway } = build();
    await expect(gateway.retrievePaymentIntent('pi_1')).resolves.toEqual({
      id: 'pi_1',
      clientSecret: 'pi_1_secret_x',
      status: 'requires_action',
      amountCents: 10_500,
      currency: 'EUR',
    });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
  });

  it('creates a transfer tied to the source charge', async () => {
    const { stripe, gateway } = build();
    const transfer = await gateway.createTransfer({
      amountCents: 10_000,
      currency: 'EUR',
      destinationAccountId: 'acct_1',
      sourceTransactionId: 'ch_1',
      transferGroup: 'booking_1',
      metadata: {},
      idempotencyKey: 'booking_1_transfer',
    });
    expect(transfer).toEqual({
      id: 'tr_1',
      amountCents: 10_000,
      currency: 'EUR',
      destinationAccountId: 'acct_1',
    });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'acct_1', source_transaction: 'ch_1' }),
      { idempotencyKey: 'booking_1_transfer' },
    );
  });

  it('omits the amount on a full refund and passes it on a partial one', async () => {
    const { stripe, gateway } = build();
    await gateway.createRefund({ paymentIntentId: 'pi_1', metadata: {}, idempotencyKey: 'r1' });
    await gateway.createRefund({
      paymentIntentId: 'pi_1',
      amountCents: 500,
      metadata: {},
      idempotencyKey: 'r2',
    });
    expect(stripe.refunds.create.mock.calls[0]?.[0]).not.toHaveProperty('amount');
    expect(stripe.refunds.create.mock.calls[1]?.[0]).toMatchObject({ amount: 500 });
    expect(stripe.refunds.create.mock.calls[1]?.[1]).toEqual({ idempotencyKey: 'r2' });
  });

  it('reverses a transfer', async () => {
    const { stripe, gateway } = build();
    const reversal = await gateway.reverseTransfer({
      transferId: 'tr_1',
      amountCents: 500,
      metadata: {},
      idempotencyKey: 'rev',
    });
    expect(reversal).toEqual({ id: 'trr_1', transferId: 'tr_1', amountCents: 500 });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      'tr_1',
      { amount: 500, metadata: {} },
      { idempotencyKey: 'rev' },
    );
  });

  it('maps retrieved and verified events, dropping a null account', async () => {
    const { stripe, gateway } = build();
    await expect(gateway.retrieveEvent('evt_1')).resolves.toMatchObject({
      id: 'evt_1',
      account: 'acct_1',
    });
    const event = gateway.constructWebhookEvent('{}', 't=1,v1=abc');
    expect(event).not.toHaveProperty('account');
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith('{}', 't=1,v1=abc', 'whsec_unit');
  });

  it('refuses to verify webhooks without a webhook secret', () => {
    const { stripe, gateway } = build({});
    expect(() => gateway.constructWebhookEvent('{}', 't=1,v1=abc')).toThrow(
      /STRIPE_WEBHOOK_SECRET is not set/,
    );
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
  });
});
