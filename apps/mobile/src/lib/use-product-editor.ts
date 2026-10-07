import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';

type Product = components['schemas']['Product'];

export type ProductEditorState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'missing' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ready'; currency: string; product: Product | null };

async function load(productId: string | null): Promise<ProductEditorState> {
  const [profile, countries, product] = await Promise.all([
    api.GET('/v1/me/photographer-profile'),
    api.GET('/v1/countries'),
    productId
      ? api.GET('/v1/me/products/{productId}', { params: { path: { productId } } })
      : Promise.resolve(null),
  ]);

  const statuses = [profile.response.status, product?.response.status];
  if (statuses.includes(401)) {
    return { status: 'unauthorized' };
  }
  if (product && !product.data) {
    return { status: product.response.status === 404 ? 'notFound' : 'error' };
  }
  if (!profile.data) {
    return { status: profile.response.status === 404 ? 'missing' : 'error' };
  }
  const { countryCode } = profile.data;
  const currency = countries.data?.find((country) => country.code === countryCode)?.currency;
  if (!currency) {
    return { status: 'error' };
  }
  return { status: 'ready', currency, product: product?.data ?? null };
}

export function useProductEditor(productId: string | null) {
  const [state, setState] = useState<ProductEditorState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load(productId)
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
  }, [productId, attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
