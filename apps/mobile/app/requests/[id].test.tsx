import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in' }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { renderedText } from '../../src/testing/rendered-text';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

const REQUEST = {
  id: 'r1',
  title: 'Wedding photographer',
  description: 'Full day coverage',
  eventDate: '2027-01-01T12:00:00.000Z',
  address: {
    line1: '1 Rue Test',
    line2: 'Floor 2',
    city: 'Luxembourg',
    postalCode: 'L-1111',
    countryCode: 'LU',
  },
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal',
  status: 'quoted',
  quoteCount: 1,
};

const QUOTE = {
  id: 'q1',
  status: 'sent',
  photographer: { displayName: 'Jane Doe Photography' },
  total: { amountCents: 157500, currency: 'EUR' },
  platformFee: { amountCents: 1234, currency: 'EUR' },
  validUntil: '2999-12-01T00:00:00.000Z',
};

function ok(data: unknown): unknown {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function fail(status: number, error: object = {}): unknown {
  return { data: undefined, error, response: new Response(null, { status }) };
}

function mockGets({ request = ok(REQUEST), quotes = ok({ items: [QUOTE], nextCursor: null }) }) {
  mockedGet.mockImplementation(((path: string) =>
    Promise.resolve(path === '/v1/requests/{id}' ? request : quotes)) as unknown as typeof api.GET);
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('request detail', () => {
  it('shows the request, budget as returned by the API and its quotes without fees', async () => {
    mockGets({});
    renderRouter('./app', { initialUrl: '/requests/r1' });

    await screen.findByTestId('request-detail');
    expect(screen.getByText('Wedding photographer')).toBeTruthy();
    expect(screen.getByTestId('request-detail-budget').props.children).toBe(
      '€1,000.00 to €2,000.00',
    );
    expect(screen.getByText('Quoted')).toBeTruthy();
    await screen.findByTestId('quote-card-q1');
    expect(screen.getByText('€1,575.00')).toBeTruthy();
    expect(renderedText(screen.toJSON())).not.toContain('12.34');
  });

  it('says there are no quotes yet', async () => {
    mockGets({ quotes: ok({ items: [], nextCursor: null }) });
    renderRouter('./app', { initialUrl: '/requests/r1' });

    await screen.findByTestId('request-quotes-empty');
  });

  it('keeps the request and offers a retry when only the quotes fail', async () => {
    mockGets({ quotes: fail(500) });
    renderRouter('./app', { initialUrl: '/requests/r1' });

    await screen.findByTestId('request-quotes-error');
    expect(screen.getByText('Wedding photographer')).toBeTruthy();
  });

  it('asks before cancelling and then shows the cancelled state', async () => {
    mockGets({});
    mockedPost.mockResolvedValue(ok({ ...REQUEST, status: 'cancelled' }));
    renderRouter('./app', { initialUrl: '/requests/r1' });

    fireEvent.press(await screen.findByTestId('request-cancel-action'));
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('request-cancel-action-confirm'));

    await screen.findByTestId('request-detail-cancelled');
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/requests/{id}/cancel',
      expect.objectContaining({ params: { path: { id: 'r1' } } }),
    );
    expect(screen.queryByTestId('request-cancel-action')).toBeNull();
  });

  it('leaves the request unchanged and says so when cancelling fails', async () => {
    mockGets({});
    mockedPost.mockResolvedValue(fail(409, { code: 'CONFLICT' }));
    renderRouter('./app', { initialUrl: '/requests/r1' });

    fireEvent.press(await screen.findByTestId('request-cancel-action'));
    fireEvent.press(screen.getByTestId('request-cancel-action-confirm'));

    await screen.findByTestId('request-detail-cancel-error');
    expect(screen.getByText('Quoted')).toBeTruthy();
    expect(screen.getByTestId('request-cancel-action')).toBeTruthy();
  });

  it('offers no cancel for a booked request', async () => {
    mockGets({ request: ok({ ...REQUEST, status: 'booked' }) });
    renderRouter('./app', { initialUrl: '/requests/r1' });

    await screen.findByTestId('request-detail');
    expect(screen.queryByTestId('request-cancel-action')).toBeNull();
  });

  it('says the request was not found for a 404', async () => {
    mockGets({ request: fail(404) });
    renderRouter('./app', { initialUrl: '/requests/r1' });

    await screen.findByText("This request doesn't exist, or it isn't yours.");
  });
});
