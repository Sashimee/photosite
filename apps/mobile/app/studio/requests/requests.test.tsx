import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ({ onValueChange }: { onValueChange: (event: unknown, date: Date) => void }) =>
      createElement(Pressable, {
        testID: 'mock-date-picker',
        onPress: () => {
          onValueChange({}, new Date(Date.now() + 3 * 60 * 60 * 1000));
        },
      }),
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

import '../../../src/lib/i18n';
import { api } from '../../../src/lib/api';
import { renderedText } from '../../../src/testing/rendered-text';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

const REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function makeRequest(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Wedding ${id}`,
    category: 'wedding',
    description: 'Two cameras please',
    eventDate: '2999-06-01T10:00:00.000Z',
    dateFlexible: false,
    city: 'Luxembourg',
    countryCode: 'LU',
    location: { lat: 49.6, lng: 6.1 },
    budgetMin: { amountCents: 100000, currency: 'EUR' },
    budgetMax: { amountCents: 200000, currency: 'EUR' },
    usage: 'personal',
    status: 'open',
    expiresAt: null,
    hasQuoted: false,
    ...overrides,
  };
}

function ok(data: unknown, status = 200) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status }) });
}

function failed(status: number, error: unknown = {}) {
  return Promise.resolve({ data: undefined, error, response: new Response(null, { status }) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface World {
  profile?: Promise<unknown>;
  feed?: Promise<unknown> | (() => Promise<unknown>);
  request?: Promise<unknown>;
}

function mockWorld(world: World) {
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/photographer-profile') {
      return world.profile ?? ok({ id: 'p1', isPublished: true });
    }
    if (path === '/v1/requests') {
      const { feed } = world;
      return typeof feed === 'function' ? feed() : (feed ?? ok({ items: [], nextCursor: null }));
    }
    if (path === '/v1/requests/{id}') {
      return world.request ?? failed(404);
    }
    return failed(500);
  }) as never);
}

const PREVIEW = {
  subtotal: { amountCents: 24100, currency: 'EUR' },
  platformFee: { amountCents: 1205, currency: 'EUR' },
  total: { amountCents: 24100, currency: 'EUR' },
};

let current: ReturnType<typeof renderRouter>;

function open(url: string) {
  current = renderRouter('./app', { initialUrl: url });
}

function fillItem(label = 'Full day', qty = '2', price = '120.5') {
  fireEvent.changeText(screen.getByTestId('line-item-label-0'), label);
  fireEvent.changeText(screen.getByTestId('line-item-qty-0'), qty);
  fireEvent.changeText(screen.getByTestId('line-item-price-0'), price);
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('incoming requests list', () => {
  it('lists requests with quoted state and opens the detail', async () => {
    mockWorld({
      feed: ok({
        items: [makeRequest('a'), makeRequest('b', { hasQuoted: true, status: 'quoted' })],
        nextCursor: null,
      }),
      request: ok(makeRequest('a')),
    });
    open('/studio/requests');

    await screen.findByTestId('incoming-request-a');
    expect(screen.getByText('Wedding a')).toBeTruthy();
    expect(screen.getByTestId('incoming-request-b-quoted')).toBeTruthy();
    expect(screen.queryByTestId('incoming-request-a-quoted')).toBeNull();
    expect(renderedText(screen.toJSON())).toContain('€1,000.00');

    fireEvent.press(screen.getByTestId('incoming-request-a'));

    await screen.findByTestId('incoming-request-detail');
    expect(current.getPathname()).toBe('/studio/requests/a');
  });

  it('shows an empty state', async () => {
    mockWorld({});
    open('/studio/requests');

    await screen.findByTestId('incoming-requests-empty');
  });

  it('shows loading, then a session message on 401', async () => {
    mockWorld({ feed: failed(401) });
    open('/studio/requests');

    expect(screen.getByTestId('requests-profile-loading')).toBeTruthy();
    await screen.findByTestId('incoming-requests-unauthorized');
  });

  it('shows an error that retries', async () => {
    let calls = 0;
    mockWorld({
      feed: () =>
        calls++ === 0 ? failed(500) : ok({ items: [makeRequest('a')], nextCursor: null }),
    });
    open('/studio/requests');

    fireEvent.press(await screen.findByTestId('incoming-requests-retry'));

    await screen.findByTestId('incoming-request-a');
  });

  it('asks a user without a profile to create one and never loads the feed', async () => {
    mockWorld({ profile: failed(404) });
    open('/studio/requests');

    fireEvent.press(await screen.findByTestId('requests-create-profile'));

    await waitFor(() => {
      expect(current.getPathname()).toBe('/studio/profile');
    });
    expect(mockedGet).not.toHaveBeenCalledWith('/v1/requests', expect.anything());
  });

  it('asks for publication when the profile is not published', async () => {
    mockWorld({ profile: ok({ id: 'p1', isPublished: false }) });
    open('/studio/requests');

    await screen.findByTestId('requests-needs-published');
    expect(mockedGet).not.toHaveBeenCalledWith('/v1/requests', expect.anything());
  });

  it('is reachable from the Studio hub', async () => {
    mockWorld({});
    open('/studio');

    fireEvent.press(await screen.findByTestId('studio-entry-requests'));

    await screen.findByTestId('incoming-requests-empty');
  });
});

describe('incoming request detail', () => {
  it('shows not found for a request that is not a photographer summary', async () => {
    const ownRequest: Record<string, unknown> = makeRequest(REQUEST_ID);
    delete ownRequest.hasQuoted;
    mockWorld({ request: ok(ownRequest) });
    open(`/studio/requests/${REQUEST_ID}`);

    await screen.findByTestId('incoming-request-not-found');
  });

  it('shows not found on 404', async () => {
    mockWorld({ request: failed(404) });
    open(`/studio/requests/${REQUEST_ID}`);
    await screen.findByTestId('incoming-request-not-found');
  });

  it('shows an error with retry', async () => {
    let calls = 0;
    mockedGet.mockImplementation((() =>
      calls++ === 0 ? failed(500) : ok(makeRequest(REQUEST_ID))) as never);
    open(`/studio/requests/${REQUEST_ID}`);

    fireEvent.press(await screen.findByTestId('incoming-request-retry'));

    await screen.findByTestId('send-quote-form');
  });

  it('shows a session message on 401', async () => {
    mockWorld({ request: failed(401) });
    open(`/studio/requests/${REQUEST_ID}`);

    await screen.findByTestId('incoming-request-unauthorized');
  });

  it('offers no form for an already quoted request', async () => {
    mockWorld({ request: ok(makeRequest(REQUEST_ID, { hasQuoted: true })) });
    open(`/studio/requests/${REQUEST_ID}`);

    await screen.findByTestId('incoming-request-not-quotable');
    expect(screen.queryByTestId('send-quote-form')).toBeNull();
  });

  it('offers no form for an expired request', async () => {
    mockWorld({ request: ok(makeRequest(REQUEST_ID, { expiresAt: '2020-01-01T00:00:00.000Z' })) });
    open(`/studio/requests/${REQUEST_ID}`);

    await screen.findByTestId('incoming-request-not-quotable');
    expect(screen.queryByTestId('send-quote-form')).toBeNull();
  });
});

describe('send quote', () => {
  async function openForm(overrides: Record<string, unknown> = {}) {
    mockWorld({ request: ok(makeRequest(REQUEST_ID, overrides)) });
    open(`/studio/requests/${REQUEST_ID}`);
    await screen.findByTestId('send-quote-form');
  }

  it('previews fee and payout from the server before the quote can be sent', async () => {
    await openForm();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview' ? ok(PREVIEW) : ok({ id: 'q1' }, 201)) as never);

    expect(screen.queryByTestId('send-quote-send')).toBeNull();
    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));

    await screen.findByTestId('send-quote-preview');
    expect(mockedPost).toHaveBeenCalledWith('/v1/quotes/preview', {
      body: { lineItems: [{ label: 'Full day', qty: 2, unitCents: 12050 }] },
    });
    expect(screen.getByTestId('send-quote-preview-total').props.children).toBe('€241.00');
    expect(screen.getByTestId('send-quote-preview-payout').props.children).toBe('€228.95');
    expect(mockedPost).not.toHaveBeenCalledWith('/v1/quotes', expect.anything());
  });

  it('posts integer cents and returns to the sent quotes list', async () => {
    await openForm();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview' ? ok(PREVIEW) : ok({ id: 'q1' }, 201)) as never);
    mockedGet.mockImplementation((() => ok({ items: [], nextCursor: null })) as never);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    fireEvent.press(await screen.findByTestId('send-quote-send'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        '/v1/quotes',
        expect.objectContaining({
          body: expect.objectContaining({
            requestId: REQUEST_ID,
            lineItems: [{ label: 'Full day', qty: 2, unitCents: 12050 }],
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(current.getPathname()).toBe('/studio/quotes');
    });
  });

  it('invalidates the preview when an amount changes and requires a new review', async () => {
    await openForm();
    mockedPost.mockResolvedValue(ok(PREVIEW));

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    await screen.findByTestId('send-quote-preview');

    fireEvent.changeText(screen.getByTestId('line-item-price-0'), '130');

    expect(screen.queryByTestId('send-quote-preview')).toBeNull();
    expect(screen.queryByTestId('send-quote-send')).toBeNull();
    expect(screen.getByTestId('send-quote-review-stale')).toBeTruthy();
    expect(screen.getByTestId('send-quote-review')).toBeTruthy();
  });

  it('drops a preview response that arrives after the amount changed', async () => {
    await openForm();
    const pending = deferred<unknown>();
    mockedPost.mockReturnValueOnce(pending.promise);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    await screen.findByTestId('send-quote-preview-loading');
    fireEvent.changeText(screen.getByTestId('line-item-price-0'), '130');
    pending.resolve(await ok(PREVIEW));

    await waitFor(() => {
      expect(screen.queryByTestId('send-quote-preview-loading')).toBeNull();
    });
    expect(screen.queryByTestId('send-quote-preview')).toBeNull();
  });

  it('keeps the review after the message changes', async () => {
    await openForm();
    mockedPost.mockResolvedValue(ok(PREVIEW));

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    await screen.findByTestId('send-quote-preview');
    fireEvent.changeText(screen.getByTestId('send-quote-message'), 'Hello');

    expect(screen.getByTestId('send-quote-preview')).toBeTruthy();
  });

  it('rejects more than two decimals without calling the API', async () => {
    await openForm();

    fillItem('Full day', '1', '10.999');
    fireEvent.press(screen.getByTestId('send-quote-review'));

    expect(await screen.findByText('Enter an amount with at most two decimals.')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects a missing label and a fractional quantity', async () => {
    await openForm();

    fillItem('', '1.5', '10');
    fireEvent.press(screen.getByTestId('send-quote-review'));

    expect(await screen.findByText('Enter a whole number of at least 1.')).toBeTruthy();
    expect(screen.getByText('This value is too short.')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('rejects a chosen expiry after the request closes', async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await openForm({ expiresAt });

    fillItem();
    fireEvent.press(screen.getByTestId('mock-date-picker'));
    fireEvent.press(screen.getByTestId('send-quote-review'));

    expect(
      await screen.findByText('Choose a time before the request stops accepting quotes.'),
    ).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('can still be sent when the preview fails', async () => {
    await openForm();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview' ? failed(500) : ok({ id: 'q1' }, 201)) as never);
    mockedGet.mockImplementation((() => ok({ items: [], nextCursor: null })) as never);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    await screen.findByTestId('send-quote-preview-error');
    expect(screen.queryByTestId('send-quote-preview')).toBeNull();
    fireEvent.press(screen.getByTestId('send-quote-send'));

    await waitFor(() => {
      expect(current.getPathname()).toBe('/studio/quotes');
    });
  });

  it('guards against a double submit', async () => {
    await openForm();
    const create = deferred<unknown>();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview' ? ok(PREVIEW) : create.promise) as never);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    const send = await screen.findByTestId('send-quote-send');
    fireEvent.press(send);
    fireEvent.press(send);

    await waitFor(() => {
      expect(mockedPost.mock.calls.filter((call) => String(call[0]) === '/v1/quotes')).toHaveLength(
        1,
      );
    });
  });

  it.each([
    [409, { code: 'CONFLICT' }, 'This request is no longer accepting quotes.'],
    [
      422,
      { code: 'UNPROCESSABLE_ENTITY', message: 'Total too high' },
      "This quote can't be sent as entered. Reload the request and try again.",
    ],
    [
      429,
      { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 7 } },
      "You're sending quotes too fast. Try again in 7 seconds.",
    ],
    [500, {}, 'Something went wrong. Try again.'],
  ])(
    'shows a %i from the create call as a state and keeps the form',
    async (status, error, text) => {
      await openForm();
      mockedPost.mockImplementation(((path: string) =>
        path === '/v1/quotes/preview' ? ok(PREVIEW) : failed(status, error)) as never);

      fillItem();
      fireEvent.press(screen.getByTestId('send-quote-review'));
      fireEvent.press(await screen.findByTestId('send-quote-send'));

      await screen.findByTestId('send-quote-error');
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByTestId('send-quote-form')).toBeTruthy();
      expect(current.getPathname()).toBe(`/studio/requests/${REQUEST_ID}`);
    },
  );

  it('marks fields from a server validation error', async () => {
    await openForm();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview'
        ? ok(PREVIEW)
        : failed(400, {
            code: 'VALIDATION_ERROR',
            details: [{ path: 'lineItems.0.unitCents' }],
          })) as never);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    fireEvent.press(await screen.findByTestId('send-quote-send'));

    await screen.findByText("This value isn't valid.");
    expect(screen.getByTestId('send-quote-review')).toBeTruthy();
  });

  it('shows a session message when sending returns 401', async () => {
    await openForm();
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/quotes/preview' ? ok(PREVIEW) : failed(401)) as never);

    fillItem();
    fireEvent.press(screen.getByTestId('send-quote-review'));
    fireEvent.press(await screen.findByTestId('send-quote-send'));

    await screen.findByTestId('send-quote-unauthorized');
  });

  it('adds and removes line items, keeping at least one', async () => {
    await openForm();

    expect(screen.getByTestId('line-item-remove-0')).toBeDisabled();
    fireEvent.press(screen.getByTestId('line-item-add'));
    expect(screen.getByTestId('line-item-label-1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('line-item-remove-1'));
    expect(screen.queryByTestId('line-item-label-1')).toBeNull();
  });
});
