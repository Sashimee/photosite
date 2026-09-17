import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const countries = [
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' as const },
  { code: 'FR', name: 'France', currency: 'EUR', defaultLocale: 'fr' as const },
];

function futureDatetimeLocal(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

async function loadRequestForm() {
  const { RequestForm } = await import('./request-form');
  return RequestForm;
}

function useMyLocation() {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({ coords: { latitude: 49.611789, longitude: 6.135999 } } as GeolocationPosition);
  });
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
}

// Fills every field with a single `fireEvent.change` instead of
// `userEvent.type`/`selectOptions`: those simulate one DOM event per
// keystroke, which is the dominant cost of this form's tests (many long
// text fields) and made three of them flaky-slow on a throttled CI runner
// (they passed locally, timed out at 5000ms in CI). None of these fields
// have per-keystroke behaviour (masking, autocomplete-as-you-type) that
// depends on individual key events, so a single change event is equivalent.
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Wedding photographer needed' },
  });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'wedding' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Full day coverage for our wedding' },
  });
  fireEvent.change(screen.getByLabelText('Event date and time'), {
    target: { value: futureDatetimeLocal() },
  });
  fireEvent.change(screen.getByLabelText('Address line 1'), {
    target: { value: '10 rue de la Gare' },
  });
  fireEvent.change(screen.getByLabelText('City', { selector: '#request-address-city' }), {
    target: { value: 'Luxembourg' },
  });
  fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: 'L-1611' } });
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'LU' } });
  fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '2000' } });
  fireEvent.change(screen.getByLabelText('How will you use the photos?'), {
    target: { value: 'personal' },
  });
}

describe('RequestForm', () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockReset();
    refreshMock.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
  });

  it('blocks submission and shows an error when no location source is chosen', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText('Choose a city or use your location before sending the request.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converts the budget to cents and creates the request once a location is set', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'req-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(pushMock).toHaveBeenCalledWith('/en/requests/req-1');
    const [request] = fetchMock.mock.calls[0] as [Request];
    const body = (await request.json()) as {
      budgetMin: { amountCents: number };
      budgetMax: { amountCents: number };
    };
    expect(body.budgetMin).toEqual({ amountCents: 100000, currency: 'EUR' });
    expect(body.budgetMax).toEqual({ amountCents: 200000, currency: 'EUR' });
  });

  it('maps a 409 conflict to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText(translate('web.requests', 'errors.conflict')),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('maps a 429 with a retry hint to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 20 } }),
        {
          status: 429,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText(
        translate('web.requests', 'errors.tooManyRequestsWithRetry', { seconds: 20 }),
      ),
    ).toBeInTheDocument();
  });

  it('maps a server-side 422 (a business rule the client cannot pre-check) to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'UNPROCESSABLE_ENTITY' }), { status: 422 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText(translate('web.requests', 'errors.invalid')),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('blocks submission and maps a client-side zod issue onto the form field, never reaching the network', async () => {
    useMyLocation();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a specific message when the minimum budget is greater than the maximum', async () => {
    useMyLocation();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '5000' } });
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(
      await screen.findByText('Minimum must not be greater than maximum.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a 400 VALIDATION_ERROR with field details onto the form fields', async () => {
    useMyLocation();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [
            { path: 'address.postalCode', message: 'Invalid input' },
            { path: 'title', message: 'Invalid input' },
          ],
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const RequestForm = await loadRequestForm();
    const user = userEvent.setup({ delay: null });

    render(<RequestForm locale="en" countries={countries} />);
    fillRequiredFields();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    const postalCodeError = await screen.findByText("This value isn't valid.", {
      selector: '#request-address-postal-code-error',
    });
    expect(postalCodeError).toBeInTheDocument();
    expect(
      screen.getByText("This value isn't valid.", { selector: '#request-title-error' }),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
