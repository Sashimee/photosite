import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import type { Booking } from './booking-status';

export type BookingState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ready'; booking: Booking };

export function useBooking(id: string) {
  const [state, setState] = useState<BookingState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .GET('/v1/bookings/{id}', { params: { path: { id } } })
      .then(({ data, response }) => {
        if (cancelled) {
          return;
        }
        if (data) {
          setState({ status: 'ready', booking: data });
        } else if (response.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (response.status === 404 || response.status === 403) {
          setState({ status: 'notFound' });
        } else {
          setState({ status: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const replaceBooking = useCallback((booking: Booking) => {
    setState({ status: 'ready', booking });
  }, []);

  return { state, reload, replaceBooking };
}
