'use client';

import { useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';

type AuditLogEntry = components['schemas']['AdminAuditLogEntry'];

export function AuditTrail({ targetId }: { targetId: string }) {
  const t = useTranslations('admin.users.detail.auditTrail');

  const columns: DataTableColumn<AuditLogEntry>[] = [
    { id: 'occurredAt', header: t('columns.occurredAt'), cell: (row) => row.occurredAt },
    { id: 'action', header: t('columns.action'), cell: (row) => row.action },
    {
      id: 'actorId',
      header: t('columns.actor'),
      cell: (row) => row.actorId ?? t('systemActor'),
      cellClassName: 'font-mono text-xs',
    },
  ];

  async function fetchPage(
    cursor: string | undefined,
  ): Promise<DataTableFetchResult<AuditLogEntry>> {
    return api.GET('/v1/admin/audit-log', {
      params: { query: { targetId, ...(cursor ? { cursor } : {}) } },
    });
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
