'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiErrorMessage, type ApiErrorLike } from '@/lib/api-errors';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTablePage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DataTableFetchResult<T> {
  data?: DataTablePage<T>;
  error?: ApiErrorLike;
}

// Matches openapi-fetch's own `{ data, error }` return shape (with `response`
// ignored), so a caller can pass `(cursor) => api.GET(path, { params: {
// query: { ...filters, cursor, limit } } })` directly instead of wrapping it.
export type DataTableFetchPage<T> = (
  cursor: string | undefined,
) => Promise<DataTableFetchResult<T>>;

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  fetchPage: DataTableFetchPage<T>;
  getRowId: (row: T) => string;
  caption: string;
  emptyState: ReactNode;
  refreshSignal?: number;
}

interface LoadedPage<T> {
  cursor: string | undefined;
  items: T[];
  nextCursor: string | null;
}

interface LoadTarget {
  cursor: string | undefined;
  index: number;
}

type Status = 'loading' | 'error' | 'ready';

// Server-side keyset pagination only: every admin list is backed by a
// cursor endpoint, and sorting a single fetched page client-side would
// misrepresent the ordering of the whole set. Visited pages are kept in
// `pages` so going back never re-fetches; changing filters means the caller
// remounts this component (a new `key`) rather than this component
// detecting a `fetchPage` identity change.
export function DataTable<T>({
  columns,
  fetchPage,
  getRowId,
  caption,
  emptyState,
  refreshSignal,
}: DataTableProps<T>) {
  const t = useTranslations('admin.dataTable');
  const tCommon = useTranslations('common');
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const translateRef = useRef({ t, tCommon });
  translateRef.current = { t, tCommon };

  const [pages, setPages] = useState<LoadedPage<T>[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<LoadTarget>({ cursor: undefined, index: 0 });
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Reads `fetchPage` and the translators through refs so this callback's
  // identity never changes and the mount effect below never re-fires. To
  // pick up new filters, remount this component with a new `key` instead.
  const load = useCallback(async (target: LoadTarget) => {
    const { t: translate, tCommon: translateCommon } = translateRef.current;
    setPending(target);
    setStatus('loading');
    setErrorMessage(null);
    try {
      const result = await fetchPageRef.current(target.cursor);
      const { data } = result;
      if (!data) {
        setErrorMessage(apiErrorMessage(translate, translateCommon('error'), result.error));
        setStatus('error');
        return;
      }
      setPages((previous) => {
        const next = previous.slice(0, target.index);
        next[target.index] = {
          cursor: target.cursor,
          items: data.items,
          nextCursor: data.nextCursor,
        };
        return next;
      });
      setPageIndex(target.index);
      setStatus('ready');
    } catch {
      setErrorMessage(translateCommon('error'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load({ cursor: undefined, index: 0 });
  }, [load]);

  // `refreshSignal` re-fetches the current page in place, unlike the caller
  // remounting via `key` for filter changes: skip the value it mounts with
  // so this doesn't double-fetch alongside the effect above.
  const isInitialRefresh = useRef(true);
  useEffect(() => {
    if (isInitialRefresh.current) {
      isInitialRefresh.current = false;
      return;
    }
    void load(pendingRef.current);
  }, [refreshSignal, load]);

  const currentPage = pages[pageIndex];

  function handleNext() {
    if (!currentPage?.nextCursor) {
      return;
    }
    const nextIndex = pageIndex + 1;
    if (pages[nextIndex]) {
      setPageIndex(nextIndex);
      return;
    }
    void load({ cursor: currentPage.nextCursor, index: nextIndex });
  }

  function handleBack() {
    if (pageIndex === 0) {
      return;
    }
    setPageIndex(pageIndex - 1);
  }

  function handleRetry() {
    void load(pending);
  }

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground"
      >
        {tCommon('loading')}
      </div>
    );
  }

  if (status === 'error' || !currentPage) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive"
      >
        <p>{errorMessage ?? tCommon('error')}</p>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  }

  if (currentPage.items.length === 0) {
    return (
      <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.headerClassName}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {currentPage.items.map((row) => (
            <TableRow key={getRowId(row)}>
              {columns.map((column) => (
                <TableCell key={column.id} className={column.cellClassName}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleBack} disabled={pageIndex === 0}>
          {t('previous')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleNext} disabled={!currentPage.nextCursor}>
          {t('next')}
        </Button>
      </div>
    </div>
  );
}
