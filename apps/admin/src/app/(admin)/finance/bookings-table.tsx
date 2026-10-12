'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';
import { formatCents, requireMoney } from '@/lib/money';

import type { FinanceFilters } from './finance-search-params';

function listBookings(query: FinanceFilters & { cursor?: string }) {
  return api.GET('/v1/admin/bookings', { params: { query } });
}

type AdminBooking = NonNullable<Awaited<ReturnType<typeof listBookings>>['data']>['items'][number];

export function BookingsTable({ status, createdFrom, createdTo, dispute }: FinanceFilters) {
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
      cell: (row) => {
        const total = requireMoney(row.total, `total of booking ${row.id}`);
        return formatCents(format, total.amountCents, total.currency);
      },
    },
    {
      id: 'refunded',
      header: t('columns.refunded'),
      cell: (row) =>
        formatCents(
          format,
          row.refundedCents,
          requireMoney(row.total, `total of booking ${row.id}`).currency,
        ),
    },
    {
      id: 'reversed',
      header: t('columns.reversed'),
      cell: (row) =>
        formatCents(
          format,
          row.reversedCents,
          requireMoney(row.total, `total of booking ${row.id}`).currency,
        ),
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

  const filtered = status !== undefined || createdFrom !== undefined || dispute !== undefined;

  function fetchPage(cursor: string | undefined): Promise<DataTableFetchResult<AdminBooking>> {
    return listBookings({
      ...(status ? { status } : {}),
      ...(createdFrom && createdTo ? { createdFrom, createdTo } : {}),
      ...(dispute ? { dispute } : {}),
      ...(cursor ? { cursor } : {}),
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
          <p>{filtered ? t('empty.filteredTitle') : t('empty.title')}</p>
          <p className="text-xs">{filtered ? t('empty.filteredHint') : t('empty.hint')}</p>
        </div>
      }
    />
  );
}
