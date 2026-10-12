import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import type { Booking } from './booking-status';
import { useCursorList } from './use-cursor-list';

const PAGE_SIZE = 20;

export type BookingViewer = 'client' | 'photographer';

export function belongsToViewer(booking: Booking, viewer: BookingViewer, ownerId: string): boolean {
  return viewer === 'client' ? booking.clientId === ownerId : booking.photographerId === ownerId;
}

export function useBookingsList(viewer: BookingViewer, ownerId: string | null) {
  const [unauthorized, setUnauthorized] = useState(false);

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data, response } = await api.GET('/v1/bookings', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      if (response.status === 401) {
        setUnauthorized(true);
      }
      throw new Error(`bookings failed: HTTP ${String(response.status)}`);
    }
    return data;
  }, []);

  const list = useCursorList(fetchPage);

  const items =
    ownerId === null
      ? []
      : list.items.filter((booking) => belongsToViewer(booking, viewer, ownerId));

  const { hasMore, isLoading, isLoadingMore, failed, onEndReached } = list;
  useEffect(() => {
    if (items.length === 0 && hasMore && !isLoading && !isLoadingMore && !failed) {
      onEndReached();
    }
  }, [items.length, hasMore, isLoading, isLoadingMore, failed, onEndReached]);

  return { list, items, unauthorized };
}
