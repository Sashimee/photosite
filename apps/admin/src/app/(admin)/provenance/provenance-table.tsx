'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';

import type { components } from '@photoo/api-client';

import {
  DataTable,
  type DataTableColumn,
  type DataTableFetchResult,
} from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

import { BulkDecisionDialog } from './bulk-decision-dialog';
import type { ProvenanceFilters } from './provenance-search-params';

type AdminProvenanceCheckSummary = components['schemas']['AdminProvenanceCheckSummary'];

export function ProvenanceTable({ status, verdict }: ProvenanceFilters) {
  const t = useTranslations('admin.provenance.list');
  const tBulk = useTranslations('admin.provenance.list.bulk');
  const tStatuses = useTranslations('admin.provenance.statuses');
  const tVerdicts = useTranslations('admin.provenance.verdicts');
  const tScore = useTranslations('admin.provenance');
  const format = useFormatter();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [refreshSignal, setRefreshSignal] = useState(0);
  const seenRows = useRef(new Map<string, AdminProvenanceCheckSummary>());

  function toggle(id: string, checked: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  const columns: DataTableColumn<AdminProvenanceCheckSummary>[] = [
    {
      id: 'select',
      header: <span className="sr-only">{t('columns.select')}</span>,
      cell: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={(event) => {
            toggle(row.id, event.target.checked);
          }}
          aria-label={t('selectRow', { photographer: row.photographer.displayName })}
          className="size-4"
        />
      ),
    },
    {
      id: 'thumbnail',
      header: t('columns.thumbnail'),
      cell: (row) => (
        <Link href={`/provenance/${row.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a public portfolio thumbnail from the API's own S3_PUBLIC_BASE_URL, not the admin app's origin next/image is configured for. */}
          <img
            src={row.thumbnailUrl}
            alt={t('thumbnailAlt', { photographer: row.photographer.displayName })}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-16 rounded-md border border-border object-cover"
          />
        </Link>
      ),
    },
    {
      id: 'photographer',
      header: t('columns.photographer'),
      cell: (row) => (
        <Link href={`/provenance/${row.id}`} className="underline-offset-4 hover:underline">
          {row.photographer.displayName}
        </Link>
      ),
    },
    { id: 'verdict', header: t('columns.verdict'), cell: (row) => tVerdicts(row.verdict) },
    {
      id: 'score',
      header: t('columns.score'),
      cell: (row) =>
        row.score === null ? t('notChecked') : tScore('scoreValue', { score: row.score }),
    },
    {
      id: 'checkedAt',
      header: t('columns.checkedAt'),
      cell: (row) => (row.checkedAt ? format.dateTime(new Date(row.checkedAt), 'medium') : ''),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => tStatuses(row.portfolioImageStatus),
    },
  ];

  async function fetchPage(
    cursor: string | undefined,
  ): Promise<DataTableFetchResult<AdminProvenanceCheckSummary>> {
    const result = await api.GET('/v1/admin/provenance', {
      params: {
        query: {
          status,
          ...(verdict ? { verdict } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    });
    for (const row of result.data?.items ?? []) {
      seenRows.current.set(row.id, row);
    }
    return result;
  }

  const targets = [...selectedIds].flatMap((id) => {
    const row = seenRows.current.get(id);
    return row ? [{ id, label: row.photographer.displayName }] : [];
  });

  function handleFinished({
    failedIds,
    anySucceeded,
  }: {
    failedIds: string[];
    anySucceeded: boolean;
  }) {
    setSelectedIds(new Set(failedIds));
    if (anySucceeded) {
      setRefreshSignal((value) => value + 1);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
        <span role="status" className="text-sm text-foreground">
          {tBulk('selected', { count: selectedIds.size })}
        </span>
        <BulkDecisionDialog status="approved" targets={targets} onFinished={handleFinished} />
        <BulkDecisionDialog status="rejected" targets={targets} onFinished={handleFinished} />
        <Button
          type="button"
          variant="ghost"
          disabled={selectedIds.size === 0}
          onClick={() => {
            setSelectedIds(new Set());
          }}
        >
          {tBulk('clear')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        fetchPage={fetchPage}
        getRowId={(row) => row.id}
        caption={t('caption')}
        refreshSignal={refreshSignal}
        emptyState={
          <div className="flex flex-col gap-1">
            <p>{t('empty.title')}</p>
            <p className="text-xs">{t('empty.hint')}</p>
          </div>
        }
      />
    </div>
  );
}
