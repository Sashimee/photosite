import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { CATALOGS } from '@photoo/i18n';

let mockToken: string | null = null;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => {
    if (mockToken === null) return Promise.resolve(null);
    if (key === 'photoo.session.token') return Promise.resolve(mockToken);
    return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
  }),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('expo-image', () => {
  const { Image } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image };
});

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import { api } from '../../src/lib/api';
import { formatMoney } from '../../src/lib/money';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

const USER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

const PROFILE = {
  id: 'p1',
  slug: 'jane-doe',
  displayName: 'Jane Doe Photography',
  headline: 'Wedding and portrait photographer',
  bio: { en: 'Twelve years behind the lens.' },
  avatarUrl: null,
  coverUrl: null,
  links: { other: [] },
  categories: ['wedding', 'portrait'],
  languages: ['en', 'fr'],
  serviceRadiusKm: null,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 4.8,
  ratingCount: 12,
  portfolio: [
    { id: 'i2', url: 'https://cdn.example/2.jpg', width: 800, height: 600, order: 1 },
    { id: 'i1', url: 'https://cdn.example/1.jpg', width: 800, height: 600, order: 0 },
    { id: 'i3', url: 'https://cdn.example/3.jpg', width: 800, height: 600, order: 2 },
  ],
};

const SUMMARY = {
  id: 'p1',
  slug: 'jane-doe',
  displayName: 'Jane Doe Photography',
  headline: null,
  avatarUrl: null,
  categories: [],
  languages: [],
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 0,
  ratingCount: 0,
  startingPrice: null,
};

const PRODUCTS = [
  {
    id: 'prod1',
    profileId: 'p1',
    title: { en: 'Full day wedding' },
    description: null,
    category: 'wedding',
    durationMinutes: 480,
    deliverables: {},
    basePrice: { amountCents: 150000, currency: 'EUR' },
    isActive: true,
    order: 0,
    tiers: [
      {
        id: 'tier1',
        usage: 'personal',
        price: { amountCents: 150000, currency: 'EUR' },
        description: '',
        licenceTextVersion: 'v1',
      },
      {
        id: 'tier2',
        usage: 'commercial',
        price: { amountCents: 250000, currency: 'EUR' },
        description: '',
        licenceTextVersion: 'v1',
      },
    ],
  },
];

function res(data: unknown, status = 200): unknown {
  return status >= 400
    ? { data: undefined, error: data, response: new Response(null, { status }) }
    : { data, error: undefined, response: new Response(null, { status }) };
}

function mockProfileApi() {
  mockedGet.mockImplementation(((path: string) => {
    switch (path) {
      case '/v1/photographers/{slug}':
        return Promise.resolve(res(PROFILE));
      case '/v1/photographers/{slug}/products':
        return Promise.resolve(res(PRODUCTS));
      case '/v1/countries':
        return Promise.resolve(res([]));
      case '/v1/quotes/{id}':
        return Promise.resolve(res({ code: 'NOT_FOUND', message: 'nope' }, 404));
      case '/v1/auth/session':
        return Promise.resolve(res({ user: USER }));
      default:
        return Promise.resolve(res({ items: [], nextCursor: null }));
    }
  }) as never);
}

function enText(path: string): string {
  let node: unknown = CATALOGS.en;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(key in node)) {
      throw new Error(`en catalog is missing ${path}`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'string') {
    throw new Error(`en catalog entry ${path} is not a string`);
  }
  return node;
}

async function pressWhenReady(testID: string) {
  await screen.findByTestId(testID);
  await waitFor(() => {
    expect(screen.getByTestId(testID)).toBeEnabled();
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockToken = null;
});

describe('photographer profile', () => {
  it('renders the profile, portfolio and products while signed out', async () => {
    mockProfileApi();

    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await screen.findByText('Jane Doe Photography');
    expect(screen.getByText('Wedding and portrait photographer')).toBeTruthy();
    expect(screen.getByText('Luxembourg')).toBeTruthy();
    expect(screen.getByText('Speaks: English, French')).toBeTruthy();
    expect(screen.getByText('Full day wedding')).toBeTruthy();
    expect(screen.getByTestId('portfolio-image-i1')).toBeTruthy();
    expect(screen.getByTestId('profile-request-quote')).toBeTruthy();
  });

  it('shows every price as the money helper formats it', async () => {
    mockProfileApi();

    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await screen.findByText(formatMoney({ amountCents: 150000, currency: 'EUR' }, 'en'));
    expect(
      screen.getByText(formatMoney({ amountCents: 250000, currency: 'EUR' }, 'en')),
    ).toBeTruthy();
    expect(
      screen.getByText(`From ${formatMoney({ amountCents: 150000, currency: 'EUR' }, 'en')}`),
    ).toBeTruthy();
  });

  it('uses the strings from the en catalog', async () => {
    mockProfileApi();

    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await screen.findByText(enText('mobile.profile.requestQuoteCta'));
    expect(screen.getByText(enText('mobile.profile.productsHeading'))).toBeTruthy();
    expect(screen.getByText(enText('common.licenceUsages.commercial'))).toBeTruthy();
    expect(
      screen.getByLabelText(
        enText('mobile.profile.portfolioImageAlt')
          .replace('{index}', '1')
          .replace('{displayName}', 'Jane Doe Photography'),
      ),
    ).toBeTruthy();
  });

  it('renders not-found for a 404 slug', async () => {
    mockedGet.mockResolvedValue(res({ code: 'NOT_FOUND', message: 'nope' }, 404));

    renderRouter('./app', { initialUrl: '/photographers/missing-slug' });

    await screen.findByTestId('profile-not-found');
    expect(screen.getByText('Photographer not found')).toBeTruthy();
  });

  it('renders not-found without a request for a malformed slug', async () => {
    renderRouter('./app', { initialUrl: '/photographers/Not_A_Slug' });

    await screen.findByTestId('profile-not-found');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('shows a retry when the load fails and recovers on retry', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await screen.findByTestId('profile-error');
    expect(screen.queryByText('network')).toBeNull();

    mockProfileApi();
    fireEvent.press(screen.getByTestId('profile-retry'));

    await screen.findByText('Jane Doe Photography');
  });

  it('pages through the portfolio viewer in order', async () => {
    mockProfileApi();
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    fireEvent.press(await screen.findByTestId('portfolio-image-i2'));

    await screen.findByTestId('photo-viewer');
    expect(screen.getByTestId('photo-viewer-position').props.children).toBe('2 of 3');

    fireEvent.press(screen.getByTestId('photo-viewer-next'));
    expect(screen.getByTestId('photo-viewer-position').props.children).toBe('3 of 3');
    expect(screen.getByTestId('photo-viewer-next')).toBeDisabled();

    fireEvent(screen.getByTestId('photo-viewer-list'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    expect(screen.getByTestId('photo-viewer-position').props.children).toBe('1 of 3');
    expect(screen.getByTestId('photo-viewer-previous')).toBeDisabled();

    fireEvent.press(screen.getByTestId('photo-viewer-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('photo-viewer')).toBeNull();
    });
  });

  it('sends a signed-out user to sign-in and returns to the profile afterwards', async () => {
    mockProfileApi();
    mockedPost.mockResolvedValue(
      res({
        user: USER,
        session: { token: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' },
      }),
    );
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await pressWhenReady('profile-request-quote');

    await screen.findByTestId('sign-in-submit');
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await screen.findByTestId('profile-request-quote');
    expect(screen.getByText('Jane Doe Photography')).toBeTruthy();
  });

  it('pops back to the existing profile after sign-in without duplicating it', async () => {
    mockProfileApi();
    mockedGet.mockImplementation(((path: string) => {
      if (path === '/v1/photographers') {
        return Promise.resolve(res({ items: [SUMMARY], nextCursor: null }));
      }
      return Promise.resolve(res(path.endsWith('products') ? PRODUCTS : PROFILE));
    }) as never);
    mockedPost.mockResolvedValue(
      res({ user: USER, session: { token: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' } }),
    );
    renderRouter('./app', { initialUrl: '/' });

    fireEvent.press(await screen.findByTestId('photographer-row-p1'));
    await pressWhenReady('profile-request-quote');
    await screen.findByTestId('sign-in-submit');
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await screen.findByTestId('profile-screen');
    act(() => {
      router.back();
    });

    await screen.findByTestId('discover-results');
    expect(router.canGoBack()).toBe(false);
  });

  it('pops back to the existing profile after a two-factor sign-in', async () => {
    mockedGet.mockImplementation(((path: string) => {
      if (path === '/v1/photographers') {
        return Promise.resolve(res({ items: [SUMMARY], nextCursor: null }));
      }
      return Promise.resolve(res(path.endsWith('products') ? PRODUCTS : PROFILE));
    }) as never);
    mockedPost
      .mockResolvedValueOnce(res({ twoFactorRequired: true, challengeToken: 'challenge-1' }))
      .mockResolvedValueOnce(
        res({ user: USER, session: { token: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' } }),
      );
    renderRouter('./app', { initialUrl: '/' });

    fireEvent.press(await screen.findByTestId('photographer-row-p1'));
    await pressWhenReady('profile-request-quote');
    await screen.findByTestId('sign-in-submit');
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));
    fireEvent.changeText(await screen.findByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await screen.findByTestId('profile-screen');
    act(() => {
      router.back();
    });

    await screen.findByTestId('discover-results');
    expect(router.canGoBack()).toBe(false);
  });

  it('sends only one request for a double tap on a tier quote', async () => {
    mockToken = 'tok';
    mockProfileApi();
    let release: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await screen.findByTestId('tier-quote-tier1');
    await waitFor(() => {
      expect(screen.getByTestId('tier-quote-tier1')).toBeEnabled();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('tier-quote-tier1'));
      fireEvent.press(screen.getByTestId('tier-quote-tier1'));
      await Promise.resolve();
    });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(res({ id: 'q1' }, 201));
      await Promise.resolve();
    });
    await screen.findByTestId('quote-detail-not-found');
  });

  it('ignores a return destination that is not an in-app path', async () => {
    mockProfileApi();
    mockedPost.mockResolvedValue(
      res({
        user: USER,
        session: { token: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' },
      }),
    );
    renderRouter('./app', { initialUrl: '/sign-in?next=https://evil.example/phish' });

    await screen.findByTestId('sign-in-submit');
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await screen.findByTestId('discover-results');
  });

  it('opens the request form for the photographer when signed in', async () => {
    mockToken = 'tok';
    mockProfileApi();
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await pressWhenReady('profile-request-quote');

    await screen.findByTestId('new-request-photographer-notice');
  });

  it('requests a direct quote from a tier without sending a price', async () => {
    mockToken = 'tok';
    mockProfileApi();
    mockedPost.mockResolvedValue(res({ id: 'q1' }, 201));
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await pressWhenReady('tier-quote-tier2');

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        '/v1/photographers/{slug}/products/{productId}/quotes',
        {
          params: { path: { slug: 'jane-doe', productId: 'prod1' } },
          body: { productTierId: 'tier2' },
        },
      );
    });
    await screen.findByTestId('quote-detail-not-found');
  });

  it('sends a signed-out user to sign-in from a tier quote without posting', async () => {
    mockProfileApi();
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await pressWhenReady('tier-quote-tier1');

    await screen.findByTestId('sign-in-submit');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('shows a mapped message when the tier quote fails', async () => {
    mockToken = 'tok';
    mockProfileApi();
    mockedPost.mockResolvedValue(res({ code: 'FORBIDDEN', message: 'verify' }, 403));
    renderRouter('./app', { initialUrl: '/photographers/jane-doe' });

    await pressWhenReady('tier-quote-tier1');

    await screen.findByText(enText('mobile.quotes.errors.forbidden'));
  });
});
