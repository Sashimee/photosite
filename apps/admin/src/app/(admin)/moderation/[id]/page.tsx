import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { serverApi } from '@/lib/server-api';

import { isModeratorInitiatedReport } from '../moderator-initiated';
import { DecisionHistory } from './decision-history';
import { ReportActions } from './report-actions';
import { ReportTargetSummary } from './report-target-summary';

// Mirrors the same-shaped probe in app/(admin)/verification/[id]/page.tsx:
// the audit-log endpoint needs 'superadmin', not 'moderation', so a
// moderation-only reviewer can open a report without being able to see its
// history. 200 renders the history, 403 hides it, anything else is a real
// failure.
async function canViewHistory(
  api: Awaited<ReturnType<typeof serverApi>>,
  reportId: string,
): Promise<boolean> {
  const { data, response } = await api.GET('/v1/admin/audit-log', {
    params: { query: { targetId: reportId, limit: 1 } },
  });
  if (data) {
    return true;
  }
  if (response.status === 403) {
    return false;
  }
  throw new Error(
    `Failed to check audit log access for report ${reportId}: HTTP ${String(response.status)}`,
  );
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverApi();

  const { data: report, response } = await api.GET('/v1/admin/reports/{id}', {
    params: { path: { id } },
  });

  if (response.status === 404) {
    notFound();
  }
  if (!report) {
    throw new Error(`Failed to load report ${id}: HTTP ${String(response.status)}`);
  }

  const allowHistory = await canViewHistory(api, id);

  const t = await getTranslations('admin.moderation.detail');
  const tStatuses = await getTranslations('admin.moderation.statuses');

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="font-mono text-sm text-muted-foreground">{report.id}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('fields.status')}</dt>
        <dd className="text-foreground">{tStatuses(report.status)}</dd>
        <dt className="text-muted-foreground">{t('fields.createdAt')}</dt>
        <dd className="text-foreground">{report.createdAt}</dd>
        {report.resolvedAt ? (
          <>
            <dt className="text-muted-foreground">{t('fields.resolvedAt')}</dt>
            <dd className="text-foreground">{report.resolvedAt}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t('fields.reporter')}</dt>
        <dd className="text-foreground">
          {report.reporterId ? t('fields.reporterPresent') : t('fields.reporterAnonymous')}
        </dd>
        {report.resolution ? (
          <>
            <dt className="text-muted-foreground">{t('fields.resolution')}</dt>
            <dd className="whitespace-pre-wrap text-foreground">{report.resolution}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2">
        {isModeratorInitiatedReport(report.reason) ? (
          <>
            <h2 className="text-lg font-medium text-foreground">
              {t('reason.moderatorInitiated.title')}
            </h2>
            <p className="text-sm text-foreground">{t('reason.moderatorInitiated.description')}</p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-medium text-foreground">{t('reason.title')}</h2>
            <p className="text-sm whitespace-pre-wrap text-foreground">{report.reason}</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('target.title')}</h2>
        <ReportTargetSummary targetType={report.targetType} target={report.target} />
      </div>

      <ReportActions report={report} />

      {allowHistory ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-foreground">{t('history.title')}</h2>
          <DecisionHistory targetId={report.id} />
        </div>
      ) : null}
    </section>
  );
}
