import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { serverApi } from '@/lib/server-api';

import { CheckActions } from './check-actions';
import { CheckSignals } from './check-signals';
import { DecisionHistory } from './decision-history';

// Mirrors the same-shaped probe in app/(admin)/moderation/[id]/page.tsx: the
// audit-log endpoint needs 'superadmin', not 'moderation', so a
// moderation-only reviewer can open a check without seeing its history.
async function canViewHistory(
  api: Awaited<ReturnType<typeof serverApi>>,
  checkId: string,
): Promise<boolean> {
  const { data, response } = await api.GET('/v1/admin/audit-log', {
    params: { query: { targetId: checkId, limit: 1 } },
  });
  if (data) {
    return true;
  }
  if (response.status === 403) {
    return false;
  }
  throw new Error(
    `Failed to check audit log access for provenance check ${checkId}: HTTP ${String(response.status)}`,
  );
}

export default async function ProvenanceCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverApi();

  const { data: check, response } = await api.GET('/v1/admin/provenance/{id}', {
    params: { path: { id } },
  });

  if (response.status === 404) {
    notFound();
  }
  if (!check) {
    throw new Error(`Failed to load provenance check ${id}: HTTP ${String(response.status)}`);
  }

  const allowHistory = await canViewHistory(api, id);

  const t = await getTranslations('admin.provenance.detail');
  const tProvenance = await getTranslations('admin.provenance');
  const format = await getFormatter();
  const hasDecision = check.note !== null || check.decisionReason !== null;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="font-mono text-sm text-muted-foreground">{check.id}</p>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element -- a public portfolio thumbnail from the API's own S3_PUBLIC_BASE_URL, not the admin app's origin next/image is configured for. */}
      <img
        src={check.thumbnailUrl}
        alt={t('thumbnailAlt', { photographer: check.photographer.displayName })}
        referrerPolicy="no-referrer"
        className="max-h-[60vh] w-full max-w-md rounded-md border border-border object-contain"
      />

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('photographer')}</dt>
        <dd className="text-foreground">
          {check.photographer.displayName}{' '}
          <span className="font-mono text-xs text-muted-foreground">{check.photographer.slug}</span>
        </dd>
        <dt className="text-muted-foreground">{t('fields.status')}</dt>
        <dd className="text-foreground">{tProvenance(`statuses.${check.portfolioImageStatus}`)}</dd>
        <dt className="text-muted-foreground">{t('fields.verdict')}</dt>
        <dd className="text-foreground">{tProvenance(`verdicts.${check.verdict}`)}</dd>
        <dt className="text-muted-foreground">{t('fields.score')}</dt>
        <dd className="text-foreground">
          {check.score === null
            ? tProvenance('notChecked')
            : tProvenance('scoreValue', { score: check.score })}
        </dd>
        {check.checkedAt ? (
          <>
            <dt className="text-muted-foreground">{t('fields.checkedAt')}</dt>
            <dd className="text-foreground">
              {format.dateTime(new Date(check.checkedAt), 'medium')}
            </dd>
          </>
        ) : null}
        {check.reviewedAt ? (
          <>
            <dt className="text-muted-foreground">{t('fields.reviewedAt')}</dt>
            <dd className="text-foreground">
              {format.dateTime(new Date(check.reviewedAt), 'medium')}
            </dd>
          </>
        ) : null}
        {check.reviewedByAdminId ? (
          <>
            <dt className="text-muted-foreground">{t('fields.reviewer')}</dt>
            <dd className="font-mono text-xs text-foreground">{check.reviewedByAdminId}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('signals.title')}</h2>
        <CheckSignals check={check} />
      </div>

      {hasDecision ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-foreground">{t('decisionRecord.title')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {check.note ? (
              <>
                <dt className="text-muted-foreground">{t('decisionRecord.note')}</dt>
                <dd className="whitespace-pre-wrap text-foreground">{check.note}</dd>
              </>
            ) : null}
            {check.decisionReason ? (
              <>
                <dt className="text-muted-foreground">{t('decisionRecord.reason')}</dt>
                <dd className="text-foreground">
                  {tProvenance(`reasons.${check.decisionReason}`)}
                </dd>
              </>
            ) : null}
            {check.decisionReasonText ? (
              <>
                <dt className="text-muted-foreground">{t('decisionRecord.reasonText')}</dt>
                <dd className="whitespace-pre-wrap text-foreground">{check.decisionReasonText}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('actions.title')}</h2>
        <CheckActions checkId={check.id} />
      </div>

      {allowHistory ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-foreground">{t('history.title')}</h2>
          <DecisionHistory targetId={check.id} />
        </div>
      ) : null}
    </section>
  );
}
