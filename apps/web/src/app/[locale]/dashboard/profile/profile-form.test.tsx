import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const COUNTRIES = [
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' as const },
];

const EXISTING_PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'jane-doe',
  displayName: 'Jane Doe',
  headline: null,
  bio: { en: 'Hello there' },
  avatarUrl: null,
  coverUrl: null,
  links: { other: [] },
  categories: ['wedding' as const],
  languages: ['en', 'ja'],
  location: { lat: 49.61, lng: 6.13 },
  serviceRadiusKm: null,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 0,
  ratingCount: 0,
  verificationStatus: 'unverified' as const,
  isPublished: false,
  stripeOnboardingComplete: false,
  stripePayoutsEnabled: false,
};

async function loadProfileForm() {
  const { ProfileForm } = await import('./profile-form');
  return ProfileForm;
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

function fillMinimalCreateForm() {
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Doe' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Wedding' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
  fireEvent.change(screen.getByLabelText('City', { selector: '#profile-city' }), {
    target: { value: 'Luxembourg' },
  });
  fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'LU' } });
}

describe('ProfileForm', () => {
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

  it('previews the slug from the display name while creating a profile', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const ProfileForm = await loadProfileForm();

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Jane Doe Photography' },
    });

    expect(screen.getByText('/en/photographers/jane-doe-photography')).toBeInTheDocument();
  });

  it('warns when the display name only slugifies to the generic fallback', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const ProfileForm = await loadProfileForm();

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '日本語' } });

    expect(
      screen.getByText(
        "Your display name doesn't have enough letters or numbers for a URL, so we'll assign a generic one instead.",
      ),
    ).toBeInTheDocument();
  });

  it('blocks submission and shows an error when no location is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText('Choose a city or use your location before saving.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submission and maps a client-side zod issue onto the field, never reaching the network', async () => {
    useMyLocation();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText('This value is too short.', {
        selector: '#profile-display-name-error',
      }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a profile with trimmed bio, checked categories/languages and no client-computed slug', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_PROFILE), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    fireEvent.change(screen.getByLabelText('Bio (English)'), { target: { value: '  Hello!  ' } });
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByText('Profile created.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [request] = fetchMock.mock.calls[0] as [Request];
    const body = (await request.json()) as {
      displayName: string;
      categories: string[];
      languages: string[];
      bio: Record<string, string>;
      location: { lat: number; lng: number };
      slug?: unknown;
    };
    expect(body.displayName).toBe('Jane Doe');
    expect(body.categories).toEqual(['wedding']);
    expect(body.languages).toEqual(['en']);
    expect(body.bio).toEqual({ en: 'Hello!' });
    expect(body.location).toEqual({ lat: 49.61, lng: 6.14 });
    expect(body.slug).toBeUndefined();
  });

  it('maps a 409 conflict to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText(translate('web.dashboard.profile', 'errors.conflict')),
    ).toBeInTheDocument();
  });

  it('maps a 429 with a retry hint to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 15 } }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText(
        translate('web.dashboard.profile', 'errors.tooManyRequestsWithRetry', { seconds: 15 }),
      ),
    ).toBeInTheDocument();
  });

  it('maps a server-side 422 to the translated message', async () => {
    useMyLocation();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'UNPROCESSABLE_ENTITY' }), { status: 422 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={null} countries={COUNTRIES} />);
    fillMinimalCreateForm();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(
      await screen.findByText(translate('web.dashboard.profile', 'errors.invalid')),
    ).toBeInTheDocument();
  });

  it('edits an existing profile with PATCH, preserving a language the checkboxes do not offer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(EXISTING_PROFILE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ProfileForm = await loadProfileForm();
    const user = userEvent.setup({ delay: null });

    render(<ProfileForm locale="en" existing={EXISTING_PROFILE} countries={COUNTRIES} />);

    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'English' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('PATCH');
    const body = (await request.json()) as { languages: string[] };
    expect(body.languages).toEqual(['en', 'ja']);
  });
});
