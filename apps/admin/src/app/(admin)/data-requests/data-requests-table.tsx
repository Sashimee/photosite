'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { components } from '@photoo/api-client';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';
import { maskEmail } from '@/lib/user-mask';

import type { DataRequestsFilters } from './data-requests-search-params';
import { graceDaysRemaining } from './grace-period';

type AdminDataRequest = components['schemas']['AdminDataRequest'];

function isPendingDeletion(row: AdminDataRequest): boolean {
  return row.type === 'delete' && row.status === 'pending';
}

export function DataRequestsTable({ status, type, userId }: DataRequestsFilters) {
  const t = useTranslations('admin.dataRequests.list');
  const tTypes = useTranslations('admin.dataRequests.types');
  const tStatuses = useTranslations('admin.dataRequests.statuses');
  const tGracePeriod = useTranslations('admin.dataRequests.list.gracePeriod');

  const columns: DataTableColumn<AdminDataRequest>[] = [
    {
      id: 'user',
      header: t('columns.user'),
      cell: (row) => (
        <Link
          href={`/users/${encodeURIComponent(row.user.id)}`}
          className="underline-offset-4 hover:underline"
        >
          {maskEmail(row.user.email)}
        </Link>
      ),
    },
    {
      id: 'type',
      header: t('columns.type'),
      cell: (row) => tTypes(row.type),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => tStatuses(row.status),
    },
    {
      id: 'requestedAt',
      header: t('columns.requestedAt'),
      cell: (row) => row.requestedAt,
    },
    {
      id: 'completedAt',
      header: t('columns.completedAt'),
      cell: (row) => row.completedAt ?? t('placeholders.none'),
    },
    {
      id: 'expiresAt',
      header: t('columns.expiresAt'),
      cell: (row) => row.expiresAt ?? t('placeholders.unset'),
    },
    {
      id: 'failureReason',
      header: t('columns.failureReason'),
      cell: (row) => row.failureReason ?? t('placeholders.none'),
    },
    {
      id: 'gracePeriod',
      header: t('columns.gracePeriod'),
      cell: (row) => {
        if (!isPendingDeletion(row)) {
          return t('placeholders.notApplicable');
        }
        const days = graceDaysRemaining(row.requestedAt);
        return days === 0 ? tGracePeriod('dueNow') : tGracePeriod('remaining', { days });
      },
    },
  ];

  async function fetchPage(
    cursor: string | undefined,
  ): Promise<DataTableFetchResult<AdminDataRequest>> {
    return api.GET('/v1/admin/data-requests', {
      params: {
        query: {
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          ...(userId ? { userId } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    });
  }

  return (
    <DataTable
      columns={columns}
      fetchPage={fetchPage}
      getRowId={(row) => row.id}
      caption={t('caption')}
      emptyState={
        <div className="flex flex-col gap-1">
          <p>{t('empty.title')}</p>
          <p className="text-xs">{t('empty.hint')}</p>
        </div>
      }
    />
  );
}
