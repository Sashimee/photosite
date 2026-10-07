import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

function makeQuote(id: string, status = 'sent', overrides: Record<string, unknown> = {}) {
  return {
    id,
    status,
    photographer: { displayName: 'Me' },
    subtotal: { amountCents: 24100, currency: 'EUR' },
    platformFee: { amountCents: 1205, currency: 'EUR' },
    total: { amountCents: 24100, currency: 'EUR' },
    validUntil: '2999-12-01T00:00:00.000Z',
    message: null,
    ...overrides,
  };
}

function ok(data: unknown, status = 200) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status }) });
}

function failed(status: number, error: unknown = {}) {
  return Promise.resolve({ data: undefined, error, response: new Response(null, { status }) });
}

function page(items: object[], nextCursor: string | null = null) {
  return ok({ items, nextCursor });
}

interface World {
  profile?: Promise<unknown>;
  quotes?: () => Promise<unknown>;
}

function mockWorld(world: World) {
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/photographer-profile') {
      return world.profile ?? ok({ id: 'p1', isPublished: true });
    }
    if (path === '/v1/quotes/mine') {
      return world.quotes ? world.quotes() : page([]);
    }
    return failed(500);
  }) as never);
}

let current: ReturnType<typeof renderRouter>;

function open(url = '/studio/quotes') {
  current = renderRouter('./app', { initialUrl: url });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('sent quotes list', () => {
  it('requests the photographer role and shows status, total and payout', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    open();

    await screen.findByTestId('sent-quote-q1');
    expect(mockedGet).toHaveBeenCalledWith(
      '/v1/quotes/mine',
      expect.objectContaining({
        params: { query: expect.objectContaining({ role: 'photographer' }) },
      }),
    );
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByText('€241.00')).toBeTruthy();
    expect(screen.getByTestId('sent-quote-q1-payout')).toHaveTextContent('Your payout €228.95');
  });

  it('hides the payout and withdraw for terminal quotes', async () => {
    mockWorld({ quotes: () => page([makeQuote('q2', 'withdrawn'), makeQuote('q3', 'accepted')]) });
    open();

    await screen.findByTestId('sent-quote-q2');
    expect(screen.getByText('Withdrawn')).toBeTruthy();
    expect(screen.queryByTestId('sent-quote-q2-payout')).toBeNull();
    expect(screen.queryByTestId('sent-quote-q2-withdraw')).toBeNull();
    expect(screen.getByTestId('sent-quote-q3-payout')).toBeTruthy();
    expect(screen.queryByTestId('sent-quote-q3-withdraw')).toBeNull();
  });

  it('shows an empty state', async () => {
    mockWorld({});
    open();

    await screen.findByTestId('sent-quotes-empty');
  });

  it('shows loading, then a session message on 401', async () => {
    mockWorld({ quotes: () => failed(401) });
    open();

    expect(screen.getByTestId('quotes-profile-loading')).toBeTruthy();
    await screen.findByTestId('sent-quotes-unauthorized');
  });

  it('shows an error that retries', async () => {
    let calls = 0;
    mockWorld({ quotes: () => (calls++ === 0 ? failed(500) : page([makeQuote('q1')])) });
    open();

    fireEvent.press(await screen.findByTestId('sent-quotes-retry'));

    await screen.findByTestId('sent-quote-q1');
  });

  it('asks for a profile and for publication before loading quotes', async () => {
    mockWorld({ profile: failed(404) });
    open();
    await screen.findByTestId('quotes-needs-profile');
    expect(mockedGet).not.toHaveBeenCalledWith('/v1/quotes/mine', expect.anything());
  });

  it('asks for publication when the profile is not published', async () => {
    mockWorld({ profile: ok({ id: 'p1', isPublished: false }) });
    open();
    await screen.findByTestId('quotes-needs-published');
    expect(mockedGet).not.toHaveBeenCalledWith('/v1/quotes/mine', expect.anything());
  });

  it('is reachable from the Studio hub', async () => {
    mockWorld({});
    open('/studio');

    fireEvent.press(await screen.findByTestId('studio-entry-quotes'));

    await screen.findByTestId('sent-quotes-empty');
    expect(current.getPathname()).toBe('/studio/quotes');
  });
});

describe('withdraw', () => {
  it('asks for confirmation, withdraws, and shows the refreshed status', async () => {
    let withdrawn = false;
    mockWorld({ quotes: () => page([makeQuote('q1', withdrawn ? 'withdrawn' : 'sent')]) });
    mockedPost.mockImplementation((() => {
      withdrawn = true;
      return ok(makeQuote('q1', 'withdrawn'));
    }) as never);
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('sent-quote-q1-withdraw-confirm'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v1/quotes/{id}/withdraw', {
        params: { path: { id: 'q1' } },
      });
    });
    await screen.findByText('Withdrawn');
    expect(screen.queryByTestId('sent-quote-q1-withdraw')).toBeNull();
  });

  it('does nothing when the confirm is dismissed', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    fireEvent.press(screen.getByTestId('sent-quote-q1-withdraw-dismiss'));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('sent-quote-q1-withdraw')).toBeTruthy();
  });

  it('shows a 409 as a state and leaves the quote in place', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    mockedPost.mockResolvedValue(failed(409, { code: 'CONFLICT' }));
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    fireEvent.press(screen.getByTestId('sent-quote-q1-withdraw-confirm'));

    await screen.findByText(
      'This quote can no longer be withdrawn. Refresh to see its current status.',
    );
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  it('shows a network failure as a state', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    mockedPost.mockRejectedValue(new Error('offline'));
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    fireEvent.press(screen.getByTestId('sent-quote-q1-withdraw-confirm'));

    await screen.findByText('Something went wrong. Try again.');
  });

  it('shows a session message on 401', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    mockedPost.mockResolvedValue(failed(401));
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    fireEvent.press(screen.getByTestId('sent-quote-q1-withdraw-confirm'));

    await screen.findByTestId('sent-quotes-unauthorized');
  });

  it('sends one withdraw request for repeated confirm presses', async () => {
    mockWorld({ quotes: () => page([makeQuote('q1')]) });
    let release!: (value: unknown) => void;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    open();

    fireEvent.press(await screen.findByTestId('sent-quote-q1-withdraw'));
    const confirm = screen.getByTestId('sent-quote-q1-withdraw-confirm');
    fireEvent.press(confirm);
    fireEvent.press(confirm);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    release(await failed(409, { code: 'CONFLICT' }));
    await screen.findByText(
      'This quote can no longer be withdrawn. Refresh to see its current status.',
    );
  });
});
