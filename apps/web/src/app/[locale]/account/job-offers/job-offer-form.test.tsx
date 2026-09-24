import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { JobOfferInput } from './job-offer-form-helpers';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const COUNTRIES = [
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' as const },
  { code: 'FR', name: 'France', currency: 'EUR', defaultLocale: 'fr' as const },
];

const EXISTING_OFFER: JobOfferInput = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  description: 'Full day coverage for a wedding in June.',
  category: 'wedding',
  city: 'Luxembourg',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  startDate: null,
  endDate: null,
  compensation: null,
  status: 'draft',
  publishedAt: null,
  expiresAt: null,
};

async function loadJobOfferForm() {
  const { JobOfferForm } = await import('./job-offer-form');
  return JobOfferForm;
}

function fillMinimalFields(remote = true) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Second shooter wanted' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Help covering a wedding.' },
  });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'wedding' } });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Luxembourg' } });
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'LU' } });
  if (remote) {
    fireEvent.click(screen.getByLabelText('This job can be done remotely'));
  }
}

describe('JobOfferForm', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it('blocks submission when the offer is not remote and no location has been picked', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(false);
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(
      await screen.findByText('Pick a matching city suggestion, or mark this offer as remote.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not require a location once remote is checked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...EXISTING_OFFER, remote: true, location: null }), {
        status: 201,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(true);
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Draft created.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    const body = (await request.json()) as { remote: boolean; location?: unknown };
    expect(body.remote).toBe(true);
    expect('location' in body).toBe(false);
  });

  it('blocks submission when the end date is before the start date', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(true);
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-01' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(
      await screen.findByText('The start date must be before the end date.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('picks a city suggestion to set the location and includes it when not remote', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('/v1/cities')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                slug: 'luxembourg-city',
                name: 'Luxembourg',
                countryCode: 'LU',
                photographerCount: 3,
                location: { lat: 49.61, lng: 6.13 },
              },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ...EXISTING_OFFER, id: 'new-id' }), { status: 201 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Second shooter' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Help covering a wedding.' },
    });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'wedding' } });
    fireEvent.change(screen.getByLabelText('Find a city'), { target: { value: 'Luxembourg' } });

    expect(await screen.findByText('Map location set.')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toHaveValue('Luxembourg');
    expect(screen.getByLabelText('Country')).toHaveValue('LU');

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Draft created.')).toBeInTheDocument();
    const submitCall = fetchMock.mock.calls.find((call) => {
      const [input] = call as [RequestInfo | URL];
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      return url.includes('/v1/me/job-offers') && !url.includes('/v1/cities');
    });
    const [request] = submitCall as [Request];
    const body = (await request.json()) as { location?: { lat: number; lng: number } };
    expect(body.location).toEqual({ lat: 49.61, lng: 6.13 });
  });

  it('converts compensation to cents in the selected country currency', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_OFFER), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(true);
    expect(screen.getByText('Optional. Shown to photographers in EUR.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '1000' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Draft created.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    const body = (await request.json()) as {
      compensation: {
        min: { amountCents: number; currency: string };
        max: { amountCents: number; currency: string };
      };
    };
    expect(body.compensation).toEqual({
      min: { amountCents: 50000, currency: 'EUR' },
      max: { amountCents: 100000, currency: 'EUR' },
    });
  });

  it('edits an existing offer with PATCH, pre-filled from the offer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_OFFER), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={EXISTING_OFFER} countries={COUNTRIES} />);

    expect(screen.getByDisplayValue('Wedding photographer needed')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toHaveValue('LU');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('PATCH');
    const body = (await request.json()) as { location?: { lat: number; lng: number } };
    expect(body.location).toEqual({ lat: 49.61, lng: 6.13 });
  });

  it('maps a 400 VALIDATION_ERROR onto the matching field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          details: [{ path: 'title', message: 'Required' }],
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(true);
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(
      await screen.findByText("This value isn't valid.", {
        selector: '#job-offer-title-error',
      }),
    ).toBeInTheDocument();
  });

  it('maps a 429 with a retry hint to the translated message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 9 } }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const JobOfferForm = await loadJobOfferForm();
    const user = userEvent.setup({ delay: null });

    render(<JobOfferForm existing={null} countries={COUNTRIES} />);
    fillMinimalFields(true);
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(
      await screen.findByText(
        translate('web.jobOffers', 'errors.tooManyRequestsWithRetry', { seconds: 9 }),
      ),
    ).toBeInTheDocument();
  });
});
