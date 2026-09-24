'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';

import { reportTargetLabel } from '../report-target-label';
import { ResolveDialog } from './resolve-dialog';
import { RestoreDialog } from './restore-dialog';
import { TakedownDialog } from './takedown-dialog';

type AdminReport = components['schemas']['AdminReport'];

export function ReportActions({ report: initialReport }: { report: AdminReport }) {
  const t = useTranslations('admin.moderation.detail.actions');
  const tDetail = useTranslations('admin.moderation.detail');
  const [report, setReport] = useState(initialReport);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  async function refresh(): Promise<AdminReport | null> {
    const { data, response } = await api.GET('/v1/admin/reports/{id}', {
      params: { path: { id: report.id } },
    });
    if (!data) {
      throw new Error(`Failed to refresh report ${report.id}: HTTP ${String(response.status)}`);
    }
    setReport(data);
    return data;
  }

  async function handleDecided() {
    setConflictNotice(null);
    await refresh();
  }

  // Another admin resolved, dismissed or took this report down first: not an
  // error, an expected race (docs/steps/1D.6-moderation.md). Refreshing
  // reveals who, since the 409 body itself carries no admin id.
  async function handleResolveConflict() {
    const fresh = await refresh();
    setConflictNotice(
      fresh?.adminId
        ? t('conflict.alreadyResolved', { adminId: fresh.adminId })
        : t('conflict.alreadyResolvedUnknown'),
    );
  }

  async function handleRestoreConflict() {
    await refresh();
    setConflictNotice(t('conflict.notTakenDown'));
  }

  const target = report.target;
  const canDecide = report.status === 'open';
  const isTakenDown = Boolean(target?.deletedAt);
  const canTakedown = canDecide && target !== null && !isTakenDown;
  const canRestore = target !== null && isTakenDown;
  const targetLabel = target ? reportTargetLabel(tDetail, target) : '';

  return (
    <div className="flex flex-col gap-4">
      {conflictNotice ? <FormNotice tone="info">{conflictNotice}</FormNotice> : null}
      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <>
            <ResolveDialog
              reportId={report.id}
              status="resolved"
              onDecided={() => void handleDecided()}
              onConflict={() => void handleResolveConflict()}
            />
            <ResolveDialog
              reportId={report.id}
              status="dismissed"
              onDecided={() => void handleDecided()}
              onConflict={() => void handleResolveConflict()}
            />
          </>
        ) : null}
        {canTakedown ? (
          <TakedownDialog
            reportId={report.id}
            targetLabel={targetLabel}
            onDecided={() => void handleDecided()}
            onConflict={() => void handleResolveConflict()}
          />
        ) : null}
        {canRestore ? (
          <RestoreDialog
            reportId={report.id}
            targetLabel={targetLabel}
            onRestored={() => void handleDecided()}
            onConflict={() => void handleRestoreConflict()}
          />
        ) : null}
      </div>
      {!canDecide && !canTakedown && !canRestore ? (
        <p className="text-sm text-muted-foreground">{t('noActions')}</p>
      ) : null}
    </div>
  );
}
