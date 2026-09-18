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

import type { UsersFilters } from './users-search-params';

type AdminUser = components['schemas']['User'];

export function UsersTable({ q, role, status }: UsersFilters) {
  const t = useTranslations('admin.users.list');
  const tRoles = useTranslations('admin.users.roles');
  const tStatuses = useTranslations('admin.users.statuses');

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'id',
      header: t('columns.id'),
      cell: (row) => (
        <Link
          href={`/users/${row.id}`}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {row.id}
        </Link>
      ),
    },
    {
      id: 'email',
      header: t('columns.email'),
      cell: (row) => maskEmail(row.email),
    },
    {
      id: 'roles',
      header: t('columns.roles'),
      cell: (row) => row.roles.map((value) => tRoles(value)).join(', '),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => tStatuses(row.status),
    },
  ];

  async function fetchPage(cursor: string | undefined): Promise<DataTableFetchResult<AdminUser>> {
    return api.GET('/v1/admin/users', {
      params: {
        query: {
          ...(q ? { q } : {}),
          ...(role ? { role } : {}),
          ...(status ? { status } : {}),
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
