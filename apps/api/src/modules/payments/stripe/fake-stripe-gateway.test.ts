import { describe, expect, it } from 'vitest';
import { FAKE_WEBHOOK_SECRET, FakeStripeGateway } from './fake-stripe-gateway.js';

const NOW = new Date('2026-09-27T10:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function gateway() {
  return new FakeStripeGateway(FAKE_WEBHOOK_SECRET, () => NOW);
}

async function accountOn(fake: FakeStripeGateway, key = 'profile_1_connect_account') {
  return fake.createConnectedAccount({
    country: 'LU',
    metadata: { photographerProfileId: 'profile_1' },
    idempotencyKey: key,
  });
}

describe('FakeStripeGateway', () => {
  describe('idempotency', () => {
    it('replays the first result for the same key and parameters', async () => {
      const fake = gateway();
      const first = await accountOn(fake);
      const second = await accountOn(fake);
      expect(second).toEqual(first);
      expect(first.id).toBe('acct_fake_1');
      expect(first).toMatchObject({ chargesEnabled: false, payoutsEnabled: false });
    });

    it('creates a new object for a different key', async () => {
      const fake = gateway();
      const first = await accountOn(fake, 'a');
      const second = await accountOn(fake, 'b');
      expect(second.id).not.toBe(first.id);
    });

    it('rejects a reused key with different parameters', async () => {
      const fake = gateway();
      await accountOn(fake);
      await expect(
        fake.createConnectedAccount({
          country: 'DE',
          metadata: { photographerProfileId: 'profile_1' },
          idempotencyKey: 'profile_1_connect_account',
        }),
      ).rejects.toThrow(/reused with different parameters/);
    });
  });

  describe('createAccountLink', () => {
    it('returns an onboarding url expiring five minutes from now', async () => {
      const fake = gateway();
      const account = await accountOn(fake);
      const link = await fake.createAccountLink({
        accountId: account.id,
        refreshUrl: 'https://photoo.lu/en/account',
        returnUrl: 'https://photoo.lu/en/account',
        idempotencyKey: 'link-1',
      });
      expect(link.url).toBe(`https://connect.stripe.fake/setup/${account.id}/link_1`);
      expect(link.expiresAt.getTime() - NOW.getTime()).toBe(300_000);
    });

    it('rejects an unknown account', async () => {
      await expect(
        gateway().createAccountLink({
          accountId: 'acct_missing',
          refreshUrl: 'https://photoo.lu/a',
          returnUrl: 'https://photoo.lu/a',
          idempotencyKey: 'link-1',
        }),
      ).rejects.toThrow(/no such account acct_missing/);
    });
  });

  describe('payments, transfers and refunds', () => {
    it('creates a payment intent with a client secret and upper-case currency', async () => {
      const intent = await gateway().createPaymentIntent({
        amountCents: 10_500,
        currency: 'eur',
        transferGroup: 'booking_1',
        metadata: {},
        idempotencyKey: 'booking_1_pi',
      });
      expect(intent).toEqual({
        id: 'pi_fake_1',
        clientSecret: 'pi_fake_1_secret_fake',
        status: 'requires_payment_method',
        amountCents: 10_500,
        currency: 'EUR',
      });
    });

    it('refunds the full amount by default and rejects an unknown payment intent', async () => {
      const fake = gateway();
      const intent = await fake.createPaymentIntent({
        amountCents: 10_500,
        currency: 'EUR',
        transferGroup: 'booking_1',
        metadata: {},
        idempotencyKey: 'booking_1_pi',
      });
      const refund = await fake.createRefund({
        paymentIntentId: intent.id,
        metadata: {},
        idempotencyKey: 'booking_1_refund',
      });
      expect(refund).toMatchObject({ amountCents: 10_500, status: 'succeeded' });

      await expect(
        fake.createRefund({ paymentIntentId: 'pi_missing', metadata: {}, idempotencyKey: 'x' }),
      ).rejects.toThrow(/no such payment_intent/);
    });

    it('transfers to a known account and reverses at most the unreversed amount', async () => {
      const fake = gateway();
      const account = await accountOn(fake);
      await expect(
        fake.createTransfer({
          amountCents: 100,
          currency: 'EUR',
          destinationAccountId: 'acct_missing',
          sourceTransactionId: 'ch_1',
          transferGroup: 'booking_1',
          metadata: {},
          idempotencyKey: 'bad',
        }),
      ).rejects.toThrow(/no such account/);

      const transfer = await fake.createTransfer({
        amountCents: 10_000,
        currency: 'eur',
        destinationAccountId: account.id,
        sourceTransactionId: 'ch_1',
        transferGroup: 'booking_1',
        metadata: {},
        idempotencyKey: 'booking_1_transfer',
      });
      expect(transfer).toMatchObject({ amountCents: 10_000, currency: 'EUR' });

      const partial = await fake.reverseTransfer({
        transferId: transfer.id,
        amountCents: 4_000,
        metadata: {},
        idempotencyKey: 'rev-1',
      });
      expect(partial.amountCents).toBe(4_000);

      await expect(
        fake.reverseTransfer({
          transferId: transfer.id,
          amountCents: 6_001,
          metadata: {},
          idempotencyKey: 'rev-2',
        }),
      ).rejects.toThrow(/exceeds the unreversed amount/);

      const rest = await fake.reverseTransfer({
        transferId: transfer.id,
        metadata: {},
        idempotencyKey: 'rev-3',
      });
      expect(rest).toMatchObject({ transferId: transfer.id, amountCents: 6_000 });

      await expect(
        fake.reverseTransfer({ transferId: 'tr_missing', metadata: {}, idempotencyKey: 'rev-4' }),
      ).rejects.toThrow(/no such transfer/);
    });
  });

  describe('events and webhook signatures', () => {
    it('emits account.updated with the current flags and retrieves it by id', async () => {
      const fake = gateway();
      const account = await accountOn(fake);
      fake.updateAccount(account.id, { payoutsEnabled: true, detailsSubmitted: true });
      const event = fake.emitAccountUpdated(account.id);
      expect(event).toMatchObject({
        type: 'account.updated',
        account: account.id,
        livemode: false,
        data: { object: { id: account.id, payouts_enabled: true, details_submitted: true } },
      });
      await expect(fake.retrieveEvent(event.id)).resolves.toEqual(event);
      await expect(fake.retrieveEvent('evt_missing')).rejects.toThrow(/no such event/);
    });

    it('accepts a correctly signed payload', async () => {
      const fake = gateway();
      const account = await accountOn(fake);
      const payload = JSON.stringify(fake.emitAccountUpdated(account.id));
      const event = fake.constructWebhookEvent(Buffer.from(payload), fake.signPayload(payload));
      expect(event.type).toBe('account.updated');
    });

    it('rejects a payload signed with a different secret', () => {
      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'x',
        livemode: false,
        data: { object: {} },
      });
      const other = new FakeStripeGateway('whsec_other', () => NOW);
      expect(() => gateway().constructWebhookEvent(payload, other.signPayload(payload))).toThrow(
        /no signatures found/,
      );
    });

    it('rejects a tampered payload', () => {
      const fake = gateway();
      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'x',
        livemode: false,
        data: { object: {} },
      });
      const signature = fake.signPayload(payload);
      expect(() =>
        fake.constructWebhookEvent(payload.replace('evt_1', 'evt_2'), signature),
      ).toThrow(/no signatures found/);
    });

    it('rejects a timestamp outside the tolerance', () => {
      const fake = gateway();
      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'x',
        livemode: false,
        data: { object: {} },
      });
      expect(() =>
        fake.constructWebhookEvent(payload, fake.signPayload(payload, NOW_SECONDS - 301)),
      ).toThrow(/tolerance/);
    });

    it('rejects a malformed signature header', () => {
      expect(() => gateway().constructWebhookEvent('{}', 'garbage')).toThrow(
        /unable to extract timestamp/,
      );
    });

    it('rejects a correctly signed payload that is not an event', () => {
      const fake = gateway();
      const payload = JSON.stringify({ hello: 'world' });
      expect(() => fake.constructWebhookEvent(payload, fake.signPayload(payload))).toThrow();
    });
  });
});
