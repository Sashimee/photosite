import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';
import { toApiQuery, type SearchFilters } from './search-params';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

const RESULTS_LIMIT = 20;

export type PhotographerSearchStatus = 'loading' | 'idle' | 'loadingMore' | 'error';

export interface UsePhotographerSearchResult {
  items: PhotographerSummary[];
  status: PhotographerSearchStatus;
  loadMore: () => void;
  retry: () => void;
}

export function usePhotographerSearch(filters: SearchFilters): UsePhotographerSearchResult {
  const filtersKey = JSON.stringify(filters);
  const [items, setItems] = useState<PhotographerSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<PhotographerSearchStatus>('loading');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setItems([]);
    setNextCursor(null);

    api
      .GET('/v1/photographers', {
        params: { query: toApiQuery(filters, { limit: RESULTS_LIMIT }) },
      })
      .then(({ data }) => {
        if (cancelled) {
          return;
        }
        if (!data) {
          setStatus('error');
          return;
        }
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setStatus('idle');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filtersKey, retryToken]);

  const loadMore = useCallback(() => {
    if (status !== 'idle' || !nextCursor) {
      return;
    }
    setStatus('loadingMore');
    api
      .GET('/v1/photographers', {
        params: { query: toApiQuery(filters, { limit: RESULTS_LIMIT, cursor: nextCursor }) },
      })
      .then(({ data }) => {
        if (data) {
          setItems((previous) => [...previous, ...data.items]);
          setNextCursor(data.nextCursor);
        }
        setStatus('idle');
      })
      .catch(() => {
        setStatus('idle');
      });
  }, [status, nextCursor, filtersKey]);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  return { items, status, loadMore, retry };
}
