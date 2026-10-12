import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedPatch = jest.mocked(api.PATCH);

const PROFILE = {
  id: 'p1',
  slug: 'jane',
  displayName: 'Jane Photo',
  headline: null,
  bio: { en: 'Hello' },
  avatarUrl: null,
  coverUrl: null,
  links: {},
  categories: ['wedding'],
  languages: ['en', 'it'],
  location: { lat: 49.61, lng: 6.13 },
  serviceRadiusKm: null,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 0,
  ratingCount: 0,
  verificationStatus: 'pending',
  isPublished: false,
  stripeOnboardingComplete: false,
  stripePayoutsEnabled: false,
  stripeAccountConnected: false,
};

const COUNTRIES = [{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' }];

function respond(path: string, profile: 'exists' | 'missing' | 'unauthorized' | 'broken') {
  if (path === '/v1/countries') {
    return Promise.resolve({
      data: COUNTRIES,
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
  }
  if (path === '/v1/cities') {
    return Promise.resolve({
      data: [
        {
          slug: 'luxembourg',
          name: 'Luxembourg',
          countryCode: 'LU',
          photographerCount: 3,
          location: { lat: 49.6116, lng: 6.1319 },
        },
      ],
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
  }
  if (profile === 'exists') {
    return Promise.resolve({
      data: PROFILE,
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
  }
  const status = { missing: 404, unauthorized: 401, broken: 500 }[profile];
  return Promise.resolve({ data: undefined, error: {}, response: new Response(null, { status }) });
}

function mockGet(profile: 'exists' | 'missing' | 'unauthorized' | 'broken') {
  mockedGet.mockImplementation(((path: string) => respond(path, profile)) as never);
}

function open() {
  renderRouter('./app', { initialUrl: '/studio/profile' });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('studio profile', () => {
  it('prefills the form from the existing profile', async () => {
    mockGet('exists');
    open();

    const name = await screen.findByTestId('studio-profile-display-name');
    expect(name.props.value).toBe('Jane Photo');
    expect(screen.getByTestId('studio-profile-city').props.value).toBe('Luxembourg');
    expect(screen.getByTestId('studio-profile-categories-wedding')).toBeChecked();
    expect(screen.getByText('Verification pending')).toBeTruthy();
  });

  it('patches the profile, re-sending language codes the form does not offer', async () => {
    mockGet('exists');
    mockedPatch.mockResolvedValueOnce({
      data: { ...PROFILE, displayName: 'Jane Studio' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);
    open();

    fireEvent.changeText(await screen.findByTestId('studio-profile-display-name'), 'Jane Studio');
    fireEvent.press(screen.getByTestId('studio-profile-submit'));

    await screen.findByTestId('studio-profile-saved');
    expect(mockedPatch).toHaveBeenCalledWith('/v1/me/photographer-profile', {
      body: expect.objectContaining({
        displayName: 'Jane Studio',
        languages: ['en', 'it'],
        location: { lat: 49.61, lng: 6.13 },
      }),
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('requires a location before creating a profile', async () => {
    mockGet('missing');
    open();

    fireEvent.changeText(await screen.findByTestId('studio-profile-display-name'), 'Jane Photo');
    fireEvent.press(screen.getByTestId('studio-profile-submit'));

    await screen.findByTestId('studio-profile-location-error');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('offers the create path when the profile does not exist and posts it', async () => {
    mockGet('missing');
    mockedPost.mockResolvedValueOnce({
      data: PROFILE,
      error: undefined,
      response: new Response(null, { status: 201 }),
    });
    open();

    fireEvent.changeText(await screen.findByTestId('studio-profile-display-name'), 'Jane Photo');
    fireEvent.press(screen.getByTestId('studio-profile-categories-wedding'));
    fireEvent.press(screen.getByTestId('studio-profile-languages-en'));
    fireEvent.changeText(screen.getByTestId('city-autocomplete-input'), 'Lux');
    fireEvent.press(await screen.findByTestId('city-suggestion-luxembourg'));
    fireEvent.press(await screen.findByTestId('studio-profile-country-LU'));
    fireEvent.press(screen.getByTestId('studio-profile-submit'));

    await screen.findByText('Profile created.');
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/photographer-profile', {
      body: {
        displayName: 'Jane Photo',
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
        location: { lat: 49.61, lng: 6.13 },
        bio: {},
      },
    });
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it('shows field errors from validation before sending', async () => {
    mockGet('exists');
    open();

    fireEvent.changeText(await screen.findByTestId('studio-profile-display-name'), '');
    fireEvent.press(screen.getByTestId('studio-profile-submit'));

    await screen.findByText('This value is too short.');
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it('shows the server error when saving fails', async () => {
    mockGet('exists');
    mockedPatch.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'FORBIDDEN' },
      response: new Response(null, { status: 403 }),
    } as never);
    open();

    await screen.findByTestId('studio-profile-form');
    fireEvent.press(screen.getByTestId('studio-profile-submit'));

    await screen.findByText("You don't have access to this profile.");
  });

  it('shows a retryable error when the profile cannot be loaded', async () => {
    mockGet('broken');
    open();

    await screen.findByTestId('studio-profile-load-error');
    mockGet('exists');
    fireEvent.press(screen.getByTestId('studio-profile-retry'));

    await screen.findByTestId('studio-profile-form');
  });

  it('shows a session message on 401', async () => {
    mockGet('unauthorized');
    open();

    await screen.findByTestId('studio-profile-unauthorized');
  });
});
