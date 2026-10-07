import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { store } from 'expo-router/build/global-state/router-store';
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

import '../../src/lib/i18n';
import { renderedText } from '../../src/testing/rendered-text';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);

function makeQuote(id: string, status = 'sent') {
  return {
    id,
    status,
    photographer: { displayName: `Photographer ${id}` },
    total: { amountCents: 120000, currency: 'EUR' },
    platformFee: { amountCents: 1234, currency: 'EUR' },
    validUntil: '2999-12-01T00:00:00.000Z',
  };
}

function page(items: object[], nextCursor: string | null) {
  return {
    data: { items, nextCursor },
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('quotes list', () => {
  it('requests the client role and shows total and photographer without the fee', async () => {
    mockedGet.mockResolvedValueOnce(page([makeQuote('q1')], null));
    renderRouter('./app', { initialUrl: '/quotes' });

    await screen.findByTestId('quote-card-q1');
    expect(screen.getByText('Photographer q1')).toBeTruthy();
    expect(screen.getByText('€1,200.00')).toBeTruthy();
    expect(renderedText(screen.toJSON())).not.toContain('12.34');
    expect(mockedGet).toHaveBeenCalledWith(
      '/v1/quotes/mine',
      expect.objectContaining({ params: { query: expect.objectContaining({ role: 'client' }) } }),
    );
  });

  it('shows an empty state', async () => {
    mockedGet.mockResolvedValueOnce(page([], null));
    renderRouter('./app', { initialUrl: '/quotes' });

    await screen.findByText("You haven't received any quotes yet.");
  });

  it('opens the quote detail from a card', async () => {
    mockedGet.mockResolvedValue(page([makeQuote('q1')], null));
    renderRouter('./app', { initialUrl: '/quotes' });

    fireEvent.press(await screen.findByTestId('quote-card-q1'));

    await waitFor(() => {
      expect(store.getRouteInfo().pathname).toBe('/quotes/q1');
    });
  });

  it('keeps rows and offers a retry when the next page fails', async () => {
    mockedGet.mockResolvedValueOnce(page([makeQuote('q1')], 'c1')).mockResolvedValueOnce({
      data: undefined,
      error: {},
      response: new Response(null, { status: 500 }),
    });
    renderRouter('./app', { initialUrl: '/quotes' });

    await screen.findByTestId('quote-card-q1');
    fireEvent(screen.getByTestId('quotes-list'), 'endReached');

    await screen.findByTestId('quotes-retry');
    expect(screen.getByTestId('quote-card-q1')).toBeTruthy();
  });
});
