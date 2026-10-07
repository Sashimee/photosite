import { useCallback, useEffect, useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from './api';
import { apiErrorWithStatus } from './request-errors';
import type { ApiErrorLike } from './auth-errors';

type PortfolioImage = components['schemas']['PortfolioImage'];

const PAGE_SIZE = 100;

export type PortfolioState =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready' };

export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const moved = items[index];
  if (moved === undefined || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

async function fetchAll(): Promise<
  { images: PortfolioImage[] } | { failure: 'unauthorized' | 'missing' | 'error' }
> {
  const images: PortfolioImage[] = [];
  let cursor: string | undefined;
  do {
    const { data, response } = await api.GET('/v1/me/photographer-profile/portfolio', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      if (response.status === 401) {
        return { failure: 'unauthorized' };
      }
      return { failure: response.status === 404 ? 'missing' : 'error' };
    }
    images.push(...data.items);
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return { images };
}

export function usePortfolio() {
  const [state, setState] = useState<PortfolioState>({ status: 'loading' });
  const [images, setImages] = useState<PortfolioImage[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [isReordering, setIsReordering] = useState(false);
  const [reorderError, setReorderError] = useState<ApiErrorLike | null>(null);
  const [deleteError, setDeleteError] = useState<ApiErrorLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchAll()
      .then((result) => {
        if (cancelled) {
          return;
        }
        if ('images' in result) {
          setImages(result.images);
          setState({ status: 'ready' });
        } else {
          setState({ status: result.failure });
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
  }, [attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const append = useCallback((image: PortfolioImage) => {
    setImages((current) => [...current, image]);
  }, []);

  const move = useCallback(
    async (index: number, direction: -1 | 1) => {
      const previous = images;
      const next = moveItem(images, index, direction);
      setReorderError(null);
      setImages(next);
      setIsReordering(true);
      try {
        const { data, error, response } = await api.PATCH(
          '/v1/me/photographer-profile/portfolio/order',
          { body: { imageIds: next.map((image) => image.id) } },
        );
        if (data) {
          setImages(data.items);
        } else {
          setImages(previous);
          setReorderError(apiErrorWithStatus(error, response.status));
        }
      } catch {
        setImages(previous);
        setReorderError({});
      } finally {
        setIsReordering(false);
      }
    },
    [images],
  );

  const remove = useCallback(async (imageId: string) => {
    setDeleteError(null);
    try {
      const { error, response } = await api.DELETE(
        '/v1/me/photographer-profile/portfolio/{imageId}',
        { params: { path: { imageId } } },
      );
      if (error) {
        setDeleteError(apiErrorWithStatus(error, response.status));
        return;
      }
      setImages((current) => current.filter((image) => image.id !== imageId));
    } catch {
      setDeleteError({});
    }
  }, []);

  return {
    state,
    images,
    reload,
    append,
    move,
    remove,
    isReordering,
    reorderError,
    deleteError,
  };
}
