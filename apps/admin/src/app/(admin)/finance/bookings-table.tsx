'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';

import type { components } from '@photoo/api-client';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';
import { formatCents } from '@/lib/money';

type AdminBooking = components['schemas']['AdminBooking'];

export function BookingsTable() {
  const t = useTranslations('admin.finance');
  const format = useFormatter();

  const columns: DataTableColumn<AdminBooking>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      cell: (row) => (
        <Link
          href={`/finance/${row.id}`}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {row.id}
        </Link>
      ),
    },
    { id: 'status', header: t('columns.status'), cell: (row) => t(`statuses.${row.status}`) },
    {
      id: 'total',
      header: t('columns.total'),
      cell: (row) => formatCents(format, row.total.amountCents, row.total.currency),
    },
    {
      id: 'refunded',
      header: t('columns.refunded'),
      cell: (row) => formatCents(format, row.refundedCents, row.total.currency),
    },
    {
      id: 'reversed',
      header: t('columns.reversed'),
      cell: (row) => formatCents(format, row.reversedCents, row.total.currency),
    },
    {
      id: 'dispute',
      header: t('columns.dispute'),
      cell: (row) => (row.disputeStatus ? t(`disputeStatuses.${row.disputeStatus}`) : t('none')),
    },
    {
      id: 'releasedAt',
      header: t('columns.releasedAt'),
      cell: (row) => (row.releasedAt ? format.dateTime(new Date(row.releasedAt), 'medium') : ''),
    },
  ];

  async function fetchPage(
    cursor: string | undefined,
  ): Promise<DataTableFetchResult<AdminBooking>> {
    return api.GET('/v1/admin/bookings', {
      params: { query: cursor ? { cursor } : {} },
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
