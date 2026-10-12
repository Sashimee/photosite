'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { retryAfterSeconds } from '@/lib/auth-errors';

import type { FinanceFilters } from './finance-search-params';

const FALLBACK_FILENAME = 'photoo-bookings.csv';
const TRUNCATED_MARKER = '#truncated';
const TAIL_BYTES = 64;

function filenameFrom(disposition: string | null): string {
  const match = disposition ? /filename="([\w.-]+)"/.exec(disposition) : null;
  return match?.[1] ?? FALLBACK_FILENAME;
}

async function endsTruncated(file: Blob): Promise<boolean> {
  const tail = await file.slice(-TAIL_BYTES).text();
  return tail.trimEnd().split(/\r?\n/).at(-1) === TRUNCATED_MARKER;
}

function save(file: Blob, filename: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportButton(filters: FinanceFilters) {
  const t = useTranslations('admin.finance.export');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const inFlight = useRef(false);

  function errorMessage(code: string | undefined, details: unknown): string {
    switch (code) {
      case 'TOO_MANY_REQUESTS': {
        const seconds = retryAfterSeconds(details);
        return seconds === undefined
          ? t('errors.tooManyRequests')
          : t('errors.tooManyRequestsWithRetry', { seconds });
      }
      case 'FORBIDDEN':
        return t('errors.forbidden');
      case 'VALIDATION_ERROR':
        return t('errors.invalid');
      default:
        return t('errors.generic');
    }
  }

  async function handleExport() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setExporting(true);
    setError(null);
    setTruncated(false);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await api.GET('/v1/admin/bookings/export.csv', {
        params: { query: filters },
        parseAs: 'blob',
      });
      // src/lib/api.ts already redirects for these two.
      if (response.status === 401 || apiError?.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      if (apiError || !response.ok || !(data instanceof Blob)) {
        setError(errorMessage(apiError?.code, apiError?.details));
        return;
      }
      setTruncated(await endsTruncated(data));
      save(data, filenameFrom(response.headers.get('Content-Disposition')));
    } catch {
      setError(t('errors.generic'));
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={exporting}
          aria-describedby="finance-export-notice"
          onClick={() => {
            void handleExport();
          }}
        >
          {exporting ? t('exporting') : t('action')}
        </Button>
        <p id="finance-export-notice" className="text-xs text-muted-foreground">
          {t('notice')}
        </p>
      </div>
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      {truncated ? <FormNotice>{t('truncated')}</FormNotice> : null}
    </div>
  );
}
