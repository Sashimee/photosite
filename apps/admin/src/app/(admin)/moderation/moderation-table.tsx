'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import { REPORT_TARGET_TYPES } from '@photoo/shared';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { api } from '@/lib/api';

import type { ModerationFilters } from './moderation-search-params';
import { isModeratorInitiatedReport } from './moderator-initiated';
import { reportAgeDays } from './report-age';

type AdminReport = components['schemas']['AdminReport'];

function isKnownTargetType(value: string): value is (typeof REPORT_TARGET_TYPES)[number] {
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function ModerationTable({ status, targetType, moderatorInitiated }: ModerationFilters) {
  const t = useTranslations('admin.moderation.list');
  const tStatuses = useTranslations('admin.moderation.statuses');
  const tTargetTypes = useTranslations('admin.moderation.targetTypes');
  const tAge = useTranslations('admin.moderation.list.age');

  const columns: DataTableColumn<AdminReport>[] = [
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (row) => (
        <Link
          href={`/moderation/${row.id}`}
          className="line-clamp-2 max-w-sm underline-offset-4 hover:underline"
        >
          {isModeratorInitiatedReport(row.reason) ? t('moderatorInitiated') : row.reason}
        </Link>
      ),
    },
    {
      id: 'targetType',
      header: t('columns.targetType'),
      cell: (row) =>
        isKnownTargetType(row.targetType) ? tTargetTypes(row.targetType) : row.targetType,
    },
    {
      id: 'age',
      header: t('columns.age'),
      cell: (row) => {
        const days = reportAgeDays(row.createdAt);
        return days === 0 ? tAge('today') : tAge('days', { days });
      },
    },
    {
      id: 'reporter',
      header: t('columns.reporter'),
      cell: (row) => (row.reporterId ? t('reporterPresent') : t('reporterAnonymous')),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => tStatuses(row.status),
    },
  ];

  // `moderatorInitiated` has no server-side query param - the queue's list
  // endpoint filters on `status`/`targetType`/`targetId` only - so this
  // narrows each already-fetched page instead. A page can render fewer rows
  // than usual, or none, when few of its reports are moderator-initiated;
  // that only trades a click on "Next" for a second server round trip, which
  // is acceptable for a filter aimed at an occasional review, not a queue a
  // moderator works through continuously.
  async function fetchPage(cursor: string | undefined): Promise<DataTableFetchResult<AdminReport>> {
    const result = await api.GET('/v1/admin/reports', {
      params: {
        query: {
          status,
          ...(targetType ? { targetType } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    });
    if (!moderatorInitiated || !result.data) {
      return result;
    }
    return {
      ...result,
      data: {
        ...result.data,
        items: result.data.items.filter((item) => isModeratorInitiatedReport(item.reason)),
      },
    };
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
