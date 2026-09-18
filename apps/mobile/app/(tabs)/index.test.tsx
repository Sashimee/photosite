import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);

const emptyPage = {
  data: { items: [], nextCursor: null },
  error: undefined,
  response: new Response(null, { status: 200 }),
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('Discover screen', () => {
  it('reads filters from the URL and sends them in the search request', async () => {
    mockedGet.mockResolvedValue(emptyPage);

    renderRouter('./app', { initialUrl: '/?city=Luxembourg&category=wedding' });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith(
        '/v1/photographers',
        expect.objectContaining({
          params: { query: { city: 'Luxembourg', category: 'wedding', limit: 20 } },
        }),
      );
    });
  });

  it('renders the empty state with a clear-filters action when filters are active', async () => {
    mockedGet.mockResolvedValue(emptyPage);

    renderRouter('./app', { initialUrl: '/?city=Nowhere' });

    await waitFor(() => screen.getByTestId('discover-empty'));
    expect(screen.getByTestId('discover-empty-clear-filters')).toBeTruthy();

    fireEvent.press(screen.getByTestId('discover-empty-clear-filters'));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenLastCalledWith(
        '/v1/photographers',
        expect.objectContaining({ params: { query: { limit: 20 } } }),
      );
    });
  });

  it('renders the empty state without a clear-filters action when there are no active filters', async () => {
    mockedGet.mockResolvedValue(emptyPage);

    renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => screen.getByTestId('discover-empty'));
    expect(screen.queryByTestId('discover-empty-clear-filters')).toBeNull();
  });

  it('shows a retry action on failure and refetches on press', async () => {
    mockedGet.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'INTERNAL', message: 'boom', requestId: 'req-1' },
      response: new Response(null, { status: 500 }),
    });

    renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => screen.getByTestId('discover-retry'));

    mockedGet.mockResolvedValueOnce(emptyPage);
    fireEvent.press(screen.getByTestId('discover-retry'));

    await waitFor(() => screen.getByTestId('discover-empty'));
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
