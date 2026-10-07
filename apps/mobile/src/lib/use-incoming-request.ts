import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';

type Request = components['schemas']['Request'];
type RequestSummary = components['schemas']['RequestSummary'];

export type IncomingRequestState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ready'; request: RequestSummary };

function isRequestSummary(body: Request | RequestSummary): body is RequestSummary {
  return 'hasQuoted' in body;
}

async function load(id: string): Promise<IncomingRequestState> {
  const { data, response } = await api.GET('/v1/requests/{id}', { params: { path: { id } } });
  if (response.status === 401) {
    return { status: 'unauthorized' };
  }
  if (!data) {
    return { status: response.status === 404 || response.status === 403 ? 'notFound' : 'error' };
  }
  // The endpoint returns the full `Request` to its owner and the photographer
  // `RequestSummary` to a matched photographer; only the latter is quotable here.
  const body: Request | RequestSummary = data;
  return isRequestSummary(body) ? { status: 'ready', request: body } : { status: 'notFound' };
}

export function useIncomingRequest(id: string) {
  const [state, setState] = useState<IncomingRequestState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load(id)
      .then((next) => {
        if (!cancelled) {
          setState(next);
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

  return { state, reload };
}

export function canQuoteRequest(request: RequestSummary, now: number = Date.now()): boolean {
  return (
    !request.hasQuoted &&
    (request.expiresAt === null || new Date(request.expiresAt).getTime() > now)
  );
}
