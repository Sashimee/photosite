import { afterEach, describe, expect, it, vi } from 'vitest';

const loadStripeMock = vi.fn();

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: loadStripeMock,
}));

async function loadGetStripe(publishableKey: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', publishableKey ?? '');
  return (await import('./stripe')).getStripe;
}

describe('getStripe', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    loadStripeMock.mockReset();
  });

  it('resolves null without calling loadStripe when no publishable key is configured', async () => {
    const getStripe = await loadGetStripe(undefined);

    const stripe = await getStripe();

    expect(stripe).toBeNull();
    expect(loadStripeMock).not.toHaveBeenCalled();
  });

  it('loads Stripe with the publishable key when one is configured', async () => {
    const fakeStripe = {};
    loadStripeMock.mockResolvedValue(fakeStripe);
    const getStripe = await loadGetStripe('pk_test_123');

    const stripe = await getStripe();

    expect(stripe).toBe(fakeStripe);
    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_123');
  });

  it('memoizes the Stripe promise across calls', async () => {
    loadStripeMock.mockResolvedValue({});
    const getStripe = await loadGetStripe('pk_test_123');

    await getStripe();
    await getStripe();

    expect(loadStripeMock).toHaveBeenCalledTimes(1);
  });
});
