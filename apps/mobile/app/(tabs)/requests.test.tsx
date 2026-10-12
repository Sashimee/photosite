import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { store } from 'expo-router/build/global-state/router-store';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/use-unread-count', () => ({ useUnreadCount: () => 0 }));

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in' }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);

function makeRequest(id: string, overrides: object = {}) {
  return {
    id,
    title: `Request ${id}`,
    status: 'quoted',
    quoteCount: 2,
    eventDate: '2027-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function page(items: object[], nextCursor: string | null) {
  return {
    data: { items, nextCursor },
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}

const failure = { data: undefined, error: {}, response: new Response(null, { status: 500 }) };

function mockPages(...pages: unknown[]) {
  for (const next of pages) {
    mockedGet.mockResolvedValueOnce(next);
  }
}

function pullToRefresh() {
  const { refreshControl } = screen.getByTestId('requests-list').props as {
    refreshControl: { props: { onRefresh: () => void } };
  };
  act(() => {
    refreshControl.props.onRefresh();
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('requests tab', () => {
  it('lists requests with status and quote count from the real en catalog', async () => {
    mockPages(page([makeRequest('a'), makeRequest('b', { status: 'open', quoteCount: 0 })], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    expect(screen.getByText('Quoted')).toBeTruthy();
    expect(screen.getByText('2 quotes')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('No quotes yet')).toBeTruthy();
    expect(screen.getByTestId('requests-new')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    mockPages(page([], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('requests-empty');
    expect(screen.getByText("You haven't sent any requests yet.")).toBeTruthy();
  });

  it('loads the next page with the cursor when the end is reached', async () => {
    mockPages(page([makeRequest('a')], 'cursor-1'), page([makeRequest('b')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    fireEvent(screen.getByTestId('requests-list'), 'endReached');

    await screen.findByTestId('request-row-b');
    expect(screen.getByTestId('request-row-a')).toBeTruthy();
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/v1/requests/mine',
      expect.objectContaining({
        params: { query: expect.objectContaining({ cursor: 'cursor-1' }) },
      }),
    );
  });

  it('does not fetch again once the last page was loaded', async () => {
    mockPages(page([makeRequest('a')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    fireEvent(screen.getByTestId('requests-list'), 'endReached');

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded rows when the next page fails and retries that page', async () => {
    mockPages(page([makeRequest('a')], 'cursor-1'), failure, page([makeRequest('b')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    fireEvent(screen.getByTestId('requests-list'), 'endReached');
    await screen.findByTestId('requests-error');
    expect(screen.getByTestId('request-row-a')).toBeTruthy();
    expect(screen.getByText("We couldn't load your requests.")).toBeTruthy();

    fireEvent(screen.getByTestId('requests-list'), 'endReached');
    expect(mockedGet).toHaveBeenCalledTimes(2);

    fireEvent.press(screen.getByTestId('requests-retry'));
    await screen.findByTestId('request-row-b');
    expect(screen.queryByTestId('requests-error')).toBeNull();
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/v1/requests/mine',
      expect.objectContaining({
        params: { query: expect.objectContaining({ cursor: 'cursor-1' }) },
      }),
    );
  });

  it('retries a failed first load', async () => {
    mockPages(failure, page([makeRequest('a')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    fireEvent.press(await screen.findByTestId('requests-retry'));

    await screen.findByTestId('request-row-a');
  });

  it('keeps rows when a pull-to-refresh fails', async () => {
    mockPages(page([makeRequest('a')], null), failure);
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    pullToRefresh();

    await screen.findByTestId('requests-error');
    expect(screen.getByTestId('request-row-a')).toBeTruthy();
  });

  it('replaces rows with the refreshed first page', async () => {
    mockPages(page([makeRequest('a')], null), page([makeRequest('c')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    await screen.findByTestId('request-row-a');
    pullToRefresh();

    await waitFor(() => screen.getByTestId('request-row-c'));
    expect(screen.queryByTestId('request-row-a')).toBeNull();
  });

  it('opens the request detail from a row', async () => {
    mockPages(page([makeRequest('a')], null));
    renderRouter('./app', { initialUrl: '/requests' });

    fireEvent.press(await screen.findByTestId('request-row-a'));

    await waitFor(() => {
      expect(store.getRouteInfo().pathname).toBe('/requests/a');
    });
  });
});
