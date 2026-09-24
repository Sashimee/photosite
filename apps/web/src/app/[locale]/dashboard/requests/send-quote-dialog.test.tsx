import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const NS = 'web.dashboard.requests.sendQuote';

const REQUEST = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66a111',
  title: 'Wedding in Luxembourg City',
  category: 'wedding' as const,
  description: 'Full day coverage for around 80 guests.',
  eventDate: '2026-08-01T10:00:00.000Z',
  dateFlexible: false,
  city: 'Luxembourg',
  countryCode: 'LU',
  location: { lat: 49.6, lng: 6.1 },
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal' as const,
  status: 'open' as const,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  hasQuoted: false,
};

async function loadSendQuoteDialog() {
  const { SendQuoteDialog } = await import('./send-quote-dialog');
  return SendQuoteDialog;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: translate(NS, 'triggerCta') }));
}

function priceLabel() {
  return translate(NS, 'lineItemPriceLabel', { currency: 'EUR' });
}

describe('SendQuoteDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockReset();
  });

  it('opens with a single empty line item priced in the request currency', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);

    expect(screen.getByLabelText(priceLabel())).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: translate(NS, 'reviewTitle') }),
    ).not.toBeInTheDocument();
  });

  it('shows field errors and stays on the form step when required fields are missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(
      screen.queryByRole('heading', { name: translate(NS, 'reviewTitle') }),
    ).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('reviews the entered line item before sending, restating the total', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.type(
      screen.getByLabelText(translate(NS, 'lineItemLabelLabel')),
      'Full day coverage',
    );
    await user.type(screen.getByLabelText(priceLabel()), '1500');
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));

    expect(
      await screen.findByRole('heading', { name: translate(NS, 'reviewTitle') }),
    ).toBeInTheDocument();
    expect(screen.getByText('Full day coverage')).toBeInTheDocument();
    expect(screen.getByText('€1,500.00')).toBeInTheDocument();
  });

  it('sends the quote on confirm and navigates to the created quote', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'quote-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.type(
      screen.getByLabelText(translate(NS, 'lineItemLabelLabel')),
      'Full day coverage',
    );
    await user.type(screen.getByLabelText(priceLabel()), '1500');
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));
    await user.click(await screen.findByRole('button', { name: translate(NS, 'confirmSendCta') }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/quotes');
    const body: unknown = JSON.parse(await request.clone().text());
    expect(body).toMatchObject({
      requestId: REQUEST.id,
      lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
    });
    expect(pushMock).toHaveBeenCalledWith('/en/quotes/quote-1');
  });

  it('shows a photographer-facing mapped error on the review step and lets them retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.type(
      screen.getByLabelText(translate(NS, 'lineItemLabelLabel')),
      'Full day coverage',
    );
    await user.type(screen.getByLabelText(priceLabel()), '1500');
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));
    await user.click(await screen.findByRole('button', { name: translate(NS, 'confirmSendCta') }));

    expect(await screen.findByText(translate(NS, 'errors.conflict'))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('maps a validUntil-after-expiry 422 onto the field and returns to the form step', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'UNPROCESSABLE_ENTITY',
          message: 'validUntil must not be after the request expires',
        }),
        { status: 422 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.type(
      screen.getByLabelText(translate(NS, 'lineItemLabelLabel')),
      'Full day coverage',
    );
    await user.type(screen.getByLabelText(priceLabel()), '1500');
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));
    await user.click(await screen.findByRole('button', { name: translate(NS, 'confirmSendCta') }));

    expect(
      await screen.findByRole('heading', { name: translate(NS, 'formTitle') }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(translate(NS, 'validUntilLabel'))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByText(translate(NS, 'errors.invalid'))).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a different 422 as a photographer-facing notice instead of the field error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Cannot send a quote on your own request',
        }),
        { status: 422 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    await user.type(
      screen.getByLabelText(translate(NS, 'lineItemLabelLabel')),
      'Full day coverage',
    );
    await user.type(screen.getByLabelText(priceLabel()), '1500');
    await user.click(screen.getByRole('button', { name: translate(NS, 'reviewCta') }));
    await user.click(await screen.findByRole('button', { name: translate(NS, 'confirmSendCta') }));

    expect(await screen.findByText(translate(NS, 'errors.invalid'))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('recomputes the default valid-until each time the dialog opens, not just at mount', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(Date, 'now');
    const mountTime = Date.now();
    nowSpy.mockReturnValue(mountTime);

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);
    const firstValue = screen.getByLabelText<HTMLInputElement>(
      translate(NS, 'validUntilLabel'),
    ).value;
    expect(firstValue).not.toBe('');

    await user.click(screen.getByRole('button', { name: translate(NS, 'cancelCta') }));
    nowSpy.mockReturnValue(mountTime + 60 * 60 * 1000);
    await openDialog(user);

    expect(
      screen.getByLabelText<HTMLInputElement>(translate(NS, 'validUntilLabel')).value,
    ).not.toBe(firstValue);

    nowSpy.mockRestore();
  });

  it('bounds valid-until to the request expiry in the browser', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const SendQuoteDialog = await loadSendQuoteDialog();
    const user = userEvent.setup();

    render(<SendQuoteDialog request={REQUEST} locale="en" />);
    await openDialog(user);

    expect(screen.getByLabelText(translate(NS, 'validUntilLabel'))).toHaveAttribute(
      'max',
      expect.stringContaining(REQUEST.expiresAt.slice(0, 10)),
    );
  });
});
