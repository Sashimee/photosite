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

import type { VerificationFilters } from './verification-search-params';

type AdminVerificationCaseSummary = components['schemas']['AdminVerificationCaseSummary'];

export function VerificationTable({
  status,
  countryCode,
  currentAdminId,
}: VerificationFilters & { currentAdminId: string }) {
  const t = useTranslations('admin.verification.list');
  const tStatuses = useTranslations('admin.verification.statuses');
  const tClaim = useTranslations('admin.verification.list.claim');

  const columns: DataTableColumn<AdminVerificationCaseSummary>[] = [
    {
      id: 'photographer',
      header: t('columns.photographer'),
      cell: (row) => (
        <Link href={`/verification/${row.id}`} className="underline-offset-4 hover:underline">
          {row.photographer.displayName}
        </Link>
      ),
    },
    { id: 'email', header: t('columns.email'), cell: (row) => row.photographer.email },
    { id: 'country', header: t('columns.country'), cell: (row) => row.countryCode },
    { id: 'status', header: t('columns.status'), cell: (row) => tStatuses(row.status) },
    {
      id: 'submittedAt',
      header: t('columns.submittedAt'),
      cell: (row) => row.submittedAt ?? '',
    },
    {
      id: 'reviewer',
      header: t('columns.reviewer'),
      cell: (row) => {
        if (!row.assignedAdminId) {
          return tClaim('unclaimed');
        }
        if (row.assignedAdminId === currentAdminId) {
          return tClaim('you');
        }
        return tClaim('another', { id: row.assignedAdminId });
      },
      cellClassName: 'font-mono text-xs',
    },
  ];

  async function fetchPage(
    cursor: string | undefined,
  ): Promise<DataTableFetchResult<AdminVerificationCaseSummary>> {
    return api.GET('/v1/admin/verification-cases', {
      params: {
        query: {
          status,
          ...(countryCode ? { countryCode } : {}),
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
