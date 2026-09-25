'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';
import { maskEmail } from '@/lib/user-mask';

import type { DataRequestsFilters } from './data-requests-search-params';
import { hasPassed } from './date-status';
import { graceDaysRemaining, isOverdueDeletion } from './grace-period';
import { RetryExportDialog } from './retry-export-dialog';

type AdminDataRequest = components['schemas']['AdminDataRequest'];

function isPendingDeletion(row: AdminDataRequest): boolean {
  return row.type === 'delete' && row.status === 'pending';
}

function isExpiredReady(row: AdminDataRequest): boolean {
  return row.status === 'ready' && row.expiresAt !== null && hasPassed(row.expiresAt);
}

function isRetryableExport(row: AdminDataRequest): boolean {
  return row.type === 'export' && row.status === 'failed';
}

export function DataRequestsTable({ status, type, userId, userIdInvalid }: DataRequestsFilters) {
  const t = useTranslations('admin.dataRequests.list');
  const tTypes = useTranslations('admin.dataRequests.types');
  const tStatuses = useTranslations('admin.dataRequests.statuses');
  const tGracePeriod = useTranslations('admin.dataRequests.list.gracePeriod');
  const tResponseDue = useTranslations('admin.dataRequests.list.responseDue');
  const format = useFormatter();
  const [refreshToken, setRefreshToken] = useState(0);

  if (userIdInvalid) {
    return null;
  }

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
      cell: (row) => (isExpiredReady(row) ? tStatuses('expired') : tStatuses(row.status)),
    },
    {
      id: 'requestedAt',
      header: t('columns.requestedAt'),
      cell: (row) => format.dateTime(new Date(row.requestedAt), 'medium'),
    },
    {
      id: 'completedAt',
      header: t('columns.completedAt'),
      cell: (row) =>
        row.completedAt
          ? format.dateTime(new Date(row.completedAt), 'medium')
          : t('placeholders.none'),
    },
    {
      id: 'expiresAt',
      header: t('columns.expiresAt'),
      cell: (row) =>
        row.expiresAt
          ? format.dateTime(new Date(row.expiresAt), 'medium')
          : t('placeholders.unset'),
    },
    {
      id: 'failureReason',
      header: t('columns.failureReason'),
      cell: (row) => row.failureReason ?? t('placeholders.none'),
    },
    {
      id: 'responseDueAt',
      header: t('columns.responseDueAt'),
      cell: (row) => {
        if (row.responseDueAt === null) {
          if (row.answeredLate) {
            return (
              <span className="font-medium text-destructive">{tResponseDue('answeredLate')}</span>
            );
          }
          return t('placeholders.notApplicable');
        }
        if (hasPassed(row.responseDueAt)) {
          return (
            <span className="font-medium text-destructive">
              {format.dateTime(new Date(row.responseDueAt), 'medium')} ({tResponseDue('overdue')})
            </span>
          );
        }
        return format.dateTime(new Date(row.responseDueAt), 'medium');
      },
    },
    {
      id: 'gracePeriod',
      header: t('columns.gracePeriod'),
      cell: (row) => {
        if (!isPendingDeletion(row)) {
          return t('placeholders.notApplicable');
        }
        if (isOverdueDeletion(row.requestedAt, row.failureReason)) {
          return <span className="font-medium text-destructive">{tGracePeriod('overdue')}</span>;
        }
        const days = graceDaysRemaining(row.requestedAt);
        return days === 0 ? tGracePeriod('dueNow') : tGracePeriod('remaining', { days });
      },
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      cell: (row) =>
        isRetryableExport(row) ? (
          <RetryExportDialog
            request={row}
            onRetried={() => {
              setRefreshToken((value) => value + 1);
            }}
          />
        ) : null,
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
      key={refreshToken}
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
