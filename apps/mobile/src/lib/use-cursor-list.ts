import { useCallback, useEffect, useRef, useState } from 'react';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

type FailedAction = 'reload' | 'more';

export function useCursorList<T extends { id: string }>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);
  const inFlight = useRef(false);
  const cursor = useRef<string | null>(null);

  const reload = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setFailedAction(null);
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      try {
        const page = await fetchPage(undefined);
        setItems(page.items);
        cursor.current = page.nextCursor;
        setNextCursor(page.nextCursor);
      } catch {
        setFailedAction('reload');
      } finally {
        inFlight.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [fetchPage],
  );

  const loadMore = useCallback(async () => {
    if (inFlight.current || cursor.current === null) {
      return;
    }
    inFlight.current = true;
    setFailedAction(null);
    setIsLoadingMore(true);
    try {
      const page = await fetchPage(cursor.current);
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      cursor.current = page.nextCursor;
      setNextCursor(page.nextCursor);
    } catch {
      setFailedAction('more');
    } finally {
      inFlight.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void reload('initial');
  }, [reload]);

  const refresh = useCallback(() => reload('refresh'), [reload]);

  const retry = useCallback(
    () => (failedAction === 'more' ? loadMore() : reload(items.length > 0 ? 'refresh' : 'initial')),
    [failedAction, items.length, loadMore, reload],
  );

  const onEndReached = useCallback(() => {
    if (failedAction === null) {
      void loadMore();
    }
  }, [failedAction, loadMore]);

  return {
    items,
    hasMore: nextCursor !== null,
    isLoading,
    isRefreshing,
    isLoadingMore,
    failed: failedAction !== null,
    refresh,
    retry,
    onEndReached,
  };
}
