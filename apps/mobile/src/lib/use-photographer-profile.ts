import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';
import { SlugSchema } from '@photoo/shared';

import { api } from './api';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];
type Product = components['schemas']['Product'];

export type ProfileState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; profile: PublicPhotographerProfile; products: Product[] };

export function usePhotographerProfile(slug: string | undefined): {
  state: ProfileState;
  retry: () => void;
} {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const parsed = SlugSchema.safeParse(slug);
    if (!parsed.success) {
      setState({ status: 'not-found' });
      return;
    }

    let cancelled = false;
    const path = { slug: parsed.data };
    setState({ status: 'loading' });
    Promise.all([
      api.GET('/v1/photographers/{slug}', { params: { path } }),
      api.GET('/v1/photographers/{slug}/products', { params: { path } }),
    ])
      .then(([profileResult, productsResult]) => {
        if (cancelled) {
          return;
        }
        if (profileResult.response.status === 404 || productsResult.response.status === 404) {
          setState({ status: 'not-found' });
        } else if (profileResult.data && productsResult.data) {
          setState({
            status: 'ready',
            profile: profileResult.data,
            products: productsResult.data,
          });
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
  }, [slug, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}
