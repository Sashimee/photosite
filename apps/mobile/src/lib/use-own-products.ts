import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';

type Product = components['schemas']['Product'];

export type OwnProductsState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; products: Product[] };

export function useOwnProducts() {
  const [state, setState] = useState<OwnProductsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .GET('/v1/me/products')
        .then(({ data, response }) => {
          if (cancelled) {
            return;
          }
          if (data) {
            setState({
              status: 'ready',
              products: [...data].sort((a, b) => a.order - b.order),
            });
          } else if (response.status === 401) {
            setState({ status: 'unauthorized' });
          } else if (response.status === 404) {
            setState({ status: 'missing' });
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
    }, [attempt]),
  );

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
