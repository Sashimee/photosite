import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in' }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/location', () => ({
  ...jest.requireActual<object>('../../src/lib/location'),
  requestCurrentPosition: jest.fn(),
  openLocationSettings: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { requestCurrentPosition } from '../../src/lib/location';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedLocate = jest.mocked(requestCurrentPosition);

const luxembourg = {
  slug: 'luxembourg',
  name: 'Luxembourg',
  countryCode: 'LU',
  photographerCount: 3,
  location: { lat: 49.6116, lng: 6.1319 },
};

function ok(data: unknown) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function fail(status: number, error: object) {
  return { data: undefined, error, response: new Response(null, { status }) };
}

function renderForm(url = '/requests/new') {
  return renderRouter('./app', { initialUrl: url });
}

async function fillEverythingButLocation() {
  await waitFor(() => screen.getByTestId('request-address-country-LU'));
  fireEvent.changeText(screen.getByTestId('request-title'), 'Wedding');
  fireEvent.press(screen.getByTestId('request-category-wedding'));
  fireEvent.changeText(screen.getByTestId('request-description'), 'Two hundred guests');
  fireEvent.changeText(screen.getByTestId('request-address-line1'), '1 Rue Test');
  fireEvent.changeText(screen.getByTestId('request-address-city'), 'Luxembourg');
  fireEvent.changeText(screen.getByTestId('request-address-postal-code'), 'L-1111');
  fireEvent.press(screen.getByTestId('request-address-country-LU'));
  fireEvent.changeText(screen.getByTestId('request-budget-min'), '500');
  fireEvent.changeText(screen.getByTestId('request-budget-max'), '900');
  fireEvent.press(screen.getByTestId('request-usage-personal'));
}

async function pickCity() {
  fireEvent.changeText(screen.getByTestId('city-autocomplete-input'), 'Lux');
  fireEvent.press(await screen.findByTestId('city-suggestion-luxembourg'));
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedGet.mockImplementation(((path: string) =>
    Promise.resolve(
      path === '/v1/countries'
        ? ok([{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'fr' }])
        : ok([luxembourg]),
    )) as unknown as typeof api.GET);
});

describe('new request screen', () => {
  it('renders against the real en catalog', async () => {
    renderForm();

    await waitFor(() => screen.getByText('Tell photographers what you need'));
    expect(screen.getByText('Send request')).toBeTruthy();
    expect(screen.getByText('Choose a country to set your currency.')).toBeTruthy();
    expect(screen.getByText('Wedding')).toBeTruthy();
  });

  it('shows the all-photographers notice when arriving from a profile', async () => {
    renderForm('/requests/new?photographer=jane-doe');

    await waitFor(() => screen.getByTestId('new-request-photographer-notice'));
  });

  it('submits with a city-supplied location when location permission is denied', async () => {
    mockedLocate.mockResolvedValue({ granted: false, canAskAgain: false });
    mockedPost.mockResolvedValue(ok({ id: 'r1' }));
    renderForm();

    await fillEverythingButLocation();
    fireEvent.press(screen.getByTestId('near-me-button'));
    await waitFor(() => screen.getByTestId('near-me-denied'));
    await pickCity();
    expect(screen.getByTestId('request-currency').props.children).toBe('EUR');
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByTestId('requests-new'));
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/requests',
      expect.objectContaining({
        body: expect.objectContaining({
          location: { lat: 49.61, lng: 6.13 },
          budgetMin: { amountCents: 50000, currency: 'EUR' },
          budgetMax: { amountCents: 90000, currency: 'EUR' },
        }),
      }),
    );
  });

  it('does not submit without a location and says why', async () => {
    renderForm();

    await fillEverythingButLocation();
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByTestId('request-location-error'));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('maps 409 onto a conflict notice and leaves the form intact', async () => {
    mockedPost.mockResolvedValue(fail(409, { code: 'CONFLICT', message: 'x' }));
    renderForm();

    await fillEverythingButLocation();
    await pickCity();
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByText("This request can't be changed right now."));
    expect(screen.getByTestId('request-title').props.value).toBe('Wedding');
    expect(screen.queryByTestId('requests-new')).toBeNull();
  });

  it('maps 422 field errors onto the form', async () => {
    mockedPost.mockResolvedValue(
      fail(422, {
        code: 'VALIDATION_ERROR',
        message: 'x',
        details: [{ path: 'address.postalCode' }],
      }),
    );
    renderForm();

    await fillEverythingButLocation();
    await pickCity();
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByText('Check the highlighted fields and try again.'));
    expect(screen.getByText("This value isn't valid.")).toBeTruthy();
    expect(screen.getByTestId('request-address-postal-code').props.value).toBe('L-1111');
  });

  it('maps 429 onto a slow-down notice with the retry hint', async () => {
    mockedPost.mockResolvedValue(
      fail(429, {
        code: 'TOO_MANY_REQUESTS',
        message: 'x',
        details: { retryAfterSeconds: 12 },
      }),
    );
    renderForm();

    await fillEverythingButLocation();
    await pickCity();
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByText("You're doing that too fast. Try again in 12 seconds."));
  });

  it('says the request was not sent when the network fails, and keeps the form', async () => {
    mockedPost.mockRejectedValue(new TypeError('Network request failed'));
    renderForm();

    await fillEverythingButLocation();
    await pickCity();
    fireEvent.press(screen.getByTestId('request-submit'));

    await waitFor(() => screen.getByTestId('new-request-error'));
    expect(screen.getByTestId('request-description').props.value).toBe('Two hundred guests');
    expect(screen.getByTestId('request-submit')).toBeEnabled();
  });
});
