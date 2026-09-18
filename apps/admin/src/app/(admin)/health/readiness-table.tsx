'use client';

import { useTranslations } from 'next-intl';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';
import type { TranslateFn } from '@/lib/auth-errors';

interface CheckRow {
  id: 'database' | 'redis';
  label: string;
  status: 'ok' | 'down';
}

interface ReadinessDetails {
  database: 'ok' | 'down';
  redis: 'ok' | 'down';
}

function isReadinessDetails(value: unknown): value is ReadinessDetails {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { database, redis } = value as Record<string, unknown>;
  return (database === 'ok' || database === 'down') && (redis === 'ok' || redis === 'down');
}

function toRows(database: 'ok' | 'down', redis: 'ok' | 'down', t: TranslateFn): CheckRow[] {
  return [
    { id: 'database', label: t('checks.database'), status: database },
    { id: 'redis', label: t('checks.redis'), status: redis },
  ];
}

export function ReadinessTable() {
  const t = useTranslations('admin.health.readiness');

  const columns: DataTableColumn<CheckRow>[] = [
    { id: 'check', header: t('columns.check'), cell: (row) => row.label },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => (row.status === 'ok' ? t('statusOk') : t('statusDown')),
    },
  ];

  async function fetchPage(): Promise<DataTableFetchResult<CheckRow>> {
    const { data, error } = await api.GET('/ready');
    if (data) {
      return {
        data: { items: toRows(data.checks.database, data.checks.redis, t), nextCursor: null },
      };
    }
    // The readiness endpoint reports per-dependency status in the 503's
    // `details` even though that isn't part of the OpenAPI error schema
    // (apps/api/src/health/health.controller.ts), so a down dependency still
    // renders as a table row instead of falling back to DataTable's generic
    // error state.
    if (isReadinessDetails(error.details)) {
      return {
        data: { items: toRows(error.details.database, error.details.redis, t), nextCursor: null },
      };
    }
    return { error };
  }

  return (
    <DataTable
      columns={columns}
      fetchPage={fetchPage}
      getRowId={(row) => row.id}
      caption={t('caption')}
      emptyState={<p>{t('empty')}</p>}
    />
  );
}
