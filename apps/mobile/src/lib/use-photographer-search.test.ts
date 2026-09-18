import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('./api', () => ({
  api: { GET: jest.fn() },
}));

import type { components } from '@photoo/api-client';

import { api } from './api';
import type { SearchFilters } from './search-params';
import { usePhotographerSearch, type UsePhotographerSearchResult } from './use-photographer-search';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

const mockedGet = jest.mocked(api.GET);

beforeEach(() => {
  jest.resetAllMocks();
});

function summary(id: string): PhotographerSummary {
  return {
    id,
    slug: `photographer-${id}`,
    displayName: `Photographer ${id}`,
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
}

describe('usePhotographerSearch', () => {
  it('fetches the first page for the given filters', async () => {
    mockedGet.mockResolvedValue({
      data: { items: [summary('1'), summary('2')], nextCursor: 'cursor-1' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { result } = renderHook(() => usePhotographerSearch({ city: 'Luxembourg' }));

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(mockedGet).toHaveBeenCalledWith(
      '/v1/photographers',
      expect.objectContaining({ params: { query: { city: 'Luxembourg', limit: 20 } } }),
    );
  });

  it('appends the next page without duplicating existing items', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('1'), summary('2')], nextCursor: 'cursor-1' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { result } = renderHook(() => usePhotographerSearch({}));
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('3'), summary('4')], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(['1', '2', '3', '4']);
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/v1/photographers',
      expect.objectContaining({ params: { query: { limit: 20, cursor: 'cursor-1' } } }),
    );
  });

  it('does not load more when there is no next cursor', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('1')], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { result } = renderHook(() => usePhotographerSearch({}));
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    act(() => {
      result.current.loadMore();
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('sets an error status when the request fails, and retry re-fetches', async () => {
    mockedGet.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'INTERNAL', message: 'boom', requestId: 'req-1' },
      response: new Response(null, { status: 500 }),
    });

    const { result } = renderHook(() => usePhotographerSearch({}));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('1')], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['1']);
  });

  it('resets items and refetches when filters change', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('1')], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    const { result, rerender } = renderHook<
      UsePhotographerSearchResult,
      { filters: SearchFilters }
    >(({ filters }) => usePhotographerSearch(filters), {
      initialProps: { filters: { city: 'Luxembourg' } },
    });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    mockedGet.mockResolvedValueOnce({
      data: { items: [summary('9')], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    rerender({ filters: { city: 'Metz' } });

    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual(['9']);
    });
  });
});
